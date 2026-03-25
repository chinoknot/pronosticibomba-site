import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import match_predictor as mp


def fixture_sort_key(row):
    fixture = row.get("fixture", {}) or {}
    league = row.get("league", {}) or {}
    teams = row.get("teams", {}) or {}
    home = (teams.get("home", {}) or {}).get("name") or ""
    away = (teams.get("away", {}) or {}).get("name") or ""
    return (
        str(fixture.get("date") or ""),
        str(league.get("country") or ""),
        str(league.get("name") or ""),
        str(home),
        str(away),
        str(fixture.get("id") or ""),
    )


def match_sort_key(row):
    return (
        str(row.get("match_time") or ""),
        str(row.get("country") or ""),
        str(row.get("league") or ""),
        str(row.get("home") or ""),
        str(row.get("away") or ""),
        str(row.get("fixture_id") or ""),
    )


def split_fixtures(fixtures, shard_count):
    shard_count = max(1, int(shard_count))
    ordered = sorted(fixtures, key=fixture_sort_key)
    if not ordered:
        return [[] for _ in range(shard_count)]
    chunk_size = math.ceil(len(ordered) / shard_count)
    chunks = [ordered[i:i + chunk_size] for i in range(0, len(ordered), chunk_size)]
    while len(chunks) < shard_count:
        chunks.append([])
    return chunks[:shard_count]


def write_json(path, payload):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def build_payload_from_fixtures(fixtures, target_date, time_min, time_max, shard_label=""):
    target = target_date or mp.today_local_str()
    ordered = sorted(fixtures, key=fixture_sort_key)
    label = f" [{shard_label}]" if shard_label else ""

    print(f"\n{'='*70}", file=sys.stderr)
    print(f"  MATCH PREDICTOR{label}", file=sys.stderr)
    print(f"  Date: {target} | Orario: {time_min} - {time_max} | Fixtures: {len(ordered)}", file=sys.stderr)
    print(f"{'='*70}\n", file=sys.stderr)

    if not ordered:
        return {
            "date": target,
            "time_range": f"{time_min}-{time_max}",
            "generated_at": mp.now_utc().isoformat(),
            "total_matches": 0,
            "matches": [],
        }

    results = []
    total = len(ordered)

    for idx, f in enumerate(ordered, 1):
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

        if idx % 20 == 0 or idx == 1 or idx == total:
            print(f"# {shard_label or 'build'} progress: {idx}/{total}", file=sys.stderr)

        pred = mp.get_prediction(fid)
        odds = mp.get_odds(fid)
        h_ts = mp.get_team_stats(lid, season, hid)
        a_ts = mp.get_team_stats(lid, season, aid)
        hp_ = mp.profile(h_ts, "home")
        ap_ = mp.profile(a_ts, "away")

        h_sb = mp.sb_team_stats(hid) if hid else {}
        a_sb = mp.sb_team_stats(aid) if aid else {}
        h_crn = mp.sb_corner_stats(hid, lid) if hid else {}
        a_crn = mp.sb_corner_stats(aid, lid) if aid else {}
        h2h_c = mp.sb_corner_h2h(hid, aid) if (hid and aid) else None

        result = mp.predict_all(
            hp_,
            ap_,
            pred,
            odds,
            hn,
            an,
            h_sb=h_sb,
            a_sb=a_sb,
            h_crn=h_crn,
            a_crn=a_crn,
            h2h_c=h2h_c,
        )

        results.append({
            "fixture_id": fid,
            "date": target,
            "league": lname,
            "country": country,
            "match_time": mtime,
            "home": hn,
            "away": an,
            "home_logo": ht.get("logo", ""),
            "away_logo": at.get("logo", ""),
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

    results.sort(key=match_sort_key)
    return {
        "date": target,
        "time_range": f"{time_min}-{time_max}",
        "generated_at": mp.now_utc().isoformat(),
        "total_matches": len(results),
        "matches": results,
    }


def cmd_prepare(args):
    fixtures = mp.get_all_fixtures(args.date, args.time_min, args.time_max)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    shards = split_fixtures(fixtures, args.shards)
    metadata = {
        "date": args.date,
        "time_min": args.time_min,
        "time_max": args.time_max,
        "fixture_count": len(fixtures),
        "shards": args.shards,
        "files": [],
    }

    for idx, chunk in enumerate(shards, start=1):
        name = f"shard_{idx:02d}.fixtures.json"
        path = output_dir / name
        write_json(path, chunk)
        metadata["files"].append({"index": idx, "file": name, "fixtures": len(chunk)})

    write_json(output_dir / "metadata.json", metadata)
    print(json.dumps(metadata, ensure_ascii=False))


def cmd_build_shard(args):
    fixtures = load_json(args.fixtures_file)
    payload = build_payload_from_fixtures(
        fixtures,
        args.date,
        args.time_min,
        args.time_max,
        shard_label=args.shard_label,
    )
    write_json(args.output_file, payload)
    print(json.dumps({
        "date": payload.get("date"),
        "matches": payload.get("total_matches", 0),
        "output": str(args.output_file),
    }, ensure_ascii=False))


def cmd_merge(args):
    parts_dir = Path(args.parts_dir)
    part_paths = sorted(parts_dir.glob("*.json"))
    merged = {}

    for path in part_paths:
        payload = load_json(path)
        for match in payload.get("matches", []) or []:
            merged[str(match.get("fixture_id") or "")] = match

    matches = sorted(merged.values(), key=match_sort_key)
    payload = {
        "date": args.date,
        "time_range": f"{args.time_min}-{args.time_max}",
        "generated_at": mp.now_utc().isoformat(),
        "total_matches": len(matches),
        "matches": matches,
        "timezone": mp.MATCH_TIMEZONE,
        "expires_at": (mp.now_utc() + mp.timedelta(hours=mp.CACHE_TTL_HOURS)).isoformat(),
    }

    mp.ensure_cache_dir(args.cache_dir)
    mp.write_cache(mp.cache_file_path(args.cache_dir, args.date), payload)
    manifest = mp.rebuild_manifest(args.cache_dir)
    print(json.dumps({
        "date": args.date,
        "matches": len(matches),
        "parts": len(part_paths),
        "manifest_dates": len(manifest.get("dates", [])),
    }, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Shard helper for match predictor builds")
    sub = parser.add_subparsers(dest="command", required=True)

    prepare = sub.add_parser("prepare")
    prepare.add_argument("--date", required=True)
    prepare.add_argument("--time-min", default="00:00")
    prepare.add_argument("--time-max", default="23:59")
    prepare.add_argument("--shards", type=int, default=4)
    prepare.add_argument("--output-dir", required=True)
    prepare.set_defaults(func=cmd_prepare)

    build = sub.add_parser("build-shard")
    build.add_argument("--date", required=True)
    build.add_argument("--time-min", default="00:00")
    build.add_argument("--time-max", default="23:59")
    build.add_argument("--fixtures-file", required=True)
    build.add_argument("--output-file", required=True)
    build.add_argument("--shard-label", default="")
    build.set_defaults(func=cmd_build_shard)

    merge = sub.add_parser("merge")
    merge.add_argument("--date", required=True)
    merge.add_argument("--time-min", default="00:00")
    merge.add_argument("--time-max", default="23:59")
    merge.add_argument("--parts-dir", required=True)
    merge.add_argument("--cache-dir", required=True)
    merge.set_defaults(func=cmd_merge)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
