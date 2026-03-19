#!/usr/bin/env python3
"""
all_stats_db.py — aggiorna TUTTE le tabelle stats in un solo passaggio
Tabelle popolate:
  corner_match_stats  → corner_team_stats
  cards_match_stats   → cards_team_stats, cards_referee_stats
  match_team_stats    → team_season_stats
  match_player_stats  → player_season_stats

Per ogni fixture: 1 chiamata /fixtures/statistics + 1 chiamata /fixtures/players
Nessuna duplicazione di chiamate API.

Commands:
  python all_stats_db.py daily                     # aggiorna ieri
  python all_stats_db.py daily --date 2026-03-10   # data specifica
  python all_stats_db.py aggregate                 # solo ricalcola aggregate (zero API)
  python all_stats_db.py backfill                  # storico completo stagione
"""

import os, sys, time, json, argparse
from datetime import date, timedelta
from collections import defaultdict
import requests

# ==========================
# CONFIG
# ==========================

API_KEY = os.getenv("API_FOOTBALL_KEY", "daaf29bc97d50f28aa64816c7cc203bc").strip()
SB_URL  = os.getenv("SUPABASE_URL", "https://oiudaxsyvhjpjjhglejd.supabase.co").rstrip("/")
SB_KEY  = os.getenv("SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pdWRheHN5dmhqcGpqaGdsZWpkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDAwOTQ5NywiZXhwIjoyMDc5NTg1NDk3fQ.S59NSuWyqT9QBh33YD8OxB0rnO8_6CjLXC2M5wwW120").strip()

SEASON   = 2025
API_INTV = 0.35
SB_REST  = f"{SB_URL}/rest/v1"
API_BASE = "https://v3.football.api-sports.io"
API_HDR  = {"x-apisports-key": API_KEY, "Accept": "application/json"}
SB_HDR   = {
    "apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
    "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates",
}

LEAGUES = [
    39, 140, 135, 78, 61,       # Top 5
    40, 41, 42, 45, 48,         # England
    141, 143,                   # Spain
    136, 137,                   # Italy
    79, 81,                     # Germany
    62, 66,                     # France
    88, 89,                     # Netherlands
    94, 96,                     # Portugal
    144,                        # Belgium
    203,                        # Turkey
    179,                        # Scotland
    218,                        # Austria
    207,                        # Switzerland
    197,                        # Greece
    235, 283, 172, 106, 119,    # Eastern Europe
    103, 107, 169,              # Scandinavia
    2, 3, 848,                  # UEFA
    253, 262,                   # Americas
    98, 292, 307,               # Asia
]

_last_api   = 0.0
_table_cols = {}   # cache colonne per tabella


# ==========================
# API
# ==========================

def api_get(path, params=None):
    global _last_api
    wait = API_INTV - (time.time() - _last_api)
    if wait > 0:
        time.sleep(wait)
    try:
        r = requests.get(f"{API_BASE}{path}", headers=API_HDR,
                         params=params or {}, timeout=30)
        _last_api = time.time()
        if r.status_code != 200:
            print(f"  [API] {r.status_code} {path}", file=sys.stderr)
            return []
        return r.json().get("response", [])
    except Exception as e:
        print(f"  [API] error {path}: {e}", file=sys.stderr)
        return []


# ==========================
# SUPABASE
# ==========================

def sb_get_all(table, params=None):
    rows, offset, limit = [], 0, 1000
    while True:
        p = dict(params or {})
        p.update({"limit": str(limit), "offset": str(offset)})
        qs = "&".join(f"{k}={v}" for k, v in p.items())
        r = requests.get(f"{SB_REST}/{table}?{qs}",
                         headers={**SB_HDR, "Prefer": "count=exact"}, timeout=30)
        if r.status_code not in (200, 206):
            print(f"  [SB] GET {table} {r.status_code}: {r.text[:80]}", file=sys.stderr)
            break
        batch = r.json()
        if not isinstance(batch, list):
            break
        rows.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return rows


