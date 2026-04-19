import re


TOP_COUNTRY_LEAGUE_ORDER = [
    ("Italy", re.compile(r"\bserie a\b", re.I), 0),
    ("England", re.compile(r"\bpremier league\b", re.I), 10),
    ("Germany", re.compile(r"\bbundesliga\b", re.I), 20),
    ("Spain", re.compile(r"\b(?:la liga|laliga)\b", re.I), 30),
    ("France", re.compile(r"\bligue 1\b", re.I), 40),
    ("Portugal", re.compile(r"\bprimeira liga\b", re.I), 50),
    ("Switzerland", re.compile(r"\bsuper league\b", re.I), 60),
    ("Netherlands", re.compile(r"\beredivisie\b", re.I), 70),
    ("Belgium", re.compile(r"\b(?:jupiler pro league|pro league)\b", re.I), 80),
    ("Norway", re.compile(r"\beliteserien\b", re.I), 90),
    ("Sweden", re.compile(r"\ballsvenskan\b", re.I), 100),
]

MAJOR_INTERNATIONAL_ORDER = [
    (re.compile(r"\b(?:uefa )?champions league\b", re.I), 120),
    (re.compile(r"\b(?:uefa )?europa league\b", re.I), 121),
    (re.compile(r"\b(?:uefa )?europa conference league\b|\bconference league\b", re.I), 122),
    (re.compile(r"\buefa super cup\b", re.I), 123),
    (re.compile(r"\b(?:fifa )?world cup\b", re.I), 130),
    (re.compile(r"\b(?:uefa )?european championship\b|\beuro\b", re.I), 131),
    (re.compile(r"\bnations league\b", re.I), 132),
    (re.compile(r"\bcopa america\b", re.I), 133),
    (re.compile(r"\bgold cup\b", re.I), 134),
    (re.compile(r"\bafrica cup of nations\b|\bafcon\b", re.I), 135),
    (re.compile(r"\basian cup\b", re.I), 136),
    (re.compile(r"\bworld cup\b.*\bqualification\b|\bqualification\b.*\bworld cup\b|\bqualifiers?\b.*\bworld cup\b|\bwc qualification\b", re.I), 140),
    (re.compile(r"\beuro\b.*\bqualification\b|\bqualification\b.*\beuro\b|\buefa euro qualifiers?\b", re.I), 141),
]

EUROPE_SECONDARY_COUNTRY_PRIORITY = {
    "Scotland": 320,
    "Wales": 330,
    "Croatia": 340,
    "Poland": 350,
    "Czechia": 360,
    "Czech-Republic": 360,
    "Austria": 370,
    "Denmark": 380,
    "Greece": 390,
    "Serbia": 400,
    "Romania": 410,
    "Turkey": 420,
    "Switzerland": 430,
    "Belgium": 440,
    "Norway": 450,
    "Sweden": 460,
}

TOP_COUNTRY_LOWER_TIER_PRIORITY = {
    "Italy": 400,
    "England": 410,
    "Germany": 420,
    "Spain": 430,
    "France": 440,
    "Portugal": 450,
    "Switzerland": 460,
    "Netherlands": 470,
    "Belgium": 480,
    "Norway": 490,
    "Sweden": 500,
}

SEMI_TOP_COUNTRIES = {
    "Netherlands",
    "Austria",
    "Switzerland",
    "Belgium",
    "Denmark",
    "Sweden",
    "Norway",
    "Poland",
    "Greece",
    "Romania",
    "Czech-Republic",
    "Croatia",
    "Serbia",
    "Turkey",
}

EUROPE_OTHER_COUNTRIES = {
    "Belarus",
    "Ukraine",
    "Slovakia",
    "Slovenia",
    "Hungary",
    "Ireland",
    "Northern-Ireland",
    "Iceland",
    "Finland",
    "Bosnia",
    "Bosnia-and-Herzegovina",
    "Montenegro",
    "Albania",
    "Bulgaria",
    "Cyprus",
    "Latvia",
    "Lithuania",
    "Estonia",
    "Luxembourg",
    "Kosovo",
    "Faroe-Islands",
    "Moldova",
    "Georgia",
    "Armenia",
    "Azerbaijan",
    "Israel",
    "Kazakhstan",
}

