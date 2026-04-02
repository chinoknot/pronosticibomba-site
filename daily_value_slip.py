#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

try:
    import pandas as pd
except Exception:
    pd = None


@dataclass
class PickRow:
    position: int
    match_date: str
    fixture_id: str
    kickoff: str
    home: str
    away: str
    league: str
    country: str
    label: str
    odd: float
    probability: float
    tag: str
    profile: str
    slip_size: int
    source_date: str


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate daily Match Center value slip (max 20)")
    p.add_argument("--source-repo", required=True, help="Path to pronosticibomba-site checkout")
    p.add_argument("--work-repo", required=True, help="Path to isolated working copy")
    p.add_argument("--date", required=True, help="Target date YYYY-MM-DD")
    p.add_argument("--python-exe", default=sys.executable, help="Python executable")
    p.add_argument("--output-dir", default="", help="Optional output dir")
    return p.parse_args()


def copy_repo_isolated(source_repo: Path, work_repo: Path) -> None:
    if work_repo.exists():
        shutil.rmtree(work_repo)
    shutil.copytree(
        source_repo,
        work_repo,
        ignore=shutil.ignore_patterns(
            ".git", ".github", "node_modules", "dist", "build", "__pycache__", "*.pyc"
        ),
    )


def run_match_predictor(work_repo: Path, day: str, python_exe: str) -> None:
    script = work_repo / "match_predictor.py"
    if not script.exists():
        raise FileNotFoundError(f"match_predictor.py not found in {work_repo}")
    cmd = [python_exe, str(script), day, "00:00", "23:59"]
    subprocess.run(cmd, cwd=str(work_repo), check=True)


def find_free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    _, port = sock.getsockname()
    sock.close()
    return int(port)