def get_table_cols(table):
    """Ritorna il set di colonne che esistono effettivamente nella tabella."""
    if table not in _table_cols:
        r = requests.get(f"{SB_REST}/{table}?limit=1",
                         headers={**SB_HDR, "Prefer": ""}, timeout=15)
        data = r.json()
        if isinstance(data, list) and data:
            _table_cols[table] = set(data[0].keys())
        else:
            _table_cols[table] = set()
        if _table_cols[table]:
            print(f"  [schema] {table}: {len(_table_cols[table])} colonne", file=sys.stderr)
    return _table_cols[table]


def sb_upsert(table, rows, conflict):
    if not rows:
        return
    # Filtra automaticamente le colonne che non esistono nella tabella
    cols = get_table_cols(table)
    if cols:
        rows = [{k: v for k, v in row.items() if k in cols} for row in rows]
    url = f"{SB_REST}/{table}?on_conflict={conflict}"
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        r = requests.post(url, headers=SB_HDR, data=json.dumps(batch), timeout=60)
        if r.status_code not in (200, 201, 204):
            print(f"  [SB] UPSERT {table} {r.status_code}: {r.text[:200]}", file=sys.stderr)


# ==========================
# PARSE FIXTURE STATISTICS
# Returns dict keyed by team_id with all stats
# ==========================

