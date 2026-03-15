# -*- coding: utf-8 -*-
"""
MATCH PREDICTOR — Full Analysis — ALL LEAGUES
================================================
Per ogni partita nell'intervallo orario mostra TUTTE le probabilità:
  - Over 2.5 / Under 2.5 (%)
  - Over 3.5 (%)
  - BTTS YES / BTTS NO (%)
  - Over 2.5 + BTTS combo (%)
  - No Goal: quale squadra non segna (%)
  - Corner expected + Over 7.5/8.5/9.5/10.5 (%)
  - Ammonizioni expected + Over 2.5/3.5/4.5 (%)
  - Score più probabili

Data: API-Football + Supabase (team_season_stats, corner_team_stats)

Usage:
    python match_predictor.py                           # oggi, 13:30-21:30
    python match_predictor.py 2026-03-19                # data specifica
    python match_predictor.py 2026-03-19 17:00 21:00    # data + intervallo
    python match_predictor.py 17:00 21:00               # oggi + intervallo
"""

import os, sys, time, math, json, threading, argparse, re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo
import requests

# ==========================
# CONFIG
# ==========================
API_KEY = os.getenv("API_FOOTBALL_KEY", "").strip()
BASE_URL = "https://v3.football.api-sports.io"
HEADERS = {"x-apisports-key": API_KEY, "Accept": "application/json"}

API_MIN_INTERVAL_SEC = float(os.getenv("API_FOOTBALL_MIN_INTERVAL_SEC", "0.45"))
API_MAX_RETRIES = int(os.getenv("API_FOOTBALL_MAX_RETRIES", "6"))
API_BACKOFF_BASE_SEC = float(os.getenv("API_FOOTBALL_BACKOFF_BASE_SEC", "0.8"))
API_BACKOFF_MAX_SEC = float(os.getenv("API_FOOTBALL_BACKOFF_MAX_SEC", "20"))

_API_SESSION = requests.Session()
_API_LOCK = threading.Lock()
_API_LAST_TS = 0.0
TZ = timezone.utc
MATCH_TIMEZONE = os.getenv("MATCH_PREDICTOR_TIMEZONE", "Europe/Rome")
LOCAL_TZ = ZoneInfo(MATCH_TIMEZONE)
DEFAULT_CACHE_DIR = Path(__file__).resolve().parent / "assets" / "data" / "match-predictor"
CACHE_TTL_HOURS = int(os.getenv("MATCH_PREDICTOR_TTL_HOURS", "24"))
TEAM_STATS_CACHE = {}
SB_TEAM_STATS_CACHE = {}
SB_CORNER_STATS_CACHE = {}
SB_CORNER_H2H_CACHE = {}
SB_CARDS_TEAM_STATS_CACHE = {}
SB_CARDS_H2H_CACHE = {}
SB_REFEREE_CARDS_CACHE = {}
SB_MATCH_TEAM_STATS_CACHE = {}
LIVE_STATUSES = {"1H", "2H", "ET", "LIVE", "HT", "P", "BT", "INT"}
FINAL_STATUSES = {"FT", "AET", "PEN", "AWD", "WO"}

PREFERRED_BOOKMAKER_NAMES = {"Bet365", "bet365", "bet365.com", "Bet 365"}

# ==========================
# UTILS
# ==========================
def today_str():
    return datetime.now(TZ).strftime("%Y-%m-%d")

def today_local_str():
    return datetime.now(LOCAL_TZ).strftime("%Y-%m-%d")

def now_utc():
    return datetime.now(TZ)

def parse_iso_dt(value):
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=TZ)

def compact_probability(value):
    if value is None:
        return None
    return round(float(value), 4)

def to_float(x):
    if x is None: return None
    try:
        s = str(x).strip().replace("%","").replace(",",".")
        return float(s) if s else None
    except: return None

def safe_div(a, b):
    try: return a / b if b not in (0, None) and a is not None else 0.0
    except: return 0.0

def normalize_percent(value):
    num = to_float(value)
    if num is None:
        return None
    return num / 100.0 if num > 1 else num

def clamp_prob(value, low=0.02, high=0.98):
    return max(low, min(high, value))

def nudge_prob(value, factor=1.04, low=0.03, high=0.97):
    if value is None:
        return None
    centered = 0.5 + (float(value) - 0.5) * factor
    return clamp_prob(centered, low, high)

def half_lines(start, end):
    start_i = int(round(float(start) * 2))
    end_i = int(round(float(end) * 2))
    return [round(value / 2.0, 1) for value in range(start_i, end_i + 1, 2)]


# ==========================
# API LAYER
# ==========================
def _throttle():
    global _API_LAST_TS
    with _API_LOCK:
        w = API_MIN_INTERVAL_SEC - (time.time() - _API_LAST_TS)
        if w > 0: time.sleep(w)
        _API_LAST_TS = time.time()

def api_request(path, params=None, timeout=20):
    if not API_KEY:
        raise RuntimeError("API_FOOTBALL_KEY is required.")
    url = f"{BASE_URL}{path}"
    for att in range(API_MAX_RETRIES + 1):
        _throttle()
        try:
            r = _API_SESSION.get(url, headers=HEADERS, params=params or {}, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(API_BACKOFF_MAX_SEC, API_BACKOFF_BASE_SEC * (2 ** att)))
                continue
            r.raise_for_status()
            d = r.json()
            return d if isinstance(d, dict) else {}
        except:
            time.sleep(min(API_BACKOFF_MAX_SEC, API_BACKOFF_BASE_SEC * (2 ** att)))
    return {}

def api_get(path, params=None, timeout=20):
    d = api_request(path, params=params, timeout=timeout)
    r = d.get("response", []) if isinstance(d, dict) else []
    return r if isinstance(r, list) else []


# ==========================
# DATA FETCHERS
# ==========================

# --- SUPABASE ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
SB_REST = f"{SUPABASE_URL}/rest/v1" if SUPABASE_URL else ""
SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}
SB_SESSION = requests.Session()

def sb_query(table, params):
    if not SB_REST or not SUPABASE_KEY:
        return []
    url = f"{SB_REST}/{table}"
    if params:
        query = "&".join(
            f"{quote(str(k), safe='')}={quote(str(v), safe='.*(),:-_%')}"
            for k, v in params.items()
        )
        url += f"?{query}"
    try:
        r = SB_SESSION.get(url, headers=SB_HEADERS, timeout=30)
        r.raise_for_status()
        return r.json()
    except:
        return []

def sb_query_first_nonempty(table, params_variants):
    for params in params_variants:
        rows = sb_query(table, params)
        if rows:
            return rows
    return []

def mean_or_none(values):
    vals = [float(v) for v in values if v is not None]
    return (sum(vals) / len(vals)) if vals else None

def normalize_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())

def row_num(row, *keys):
    if not isinstance(row, dict) or not row:
        return None
    for key in keys:
        num = to_float(row.get(key))
        if num is not None:
            return num
    normalized = {normalize_key(k): v for k, v in row.items()}
    for key in keys:
        num = to_float(normalized.get(normalize_key(key)))
        if num is not None:
            return num
    return None

def row_num_tokens(row, include=(), exclude=()):
    if not isinstance(row, dict) or not row:
        return None
    include_norm = [normalize_key(token) for token in include if token]
    exclude_norm = [normalize_key(token) for token in exclude if token]
    for raw_key, raw_value in row.items():
        key = normalize_key(raw_key)
        if not key:
            continue
        if include_norm and any(token not in key for token in include_norm):
            continue
        if exclude_norm and any(token in key for token in exclude_norm):
            continue
        num = to_float(raw_value)
        if num is not None:
            return num
    return None

def rows_metric_mean(rows, exact_keys=(), include=(), exclude=()):
    values = []
    for row in rows or []:
        num = row_num(row, *exact_keys) if exact_keys else None
        if num is None and include:
            num = row_num_tokens(row, include, exclude)
        if num is not None:
            values.append(num)
    return mean_or_none(values)

def side_metric_avg(row, metric, side, against=False):
    side = str(side or "").lower()
    if metric == "corners":
        if against:
            return (
                row_num(row, f"avg_corners_against_{side}", f"{side}_corners_against_avg", f"corners_against_{side}_avg")
                or row_num_tokens(row, include=("corner", side, "against"), exclude=("total", "match"))
                or row_num_tokens(row, include=("corner", side, "conceded"), exclude=("total", "match"))
            )
        return (
            row_num(row, f"avg_corners_for_{side}", f"{side}_corners_for_avg", f"corners_for_{side}_avg")
            or row_num_tokens(row, include=("corner", side, "for"), exclude=("total", "match"))
            or row_num_tokens(row, include=("corner", side), exclude=("against", "conceded", "allowed", "total", "match"))
        )
    if metric == "cards":
        if against:
            return (
                row_num(row, f"avg_yellows_against_{side}", f"avg_cards_against_{side}", f"{side}_cards_against_avg")
                or row_num_tokens(row, include=("card", side, "against"), exclude=("red", "total", "match"))
                or row_num_tokens(row, include=("yellow", side, "against"), exclude=("total", "match"))
            )
        return (
            row_num(row, f"avg_yellows_for_{side}", f"avg_cards_for_{side}", f"avg_yellow_cards_{side}", f"{side}_cards_avg")
            or row_num_tokens(row, include=("card", side, "for"), exclude=("red", "total", "match"))
            or row_num_tokens(row, include=("yellow", side), exclude=("against", "conceded", "allowed", "red", "total", "match"))
            or row_num_tokens(row, include=("card", side), exclude=("against", "conceded", "allowed", "red", "total", "match"))
        )
    return None

