#!/usr/bin/env python3
"""
Pronostici Bomba – Live Over 1.5 Monitor Bot

Filtra ogni giorno le partite con p_over15 >= 80%, senza quote, senza
coppe/giovanili/donne, poi monitora il live ogni N minuti.
Manda una notifica ntfy quando una partita "merita" la puntata live.

Logica vitality score:
  1. Contesto punteggio  (0-0 vale di più, 1-0/0-1 ancora interessante)
  2. Minuto della partita (pic a 45-65')
  3. Probabilità pre-match (p_over15)
  4. Deficit xG           (gol attesi dal modello vs gol reali → se la partita
                           "deve" ancora segnare, sale il punteggio)
  5. Attività recente     (sostituzioni, cartellini ultimi 12')
  6. Nessun espulso       → scarta la partita
"""

import json, time, re, logging, sys
from pathlib import Path
from datetime import datetime, timezone

import requests

# ──────────────────────────────────────────────────────────────────────────────
# CONFIG  (letto da config.json nella stessa cartella)
# ──────────────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"

_DEFAULTS = {
    "ntfy_topic":       "pb-live-changeme",
    "min_prob":         0.80,
    "refresh_seconds":  300,
    "min_elapsed":      25,
    "max_elapsed":      82,
    "alert_threshold":  50,
    "cooldown_minutes": 20,
}

def load_config():
    cfg = dict(_DEFAULTS)
    if CONFIG_FILE.exists():
        try:
            cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return cfg

CFG = load_config()

CACHE_BASE = "https://pronosticibomba.com/assets/data/match-predictor"
LIVE_URL   = "https://pronostici-bomba-push.pronosticibomba.workers.dev/fixtures/live"
DETAIL_URL = "https://pronostici-bomba-push.pronosticibomba.workers.dev/fixtures/detail"
NTFY_URL   = f"https://ntfy.sh/{CFG['ntfy_topic']}"

# ──────────────────────────────────────────────────────────────────────────────
# LOGGING
# ──────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(BASE_DIR / "bot.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("pb-bot")

# ──────────────────────────────────────────────────────────────────────────────
# FILTERS
# ──────────────────────────────────────────────────────────────────────────────
_CUP_RE = re.compile(
    r"\b(cup|coppa|pokal|coupe|copa|kupa|trofeo|trophy|shield|supercoppa|supercup"
    r"|champions\sleague|europa\sleague|conference\sleague|nations\sleague"
    r"|world\scup|qualifier|qualif|play.?off|friendly|amichevole"
    r"|u17|u18|u19|u20|u21|u23|under.?1[5-9]|under.?2[0-3]"
    r"|youth|reserve|primavera|central\syouth|osprey"
    r"|fa\scup|league\scup|carabao|efl\scup)\b",
    re.I,
)
_WOMEN_LEAGUE_RE = re.compile(
    r"\b(women|woman|femme|f[eé]minine|dames|ladies|frauen|kvinner|feminino|femenino)\b",
    re.I,
)
_WOMEN_TEAM_RE = re.compile(r"\bW$")   # team name ends with space + W

LIVE_STATUSES = {"1H", "2H", "ET", "LIVE", "HT", "P", "BT", "INT"}


def _is_excluded(league: str, home: str, away: str) -> str | None:
    """Returns exclusion reason string, or None if OK."""
    if _CUP_RE.search(league):
        return "coppa/giovanile"
    if _WOMEN_LEAGUE_RE.search(league):
        return "donne (campionato)"
    if _WOMEN_TEAM_RE.search(home) or _WOMEN_TEAM_RE.search(away):
        return "donne (squadra)"
    return None