def parse_statistics(stats_resp, fx, league_id, match_date):
    """
    Parses /fixtures/statistics response.
    Returns (corner_rows, cards_rows, team_rows) — one entry per team.
    """
    corner_rows = []
    cards_rows  = []
    team_rows   = []

    if len(stats_resp) < 2:
        return corner_rows, cards_rows, team_rows

    home_id = fx["teams"]["home"]["id"]

    def val(stats, key, default=0):
        for s in stats:
            if s["type"] == key:
                v = s["value"]
                if v is None: return default
                if isinstance(v, str):
                    v = v.replace("%", "").strip()
                try: return float(v)
                except: return default
        return default

    teams_data = []
    for ts in stats_resp:
        tid   = ts["team"]["id"]
        tname = ts["team"]["name"]
        stats = ts.get("statistics", [])
        is_home = (tid == home_id)

        s = {
            "team_id":   tid,
            "team_name": tname,
            "is_home":   is_home,
            "corners":        int(val(stats, "Corner Kicks")),
            "yellow_cards":   int(val(stats, "Yellow Cards")),
            "red_cards":      int(val(stats, "Red Cards")),
            "shots_total":    int(val(stats, "Total Shots")),
            "shots_on":       int(val(stats, "Shots on Goal")),
            "shots_off":      int(val(stats, "Shots off Goal")),
            "shots_blocked":  int(val(stats, "Blocked Shots")),
            "shots_inside":   int(val(stats, "Shots insidebox")),
            "shots_outside":  int(val(stats, "Shots outsidebox")),
            "possession":     float(val(stats, "Ball Possession")),
            "passes_total":   int(val(stats, "Total passes")),
            "passes_acc":     int(val(stats, "Passes accurate")),
            "passes_pct":     float(val(stats, "Passes %")),
            "fouls":          int(val(stats, "Fouls")),
            "offsides":       int(val(stats, "Offsides")),
            "gk_saves":       int(val(stats, "Goalkeeper Saves")),
            "tackles":        int(val(stats, "Tackles")),
            "interceptions":  int(val(stats, "Interceptions")),
            "duels_total":    int(val(stats, "Duels")),
            "duels_won":      int(val(stats, "Duels Won")),
            "aerials_total":  int(val(stats, "Aerial Duels")),
            "aerials_won":    int(val(stats, "Aerial Duels Won")),
            "attacks_total":  int(val(stats, "Total Attacks")),
            "attacks_dangerous": int(val(stats, "Dangerous Attacks")),
        }
        teams_data.append(s)

    if len(teams_data) < 2:
        return corner_rows, cards_rows, team_rows

    home = next(t for t in teams_data if t["is_home"])
    away = next(t for t in teams_data if not t["is_home"])

    total_corners = home["corners"] + away["corners"]
    total_yellow  = home["yellow_cards"] + away["yellow_cards"]
    total_red     = home["red_cards"] + away["red_cards"]
    total_cards   = total_yellow + total_red

    ref = (fx["fixture"].get("referee") or "").split("(")[0].strip() or None
    fid = fx["fixture"]["id"]
    lid = league_id
    ln  = fx["league"]["name"]
    rnd = fx["league"].get("round", "")

    # Goals
    home_goals = fx["goals"]["home"] or 0
    away_goals = fx["goals"]["away"] or 0

    # --- corner_match_stats ---
    corner_rows.append({
        "fixture_id": fid, "match_date": match_date,
        "league_id": lid, "league_name": ln, "season": SEASON, "round": rnd,
        "home_team_id": home["team_id"], "home_team_name": home["team_name"],
        "away_team_id": away["team_id"], "away_team_name": away["team_name"],
        "home_corners": home["corners"], "away_corners": away["corners"],
        "total_corners": total_corners,
        "home_goals": home_goals, "away_goals": away_goals,
        "total_goals": home_goals + away_goals,
        "corners_over_6_5":  1 if total_corners > 6.5  else 0,
        "corners_over_7_5":  1 if total_corners > 7.5  else 0,
        "corners_over_8_5":  1 if total_corners > 8.5  else 0,
        "corners_over_9_5":  1 if total_corners > 9.5  else 0,
        "corners_over_10_5": 1 if total_corners > 10.5 else 0,
        "corners_over_11_5": 1 if total_corners > 11.5 else 0,
        "corners_over_12_5": 1 if total_corners > 12.5 else 0,
    })

    # --- cards_match_stats ---
    cards_rows.append({
        "fixture_id": fid, "match_date": match_date,
        "league_id": lid, "league_name": ln, "season": SEASON, "round": rnd,
        "home_team_id": home["team_id"], "home_team_name": home["team_name"],
        "away_team_id": away["team_id"], "away_team_name": away["team_name"],
        "referee_name": ref,
        "home_yellow": home["yellow_cards"], "home_red": home["red_cards"],
        "away_yellow": away["yellow_cards"], "away_red": away["red_cards"],
        "total_yellow": total_yellow, "total_red": total_red, "total_cards": total_cards,
        "cards_over_3_5": 1 if total_cards > 3.5 else 0,
        "cards_over_4_5": 1 if total_cards > 4.5 else 0,
        "cards_over_5_5": 1 if total_cards > 5.5 else 0,
        "cards_over_6_5": 1 if total_cards > 6.5 else 0,
        "cards_over_7_5": 1 if total_cards > 7.5 else 0,
    })

    # --- match_team_stats (2 righe: home + away) ---
    for t in [home, away]:
        opp = away if t["is_home"] else home
        team_rows.append({
            "fixture_id": fid, "team_id": t["team_id"], "team_name": t["team_name"],
            "league_id": lid, "season": SEASON, "match_date": match_date,
            "is_home": t["is_home"],
            "shots_total":      t["shots_total"],
            "shots_on_target":  t["shots_on"],
            "shots_off_target": t["shots_off"],
            "shots_blocked":    t["shots_blocked"],
            "shots_inside_box": t["shots_inside"],
            "shots_outside_box":t["shots_outside"],
            "possession":       t["possession"],
            "passes_total":     t["passes_total"],
            "passes_accurate":  t["passes_acc"],
            "passes_pct":       t["passes_pct"],
            "attacks_total":    t["attacks_total"],
            "attacks_dangerous":t["attacks_dangerous"],
            "tackles":          t["tackles"],
            "interceptions":    t["interceptions"],
            "duels_won":        t["duels_won"],
            "duels_total":      t["duels_total"],
            "aerials_won":      t["aerials_won"],
            "aerials_total":    t["aerials_total"],
            "fouls":            t["fouls"],
            "yellow_cards":     t["yellow_cards"],
            "red_cards":        t["red_cards"],
            "corners":          t["corners"],
            "offsides":         t["offsides"],
            "gk_saves":         t["gk_saves"],
            "goals_scored":     home_goals if t["is_home"] else away_goals,
            "goals_conceded":   away_goals if t["is_home"] else home_goals,
        })

    return corner_rows, cards_rows, team_rows


# ==========================
# PARSE PLAYER STATS
# ==========================

