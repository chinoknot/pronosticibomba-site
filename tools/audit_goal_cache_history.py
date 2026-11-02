"""Compare published site goal probabilities to the calibrated model.

Reads the first Git commit of each daily site asset, plus local private RAW
and FT result caches. No credentials or outcomes enter the model features.
"""

import argparse
import json
import math
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.metrics import brier_score_loss

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import match_predictor as site


def read_initial_asset(day):
    path = f"assets/data/match-predictor/{day}.json"
    commit = subprocess.check_output(
        ["git", "log", "--reverse", "--diff-filter=A", "--format=%H", "--", path],
        text=True, encoding="utf-8",
    ).splitlines()
    if not commit:
        return None
    data = subprocess.check_output(["git", "show", f"{commit[0]}:{path}"])
    return json.loads(data)


def raw_cache(directory):
    rows = {}
    for path in sorted(directory.glob("*.json")):
        for row in json.loads(path.read_text(encoding="utf-8")):
            rows[(row["d"], str(row["id"]))] = row
    return rows


def result_cache(directory):
    rows = {}
    for path in sorted(directory.glob("*.json")):
        for row in json.loads(path.read_text(encoding="utf-8")):
            if row.get("status") == "FT" and row.get("home") is not None and row.get("away") is not None:
                rows[(path.stem, str(row["fixture_id"]))] = int(row["home"]) + int(row["away"])
    return rows


def numeric(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def corrected_probabilities(raw, market, odd, under):
    sample = max(0.0, min(numeric(raw.get("hph")) or 0,
                          numeric(raw.get("apa")) or 0))

    def mean(keys, fallback):
        values = [numeric(raw.get(key)) for key in keys]
        values = [value for value in values if value is not None]
        return sum(values) / len(values) if values else fallback

    home = (mean(["hgf", "aga"], 1.59) * sample + 1.59 * 4) / (sample + 4)
    away = (mean(["agf", "hga"], 1.32) * sample + 1.32 * 4) / (sample + 4)
    poisson = site.p_over(home + away, 3 if market == "O25" else 4)
    return site.calibrated_goal_probability(market, poisson, odd, under)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--start", default="2026-08-01")
    parser.add_argument("--end", default="2026-10-31")
    args = parser.parse_args()
    raw = raw_cache(args.cache / "raw")
    results = result_cache(args.cache / "results")
    days = sorted({day for day, _ in results if args.start <= day <= args.end})
    scored = []
    missing_asset = []
    for day in days:
        asset = read_initial_asset(day)
        if asset is None:
            missing_asset.append(day)
            continue
        for match in asset.get("matches") or []:
            key = (day, str(match.get("fixture_id")))
            if match.get("status_short") != "NS" or key not in raw or key not in results:
                continue
            kickoff = match.get("kickoff_ts")
            if not kickoff:
                continue
            local_time = datetime.fromtimestamp(int(kickoff), ZoneInfo("Europe/Dublin")).strftime("%H:%M")
            if not "11:30" <= local_time <= "20:30":
                continue
            new25_for_cap = corrected_probabilities(
                raw[key], "O25", numeric(match.get("odd_o25")),
                numeric(match.get("odd_u25")),
            )
            for market, line, odd_key, under_key, site_key in [
                ("O25", 3, "odd_o25", "odd_u25", "p_over25"),
                ("O35", 4, "odd_o35", "odd_u35", "p_over35"),
            ]:
                odd = numeric(match.get(odd_key))
                under = numeric(match.get(under_key))
                old = numeric(match.get(site_key))
                if odd is None or not 1.10 <= odd <= 20 or old is None:
                    continue
                if market == "O25" and (under is None or not 1.10 <= under <= 20):
                    continue
                new = corrected_probabilities(raw[key], market, odd, under)
                if market == "O35":
                    new = min(new25_for_cap, new)
                fair = ((1 / odd) / ((1 / odd) + (1 / under))) if market == "O25" else 1 / odd
                scored.append({"day": day, "id": key[1], "market": market, "old": old,
                               "new": new, "fair": fair,
                               "win": int(results[key] >= line), "odd": odd})
    print("missing_assets", missing_asset, flush=True)
    for month in ["2026-08", "2026-09", "2026-10"]:
        for market in ["O25", "O35"]:
            rows = [row for row in scored if row["day"].startswith(month) and row["market"] == market]
            if not rows:
                continue
            y = np.array([row["win"] for row in rows])
            print(month, market, "n", len(rows), "win_rate", round(float(y.mean()), 4),
                  "site_mean", round(float(np.mean([row["old"] for row in rows])), 4),
                  "new_mean", round(float(np.mean([row["new"] for row in rows])), 4),
                  "site_brier", round(brier_score_loss(y, [row["old"] for row in rows]), 5),
                  "new_brier", round(brier_score_loss(y, [row["new"] for row in rows]), 5),
                  "market_brier", round(brier_score_loss(y, [row["fair"] for row in rows]), 5),
                  flush=True)
        month_rows = [row for row in scored if row["day"].startswith(month)]
        for model in ["old", "new"]:
            top = []
            for day in sorted({row["day"] for row in month_rows}):
                board = [row for row in month_rows if row["day"] == day]
                board.sort(key=lambda row: row[model] * row["odd"] - 1, reverse=True)
                seen = set()
                for row in board:
                    if row["id"] in seen:
                        continue
                    top.append(row)
                    seen.add(row["id"])
                    if len(seen) == 10:
                        break
            roi = float(np.mean([row["odd"] - 1 if row["win"] else -1 for row in top]))
            print(month, model, "top10_per_day", len(top), "roi", round(roi, 4), flush=True)


if __name__ == "__main__":
    main()