# ──────────────────────────────────────────────────────────────────────────────
# DATA FETCHING
# ──────────────────────────────────────────────────────────────────────────────
def _get(url: str, timeout: int = 15) -> dict | list | None:
    try:
        r = requests.get(url, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.warning(f"GET {url} fallito: {exc}")
        return None


def fetch_today_candidates() -> dict:
    """Returns {fixture_id_str: match_dict} for today's valid O1.5 candidates."""
    manifest = _get(f"{CACHE_BASE}/manifest.json")
    if not manifest:
        return {}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    entry = next((d for d in manifest.get("dates", []) if d["date"] == today), None)
    if not entry:
        log.warning(f"Nessuna entry manifest per {today}")
        return {}

    data = _get(f"{CACHE_BASE}/{entry['file']}", timeout=30)
    if not data:
        return {}

    candidates = {}
    skip = {"coppa": 0, "donne": 0, "prob": 0, "quota": 0}

    for m in data.get("matches", []):
        league = m.get("league", "")
        home   = m.get("home", "")
        away   = m.get("away", "")

        reason = _is_excluded(league, home, away)
        if reason:
            key = "coppa" if "coppa" in reason else "donne"
            skip[key] += 1
            continue

        prob = float(m.get("p_over15") or 0)
        if prob < CFG["min_prob"]:
            skip["prob"] += 1
            continue

        odds = float(m.get("odd_o15") or 0)
        if odds <= 1.0:
            skip["quota"] += 1
            continue

        candidates[str(m["fixture_id"])] = m

    log.info(
        f"Candidati oggi: {len(candidates)} validi "
        f"(scartati → coppe/giov: {skip['coppa']}, donne: {skip['donne']}, "
        f"prob<{CFG['min_prob']:.0%}: {skip['prob']}, senza quota: {skip['quota']})"
    )
    return candidates


def fetch_live() -> dict:
    """Returns {fixture_id_str: live_dict} for all currently live matches."""
    data = _get(LIVE_URL)
    if not data:
        return {}

    result = {}
    for f in data.get("fixtures", []):
        fid = str((f.get("fixture") or {}).get("id", ""))
        if not fid:
            continue
        status = (f.get("fixture") or {}).get("status") or {}
        goals  = f.get("goals") or {}
        score  = f.get("score") or {}
        result[fid] = {
            "status":  status.get("short", ""),
            "elapsed": status.get("elapsed") or 0,
            "home":    goals.get("home") or 0,
            "away":    goals.get("away") or 0,
            "ht_home": ((score.get("halftime") or {}).get("home")),
            "ht_away": ((score.get("halftime") or {}).get("away")),
            "events":  [
                {
                    "type":    ev.get("type", ""),
                    "detail":  ev.get("detail", ""),
                    "elapsed": (ev.get("time") or {}).get("elapsed") or 0,
                    "team":    (ev.get("team") or {}).get("name", ""),
                    "player":  (ev.get("player") or {}).get("name", ""),
                }
                for ev in (f.get("events") or [])
            ],
        }
    return result


def fetch_detail_events(fid: str) -> list:
    """More complete events list from the detail endpoint."""
    data = _get(f"{DETAIL_URL}?id={fid}", timeout=10)
    if not data:
        return []
    return data.get("events") or []


# ──────────────────────────────────────────────────────────────────────────────
# VITALITY SCORE
# ──────────────────────────────────────────────────────────────────────────────
def _red_card(events: list) -> str | None:
    for ev in events:
        if ev.get("detail") in ("Red Card", "Second Yellow Card"):
            return f"{ev.get('team', '?')} – {ev.get('player', '?')}"
    return None


def vitality(match: dict, live: dict, detail_evs: list) -> tuple:
    """
    Returns (score: int, reasons: list[str], market: str)
            or (None, [reason_str], None) if disqualified.
    """
    elapsed = live.get("elapsed") or 0
    status  = live.get("status", "").upper()
    gh      = live.get("home") or 0
    ga      = live.get("away") or 0
    total   = gh + ga
    all_evs = detail_evs or live.get("events", [])

    # ── 0. Espulsione → skip ─────────────────────────────────────────────────
    rc = _red_card(all_evs)
    if rc:
        return None, [f"❌ Espulsione: {rc}"], None

    # ── Status check ─────────────────────────────────────────────────────────
    if status == "HT":
        elapsed = 45
    elif status not in LIVE_STATUSES:
        return None, [f"Non live ({status})"], None

    # ── Finestra temporale ───────────────────────────────────────────────────
    if elapsed < CFG["min_elapsed"]:
        return None, [f"Troppo presto ({elapsed}')"], None
    if elapsed > CFG["max_elapsed"]:
        return None, [f"Troppo tardi ({elapsed}')"], None

    # ── Troppi gol → non interessante ────────────────────────────────────────
    if total > 3:
        return None, ["Troppi gol in campo"], None

    reasons: list[str] = []
    score = 0

    # ── 1. CONTESTO PUNTEGGIO ────────────────────────────────────────────────
    if total == 0:
        score  += 28
        market  = "Over 1.5"
        reasons.append(f"🔴 0-0 al {elapsed}'")
    elif total == 1:
        score  += 22
        market  = "Over 1.5"
        reasons.append(f"🟡 {gh}-{ga} al {elapsed}' (manca 1 gol)")
    elif total == 2:
        score  += 14
        market  = "Over 2.5"
        reasons.append(f"🟠 {gh}-{ga} al {elapsed}' → Over 2.5")
    else:
        score  += 8
        market  = "Over 3.5"
        reasons.append(f"⚪ {gh}-{ga} → Over 3.5")

    # ── 2. MINUTO (pic a 45-65') ─────────────────────────────────────────────
    if elapsed < 45:
        score += 10
    elif elapsed < 65:
        score += 22
    elif elapsed < 78:
        score += 15
    else:
        score += 4

    # ── 3. PROBABILITÀ PRE-MATCH ─────────────────────────────────────────────
    prob = float(match.get("p_over15") or 0)
    if prob >= 0.92:
        score += 18
        reasons.append(f"📊 Prob {prob:.0%} 🔥")
    elif prob >= 0.86:
        score += 13
        reasons.append(f"📊 Prob {prob:.0%}")
    else:
        score += 8
        reasons.append(f"📊 Prob {prob:.0%}")

    # ── 4. DEFICIT xG  (modello Poisson) ─────────────────────────────────────
    lam_h = float(match.get("lam_home") or 1.0)
    lam_a = float(match.get("lam_away") or 1.0)
    lam   = float(match.get("lam_total") or (lam_h + lam_a))
    expected_now = lam * (elapsed / 90)
    deficit = expected_now - total
    if deficit >= 1.5:
        score += 18
        reasons.append(f"⚡ xG attesi: {expected_now:.1f} vs {total} reali (+{deficit:.1f})")
    elif deficit >= 0.8:
        score += 11
        reasons.append(f"⚡ xG attesi: {expected_now:.1f} vs {total} reali (+{deficit:.1f})")
    elif deficit >= 0.3:
        score += 4

    # ── 5. QUOTA PRE-MATCH (segnale di forza) ────────────────────────────────
    odds = float(match.get("odd_o15") or 0)
    if 1.01 < odds <= 1.20:
        score += 5   # fortissimo favorito pre-match
    elif odds > 1.50:
        score += 2

    # ── 6. ATTIVITÀ RECENTE (sost/cartellini ultimi 12') ─────────────────────
    recent = [e for e in all_evs if e.get("elapsed", 0) >= elapsed - 12]
    subs   = sum(1 for e in recent if e.get("type", "").lower() in ("subst", "substitution"))
    cards  = sum(1 for e in recent if "Card" in e.get("detail", ""))
    if subs >= 2 or cards >= 2:
        score += 5
        reasons.append("🔄 Partita viva (sost./falli recenti)")

    return score, reasons, market


# ──────────────────────────────────────────────────────────────────────────────
# NOTIFICHE ntfy.sh
# ──────────────────────────────────────────────────────────────────────────────
def notify(title: str, body: str, priority: str = "high"):
    try:
        requests.post(
            NTFY_URL,
            data=body.encode("utf-8"),
            headers={
                "Title":    title.encode("utf-8"),
                "Priority": priority,
                "Tags":     "soccer,bell",
            },
            timeout=8,
        )
        log.info(f"✅ Notifica inviata: {title}")
    except Exception as exc:
        log.error(f"Notifica fallita: {exc}")


# ──────────────────────────────────────────────────────────────────────────────
# MAIN LOOP
# ──────────────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info(f"PB Live Bot  |  topic: {CFG['ntfy_topic']}")
    log.info(
        f"Filtri: prob ≥ {CFG['min_prob']:.0%}  "
        f"| min {CFG['min_elapsed']}'–max {CFG['max_elapsed']}'  "
        f"| soglia vitality {CFG['alert_threshold']}  "
        f"| refresh {CFG['refresh_seconds']}s"
    )
    log.info("=" * 60)

    notify(
        "🤖 PB Live Bot avviato",
        (
            f"Over 1.5 ≥ {CFG['min_prob']:.0%}  |  "
            f"refresh {CFG['refresh_seconds']//60} min\n"
            "Filtri: no coppe · no donne · solo con quota\n"
            "In ascolto…"
        ),
        priority="default",
    )

    candidates:  dict = {}
    loaded_date: str  = ""
    alerted:     dict = {}   # {f"{fid}:{gh}-{ga}": last_alert_ts}
    cooldown_sec = CFG["cooldown_minutes"] * 60

    while True:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Ricarica candidati se cambio data
        if loaded_date != today:
            log.info(f"Carico partite per {today}…")
            candidates  = fetch_today_candidates()
            loaded_date = today
            alerted.clear()

        if not candidates:
            log.warning("Nessun candidato valido oggi – riprovo al prossimo ciclo")
            time.sleep(CFG["refresh_seconds"])
            continue

        # Live scores
        log.info("Fetching live scores…")
        live_all  = fetch_live()
        live_mine = {fid: lv for fid, lv in live_all.items() if fid in candidates}
        log.info(f"Live: {len(live_all)} totali | {len(live_mine)} nostri candidati")

        for fid, live in live_mine.items():
            match   = candidates[fid]
            elapsed = live.get("elapsed") or 0
            gh      = live.get("home") or 0
            ga      = live.get("away") or 0
            status  = live.get("status", "").upper()
            total   = gh + ga

            # Pre-filter rapido (evita chiamata detail inutile)
            if status not in LIVE_STATUSES:
                continue
            if elapsed < CFG["min_elapsed"] or elapsed > CFG["max_elapsed"]:
                continue
            if total > 3:
                continue
            if _red_card(live.get("events", [])):
                continue

            # Detail events (più completi)
            detail_evs = fetch_detail_events(fid)
            if _red_card(detail_evs):
                log.info(f"Skip espulso: {match['home']} vs {match['away']}")
                continue

            vit, reasons, market = vitality(match, live, detail_evs)

            log.info(
                f"{match.get('home')} vs {match.get('away')}  "
                f"{gh}-{ga} {elapsed}'  vitality={vit}  market={market}"
            )

            if vit is None or vit < CFG["alert_threshold"]:
                continue

            # Cooldown dedup per stato punteggio
            state_key = f"{fid}:{gh}-{ga}"
            if time.time() - alerted.get(state_key, 0) < cooldown_sec:
                continue
            alerted[state_key] = time.time()

            # Costruisci notifica
            home   = match.get("home", "")
            away   = match.get("away", "")
            league = match.get("league", "")
            prob   = float(match.get("p_over15") or 0)
            odds   = float(match.get("odd_o15") or 0)
            lam    = float(match.get("lam_total") or 0)
            p_o25  = float(match.get("p_over25") or 0)

            extra = f"  |  Over 2.5 pre: {p_o25:.0%}" if market == "Over 2.5" else ""

            title = f"⚽ {market}  {home} vs {away}"
            body  = "\n".join([
                f"🏆 {league}",
                f"⏱ {elapsed}'  |  {gh}-{ga}",
                f"📊 Prob {prob:.0%}  |  Quota pre {odds:.2f}  |  xG {lam:.2f}{extra}",
                "─────────────────",
            ] + reasons + [
                f"\nVitality: {vit}/100",
            ])

            notify(title, body, priority="urgent" if vit >= 70 else "high")

        log.info(f"Ciclo completato. Prossimo tra {CFG['refresh_seconds']}s\n")
        time.sleep(CFG["refresh_seconds"])


if __name__ == "__main__":
    main()