def parse_players(players_resp, fx, league_id, match_date):
    rows = []
    fid = fx["fixture"]["id"]
    lid = league_id

    for team_entry in players_resp:
        tid   = team_entry["team"]["id"]
        tname = team_entry["team"]["name"]
        for p in team_entry.get("players", []):
            pid   = p["player"]["id"]
            pname = p["player"]["name"]
            st    = p["statistics"][0] if p.get("statistics") else {}
            games = st.get("games", {})
            mins  = games.get("minutes") or 0
            if not mins:
                continue

            shots    = st.get("shots", {})
            goals    = st.get("goals", {})
            passes   = st.get("passes", {})
            tackles  = st.get("tackles", {})
            duels    = st.get("duels", {})
            dribbles = st.get("dribbles", {})
            fouls    = st.get("fouls", {})
            cards    = st.get("cards", {})
            aerials  = st.get("aerials", {}) if "aerials" in st else {}

            def iv(d, k): return int(d.get(k) or 0)
            def fv(d, k):
                v = d.get(k)
                try: return float(v) if v is not None else 0.0
                except: return 0.0

            rows.append({
                "fixture_id":      fid,
                "player_id":       pid,
                "player_name":     pname,
                "team_id":         tid,
                "team_name":       tname,
                "league_id":       lid,
                "season":          SEASON,
                "match_date":      match_date,
                "minutes_played":  mins,
                "position":        games.get("position", ""),
                "rating":          fv(games, "rating"),
                "is_starter":      not (games.get("substitute") or False),
                "shots_total":     iv(shots, "total"),
                "shots_on_target": iv(shots, "on"),
                "passes_total":    iv(passes, "total"),
                "passes_accurate": iv(passes, "accuracy"),
                "passes_key":      iv(passes, "key"),
                "duels_total":     iv(duels, "total"),
                "duels_won":       iv(duels, "won"),
                "aerials_total":   iv(aerials, "total"),
                "aerials_won":     iv(aerials, "won"),
                "tackles":         iv(tackles, "total"),
                "interceptions":   iv(tackles, "interceptions"),
                "blocks":          iv(tackles, "blocks"),
                "clearances":      0,
                "fouls_committed": iv(fouls, "committed"),
                "fouls_drawn":     iv(fouls, "drawn"),
                "yellow_cards":    iv(cards, "yellow"),
                "red_cards":       iv(cards, "red"),
                "dribbles_attempts": iv(dribbles, "attempts"),
                "dribbles_success":  iv(dribbles, "success"),
                "goals":           iv(goals, "total"),
                "assists":         iv(goals, "assists"),
            })
    return rows


# ==========================
# FETCH + INSERT FIXTURES
# ==========================

def process_fixtures(fixtures_by_league, existing_fids):
    """Fetcha statistics + players per ogni fixture nuova, ritorna tutte le righe."""
    all_corners = []; all_cards = []; all_teams = []; all_players = []
    api_n = 0

    for league_id, fixtures in fixtures_by_league.items():
        for fx in fixtures:
            fid = fx["fixture"]["id"]
            if fid in existing_fids:
                continue

            match_date = fx["fixture"]["date"][:10]

            # Una sola chiamata per corners + cards + team stats
            stats = api_get("/fixtures/statistics", {"fixture": fid})
            api_n += 1
            c_rows, cd_rows, t_rows = parse_statistics(stats, fx, league_id, match_date)
            all_corners.extend(c_rows)
            all_cards.extend(cd_rows)
            all_teams.extend(t_rows)

            # Una chiamata per player stats
            players = api_get("/fixtures/players", {"fixture": fid})
            api_n += 1
            all_players.extend(parse_players(players, fx, league_id, match_date))

    print(f"  API calls: {api_n}", file=sys.stderr)
    return all_corners, all_cards, all_teams, all_players


def upsert_all(corners, cards, teams, players):
    if corners:
        sb_upsert("corner_match_stats", corners, "fixture_id")
        print(f"  corner_match_stats: +{len(corners)}", file=sys.stderr)
    if cards:
        sb_upsert("cards_match_stats", cards, "fixture_id")
        print(f"  cards_match_stats:  +{len(cards)}", file=sys.stderr)
    if teams:
        sb_upsert("match_team_stats", teams, "fixture_id,team_id")
        print(f"  match_team_stats:   +{len(teams)}", file=sys.stderr)
    if players:
        sb_upsert("match_player_stats", players, "fixture_id,player_id")
        print(f"  match_player_stats: +{len(players)}", file=sys.stderr)