def start_http_server(root: Path, port: int) -> subprocess.Popen:
    cmd = [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"]
    return subprocess.Popen(cmd, cwd=str(root), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def parse_pick_text(block_text: str, source_date: str, position: int) -> Optional[PickRow]:
    text = "\n".join(line.strip() for line in block_text.splitlines() if line.strip())
    lines = text.splitlines()
    if len(lines) < 3:
        return None

    kickoff_match = re.search(r"^(\d{2}:\d{2})\s+#\d+", lines[0])
    kickoff = kickoff_match.group(1) if kickoff_match else ""

    line2 = lines[1]
    prob_match = re.search(r"\|\s*([0-9]+(?:\.[0-9]+)?)%\s*$", line2)
    probability = float(prob_match.group(1)) if prob_match else math.nan
    left = line2[: prob_match.start()].strip() if prob_match else line2

    if " vs " not in left:
        return None
    home, remainder = left.split(" vs ", 1)

    parts = [p.strip() for p in remainder.split("|")]
    country = parts[-2] if len(parts) >= 2 else ""
    left_part = parts[0].strip() if parts else remainder.strip()

    market_starts = ["Over", "Under", "BTTS", "1X", "X2", "12", "Home", "Away", "No"]
    tokens = left_part.split()
    market_idx = None
    for idx, token in enumerate(tokens):
        if any(token.startswith(prefix) for prefix in market_starts):
            market_idx = idx
            break
    if market_idx is None:
        return None

    away = " ".join(tokens[:market_idx]).strip()
    tail = tokens[market_idx:]
    if not away or not tail:
        return None

    label = " ".join(tail[: min(5, len(tail))]).strip()
    league = ""
    for cut in range(1, len(tail) + 1):
        candidate_label = " ".join(tail[:cut]).strip()
        candidate_league = " ".join(tail[cut:]).strip()
        if candidate_league:
            label = candidate_label
            league = candidate_league
            break

    odd_match = re.search(r"@\s*([0-9]+(?:\.[0-9]+)?)", text)
    odd = float(odd_match.group(1)) if odd_match else math.nan

    tag = ""
    for line in lines[2:]:
        if line.lower().startswith("value") or line.lower().startswith("safe") or line.lower().startswith("balanced"):
            tag = line.strip()
            break

    return PickRow(
        position=position,
        match_date=source_date,
        fixture_id="",
        kickoff=kickoff,
        home=home.strip(),
        away=away.strip(),
        league=league.strip(),
        country=country.strip(),
        label=label.strip(),
        odd=odd,
        probability=probability,
        tag=tag,
        profile="value",
        slip_size=20,
        source_date=source_date,
    )


def scrape_value_slip_with_playwright(base_url: str, source_date: str) -> List[PickRow]:
    from playwright.sync_api import sync_playwright

    out: List[PickRow] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 2200})
        page.goto(urljoin(base_url, "match-center.html"), wait_until="networkidle", timeout=120000)

        selected = False
        date_select = page.locator("#date-select")
        if date_select.count():
            try:
                page.select_option("#date-select", source_date)
                page.dispatch_event("#date-select", "change")
                selected = True
                page.wait_for_timeout(1200)
            except Exception:
                selected = False
        if not selected:
            tabs = page.locator("#date-tabs .date-tab")
            for i in range(tabs.count()):
                text = tabs.nth(i).inner_text().strip()
                if source_date in text:
                    tabs.nth(i).click()
                    page.wait_for_timeout(1200)
                    selected = True
                    break

        # count = 20
        if page.locator("#bet-master-count-display").count():
            for _ in range(24):
                current = page.locator("#bet-master-count-display").inner_text().strip()
                try:
                    if int(current) >= 20:
                        break
                except Exception:
                    pass
                page.locator('[data-bet-master-step="1"]').click(force=True)
                page.wait_for_timeout(60)

        # profile = value
        profile_chips = page.locator("#bet-master-profile-chips button, #bet-master-profile-chips .chip-btn, #bet-master-profile-chips .preset-chip")
        for i in range(profile_chips.count()):
            txt = profile_chips.nth(i).inner_text().strip().lower()
            if "value" in txt:
                try:
                    profile_chips.nth(i).click(force=True)
                except Exception:
                    profile_chips.nth(i).evaluate("el => el.click()")
                page.wait_for_timeout(300)
                break

        # full-day window robustly
        if page.locator("#bet-master-time-custom").count():
            try:
                page.locator("#bet-master-time-custom").click(force=True)
            except Exception:
                page.locator("#bet-master-time-custom").evaluate("el => el.click()")
            page.wait_for_timeout(300)

        if page.locator("#bet-master-time-from").count():
            page.locator("#bet-master-time-from").evaluate(
                """(el, value) => {
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                "00:00",
            )
        if page.locator("#bet-master-time-to").count():
            page.locator("#bet-master-time-to").evaluate(
                """(el, value) => {
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                "23:59",
            )

        page.locator("#bet-master-generate").click(force=True)
        page.wait_for_timeout(2500)

        result_box = page.locator("#bet-master-results")
        text = result_box.inner_text(timeout=30000)
        blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
        for pos, block in enumerate(blocks[:20], start=1):
            pick = parse_pick_text(block, source_date=source_date, position=pos)
            if pick is not None:
                out.append(pick)
        browser.close()
    return out[:20]


def enrich_fixture_ids_from_cache(work_repo: Path, picks: List[PickRow], source_date: str) -> List[PickRow]:
    cache_file = work_repo / "assets" / "data" / "match-predictor" / f"{source_date}.json"
    if not cache_file.exists():
        return picks
    payload = json.loads(cache_file.read_text(encoding="utf-8"))
    matches = payload.get("matches") or []

    for pick in picks:
        for match in matches:
            if str(match.get("home") or "").strip() != pick.home:
                continue
            if str(match.get("away") or "").strip() != pick.away:
                continue
            local_time = str(match.get("match_time") or match.get("localMatchTime") or "").strip()
            if pick.kickoff and local_time and local_time != pick.kickoff:
                continue
            fid = str(match.get("fixture_id") or "").strip()
            if fid:
                pick.fixture_id = fid
                pick.league = str(match.get("league") or pick.league)
                pick.country = str(match.get("country") or pick.country)
                break
    return picks


def build_outputs(picks: List[PickRow], output_dir: Path, target_date: str) -> Dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = [asdict(p) for p in picks]

    json_path = output_dir / f"value_slip_{target_date}.json"
    csv_path = output_dir / f"value_slip_{target_date}.csv"
    summary_path = output_dir / f"value_slip_{target_date}_summary.json"
    xlsx_path = output_dir / f"value_slip_{target_date}.xlsx"

    json_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        writer.writerows(rows)

    probs = [float(p.probability) for p in picks if not math.isnan(p.probability)]
    odds = [float(p.odd) for p in picks if not math.isnan(p.odd)]
    summary = {
        "target_date": target_date,
        "generated_at_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "profile": "value",
        "max_picks": 20,
        "actual_picks": len(picks),
        "avg_probability": round(sum(probs) / len(probs), 2) if probs else None,
        "min_probability": round(min(probs), 2) if probs else None,
        "max_probability": round(max(probs), 2) if probs else None,
        "avg_odd": round(sum(odds) / len(odds), 3) if odds else None,
        "min_odd": round(min(odds), 3) if odds else None,
        "max_odd": round(max(odds), 3) if odds else None,
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    if pd is not None:
        with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
            pd.DataFrame(rows).to_excel(writer, index=False, sheet_name="value_slip")
            pd.DataFrame([summary]).to_excel(writer, index=False, sheet_name="summary")

    outputs = {"json": json_path, "csv": csv_path, "summary": summary_path}
    if pd is not None:
        outputs["xlsx"] = xlsx_path
    return outputs


def main() -> int:
    args = parse_args()
    source_repo = Path(args.source_repo).expanduser().resolve()
    work_repo = Path(args.work_repo).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else work_repo / "_value_slip_daily_output"

    if not source_repo.exists():
        raise FileNotFoundError(f"Source repo not found: {source_repo}")
    if not (source_repo / "match_predictor.py").exists():
        raise FileNotFoundError(f"match_predictor.py not found in: {source_repo}")

    print(f"# Copying repo to isolated workdir: {work_repo}")
    copy_repo_isolated(source_repo, work_repo)

    print(f"# Running match_predictor for {args.date}")
    run_match_predictor(work_repo, args.date, args.python_exe)

    port = find_free_port()
    server = start_http_server(work_repo, port)
    base_url = f"http://127.0.0.1:{port}/"
    print(f"# Local server: {base_url}")

    try:
        print(f"# Extracting daily value slip for {args.date}")
        picks = scrape_value_slip_with_playwright(base_url=base_url, source_date=args.date)
        picks = enrich_fixture_ids_from_cache(work_repo, picks, args.date)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()

    print(f"# Picks extracted: {len(picks)}")
    outputs = build_outputs(picks, output_dir, args.date)
    print("# Done")
    for name, path in outputs.items():
        print(f"- {name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