SOUTH_AMERICA_COUNTRIES = {
    "Brazil", "Argentina", "Chile", "Colombia", "Uruguay", "Paraguay", "Peru", "Ecuador", "Bolivia", "Venezuela",
}
ASIA_COUNTRIES = {
    "Japan", "South-Korea", "Korea Republic", "China", "China PR", "Saudi-Arabia", "Qatar", "United-Arab-Emirates",
    "Iran", "Iraq", "Jordan", "Uzbekistan", "Australia", "Thailand", "Indonesia", "India", "Vietnam", "Malaysia",
}
NORTH_AMERICA_COUNTRIES = {
    "USA", "United-States", "Mexico", "Canada", "Costa-Rica", "Panama", "Honduras", "Jamaica", "El-Salvador",
    "Guatemala", "Trinidad-and-Tobago", "Haiti", "Dominican-Republic",
}
AFRICA_COUNTRIES = {
    "Morocco", "Egypt", "Tunisia", "Algeria", "South-Africa", "Nigeria", "Ghana", "Ivory-Coast", "Cameroon", "Senegal",
    "Mali", "Burkina-Faso", "Uganda", "Kenya", "Tanzania", "Zambia", "Zimbabwe",
}

WOMEN_COMPETITION_RE = re.compile(
    r"\b(women|femminile|feminina|femenina|frauen|liga f|division 1 feminine|superliga femenina|feminine|femenil)\b",
    re.I,
)
YOUTH_OR_RESERVE_COMPETITION_RE = re.compile(
    r"\b(u17|u18|u19|u20|u21|u23|under[\s-]?(17|18|19|20|21|23)|primavera|youth|reserves?|reserve league)\b",
    re.I,
)
FRIENDLY_COMPETITION_RE = re.compile(r"\bfriendly|friendlies|amichevole|amistoso|amistosa|club friendlies\b", re.I)


def normalized_score(raw):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0.5
    if value > 1:
        value = value / 100.0
    return max(0.0, min(1.0, value))


def safe_odd(value):
    try:
        odd = float(value)
    except (TypeError, ValueError):
        return None
    if odd <= 1:
        return None
    return odd


def domestic_tier_offset(league, round_name):
    haystack = f"{league} {round_name}".lower()
    if re.search(r"serie b|championship|2\. bundesliga|segunda division|liga portugal 2|segunda liga|ligue 2|eerste divisie|challenge league|superettan|obos-ligaen", haystack, re.I):
        return 40
    if re.search(r"serie c|league one|league two|3\. liga|primera rfef|segunda rfef|third division|liga 3", haystack, re.I):
        return 80
    if re.search(r"cup|coppa|copa|pokal|coupe|trophy", haystack, re.I):
        return 60
    return 0


def get_league_rank(match):
    league = str(match.get("league") or "")
    country = str(match.get("country") or "")
    round_name = str(match.get("league_round") or match.get("round") or "")
    haystack = f"{league} {country} {round_name}"
    women_penalty = 2000 if WOMEN_COMPETITION_RE.search(f"{league} {round_name}") else 0
    youth_penalty = 3000 if YOUTH_OR_RESERVE_COMPETITION_RE.search(f"{league} {round_name}") else 0
    friendly_penalty = 4000 if FRIENDLY_COMPETITION_RE.search(f"{league} {round_name}") else 0
    total_penalty = women_penalty + youth_penalty + friendly_penalty
    tier_offset = domestic_tier_offset(league, round_name)

    for top_country, pattern, rank in TOP_COUNTRY_LEAGUE_ORDER:
        if country == top_country and pattern.search(league):
            return rank + total_penalty

    for pattern, rank in MAJOR_INTERNATIONAL_ORDER:
        if pattern.search(haystack):
            return rank + total_penalty

    if country in EUROPE_SECONDARY_COUNTRY_PRIORITY:
        return EUROPE_SECONDARY_COUNTRY_PRIORITY[country] + tier_offset + total_penalty
    if country in TOP_COUNTRY_LOWER_TIER_PRIORITY:
        return TOP_COUNTRY_LOWER_TIER_PRIORITY[country] + tier_offset + total_penalty
    if country in SEMI_TOP_COUNTRIES or country in EUROPE_OTHER_COUNTRIES:
        return 560 + tier_offset + total_penalty
    if country in SOUTH_AMERICA_COUNTRIES:
        return 600 + tier_offset + total_penalty
    if country in ASIA_COUNTRIES:
        return 700 + tier_offset + total_penalty
    if country in NORTH_AMERICA_COUNTRIES:
        return 800 + tier_offset + total_penalty
    if country in AFRICA_COUNTRIES:
        return 900 + tier_offset + total_penalty
    return 1000 + tier_offset + total_penalty


def is_pinned_competition(match):
    return get_league_rank(match) < 200