# ==========================
# AGGREGATE: corner_team_stats
# ==========================

def agg_corner_team():
    print("  Ricalcolo corner_team_stats...", file=sys.stderr)
    matches = sb_get_all("corner_match_stats", {"select": "*"})
    S = defaultdict(lambda: {
        "tn":"","ln":"","total":0,"home":0,"away":0,
        "cf":0,"ca":0,"cf_h":0,"ca_h":0,"cf_a":0,"ca_a":0,
    })
    for m in matches:
        lid = m["league_id"]
        hc = m.get("home_corners",0) or 0
        ac = m.get("away_corners",0) or 0
        hk=(m["home_team_id"],lid); ak=(m["away_team_id"],lid)
        for k,cf,ca,is_h in [(hk,hc,ac,True),(ak,ac,hc,False)]:
            S[k]["tn"]=m.get("home_team_name" if is_h else "away_team_name","")
            S[k]["ln"]=m.get("league_name","")
            S[k]["total"]+=1; S[k]["home" if is_h else "away"]+=1
            S[k]["cf"]+=cf; S[k]["ca"]+=ca
            if is_h: S[k]["cf_h"]+=cf; S[k]["ca_h"]+=ca
            else:    S[k]["cf_a"]+=cf; S[k]["ca_a"]+=ca
    def avg(n,d): return round(n/d,2) if d else 0.0
    rows=[]
    for (tid,lid),s in S.items():
        n=s["total"]; nh=s["home"]; na=s["away"]
        rows.append({
            "team_id":tid,"league_id":lid,"team_name":s["tn"],"league_name":s["ln"],
            "total_matches":n,"home_matches":nh,"away_matches":na,
            "total_corners_for":s["cf"],"total_corners_against":s["ca"],
            "avg_corners_for":avg(s["cf"],n),"avg_corners_against":avg(s["ca"],n),
            "avg_corners_total":avg(s["cf"]+s["ca"],n),
            "avg_corners_for_home":avg(s["cf_h"],nh),"avg_corners_against_home":avg(s["ca_h"],nh),
            "avg_corners_for_away":avg(s["cf_a"],na),"avg_corners_against_away":avg(s["ca_a"],na),
        })
    sb_upsert("corner_team_stats", rows, "team_id,league_id")
    print(f"    → {len(rows)} squadre", file=sys.stderr)


# ==========================
# AGGREGATE: cards_team_stats + cards_referee_stats
# ==========================