def season_corners_avg(row):
    return (
        row_num(row, "corners_for_avg", "corners_avg", "avg_corners", "avg_corners_for", "corners_for_pg")
        or row_num_tokens(row, include=("corner", "avg"), exclude=("against", "conceded", "allowed"))
    )

def season_yellows_avg(row):
    return (
        row_num(row, "yellow_avg", "cards_avg", "yellow_cards_avg", "avg_yellows", "avg_cards")
        or row_num_tokens(row, include=("yellow", "avg"))
        or row_num_tokens(row, include=("card", "avg"), exclude=("red",))
    )

def season_shots_avg(row):
    return (
        row_num(row, "shots_for_avg", "shots_avg", "shots_for_pg", "avg_shots", "avg_shots_for")
        or row_num_tokens(row, include=("shot", "avg"), exclude=("against", "target", "conceded"))
    )

def season_fouls_avg(row):
    return (
        row_num(row, "fouls_for_avg", "fouls_avg", "fouls_for_pg", "avg_fouls", "avg_fouls_for")
        or row_num_tokens(row, include=("foul", "avg"), exclude=("against", "suffered", "drawn"))
    )

def recent_metric_mean(rows, metric):
    if metric == "corners_for":
        return rows_metric_mean(rows,
            exact_keys=("corners_for", "team_corners", "corners", "corners_won", "corners_taken"),
            include=("corner",),
            exclude=("against", "opp", "opponent", "allowed", "conceded", "red", "yellow", "total"),
        )
    if metric == "corners_against":
        return rows_metric_mean(rows,
            exact_keys=("corners_against", "opponent_corners", "opp_corners", "corners_allowed", "corners_conceded"),
            include=("corner", "against"),
            exclude=("red", "yellow"),
        )
    if metric == "cards_for":
        return rows_metric_mean(rows,
            exact_keys=("yellow_cards", "cards", "cards_for", "yellow_cards_for", "yellows"),
            include=("card",),
            exclude=("red", "against", "opp", "opponent", "allowed", "conceded", "total", "referee"),
        ) or rows_metric_mean(rows,
            include=("yellow",),
            exclude=("red", "against", "opp", "opponent", "allowed", "conceded", "total", "referee"),
        )
    if metric == "fouls_for":
        return rows_metric_mean(rows,
            exact_keys=("fouls", "fouls_for", "fouls_committed"),
            include=("foul",),
            exclude=("against", "suffered", "drawn", "opp", "opponent", "total"),
        )
    if metric == "shots_for":
        return rows_metric_mean(rows,
            exact_keys=("shots", "shots_for", "team_shots", "total_shots"),
            include=("shot",),
            exclude=("target", "against", "opp", "opponent", "allowed"),
        )
    return None

def sb_team_stats(team_id, season="2025"):
    """team_season_stats: shots, SoT, fouls, yellows, corners, possession."""
    key = (team_id, str(season))
    if key in SB_TEAM_STATS_CACHE:
        return SB_TEAM_STATS_CACHE[key]
    rows = sb_query_first_nonempty("team_season_stats", [
        {"team_id": f"eq.{team_id}", "season": f"eq.{season}", "select": "*"},
        {"team_id": f"eq.{team_id}", "select": "*", "order": "season.desc", "limit": "1"},
        {"team_id": f"eq.{team_id}", "select": "*", "limit": "1"},
    ])
    SB_TEAM_STATS_CACHE[key] = rows[0] if rows else {}
    return SB_TEAM_STATS_CACHE[key]

def sb_corner_stats(team_id, league_id=None):
    """corner_team_stats: avg corners for/against home/away."""
    key = (team_id, league_id)
    if key in SB_CORNER_STATS_CACHE:
        return SB_CORNER_STATS_CACHE[key]
    variants = []
    if league_id:
        variants.append({"team_id": f"eq.{team_id}", "league_id": f"eq.{league_id}", "select": "*", "limit": "1"})
    variants.extend([
        {"team_id": f"eq.{team_id}", "select": "*", "order": "total_matches.desc", "limit": "1"},
        {"team_id": f"eq.{team_id}", "select": "*", "limit": "1"},
    ])
    rows = sb_query_first_nonempty("corner_team_stats", variants)
    SB_CORNER_STATS_CACHE[key] = rows[0] if rows else {}
    return SB_CORNER_STATS_CACHE[key]

def sb_corner_h2h(hid, aid, n=5):
    """H2H corner average."""
    key = tuple(sorted((hid, aid))) + (n,)
    if key in SB_CORNER_H2H_CACHE:
        return SB_CORNER_H2H_CACHE[key]
    rows = sb_query("corner_match_stats", {
        "or": f"(and(home_team_id.eq.{hid},away_team_id.eq.{aid}),and(home_team_id.eq.{aid},away_team_id.eq.{hid}))",
        "select": "total_corners", "order": "match_date.desc", "limit": str(n),
    })
    values = [to_float(row.get("total_corners")) for row in rows]
    SB_CORNER_H2H_CACHE[key] = mean_or_none(values)
    return SB_CORNER_H2H_CACHE[key]

def sb_cards_team_stats(team_id, league_id=None):
    key = (team_id, league_id)
    if key in SB_CARDS_TEAM_STATS_CACHE:
        return SB_CARDS_TEAM_STATS_CACHE[key]
    variants = []
    if league_id:
        variants.append({"team_id": f"eq.{team_id}", "league_id": f"eq.{league_id}", "select": "*", "limit": "1"})
    variants.extend([
        {"team_id": f"eq.{team_id}", "select": "*", "order": "total_matches.desc", "limit": "1"},
        {"team_id": f"eq.{team_id}", "select": "*", "limit": "1"},
    ])
    rows = sb_query_first_nonempty("cards_team_stats", variants)
    SB_CARDS_TEAM_STATS_CACHE[key] = rows[0] if rows else {}
    return SB_CARDS_TEAM_STATS_CACHE[key]

def sb_cards_h2h(hid, aid, n=5):
    key = tuple(sorted((hid, aid))) + (n,)
    if key in SB_CARDS_H2H_CACHE:
        return SB_CARDS_H2H_CACHE[key]
    rows = sb_query("cards_match_stats", {
        "or": f"(and(home_team_id.eq.{hid},away_team_id.eq.{aid}),and(home_team_id.eq.{aid},away_team_id.eq.{hid}))",
        "select": "*", "order": "match_date.desc", "limit": str(n),
    })
    values = []
    for row in rows:
        num = (
            row_num(row, "total_yellows", "yellow_cards_total", "cards_total", "total_cards")
            or row_num_tokens(row, include=("yellow", "total"))
            or row_num_tokens(row, include=("card", "total"), exclude=("red",))
        )
        if num is not None:
            values.append(num)
    SB_CARDS_H2H_CACHE[key] = mean_or_none(values)
    return SB_CARDS_H2H_CACHE[key]

def sb_referee_cards(referee_name, league_id=None):
    clean_name = str(referee_name or "").strip()
    if not clean_name:
        return None
    key = (clean_name.lower(), league_id)
    if key in SB_REFEREE_CARDS_CACHE:
        return SB_REFEREE_CARDS_CACHE[key]
    variants = []
    for column in ("referee", "referee_name", "name"):
        if league_id:
            variants.append({column: f"ilike.*{clean_name}*", "league_id": f"eq.{league_id}", "select": "*", "limit": "1"})
        variants.append({column: f"ilike.*{clean_name}*", "select": "*", "limit": "1"})
    rows = sb_query_first_nonempty("cards_referee_stats", variants)
    row = rows[0] if rows else {}
    value = (
        row_num(row, "yellow_avg", "cards_avg", "avg_yellow_cards", "avg_cards_total", "avg_cards", "yellow_cards_avg", "cards_per_match")
        or row_num_tokens(row, include=("yellow", "avg"))
        or row_num_tokens(row, include=("card", "avg"), exclude=("red",))
    )
    SB_REFEREE_CARDS_CACHE[key] = value
    return value

def sb_recent_match_team_stats(team_id, league_id=None, n=8):
    key = (team_id, league_id, n)
    if key in SB_MATCH_TEAM_STATS_CACHE:
        return SB_MATCH_TEAM_STATS_CACHE[key]
    variants = []
    if league_id:
        variants.extend([
            {"team_id": f"eq.{team_id}", "league_id": f"eq.{league_id}", "select": "*", "order": "match_date.desc", "limit": str(n)},
            {"team_id": f"eq.{team_id}", "league_id": f"eq.{league_id}", "select": "*", "limit": str(n)},
        ])
    variants.extend([
        {"team_id": f"eq.{team_id}", "select": "*", "order": "match_date.desc", "limit": str(n)},
        {"team_id": f"eq.{team_id}", "select": "*", "limit": str(n)},
    ])
    rows = sb_query_first_nonempty("match_team_stats", variants)
    if rows:
        rows = sorted(
            rows,
            key=lambda row: str(row.get("match_date") or row.get("date") or ""),
            reverse=True,
        )[:n]
    SB_MATCH_TEAM_STATS_CACHE[key] = rows or []
    return SB_MATCH_TEAM_STATS_CACHE[key]
