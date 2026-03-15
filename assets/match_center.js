(() => {
  const LIVE_STATUSES = new Set(["1H", "2H", "ET", "LIVE", "HT", "P", "BT", "INT"]);
  const FINAL_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
  const CACHE_BASE = "/assets/data/match-predictor";
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  const PAGE_LANG = String(document.documentElement.lang || "it").toLowerCase();
  const IS_EN = PAGE_LANG.startsWith("en");
  const APP_LOCALE = IS_EN ? "en-GB" : "it-IT";
  const DEFAULTS = { minProbability: 55, maxProbability: 99, oddFrom: 1.01, oddTo: 10, timeFrom: "00:00", timeTo: "23:59" };
  const ODD_PRESETS = [
    { id: "all", label: IS_EN ? "All" : "Tutte", from: 1.01, to: 10 },
    { id: "band_101_120", label: "1.01-1.20", from: 1.01, to: 1.2 },
    { id: "band_120_140", label: "1.20-1.40", from: 1.2, to: 1.4 },
    { id: "band_140_150", label: "1.40-1.50", from: 1.4, to: 1.5 },
    { id: "band_150_170", label: "1.50-1.70", from: 1.5, to: 1.7 },
    { id: "band_170_200", label: "1.70-2.00", from: 1.7, to: 2 },
    { id: "lt_200", label: "< 2.00", from: 1.01, to: 2 },
    { id: "lt_300", label: "< 3.00", from: 1.01, to: 3 },
  ];
  const PROBABILITY_PRESETS = [60, 65, 70, 75, 80];
  const PROBABILITY_OPTIONS = [45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99];
  const ODD_OPTIONS = [1.01, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.25, 2.5, 3, 4, 5, 7.5, 10];
  const TOTAL_MARKET_RULES = {
    corners: { strongMin: 0.50, softMin: 0.44, impactLine: 12.5 },
    yellows: { strongMin: 0.50, softMin: 0.42, impactLine: 5.5 },
  };
  const GROUPS = [
    { id: "goals", short: "O/U", label: "Goal" },
    { id: "double", short: "DC", label: "Doppia chance" },
    { id: "btts", short: "BTTS", label: "BTTS" },
    { id: "combo", short: "COMBO", label: "Combo" },
    { id: "blank", short: "NG", label: "No goal" },
    { id: "corners", short: "CRN", label: "Corner" },
    { id: "yellows", short: "YC", label: "Cartellini" },
  ];
  const QUICK_GROUPS = [
    { id: "all", label: "Top pronostici", note: "Tutti" },
    { id: "goals", label: "Goal", note: "O/U" },
    { id: "double", label: "1X2 / DC", note: "Doppia" },
    { id: "btts", label: "Entrambe segnano", note: "BTTS" },
    { id: "corners", label: "Corner", note: "Linee" },
    { id: "yellows", label: "Cartellini", note: "Linee" },
    { id: "blank", label: "No goal", note: "NG" },
    { id: "combo", label: "Combo", note: "Mix" },
  ];
  const HIGH_TEMPO_COUNTRIES = new Set(["Germany", "Austria", "Switzerland", "Belgium", "Netherlands", "Turkey", "Denmark", "Sweden", "Norway"]);
  const OUTCOME_FILTERS = [
    { id: "goals_o15", group: "goals", marketId: "ou15", label: "Over 1.5" },
    { id: "goals_u15", group: "goals", marketId: "ou15", label: "Under 1.5" },
    { id: "goals_o25", group: "goals", marketId: "ou25", label: "Over 2.5" },
    { id: "goals_u25", group: "goals", marketId: "ou25", label: "Under 2.5" },
    { id: "goals_o35", group: "goals", marketId: "o35", label: "Over 3.5" },
    { id: "goals_u35", group: "goals", marketId: "o35", label: "Under 3.5" },
    ...[7.5, 8.5, 9.5, 10.5, 11.5, 12.5].map(line => ({ id: `corners_o_${String(line).replace(".", "")}`, group: "corners", marketId: "corners", label: `Over ${line.toFixed(1)}` })),
    ...[12.5, 11.5, 10.5, 9.5].map(line => ({ id: `corners_u_${String(line).replace(".", "")}`, group: "corners", marketId: "corners", label: `Under ${line.toFixed(1)}` })),
    ...[1.5, 2.5, 3.5, 4.5, 5.5].map(line => ({ id: `yellows_o_${String(line).replace(".", "")}`, group: "yellows", marketId: "yellows", label: `Over ${line.toFixed(1)}` })),
    ...[5.5, 4.5, 3.5, 2.5, 1.5].map(line => ({ id: `yellows_u_${String(line).replace(".", "")}`, group: "yellows", marketId: "yellows", label: `Under ${line.toFixed(1)}` })),
  ];
  const STATUS_OPTIONS = [
    { id: "all", label: IS_EN ? "All" : "Tutti" },
    { id: "scheduled", label: IS_EN ? "Upcoming" : "Da giocare" },
    { id: "live", label: "Live" },
    { id: "win", label: IS_EN ? "Won" : "Vinta" },
    { id: "lose", label: IS_EN ? "Lost" : "Persa" },
  ];
  const QUICK_RANGES = [
    { id: "all_day", label: "Tutto il giorno", from: "00:00", to: "23:59" },
    { id: "morning", label: "Mattina", from: "06:00", to: "11:59" },
    { id: "afternoon", label: "Pomeriggio", from: "12:00", to: "17:59" },
    { id: "evening", label: "Sera", from: "18:00", to: "23:59" },
  ];
  const COUNTRY_PRIORITY = new Map([
    ["Italy", 0],
    ["England", 10],
    ["Germany", 20],
    ["France", 30],
    ["Spain", 40],
    ["Portugal", 50],
    ["Netherlands", 60],
    ["Belgium", 70],
    ["Turkey", 80],
    ["Scotland", 90],
    ["Austria", 100],
    ["Switzerland", 110],
    ["Denmark", 120],
    ["Sweden", 130],
    ["Norway", 140],
    ["Czech-Republic", 150],
    ["Greece", 160],
    ["Poland", 170],
    ["Croatia", 180],
    ["Serbia", 190],
    ["Ukraine", 200],
  ]);
  const FEATURED_COUNTRY_PRIORITY = new Map([
    ["Netherlands", 0],
    ["Belgium", 10],
    ["Turkey", 20],
    ["Scotland", 30],
    ["Austria", 40],
    ["Switzerland", 50],
    ["Denmark", 60],
    ["Sweden", 70],
    ["Norway", 80],
    ["Greece", 90],
    ["Czech-Republic", 100],
    ["Poland", 110],
    ["Ukraine", 120],
    ["Croatia", 130],
    ["Serbia", 140],
  ]);
  const EUROPEAN_COUNTRIES = new Set([
    "Italy", "England", "Spain", "Germany", "France", "Portugal", "Netherlands", "Belgium", "Scotland", "Turkey",
    "Austria", "Switzerland", "Denmark", "Sweden", "Norway", "Poland", "Czech-Republic", "Croatia", "Serbia",
    "Romania", "Greece", "Ukraine", "Hungary", "Slovakia", "Slovenia", "Ireland", "Northern-Ireland", "Wales",
  ]);
  const LEAGUE_PRIORITY_RULES = [
    [/^serie a$/i, 0],
    [/^premier league$/i, 10],
    [/^bundesliga$/i, 20],
    [/^ligue 1$/i, 30],
    [/^primeira liga$/i, 40],
    [/^serie b$/i, 50],
    [/serie a women/i, 51],
    [/campionato primavera|primavera/i, 52],
    [/serie c/i, 53],
    [/coppa italia|super cup/i, 54],
    [/championship/i, 60],
    [/league one/i, 61],
    [/league two/i, 62],
    [/fa cup|league cup|efl cup/i, 63],
    [/u18 premier league|premier league 2/i, 64],
    [/la liga|laliga/i, 70],
    [/segunda/i, 71],
    [/2\. bundesliga/i, 80],
    [/^ligue 2$/i, 90],
    [/liga portugal 2|segunda liga/i, 100],
    [/champions league|europa league|conference league/i, 60],
  ];
  const TOP_LEAGUE_RULES = [
    [/^serie a$/i, 0],
    [/^premier league$/i, 1],
    [/^bundesliga$/i, 2],
    [/^ligue 1$/i, 3],
    [/^la liga/i, 4],
    [/^primeira liga$/i, 5],
  ];
  const TOP_COUNTRY_PRIORITY = new Map([
    ["Italy", 0],
    ["England", 10],
    ["Germany", 20],
    ["France", 30],
    ["Spain", 40],
    ["Portugal", 50],
  ]);
  const TEXT = {
    noCache: "La cache predictor non e ancora stata generata dal workflow.",
    empty: "Nessun dato disponibile per i filtri selezionati.",
    noMarketSelected: "Seleziona almeno un mercato per vedere i risultati.",
    final: "Finale",
    odds: "Quota",
    confidence: "Conf.",
    expected: "Expected",
    actual: "Finale",
    teamBlank: "non segna",
    today: "Oggi",
    tomorrow: "Domani",
    yesterday: "Ieri",
    viewMatch: "Apri match",
    matches: "match",
    markets: "mercati",
    filterSearch: "Ricerca",
    filterTime: "Orario",
    filterProbability: "Probabilita",
    filterOdd: "Quota",
    filterStatus: "Esito",
    filterMarkets: "Mercati",
    detailPrimary: "Pick principale",
    detailScores: "Score piu probabili",
    liveWord: "live",
    finalWord: "finali",
    wonWord: IS_EN ? "Won" : "Vinta",
    lostWord: IS_EN ? "Lost" : "Persa",
  };
  const state = {
    manifest: null,
    selectedDate: "",
    cache: null,
    sortMode: "priority",
    groups: new Set(GROUPS.map(group => group.id)),
    status: "all",
    minProbability: DEFAULTS.minProbability,
    maxProbability: DEFAULTS.maxProbability,
    oddActive: false,
    oddFrom: DEFAULTS.oddFrom,
    oddTo: DEFAULTS.oddTo,
    search: "",
    timeFrom: DEFAULTS.timeFrom,
    timeTo: DEFAULTS.timeTo,
    filterOpen: false,
    outcomeFilters: new Set(),
    detailFixtureId: null,
  };
  const dom = {
    dateTabs: document.getElementById("date-tabs"),
    dateSelect: document.getElementById("date-select"),
    yesterdayBanner: document.getElementById("yesterday-banner"),
    yesterdayBannerTitle: document.getElementById("yesterday-banner-title"),
    yesterdayBannerMeta: document.getElementById("yesterday-banner-meta"),
    searchInput: document.getElementById("search-input"),
    feedStateTitle: document.getElementById("feed-state-title"),
    feedStateSubtitle: document.getElementById("feed-state-subtitle"),
    sortToggle: document.getElementById("sort-toggle"),
    sortToggleValue: document.getElementById("sort-toggle-value"),
    marketRail: document.getElementById("market-rail"),
    outcomeRail: document.getElementById("outcome-rail"),
    inlineFilterBoard: document.getElementById("inline-filter-board"),
    summaryTimeValue: document.getElementById("summary-time-value"),
    summaryStatusValue: document.getElementById("summary-status-value"),
    searchLauncher: document.getElementById("search-launcher"),
    dateJump: document.getElementById("date-jump"),
    filterLauncher: document.getElementById("filter-launcher"),
    filterToggle: document.getElementById("filter-toggle"),
    filterCount: document.getElementById("filter-count"),
    filterSheet: document.getElementById("filter-sheet"),
    filterSheetClose: document.getElementById("filter-sheet-close"),
    quickRangeChips: document.getElementById("quick-range-chips"),
    timeFrom: document.getElementById("time-from"),
    timeTo: document.getElementById("time-to"),
    probabilityPresets: document.getElementById("probability-presets"),
    probabilityMinInput: document.getElementById("probability-min-input"),
    probabilityMaxInput: document.getElementById("probability-max-input"),
    probabilityValue: document.getElementById("probability-value"),
    oddFrom: document.getElementById("odd-from"),
    oddTo: document.getElementById("odd-to"),
    oddValue: document.getElementById("odd-value"),
    oddPresets: document.getElementById("odd-presets"),
    resetFilters: document.getElementById("reset-filters"),
    marketsAll: document.getElementById("markets-all"),
    marketsNone: document.getElementById("markets-none"),
    marketChips: document.getElementById("market-chips"),
    statusChips: document.getElementById("status-chips"),
    topPicks: document.getElementById("top-picks"),
    topPicksWin: document.getElementById("top-picks-win"),
    topPicksLose: document.getElementById("top-picks-lose"),
    activeFilters: document.getElementById("active-filters"),
    leagueFeed: document.getElementById("league-feed"),
    detailShell: document.getElementById("match-detail-shell"),
    detailClose: document.getElementById("match-detail-close"),
    detailOverlay: document.getElementById("match-detail-overlay"),
    detailBody: document.getElementById("match-detail"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatPercent(value) {
    if (value == null || Number.isNaN(Number(value))) return "-";
    return `${Math.round(Number(value) * 100)}%`;
  }

  function formatOdd(value) {
    if (value == null || value === "") return "-";
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : String(value);
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function formatOddRange(fromValue, toValue) {
    const from = Number(fromValue);
    const to = Number(toValue);
    if (from <= DEFAULTS.oddFrom && to >= DEFAULTS.oddTo) return "Tutte";
    return `${from.toFixed(2)}-${to.toFixed(2)}`;
  }

  function formatProbabilityRange(fromValue, toValue) {
    const from = Number(fromValue);
    const to = Number(toValue);
    if (from <= DEFAULTS.minProbability && to >= DEFAULTS.maxProbability) return "Tutte";
    return `${Math.round(from)}%-${Math.round(to)}%`;
  }

  function outcomeFiltersForGroup(groupId) {
    return OUTCOME_FILTERS.filter(filter => filter.group === groupId);
  }

  function selectedOutcomeFiltersForGroup(groupId) {
    return outcomeFiltersForGroup(groupId).filter(filter => state.outcomeFilters.has(filter.id));
  }

  function visibleOutcomeGroups() {
    const allowed = new Set(["goals", "corners", "yellows"]);
    if (state.groups.size === GROUPS.length) return GROUPS.filter(group => allowed.has(group.id));
    const active = GROUPS.filter(group => allowed.has(group.id) && state.groups.has(group.id));
    return active.length ? active : GROUPS.filter(group => allowed.has(group.id));
  }

  function pruneOutcomeFilters() {
    const allowedGroups = state.groups.size === GROUPS.length ? null : new Set([...state.groups]);
    if (!allowedGroups) return;
    state.outcomeFilters = new Set([...state.outcomeFilters].filter(id => {
      const filter = OUTCOME_FILTERS.find(item => item.id === id);
      return filter && allowedGroups.has(filter.group);
    }));
  }

  function formatDate(dateStr, options) {
    if (!dateStr) return "-";
    return new Intl.DateTimeFormat(APP_LOCALE, options).format(new Date(`${dateStr}T00:00:00`));
  }

  function formatDateTime(isoValue) {
    if (!isoValue) return "-";
    return new Intl.DateTimeFormat(APP_LOCALE, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(isoValue));
  }

  function todayIso(timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function shiftIso(dateStr, days) {
    const date = new Date(`${dateStr}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function cacheBust(url) {
    return `${url}?v=${Date.now()}`;
  }

  async function fetchJson(url) {
    const response = await fetch(cacheBust(url), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function buildTimeOptions() {
    const values = [];
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 30) {
        values.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
      }
    }
    values.push("23:59");
    return [...new Set(values)];
  }

  function populateTimeSelects() {
    const options = buildTimeOptions();
    const render = value => options.map(option => `<option value="${option}"${option === value ? " selected" : ""}>${option}</option>`).join("");
    dom.timeFrom.innerHTML = render(state.timeFrom);
    dom.timeTo.innerHTML = render(state.timeTo);
  }

  function populateProbabilitySelects() {
    if (!dom.probabilityMinInput || !dom.probabilityMaxInput) return;
    const render = value => PROBABILITY_OPTIONS.map(option => `<option value="${option}"${Number(option) === Number(value) ? " selected" : ""}>${option}%</option>`).join("");
    dom.probabilityMinInput.innerHTML = render(state.minProbability);
    dom.probabilityMaxInput.innerHTML = render(state.maxProbability);
  }

  function populateOddSelects() {
    if (!dom.oddFrom || !dom.oddTo) return;
    const render = value => ODD_OPTIONS.map(option => `<option value="${formatOdd(option)}"${Number(option) === Number(value) ? " selected" : ""}>${formatOdd(option)}</option>`).join("");
    dom.oddFrom.innerHTML = render(state.oddFrom);
    dom.oddTo.innerHTML = render(state.oddTo);
  }

  function activeOddPresetId() {
    if (!state.oddActive) return "all";
    return ODD_PRESETS.find(preset => preset.id !== "all" && Number(preset.from) === Number(state.oddFrom) && Number(preset.to) === Number(state.oddTo))?.id || "";
  }

  function renderOddPresetChips() {
    const markup = ODD_PRESETS.map(preset => `<button type="button" class="preset-chip ${preset.id === activeOddPresetId() ? "active" : ""}" data-odd-preset="${preset.id}">${preset.label}</button>`).join("");
    if (dom.oddPresets) dom.oddPresets.innerHTML = markup;
  }

  function renderProbabilityPresetChips() {
    if (!dom.probabilityPresets) return;
    const activeId = state.maxProbability === DEFAULTS.maxProbability
      ? `min_${state.minProbability}`
      : "";
    dom.probabilityPresets.innerHTML = [
      `<button type="button" class="preset-chip ${state.minProbability === DEFAULTS.minProbability && state.maxProbability === DEFAULTS.maxProbability ? "active" : ""}" data-probability-preset="all">Tutte</button>`,
      ...PROBABILITY_PRESETS.map(value => `<button type="button" class="preset-chip ${activeId === `min_${value}` ? "active" : ""}" data-probability-preset="${value}">${value}%+</button>`),
    ].join("");
  }

  function focusedOutcomeGroup() {
    if (state.groups.size === 1) {
      const [groupId] = [...state.groups];
      if (["goals", "corners", "yellows"].includes(groupId)) return groupId;
    }
    if (state.outcomeFilters.size) {
      const activeGroups = [...new Set(OUTCOME_FILTERS.filter(filter => state.outcomeFilters.has(filter.id)).map(filter => filter.group))];
      if (activeGroups.length === 1) return activeGroups[0];
    }
    return "";
  }

  function renderQuickMarketRail() {
    if (!dom.marketRail) return;
    const singleGroup = state.groups.size === 1 ? [...state.groups][0] : "";
    dom.marketRail.innerHTML = QUICK_GROUPS.map(group => {
      const active = group.id === "all" ? state.groups.size === GROUPS.length : singleGroup === group.id;
      return `<button type="button" class="quick-market-chip ${active ? "active" : ""}" data-quick-group="${group.id}"><strong>${escapeHtml(group.label)}</strong><small>${escapeHtml(group.note)}</small></button>`;
    }).join("");
  }

  function renderQuickOutcomeRail() {
    if (!dom.outcomeRail) return;
    const groupId = focusedOutcomeGroup();
    if (!groupId) {
      dom.outcomeRail.hidden = true;
      dom.outcomeRail.innerHTML = "";
      return;
    }
    const filters = outcomeFiltersForGroup(groupId);
    const selected = selectedOutcomeFiltersForGroup(groupId);
    const singleSelected = selected.length === 1 ? selected[0].id : "";
    dom.outcomeRail.hidden = false;
    dom.outcomeRail.innerHTML = [
      `<button type="button" class="quick-outcome-chip ${!singleSelected ? "active" : ""}" data-quick-outcome-clear="${groupId}"><strong>Tutte le linee</strong><small>${escapeHtml(marketGroup(groupId)?.label || groupId)}</small></button>`,
      ...filters.map(filter => `<button type="button" class="quick-outcome-chip ${singleSelected === filter.id ? "active" : ""}" data-quick-outcome="${filter.id}"><strong>${escapeHtml(filter.label)}</strong><small>${escapeHtml(marketGroup(groupId)?.label || groupId)}</small></button>`),
    ].join("");
  }

  function normalizeMap(raw) {
    return Object.entries(raw || {})
      .filter(([, value]) => value != null)
      .map(([key, value]) => ({ key, line: Number(key), value: Number(value) }))
      .filter(item => Number.isFinite(item.line) && Number.isFinite(item.value))
      .sort((a, b) => a.line - b.line);
  }

  function isDynamicTotalMarket(marketId) {
    return marketId === "corners" || marketId === "yellows";
  }

  function isImpactLine(marketId, line) {
    const threshold = TOTAL_MARKET_RULES[marketId]?.impactLine;
    return Number.isFinite(Number(threshold)) && Number(line) >= Number(threshold);
  }

  function impactLabel(marketId, line) {
    return isImpactLine(marketId, line) ? "Linea alta" : "";
  }

  function bestLine(raw, marketId = "") {
    const options = normalizeMap(raw);
    if (!options.length) return null;
    if (!isDynamicTotalMarket(marketId)) {
      return [...options].sort((a, b) => b.value - a.value || b.line - a.line)[0] || null;
    }
    const { strongMin, softMin } = TOTAL_MARKET_RULES[marketId];
    const strong = options.filter(option => option.value >= strongMin);
    if (strong.length) return strong[strong.length - 1];
    const soft = options.filter(option => option.value >= softMin);
    if (soft.length) return soft[soft.length - 1];
    return [...options].sort((a, b) => b.value - a.value || b.line - a.line)[0] || null;
  }

  function dynamicTotalOptionScore(option, marketId, expectedValue = null) {
    const probability = Number(option?.probability || 0);
    const line = Number(option?.line || 0);
    const expected = Number(expectedValue || 0);
    const label = String(option?.label || "").toUpperCase();
    const isOver = label.startsWith("OVER ");
    const isUnder = label.startsWith("UNDER ");
    let score = probability;

    if (marketId === "corners") {
      if (isOver) {
        if (line < 8.5) score -= 0.07;
        else if (line >= 9.5) score += 0.02;
        if (Number.isFinite(expected) && expected > 0) score += Math.max(-0.08, Math.min(0.14, (expected - line) * 0.05));
      }
      if (isUnder) {
        if (line < 9.5) score -= 0.08;
        else if (line >= 10.5) score += 0.045;
        if (Number.isFinite(expected) && expected > 0) score += Math.max(-0.08, Math.min(0.14, (line - expected) * 0.05));
      }
      if (probability < 0.56) score -= 0.05;
    }

    if (marketId === "yellows") {
      if (isOver) {
        if (line < 2.5) score -= 0.06;
        else if (line >= 3.5) score += 0.02;
        if (Number.isFinite(expected) && expected > 0) score += Math.max(-0.08, Math.min(0.14, (expected - line) * 0.08));
      }
      if (isUnder) {
        if (line < 3.5) score -= 0.04;
        else if (line >= 4.5) score += 0.035;
        if (Number.isFinite(expected) && expected > 0) score += Math.max(-0.08, Math.min(0.14, (line - expected) * 0.08));
      }
      if (probability < 0.58) score -= 0.05;
    }

    if (option?.highImpact) score += 0.02;
    return score;
  }

  function pickDynamicTotalOption(options, marketId, expectedValue = null) {
    if (!options.length) return null;
    return [...options]
      .sort((a, b) => dynamicTotalOptionScore(b, marketId, expectedValue) - dynamicTotalOptionScore(a, marketId, expectedValue) || Number(b.line || 0) - Number(a.line || 0))[0] || null;
  }

  function marketGroup(groupId) {
    return GROUPS.find(group => group.id === groupId);
  }

  function pickedOption(market) {
    return (market?.options || []).find(option => option.label === market?.pickLabel) || null;
  }

  function pickedOdd(market) {
    const odd = Number(pickedOption(market)?.odd);
    return Number.isFinite(odd) ? odd : null;
  }

  function toMinutes(timeValue) {
    const [hour, minute] = String(timeValue || "00:00").split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return (hour * 60) + minute;
  }

  function currentTimeInTimezone(timeZone) {
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${parts.hour}:${parts.minute}`;
  }

  function leaguePriority(country, league) {
    const leagueName = String(league || "");
    if (country === "Italy") {
      if (/^serie a$/i.test(leagueName)) return 0;
      if (/^serie b$/i.test(leagueName)) return 50;
      if (/serie a women/i.test(leagueName)) return 51;
      if (/campionato primavera|primavera/i.test(leagueName)) return 52;
      if (/serie c/i.test(leagueName)) return 53;
      if (/coppa italia|super cup/i.test(leagueName)) return 54;
    }
    if (country === "England") {
      if (/^premier league$/i.test(leagueName)) return 10;
      if (/championship/i.test(leagueName)) return 60;
      if (/league one/i.test(leagueName)) return 61;
      if (/league two/i.test(leagueName)) return 62;
      if (/fa cup|league cup|efl cup/i.test(leagueName)) return 63;
      if (/u18 premier league|premier league 2/i.test(leagueName)) return 64;
    }
    if (country === "Germany") {
      if (/^bundesliga$/i.test(leagueName)) return 20;
      if (/2\. bundesliga/i.test(leagueName)) return 80;
    }
    if (country === "France") {
      if (/^ligue 1$/i.test(leagueName)) return 30;
      if (/^ligue 2$/i.test(leagueName)) return 90;
    }
    if (country === "Spain") {
      if (/la liga|laliga/i.test(leagueName)) return 35;
      if (/segunda/i.test(leagueName)) return 95;
    }
    if (country === "Portugal") {
      if (/^primeira liga$/i.test(leagueName)) return 40;
      if (/liga portugal 2|segunda liga/i.test(leagueName)) return 100;
    }
    if (country === "World" && /champions league|europa league|conference league/i.test(leagueName)) return 45;
    if (country === "Netherlands") {
      if (/^eredivisie$/i.test(leagueName)) return 60;
      if (/eerste/i.test(leagueName)) return 61;
      if (/tweede/i.test(leagueName)) return 62;
      if (/derde/i.test(leagueName)) return 63;
    }
    if (country === "Belgium") {
      if (/^jupiler pro league$/i.test(leagueName) || /^pro league$/i.test(leagueName)) return 70;
      if (/challenger/i.test(leagueName)) return 71;
      if (/amateur/i.test(leagueName)) return 72;
    }
    if (country === "Turkey") {
      if (/^s(?:u|ü)per lig$/i.test(leagueName)) return 80;
      if (/1\. lig/i.test(leagueName)) return 81;
      if (/2\. lig/i.test(leagueName)) return 82;
      if (/3\. lig/i.test(leagueName)) return 83;
    }
    if (country === "Scotland") {
      if (/^premiership$/i.test(leagueName)) return 90;
      if (/championship/i.test(leagueName)) return 91;
    }
    if (country === "Austria") {
      if (/bundesliga/i.test(leagueName)) return 100;
      if (/2\. liga/i.test(leagueName)) return 101;
    }
    if (country === "Switzerland") {
      if (/^super league$/i.test(leagueName)) return 110;
      if (/challenge league/i.test(leagueName)) return 111;
    }
    if (country === "Denmark") {
      if (/^superliga$/i.test(leagueName)) return 120;
      if (/1st division|1\. division/i.test(leagueName)) return 121;
    }
    if (country === "Sweden") {
      if (/^allsvenskan$/i.test(leagueName)) return 130;
      if (/superettan/i.test(leagueName)) return 131;
    }
    if (country === "Norway") {
      if (/^eliteserien$/i.test(leagueName)) return 140;
      if (/obos/i.test(leagueName)) return 141;
    }
    if (country === "Czech-Republic") {
      if (/^1\. liga$/i.test(leagueName) || /^chance liga$/i.test(leagueName)) return 150;
      if (/fnl|2\. liga/i.test(leagueName)) return 151;
    }
    if (country === "Greece") {
      if (/^super league(?: 1)?$/i.test(leagueName)) return 160;
      if (/super league 2/i.test(leagueName)) return 161;
    }
    if (country === "Poland") {
      if (/^ekstraklasa$/i.test(leagueName)) return 170;
      if (/i liga|1\. liga/i.test(leagueName)) return 171;
    }
    if (country === "Croatia") {
      if (/^hnl$/i.test(leagueName)) return 180;
      if (/1\. nl|druga/i.test(leagueName)) return 181;
    }
    if (country === "Serbia") {
      if (/^super liga$/i.test(leagueName)) return 190;
      if (/prva liga/i.test(leagueName)) return 191;
    }
    if (country === "Ukraine") {
      if (/^premier league$/i.test(leagueName)) return 200;
      if (/persha/i.test(leagueName)) return 201;
    }
    const countryRank = COUNTRY_PRIORITY.get(country);
    if (countryRank != null) return countryRank + 5;
    if (EUROPEAN_COUNTRIES.has(country)) return 120;
    return 300;
  }

  function topLeaguePriority(country, league) {
    const leagueName = String(league || "");
    if (country === "Italy" && /^serie a$/i.test(leagueName)) return 0;
    if (country === "England" && /^premier league$/i.test(leagueName)) return 1;
    if (country === "Germany" && /^bundesliga$/i.test(leagueName)) return 2;
    if (country === "France" && /^ligue 1$/i.test(leagueName)) return 3;
    if (country === "Spain" && /la liga|laliga/i.test(leagueName)) return 4;
    if (country === "Portugal" && /^primeira liga$/i.test(leagueName)) return 5;
    return 999;
  }

  function isMinorLeagueName(league) {
    return /\b2\b|segunda|serie b|serie c|league one|league two|championship|liga 2|ligue 2|superettan|obos|1st division|1\. division|eerste|tweede|derde|challenge league|challenger|amateur|1\. lig|2\. lig|3\. lig|super league 2|fnl|prva liga|persha|regionalliga|landesliga|lowland|highland|frauen|u\d{1,2}|women|femin|primavera|reserve|reserves|youth|cup/i.test(String(league || ""));
  }

  function isEliteWorldCompetition(league) {
    return /\buefa champions league\b|\buefa europa league\b|\buefa europa conference league\b|\bchampions league women\b/i.test(String(league || ""));
  }

  function isSecondaryWorldCompetition(league) {
    return /champions league|europa league|conference league|libertadores|sudamericana|concacaf|caf|afc champions|leagues cup/i.test(String(league || ""));
  }

  function isFeaturedTopDivision(country, league) {
    const leagueName = String(league || "");
    if (country === "Netherlands") return /^eredivisie$/i.test(leagueName);
    if (country === "Belgium") return /^jupiler pro league$/i.test(leagueName) || /^pro league$/i.test(leagueName);
    if (country === "Turkey") return /^s(?:u|ü)per lig$/i.test(leagueName);
    if (country === "Scotland") return /^premiership$/i.test(leagueName);
    if (country === "Austria") return /^bundesliga$/i.test(leagueName);
    if (country === "Switzerland") return /^super league$/i.test(leagueName);
    if (country === "Denmark") return /^superliga$/i.test(leagueName);
    if (country === "Sweden") return /^allsvenskan$/i.test(leagueName);
    if (country === "Norway") return /^eliteserien$/i.test(leagueName);
    if (country === "Czech-Republic") return /^1\. liga$/i.test(leagueName) || /^chance liga$/i.test(leagueName);
    if (country === "Greece") return /^super league(?: 1)?$/i.test(leagueName);
    if (country === "Poland") return /^ekstraklasa$/i.test(leagueName);
    if (country === "Croatia") return /^hnl$/i.test(leagueName);
    if (country === "Serbia") return /^super liga$/i.test(leagueName);
    if (country === "Ukraine") return /^premier league$/i.test(leagueName);
    return false;
  }

  function competitionTier(country, league) {
    const majorRank = topLeaguePriority(country, league);
    if (majorRank !== 999) return [0, majorRank];
    if (FEATURED_COUNTRY_PRIORITY.has(country) && isFeaturedTopDivision(country, league)) return [1, FEATURED_COUNTRY_PRIORITY.get(country)];
    if (country === "World" && isEliteWorldCompetition(league)) return [2, 0];
    if (TOP_COUNTRY_PRIORITY.has(country)) return [3, TOP_COUNTRY_PRIORITY.get(country)];
    if (EUROPEAN_COUNTRIES.has(country) && !isMinorLeagueName(league)) return [4, COUNTRY_PRIORITY.get(country) ?? 999];
    if (country === "World" && isSecondaryWorldCompetition(league)) return [5, 0];
    if (EUROPEAN_COUNTRIES.has(country)) return [5, (COUNTRY_PRIORITY.get(country) ?? 999) + 50];
    return [6, 999];
  }

  function isMajorLeagueGroup(group) {
    return competitionTier(group.country, group.league)[0] <= 1;
  }

  function shouldPrioritizeOpenSelections() {
    return state.oddActive
      || state.minProbability !== DEFAULTS.minProbability
      || state.maxProbability !== DEFAULTS.maxProbability;
  }

  function matchLifecycleRank(match) {
    const fixtureStatus = String(match.status_short || "").toUpperCase();
    if (LIVE_STATUSES.has(fixtureStatus)) return 0;
    if (FINAL_STATUSES.has(fixtureStatus)) return 2;
    return 1;
  }

  function groupLifecycleRank(group) {
    return group.matches.reduce((best, match) => Math.min(best, matchLifecycleRank(match)), 9);
  }

  function earliestOpenKickoff(group) {
    return group.matches
      .filter(match => matchLifecycleRank(match) < 2)
      .map(match => match.match_time || "99:99")
      .sort()[0] || "99:99";
  }

  function groupSortKey(group) {
    const [tier, tierRank] = competitionTier(group.country, group.league);
    const leagueRank = leaguePriority(group.country, group.league);
    if (shouldPrioritizeOpenSelections()) {
      return [groupLifecycleRank(group), earliestOpenKickoff(group), tier, tierRank, leagueRank, group.league || "", group.country || ""];
    }
    return [tier, tierRank, leagueRank, group.matches[0]?.match_time || "", group.league || "", group.country || ""];
  }

  function matchSortKey(match) {
    const [tier, tierRank] = competitionTier(match.country, match.league);
    if (shouldPrioritizeOpenSelections()) {
      const lifecycleRank = matchLifecycleRank(match);
      const kickoff = lifecycleRank < 2 ? (match.match_time || "99:99") : "99:99";
      return [lifecycleRank, kickoff, tier, tierRank, leaguePriority(match.country, match.league), match.league || "", match.home || ""];
    }
    return [tier, tierRank, leaguePriority(match.country, match.league), match.match_time || "", match.league || "", match.home || ""];
  }

  function tempoProfile(match) {
    const lamTotal = Number(match?.lam_total || 0);
    const over25 = Number(match?.p_over25 || 0);
    let boost = 0;
    if (HIGH_TEMPO_COUNTRIES.has(match?.country)) boost += 0.06;
    if (/bundesliga|eredivisie|super lig|jupiler|pro league|allsvenskan|eliteserien|superliga|super league/i.test(String(match?.league || ""))) boost += 0.04;
    if (lamTotal >= 3.1) boost += 0.08;
    else if (lamTotal >= 2.75) boost += 0.05;
    else if (lamTotal >= 2.45) boost += 0.025;
    if (over25 >= 0.6) boost += 0.03;
    return boost;
  }

  function marketDisplayScore(market, match = null) {
    const picked = (market.options || []).find(option => option.label === market.pickLabel);
    const odd = Number(picked?.odd);
    let score = Number(market.pickProbability || 0);
    const label = String(market.pickLabel || "").toUpperCase();
    const line = Number(picked?.line || 0);
    const tempoBoost = tempoProfile(match);
    const lamTotal = Number(match?.lam_total || 0);
    if (market.id === "ou15") score -= 0.07;
    if (market.id === "dc") {
      score -= 0.04;
      if (Number(market.pickProbability || 0) >= 0.74) score += 0.06;
      if (Number(market.pickProbability || 0) >= 0.8) score += 0.04;
    }
    if (market.id === "combo") {
      score -= 0.12;
      if (Number(market.pickProbability || 0) < 0.62) score -= 0.14;
      if (Number(market.pickProbability || 0) < 0.58) score -= 0.10;
      if (tempoBoost >= 0.06 && Number(market.pickProbability || 0) >= 0.58) score += 0.08;
    }
    if (market.id === "btts") {
      score += 0.03;
      if (label === "BTTS YES" && tempoBoost >= 0.04 && Number(market.pickProbability || 0) >= 0.57) score += 0.07;
      if (label === "BTTS NO" && tempoBoost < 0.03 && Number(market.pickProbability || 0) >= 0.6) score += 0.05;
    }
    if (market.id === "ou25" || market.id === "o35") score += 0.02;
    if (market.id === "corners") {
      score += 0.02;
      if (picked) score += dynamicTotalOptionScore(picked, "corners", match?.exp_corners) - Number(picked.probability || 0);
      if (label.startsWith("UNDER ") && line >= 10.5) score += 0.05;
      if (label.startsWith("OVER ") && line >= 9.5) score += 0.03;
    }
    if (market.id === "yellows") {
      score += 0.02;
      if (picked) score += dynamicTotalOptionScore(picked, "yellows", match?.exp_yellows) - Number(picked.probability || 0);
      if (label.startsWith("UNDER ") && line >= 4.5) score += 0.03;
      if (label.startsWith("OVER ") && line >= 3.5) score += 0.03;
    }
    if (market.id === "nogol") {
      score += 0.015;
      if (tempoBoost < 0.03 && Number(market.pickProbability || 0) >= 0.62) score += 0.055;
    }
    if (label === "OVER 1.5") score += 0.03 + tempoBoost;
    if (label === "OVER 2.5") score += 0.02 + (tempoBoost * 0.8);
    if (label === "BTTS YES") score += 0.015 + (tempoBoost * 0.65);
    if (label === "UNDER 3.5") {
      score -= 0.015;
      if (tempoBoost > 0.05) score -= 0.08;
      else if (tempoBoost > 0.025) score -= 0.03;
      if (lamTotal >= 2.95) score -= 0.06;
      else if (lamTotal >= 2.65) score -= 0.02;
      if (Number(market.pickProbability || 0) >= 0.66) score += 0.06;
      if (Number(market.pickProbability || 0) >= 0.72) score += 0.04;
      if (Number(market.pickProbability || 0) >= 0.86 && lamTotal <= 2.3) score += 0.04;
    }
    if (label === "UNDER 3.5" && Number(market.pickProbability || 0) < 0.74 && Number.isFinite(odd) && odd <= 1.25) score -= 0.055;
    if (label === "OVER 2.5" && Number.isFinite(odd) && odd >= 1.45 && odd <= 1.9 && Number(market.pickProbability || 0) >= 0.58) score += 0.035;
    if (label === "UNDER 2.5" && tempoBoost > 0.04) score -= 0.05;
    if (label === "BTTS NO" && tempoBoost > 0.05) score -= 0.04;
    if (label.includes("NON SEGNA") && tempoBoost > 0.05) score -= 0.03;
    if (Number.isFinite(odd)) {
      if (odd < 1.22) score -= 0.12;
      else if (odd < 1.35) score -= 0.06;
      else if (odd >= 1.45 && odd <= 2.15) score += 0.03;
      else if (odd > 4.5) score -= 0.02;
    }
    return score;
  }

  function isFeaturedCompetition(country, league) {
    return COUNTRY_PRIORITY.has(country) || (country === "World" && /champions league|europa league|conference league/i.test(String(league || "")));
  }

  function isHeadlineCompetition(country, league) {
    if (country === "World") return /champions league|europa league|conference league/i.test(String(league || ""));
    const explicit = [
      /^serie a$/i,
      /^serie b$/i,
      /^premier league$/i,
      /championship/i,
      /^la liga/i,
      /^bundesliga$/i,
      /^ligue 1$/i,
      /^primeira liga$/i,
      /^eredivisie$/i,
      /super lig/i,
      /premiership/i,
    ];
    return COUNTRY_PRIORITY.has(country) && explicit.some(rule => rule.test(String(league || "")));
  }

  function isTopRailCompetition(country, league) {
    if (isHeadlineCompetition(country, league)) return true;
    if (!COUNTRY_PRIORITY.has(country)) return false;
    return !/\bu\d{1,2}\b|women|femenina|feminina|primavera|juniores|reserve|reserves/i.test(String(league || ""));
  }

  function statusLabel(status) {
    return STATUS_OPTIONS.find(option => option.id === status)?.label || status;
  }

  function resolveMarketStatus(match, market) {
    const fixtureStatus = String(match.status_short || "").toUpperCase();
    if (market.id === "corners" || market.id === "yellows") {
      if (FINAL_STATUSES.has(fixtureStatus)) {
        const actual = Number(market.actual);
        const label = String(market.pickLabel || "").toUpperCase();
        const line = Number(label.replace("OVER ", "").replace("UNDER ", ""));
        if (Number.isFinite(actual) && Number.isFinite(line)) {
          if (label.startsWith("OVER ")) return actual > line ? "win" : "lose";
          if (label.startsWith("UNDER ")) return actual < line ? "win" : "lose";
        }
        return "unresolved";
      }
      return LIVE_STATUSES.has(fixtureStatus) ? "live" : "scheduled";
    }
    if (!FINAL_STATUSES.has(fixtureStatus)) return LIVE_STATUSES.has(fixtureStatus) ? "live" : "scheduled";
    const homeGoals = Number(match.goals_home ?? 0);
    const awayGoals = Number(match.goals_away ?? 0);
    const label = String(market.pickLabel || "").toUpperCase();
    if (label === "1X") return homeGoals >= awayGoals ? "win" : "lose";
    if (label === "X2") return awayGoals >= homeGoals ? "win" : "lose";
    if (label === "OVER 2.5 + BTTS") return (homeGoals + awayGoals >= 3 && homeGoals > 0 && awayGoals > 0) ? "win" : "lose";
    if (label === "BTTS YES") return (homeGoals > 0 && awayGoals > 0) ? "win" : "lose";
    if (label === "BTTS NO") return !(homeGoals > 0 && awayGoals > 0) ? "win" : "lose";
    if (label.startsWith("OVER ")) return homeGoals + awayGoals > Number(label.replace("OVER ", "")) ? "win" : "lose";
    if (label.startsWith("UNDER ")) return homeGoals + awayGoals < Number(label.replace("UNDER ", "")) ? "win" : "lose";
    if (label.includes(" NON SEGNA")) {
      if (label.startsWith(String(match.home || "").toUpperCase())) return homeGoals === 0 ? "win" : "lose";
      if (label.startsWith(String(match.away || "").toUpperCase())) return awayGoals === 0 ? "win" : "lose";
    }
    return "unresolved";
  }

  function buildTotalMarketOptions(raw, marketId) {
    return normalizeMap(raw)
      .filter(item => marketId !== "yellows" || Number(item.line) <= 5.5)
      .flatMap(item => {
      const underProbability = Math.max(0.02, Math.min(0.98, 1 - Number(item.value)));
      return [
        {
          label: `Over ${item.key}`,
          probability: item.value,
          odd: null,
          line: item.line,
          highImpact: isImpactLine(marketId, item.line),
          impactLabel: impactLabel(marketId, item.line),
        },
        {
          label: `Under ${item.key}`,
          probability: Number(underProbability.toFixed(4)),
          odd: null,
          line: item.line,
          highImpact: isImpactLine(marketId, item.line),
          impactLabel: impactLabel(marketId, item.line),
        },
      ];
    });
  }

  function remapMarketForOutcomeFilters(match, market) {
    const selectedForGroup = selectedOutcomeFiltersForGroup(market.group);
    if (!selectedForGroup.length) return market;
    const selectedForMarket = selectedForGroup.filter(filter => !filter.marketId || filter.marketId === market.id);
    if (!selectedForMarket.length) return null;
    const matchingOptions = (market.options || []).filter(option => selectedForMarket.some(filter => filter.label === option.label));
    if (!matchingOptions.length) return null;
    const bestOption = [...matchingOptions].sort((a, b) => Number(b.probability || 0) - Number(a.probability || 0) || Number(b.line || 0) - Number(a.line || 0))[0];
    const remapped = {
      ...market,
      pickLabel: bestOption.label,
      pickProbability: Number(bestOption.probability ?? market.pickProbability ?? 0),
      highImpact: Boolean(bestOption.highImpact),
      impactLabel: bestOption.impactLabel || "",
    };
    remapped.status = resolveMarketStatus(match, remapped);
    return remapped;
  }

  function buildMarkets(match) {
    const cornerOptions = buildTotalMarketOptions(match.corner_overs, "corners");
    const yellowOptions = buildTotalMarketOptions(match.yellow_overs, "yellows");
    const cornerPick = pickDynamicTotalOption(cornerOptions, "corners", match.exp_corners);
    const yellowPick = pickDynamicTotalOption(yellowOptions, "yellows", match.exp_yellows);
    return [
      { id: "ou15", group: "goals", title: "Over / Under 1.5", pickLabel: match.ou15_pick, pickProbability: match.ou15_conf, options: [{ label: "Over 1.5", probability: match.p_over15, odd: match.odd_o15 }, { label: "Under 1.5", probability: match.p_under15, odd: match.odd_u15 }] },
      { id: "ou25", group: "goals", title: "Over / Under 2.5", pickLabel: match.ou_pick, pickProbability: match.ou_conf, options: [{ label: "Over 2.5", probability: match.p_over25, odd: match.odd_o25 }, { label: "Under 2.5", probability: match.p_under25, odd: match.odd_u25 }] },
      { id: "o35", group: "goals", title: "Over / Under 3.5", pickLabel: match.ou35_pick || (Number(match.p_over35 || 0) >= 0.5 ? "Over 3.5" : "Under 3.5"), pickProbability: match.ou35_conf ?? Math.max(Number(match.p_over35 || 0), Number(match.p_under35 || 0)), options: [{ label: "Over 3.5", probability: match.p_over35, odd: match.odd_o35 }, { label: "Under 3.5", probability: match.p_under35, odd: match.odd_u35 }] },
      { id: "dc", group: "double", title: "Doppia chance", pickLabel: match.dc_pick, pickProbability: match.dc_conf, options: [{ label: "1X", probability: match.p_1x, odd: match.odd_1x }, { label: "X2", probability: match.p_x2, odd: match.odd_x2 }] },
      { id: "btts", group: "btts", title: "Both Teams To Score", pickLabel: match.btts_pick, pickProbability: match.btts_conf, options: [{ label: "BTTS YES", probability: match.p_btts_yes, odd: match.odd_btts_y }, { label: "BTTS NO", probability: match.p_btts_no, odd: match.odd_btts_n }] },
      { id: "combo", group: "combo", title: "Combo Goals", pickLabel: "Over 2.5 + BTTS", pickProbability: match.p_o25_btts, options: [{ label: "Over 2.5 + BTTS", probability: match.p_o25_btts, odd: null }] },
      { id: "nogol", group: "blank", title: "No goal", pickLabel: `${match.nogol_team} ${TEXT.teamBlank}`, pickProbability: Math.max(Number(match.p_home_blanked || 0), Number(match.p_away_blanked || 0)), options: [{ label: `${match.home} ${TEXT.teamBlank}`, probability: match.p_home_blanked, odd: null }, { label: `${match.away} ${TEXT.teamBlank}`, probability: match.p_away_blanked, odd: null }] },
      { id: "corners", group: "corners", title: "Corner", pickLabel: cornerPick ? cornerPick.label : "", pickProbability: cornerPick ? cornerPick.probability : null, expected: match.exp_corners, actual: match.total_corners, highImpact: Boolean(cornerPick?.highImpact), impactLabel: cornerPick?.impactLabel || "", options: cornerOptions },
      { id: "yellows", group: "yellows", title: "Cartellini", pickLabel: yellowPick ? yellowPick.label : "", pickProbability: yellowPick ? yellowPick.probability : null, expected: match.exp_yellows, actual: match.total_yellows, highImpact: Boolean(yellowPick?.highImpact), impactLabel: yellowPick?.impactLabel || "", options: yellowOptions },
    ].map(market => ({ ...market, status: resolveMarketStatus(match, market), tag: marketGroup(market.group)?.short || market.group.toUpperCase() }));
  }

  function selectPrimaryMarket(markets, match = null) {
    return [...markets].sort((a, b) => marketDisplayScore(b, match) - marketDisplayScore(a, match))[0] || null;
  }

  function rankedMarkets(markets, match = null) {
    return [...markets]
      .map(market => ({ market, score: marketDisplayScore(market, match) }))
      .sort((a, b) => b.score - a.score || Number(b.market.pickProbability || 0) - Number(a.market.pickProbability || 0));
  }

  function conservativeGoalPreference(markets, match = null) {
    const under35 = markets.find(market => market.id === "o35" && String(market.pickLabel || "").toUpperCase() === "UNDER 3.5");
    const over25 = markets.find(market => market.id === "ou25" && String(market.pickLabel || "").toUpperCase() === "OVER 2.5");
    if (!under35 || !over25) return null;
    if (tempoProfile(match) >= 0.08) return null;
    if (Number(under35.pickProbability || 0) >= Number(over25.pickProbability || 0) + 0.045) return under35;
    return null;
  }

  function selectHeadlineMarket(markets, match = null) {
    const viableMarkets = markets.filter(market => !(market.id === "combo" && Number(market.pickProbability || 0) < 0.6));
    const pool = viableMarkets.length ? viableMarkets : markets;
    const ranked = rankedMarkets(pool, match);
    const best = ranked[0]?.market || null;
    const bestScore = ranked[0]?.score ?? -999;
    const conservativeGoalPick = conservativeGoalPreference(pool, match);
    if (conservativeGoalPick && (
      (state.groups.size === 1 && state.groups.has("goals"))
      || pool.every(market => market.group === "goals")
    )) {
      return conservativeGoalPick;
    }
    if (state.outcomeFilters.size) return best;

    if (best && ["goals", "blank"].includes(best.group)) {
      const alternative = ranked.find(({ market, score }) => {
        if (!market || market.group === best.group) return false;
        if (score < bestScore - 0.045) return false;
        if (market.group === "double") return Number(market.pickProbability || 0) >= 0.72;
        if (market.group === "btts") return Number(market.pickProbability || 0) >= 0.57;
        if (market.group === "combo") return Number(market.pickProbability || 0) >= 0.58 && tempoProfile(match) >= 0.05;
        if (market.group === "corners") return Number(market.pickProbability || 0) >= 0.6;
        if (market.group === "yellows") return Number(market.pickProbability || 0) >= 0.6;
        return false;
      });
      if (alternative) return alternative.market;
    }

    const withoutSoftProps = pool.filter(market => !["corners", "yellows"].includes(market.group) && market.id !== "ou15");
    if (withoutSoftProps.length) {
      const variedBest = rankedMarkets(withoutSoftProps, match)[0]?.market;
      if (variedBest) return variedBest;
    }
    const withoutProps = pool.filter(market => !["corners", "yellows"].includes(market.group));
    if (withoutProps.length) {
      const safeBest = rankedMarkets(withoutProps, match)[0]?.market;
      if (safeBest) return safeBest;
    }
    return best;
  }

  function decorateMatches(rawMatches, keepAll = false) {
    const search = state.search.trim().toLowerCase();
    const oddFilterActive = state.oddActive;
    return rawMatches
      .map(match => {
        const markets = buildMarkets(match).map(market => remapMarketForOutcomeFilters(match, market)).filter(Boolean);
        const visibleMarkets = markets
          .filter(market => state.groups.has(market.group))
          .filter(market => {
            const probability = Number(market.pickProbability || 0) * 100;
            return probability >= state.minProbability && probability <= state.maxProbability;
          })
          .filter(market => {
            if (!oddFilterActive) return true;
            const odd = pickedOdd(market);
            return odd != null && odd >= state.oddFrom && odd <= state.oddTo;
          })
          .filter(market => state.status === "all" ? true : market.status === state.status);
        const searchBlob = `${match.home} ${match.away} ${match.league} ${match.country} ${markets.flatMap(market => [market.title, market.pickLabel, ...(market.options || []).map(option => option.label)]).join(" ")}`.toLowerCase();
        return { ...match, markets, visibleMarkets, primaryMarket: selectHeadlineMarket(visibleMarkets, match), searchBlob };
      })
      .filter(match => match.match_time >= state.timeFrom && match.match_time <= state.timeTo)
      .filter(match => !search || match.searchBlob.includes(search))
      .filter(match => keepAll || match.visibleMarkets.length > 0)
      .sort((a, b) => `${a.match_time}-${a.league}-${a.home}`.localeCompare(`${b.match_time}-${b.league}-${b.home}`));
  }

  function getDerivedMatches() {
    return decorateMatches(Array.isArray(state.cache?.matches) ? state.cache.matches : []);
  }

  function getDetailMatch() {
    if (!state.detailFixtureId) return null;
    const rawMatch = (state.cache?.matches || []).find(match => String(match.fixture_id) === String(state.detailFixtureId));
    if (!rawMatch) return null;
    const markets = buildMarkets(rawMatch).filter(market => Number(market.pickProbability || 0) > 0 || (market.options || []).some(option => option.probability != null));
    const filteredMarkets = markets.map(market => remapMarketForOutcomeFilters(rawMatch, market)).filter(Boolean);
    const primaryMarket = filteredMarkets.length ? selectHeadlineMarket(filteredMarkets, rawMatch) : selectPrimaryMarket(markets, rawMatch);
    return { ...rawMatch, markets, primaryMarket };
  }

  function getTopPicks(matches) {
    const timezone = state.manifest?.timezone || "UTC";
    const today = todayIso(timezone);
    const nowMinutes = toMinutes(currentTimeInTimezone(timezone));
    let pool = matches.filter(match => !FINAL_STATUSES.has(String(match.status_short || "").toUpperCase()) && match.primaryMarket);
    if (state.selectedDate === today) {
      const imminent = pool.filter(match => {
        const kickoff = toMinutes(match.match_time);
        return kickoff >= nowMinutes && kickoff <= nowMinutes + 30;
      });
      if (imminent.length) {
        pool = imminent;
      } else {
        const nextUp = pool.filter(match => toMinutes(match.match_time) >= nowMinutes);
        if (nextUp.length) pool = nextUp;
      }
    }
    const headlinePool = pool.filter(match => isHeadlineCompetition(match.country, match.league));
    if (headlinePool.length) pool = headlinePool;
    else {
      const curatedPool = pool.filter(match => isTopRailCompetition(match.country, match.league));
      if (curatedPool.length) pool = curatedPool;
      else {
        const featuredPool = pool.filter(match => isFeaturedCompetition(match.country, match.league));
        if (featuredPool.length) pool = featuredPool;
      }
    }
    const ranked = pool
      .map(match => {
        const headline = selectHeadlineMarket(match.visibleMarkets, match);
        if (!headline) return null;
        const picked = (headline.options || []).find(option => option.label === headline.pickLabel);
        return {
          fixtureId: match.fixture_id,
          home: match.home,
          away: match.away,
          league: match.league,
          country: match.country,
          matchTime: match.match_time,
          pickLabel: headline.pickLabel,
          pickProbability: headline.pickProbability,
          status: headline.status,
          group: headline.group,
          tag: headline.tag,
          impactLabel: headline.impactLabel || "",
          highImpact: Boolean(headline.highImpact),
          odd: picked?.odd ?? null,
          displayScore: marketDisplayScore(headline, match),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const featuredDiff = Number(isFeaturedCompetition(b.country, b.league)) - Number(isFeaturedCompetition(a.country, a.league));
        if (featuredDiff !== 0) return featuredDiff;
        const timeDiff = toMinutes(a.matchTime) - toMinutes(b.matchTime);
        if (state.selectedDate === today && Math.abs(timeDiff) > 0) return timeDiff;
        const scoreDiff = b.displayScore - a.displayScore;
        if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
        return timeDiff;
      })
      ;

    const quotas = { goals: 4, double: 2, btts: 2, combo: 2, corners: 2, yellows: 2, blank: 1 };
    const used = {};
    const diversified = [];

    ranked.forEach(pick => {
      if (diversified.length >= 12) return;
      const limit = quotas[pick.group] ?? 2;
      const current = used[pick.group] || 0;
      if (current >= limit) return;
      diversified.push(pick);
      used[pick.group] = current + 1;
    });

    if (diversified.length < 12) {
      ranked.forEach(pick => {
        if (diversified.length >= 12) return;
        if (diversified.some(item => item.fixtureId === pick.fixtureId && item.pickLabel === pick.pickLabel)) return;
        diversified.push(pick);
      });
    }

    return diversified.slice(0, 12);
  }

  function groupMatches(matches) {
    const groups = new Map();
    matches.forEach(match => {
      const key = `${match.country || ""}__${match.league || ""}`;
      if (!groups.has(key)) groups.set(key, { key, country: match.country || "", league: match.league || "", logo: match.league_logo || "", matches: [] });
      groups.get(key).matches.push(match);
    });
    return [...groups.values()].sort((a, b) => {
      if (state.sortMode === "time") {
        return `${a.matches[0]?.match_time || ""}-${a.league}`.localeCompare(`${b.matches[0]?.match_time || ""}-${b.league}`);
      }
      const aKey = groupSortKey(a);
      const bKey = groupSortKey(b);
      for (let index = 0; index < aKey.length; index += 1) {
        if (aKey[index] < bKey[index]) return -1;
        if (aKey[index] > bKey[index]) return 1;
      }
      return 0;
    });
  }

  function sortMatchesForFeed(matches) {
    return [...matches].sort((a, b) => {
      if (state.sortMode === "time") {
        return `${a.match_time || ""}-${a.league || ""}-${a.home || ""}`.localeCompare(`${b.match_time || ""}-${b.league || ""}-${b.home || ""}`);
      }
      const aKey = matchSortKey(a);
      const bKey = matchSortKey(b);
      for (let index = 0; index < aKey.length; index += 1) {
        if (aKey[index] < bKey[index]) return -1;
        if (aKey[index] > bKey[index]) return 1;
      }
      return 0;
    });
  }

  function activeQuickRangeId() {
    return QUICK_RANGES.find(range => range.from === state.timeFrom && range.to === state.timeTo)?.id || "";
  }

  function activeFilterCount() {
    let count = 0;
    if (state.search) count += 1;
    if (state.timeFrom !== DEFAULTS.timeFrom || state.timeTo !== DEFAULTS.timeTo) count += 1;
    if (state.minProbability !== DEFAULTS.minProbability || state.maxProbability !== DEFAULTS.maxProbability) count += 1;
    if (state.oddActive) count += 1;
    if (state.status !== "all") count += 1;
    if (state.groups.size !== GROUPS.length) count += 1;
    if (state.outcomeFilters.size) count += 1;
    return count;
  }

  function emptyStateMessage() {
    if (!state.groups.size) return TEXT.noMarketSelected;
    return state.cache ? TEXT.empty : TEXT.noCache;
  }

  function syncModalState() {
    if (dom.filterSheet) dom.filterSheet.classList.toggle("open", state.filterOpen);
    dom.detailShell.classList.toggle("open", Boolean(state.detailFixtureId));
    dom.detailOverlay.classList.toggle("visible", Boolean(state.detailFixtureId));
    document.body.classList.toggle("modal-open", state.filterOpen || Boolean(state.detailFixtureId));
  }

  function renderDateTabs() {
    const timezone = state.manifest?.timezone || "UTC";
    const today = todayIso(timezone);
    const dates = Array.isArray(state.manifest?.dates) ? state.manifest.dates : [];
    dom.dateTabs.innerHTML = dates.map(entry => {
      let label = formatDate(entry.date, { weekday: "short" });
      if (entry.date === today) label = TEXT.today;
      if (entry.date === shiftIso(today, 1)) label = TEXT.tomorrow;
      if (entry.date === shiftIso(today, -1)) label = TEXT.yesterday;
      return `<button type="button" class="date-tab ${entry.date === state.selectedDate ? "active" : ""}" data-date="${entry.date}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatDate(entry.date, { day: "2-digit", month: "2-digit" }))}</strong><small>${entry.matches || 0} ${TEXT.matches}</small></button>`;
    }).join("");
  }

  function renderQuickRanges() {
    dom.quickRangeChips.innerHTML = QUICK_RANGES.map(range => `<button type="button" class="chip-btn ${range.id === activeQuickRangeId() ? "active" : ""}" data-quick-range="${range.id}">${range.label}</button>`).join("");
  }

  function renderRangePanels() {
    populateProbabilitySelects();
    populateOddSelects();
    if (dom.probabilityMinInput) dom.probabilityMinInput.value = String(state.minProbability);
    if (dom.probabilityMaxInput) dom.probabilityMaxInput.value = String(state.maxProbability);
    if (dom.probabilityValue) dom.probabilityValue.textContent = `${state.minProbability}% - ${state.maxProbability}%`;

    if (dom.oddFrom) dom.oddFrom.value = formatOdd(state.oddFrom);
    if (dom.oddTo) dom.oddTo.value = formatOdd(state.oddTo);
    if (dom.oddValue) dom.oddValue.textContent = `${formatOdd(state.oddFrom)} - ${formatOdd(state.oddTo)}`;
  }

  function renderFilterChips() {
    dom.marketChips.innerHTML = GROUPS.map(group => `<button type="button" class="chip-btn ${state.groups.has(group.id) ? "active" : ""}" data-group="${group.id}">${group.label}</button>`).join("");
    renderQuickMarketRail();
    renderQuickOutcomeRail();
    renderProbabilityPresetChips();
    dom.statusChips.innerHTML = STATUS_OPTIONS.map(option => `<button type="button" class="status-chip ${state.status === option.id ? "active" : ""}" data-status="${option.id}">${option.label}</button>`).join("");
    dom.marketsAll.classList.toggle("active", state.groups.size === GROUPS.length);
    dom.marketsNone.classList.toggle("active", state.groups.size === 0);
    dom.timeFrom.value = state.timeFrom;
    dom.timeTo.value = state.timeTo;
    renderRangePanels();
    renderOddPresetChips();
    dom.filterCount.textContent = String(activeFilterCount());
  }

  function renderFeedToolbar(matches) {
    if (dom.feedStateTitle) {
      let label = "Pronostici";
      if (state.status === "live") label = "Live";
      else if (state.status === "scheduled") label = "In arrivo";
      else if (state.status === "win") label = "Verdi";
      else if (state.status === "lose") label = "Rossi";
      dom.feedStateTitle.textContent = `${label} (${matches.length})`;
    }
    if (dom.feedStateSubtitle) {
      const activeGroup = state.groups.size === 1 ? (marketGroup([...state.groups][0])?.label || "Focus") : "Tutti i mercati";
      dom.feedStateSubtitle.textContent = `${activeGroup} | ${state.sortMode === "priority" ? "ordine prioritario" : "ordine orario"}`;
    }
    if (dom.sortToggleValue) dom.sortToggleValue.textContent = state.sortMode === "priority" ? "Priorita" : "Orario";
    if (dom.summaryTimeValue) dom.summaryTimeValue.textContent = `${state.timeFrom} - ${state.timeTo}`;
    if (dom.summaryStatusValue) dom.summaryStatusValue.textContent = statusLabel(state.status);
  }

  function renderSummary(matches, topPicks) {
    const liveCount = matches.filter(match => LIVE_STATUSES.has(String(match.status_short || "").toUpperCase())).length;
    const finalCount = matches.filter(match => FINAL_STATUSES.has(String(match.status_short || "").toUpperCase())).length;
    const settled = matches.flatMap(match => match.visibleMarkets);
    const winCount = settled.filter(market => market.status === "win").length;
    const loseCount = settled.filter(market => market.status === "lose").length;
    const closedPrimary = matches
      .map(match => match.primaryMarket)
      .filter(market => market && (market.status === "win" || market.status === "lose"));
    const topWins = closedPrimary.filter(market => market.status === "win").length;
    const topLoses = closedPrimary.filter(market => market.status === "lose").length;
    document.getElementById("summary-matches").textContent = String(matches.length);
    document.getElementById("summary-top").textContent = String(topPicks.length);
    document.getElementById("summary-live").textContent = `${liveCount} / ${finalCount}`;
    document.getElementById("summary-live-meta").textContent = `${liveCount} ${TEXT.liveWord} - ${finalCount} ${TEXT.finalWord}`;
    document.getElementById("summary-settled").textContent = `${winCount} / ${loseCount}`;
    document.getElementById("hero-window-value").textContent = `${state.timeFrom} - ${state.timeTo}`;
    document.getElementById("hero-date-value").textContent = state.selectedDate ? formatDate(state.selectedDate, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : "-";
    document.getElementById("hero-sync-value").textContent = formatDateTime(state.cache?.refreshed_at || state.cache?.generated_at);
    const topBadge = document.getElementById("top-picks-badge");
    const matchBadge = document.getElementById("matches-badge");
    if (topBadge) topBadge.textContent = String(topPicks.length);
    if (dom.topPicksWin) dom.topPicksWin.textContent = `${TEXT.wonWord} ${topWins}`;
    if (dom.topPicksLose) dom.topPicksLose.textContent = `${TEXT.lostWord} ${topLoses}`;
    if (matchBadge) matchBadge.textContent = String(matches.length);
  }

  function renderYesterdayBanner() {
    if (!dom.yesterdayBanner) return;
    const timezone = state.manifest?.timezone || "UTC";
    const today = todayIso(timezone);
    const yesterday = shiftIso(today, -1);
    const yesterdayEntry = (state.manifest?.dates || []).find(entry => entry.date === yesterday);
    if (!yesterdayEntry || state.selectedDate !== today) {
      dom.yesterdayBanner.hidden = true;
      dom.yesterdayBanner.removeAttribute("data-date-banner");
      return;
    }
    dom.yesterdayBanner.hidden = false;
    dom.yesterdayBanner.dataset.dateBanner = yesterday;
    if (dom.yesterdayBannerTitle) dom.yesterdayBannerTitle.textContent = "Partite di ieri";
    if (dom.yesterdayBannerMeta) {
      dom.yesterdayBannerMeta.textContent = `${yesterdayEntry.matches || 0} ${TEXT.matches} | ${formatDate(yesterday, { day: "2-digit", month: "short" })}`;
    }
  }

  function renderActiveFilters() {
    const chips = [];
    if (state.search) chips.push({ key: "search", label: `${TEXT.filterSearch}: ${state.search}` });
    if (state.timeFrom !== DEFAULTS.timeFrom || state.timeTo !== DEFAULTS.timeTo) chips.push({ key: "time", label: `${TEXT.filterTime}: ${state.timeFrom}-${state.timeTo}` });
    if (state.minProbability !== DEFAULTS.minProbability || state.maxProbability !== DEFAULTS.maxProbability) chips.push({ key: "probability", label: `${TEXT.filterProbability}: ${formatProbabilityRange(state.minProbability, state.maxProbability)}` });
    if (state.oddActive) chips.push({ key: "odd", label: `${TEXT.filterOdd}: ${formatOddRange(state.oddFrom, state.oddTo)}` });
    if (state.status !== "all") chips.push({ key: "status", label: `${TEXT.filterStatus}: ${statusLabel(state.status)}` });
    if (state.groups.size !== GROUPS.length) chips.push({ key: "groups", label: `${TEXT.filterMarkets}: ${state.groups.size}/${GROUPS.length}` });
    if (state.outcomeFilters.size) {
      const labels = OUTCOME_FILTERS.filter(filter => state.outcomeFilters.has(filter.id)).map(filter => filter.label);
      const summary = labels.length <= 2 ? labels.join(" | ") : `${labels.slice(0, 2).join(" | ")} +${labels.length - 2}`;
      chips.push({ key: "outcomes", label: `Linee: ${summary}` });
    }
    dom.activeFilters.style.display = chips.length ? "flex" : "none";
    dom.activeFilters.innerHTML = chips.map(chip => `<button type="button" class="active-filter" data-clear-filter="${chip.key}">${escapeHtml(chip.label)} <span aria-hidden="true">x</span></button>`).join("");
  }

  function renderTopPicks(topPicks) {
    if (!topPicks.length) {
      dom.topPicks.innerHTML = `<div class="empty-state">${emptyStateMessage()}</div>`;
      return;
    }
    dom.topPicks.innerHTML = `<div class="match-list top-pick-list">${topPicks.map(pick => {
      const meta = [];
      if (pick.pickProbability != null) meta.push(formatPercent(pick.pickProbability));
      if (pick.odd) meta.push(`${TEXT.odds} ${formatOdd(pick.odd)}`);
      else meta.push(pick.tag);
      if (pick.impactLabel) meta.push(pick.impactLabel);
      return `
        <article class="match-row match-row-featured status-${pick.status}" data-fixture-open="${pick.fixtureId}">
          <div class="match-row-inner">
            <div class="match-time-block">
              <div class="match-time">${escapeHtml(pick.matchTime || "--:--")}</div>
              <div class="match-date">${escapeHtml(state.selectedDate ? formatDate(state.selectedDate, { day: "2-digit", month: "2-digit" }) : "")}</div>
            </div>
            <div class="match-teams">
              <div class="match-league-line">${escapeHtml(pick.league)} | ${escapeHtml(pick.country || "")}</div>
              <div class="clubs-inline">
                <span class="club-line compact"><strong>${escapeHtml(pick.home)}</strong></span>
                <span class="match-vs">vs</span>
                <span class="club-line compact"><strong>${escapeHtml(pick.away)}</strong></span>
              </div>
            </div>
            <div class="match-action${pick.highImpact ? " match-action-impact" : ""}">
              <strong>${escapeHtml(pick.pickLabel || "-")}</strong>
              <small>${escapeHtml(meta.join(" | "))}</small>
            </div>
          </div>
        </article>
      `;
    }).join("")}</div>`;
  }

  function renderMatchRow(match, options = {}) {
    const showLeagueLine = options.showLeagueLine !== false;
    const primary = match.primaryMarket;
    const fixtureStatus = String(match.status_short || "").toUpperCase();
    const displayStatus = primary?.status || (FINAL_STATUSES.has(fixtureStatus) ? "unresolved" : (LIVE_STATUSES.has(fixtureStatus) ? "live" : "scheduled"));
    const picked = pickedOption(primary);
    const meta = [];
    if (displayStatus === "win") meta.push(TEXT.wonWord.toUpperCase());
    else if (displayStatus === "lose") meta.push(TEXT.lostWord.toUpperCase());
    else if (displayStatus === "live") meta.push("LIVE");
    if (primary?.pickProbability != null) meta.push(formatPercent(primary.pickProbability));
    if (picked?.odd) meta.push(`${TEXT.odds} ${formatOdd(picked.odd)}`);
    else if (primary?.tag) meta.push(primary.tag);
    if (primary?.impactLabel) meta.push(primary.impactLabel);
    if (match.visibleMarkets.length) meta.push(`${match.visibleMarkets.length} ${TEXT.markets}`);
    const scoreText = FINAL_STATUSES.has(fixtureStatus)
      ? `${TEXT.final} | ${escapeHtml(match.final_score || "-")}`
      : (match.most_likely_scores || []).slice(0, 2).map(score => `<span class="mini-chip">${escapeHtml(score[0])} | ${score[1]}%</span>`).join("") || escapeHtml(match.status_long || "");
    return `
      <article class="match-row status-${displayStatus}" data-fixture-open="${match.fixture_id}">
        <div class="match-row-inner">
          <div class="match-time-block">
            <div class="match-time">${escapeHtml(match.match_time || "--:--")}</div>
            <div class="match-date">${escapeHtml(formatDate(match.date, { day: "2-digit", month: "2-digit" }))}</div>
          </div>
          <div class="match-teams">
            ${showLeagueLine ? `<div class="match-league-line">${escapeHtml(match.league)} | ${escapeHtml(match.country)}</div>` : ""}
            <div class="clubs-inline">
              <span class="club-line">${match.home_logo ? `<img class="team-logo" src="${match.home_logo}" alt="" loading="lazy" />` : ""}<strong>${escapeHtml(match.home)}</strong></span>
              <span class="match-vs">vs</span>
              <span class="club-line">${match.away_logo ? `<img class="team-logo" src="${match.away_logo}" alt="" loading="lazy" />` : ""}<strong>${escapeHtml(match.away)}</strong></span>
            </div>
            <div class="match-score">${scoreText}</div>
          </div>
          <div class="match-action${primary?.highImpact ? " match-action-impact" : ""}">
            <strong>${escapeHtml(primary?.pickLabel || TEXT.viewMatch)}</strong>
            <small>${escapeHtml(meta.join(" | ") || TEXT.viewMatch)}</small>
          </div>
        </div>
      </article>
    `;
  }

  function renderLeagueFeed(matches) {
    if (!matches.length) {
      dom.leagueFeed.innerHTML = `<div class="empty-state">${emptyStateMessage()}</div>`;
      return;
    }
    const groups = groupMatches(matches).map(group => ({
      ...group,
      matches: state.sortMode === "time"
        ? [...group.matches].sort((a, b) => `${a.match_time || ""}-${a.home || ""}`.localeCompare(`${b.match_time || ""}-${b.home || ""}`))
        : [...group.matches].sort((a, b) => {
          const aKey = matchSortKey(a);
          const bKey = matchSortKey(b);
          for (let index = 0; index < aKey.length; index += 1) {
            if (aKey[index] < bKey[index]) return -1;
            if (aKey[index] > bKey[index]) return 1;
          }
          return 0;
        }),
    }));
    dom.leagueFeed.innerHTML = groups.map(group => {
      const header = `
        <div class="league-title">
          ${group.logo ? `<img class="league-logo" src="${group.logo}" alt="" loading="lazy" />` : `<span class="league-dot" aria-hidden="true"></span>`}
          <div>
            <h3>${escapeHtml(group.league)}</h3>
            <p>${escapeHtml(group.country)}</p>
          </div>
        </div>
        <span class="league-count">${group.matches.length}</span>
      `;
      const content = `<div class="match-list">${group.matches.map(match => renderMatchRow(match, { showLeagueLine: false })).join("")}</div>`;
      if (isMajorLeagueGroup(group)) {
        return `<section class="league-block league-block-major"><div class="league-header">${header}</div>${content}</section>`;
      }
      return `<details class="league-block league-accordion"${state.search ? " open" : ""}><summary class="league-header league-summary">${header}<span class="league-caret" aria-hidden="true"></span></summary>${content}</details>`;
    }).join("");
  }

  function renderMarketCard(market) {
    const expected = market.expected != null ? `<div class="market-expected"><span>${TEXT.expected}</span><strong>${Number(market.expected).toFixed(1)}</strong></div>` : "";
    const actual = market.actual != null ? `<div class="market-expected"><span>${TEXT.actual}</span><strong>${Number(market.actual).toFixed(1)}</strong></div>` : "";
    const visibleOptions = isDynamicTotalMarket(market.id) ? (market.options || []) : (market.options || []).slice(0, 4);
    const options = visibleOptions.map(option => `<div class="market-option${option.highImpact ? " market-option-impact" : ""}"><span>${escapeHtml(option.label)}${option.impactLabel ? ` <em>${escapeHtml(option.impactLabel)}</em>` : ""}</span><strong>${formatPercent(option.probability)}${option.odd ? ` | ${TEXT.odds} ${formatOdd(option.odd)}` : ""}</strong></div>`).join("");
    return `
      <article class="market-card status-${market.status}${market.highImpact ? " market-card-impact" : ""}">
        <div class="market-title-row">
          <div><div class="market-title">${escapeHtml(market.title)}</div><div class="market-pick">${escapeHtml(market.pickLabel || "-")}</div></div>
          <span class="market-tag${market.highImpact ? " market-tag-impact" : ""}">${escapeHtml(market.highImpact ? `${market.tag} | ${market.impactLabel}` : market.tag)}</span>
        </div>
        <div class="meta-row"><span class="status-pill status-${market.status}">${statusLabel(market.status)}</span><div class="market-probability">${formatPercent(market.pickProbability)}</div></div>
        ${expected}
        ${actual}
        ${options}
      </article>
    `;
  }

  function marketSummaryLabel(market, fallback = "-") {
    if (!market) return fallback;
    const parts = [];
    if (market.pickLabel) parts.push(market.pickLabel);
    if (market.pickProbability != null) parts.push(formatPercent(market.pickProbability));
    return parts.join(" | ") || fallback;
  }

  function renderDetail() {
    const match = getDetailMatch();
    if (!match) {
      dom.detailBody.innerHTML = state.detailFixtureId ? `<div class="empty-state">${TEXT.empty}</div>` : "";
      return;
    }
    const scoreChips = (match.most_likely_scores || []).slice(0, 5).map(score => `<span class="mini-chip">${escapeHtml(score[0])} | ${score[1]}%</span>`).join("");
    const marketGroups = GROUPS
      .map(group => ({
        label: group.label,
        markets: match.markets
          .filter(market => market.group === group.id && (!match.primaryMarket || market.id !== match.primaryMarket.id))
          .sort((a, b) => marketDisplayScore(b, match) - marketDisplayScore(a, match)),
      }))
      .filter(group => group.markets.length);
    const summaryMeta = label => `<span class="detail-summary-meta">${escapeHtml(label)}</span>`;
    dom.detailBody.innerHTML = `
      <article class="detail-hero">
        <div class="detail-teams">
          <div class="detail-team">${match.home_logo ? `<img class="team-logo" src="${match.home_logo}" alt="" loading="lazy" />` : ""}<h3>${escapeHtml(match.home)}</h3></div>
          <div class="detail-vs">VS</div>
          <div class="detail-team">${match.away_logo ? `<img class="team-logo" src="${match.away_logo}" alt="" loading="lazy" />` : ""}<h3>${escapeHtml(match.away)}</h3></div>
        </div>
        <div class="detail-meta-grid">
          <div class="detail-meta-card"><span>Campionato</span><strong>${escapeHtml(match.league)}</strong></div>
          <div class="detail-meta-card"><span>Kickoff</span><strong>${escapeHtml(match.match_time)} | ${escapeHtml(formatDate(match.date, { day: "2-digit", month: "2-digit" }))}</strong></div>
          <div class="detail-meta-card"><span>Stato</span><strong>${FINAL_STATUSES.has(String(match.status_short || "").toUpperCase()) ? `${TEXT.final} | ${escapeHtml(match.final_score || "-")}` : escapeHtml(match.status_long || statusLabel("scheduled"))}</strong></div>
        </div>
      </article>
      <div class="detail-stack">
        <details class="detail-accordion" open>
          <summary class="detail-summary"><span>${TEXT.detailPrimary}</span>${match.primaryMarket ? summaryMeta(marketSummaryLabel(match.primaryMarket)) : ""}</summary>
          <div class="detail-section"><div class="market-grid">${match.primaryMarket ? renderMarketCard(match.primaryMarket) : `<div class="empty-state">${TEXT.empty}</div>`}</div></div>
        </details>
        <details class="detail-accordion" open>
          <summary class="detail-summary"><span>${TEXT.detailScores}</span>${summaryMeta(`${Math.min((match.most_likely_scores || []).length, 5)} score`)}</summary>
          <div class="detail-section"><div class="score-chips">${scoreChips || `<span class="mini-chip">-</span>`}</div></div>
        </details>
        ${marketGroups.map(group => `<details class="detail-accordion"><summary class="detail-summary"><span>${escapeHtml(group.label)}</span>${summaryMeta(marketSummaryLabel(group.markets[0], `${group.markets.length} pick`))}</summary><div class="detail-section"><div class="market-grid">${group.markets.map(renderMarketCard).join("")}</div></div></details>`).join("")}
      </div>
    `;
  }

  function render() {
    const matches = getDerivedMatches();
    const orderedMatches = sortMatchesForFeed(matches);
    const topPicks = getTopPicks(matches);
    renderDateTabs();
    renderQuickRanges();
    renderFilterChips();
    renderFeedToolbar(orderedMatches);
    renderSummary(orderedMatches, topPicks);
    renderYesterdayBanner();
    renderActiveFilters();
    renderTopPicks(topPicks);
    renderLeagueFeed(orderedMatches);
    renderDetail();
    syncModalState();
  }

  function clearFilter(key) {
    if (key === "search") {
      state.search = "";
      dom.searchInput.value = "";
    }
    if (key === "time") {
      state.timeFrom = DEFAULTS.timeFrom;
      state.timeTo = DEFAULTS.timeTo;
    }
    if (key === "probability") {
      state.minProbability = DEFAULTS.minProbability;
      state.maxProbability = DEFAULTS.maxProbability;
    }
    if (key === "odd") {
      state.oddActive = false;
      state.oddFrom = DEFAULTS.oddFrom;
      state.oddTo = DEFAULTS.oddTo;
    }
    if (key === "status") state.status = "all";
    if (key === "groups") {
      state.groups = new Set(GROUPS.map(group => group.id));
      state.outcomeFilters = new Set();
    }
    if (key === "outcomes") state.outcomeFilters = new Set();
    render();
  }

  async function loadManifest() {
    state.manifest = await fetchJson(`${CACHE_BASE}/manifest.json`);
    const dates = Array.isArray(state.manifest?.dates) ? state.manifest.dates : [];
    const available = new Set(dates.map(item => item.date));
    if (!available.has(state.selectedDate)) state.selectedDate = state.manifest.latest_date || dates[0]?.date || "";
    dom.dateSelect.innerHTML = dates.map(entry => `<option value="${entry.date}">${formatDate(entry.date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</option>`).join("");
    dom.dateSelect.value = state.selectedDate;
  }

  async function loadCacheForDate(date) {
    if (!date) {
      state.cache = null;
      return;
    }
    const entry = (state.manifest?.dates || []).find(item => item.date === date);
    state.cache = await fetchJson(`${CACHE_BASE}/${entry?.file || `${date}.json`}`);
  }

  async function selectDate(date) {
    state.selectedDate = date;
    await loadCacheForDate(date);
    render();
  }

  async function refreshData() {
    try {
      await loadManifest();
      await loadCacheForDate(state.selectedDate);
    } catch (error) {
      console.warn("Match center refresh failed:", error);
      state.cache = null;
    }
    render();
  }

  function applyTimeFilter(fromValue, toValue) {
    state.timeFrom = fromValue || DEFAULTS.timeFrom;
    state.timeTo = toValue || DEFAULTS.timeTo;
    if (state.timeFrom > state.timeTo) {
      if (toValue != null) state.timeFrom = state.timeTo;
      else state.timeTo = state.timeFrom;
    }
    render();
  }

  function applyProbabilityRange(minValue, maxValue, changedField = "min") {
    state.minProbability = Math.round(clampNumber(minValue, 45, 99, DEFAULTS.minProbability));
    state.maxProbability = Math.round(clampNumber(maxValue, 45, 99, DEFAULTS.maxProbability));
    if (state.minProbability > state.maxProbability) {
      if (changedField === "max") state.minProbability = state.maxProbability;
      else state.maxProbability = state.minProbability;
    }
    render();
  }

  function applyOddFilter(fromValue, toValue, changedField = "from") {
    state.oddFrom = clampNumber(fromValue, 1.01, 10, DEFAULTS.oddFrom);
    state.oddTo = clampNumber(toValue, 1.01, 10, DEFAULTS.oddTo);
    if (state.oddFrom > state.oddTo) {
      if (changedField === "to") state.oddFrom = state.oddTo;
      else state.oddTo = state.oddFrom;
    }
    state.oddActive = state.oddFrom > DEFAULTS.oddFrom || state.oddTo < DEFAULTS.oddTo;
    render();
  }

  function scrollToInlineFilters() {
    dom.inlineFilterBoard?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function bindEvents() {
    dom.searchInput.addEventListener("input", () => {
      state.search = dom.searchInput.value.trim().toLowerCase();
      render();
    });
    if (dom.searchLauncher) {
      dom.searchLauncher.addEventListener("click", () => {
        dom.searchInput.focus();
        dom.searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    if (dom.dateJump) {
      dom.dateJump.addEventListener("click", () => {
        dom.dateTabs.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    if (dom.filterLauncher) {
      dom.filterLauncher.addEventListener("click", scrollToInlineFilters);
    }
    if (dom.filterToggle) {
      dom.filterToggle.addEventListener("click", scrollToInlineFilters);
    }
    if (dom.sortToggle) {
      dom.sortToggle.addEventListener("click", () => {
        state.sortMode = state.sortMode === "priority" ? "time" : "priority";
        render();
      });
    }
    if (dom.filterSheetClose) {
      dom.filterSheetClose.addEventListener("click", () => {
        state.filterOpen = false;
        syncModalState();
      });
    }
    dom.detailClose.addEventListener("click", () => {
      state.detailFixtureId = null;
      syncModalState();
    });
    dom.detailOverlay.addEventListener("click", () => {
      state.detailFixtureId = null;
      syncModalState();
    });
    dom.timeFrom.addEventListener("change", () => applyTimeFilter(dom.timeFrom.value, state.timeTo));
    dom.timeTo.addEventListener("change", () => applyTimeFilter(state.timeFrom, dom.timeTo.value));
    if (dom.probabilityMinInput) dom.probabilityMinInput.addEventListener("change", () => applyProbabilityRange(dom.probabilityMinInput.value, state.maxProbability, "min"));
    if (dom.probabilityMaxInput) dom.probabilityMaxInput.addEventListener("change", () => applyProbabilityRange(state.minProbability, dom.probabilityMaxInput.value, "max"));
    if (dom.oddFrom) dom.oddFrom.addEventListener("change", () => applyOddFilter(dom.oddFrom.value, state.oddTo, "from"));
    if (dom.oddTo) dom.oddTo.addEventListener("change", () => applyOddFilter(state.oddFrom, dom.oddTo.value, "to"));
    dom.resetFilters.addEventListener("click", () => {
      state.groups = new Set(GROUPS.map(group => group.id));
      state.outcomeFilters = new Set();
      state.status = "all";
      state.minProbability = DEFAULTS.minProbability;
      state.maxProbability = DEFAULTS.maxProbability;
      state.oddActive = false;
      state.oddFrom = DEFAULTS.oddFrom;
      state.oddTo = DEFAULTS.oddTo;
      state.search = "";
      state.timeFrom = DEFAULTS.timeFrom;
      state.timeTo = DEFAULTS.timeTo;
      dom.searchInput.value = "";
      render();
    });
    dom.marketsAll.addEventListener("click", () => {
      state.groups = new Set(GROUPS.map(group => group.id));
      pruneOutcomeFilters();
      render();
    });
    dom.marketsNone.addEventListener("click", () => {
      state.groups = new Set();
      pruneOutcomeFilters();
      render();
    });
    document.addEventListener("click", async event => {
      const dateButton = event.target.closest("[data-date]");
      if (dateButton) {
        await selectDate(dateButton.dataset.date || "");
        return;
      }
      const yesterdayButton = event.target.closest("[data-date-banner]");
      if (yesterdayButton) {
        await selectDate(yesterdayButton.dataset.dateBanner || "");
        return;
      }
      const quickButton = event.target.closest("[data-quick-range]");
      if (quickButton) {
        const range = QUICK_RANGES.find(item => item.id === quickButton.dataset.quickRange);
        if (range) {
          state.timeFrom = range.from;
          state.timeTo = range.to;
          render();
        }
        return;
      }
      const oddPresetButton = event.target.closest("[data-odd-preset]");
      if (oddPresetButton) {
        const preset = ODD_PRESETS.find(item => item.id === oddPresetButton.dataset.oddPreset);
        if (preset) {
          state.oddActive = preset.id !== "all";
          state.oddFrom = preset.from;
          state.oddTo = preset.to;
          render();
        }
        return;
      }
      const probabilityPresetButton = event.target.closest("[data-probability-preset]");
      if (probabilityPresetButton) {
        const presetValue = probabilityPresetButton.dataset.probabilityPreset;
        if (presetValue === "all") {
          state.minProbability = DEFAULTS.minProbability;
          state.maxProbability = DEFAULTS.maxProbability;
        } else {
          state.minProbability = Number(presetValue);
          state.maxProbability = DEFAULTS.maxProbability;
        }
        render();
        return;
      }
      const quickGroupButton = event.target.closest("[data-quick-group]");
      if (quickGroupButton) {
        const quickGroup = quickGroupButton.dataset.quickGroup;
        if (quickGroup === "all") {
          state.groups = new Set(GROUPS.map(group => group.id));
          state.outcomeFilters = new Set();
        } else {
          state.groups = new Set([quickGroup]);
          state.outcomeFilters = new Set([...state.outcomeFilters].filter(id => OUTCOME_FILTERS.find(filter => filter.id === id)?.group === quickGroup));
        }
        render();
        return;
      }
      const quickOutcomeClearButton = event.target.closest("[data-quick-outcome-clear]");
      if (quickOutcomeClearButton) {
        const groupId = quickOutcomeClearButton.dataset.quickOutcomeClear;
        state.outcomeFilters = new Set([...state.outcomeFilters].filter(id => OUTCOME_FILTERS.find(filter => filter.id === id)?.group !== groupId));
        render();
        return;
      }
      const quickOutcomeButton = event.target.closest("[data-quick-outcome]");
      if (quickOutcomeButton) {
        const outcomeId = quickOutcomeButton.dataset.quickOutcome;
        const filter = OUTCOME_FILTERS.find(item => item.id === outcomeId);
        if (!filter) return;
        state.groups = new Set([filter.group]);
        const alreadySingle = selectedOutcomeFiltersForGroup(filter.group).length === 1 && state.outcomeFilters.has(outcomeId);
        state.outcomeFilters = new Set();
        if (!alreadySingle) state.outcomeFilters.add(outcomeId);
        render();
        return;
      }
      const groupButton = event.target.closest("[data-group]");
      if (groupButton) {
        const group = groupButton.dataset.group;
        if (state.groups.size === GROUPS.length) state.groups = new Set([group]);
        else if (state.groups.has(group)) state.groups.delete(group);
        else state.groups.add(group);
        pruneOutcomeFilters();
        render();
        return;
      }
      const outcomeButton = event.target.closest("[data-outcome]");
      if (outcomeButton) {
        const outcomeId = outcomeButton.dataset.outcome;
        const filter = OUTCOME_FILTERS.find(item => item.id === outcomeId);
        if (!filter) return;
        if (state.outcomeFilters.has(outcomeId)) state.outcomeFilters.delete(outcomeId);
        else {
          state.outcomeFilters.add(outcomeId);
          state.groups.add(filter.group);
        }
        render();
        return;
      }
      const statusButton = event.target.closest("[data-status]");
      if (statusButton) {
        state.status = statusButton.dataset.status || "all";
        render();
        return;
      }
      const clearButton = event.target.closest("[data-clear-filter]");
      if (clearButton) {
        clearFilter(clearButton.dataset.clearFilter || "");
        return;
      }
      const openButton = event.target.closest("[data-fixture-open]");
      if (openButton) {
        state.detailFixtureId = openButton.dataset.fixtureOpen || openButton.getAttribute("data-fixture-open");
        renderDetail();
        syncModalState();
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (state.detailFixtureId) state.detailFixtureId = null;
      else if (state.filterOpen) state.filterOpen = false;
      syncModalState();
    });
  }

  function startAutoRefresh() {
    window.setInterval(() => {
      if (!document.hidden) refreshData();
    }, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshData();
    });
  }

  async function init() {
    populateTimeSelects();
    populateProbabilitySelects();
    populateOddSelects();
    renderRangePanels();
    bindEvents();
    await refreshData();
    startAutoRefresh();
  }

  init().catch(error => {
    console.error(error);
    if (dom.topPicks) dom.topPicks.innerHTML = `<div class="empty-state">${TEXT.noCache}</div>`;
    if (dom.leagueFeed) dom.leagueFeed.innerHTML = `<div class="empty-state">${TEXT.noCache}</div>`;
  });
})();