def agg_cards():
    print("  Ricalcolo cards_team_stats + cards_referee_stats...", file=sys.stderr)
    matches = sb_get_all("cards_match_stats", {"select": "*"})
    S = defaultdict(lambda: {
        "tn":"","ln":"","total":0,"home":0,"away":0,
        "yf":0,"ya":0,"rf":0,"ra":0,
        "yf_h":0,"ya_h":0,"yf_a":0,"ya_a":0,
    })
    R = defaultdict(lambda: {"ln":"","total":0,"yellow":0,"red":0,"cards":0})
    for m in matches:
        lid=m["league_id"]
        hy=m.get("home_yellow",0) or 0; ay=m.get("away_yellow",0) or 0
        hr=m.get("home_red",0) or 0;   ar=m.get("away_red",0) or 0
        hk=(m["home_team_id"],lid); ak=(m["away_team_id"],lid)
        for k,yf,ya,rf,ra,is_h in [(hk,hy,ay,hr,ar,True),(ak,ay,hy,ar,hr,False)]:
            S[k]["tn"]=m.get("home_team_name" if is_h else "away_team_name","")
            S[k]["ln"]=m.get("league_name","")
            S[k]["total"]+=1; S[k]["home" if is_h else "away"]+=1
            S[k]["yf"]+=yf; S[k]["ya"]+=ya; S[k]["rf"]+=rf; S[k]["ra"]+=ra
            if is_h: S[k]["yf_h"]+=yf; S[k]["ya_h"]+=ya
            else:    S[k]["yf_a"]+=yf; S[k]["ya_a"]+=ya
        ref=(m.get("referee_name") or "").strip()
        if ref:
            rk=(ref,lid); R[rk]["ln"]=m.get("league_name","")
            R[rk]["total"]+=1
            R[rk]["yellow"]+=hy+ay; R[rk]["red"]+=hr+ar
            R[rk]["cards"]+=hy+ay+hr+ar
    def avg(n,d): return round(n/d,2) if d else 0.0
    team_rows=[]
    for (tid,lid),s in S.items():
        n=s["total"]; nh=s["home"]; na=s["away"]
        team_rows.append({
            "team_id":tid,"league_id":lid,"team_name":s["tn"],"league_name":s["ln"],
            "total_matches":n,"home_matches":nh,"away_matches":na,
            "total_yellow_for":s["yf"],"total_yellow_against":s["ya"],
            "avg_yellow_for":avg(s["yf"],n),"avg_yellow_against":avg(s["ya"],n),
            "avg_yellow_total":avg(s["yf"]+s["ya"],n),
            "avg_yellow_for_home":avg(s["yf_h"],nh),"avg_yellow_against_home":avg(s["ya_h"],nh),
            "avg_yellow_for_away":avg(s["yf_a"],na),"avg_yellow_against_away":avg(s["ya_a"],na),
        })
    sb_upsert("cards_team_stats", team_rows, "team_id,league_id")
    ref_rows=[]
    for (ref,lid),s in R.items():
        n=s["total"]
        ref_rows.append({
            "referee_name":ref,"league_id":lid,"league_name":s["ln"],
            "total_matches":n,"total_yellow":s["yellow"],"total_red":s["red"],"total_cards":s["cards"],
            "avg_yellow":avg(s["yellow"],n),"avg_red":avg(s["red"],n),
        })
    # PK su cards_referee_stats è solo referee_name (league_ids è un array)
    sb_upsert("cards_referee_stats", ref_rows, "referee_name")
    print(f"    → {len(team_rows)} squadre, {len(ref_rows)} arbitri", file=sys.stderr)


# ==========================
# AGGREGATE: team_season_stats
# ==========================