def get_all_fixtures(target_date, time_min, time_max):
    resp = api_get("/fixtures", params={"date": target_date, "timezone": MATCH_TIMEZONE}, timeout=30)
    print(f"# Fixtures totali per {target_date}: {len(resp)}", file=sys.stderr)

    filtered = []
    for f in resp:
        fx = f.get("fixture", {}) or {}

        st = (fx.get("status") or {}).get("short", "")
        if st in ("PST", "CANC", "ABD"): continue

        dateiso = fx.get("date", "") or ""
        t = dateiso[11:16] if len(dateiso) >= 16 else ""
        if not t or t < time_min or t > time_max: continue

        filtered.append(f)

    print(f"# Dopo filtro orario ({time_min}-{time_max}): {len(filtered)}", file=sys.stderr)
    return filtered


def get_prediction(fixture_id):
    preds = api_get("/predictions", {"fixture": fixture_id})
    if not preds: return {}
    b = preds[0].get("predictions") or {}
    return {
        "goals_home": (b.get("goals") or {}).get("home"),
        "goals_away": (b.get("goals") or {}).get("away"),
        "under_over": b.get("under_over"),
        "advice": b.get("advice"),
        "prob_home": (b.get("percent") or {}).get("home"),
        "prob_draw": (b.get("percent") or {}).get("draw"),
        "prob_away": (b.get("percent") or {}).get("away"),
    }


def get_odds(fixture_id):
    data0 = api_request("/odds", {"fixture": fixture_id, "page": 1})
    resp0 = data0.get("response", []) if isinstance(data0, dict) else []
    if not resp0: return {}

    bookmakers = list(resp0[0].get("bookmakers") or [])
    paging = (data0.get("paging") or {}) if isinstance(data0, dict) else {}
    total_pages = int(paging.get("total") or 1)

    def _is_b365(name): return (name or "").strip() in PREFERRED_BOOKMAKER_NAMES

    if total_pages > 1 and not any(_is_b365((b or {}).get("name")) for b in bookmakers):
        seen = set((b or {}).get("name") for b in bookmakers if (b or {}).get("name"))
        for page in range(2, min(total_pages, 3) + 1):
            d = api_request("/odds", {"fixture": fixture_id, "page": page})
            r = d.get("response", []) if isinstance(d, dict) else []
            if not r: continue
            for bm in (r[0].get("bookmakers") or []):
                nm = (bm or {}).get("name")
                if nm and nm not in seen: bookmakers.append(bm); seen.add(nm)
            if any(_is_b365((b or {}).get("name")) for b in bookmakers): break

    if not bookmakers: return {}

    chosen = next((b for b in bookmakers if _is_b365(b.get("name"))), bookmakers[0])
    bets = chosen.get("bets", [])
    res = {"bookmaker": chosen.get("name", "")}

    for b in bets:
        if b.get("name") == "Match Winner":
            for v in b.get("values", []):
                val = v.get("value")
                if val == "Home": res["odd_home"] = v.get("odd", "")
                elif val == "Draw": res["odd_draw"] = v.get("odd", "")
                elif val == "Away": res["odd_away"] = v.get("odd", "")

    def _n(s): return str(s or "").strip().lower()

    for b in bets:
        if _n(b.get("name")) == "goals over/under":
            for v in b.get("values", []):
                label = str(v.get("value", "")).strip()
                if label == "Over 1.5": res["odd_o15"] = v.get("odd", "")
                elif label == "Under 1.5": res["odd_u15"] = v.get("odd", "")
                elif label == "Over 2.5": res["odd_o25"] = v.get("odd", "")
                elif label == "Under 2.5": res["odd_u25"] = v.get("odd", "")
                elif label == "Over 3.5": res["odd_o35"] = v.get("odd", "")
                elif label == "Under 3.5": res["odd_u35"] = v.get("odd", "")

    for b in bets:
        n = _n(b.get("name"))
        if "double chance" in n or "chance double" in n:
            for v in b.get("values", []):
                val = _n(v.get("value")).replace(" ", "")
                if val in {"home/draw", "homedraw", "1x"}:
                    res["odd_1x"] = v.get("odd", "")
                elif val in {"draw/away", "drawaway", "x2"}:
                    res["odd_x2"] = v.get("odd", "")
                elif val in {"home/away", "homeaway", "12"}:
                    res["odd_12"] = v.get("odd", "")

    for b in bets:
        n = _n(b.get("name"))
        if ("both" in n and "team" in n and "score" in n) or "btts" in n:
            for v in b.get("values", []):
                val = _n(v.get("value"))
                if val in {"yes","y","si"}: res["odd_btts_y"] = v.get("odd","")
                elif val in {"no","n"}: res["odd_btts_n"] = v.get("odd","")

    return res


def get_team_stats(league_id, season, team_id):
    if not all([league_id, season, team_id]): return {}
    key = (league_id, season, team_id)
    if key in TEAM_STATS_CACHE: return TEAM_STATS_CACHE[key]
    d = api_request("/teams/statistics", {"league": league_id, "season": season, "team": team_id}, 30)
    ts = (d.get("response") or {}) if isinstance(d, dict) else {}
    TEAM_STATS_CACHE[key] = ts
    time.sleep(0.05)
    return ts


# ==========================
# PROFILE
# ==========================
def profile(ts_raw, side):
    o = {"played": 0, "played_side": 0, "gf_side": 0.0, "ga_side": 0.0,
         "gf_total": 0.0, "ga_total": 0.0, "cs_rate": 0.0, "fts_rate": 0.0, "form": 0}
    if not isinstance(ts_raw, dict) or not ts_raw: return o
    fx = ts_raw.get("fixtures") or {}
    pl = fx.get("played") or {}
    ph, pa = to_float(pl.get("home")) or 0, to_float(pl.get("away")) or 0
    o["played"] = ph + pa
    o["played_side"] = ph if side == "home" else pa
    g = ts_raw.get("goals") or {}
    gf = (g.get("for") or {}).get("average") or {}
    ga = (g.get("against") or {}).get("average") or {}
    o["gf_side"] = to_float(gf.get(side)) or 0.0
    o["ga_side"] = to_float(ga.get(side)) or 0.0
    o["gf_total"] = to_float(gf.get("total")) or 0.0
    o["ga_total"] = to_float(ga.get("total")) or 0.0
    cs = ts_raw.get("clean_sheet") or {}
    fts = ts_raw.get("failed_to_score") or {}
    sp = o["played_side"] or 1
    o["cs_rate"] = safe_div(to_float(cs.get(side)) or 0, sp)
    o["fts_rate"] = safe_div(to_float(fts.get(side)) or 0, sp)
    fm = (ts_raw.get("form") or "").upper()[-5:]
    o["form"] = sum(3 if c == "W" else 1 if c == "D" else 0 for c in fm)
    return o


# ==========================
# POISSON
# ==========================
def poi(k, lam):
    if lam is None or lam <= 0: return 0.0
    return math.exp(-lam) * (lam ** k) / math.factorial(k)

def p_over(lam, thr):
    if lam <= 0: return 0.0
    return max(0.0, 1.0 - sum(poi(k, lam) for k in range(thr)))

def grid(lh, la, mx=7):
    return {(h, a): poi(h, lh) * poi(a, la) for h in range(mx+1) for a in range(mx+1)}


