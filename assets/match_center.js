(() => {
  const LIVE_STATUSES = new Set(["1H", "2H", "ET", "LIVE", "HT", "P", "BT", "INT"]);
  const FINAL_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
  const CACHE_BASE = "/assets/data/match-predictor";
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  const DEFAULTS = { minProbability: 55, timeFrom: "00:00", timeTo: "23:59" };
  const GROUPS = [
    { id: "goals", short: "O/U", label: "Goal" },
    { id: "double", short: "DC", label: "Doppia chance" },
    { id: "btts", short: "BTTS", label: "BTTS" },
    { id: "combo", short: "COMBO", label: "Combo" },
    { id: "blank", short: "NG", label: "No goal" },
    { id: "corners", short: "CRN", label: "Corner" },
    { id: "yellows", short: "YC", label: "Cartellini" },
  ];
  const STATUS_OPTIONS = [
    { id: "all", label: "Tutti" },
    { id: "scheduled", label: "Da giocare" },
    { id: "live", label: "Live" },
    { id: "win", label: "Verde" },
    { id: "lose", label: "Rosso" },
    { id: "unresolved", label: "Non risolto" },
  ];
  const QUICK_RANGES = [
    { id: "all_day", label: "Tutto il giorno", from: "00:00", to: "23:59" },
    { id: "morning", label: "Mattina", from: "06:00", to: "11:59" },
    { id: "afternoon", label: "Pomeriggio", from: "12:00", to: "17:59" },
    { id: "evening", label: "Sera", from: "18:00", to: "23:59" },
  ];
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
    filterStatus: "Esito",
    filterMarkets: "Mercati",
    detailPrimary: "Pick principale",
    detailScores: "Score piu probabili",
    liveWord: "live",
    finalWord: "finali",
  };
  const state = {
    manifest: null,
    selectedDate: "",
    cache: null,
    groups: new Set(GROUPS.map(group => group.id)),
    status: "all",
    minProbability: DEFAULTS.minProbability,
    search: "",
    timeFrom: DEFAULTS.timeFrom,
    timeTo: DEFAULTS.timeTo,
    filterOpen: false,
    detailFixtureId: null,
  };
  const dom = {
    dateTabs: document.getElementById("date-tabs"),
    dateSelect: document.getElementById("date-select"),
    searchInput: document.getElementById("search-input"),
    filterToggle: document.getElementById("filter-toggle"),
    filterCount: document.getElementById("filter-count"),
    filterSheet: document.getElementById("filter-sheet"),
    filterSheetClose: document.getElementById("filter-sheet-close"),
    filterOverlay: document.getElementById("filter-overlay"),
    quickRangeChips: document.getElementById("quick-range-chips"),
    timeFrom: document.getElementById("time-from"),
    timeTo: document.getElementById("time-to"),
    probabilityRange: document.getElementById("probability-range"),
    probabilityValue: document.getElementById("probability-value"),
    resetFilters: document.getElementById("reset-filters"),
    marketsAll: document.getElementById("markets-all"),
    marketsNone: document.getElementById("markets-none"),
    marketChips: document.getElementById("market-chips"),
    statusChips: document.getElementById("status-chips"),
    topPicks: document.getElementById("top-picks"),
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

  function formatDate(dateStr, options) {
    if (!dateStr) return "-";
    return new Intl.DateTimeFormat("it-IT", options).format(new Date(`${dateStr}T00:00:00`));
  }

  function formatDateTime(isoValue) {
    if (!isoValue) return "-";
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(isoValue));
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
      for (let minute = 0; minute < 60; minute += 15) {
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

  function normalizeMap(raw) {
    return Object.entries(raw || {}).filter(([, value]) => value != null).map(([key, value]) => ({ key, value: Number(value) }));
  }

  function bestLine(raw) {
    return normalizeMap(raw).sort((a, b) => b.value - a.value)[0] || null;
  }

  function marketGroup(groupId) {
    return GROUPS.find(group => group.id === groupId);
  }

  function statusLabel(status) {
    return STATUS_OPTIONS.find(option => option.id === status)?.label || status;
  }

  function resolveMarketStatus(match, market) {
    const fixtureStatus = String(match.status_short || "").toUpperCase();
    if (market.id === "corners" || market.id === "yellows") {
      if (FINAL_STATUSES.has(fixtureStatus)) {
        const actual = Number(market.actual);
        const line = Number(String(market.pickLabel || "").replace("OVER ", ""));
        if (Number.isFinite(actual) && Number.isFinite(line)) return actual > line ? "win" : "lose";
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

  function buildMarkets(match) {
    const cornerLine = bestLine(match.corner_overs);
    const yellowLine = bestLine(match.yellow_overs);
    return [
      { id: "ou15", group: "goals", title: "Over / Under 1.5", pickLabel: match.ou15_pick, pickProbability: match.ou15_conf, options: [{ label: "Over 1.5", probability: match.p_over15, odd: match.odd_o15 }, { label: "Under 1.5", probability: match.p_under15, odd: match.odd_u15 }] },
      { id: "ou25", group: "goals", title: "Over / Under 2.5", pickLabel: match.ou_pick, pickProbability: match.ou_conf, options: [{ label: "Over 2.5", probability: match.p_over25, odd: match.odd_o25 }, { label: "Under 2.5", probability: match.p_under25, odd: match.odd_u25 }] },
      { id: "o35", group: "goals", title: "Over / Under 3.5", pickLabel: match.ou35_pick || (Number(match.p_over35 || 0) >= 0.5 ? "Over 3.5" : "Under 3.5"), pickProbability: match.ou35_conf ?? Math.max(Number(match.p_over35 || 0), Number(match.p_under35 || 0)), options: [{ label: "Over 3.5", probability: match.p_over35, odd: match.odd_o35 }, { label: "Under 3.5", probability: match.p_under35, odd: match.odd_u35 }] },
      { id: "dc", group: "double", title: "Doppia chance", pickLabel: match.dc_pick, pickProbability: match.dc_conf, options: [{ label: "1X", probability: match.p_1x, odd: match.odd_1x }, { label: "X2", probability: match.p_x2, odd: match.odd_x2 }] },
      { id: "btts", group: "btts", title: "Both Teams To Score", pickLabel: match.btts_pick, pickProbability: match.btts_conf, options: [{ label: "BTTS YES", probability: match.p_btts_yes, odd: match.odd_btts_y }, { label: "BTTS NO", probability: match.p_btts_no, odd: match.odd_btts_n }] },
      { id: "combo", group: "combo", title: "Combo Goals", pickLabel: "Over 2.5 + BTTS", pickProbability: match.p_o25_btts, options: [{ label: "Over 2.5 + BTTS", probability: match.p_o25_btts, odd: null }] },
      { id: "nogol", group: "blank", title: "No goal", pickLabel: `${match.nogol_team} ${TEXT.teamBlank}`, pickProbability: Math.max(Number(match.p_home_blanked || 0), Number(match.p_away_blanked || 0)), options: [{ label: `${match.home} ${TEXT.teamBlank}`, probability: match.p_home_blanked, odd: null }, { label: `${match.away} ${TEXT.teamBlank}`, probability: match.p_away_blanked, odd: null }] },
      { id: "corners", group: "corners", title: "Corner", pickLabel: cornerLine ? `Over ${cornerLine.key}` : "", pickProbability: cornerLine ? cornerLine.value : null, expected: match.exp_corners, actual: match.total_corners, options: normalizeMap(match.corner_overs).map(item => ({ label: `Over ${item.key}`, probability: item.value, odd: null })) },
      { id: "yellows", group: "yellows", title: "Cartellini", pickLabel: yellowLine ? `Over ${yellowLine.key}` : "", pickProbability: yellowLine ? yellowLine.value : null, expected: match.exp_yellows, actual: match.total_yellows, options: normalizeMap(match.yellow_overs).map(item => ({ label: `Over ${item.key}`, probability: item.value, odd: null })) },
    ].map(market => ({ ...market, status: resolveMarketStatus(match, market), tag: marketGroup(market.group)?.short || market.group.toUpperCase() }));
  }

  function selectPrimaryMarket(markets) {
    return [...markets].sort((a, b) => Number(b.pickProbability || 0) - Number(a.pickProbability || 0))[0] || null;
  }

  function decorateMatches(rawMatches, keepAll = false) {
    const search = state.search.trim().toLowerCase();
    return rawMatches
      .map(match => {
        const markets = buildMarkets(match);
        const visibleMarkets = markets
          .filter(market => state.groups.has(market.group))
          .filter(market => Number(market.pickProbability || 0) * 100 >= state.minProbability)
          .filter(market => state.status === "all" ? true : market.status === state.status);
        const searchBlob = `${match.home} ${match.away} ${match.league} ${match.country} ${markets.flatMap(market => [market.title, market.pickLabel, ...(market.options || []).map(option => option.label)]).join(" ")}`.toLowerCase();
        return { ...match, markets, visibleMarkets, primaryMarket: selectPrimaryMarket(visibleMarkets), searchBlob };
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
    return { ...rawMatch, markets, primaryMarket: selectPrimaryMarket(markets) };
  }

  function getTopPicks(matches) {
    return matches
      .flatMap(match => match.visibleMarkets.map(market => {
        const picked = (market.options || []).find(option => option.label === market.pickLabel);
        return { fixtureId: match.fixture_id, home: match.home, away: match.away, league: match.league, matchTime: match.match_time, pickLabel: market.pickLabel, pickProbability: market.pickProbability, status: market.status, tag: market.tag, odd: picked?.odd ?? null };
      }))
      .sort((a, b) => Number(b.pickProbability || 0) - Number(a.pickProbability || 0))
      .slice(0, 10);
  }

  function groupMatches(matches) {
    const groups = new Map();
    matches.forEach(match => {
      const key = `${match.country || ""}__${match.league || ""}`;
      if (!groups.has(key)) groups.set(key, { key, country: match.country || "", league: match.league || "", logo: match.league_logo || "", matches: [] });
      groups.get(key).matches.push(match);
    });
    return [...groups.values()].sort((a, b) => `${a.matches[0]?.match_time || ""}-${a.league}`.localeCompare(`${b.matches[0]?.match_time || ""}-${b.league}`));
  }

  function activeQuickRangeId() {
    return QUICK_RANGES.find(range => range.from === state.timeFrom && range.to === state.timeTo)?.id || "";
  }

  function activeFilterCount() {
    let count = 0;
    if (state.search) count += 1;
    if (state.timeFrom !== DEFAULTS.timeFrom || state.timeTo !== DEFAULTS.timeTo) count += 1;
    if (state.minProbability !== DEFAULTS.minProbability) count += 1;
    if (state.status !== "all") count += 1;
    if (state.groups.size !== GROUPS.length) count += 1;
    return count;
  }

  function emptyStateMessage() {
    if (!state.groups.size) return TEXT.noMarketSelected;
    return state.cache ? TEXT.empty : TEXT.noCache;
  }

  function syncModalState() {
    dom.filterSheet.classList.toggle("open", state.filterOpen);
    dom.filterOverlay.classList.toggle("visible", state.filterOpen);
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

  function renderFilterChips() {
    dom.marketChips.innerHTML = GROUPS.map(group => `<button type="button" class="chip-btn ${state.groups.has(group.id) ? "active" : ""}" data-group="${group.id}">${group.label}</button>`).join("");
    dom.statusChips.innerHTML = STATUS_OPTIONS.map(option => `<button type="button" class="chip-btn ${state.status === option.id ? "active" : ""}" data-status="${option.id}">${option.label}</button>`).join("");
    dom.marketsAll.classList.toggle("active", state.groups.size === GROUPS.length);
    dom.marketsNone.classList.toggle("active", state.groups.size === 0);
    dom.timeFrom.value = state.timeFrom;
    dom.timeTo.value = state.timeTo;
    dom.probabilityRange.value = String(state.minProbability);
    dom.probabilityValue.textContent = `${state.minProbability}%`;
    dom.filterCount.textContent = String(activeFilterCount());
  }

  function renderSummary(matches, topPicks) {
    const liveCount = matches.filter(match => LIVE_STATUSES.has(String(match.status_short || "").toUpperCase())).length;
    const finalCount = matches.filter(match => FINAL_STATUSES.has(String(match.status_short || "").toUpperCase())).length;
    const settled = matches.flatMap(match => match.visibleMarkets);
    const winCount = settled.filter(market => market.status === "win").length;
    const loseCount = settled.filter(market => market.status === "lose").length;
    document.getElementById("summary-matches").textContent = String(matches.length);
    document.getElementById("summary-top").textContent = String(topPicks.length);
    document.getElementById("summary-live").textContent = `${liveCount} / ${finalCount}`;
    document.getElementById("summary-live-meta").textContent = `${liveCount} ${TEXT.liveWord} - ${finalCount} ${TEXT.finalWord}`;
    document.getElementById("summary-settled").textContent = `${winCount} / ${loseCount}`;
    document.getElementById("hero-window-value").textContent = `${state.timeFrom} - ${state.timeTo}`;
    document.getElementById("hero-date-value").textContent = state.selectedDate ? formatDate(state.selectedDate, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : "-";
    document.getElementById("hero-sync-value").textContent = formatDateTime(state.cache?.refreshed_at || state.cache?.generated_at);
  }

  function renderActiveFilters() {
    const chips = [];
    if (state.search) chips.push({ key: "search", label: `${TEXT.filterSearch}: ${state.search}` });
    if (state.timeFrom !== DEFAULTS.timeFrom || state.timeTo !== DEFAULTS.timeTo) chips.push({ key: "time", label: `${TEXT.filterTime}: ${state.timeFrom}-${state.timeTo}` });
    if (state.minProbability !== DEFAULTS.minProbability) chips.push({ key: "probability", label: `${TEXT.filterProbability}: ${state.minProbability}%+` });
    if (state.status !== "all") chips.push({ key: "status", label: `${TEXT.filterStatus}: ${statusLabel(state.status)}` });
    if (state.groups.size !== GROUPS.length) chips.push({ key: "groups", label: `${TEXT.filterMarkets}: ${state.groups.size}/${GROUPS.length}` });
    dom.activeFilters.style.display = chips.length ? "flex" : "none";
    dom.activeFilters.innerHTML = chips.map(chip => `<button type="button" class="active-filter" data-clear-filter="${chip.key}">${escapeHtml(chip.label)} <span aria-hidden="true">x</span></button>`).join("");
  }

  function renderTopPicks(topPicks) {
    if (!topPicks.length) {
      dom.topPicks.innerHTML = `<div class="empty-state">${emptyStateMessage()}</div>`;
      return;
    }
    dom.topPicks.innerHTML = topPicks.map(pick => `
      <article class="top-pick-card" data-fixture-open="${pick.fixtureId}">
        <div class="meta-row"><span class="market-tag">${escapeHtml(pick.tag)}</span><span class="status-pill status-${pick.status}">${statusLabel(pick.status)}</span></div>
        <time>${escapeHtml(pick.matchTime)} | ${escapeHtml(pick.league)}</time>
        <h3>${escapeHtml(pick.home)} vs ${escapeHtml(pick.away)}</h3>
        <div class="pick-title">${escapeHtml(pick.pickLabel || "-")}</div>
        <div class="pick-meta">${pick.odd ? `${TEXT.odds} ${formatOdd(pick.odd)}` : "&nbsp;"}</div>
        <div class="pick-metrics"><span class="pick-meta">${TEXT.confidence}</span><strong>${formatPercent(pick.pickProbability)}</strong></div>
      </article>
    `).join("");
  }

  function renderMatchRow(match) {
    const primary = match.primaryMarket;
    const fixtureStatus = String(match.status_short || "").toUpperCase();
    const displayStatus = primary?.status || (FINAL_STATUSES.has(fixtureStatus) ? "unresolved" : (LIVE_STATUSES.has(fixtureStatus) ? "live" : "scheduled"));
    const picked = (primary?.options || []).find(option => option.label === primary?.pickLabel);
    const meta = [];
    if (primary?.pickProbability != null) meta.push(formatPercent(primary.pickProbability));
    if (picked?.odd) meta.push(`${TEXT.odds} ${formatOdd(picked.odd)}`);
    if (match.visibleMarkets.length) meta.push(`${match.visibleMarkets.length} ${TEXT.markets}`);
    const secondaryMarkets = match.visibleMarkets
      .filter(market => !primary || market.id !== primary.id)
      .sort((a, b) => Number(b.pickProbability || 0) - Number(a.pickProbability || 0))
      .slice(0, 2)
      .map(market => `<span class="mini-chip">${escapeHtml(market.pickLabel || market.title)} | ${formatPercent(market.pickProbability)}</span>`)
      .join("");
    const scoreText = FINAL_STATUSES.has(fixtureStatus)
      ? `${TEXT.final} | ${escapeHtml(match.final_score || "-")}`
      : (match.most_likely_scores || []).slice(0, 2).map(score => `<span class="mini-chip">${escapeHtml(score[0])} | ${score[1]}%</span>`).join("") || escapeHtml(match.status_long || "");
    return `
      <article class="match-row status-${displayStatus}" data-fixture-open="${match.fixture_id}">
        <div class="match-row-inner">
          <div class="match-time-block">
            <div class="match-time">${escapeHtml(match.match_time || "--:--")}</div>
            <div class="match-date">${escapeHtml(formatDate(match.date, { day: "2-digit", month: "2-digit" }))}</div>
            <span class="status-pill status-${displayStatus}">${statusLabel(displayStatus)}</span>
          </div>
          <div class="match-teams">
            <div class="club-line">${match.home_logo ? `<img class="team-logo" src="${match.home_logo}" alt="" loading="lazy" />` : ""}<strong>${escapeHtml(match.home)}</strong></div>
            <div class="club-line">${match.away_logo ? `<img class="team-logo" src="${match.away_logo}" alt="" loading="lazy" />` : ""}<strong>${escapeHtml(match.away)}</strong></div>
            <div class="match-score">${scoreText}</div>
          </div>
          <div class="pick-snapshot">
            <div class="meta-row"><span class="market-tag">${escapeHtml(primary?.tag || "--")}</span><span class="mini-chip">${escapeHtml(match.league || "")}</span></div>
            <div class="pick-title">${escapeHtml(primary?.pickLabel || "-")}</div>
            <div class="pick-meta">${escapeHtml(meta.join(" | "))}</div>
            <div class="secondary-picks">${secondaryMarkets}</div>
          </div>
          <button type="button" class="detail-button" data-fixture-open="${match.fixture_id}">${TEXT.viewMatch}</button>
        </div>
      </article>
    `;
  }

  function renderLeagueFeed(groups) {
    if (!groups.length) {
      dom.leagueFeed.innerHTML = `<div class="empty-state">${emptyStateMessage()}</div>`;
      return;
    }
    dom.leagueFeed.innerHTML = groups.map(group => `
      <section class="league-block">
        <div class="league-header">
          <div class="league-title">
            ${group.logo ? `<img class="league-logo" src="${group.logo}" alt="" loading="lazy" />` : ""}
            <div><h3>${escapeHtml(group.league)}</h3><p>${escapeHtml(group.country)} | ${group.matches.length} ${TEXT.matches}</p></div>
          </div>
          <div class="league-count">${group.matches.length}</div>
        </div>
        <div class="match-list">${group.matches.map(renderMatchRow).join("")}</div>
      </section>
    `).join("");
  }

  function renderMarketCard(market) {
    const expected = market.expected != null ? `<div class="market-expected"><span>${TEXT.expected}</span><strong>${Number(market.expected).toFixed(1)}</strong></div>` : "";
    const actual = market.actual != null ? `<div class="market-expected"><span>${TEXT.actual}</span><strong>${Number(market.actual).toFixed(1)}</strong></div>` : "";
    const options = (market.options || []).slice(0, 4).map(option => `<div class="market-option"><span>${escapeHtml(option.label)}</span><strong>${formatPercent(option.probability)}${option.odd ? ` | ${TEXT.odds} ${formatOdd(option.odd)}` : ""}</strong></div>`).join("");
    return `
      <article class="market-card status-${market.status}">
        <div class="market-title-row">
          <div><div class="market-title">${escapeHtml(market.title)}</div><div class="market-pick">${escapeHtml(market.pickLabel || "-")}</div></div>
          <span class="market-tag">${escapeHtml(market.tag)}</span>
        </div>
        <div class="meta-row"><span class="status-pill status-${market.status}">${statusLabel(market.status)}</span><div class="market-probability">${formatPercent(market.pickProbability)}</div></div>
        ${expected}
        ${actual}
        ${options}
      </article>
    `;
  }

  function renderDetail() {
    const match = getDetailMatch();
    if (!match) {
      dom.detailBody.innerHTML = state.detailFixtureId ? `<div class="empty-state">${TEXT.empty}</div>` : "";
      return;
    }
    const scoreChips = (match.most_likely_scores || []).slice(0, 5).map(score => `<span class="mini-chip">${escapeHtml(score[0])} | ${score[1]}%</span>`).join("");
    const marketGroups = GROUPS
      .map(group => ({ label: group.label, markets: match.markets.filter(market => market.group === group.id && (!match.primaryMarket || market.id !== match.primaryMarket.id)) }))
      .filter(group => group.markets.length);
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
        <section class="detail-section"><h3>${TEXT.detailPrimary}</h3><div class="market-grid">${match.primaryMarket ? renderMarketCard(match.primaryMarket) : `<div class="empty-state">${TEXT.empty}</div>`}</div></section>
        <section class="detail-section"><h3>${TEXT.detailScores}</h3><div class="score-chips">${scoreChips || `<span class="mini-chip">-</span>`}</div></section>
        ${marketGroups.map(group => `<section class="detail-section"><h3>${escapeHtml(group.label)}</h3><div class="market-grid">${group.markets.map(renderMarketCard).join("")}</div></section>`).join("")}
      </div>
    `;
  }

  function render() {
    const matches = getDerivedMatches();
    const topPicks = getTopPicks(matches);
    renderDateTabs();
    renderQuickRanges();
    renderFilterChips();
    renderSummary(matches, topPicks);
    renderActiveFilters();
    renderTopPicks(topPicks);
    renderLeagueFeed(groupMatches(matches));
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
    if (key === "probability") state.minProbability = DEFAULTS.minProbability;
    if (key === "status") state.status = "all";
    if (key === "groups") state.groups = new Set(GROUPS.map(group => group.id));
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

  function bindEvents() {
    dom.searchInput.addEventListener("input", () => {
      state.search = dom.searchInput.value.trim().toLowerCase();
      render();
    });
    dom.filterToggle.addEventListener("click", () => {
      state.filterOpen = !state.filterOpen;
      syncModalState();
    });
    dom.filterSheetClose.addEventListener("click", () => {
      state.filterOpen = false;
      syncModalState();
    });
    dom.filterOverlay.addEventListener("click", () => {
      state.filterOpen = false;
      syncModalState();
    });
    dom.detailClose.addEventListener("click", () => {
      state.detailFixtureId = null;
      syncModalState();
    });
    dom.detailOverlay.addEventListener("click", () => {
      state.detailFixtureId = null;
      syncModalState();
    });
    dom.timeFrom.addEventListener("change", () => {
      state.timeFrom = dom.timeFrom.value || DEFAULTS.timeFrom;
      if (state.timeFrom > state.timeTo) state.timeTo = state.timeFrom;
      render();
    });
    dom.timeTo.addEventListener("change", () => {
      state.timeTo = dom.timeTo.value || DEFAULTS.timeTo;
      if (state.timeTo < state.timeFrom) state.timeFrom = state.timeTo;
      render();
    });
    dom.probabilityRange.addEventListener("input", () => {
      state.minProbability = Number(dom.probabilityRange.value || DEFAULTS.minProbability);
      render();
    });
    dom.resetFilters.addEventListener("click", () => {
      state.groups = new Set(GROUPS.map(group => group.id));
      state.status = "all";
      state.minProbability = DEFAULTS.minProbability;
      state.search = "";
      state.timeFrom = DEFAULTS.timeFrom;
      state.timeTo = DEFAULTS.timeTo;
      dom.searchInput.value = "";
      render();
    });
    dom.marketsAll.addEventListener("click", () => {
      state.groups = new Set(GROUPS.map(group => group.id));
      render();
    });
    dom.marketsNone.addEventListener("click", () => {
      state.groups = new Set();
      render();
    });
    document.addEventListener("click", async event => {
      const dateButton = event.target.closest("[data-date]");
      if (dateButton) {
        await selectDate(dateButton.dataset.date || "");
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
      const groupButton = event.target.closest("[data-group]");
      if (groupButton) {
        const group = groupButton.dataset.group;
        if (state.groups.size === GROUPS.length) state.groups = new Set([group]);
        else if (state.groups.has(group)) state.groups.delete(group);
        else state.groups.add(group);
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