def agg_team_season():
    print("  Ricalcolo team_season_stats...", file=sys.stderr)
    matches = sb_get_all("match_team_stats", {"select": "*"})

    # Raggruppa per fixture per calcolare stats "contro" (shots_against ecc.)
    by_fixture = defaultdict(list)
    for m in matches:
        by_fixture[m["fixture_id"]].append(m)

    # Aggiungi opponent stats
    enriched = []
    for fid, rows in by_fixture.items():
        if len(rows) == 2:
            h = next((r for r in rows if r.get("is_home")), None)
            a = next((r for r in rows if not r.get("is_home")), None)
            if h and a:
                h["shots_against"] = a.get("shots_total", 0) or 0
                a["shots_against"] = h.get("shots_total", 0) or 0
                h["sot_against"]   = a.get("shots_on_target", 0) or 0
                a["sot_against"]   = h.get("shots_on_target", 0) or 0
                h["corners_against"] = a.get("corners", 0) or 0
                a["corners_against"] = h.get("corners", 0) or 0
                h["fouls_against"] = a.get("fouls", 0) or 0
                a["fouls_against"] = h.get("fouls", 0) or 0
                enriched.extend([h, a])
        else:
            for r in rows:
                r["shots_against"] = 0; r["sot_against"] = 0
                r["corners_against"] = 0; r["fouls_against"] = 0
            enriched.extend(rows)

    # Aggrega per (team_id, league_id)
    S = defaultdict(lambda: {
        "tn":"","matches":[]
    })
    for m in enriched:
        k = (m["team_id"], m["league_id"])
        S[k]["tn"] = m.get("team_name","")
        S[k]["matches"].append(m)

    def avg(vals): return round(sum(vals)/len(vals),2) if vals else 0.0
    def last5avg(vals): return avg(vals[-5:]) if vals else 0.0

    rows=[]
    for (tid,lid),s in S.items():
        ms = sorted(s["matches"], key=lambda x: x.get("match_date",""))
        n  = len(ms)
        if n == 0: continue
        def col(c): return [m.get(c,0) or 0 for m in ms]
        rows.append({
            "team_id": tid, "team_name": s["tn"], "league_id": lid, "season": SEASON,
            "matches_played":       n,
            "shots_for_avg":        avg(col("shots_total")),
            "shots_against_avg":    avg(col("shots_against")),
            "sot_for_avg":          avg(col("shots_on_target")),
            "sot_against_avg":      avg(col("sot_against")),
            "possession_avg":       avg(col("possession")),
            "passes_avg":           avg(col("passes_total")),
            "passes_pct_avg":       avg(col("passes_pct")),
            "fouls_for_avg":        avg(col("fouls")),
            "fouls_against_avg":    avg(col("fouls_against")),
            "tackles_avg":          avg(col("tackles")),
            "interceptions_avg":    avg(col("interceptions")),
            "duels_won_pct":        avg([(m.get("duels_won") or 0)/max(m.get("duels_total") or 1,1)*100 for m in ms]),
            "aerials_won_pct":      avg([(m.get("aerials_won") or 0)/max(m.get("aerials_total") or 1,1)*100 for m in ms]),
            "corners_for_avg":      avg(col("corners")),
            "corners_against_avg":  avg(col("corners_against")),
            "yellow_avg":           avg(col("yellow_cards")),
            "last5_shots_avg":      last5avg(col("shots_total")),
            "last5_sot_avg":        last5avg(col("shots_on_target")),
            "last5_possession_avg": last5avg(col("possession")),
            "last5_goals_scored_avg":   last5avg(col("goals_scored")),
            "last5_goals_conceded_avg": last5avg(col("goals_conceded")),
        })
    sb_upsert("team_season_stats", rows, "team_id,league_id,season")
    print(f"    → {len(rows)} squadre", file=sys.stderr)


# ==========================
# AGGREGATE: player_season_stats
# ==========================

def agg_player_season():
    print("  Ricalcolo player_season_stats...", file=sys.stderr)
    matches = sb_get_all("match_player_stats", {"select": "*"})
    S = defaultdict(lambda: {"pn":"","tn":"","pos":"","matches":[]})
    for m in matches:
        if not (m.get("minutes_played") or 0):
            continue
        k = (m["player_id"], m["league_id"])
        S[k]["pn"] = m.get("player_name","")
        S[k]["tn"] = m.get("team_name","")
        S[k]["pos"] = m.get("position","")
        S[k]["matches"].append(m)

    def per90(total, mins): return min(round(total/mins*90, 2), 99.99) if mins else 0.0
    def pct(won, total): return round(won/total*100, 1) if total else 0.0
    def last5sum(vals): return sum(vals[-5:])
    def last5avg(vals): return round(sum(vals[-5:])/len(vals[-5:]),2) if vals[-5:] else 0.0

    rows=[]
    for (pid,lid),s in S.items():
        ms = sorted(s["matches"], key=lambda x: x.get("match_date",""))
        n  = len(ms)
        if n == 0: continue
        mins_total = sum(m.get("minutes_played",0) or 0 for m in ms)
        def col(c): return [m.get(c,0) or 0 for m in ms]
        rows.append({
            "player_id": pid, "player_name": s["pn"],
            "team_id": ms[-1].get("team_id"), "team_name": s["tn"],
            "league_id": lid, "season": SEASON,
            "position": s["pos"],
            "matches_played":  n,
            "minutes_total":   mins_total,
            "shots_per90":     per90(sum(col("shots_total")), mins_total),
            "sot_per90":       per90(sum(col("shots_on_target")), mins_total),
            "fouls_per90":     per90(sum(col("fouls_committed")), mins_total),
            "fouls_drawn_per90": per90(sum(col("fouls_drawn")), mins_total),
            "yellow_per90":    per90(sum(col("yellow_cards")), mins_total),
            "duels_won_per90": per90(sum(col("duels_won")), mins_total),
            "duels_win_pct":   pct(sum(col("duels_won")), sum(col("duels_total"))),
            "aerials_won_per90": per90(sum(col("aerials_won")), mins_total),
            "aerials_win_pct": pct(sum(col("aerials_won")), sum(col("aerials_total"))),
            "tackles_per90":   per90(sum(col("tackles")), mins_total),
            "interceptions_per90": per90(sum(col("interceptions")), mins_total),
            "dribbles_per90":  per90(sum(col("dribbles_success")), mins_total),
            "passes_key_per90": per90(sum(col("passes_key")), mins_total),
            "last5_shots_avg": last5avg(col("shots_total")),
            "last5_sot_avg":   last5avg(col("shots_on_target")),
            "last5_fouls_avg": last5avg(col("fouls_committed")),
            "last5_yellow_total": last5sum(col("yellow_cards")),
            "last5_minutes_avg":  last5avg(col("minutes_played")),
            "last5_rating_avg":   last5avg(col("rating")),
            "goals_total":   sum(col("goals")),
            "assists_total": sum(col("assists")),
        })
    sb_upsert("player_season_stats", rows, "player_id,league_id,season")
    print(f"    → {len(rows)} giocatori", file=sys.stderr)


