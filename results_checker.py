# -*- coding: utf-8 -*-
"""
PronosticiBomba - Results Checker v3 robust

Fix principali:
- non nasconde più errori Supabase critici
- retry su API-Football 429 / errori temporanei
- se una chiamata API fallisce, NON scrive UNKNOWN finti per quelle fixture
- insert Supabase a chunk + fallback riga singola
- odd / score_model puliti: niente stringhe vuote su colonne numeriche
- supporto HT_GOAL_ENGINE: Home/Away team to score 1st Half
- supporto HOME_WIN_ELITE: Home wins
"""

import re
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Set, Tuple

import requests

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None

API_FOOTBALL_KEY = "daaf29bc97d50f28aa64816c7cc203bc"
API_FOOTBALL_BASE = "https://v3.football.api-sports.io"
API_FOOTBALL_HEADERS = {
    "x-apisports-key": API_FOOTBALL_KEY,
    "Accept": "application/json",
}

SUPABASE_URL = "https://oiudaxsyvhjpjjhglejd.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pdWRheHN5dmhqcGpqaGdsZWpkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDAwOTQ5NywiZXhwIjoyMDc5NTg1NDk3fQ.S59NSuWyqT9QBh33YD8OxB0rnO8_6CjLXC2M5wwW120"
SUPABASE_REST = f"{SUPABASE_URL}/rest/v1"
SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

RESULT_COLUMNS = [
    "run_date", "picks_date", "fixture_id", "league", "home", "away",
    "model", "category", "pick", "odd", "score_model",
    "goals_home", "goals_away", "final_score", "status_short", "result",
]

TERMINAL_STATUSES = {"FT", "AET", "PEN", "AWD", "WO"}
NOT_PLAYED_STATUSES = {"PST", "CANC", "ABD", "SUSP", "INT"}


def today_str() -> str:
    if ZoneInfo:
        return datetime.now(ZoneInfo("Europe/Dublin")).date().isoformat()
    return datetime.utcnow().date().isoformat()


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def to_float_or_none(value: Any):
    if value is None:
        return None
    s = str(value).strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except Exception:
        return None


def to_int_or_none(value: Any):
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        try:
            return int(float(str(value).strip()))
        except Exception:
            return None


def chunked(seq: List[Any], n: int) -> List[List[Any]]:
    return [seq[i:i + n] for i in range(0, len(seq), n)]


def is_match_finished(status_short: str) -> bool:
    return clean_text(status_short).upper() in TERMINAL_STATUSES


def is_match_not_played(status_short: str) -> bool:
    return clean_text(status_short).upper() in NOT_PLAYED_STATUSES


def api_football_get(path: str, params: Dict[str, Any], timeout: int = 30, max_attempts: int = 4) -> Tuple[List[Dict[str, Any]], bool]:
    url = API_FOOTBALL_BASE + path
    for attempt in range(1, max_attempts + 1):
        try:
            print(f"# API-Football GET {url} params={params} attempt={attempt}/{max_attempts}", file=sys.stderr)
            r = requests.get(url, headers=API_FOOTBALL_HEADERS, params=params, timeout=timeout)
            print(f"# API-Football status={r.status_code}", file=sys.stderr)

            if r.status_code == 429:
                wait_s = 65
                print(f"# 429 rate limit — attendo {wait_s}s...", file=sys.stderr)
                time.sleep(wait_s)
                continue

            if 500 <= r.status_code <= 599:
                wait_s = min(60, 8 * attempt)
                print(f"# API 5xx — retry fra {wait_s}s", file=sys.stderr)
                time.sleep(wait_s)
                continue

            r.raise_for_status()
            data = r.json()
            resp = data.get("response", [])
            return resp if isinstance(resp, list) else [], True
        except Exception as e:
            print(f"# ERRORE API-Football GET {url}: {e}", file=sys.stderr)
            if attempt < max_attempts:
                wait_s = min(45, 6 * attempt)
                print(f"# Retry fra {wait_s}s", file=sys.stderr)
                time.sleep(wait_s)

    print(f"# API-Football FAIL definitivo path={path} params={params}", file=sys.stderr)
    return [], False