# ==========================
# PREDICTION ENGINE — ALL 3 MARKETS
# ==========================
def predict_all(hp, ap, pred, odds, home_name, away_name, h_sb=None, a_sb=None, h_crn=None, a_crn=None, h2h_c=None,
                h_cards=None, a_cards=None, h2h_y=None, ref_cards=None, h_recent=None, a_recent=None):
    """
    Returns dict with ALL markets:
    Over/Under 2.5, Over 3.5, BTTS, No Goal, O2.5+BTTS combo, Corners, Yellows.
    """
    h_sb = h_sb or {}
    a_sb = a_sb or {}
    h_crn = h_crn or {}
    a_crn = a_crn or {}
    h_cards = h_cards or {}
    a_cards = a_cards or {}
    h_recent = h_recent or []
    a_recent = a_recent or []

    # --- BUILD LAMBDAS ---
    gh = to_float(pred.get("goals_home")) or 0.0
    ga = to_float(pred.get("goals_away")) or 0.0

    vh, va = [], []
    if gh > 0: vh.append(gh)
    if ga > 0: va.append(ga)
    if hp["gf_side"] > 0: vh.append(hp["gf_side"])
    if ap["ga_side"] > 0: vh.append(ap["ga_side"])
    if ap["gf_side"] > 0: va.append(ap["gf_side"])
    if hp["ga_side"] > 0: va.append(hp["ga_side"])
    if not vh and hp["gf_total"] > 0: vh.append(hp["gf_total"])
    if not va and ap["gf_total"] > 0: va.append(ap["gf_total"])

    lam_h = sum(vh) / len(vh) if vh else 1.2
    lam_a = sum(va) / len(va) if va else 1.0
    lam_t = lam_h + lam_a

    # --- POISSON BASE PROBABILITIES ---
    p_h_scores = 1.0 - math.exp(-lam_h) if lam_h > 0 else 0.0
    p_a_scores = 1.0 - math.exp(-lam_a) if lam_a > 0 else 0.0
    p_h_zero = 1.0 - p_h_scores  # home fails to score
    p_a_zero = 1.0 - p_a_scores  # away fails to score

    p_over15_poi = p_over(lam_t, 2)
    p_over25_poi = p_over(lam_t, 3)
    p_btts_poi = p_h_scores * p_a_scores
    g = grid(lam_h, lam_a)
    p_home_win_poi = sum(p for (h, a), p in g.items() if h > a)
    p_draw_poi = sum(p for (h, a), p in g.items() if h == a)
    p_away_win_poi = sum(p for (h, a), p in g.items() if h < a)
    p_one_x_poi = p_home_win_poi + p_draw_poi
    p_x_two_poi = p_draw_poi + p_away_win_poi

    # --- MARKET IMPLIED (vig-removed) ---
    o_o15 = to_float(odds.get("odd_o15"))
    o_u15 = to_float(odds.get("odd_u15"))
    o_o25 = to_float(odds.get("odd_o25"))
    o_u25 = to_float(odds.get("odd_u25"))
    o_o35 = to_float(odds.get("odd_o35"))
    o_u35 = to_float(odds.get("odd_u35"))
    o_by = to_float(odds.get("odd_btts_y"))
    o_bn = to_float(odds.get("odd_btts_n"))
    o_h = to_float(odds.get("odd_home"))
    o_d = to_float(odds.get("odd_draw"))
    o_a = to_float(odds.get("odd_away"))
    o_1x = to_float(odds.get("odd_1x"))
    o_x2 = to_float(odds.get("odd_x2"))

    def vig_free(o1, o2):
        if o1 and o2 and o1 > 1 and o2 > 1:
            i1, i2 = 1.0/o1, 1.0/o2
            t = i1 + i2
            return (i1/t, i2/t) if t > 0 else (0.5, 0.5)
        return None, None

    def vig_free_three(o1, o2, o3):
        vals = [o1, o2, o3]
        if all(v and v > 1 for v in vals):
            inv = [1.0 / v for v in vals]
            total = sum(inv)
            if total > 0:
                return tuple(v / total for v in inv)
        return (None, None, None)

    mkt_over15, mkt_under15 = vig_free(o_o15, o_u15)
    mkt_over, mkt_under = vig_free(o_o25, o_u25)
    mkt_over35, mkt_under35 = vig_free(o_o35, o_u35)
    mkt_btts_y, mkt_btts_n = vig_free(o_by, o_bn)
    mkt_home, mkt_draw, mkt_away = vig_free_three(o_h, o_d, o_a)

    api_home = normalize_percent(pred.get("prob_home"))
    api_draw = normalize_percent(pred.get("prob_draw"))
    api_away = normalize_percent(pred.get("prob_away"))
    api_one_x = None if api_home is None or api_draw is None else api_home + api_draw
    api_x_two = None if api_draw is None or api_away is None else api_draw + api_away

    # ============================================================
    # 1) OVER / UNDER 1.5
    # ============================================================
    ou15_signals = [("Poisson", p_over15_poi, 0.55)]

    if mkt_over15 is not None:
        ou15_signals.append(("Market", mkt_over15, 0.25))

    attack_total = hp["gf_side"] + ap["ga_side"] + ap["gf_side"] + hp["ga_side"]
    if hp["played"] >= 3 and ap["played"] >= 3:
        p_prof15 = clamp_prob((attack_total - 0.7) / 2.5, 0.20, 0.94)
        p_prof15 -= ((hp["fts_rate"] + ap["fts_rate"]) / 2.0) * 0.16
        ou15_signals.append(("Profile", clamp_prob(p_prof15, 0.15, 0.94), 0.10))

    if gh > 0 and ga > 0:
        goals_hint = gh + ga
        p_api15 = clamp_prob((goals_hint - 0.8) / 2.0, 0.20, 0.92)
        ou15_signals.append(("API goals", p_api15, 0.10))

    tw15 = sum(w for _, _, w in ou15_signals)
    p_over15 = sum(p * w for _, p, w in ou15_signals) / tw15 if tw15 > 0 else 0.65
    p_over15 = nudge_prob(p_over15, factor=1.05, low=0.12, high=0.975)
    p_under15 = 1.0 - p_over15

    # ============================================================
    # 2) OVER / UNDER 2.5
    # ============================================================
    ou_signals = []

    # Poisson (0.30)
    ou_signals.append(("Poisson", p_over25_poi, 0.30))

    # Market (0.25)
    if mkt_over is not None:
        ou_signals.append(("Market", mkt_over, 0.25))

    # Attack/defense profile (0.20)
    if hp["played"] >= 3 and ap["played"] >= 3:
        p_prof = max(0.05, min(0.95, (attack_total - 1.5) / 3.0))
        cs_pen = (hp["cs_rate"] + ap["cs_rate"]) / 2.0
        fts_pen = (hp["fts_rate"] + ap["fts_rate"]) / 2.0
        p_prof -= cs_pen * 0.15 + fts_pen * 0.10
        p_prof = max(0.05, min(0.95, p_prof))
        ou_signals.append(("Profile", p_prof, 0.20))

    # BTTS proxy (0.10)
    btts_proxy = p_btts_poi * 0.85
    if mkt_btts_y is not None:
        btts_proxy = (p_btts_poi * 0.5 + mkt_btts_y * 0.5) * 0.85
    ou_signals.append(("BTTS proxy", btts_proxy, 0.10))

    # API advice (0.08)
    adv = str(pred.get("advice") or "").lower()
    uo = str(pred.get("under_over") or "").strip()
    p_adv = 0.50
    if uo:
        try:
            v = float(uo.replace("+","").replace("-",""))
            if v >= 3.5: p_adv = 0.80
            elif v >= 2.5: p_adv = 0.65
            elif v <= 1.5: p_adv = 0.20
            elif "-" in uo: p_adv = 0.35
        except:
            if "over" in uo.lower(): p_adv = 0.65
            elif "under" in uo.lower(): p_adv = 0.35
    if "over" in adv: p_adv = max(p_adv, 0.62)
    elif "under" in adv: p_adv = min(p_adv, 0.38)
    ou_signals.append(("API advice", p_adv, 0.08))

    # Form (0.07)
    cf = (hp["form"] + ap["form"]) / 2.0
    ff = max(0.0, min(1.0, (cf - 3.0) / 9.0))
    p_form = 0.35 + ff * 0.35
    ou_signals.append(("Form", p_form, 0.07))

    tw = sum(w for _, _, w in ou_signals)
    p_over25 = sum(p * w for _, p, w in ou_signals) / tw if tw > 0 else 0.50
    p_over25 = nudge_prob(p_over25, factor=1.05, low=0.05, high=0.955)
    p_under25 = 1.0 - p_over25

    # ============================================================
    # 3) BTTS YES / NO
    # ============================================================
    btts_signals = []

    # Poisson (0.30)
    btts_signals.append(("Poisson", p_btts_poi, 0.30))

    # Market (0.25)
    if mkt_btts_y is not None:
        btts_signals.append(("Market", mkt_btts_y, 0.25))

    # CS/FTS profile (0.20)
    if hp["played"] >= 3 and ap["played"] >= 3:
        bp = ((1.0 - min(hp["cs_rate"], 1.0)) * (1.0 - min(ap["cs_rate"], 1.0)) *
              (1.0 - min(hp["fts_rate"], 1.0)) * (1.0 - min(ap["fts_rate"], 1.0)))
        bp = max(0.10, min(0.90, bp))
        btts_signals.append(("CS/FTS", bp, 0.20))

    # API predicted goals (0.15)
    if gh > 0 and ga > 0:
        mn = min(gh, ga)
        if mn >= 1.5: p_api_b = 0.75
        elif mn >= 1.0: p_api_b = 0.62
        elif mn >= 0.7: p_api_b = 0.50
        elif mn >= 0.4: p_api_b = 0.35
        else: p_api_b = 0.22
        btts_signals.append(("API goals", p_api_b, 0.15))

    # Attack balance (0.10)
    ha = hp["gf_side"] if hp["gf_side"] > 0 else hp["gf_total"]
    aa = ap["gf_side"] if ap["gf_side"] > 0 else ap["gf_total"]
    if ha > 0 and aa > 0:
        bal = min(ha, aa) / max(ha, aa)
        ml = min(ha, aa)
        p_atk = max(0.15, min(0.80, 0.30 + bal * 0.25 + ml * 0.15))
        btts_signals.append(("Attack bal.", p_atk, 0.10))

    tw2 = sum(w for _, _, w in btts_signals)
    p_btts = sum(p * w for _, p, w in btts_signals) / tw2 if tw2 > 0 else 0.50
    p_btts = nudge_prob(p_btts, factor=1.045, low=0.08, high=0.925)
    p_btts_no = 1.0 - p_btts

    # ============================================================
    # 3) NO GOAL — quale squadra non segna
    # ============================================================
    # P(home blanked) = blend of Poisson + away CS rate + home FTS rate
    if hp["played"] >= 3 and ap["played"] >= 3:
        p_home_blanked = p_h_zero * 0.40 + ap["cs_rate"] * 0.30 + hp["fts_rate"] * 0.30
        p_away_blanked = p_a_zero * 0.40 + hp["cs_rate"] * 0.30 + ap["fts_rate"] * 0.30
    else:
        p_home_blanked = p_h_zero
        p_away_blanked = p_a_zero

    # Market blend for nogol
    if mkt_btts_n is not None:
        p_nogol_model = 1.0 - (1.0 - p_home_blanked) * (1.0 - p_away_blanked)
        p_nogol = p_nogol_model * 0.65 + mkt_btts_n * 0.35
    else:
        p_nogol = 1.0 - (1.0 - p_home_blanked) * (1.0 - p_away_blanked)

    # Favorite boost: strong fav → more likely to blank opponent
    if o_h and o_a and o_h > 1 and o_a > 1:
        if to_float(o_h) < 1.40: p_away_blanked = min(0.90, p_away_blanked + 0.05)
        if to_float(o_a) < 1.40: p_home_blanked = min(0.90, p_home_blanked + 0.05)

    # API: if predicted < 0.5 goals for a team
    if gh > 0 and gh < 0.5: p_home_blanked = min(0.90, p_home_blanked + 0.08)
    if ga > 0 and ga < 0.5: p_away_blanked = min(0.90, p_away_blanked + 0.08)

    p_home_blanked = clamp_prob(p_home_blanked, 0.05, 0.90)
    p_away_blanked = clamp_prob(p_away_blanked, 0.05, 0.90)
    p_nogol = nudge_prob(p_nogol, factor=1.04, low=0.10, high=0.91)
    p_both_score = 1.0 - p_nogol

    # Score grid
    ml = sorted(g.items(), key=lambda x: x[1], reverse=True)[:5]
    p_00 = g.get((0, 0), 0)

    # ============================================================
    # 4) OVER / UNDER 3.5
    # ============================================================
    over35_signals = [("Poisson", p_over(lam_t, 4), 0.58)]
    if mkt_over35 is not None:
        over35_signals.append(("Market", mkt_over35, 0.25))
    if gh > 0 and ga > 0:
        p_api35 = clamp_prob(((gh + ga) - 2.1) / 2.4, 0.10, 0.82)
        over35_signals.append(("API goals", p_api35, 0.10))
    over35_signals.append(("OU bridge", clamp_prob((p_over25 - 0.35) / 0.75, 0.08, 0.90), 0.07))
    tw35 = sum(w for _, _, w in over35_signals)
    p_over35 = sum(p * w for _, p, w in over35_signals) / tw35 if tw35 > 0 else p_over(lam_t, 4)
    p_over35 = nudge_prob(p_over35, factor=1.04, low=0.04, high=0.89)
    p_under35 = 1.0 - p_over35

    # ============================================================
    # 5) DOUBLE CHANCE 1X / X2
    # ============================================================
    fav_home_bias = clamp_prob(0.50 + (lam_h - lam_a) * 0.10 + (hp["form"] - ap["form"]) * 0.015, 0.12, 0.88)
    fav_away_bias = clamp_prob(0.50 + (lam_a - lam_h) * 0.10 + (ap["form"] - hp["form"]) * 0.015, 0.12, 0.88)

    dc_one_x_signals = [("Poisson", p_one_x_poi, 0.38)]
    dc_x_two_signals = [("Poisson", p_x_two_poi, 0.38)]
    if mkt_home is not None and mkt_draw is not None:
        dc_one_x_signals.append(("1X2 market", clamp_prob(mkt_home + mkt_draw, 0.20, 0.94), 0.27))
    if mkt_draw is not None and mkt_away is not None:
        dc_x_two_signals.append(("1X2 market", clamp_prob(mkt_draw + mkt_away, 0.20, 0.94), 0.27))
    if api_one_x is not None:
        dc_one_x_signals.append(("API", clamp_prob(api_one_x, 0.20, 0.94), 0.25))
    if api_x_two is not None:
        dc_x_two_signals.append(("API", clamp_prob(api_x_two, 0.20, 0.94), 0.25))
    dc_one_x_signals.append(("Bias", fav_home_bias, 0.10))
    dc_x_two_signals.append(("Bias", fav_away_bias, 0.10))

    tw1x = sum(w for _, _, w in dc_one_x_signals)
    twx2 = sum(w for _, _, w in dc_x_two_signals)
    p_1x = sum(p * w for _, p, w in dc_one_x_signals) / tw1x if tw1x > 0 else p_one_x_poi
    p_x2 = sum(p * w for _, p, w in dc_x_two_signals) / twx2 if twx2 > 0 else p_x_two_poi
    p_1x = nudge_prob(p_1x, factor=1.05, low=0.18, high=0.97)
    p_x2 = nudge_prob(p_x2, factor=1.05, low=0.18, high=0.97)

    # ============================================================
    # 6) COMBO: Over 2.5 + BTTS YES
    # P(O2.5 ∩ BTTS) = P(total≥3 AND both score)
    # Calculated from score grid directly (exact, not approximated)
    # ============================================================
    p_o25_btts = 0.0
    for (h, a), p in g.items():
        if (h + a) >= 3 and h >= 1 and a >= 1:
            p_o25_btts += p

    # ============================================================
    # 6) CORNERS — blended from season, recent matches and H2H
    # Uses Supabase corner_team_stats + match_team_stats + team_season_stats
    # ============================================================
    h_season_corners = season_corners_avg(h_sb) or 0.0
    a_season_corners = season_corners_avg(a_sb) or 0.0
    h_cpg_home = side_metric_avg(h_crn, "corners", "home", against=False) or h_season_corners or 0.0
    a_cpg_away = side_metric_avg(a_crn, "corners", "away", against=False) or a_season_corners or 0.0
    h_cpg_against = side_metric_avg(h_crn, "corners", "home", against=True) or 0.0
    a_cpg_against = side_metric_avg(a_crn, "corners", "away", against=True) or 0.0
    h_recent_corners_for = recent_metric_mean(h_recent, "corners_for") or 0.0
    a_recent_corners_for = recent_metric_mean(a_recent, "corners_for") or 0.0
    h_recent_corners_against = recent_metric_mean(h_recent, "corners_against") or 0.0
    a_recent_corners_against = recent_metric_mean(a_recent, "corners_against") or 0.0

    corner_components = []
    if h_cpg_home > 0 and a_cpg_away > 0:
        corner_components.append((h_cpg_home + a_cpg_away, 0.42))
    if h_cpg_against > 0 and a_cpg_against > 0:
        corner_components.append((h_cpg_against + a_cpg_against, 0.16))
    if h_recent_corners_for > 0 and a_recent_corners_for > 0:
        corner_components.append((h_recent_corners_for + a_recent_corners_for, 0.18))
    if h_recent_corners_against > 0 and a_recent_corners_against > 0:
        corner_components.append((h_recent_corners_against + a_recent_corners_against, 0.10))
    if h_season_corners > 0 and a_season_corners > 0:
        corner_components.append((h_season_corners + a_season_corners, 0.14))
    total_corner_weight = sum(weight for _, weight in corner_components)
    exp_corners = (sum(value * weight for value, weight in corner_components) / total_corner_weight) if total_corner_weight > 0 else 0.0

    h_shots = recent_metric_mean(h_recent, "shots_for") or season_shots_avg(h_sb) or 0.0
    a_shots = recent_metric_mean(a_recent, "shots_for") or season_shots_avg(a_sb) or 0.0
    shots_total = h_shots + a_shots
    if shots_total >= 29:
        exp_corners += 0.6
    elif shots_total >= 25:
        exp_corners += 0.3
    elif 0 < shots_total <= 17:
        exp_corners -= 0.2

    if h2h_c and exp_corners > 0:
        exp_corners = exp_corners * 0.80 + h2h_c * 0.20
    if exp_corners > 0:
        exp_corners = max(4.0, min(16.0, exp_corners))

    # Corner over probabilities using normal approximation (std ≈ 3.0 for corners)
    corner_std = 3.0
    corner_overs = {}
    for line in half_lines(6.5, 13.5):
        if exp_corners > 0:
            z = (line - exp_corners) / corner_std
            p_c_over = 1.0 - 0.5 * (1.0 + math.erf(z / math.sqrt(2)))
            corner_overs[str(line)] = round(max(0.02, min(0.98, p_c_over)), 4)
        else:
            corner_overs[str(line)] = None

    # ============================================================
    # 7) YELLOWS — blended from cards tables, recent matches and referee
    # Uses cards_team_stats + cards_match_stats + cards_referee_stats + match_team_stats
    # ============================================================
    h_yel = season_yellows_avg(h_sb) or 0.0
    a_yel = season_yellows_avg(a_sb) or 0.0
    h_cards_home = side_metric_avg(h_cards, "cards", "home", against=False) or h_yel or 0.0
    a_cards_away = side_metric_avg(a_cards, "cards", "away", against=False) or a_yel or 0.0
    h_cards_against = side_metric_avg(h_cards, "cards", "home", against=True) or 0.0
    a_cards_against = side_metric_avg(a_cards, "cards", "away", against=True) or 0.0
    h_recent_cards = recent_metric_mean(h_recent, "cards_for") or 0.0
    a_recent_cards = recent_metric_mean(a_recent, "cards_for") or 0.0

    yellow_components = []
    if h_cards_home > 0 and a_cards_away > 0:
        yellow_components.append((h_cards_home + a_cards_away, 0.44))
    if h_recent_cards > 0 and a_recent_cards > 0:
        yellow_components.append((h_recent_cards + a_recent_cards, 0.22))
    if h_yel > 0 and a_yel > 0:
        yellow_components.append((h_yel + a_yel, 0.18))
    if h_cards_against > 0 and a_cards_against > 0:
        yellow_components.append((h_cards_against + a_cards_against, 0.08))
    total_yellow_weight = sum(weight for _, weight in yellow_components)
    exp_yellows = (sum(value * weight for value, weight in yellow_components) / total_yellow_weight) if total_yellow_weight > 0 else 0.0

    h_fouls = recent_metric_mean(h_recent, "fouls_for") or season_fouls_avg(h_sb) or 0.0
    a_fouls = recent_metric_mean(a_recent, "fouls_for") or season_fouls_avg(a_sb) or 0.0
    fouls_total = h_fouls + a_fouls
    if fouls_total >= 29:
        exp_yellows += 0.45
    elif fouls_total >= 24:
        exp_yellows += 0.22
    elif 0 < fouls_total <= 18:
        exp_yellows -= 0.12

    if h2h_y and exp_yellows > 0:
        exp_yellows = exp_yellows * 0.82 + h2h_y * 0.18
    if ref_cards and ref_cards > 0:
        exp_yellows = (exp_yellows * 0.72 + ref_cards * 0.28) if exp_yellows > 0 else ref_cards
    if exp_yellows > 0:
        exp_yellows = max(1.5, min(7.2, exp_yellows))

    # Yellow over probabilities using Poisson
    yellow_overs = {}
    for line in half_lines(1.5, 5.5):
        line_int = int(math.floor(line))
        if exp_yellows > 0:
            p_y_over = p_over(exp_yellows, line_int + 1)
            yellow_overs[str(line)] = round(max(0.02, min(0.98, p_y_over)), 4)
        else:
            yellow_overs[str(line)] = None

    return {
        # Over/Under 1.5
        "p_over15": round(p_over15, 4),
        "p_under15": round(p_under15, 4),
        "ou15_pick": "Over 1.5" if p_over15 >= 0.50 else "Under 1.5",
        "ou15_conf": round(max(p_over15, p_under15), 4),
        "odd_o15": o_o15, "odd_u15": o_u15,

        # Over/Under 2.5
        "p_over25": round(p_over25, 4),
        "p_under25": round(p_under25, 4),
        "ou_pick": "Over 2.5" if p_over25 >= 0.50 else "Under 2.5",
        "ou_conf": round(max(p_over25, p_under25), 4),
        "odd_o25": o_o25, "odd_u25": o_u25,

        # Over/Under 3.5
        "p_over35": round(p_over35, 4),
        "p_under35": round(p_under35, 4),
        "ou35_pick": "Over 3.5" if p_over35 >= 0.50 else "Under 3.5",
        "ou35_conf": round(max(p_over35, p_under35), 4),
        "odd_o35": o_o35, "odd_u35": o_u35,

        # BTTS
        "p_btts_yes": round(p_btts, 4),
        "p_btts_no": round(p_btts_no, 4),
        "btts_pick": "BTTS YES" if p_btts >= 0.50 else "BTTS NO",
        "btts_conf": round(max(p_btts, p_btts_no), 4),
        "odd_btts_y": o_by, "odd_btts_n": o_bn,

        # Double chance
        "p_1x": round(p_1x, 4),
        "p_x2": round(p_x2, 4),
        "dc_pick": "1X" if p_1x >= p_x2 else "X2",
        "dc_conf": round(max(p_1x, p_x2), 4),
        "odd_1x": o_1x,
        "odd_x2": o_x2,

        # Combo Over 2.5 + BTTS
        "p_o25_btts": round(p_o25_btts, 4),

        # No Goal
        "p_nogol": round(p_nogol, 4),
        "p_both_score": round(p_both_score, 4),
        "p_home_blanked": round(p_home_blanked, 4),
        "p_away_blanked": round(p_away_blanked, 4),
        "nogol_team": home_name if p_home_blanked > p_away_blanked else away_name,
        "nogol_side": "home" if p_home_blanked > p_away_blanked else "away",
        "p_00": round(p_00, 4),

        # Corners
        "exp_corners": round(exp_corners, 1) if exp_corners > 0 else None,
        "corner_overs": corner_overs,

        # Yellows
        "exp_yellows": round(exp_yellows, 1) if exp_yellows > 0 else None,
        "yellow_overs": yellow_overs,

        # Shared
        "lam_home": round(lam_h, 3), "lam_away": round(lam_a, 3), "lam_total": round(lam_t, 3),
        "most_likely_scores": [(f"{h}-{a}", round(p * 100, 1)) for (h, a), p in ml],
    }