# ==========================
# COMMANDS
# ==========================

def cmd_daily(target_date):
    print(f"\n=== DAILY {target_date} ===", file=sys.stderr)
    existing = {r["fixture_id"] for r in
                sb_get_all("corner_match_stats", {"select": "fixture_id"})}

    by_league = {}
    for lid in LEAGUES:
        fxs = api_get("/fixtures", {
            "league": lid, "season": SEASON, "date": target_date, "status": "FT"
        })
        if fxs:
            by_league[lid] = fxs

    total_new = sum(1 for fxs in by_league.values()
                    for fx in fxs if fx["fixture"]["id"] not in existing)
    print(f"  Nuove partite: {total_new}", file=sys.stderr)

    corners, cards, teams, players = process_fixtures(by_league, existing)
    upsert_all(corners, cards, teams, players)


def cmd_backfill():
    print(f"\n=== BACKFILL stagione {SEASON} ===", file=sys.stderr)
    existing = {r["fixture_id"] for r in
                sb_get_all("corner_match_stats", {"select": "fixture_id"})}
    print(f"  Già in DB: {len(existing)}", file=sys.stderr)

    today = date.today().isoformat()
    all_c=[]; all_cd=[]; all_t=[]; all_p=[]

    for i, lid in enumerate(LEAGUES, 1):
        print(f"  [{i}/{len(LEAGUES)}] league {lid}...", file=sys.stderr)
        fxs = api_get("/fixtures", {
            "league": lid, "season": SEASON, "to": today, "status": "FT"
        })
        c,cd,t,p = process_fixtures({lid: fxs}, existing)
        all_c.extend(c); all_cd.extend(cd); all_t.extend(t); all_p.extend(p)

        # Checkpoint ogni 10 leghe
        if i % 10 == 0 and any([all_c, all_cd, all_t, all_p]):
            upsert_all(all_c, all_cd, all_t, all_p)
            for r in all_c: existing.add(r["fixture_id"])
            all_c=[]; all_cd=[]; all_t=[]; all_p=[]

    upsert_all(all_c, all_cd, all_t, all_p)
    print("  ✅ Backfill completato", file=sys.stderr)


def cmd_aggregate():
    print("\n=== AGGREGATE (zero API) ===", file=sys.stderr)
    agg_corner_team()
    agg_cards()
    agg_team_season()
    agg_player_season()
    print("  ✅ Aggregate completate", file=sys.stderr)


# ==========================
# MAIN
# ==========================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["daily", "backfill", "aggregate"])
    parser.add_argument("--date", default="")
    args = parser.parse_args()

    if args.command == "daily":
        target = args.date or (date.today() - timedelta(days=1)).isoformat()
        cmd_daily(target)
        cmd_aggregate()
    elif args.command == "backfill":
        cmd_backfill()
        cmd_aggregate()
    elif args.command == "aggregate":
        cmd_aggregate()

    print("\n✅ Done.")


if __name__ == "__main__":
    main()