def get_fixtures_results_by_ids(fixture_ids: List[Any]) -> Tuple[Dict[str, Dict[str, Any]], Set[str]]:
    out: Dict[str, Dict[str, Any]] = {}
    failed_ids: Set[str] = set()
    ids = []
    seen = set()

    for f in fixture_ids:
        fid = clean_text(f)
        if fid and fid not in seen:
            ids.append(fid)
            seen.add(fid)

    for chunk in chunked(ids, 20):
        resp, ok = api_football_get("/fixtures", {"ids": "-".join(chunk)}, timeout=30)
        print(f"# /fixtures?ids=... -> {len(resp)} risultati ok={ok}", file=sys.stderr)
        if not ok:
            failed_ids.update(chunk)
            continue

        for item in resp:
            fx = item.get("fixture", {}) or {}
            goals = item.get("goals", {}) or {}
            score = item.get("score", {}) or {}
            halftime = score.get("halftime", {}) or {}
            fid = fx.get("id")
            if fid is None:
                continue
            status = fx.get("status", {}) or {}
            fid_str = str(fid)
            out[fid_str] = {
                "fixture_id": fid_str,
                "goals_home": to_int_or_none(goals.get("home")),
                "goals_away": to_int_or_none(goals.get("away")),
                "halftime_home": to_int_or_none(halftime.get("home")),
                "halftime_away": to_int_or_none(halftime.get("away")),
                "status_short": clean_text(status.get("short")).upper(),
            }

    return out, failed_ids


def sb_get_picks_for_match_date(match_date: str) -> List[Dict[str, Any]]:
    url = f"{SUPABASE_REST}/picks"
    params = {"match_date": f"eq.{match_date}", "select": "*"}
    try:
        print(f"# Supabase GET picks match_date={match_date}", file=sys.stderr)
        r = requests.get(url, headers=SB_HEADERS, params=params, timeout=30)
        print(f"# Supabase picks status={r.status_code} body={r.text[:180]}", file=sys.stderr)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"# ERRORE Supabase GET picks: {e}", file=sys.stderr)
        return []


