(() => {
  const LIVE_STATUSES = new Set(["1H", "2H", "ET", "LIVE", "HT", "P", "BT", "INT"]);
  const FINAL_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
  const CACHE_BASE = "/assets/data/match-predictor";
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  const GROUPS = [
    { id: "goals", short: "O/U" },
    { id: "double", short: "DC" },
    { id: "btts", short: "BTTS" },
    { id: "combo", short: "COMBO" },
    { id: "blank", short: "NG" },
    { id: "corners", short: "CRN" },
    { id: "yellows", short: "YC" },
  ];

  const STATUS_OPTIONS = ["all", "scheduled", "live", "win", "lose", "unresolved"];

  const I18N = {
    it: {
      hero_title: "Match Center",
      hero_copy: "Analisi filtrabile della giornata: scegli fascia oraria, cerca squadre o campionati e controlla subito quali mercati stanno andando verdi o rossi.",
      hero_window_label: "Finestra",
      hero_date_label: "Cache",
      hero_sync_label: "Sync",
      back_home: "Torna ai pronostici",
      history: "Storico ROI",
      filters: "Filtri",
      sync_note: "Aggiornamento automatico attivo",
      date: "Data disponibile",
      time: "Intervallo orario",
      search: "Cerca squadra o campionato",
      search_placeholder: "Es. Milan, Serie A, BTTS",
      probability: "Probabilita minima pick",
      markets: "Mercati",
      status: "Esito",
      reset: "Reset filtri",
      summary_matches: "Partite visibili",
      summary_matches_meta: "Nel blocco filtrato",
      summary_top: "Top picks",
      summary_top_meta: "Edge sopra soglia",
      summary_live: "Match live / chiusi",
      summary_live_meta: "Stato cache corrente",
      summary_settled: "Pick verdi / rossi",
      summary_settled_meta: "Solo mercati risolvibili",
      top_title: "Migliori pick",
      top_copy: "I migliori edge del blocco filtrato, ordinati per confidenza.",
      matches_title: "Partite",
      matches_copy: "Mercati principali, score più probabili e badge stato per ogni match.",
      empty: "Nessun dato disponibile per i filtri selezionati.",
      no_cache: "La cache predictor non e ancora stata generata dal workflow.",
      scheduled: "Da giocare",
      live: "Live",
      win: "Verde",
      lose: "Rosso",
      unresolved: "Non risolto",
      all: "Tutti",
      goals: "Goal",
      double: "Doppia chance",
      btts: "BTTS",
      combo: "Combo",
      blank: "No goal",
      corners: "Corner",
      yellows: "Cartellini",
      expected: "Expected",
      actual: "Finale",
      confidence: "Conf.",
      odds: "Quota",
      kickoff: "Kickoff",
      score: "Score",
      final: "Finale",
      live_matches: "live",
      final_matches: "chiusi",
      updated_now: "Aggiornato",
      latest: "Ultimo",
      cache_expiry: "Scade",
      team_blank: "non segna",
    },
    en: {
      hero_title: "Match Center",
      hero_copy: "Day-wide filtered analysis: select time window, search teams or leagues, and instantly see which markets are green or red.",
      hero_window_label: "Window",
      hero_date_label: "Cache",
      hero_sync_label: "Sync",
      back_home: "Back to tips",
      history: "ROI history",
      filters: "Filters",
      sync_note: "Auto refresh active",
      date: "Available date",
      time: "Time window",
      search: "Search team or league",
      search_placeholder: "e.g. Milan, Serie A, BTTS",
      probability: "Minimum pick probability",
      markets: "Markets",
      status: "Outcome",
      reset: "Reset filters",
      summary_matches: "Visible matches",
      summary_matches_meta: "Inside current slice",
      summary_top: "Top picks",
      summary_top_meta: "Edges above threshold",
      summary_live: "Live / final matches",
      summary_live_meta: "Current cache state",
      summary_settled: "Green / red picks",
      summary_settled_meta: "Resolvable markets only",
      top_title: "Best picks",
      top_copy: "Best edges from the filtered block, sorted by confidence.",
      matches_title: "Matches",
      matches_copy: "Main markets, most likely scores and status badge for each match.",
      empty: "No data available for the selected filters.",
      no_cache: "Predictor cache has not been generated yet by the workflow.",
      scheduled: "Upcoming",
      live: "Live",
      win: "Green",
      lose: "Red",
      unresolved: "Unresolved",
      all: "All",
      goals: "Goals",
      double: "Double chance",
      btts: "BTTS",
      combo: "Combo",
      blank: "Blank team",
      corners: "Corners",
      yellows: "Cards",
      expected: "Expected",
      actual: "Final",
      confidence: "Conf.",
      odds: "Odds",
      kickoff: "Kickoff",
      score: "Score",
      final: "Final",
      live_matches: "live",
      final_matches: "final",
      updated_now: "Updated",
      latest: "Latest",
      cache_expiry: "Expires",
      team_blank: "to blank",
    },
  };

  const state = {
    lang: getInitialLang(),
    manifest: null,
    selectedDate: "",
    cache: null,
    groups: new Set(GROUPS.map(group => group.id)),
    status: "all",
    minProbability: 55,
    search: "",
    timeFrom: "00:00",
    timeTo: "23:59",
  };

  const dom = {
    dateSelect: document.getElementById("date-select"),
    searchInput: document.getElementById("search-input"),
    timeFrom: document.getElementById("time-from"),
    timeTo: document.getElementById("time-to"),
    probabilityRange: document.getElementById("probability-range"),
    probabilityValue: document.getElementById("probability-value"),
    resetFilters: document.getElementById("reset-filters"),
    marketChips: document.getElementById("market-chips"),
    statusChips: document.getElementById("status-chips"),
    topPicks: document.getElementById("top-picks"),
    matches: document.getElementById("matches"),
  };

  function t(key) {
    return I18N[state.lang][key] || key;
  }

  function getInitialLang() {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("lang") || "").toLowerCase();
    if (q === "it" || q === "en") return q;
    const saved = (localStorage.getItem("pb_lang") || "").toLowerCase();
    if (saved === "it" || saved === "en") return saved;
    return ((navigator.language || "it").toLowerCase().startsWith("it")) ? "it" : "en";
  }

  function formatDate(dateStr) {
    if (!dateStr) return "-";
    const date = new Date(`${dateStr}T00:00:00`);
    return new Intl.DateTimeFormat(state.lang === "it" ? "it-IT" : "en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function formatDateTime(isoValue) {
    if (!isoValue) return "-";
    const date = new Date(isoValue);
    return new Intl.DateTimeFormat(state.lang === "it" ? "it-IT" : "en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatPercent(value) {
    if (value == null || Number.isNaN(Number(value))) return "-";
    return `${Math.round(Number(value) * 100)}%`;
  }

  function formatOdd(value) {
    if (value == null || value === "") return "-";
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : String(value);
  }

  function cacheBust(url) {
    return `${url}?v=${Date.now()}`;
  }

  async function fetchJson(url) {
    const response = await fetch(cacheBust(url), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function buildMarkets(match) {
    const topCorner = bestLine(match.corner_overs);
    const topYellow = bestLine(match.yellow_overs);
    return [
      {
        id: "ou15",
        group: "goals",
        title: "Over / Under 1.5",
        pickLabel: match.ou15_pick,
        pickProbability: match.ou15_conf,
        options: [
          { label: "Over 1.5", probability: match.p_over15, odd: match.odd_o15 },
          { label: "Under 1.5", probability: match.p_under15, odd: match.odd_u15 },
        ],
      },
      {
        id: "ou25",
        group: "goals",
        title: "Over / Under 2.5",
        pickLabel: match.ou_pick,
        pickProbability: match.ou_conf,
        options: [
          { label: "Over 2.5", probability: match.p_over25, odd: match.odd_o25 },
          { label: "Under 2.5", probability: match.p_under25, odd: match.odd_u25 },
        ],
      },
      {
        id: "o35",
        group: "goals",
        title: "Over / Under 3.5",
        pickLabel: match.ou35_pick || ((Number(match.p_over35 || 0) >= 0.5) ? "Over 3.5" : "Under 3.5"),
        pickProbability: match.ou35_conf ?? Math.max(Number(match.p_over35 || 0), Number(match.p_under35 || 0)),
        options: [
          { label: "Over 3.5", probability: match.p_over35, odd: match.odd_o35 },
          { label: "Under 3.5", probability: match.p_under35, odd: match.odd_u35 },
        ],
      },
      {
        id: "dc",
        group: "double",
        title: t("double"),
        pickLabel: match.dc_pick,
        pickProbability: match.dc_conf,
        options: [
          { label: "1X", probability: match.p_1x, odd: match.odd_1x },
          { label: "X2", probability: match.p_x2, odd: match.odd_x2 },
        ],
      },
      {
        id: "btts",
        group: "btts",
        title: "Both Teams To Score",
        pickLabel: match.btts_pick,
        pickProbability: match.btts_conf,
        options: [
          { label: "BTTS YES", probability: match.p_btts_yes, odd: match.odd_btts_y },
          { label: "BTTS NO", probability: match.p_btts_no, odd: match.odd_btts_n },
        ],
      },
      {
        id: "combo",
        group: "combo",
        title: "Combo Goals",
        pickLabel: "Over 2.5 + BTTS",
        pickProbability: match.p_o25_btts,
        options: [{ label: "Over 2.5 + BTTS", probability: match.p_o25_btts, odd: null }],
      },
      {
        id: "nogol",
        group: "blank",
        title: t("blank"),
        pickLabel: `${match.nogol_team} ${t("team_blank")}`,
        pickProbability: Math.max(Number(match.p_home_blanked || 0), Number(match.p_away_blanked || 0)),
        options: [
          { label: `${match.home} ${t("team_blank")}`, probability: match.p_home_blanked, odd: null },
          { label: `${match.away} ${t("team_blank")}`, probability: match.p_away_blanked, odd: null },
        ],
      },
      {
        id: "corners",
        group: "corners",
        title: t("corners"),
        pickLabel: topCorner ? `Over ${topCorner.line}` : "",
        pickProbability: topCorner ? topCorner.probability : null,
        expected: match.exp_corners,
        actual: match.total_corners,
        options: normalizeMap(match.corner_overs).map(item => ({ label: `Over ${item.key}`, probability: item.value, odd: null })),
      },
      {
        id: "yellows",
        group: "yellows",
        title: t("yellows"),
        pickLabel: topYellow ? `Over ${topYellow.line}` : "",
        pickProbability: topYellow ? topYellow.probability : null,
        expected: match.exp_yellows,
        actual: match.total_yellows,
        options: normalizeMap(match.yellow_overs).map(item => ({ label: `Over ${item.key}`, probability: item.value, odd: null })),
      },
    ].map(market => ({
      ...market,
      status: resolveMarketStatus(match, market),
      tag: GROUPS.find(group => group.id === market.group)?.short || market.group.toUpperCase(),
    }));
  }

  function normalizeMap(raw) {
    return Object.entries(raw || {})
      .filter(([, value]) => value != null)
      .map(([key, value]) => ({ key, value: Number(value) }));
  }

  function bestLine(raw) {
    const options = normalizeMap(raw);
    if (!options.length) return null;
    return options.sort((a, b) => b.value - a.value)[0];
  }

  function resolveMarketStatus(match, market) {
    const fixtureStatus = String(match.status_short || "").toUpperCase();
    if (market.id === "corners" || market.id === "yellows") {
      if (FINAL_STATUSES.has(fixtureStatus)) {
        const actual = Number(market.actual);
        const line = Number(String(market.pickLabel || "").replace("OVER ", ""));
        if (Number.isFinite(actual) && Number.isFinite(line)) {
          return actual > line ? "win" : "lose";
        }
        return "unresolved";
      }
      return LIVE_STATUSES.has(fixtureStatus) ? "live" : "scheduled";
    }
    if (!FINAL_STATUSES.has(fixtureStatus)) {
      return LIVE_STATUSES.has(fixtureStatus) ? "live" : "scheduled";
    }
    const gh = Number(match.goals_home ?? 0);
    const ga = Number(match.goals_away ?? 0);
    const label = String(market.pickLabel || "").toUpperCase();
    if (!label) return "unresolved";
    if (label === "1X") return (gh >= ga) ? "win" : "lose";
    if (label === "X2") return (ga >= gh) ? "win" : "lose";
    if (label === "OVER 2.5 + BTTS") return (gh + ga >= 3 && gh > 0 && ga > 0) ? "win" : "lose";
    if (label === "BTTS YES") return (gh > 0 && ga > 0) ? "win" : "lose";
    if (label === "BTTS NO") return !(gh > 0 && ga > 0) ? "win" : "lose";
    if (label.startsWith("OVER ")) {
      const line = Number(label.replace("OVER ", ""));
      return (gh + ga > line) ? "win" : "lose";
    }
    if (label.startsWith("UNDER ")) {
      const line = Number(label.replace("UNDER ", ""));
      return (gh + ga < line) ? "win" : "lose";
    }
    if (label.includes(" NON SEGNA") || label.includes(" TO BLANK")) {
      const homeMatch = label.startsWith(String(match.home || "").toUpperCase());
      const awayMatch = label.startsWith(String(match.away || "").toUpperCase());
      if (homeMatch) return gh === 0 ? "win" : "lose";
      if (awayMatch) return ga === 0 ? "win" : "lose";
    }
    return "unresolved";
  }

  function highlightThreshold(marketId) {
    return {
      ou15: 0.72,
      ou25: 0.6,
      o35: 0.62,
      dc: 0.68,
      btts: 0.6,
      combo: 0.32,
      nogol: 0.58,
      corners: 0.63,
      yellows: 0.63,
    }[marketId] || 0.7;
  }

  function getDerivedMatches() {
    const rawMatches = Array.isArray(state.cache?.matches) ? state.cache.matches : [];
    return rawMatches
      .map(match => ({ ...match, markets: buildMarkets(match) }))
      .filter(match => match.match_time >= state.timeFrom && match.match_time <= state.timeTo)
      .filter(match => {
        const marketBlob = (match.markets || [])
          .flatMap(market => [market.title, market.pickLabel, ...(market.options || []).map(option => option.label)])
          .join(" ");
        const blob = `${match.home} ${match.away} ${match.league} ${match.country} ${marketBlob}`.toLowerCase();
        return !state.search || blob.includes(state.search);
      })
      .map(match => {
        const visibleMarkets = match.markets
          .filter(market => state.groups.has(market.group))
          .filter(market => Number(market.pickProbability || 0) * 100 >= state.minProbability)
          .filter(market => state.status === "all" ? true : market.status === state.status);
        return { ...match, visibleMarkets };
      })
      .filter(match => match.visibleMarkets.length > 0)
      .sort((a, b) => String(a.match_time).localeCompare(String(b.match_time)));
  }

  function getTopPicks(matches) {
    return matches
      .flatMap(match => match.visibleMarkets
        .filter(market => Number(market.pickProbability || 0) >= highlightThreshold(market.id))
        .map(market => {
          const pickedOption = (market.options || []).find(option => option.label === market.pickLabel);
          return {
            fixtureId: match.fixture_id,
            league: match.league,
            matchTime: match.match_time,
            home: match.home,
            away: match.away,
            pickLabel: market.pickLabel,
            pickProbability: market.pickProbability,
            status: market.status,
            group: market.group,
            tag: market.tag,
            odd: pickedOption?.odd ?? null,
          };
        }))
      .sort((a, b) => Number(b.pickProbability || 0) - Number(a.pickProbability || 0))
      .slice(0, 12);
  }

  function statusLabel(status) {
    return t(status);
  }

  function groupLabel(groupId) {
    return t(groupId);
  }

  function render() {
    applyTranslations();
    const matches = getDerivedMatches();
    const topPicks = getTopPicks(matches);

    renderSummary(matches, topPicks);
    renderTopPicks(topPicks);
    renderMatches(matches);

    document.getElementById("hero-window-value").textContent = `${state.timeFrom} - ${state.timeTo}`;
    document.getElementById("hero-date-value").textContent = state.selectedDate ? formatDate(state.selectedDate) : "-";
    document.getElementById("hero-sync-value").textContent = formatDateTime(state.cache?.refreshed_at || state.cache?.generated_at);
  }

  function renderSummary(matches, topPicks) {
    const live = matches.filter(match => LIVE_STATUSES.has(String(match.status_short || "").toUpperCase())).length;
    const final = matches.filter(match => FINAL_STATUSES.has(String(match.status_short || "").toUpperCase())).length;
    const win = topPicks.filter(pick => pick.status === "win").length;
    const lose = topPicks.filter(pick => pick.status === "lose").length;

    document.getElementById("summary-matches").textContent = String(matches.length);
    document.getElementById("summary-matches-meta").textContent = t("summary_matches_meta");
    document.getElementById("summary-top").textContent = String(topPicks.length);
    document.getElementById("summary-top-meta").textContent = t("summary_top_meta");
    document.getElementById("summary-live").textContent = `${live} / ${final}`;
    document.getElementById("summary-live-meta").textContent = `${live} ${t("live_matches")} - ${final} ${t("final_matches")}`;
    document.getElementById("summary-settled").textContent = `${win} / ${lose}`;
    document.getElementById("summary-settled-meta").textContent = t("summary_settled_meta");
  }

  function renderTopPicks(topPicks) {
    if (!topPicks.length) {
      dom.topPicks.innerHTML = `<div class="empty-state">${state.cache ? t("empty") : t("no_cache")}</div>`;
      return;
    }
    dom.topPicks.innerHTML = topPicks.map(pick => `
      <article class="top-pick-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <span class="market-tag">${pick.tag}</span>
          <span class="status-pill status-${pick.status}">${statusLabel(pick.status)}</span>
        </div>
        <div style="font-size:0.84rem;color:#94a3b8;">${pick.matchTime} | ${pick.league}</div>
        <div style="font-size:1rem;font-weight:700;line-height:1.4;">${escapeHtml(pick.home)} vs ${escapeHtml(pick.away)}</div>
        <div style="font-size:0.9rem;color:#e2e8f0;">${escapeHtml(pick.pickLabel)}</div>
        ${pick.odd ? `<div style="font-size:0.8rem;color:#94a3b8;">${t("odds")} ${formatOdd(pick.odd)}</div>` : ""}
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-end;">
          <div style="font-size:0.78rem;color:#64748b;">${t("confidence")}</div>
          <div style="font-size:1.5rem;font-weight:700;">${formatPercent(pick.pickProbability)}</div>
        </div>
      </article>
    `).join("");
  }

  function renderMatches(matches) {
    if (!matches.length) {
      dom.matches.innerHTML = `<div class="empty-state">${state.cache ? t("empty") : t("no_cache")}</div>`;
      return;
    }
    dom.matches.innerHTML = matches.map(match => {
      const fixtureStatus = String(match.status_short || "").toUpperCase();
      const badge = FINAL_STATUSES.has(fixtureStatus)
        ? `<span class="status-pill status-unresolved">${t("final")} | ${escapeHtml(match.final_score || "-")}</span>`
        : LIVE_STATUSES.has(fixtureStatus)
          ? `<span class="status-pill status-live">${t("live")} | ${escapeHtml(match.final_score || "0-0")}</span>`
          : `<span class="status-pill status-scheduled">${statusLabel("scheduled")}</span>`;

      return `
        <article class="match-card">
          <div class="match-head">
            <div class="teams">
              <div class="match-meta">
                <span>${match.country || ""}${match.country && match.league ? " / " : ""}${match.league || ""}</span>
              </div>
              <div class="team-line">
                ${match.home_logo ? `<img class="team-logo" src="${match.home_logo}" alt="" />` : ""}
                <span>${escapeHtml(match.home)}</span>
              </div>
              <div class="team-line">
                ${match.away_logo ? `<img class="team-logo" src="${match.away_logo}" alt="" />` : ""}
                <span>${escapeHtml(match.away)}</span>
              </div>
            </div>
            <div class="match-right">
              <div class="kickoff">${t("kickoff")} | ${escapeHtml(match.match_time || "--:--")}</div>
              <div class="scoreline">${escapeHtml(match.final_score || "-")}</div>
              ${badge}
            </div>
          </div>

          <div class="markets-grid">
            ${match.visibleMarkets.map(market => renderMarketCard(market)).join("")}
          </div>

          <div class="scores-row">
            ${(match.most_likely_scores || []).slice(0, 4).map(score => `<span class="score-chip">${escapeHtml(score[0])} | ${score[1]}%</span>`).join("")}
          </div>
        </article>
      `;
    }).join("");
  }

  function renderMarketCard(market) {
    const expected = market.expected != null
      ? `<div class="market-expected"><span>${t("expected")}</span><strong>${Number(market.expected).toFixed(1)}</strong></div>`
      : "";
    const actual = market.actual != null
      ? `<div class="market-expected"><span>${t("actual")}</span><strong>${Number(market.actual).toFixed(1)}</strong></div>`
      : "";
    const options = market.options.slice(0, 4).map(option => `
      <div class="market-option">
        <span>${escapeHtml(option.label)}</span>
        <strong>${formatPercent(option.probability)}${option.odd ? ` | ${t("odds")} ${formatOdd(option.odd)}` : ""}</strong>
      </div>
    `).join("");
    return `
      <div class="market-card status-${market.status}">
        <div class="market-title-row">
          <div>
            <div class="market-title">${escapeHtml(market.title)}</div>
            <div class="market-pick">${escapeHtml(market.pickLabel || "-")}</div>
          </div>
          <span class="market-tag">${market.tag}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;">
          <span class="status-pill status-${market.status}">${statusLabel(market.status)}</span>
          <div class="market-probability">${formatPercent(market.pickProbability)}</div>
        </div>
        ${expected}
        ${actual}
        ${options}
      </div>
    `;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function applyTranslations() {
    document.documentElement.lang = state.lang;
    localStorage.setItem("pb_lang", state.lang);

    setText("hero-title", t("hero_title"));
    setText("hero-copy", t("hero_copy"));
    setText("hero-window-label", t("hero_window_label"));
    setText("hero-date-label", t("hero_date_label"));
    setText("hero-sync-label", t("hero_sync_label"));
    setText("back-home-link", t("back_home"));
    setText("history-link", t("history"));
    setText("filters-title", t("filters"));
    setText("sync-note", t("sync_note"));
    setText("date-label", t("date"));
    setText("time-label", t("time"));
    setText("search-label", t("search"));
    dom.searchInput.placeholder = t("search_placeholder");
    setText("probability-label", t("probability"));
    setText("market-filter-label", t("markets"));
    setText("status-filter-label", t("status"));
    setText("reset-filters", t("reset"));
    setText("summary-matches-label", t("summary_matches"));
    setText("summary-top-label", t("summary_top"));
    setText("summary-live-label", t("summary_live"));
    setText("summary-settled-label", t("summary_settled"));
    setText("top-picks-title", t("top_title"));
    setText("top-picks-copy", t("top_copy"));
    setText("matches-title", t("matches_title"));
    setText("matches-copy", t("matches_copy"));

    document.querySelectorAll(".lang-btn").forEach(button => {
      button.classList.toggle("active", button.dataset.lang === state.lang);
    });
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function buildFilterChips() {
    dom.marketChips.innerHTML = GROUPS.map(group => `
      <button type="button" class="chip-btn active" data-group="${group.id}">${group.short} | ${groupLabel(group.id)}</button>
    `).join("");

    dom.statusChips.innerHTML = STATUS_OPTIONS.map(status => `
      <button type="button" class="chip-btn ${status === "all" ? "active" : ""}" data-status="${status}">${statusLabel(status)}</button>
    `).join("");

    dom.marketChips.querySelectorAll("[data-group]").forEach(button => {
      button.addEventListener("click", () => {
        const group = button.dataset.group;
        if (state.groups.has(group)) state.groups.delete(group);
        else state.groups.add(group);
        if (!state.groups.size) GROUPS.forEach(item => state.groups.add(item.id));
        syncGroupChips();
        render();
      });
    });

    dom.statusChips.querySelectorAll("[data-status]").forEach(button => {
      button.addEventListener("click", () => {
        state.status = button.dataset.status || "all";
        syncStatusChips();
        render();
      });
    });

    syncGroupChips();
    syncStatusChips();
  }

  function syncGroupChips() {
    dom.marketChips.querySelectorAll("[data-group]").forEach(button => {
      button.classList.toggle("active", state.groups.has(button.dataset.group));
    });
  }

  function syncStatusChips() {
    dom.statusChips.querySelectorAll("[data-status]").forEach(button => {
      button.classList.toggle("active", button.dataset.status === state.status);
    });
  }

  function bindControls() {
    dom.dateSelect.addEventListener("change", async () => {
      state.selectedDate = dom.dateSelect.value;
      await loadCacheForDate(state.selectedDate);
      render();
    });
    dom.searchInput.addEventListener("input", () => {
      state.search = dom.searchInput.value.trim().toLowerCase();
      render();
    });
    dom.timeFrom.addEventListener("input", () => {
      state.timeFrom = dom.timeFrom.value || "00:00";
      render();
    });
    dom.timeTo.addEventListener("input", () => {
      state.timeTo = dom.timeTo.value || "23:59";
      render();
    });
    dom.probabilityRange.addEventListener("input", () => {
      state.minProbability = Number(dom.probabilityRange.value || 55);
      dom.probabilityValue.textContent = `${state.minProbability}%`;
      render();
    });
    dom.resetFilters.addEventListener("click", () => {
      state.groups = new Set(GROUPS.map(group => group.id));
      state.status = "all";
      state.minProbability = 55;
      state.search = "";
      state.timeFrom = "00:00";
      state.timeTo = "23:59";
      dom.searchInput.value = "";
      dom.timeFrom.value = "00:00";
      dom.timeTo.value = "23:59";
      dom.probabilityRange.value = "55";
      dom.probabilityValue.textContent = "55%";
      syncGroupChips();
      syncStatusChips();
      render();
    });
    document.querySelectorAll(".lang-btn").forEach(button => {
      button.addEventListener("click", () => {
        state.lang = button.dataset.lang || "it";
        buildFilterChips();
        populateDateSelect();
        dom.dateSelect.value = state.selectedDate;
        render();
      });
    });
  }

  async function loadManifest() {
    state.manifest = await fetchJson(`${CACHE_BASE}/manifest.json`);
    populateDateSelect();
    const dates = Array.isArray(state.manifest?.dates) ? state.manifest.dates : [];
    const available = new Set(dates.map(item => item.date));
    if (!available.has(state.selectedDate)) {
      state.selectedDate = state.manifest.latest_date || dates[0]?.date || "";
    }
    dom.dateSelect.value = state.selectedDate;
  }

  function populateDateSelect() {
    const dates = Array.isArray(state.manifest?.dates) ? state.manifest.dates : [];
    dom.dateSelect.innerHTML = dates.map(entry => `<option value="${entry.date}">${formatDate(entry.date)}</option>`).join("");
  }

  async function loadCacheForDate(date) {
    if (!date) {
      state.cache = null;
      return;
    }
    const entry = (state.manifest?.dates || []).find(item => item.date === date);
    const file = entry?.file || `${date}.json`;
    state.cache = await fetchJson(`${CACHE_BASE}/${file}`);
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

  function startAutoRefresh() {
    window.setInterval(() => {
      if (document.hidden) return;
      refreshData();
    }, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshData();
    });
  }

  async function init() {
    dom.probabilityValue.textContent = `${state.minProbability}%`;
    buildFilterChips();
    bindControls();
    await refreshData();
    startAutoRefresh();
  }

  init().catch(error => {
    console.error(error);
    dom.topPicks.innerHTML = `<div class="empty-state">${t("no_cache")}</div>`;
    dom.matches.innerHTML = `<div class="empty-state">${t("no_cache")}</div>`;
  });
})();