# ==========================
# PIPELINE
# ==========================
def run(target_date=None, time_min="00:00", time_max="23:59", emit_json=True):
    target = target_date or today_local_str()
    print(f"\n{'='*70}", file=sys.stderr)
    print(f"  MATCH PREDICTOR — Goals / BTTS / Corners / Yellows", file=sys.stderr)
    print(f"  Date: {target} | Orario: {time_min} - {time_max}", file=sys.stderr)
    print(f"{'='*70}\n", file=sys.stderr)

    fixtures = get_all_fixtures(target, time_min, time_max)
    if not fixtures:
        print("# Nessuna partita trovata.", file=sys.stderr)
        output = {"date": target, "time_range": f"{time_min}-{time_max}", "generated_at": datetime.now(TZ).isoformat(), "total_matches": 0, "matches": []}
        if emit_json:
            print(json.dumps(output, indent=2, ensure_ascii=False))
        return output

    results = []
    total = len(fixtures)

    for idx, f in enumerate(fixtures, 1):
        fx = f.get("fixture", {}) or {}
        league = f.get("league", {}) or {}
        teams = f.get("teams", {}) or {}

        fid = fx.get("id")
        lid = league.get("id")
        season = league.get("season")
        ht = teams.get("home", {}) or {}
        at = teams.get("away", {}) or {}
        hn, an = ht.get("name", "?"), at.get("name", "?")
        hid, aid = ht.get("id"), at.get("id")
        dateiso = fx.get("date", "") or ""
        mtime = dateiso[11:16] if len(dateiso) >= 16 else ""
        lname = league.get("name", "")
        country = league.get("country", "")
        referee = str(fx.get("referee") or "").strip()

        if idx % 20 == 0 or idx == 1:
            print(f"# Progresso: {idx}/{total}...", file=sys.stderr)

        pred = get_prediction(fid)
        odds = get_odds(fid)
        h_ts = get_team_stats(lid, season, hid)
        a_ts = get_team_stats(lid, season, aid)
        hp_ = profile(h_ts, "home")
        ap_ = profile(a_ts, "away")

        # Supabase: domestic stats (richer sample than European-only)
        h_sb = sb_team_stats(hid) if hid else {}
        a_sb = sb_team_stats(aid) if aid else {}
        h_crn = sb_corner_stats(hid, lid) if hid else {}
        a_crn = sb_corner_stats(aid, lid) if aid else {}
        h2h_c = sb_corner_h2h(hid, aid) if (hid and aid) else None
        h_cards = sb_cards_team_stats(hid, lid) if hid else {}
        a_cards = sb_cards_team_stats(aid, lid) if aid else {}
        h2h_y = sb_cards_h2h(hid, aid) if (hid and aid) else None
        ref_cards = sb_referee_cards(referee, lid) if referee else None
        h_recent = sb_recent_match_team_stats(hid, lid) if hid else []
        a_recent = sb_recent_match_team_stats(aid, lid) if aid else []

        result = predict_all(hp_, ap_, pred, odds, hn, an,
                             h_sb=h_sb, a_sb=a_sb, h_crn=h_crn, a_crn=a_crn, h2h_c=h2h_c,
                             h_cards=h_cards, a_cards=a_cards, h2h_y=h2h_y, ref_cards=ref_cards,
                             h_recent=h_recent, a_recent=a_recent)

        results.append({
            "fixture_id": fid, "date": target, "league": lname, "country": country,
            "match_time": mtime, "home": hn, "away": an,
            "home_logo": ht.get("logo", ""), "away_logo": at.get("logo", ""),
            "league_logo": league.get("logo", ""),
            "status_short": str((fx.get("status") or {}).get("short", "")).upper(),
            "status_long": str((fx.get("status") or {}).get("long", "")).strip(),
            "goals_home": f.get("goals", {}).get("home"),
            "goals_away": f.get("goals", {}).get("away"),
            "total_corners": None,
            "total_yellows": None,
            "final_score": (
                f"{f.get('goals', {}).get('home')}-{f.get('goals', {}).get('away')}"
                if f.get("goals", {}).get("home") is not None and f.get("goals", {}).get("away") is not None
                else ""
            ),
            **result,
        })

    # ============================================================
    # OUTPUT
    # ============================================================
    # Group by league
    leagues = {}
    for r in results:
        k = f"{r['country']} - {r['league']}"
        leagues.setdefault(k, []).append(r)

    print(f"\n{'='*70}", file=sys.stderr)
    print(f"  RISULTATI — {target} ({time_min}-{time_max})", file=sys.stderr)
    print(f"  Partite analizzate: {len(results)}", file=sys.stderr)
    print(f"{'='*70}", file=sys.stderr)

    for lkey in sorted(leagues.keys()):
        lr = leagues[lkey]
        print(f"\n  ━━━ {lkey} ({len(lr)}) ━━━", file=sys.stderr)

        for r in lr:
            print(f"\n  [{r['match_time']}] {r['home']} vs {r['away']}", file=sys.stderr)
            ou15_odds = ""
            if r["odd_o15"]: ou15_odds = f" [O@{r['odd_o15']} U@{r.get('odd_u15','?')}]"
            print(f"    Over 1.5: {r['p_over15']*100:.1f}%  |  Under 1.5: {r['p_under15']*100:.1f}%{ou15_odds}", file=sys.stderr)

            # Over/Under
            ou_e = "🟢" if r["ou_pick"] == "Over 2.5" else "🔴"
            ou_odds = ""
            if r["odd_o25"]: ou_odds = f" [O@{r['odd_o25']} U@{r.get('odd_u25','?')}]"
            print(f"    {ou_e} Over 2.5: {r['p_over25']*100:.1f}%  |  Under 2.5: {r['p_under25']*100:.1f}%{ou_odds}", file=sys.stderr)
            ou35_odds = ""
            if r["odd_u35"] or r["odd_o35"]: ou35_odds = f" [O@{r.get('odd_o35','?')} U@{r.get('odd_u35','?')}]"
            print(f"       Over 3.5: {r['p_over35']*100:.1f}%  |  Under 3.5: {r['p_under35']*100:.1f}%{ou35_odds}", file=sys.stderr)
            dc_odds = ""
            if r["odd_1x"] or r["odd_x2"]: dc_odds = f" [1X@{r.get('odd_1x','?')} X2@{r.get('odd_x2','?')}]"
            print(f"    1X: {r['p_1x']*100:.1f}%  |  X2: {r['p_x2']*100:.1f}%{dc_odds}", file=sys.stderr)

            # BTTS
            bt_e = "✅" if r["btts_pick"] == "BTTS YES" else "❌"
            bt_odds = ""
            if r["odd_btts_y"]: bt_odds = f" [Y@{r['odd_btts_y']} N@{r.get('odd_btts_n','?')}]"
            print(f"    {bt_e} BTTS YES: {r['p_btts_yes']*100:.1f}%  |  BTTS NO: {r['p_btts_no']*100:.1f}%{bt_odds}", file=sys.stderr)

            # Combo
            print(f"    🔗 Over 2.5 + BTTS: {r['p_o25_btts']*100:.1f}%", file=sys.stderr)

            # No Goal
            print(f"    🚫 {r['home']} non segna: {r['p_home_blanked']*100:.1f}%  |  {r['away']} non segna: {r['p_away_blanked']*100:.1f}%", file=sys.stderr)
            print(f"       No Goal: {r['p_nogol']*100:.1f}%  |  0-0: {r['p_00']*100:.1f}%", file=sys.stderr)

            # Corners
            if r.get("exp_corners"):
                co = r["corner_overs"]
                c_parts = [f"O{k}: {v*100:.0f}%" for k, v in co.items() if v is not None]
                print(f"    📐 Corner exp: {r['exp_corners']:.1f}  |  {' | '.join(c_parts)}", file=sys.stderr)

            # Yellows
            if r.get("exp_yellows"):
                yo = r["yellow_overs"]
                y_parts = [f"O{k}: {v*100:.0f}%" for k, v in yo.items() if v is not None]
                print(f"    🟨 Ammonizioni exp: {r['exp_yellows']:.1f}  |  {' | '.join(y_parts)}", file=sys.stderr)

            # Score
            scores = ", ".join(f"{s} ({p}%)" for s, p in r["most_likely_scores"][:3])
            print(f"    📊 Score: {scores}  |  λ {r['lam_home']:.2f}-{r['lam_away']:.2f}", file=sys.stderr)

    # ============================================================
    # BEST PICKS SUMMARY
    # ============================================================
    print(f"\n{'='*70}", file=sys.stderr)
    print(f"  ⭐ MIGLIORI PICK (confidence ≥ 60%)", file=sys.stderr)
    print(f"{'='*70}", file=sys.stderr)

    # Best Over 1.5
    best_over15 = sorted([r for r in results if r["p_over15"] >= 0.72], key=lambda x: x["p_over15"], reverse=True)
    if best_over15:
        print(f"\n  OVER 1.5:", file=sys.stderr)
        for r in best_over15[:8]:
            o = f" @{r['odd_o15']}" if r['odd_o15'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_over15']*100:.1f}%{o} - {r['country']}/{r['league']}", file=sys.stderr)

    # Best Over 2.5
    best_over = sorted([r for r in results if r["p_over25"] >= 0.60], key=lambda x: x["p_over25"], reverse=True)
    if best_over:
        print(f"\n  🟢 OVER 2.5:", file=sys.stderr)
        for r in best_over[:8]:
            o = f" @{r['odd_o25']}" if r['odd_o25'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_over25']*100:.1f}%{o} — {r['country']}/{r['league']}", file=sys.stderr)

    # Best Under 2.5
    best_under = sorted([r for r in results if r["p_under25"] >= 0.60], key=lambda x: x["p_under25"], reverse=True)
    if best_under:
        print(f"\n  🔴 UNDER 2.5:", file=sys.stderr)
        for r in best_under[:8]:
            o = f" @{r['odd_u25']}" if r['odd_u25'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_under25']*100:.1f}%{o} — {r['country']}/{r['league']}", file=sys.stderr)

    # Best Under 3.5
    best_under35 = sorted([r for r in results if r["p_under35"] >= 0.68], key=lambda x: x["p_under35"], reverse=True)
    if best_under35:
        print(f"\n  UNDER 3.5:", file=sys.stderr)
        for r in best_under35[:8]:
            o = f" @{r['odd_u35']}" if r['odd_u35'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_under35']*100:.1f}%{o} - {r['country']}/{r['league']}", file=sys.stderr)

    # Best 1X
    best_1x = sorted([r for r in results if r["p_1x"] >= 0.68], key=lambda x: x["p_1x"], reverse=True)
    if best_1x:
        print(f"\n  DOUBLE CHANCE 1X:", file=sys.stderr)
        for r in best_1x[:8]:
            o = f" @{r['odd_1x']}" if r['odd_1x'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_1x']*100:.1f}%{o} - {r['country']}/{r['league']}", file=sys.stderr)

    # Best X2
    best_x2 = sorted([r for r in results if r["p_x2"] >= 0.68], key=lambda x: x["p_x2"], reverse=True)
    if best_x2:
        print(f"\n  DOUBLE CHANCE X2:", file=sys.stderr)
        for r in best_x2[:8]:
            o = f" @{r['odd_x2']}" if r['odd_x2'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_x2']*100:.1f}%{o} - {r['country']}/{r['league']}", file=sys.stderr)

    # Best BTTS YES
    best_btts = sorted([r for r in results if r["p_btts_yes"] >= 0.60], key=lambda x: x["p_btts_yes"], reverse=True)
    if best_btts:
        print(f"\n  ✅ BTTS YES:", file=sys.stderr)
        for r in best_btts[:8]:
            o = f" @{r['odd_btts_y']}" if r['odd_btts_y'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_btts_yes']*100:.1f}%{o} — {r['country']}/{r['league']}", file=sys.stderr)

    # Best BTTS NO
    best_btts_no = sorted([r for r in results if r["p_btts_no"] >= 0.60], key=lambda x: x["p_btts_no"], reverse=True)
    if best_btts_no:
        print(f"\n  ❌ BTTS NO:", file=sys.stderr)
        for r in best_btts_no[:8]:
            o = f" @{r['odd_btts_n']}" if r['odd_btts_n'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_btts_no']*100:.1f}%{o} — {r['country']}/{r['league']}", file=sys.stderr)

    # Best No Goal
    best_nogol = sorted([r for r in results if r["p_nogol"] >= 0.55], key=lambda x: x["p_nogol"], reverse=True)
    if best_nogol:
        print(f"\n  🚫 NO GOAL (una non segna):", file=sys.stderr)
        for r in best_nogol[:8]:
            blanked = r["nogol_team"]
            pct = r["p_home_blanked"] if r["nogol_side"] == "home" else r["p_away_blanked"]
            print(f"     {r['home']} vs {r['away']}: {blanked} non segna ({pct*100:.1f}%) — {r['country']}/{r['league']}", file=sys.stderr)

    # Best Over 3.5
    best_o35 = sorted([r for r in results if r["p_over35"] >= 0.35], key=lambda x: x["p_over35"], reverse=True)
    if best_o35:
        print(f"\n  🔥 OVER 3.5:", file=sys.stderr)
        for r in best_o35[:8]:
            o = f" @{r['odd_o35']}" if r['odd_o35'] else ""
            print(f"     {r['home']} vs {r['away']}: {r['p_over35']*100:.1f}%{o} - {r['country']}/{r['league']}", file=sys.stderr)

    # Best Combo O2.5 + BTTS
    best_combo = sorted([r for r in results if r["p_o25_btts"] >= 0.30], key=lambda x: x["p_o25_btts"], reverse=True)
    if best_combo:
        print(f"\n  🔗 OVER 2.5 + BTTS:", file=sys.stderr)
        for r in best_combo[:8]:
            print(f"     {r['home']} vs {r['away']}: {r['p_o25_btts']*100:.1f}% — {r['country']}/{r['league']}", file=sys.stderr)

    # Best Corners Over 9.5
    best_corners = sorted(
        [r for r in results if r.get("exp_corners") and r["exp_corners"] > 0],
        key=lambda x: x["exp_corners"], reverse=True
    )
    if best_corners:
        print(f"\n  📐 TOP CORNER (expected più alto):", file=sys.stderr)
        for r in best_corners[:8]:
            co = r["corner_overs"]
            o95 = co.get("9.5")
            o_str = f" | O9.5: {o95*100:.0f}%" if o95 else ""
            print(f"     {r['home']} vs {r['away']}: exp {r['exp_corners']:.1f}{o_str} — {r['country']}/{r['league']}", file=sys.stderr)

    # Best Yellows Over 3.5
    best_yellows = sorted(
        [r for r in results if r.get("exp_yellows") and r["exp_yellows"] > 0],
        key=lambda x: x["exp_yellows"], reverse=True
    )
    if best_yellows:
        print(f"\n  🟨 TOP AMMONIZIONI (expected più alto):", file=sys.stderr)
        for r in best_yellows[:8]:
            yo = r["yellow_overs"]
            o35 = yo.get("3.5")
            y_str = f" | O3.5: {o35*100:.0f}%" if o35 else ""
            print(f"     {r['home']} vs {r['away']}: exp {r['exp_yellows']:.1f}{y_str} — {r['country']}/{r['league']}", file=sys.stderr)

    # Top 0-0
    top00 = sorted(results, key=lambda x: x["p_00"], reverse=True)[:5]
    if top00 and top00[0]["p_00"] > 0.04:
        print(f"\n  🥶 TOP 0-0:", file=sys.stderr)
        for r in top00:
            print(f"     {r['home']} vs {r['away']}: {r['p_00']*100:.1f}% — {r['country']}/{r['league']}", file=sys.stderr)

    # JSON
    output = {
        "date": target,
        "time_range": f"{time_min}-{time_max}",
        "generated_at": datetime.now(TZ).isoformat(),
        "total_matches": len(results),
        "matches": results,
    }
    if emit_json:
        print("\n" + json.dumps(output, indent=2, ensure_ascii=False))
    return output


# ==========================
# CACHE HELPERS
# ==========================
def ensure_cache_dir(cache_dir):
    Path(cache_dir).mkdir(parents=True, exist_ok=True)

def cache_file_path(cache_dir, date_str):
    return Path(cache_dir) / f"{date_str}.json"

def load_cache(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

def write_cache(path, payload):
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]

def get_fixture_rows_map(fixture_ids):
    out = {}
    ids = [str(fid) for fid in fixture_ids if fid]
    for batch in chunked(ids, 20):
        rows = api_get("/fixtures", {"ids": "-".join(batch), "timezone": MATCH_TIMEZONE}, timeout=30)
        for row in rows:
            fx = row.get("fixture", {}) or {}
            out[str(fx.get("id") or "")] = row
    return out

def get_fixture_statistics_map(fixture_ids):
    out = {}
    for fixture_id in fixture_ids:
        rows = api_get("/fixtures/statistics", {"fixture": fixture_id}, timeout=30)
        total_corners = 0
        total_yellows = 0
        corners_found = False
        yellows_found = False
        for row in rows:
            for stat in row.get("statistics", []) or []:
                name = str(stat.get("type") or "").strip().lower()
                value = stat.get("value")
                num = to_float(value)
                if num is None:
                    continue
                if name == "corner kicks":
                    total_corners += num
                    corners_found = True
                elif name == "yellow cards":
                    total_yellows += num
                    yellows_found = True
        out[str(fixture_id)] = {
            "total_corners": round(total_corners, 1) if corners_found else None,
            "total_yellows": round(total_yellows, 1) if yellows_found else None,
        }
    return out

def update_matches_from_fixture_rows(payload, fixture_rows, fixture_stats=None):
    fixture_stats = fixture_stats or {}
    for match in payload.get("matches", []) or []:
        row = fixture_rows.get(str(match.get("fixture_id") or ""))
        if not row:
            continue
        fixture = row.get("fixture", {}) or {}
        goals = row.get("goals", {}) or {}
        status = fixture.get("status", {}) or {}
        match["status_short"] = str(status.get("short", "")).upper()
        match["status_long"] = str(status.get("long", "")).strip()
        match["goals_home"] = goals.get("home")
        match["goals_away"] = goals.get("away")
        if goals.get("home") is not None and goals.get("away") is not None:
            match["final_score"] = f"{goals.get('home')}-{goals.get('away')}"
        else:
            match["final_score"] = ""
        stats_row = fixture_stats.get(str(match.get("fixture_id") or "")) or {}
        match["total_corners"] = stats_row.get("total_corners")
        match["total_yellows"] = stats_row.get("total_yellows")
    payload["refreshed_at"] = now_utc().isoformat()
    return payload

def build_cache_for_date(cache_dir, target_date, time_min="00:00", time_max="23:59"):
    ensure_cache_dir(cache_dir)
    payload = run(target_date, time_min, time_max, emit_json=False)
    payload["timezone"] = MATCH_TIMEZONE
    payload["expires_at"] = (now_utc() + timedelta(hours=CACHE_TTL_HOURS)).isoformat()
    write_cache(cache_file_path(cache_dir, target_date), payload)
    return payload

def refresh_existing_caches(cache_dir):
    ensure_cache_dir(cache_dir)
    refreshed = []
    for path in sorted(Path(cache_dir).glob("????-??-??.json")):
        payload = load_cache(path)
        expires_at = parse_iso_dt(payload.get("expires_at"))
        if expires_at and expires_at <= now_utc():
            continue
        fixture_ids = [match.get("fixture_id") for match in payload.get("matches", []) or [] if match.get("fixture_id")]
        rows = get_fixture_rows_map(fixture_ids) if fixture_ids else {}
        final_ids = []
        for match in payload.get("matches", []) or []:
            row = rows.get(str(match.get("fixture_id") or ""))
            status = str(((row or {}).get("fixture", {}) or {}).get("status", {}).get("short", "")).upper()
            if status in FINAL_STATUSES:
                final_ids.append(match.get("fixture_id"))
        stats_map = get_fixture_statistics_map(final_ids) if final_ids else {}
        refreshed_payload = update_matches_from_fixture_rows(payload, rows, stats_map)
        write_cache(path, refreshed_payload)
        refreshed.append(refreshed_payload)
    return refreshed

def cleanup_expired_caches(cache_dir):
    ensure_cache_dir(cache_dir)
    removed = []
    for path in sorted(Path(cache_dir).glob("????-??-??.json")):
        try:
            payload = load_cache(path)
        except Exception:
            path.unlink(missing_ok=True)
            removed.append(path.name)
            continue
        expires_at = parse_iso_dt(payload.get("expires_at"))
        if expires_at and expires_at <= now_utc():
            path.unlink(missing_ok=True)
            removed.append(path.name)
    return removed

def rebuild_manifest(cache_dir):
    ensure_cache_dir(cache_dir)
    entries = []
    latest = None
    for path in sorted(Path(cache_dir).glob("????-??-??.json")):
        payload = load_cache(path)
        summary = {
            "date": payload.get("date"),
            "file": path.name,
            "generated_at": payload.get("generated_at"),
            "expires_at": payload.get("expires_at"),
            "matches": payload.get("total_matches", 0),
            "final_matches": sum(1 for match in payload.get("matches", []) if str(match.get("status_short") or "").upper() in FINAL_STATUSES),
        }
        entries.append(summary)
        if latest is None or str(payload.get("date") or "") > str(latest.get("date") or ""):
            latest = payload
    manifest = {
        "generated_at": now_utc().isoformat(),
        "timezone": MATCH_TIMEZONE,
        "latest_date": latest.get("date") if latest else "",
        "dates": sorted(entries, key=lambda row: row["date"], reverse=True),
    }
    write_cache(Path(cache_dir) / "manifest.json", manifest)
    write_cache(Path(cache_dir) / "latest.json", latest or {"generated_at": now_utc().isoformat(), "matches": []})
    return manifest

def run_daemon(cache_dir):
    ensure_cache_dir(cache_dir)
    local_now = datetime.now(LOCAL_TZ)
    current_date = local_now.strftime("%Y-%m-%d")
    current_file = cache_file_path(cache_dir, current_date)
    built = False
    if local_now.hour == 0 and not current_file.exists():
        build_cache_for_date(cache_dir, current_date)
        built = True
    elif not current_file.exists():
        build_cache_for_date(cache_dir, current_date)
        built = True
    refreshed = refresh_existing_caches(cache_dir)
    removed = cleanup_expired_caches(cache_dir)
    manifest = rebuild_manifest(cache_dir)
    return {"mode": "daemon", "built_today": built, "refreshed_files": len(refreshed), "removed_files": removed, "dates": len(manifest.get("dates", []))}


# ==========================
# ENTRY
# ==========================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Match predictor cache builder")
    parser.add_argument("args", nargs="*")
    parser.add_argument("--mode", choices=["print", "build", "refresh", "daemon"], default="print")
    parser.add_argument("--date")
    parser.add_argument("--time-min", default=None)
    parser.add_argument("--time-max", default=None)
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    parsed = parser.parse_args()

    args = [a for a in parsed.args if a != "--help"]
    if "--help" in sys.argv:
        print(__doc__)
        sys.exit(0)

    target = parsed.date
    tmin = parsed.time_min or "00:00"
    tmax = parsed.time_max or "23:59"

    def is_date(s): return len(s) == 10 and s[4] == "-" and s[7] == "-"
    def is_time(s): return len(s) == 5 and s[2] == ":"

    times_found = []
    for a in args:
        if is_date(a) and not target:
            target = a
        elif is_time(a):
            times_found.append(a)

    if parsed.time_min is None and len(times_found) >= 1:
        tmin = times_found[0]
    if parsed.time_max is None and len(times_found) >= 2:
        tmax = times_found[1]
    target = target or today_local_str()

    if parsed.mode == "print":
        run(target, tmin, tmax, emit_json=True)
    elif parsed.mode == "build":
        payload = build_cache_for_date(parsed.cache_dir, target, tmin, tmax)
        rebuild_manifest(parsed.cache_dir)
        print(json.dumps({"mode": "build", "date": payload.get("date"), "matches": payload.get("total_matches", 0)}))
    elif parsed.mode == "refresh":
        refreshed = refresh_existing_caches(parsed.cache_dir)
        removed = cleanup_expired_caches(parsed.cache_dir)
        manifest = rebuild_manifest(parsed.cache_dir)
        print(json.dumps({"mode": "refresh", "refreshed": len(refreshed), "removed": removed, "dates": len(manifest.get("dates", []))}))
    else:
        print(json.dumps(run_daemon(parsed.cache_dir)))