def build_match_candidates(match):
    candidates = []

    def push(group, label, confidence, odd=None, short=None):
        if not label:
            return
        normalized = normalized_score(confidence)
        if normalized <= 0:
            return
        candidates.append({
            "group": group,
            "label": label,
            "short": short or label,
            "confidence": normalized,
            "odd": safe_odd(odd),
        })

    ou15_pick = str(match.get("ou15_pick") or "")
    ou_pick = str(match.get("ou_pick") or "")
    ou35_pick = str(match.get("ou35_pick") or "")
    ht15_pick = str(match.get("ht15_pick") or "")
    sh15_pick = str(match.get("sh15_pick") or "")
    dc_pick = str(match.get("dc_pick") or "")
    btts_pick = str(match.get("btts_pick") or "")

    push("goals", ou15_pick, match.get("ou15_conf"), match.get("odd_o15") if "Over" in ou15_pick else match.get("odd_u15"), ou15_pick.replace("Over ", "O").replace("Under ", "U"))
    push("goals", ou_pick, match.get("ou_conf"), match.get("odd_o25") if "Over" in ou_pick else match.get("odd_u25"), ou_pick.replace("Over ", "O").replace("Under ", "U"))
    push("goals", ou35_pick, match.get("ou35_conf"), match.get("odd_o35") if "Over" in ou35_pick else match.get("odd_u35"), ou35_pick.replace("Over ", "O").replace("Under ", "U"))
    push("halves", ht15_pick, match.get("ht15_conf"), match.get("odd_o15_ht") if "Over" in ht15_pick else match.get("odd_u15_ht"), ht15_pick.replace("Over ", "O").replace("Under ", "U"))
    push("halves", sh15_pick, match.get("sh15_conf"), match.get("odd_o15_sh") if "Over" in sh15_pick else match.get("odd_u15_sh"), sh15_pick.replace("Over ", "O").replace("Under ", "U"))
    push("dc", dc_pick, match.get("dc_conf"), match.get("odd_1x") if dc_pick == "1X" else match.get("odd_x2"))
    push("btts", "BTTS" if btts_pick == "BTTS YES" else ("No BTTS" if btts_pick else ""), match.get("btts_conf"), match.get("odd_btts_y") if btts_pick == "BTTS YES" else match.get("odd_btts_n"))

    try:
        combo_probability = float(match.get("p_o25_btts"))
    except (TypeError, ValueError):
        combo_probability = None
    if combo_probability is not None:
        push("combo", "O2.5 + BTTS", combo_probability, None, "O2.5+GG")

    nogol_team = str(match.get("nogol_team") or "")
    if nogol_team:
        try:
            conf = max(float(match.get("p_home_blanked") or 0), float(match.get("p_away_blanked") or 0))
        except (TypeError, ValueError):
            conf = 0
        push("ng", f"No goal {nogol_team}", conf, None, "No goal")

    for line, probability in (match.get("corner_overs") or {}).items():
        try:
            line_value = float(line)
            probability_value = float(probability)
        except (TypeError, ValueError):
            continue
        if line_value < 7.5:
            continue
        odds_row = ((match.get("corner_odds") or {}).get(line) or {})
        push("corners", f"Over {line}", probability_value, odds_row.get("over"), f"O {line}")

    for line, probability in (match.get("yellow_overs") or {}).items():
        try:
            line_value = float(line)
            probability_value = float(probability)
        except (TypeError, ValueError):
            continue
        if line_value < 2.5:
            continue
        odds_row = ((match.get("yellow_odds") or {}).get(line) or {})
        push("cards", f"Over {line}", probability_value, odds_row.get("over"), f"O {line}")

    return candidates


def build_match_search_text(match, candidates=None):
    candidate_labels = [str(candidate.get("label") or "") for candidate in (candidates or [])]
    parts = [
        match.get("home"),
        match.get("away"),
        match.get("league"),
        match.get("country"),
        match.get("ou15_pick"),
        match.get("ou_pick"),
        match.get("ou35_pick"),
        match.get("ht15_pick"),
        match.get("sh15_pick"),
        match.get("dc_pick"),
        match.get("btts_pick"),
        *candidate_labels,
    ]
    return " ".join(str(part).strip() for part in parts if part).lower()


def build_kickoff_time_key(match):
    kickoff_at = str(match.get("kickoff_at") or "")
    if len(kickoff_at) >= 16:
        return kickoff_at[11:16]
    return str(match.get("match_time") or "00:00")[:5]


def build_app_match(match):
    item = dict(match)
    candidates = build_match_candidates(item)
    item["rank"] = get_league_rank(item)
    item["pinnedCompetition"] = is_pinned_competition(item)
    item["kickoffTimeKey"] = build_kickoff_time_key(item)
    item["candidates"] = candidates
    item["searchText"] = build_match_search_text(item, candidates)
    return item


def build_app_payload(payload):
    return {
        "date": payload.get("date"),
        "time_range": payload.get("time_range"),
        "generated_at": payload.get("generated_at"),
        "refreshed_at": payload.get("refreshed_at"),
        "expires_at": payload.get("expires_at"),
        "timezone": payload.get("timezone"),
        "total_matches": payload.get("total_matches", 0),
        "matches": [build_app_match(match) for match in (payload.get("matches") or [])],
    }