def clean_result_row(row: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {k: row.get(k) for k in RESULT_COLUMNS}
    for k in ["fixture_id", "league", "home", "away", "model", "category", "pick", "final_score"]:
        cleaned[k] = clean_text(cleaned.get(k))
    cleaned["status_short"] = clean_text(cleaned.get("status_short")).upper()
    cleaned["result"] = clean_text(cleaned.get("result")).upper()
    cleaned["odd"] = to_float_or_none(cleaned.get("odd"))
    cleaned["score_model"] = to_float_or_none(cleaned.get("score_model"))
    cleaned["goals_home"] = to_int_or_none(cleaned.get("goals_home"))
    cleaned["goals_away"] = to_int_or_none(cleaned.get("goals_away"))
    return cleaned


def sb_insert_results(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        print("# Nessuna riga da inserire in results", file=sys.stderr)
        return

    url = f"{SUPABASE_REST}/results"
    headers = {**SB_HEADERS, "Prefer": "return=minimal"}
    total_ok = 0
    total_failed = 0
    cleaned_rows = [clean_result_row(r) for r in rows]

    for idx, chunk in enumerate(chunked(cleaned_rows, 100), start=1):
        try:
            print(f"# Supabase INSERT results chunk={idx} rows={len(chunk)}", file=sys.stderr)
            r = requests.post(url, headers=headers, json=chunk, timeout=60)
            print(f"# Supabase INSERT status={r.status_code} body={r.text[:300]}", file=sys.stderr)
            r.raise_for_status()
            total_ok += len(chunk)
            continue
        except Exception as e:
            print(f"# ERRORE chunk INSERT: {e}", file=sys.stderr)
            print("# Fallback: provo inserimento riga-per-riga", file=sys.stderr)

        for row in chunk:
            try:
                r = requests.post(url, headers=headers, json=[row], timeout=30)
                if not r.ok:
                    total_failed += 1
                    print(
                        "# ROW FAIL "
                        f"status={r.status_code} body={r.text[:300]} "
                        f"fixture_id={row.get('fixture_id')} pick={row.get('pick')} category={row.get('category')}",
                        file=sys.stderr,
                    )
                    continue
                total_ok += 1
            except Exception as e:
                total_failed += 1
                print(
                    "# ROW EXCEPTION "
                    f"fixture_id={row.get('fixture_id')} pick={row.get('pick')} category={row.get('category')} err={e}",
                    file=sys.stderr,
                )

    print(f"# Supabase INSERT summary ok={total_ok} failed={total_failed}", file=sys.stderr)
    if total_ok == 0 and rows:
        raise RuntimeError("Nessuna riga results inserita: controllare errori Supabase sopra.")


def eval_result(result: str, final_score: str, status_short: str, gh, ga) -> Dict[str, Any]:
    return {"result": result, "final_score": final_score, "status_short": status_short, "goals_home": gh, "goals_away": ga}


def evaluate_pick(pick_row: Dict[str, Any], match_info: Dict[str, Any]) -> Dict[str, Any]:
    pick_text = clean_text(pick_row.get("pick"))
    pick_u = pick_text.upper()
    gh = match_info.get("goals_home")
    ga = match_info.get("goals_away")
    ht_home = match_info.get("halftime_home")
    ht_away = match_info.get("halftime_away")
    status_short = clean_text(match_info.get("status_short")).upper()
    final_score = f"{gh}-{ga}" if gh is not None and ga is not None else ""

    if not match_info:
        return eval_result("UNKNOWN", final_score, "", gh, ga)
    if is_match_not_played(status_short):
        return eval_result("UNKNOWN", final_score, status_short, gh, ga)
    if status_short == "NS":
        return eval_result("UNKNOWN", final_score, status_short, gh, ga)
    if not is_match_finished(status_short) or gh is None or ga is None:
        return eval_result("PENDING", final_score, status_short, gh, ga)

    total_goals = gh + ga
    home_win = gh > ga
    away_win = ga > gh
    draw = gh == ga

    if "&" in pick_u:
        parts = [s.strip() for s in pick_u.split("&") if s.strip()]
        if not parts:
            return eval_result("UNKNOWN", final_score, status_short, gh, ga)
        ok = all(evaluate_pick({**pick_row, "pick": part}, match_info).get("result") == "WIN" for part in parts)
        return eval_result("WIN" if ok else "LOSE", final_score, status_short, gh, ga)

    if "TEAM TO SCORE" in pick_u and ("1ST HALF" in pick_u or "FIRST HALF" in pick_u):
        if ht_home is None or ht_away is None:
            return eval_result("UNKNOWN", final_score, status_short, gh, ga)
        if pick_u.startswith("HOME"):
            return eval_result("WIN" if ht_home > 0 else "LOSE", final_score, status_short, gh, ga)
        if pick_u.startswith("AWAY"):
            return eval_result("WIN" if ht_away > 0 else "LOSE", final_score, status_short, gh, ga)
        return eval_result("UNKNOWN", final_score, status_short, gh, ga)

    over_match = re.search(r"\bOVER\s+(\d+(?:\.\d+)?)", pick_u)
    under_match = re.search(r"\bUNDER\s+(\d+(?:\.\d+)?)", pick_u)
    if over_match:
        line = float(over_match.group(1))
        return eval_result("WIN" if total_goals > line else "LOSE", final_score, status_short, gh, ga)
    if under_match:
        line = float(under_match.group(1))
        return eval_result("WIN" if total_goals < line else "LOSE", final_score, status_short, gh, ga)

    if "BOTH TEAMS" in pick_u or "BTTS" in pick_u:
        both_score = gh > 0 and ga > 0
        if "NO" in pick_u or "BTTS_NO" in pick_u:
            return eval_result("WIN" if not both_score else "LOSE", final_score, status_short, gh, ga)
        return eval_result("WIN" if both_score else "LOSE", final_score, status_short, gh, ga)

    if pick_u in {"HOME WINS", "HOME WIN", "1"}:
        return eval_result("WIN" if home_win else "LOSE", final_score, status_short, gh, ga)
    if pick_u in {"AWAY WINS", "AWAY WIN", "2"}:
        return eval_result("WIN" if away_win else "LOSE", final_score, status_short, gh, ga)
    if pick_u in {"DRAW", "X"}:
        return eval_result("WIN" if draw else "LOSE", final_score, status_short, gh, ga)
    if "1X" in pick_u:
        return eval_result("WIN" if home_win or draw else "LOSE", final_score, status_short, gh, ga)
    if "X2" in pick_u:
        return eval_result("WIN" if away_win or draw else "LOSE", final_score, status_short, gh, ga)
    if pick_u == "12" or " 12 " in f" {pick_u} ":
        return eval_result("WIN" if home_win or away_win else "LOSE", final_score, status_short, gh, ga)

    return eval_result("UNKNOWN", final_score, status_short, gh, ga)


def run_results_checker(target_match_date: str = None) -> None:
    if not target_match_date:
        target_match_date = today_str()

    print(f"# RESULTS CHECKER v3 START per match_date={target_match_date}", file=sys.stderr)
    picks = sb_get_picks_for_match_date(target_match_date)
    if not picks:
        print("# Nessun pick trovato per questa match_date, esco.", file=sys.stderr)
        return

    fixture_ids = [p.get("fixture_id") for p in picks if p.get("fixture_id")]
    results_map, failed_ids = get_fixtures_results_by_ids(fixture_ids)
    run_date = today_str()
    rows_to_insert = []
    skipped_api_failed = 0

    for p in picks:
        fixture_id = clean_text(p.get("fixture_id"))
        if not fixture_id:
            continue
        if fixture_id in failed_ids:
            skipped_api_failed += 1
            continue
        match_info = results_map.get(fixture_id) or {}
        eval_res = evaluate_pick(p, match_info)
        rows_to_insert.append({
            "run_date": run_date,
            "picks_date": target_match_date,
            "fixture_id": fixture_id,
            "league": p.get("league", ""),
            "home": p.get("home", ""),
            "away": p.get("away", ""),
            "model": p.get("model", ""),
            "category": p.get("category", ""),
            "pick": p.get("pick", ""),
            "odd": p.get("odd", None),
            "score_model": p.get("score", None),
            "goals_home": eval_res.get("goals_home"),
            "goals_away": eval_res.get("goals_away"),
            "final_score": eval_res.get("final_score", ""),
            "status_short": eval_res.get("status_short", ""),
            "result": eval_res.get("result", ""),
        })

    print(
        f"# Rows prepared={len(rows_to_insert)} skipped_api_failed={skipped_api_failed} fixtures_ok={len(results_map)} failed_ids={len(failed_ids)}",
        file=sys.stderr,
    )
    sb_insert_results(rows_to_insert)

    summary = {"WIN": 0, "LOSE": 0, "PENDING": 0, "UNKNOWN": 0, "OTHER": 0}
    for r in rows_to_insert:
        res = clean_text(r.get("result")).upper()
        summary[res if res in summary else "OTHER"] += 1

    print(
        "# RESULTS CHECKER v3 END "
        f"rows={len(rows_to_insert)} WIN={summary['WIN']} LOSE={summary['LOSE']} PENDING={summary['PENDING']} UNKNOWN={summary['UNKNOWN']} OTHER={summary['OTHER']}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    date_arg = sys.argv[1] if len(sys.argv) >= 2 else None
    run_results_checker(date_arg)
