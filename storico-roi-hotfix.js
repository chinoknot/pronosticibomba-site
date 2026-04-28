/*
  PronosticiBomba - Storico ROI hotfix
  Purpose: keep the current layout unchanged, but force the ROI board to include
  the selected month up to today and merge picks + results correctly.
*/
(function () {
  const SUPABASE_URL = "https://oiudaxsyvhjpjjhglejd.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pdWRheHN5dmhqcGpqaGdsZWpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMDk0OTcsImV4cCI6MjA3OTU4NTQ5N30.r7kz3FdijAhsJLz1DcEtobJLaPCqygrQGgCPpSc-05A";

  const EXCLUDED_PREFIXES = ["CORNER", "PATTERN_OVER"];
  const EXCLUDED_SET = new Set(["BURN_CLOWN_BURN"]);

  const CATEGORY_LABELS = {
    BEST_TIPS_OF_DAY: "Scelte d’Élite",
    SAFE_PICKS: "Safe Picks",
    SAFE_GOALS: "Safe Goals",
    VALUE_PICKS: "Quote di Valore",
    OVER_UNDER_TIPS: "Tendenze Goal",
    OVER25_PATTERNS: "Over 2.5 Patterns",
    "OVER25 PATTERNS": "Over 2.5 Patterns",
    BTTS_NO_VALUE: "BTTS NO Value",
    "BTTS NO VALUE": "BTTS NO Value",
    "BTTS NO Value": "BTTS NO Value",
    HT_GOAL_ENGINE: "HT Goal Engine",
    HOME_WIN_ELITE: "Forti 1",
    SINGLE_GAME: "Pick Esclusiva",
    GG_SPECIAL: "GG Special",
    GG_SPECIAL_LEGACY: "GG Special",
    GG_SPECIAL_ALT: "GG Special",
    "GG Special": "GG Special",
    TOP_5_TIPS: "Top 5 Esclusive",
    DAILY_2PLUS: "Combo Selettiva",
    DAILY_10PLUS: "Combo High Stakes"
  };

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function dublinToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Dublin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${obj.year}-${obj.month}-${obj.day}`;
  }

  function ymd(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseYMD(str) {
    const [y, m, d] = String(str || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function monthLabel(month) {
    const [y, m] = String(month).split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, 1);
    return dt.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  }

  function formatDateIT(str) {
    const dt = parseYMD(str);
    if (!dt) return str || "";
    const w = dt.toLocaleDateString("it-IT", { weekday: "short" });
    return `${w} ${pad2(dt.getDate())} ${dt.toLocaleDateString("it-IT", { month: "short" })}`;
  }

  function isExcludedCategory(cat) {
    const k = String(cat || "").trim().toUpperCase();
    if (!k) return false;
    if (EXCLUDED_SET.has(k)) return true;
    return EXCLUDED_PREFIXES.some(prefix => k.startsWith(prefix));
  }

  function categoryKey(cat) {
    return String(cat || "ALTRO").trim() || "ALTRO";
  }

  function categoryLabel(cat) {
    const raw = categoryKey(cat);
    const upper = raw.toUpperCase();
    return CATEGORY_LABELS[raw] || CATEGORY_LABELS[upper] || raw.replace(/_/g, " ");
  }

  function safeOdd(value) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 1 ? n : 1;
  }

  function safeScore(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function resultRank(row) {
    const res = String(row?.result || "").toUpperCase();
    const st = String(row?.status_short || "").toUpperCase();
    let score = 0;
    if (res === "WIN" || res === "LOSE") score += 10;
    else if (res === "PENDING" || res === "LIVE") score += 3;
    else if (res === "UNKNOWN") score += 1;
    if (["FT", "AET", "PEN", "AWD", "WO"].includes(st)) score += 5;
    else if (["2H", "HT", "1H", "ET", "BT", "P"].includes(st)) score += 2;
    if (res === "WIN") score += 1;
    return score;
  }

  function betterResolved(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ar = resultRank(a);
    const br = resultRank(b);
    if (br !== ar) return br > ar ? b : a;
    const bs = safeScore(b.score_model ?? b.score);
    const as = safeScore(a.score_model ?? a.score);
    return bs >= as ? b : a;
  }

  function bestPickForEvent(current, candidate) {
    if (!current) return candidate;
    const currentClosed = ["WIN", "LOSE"].includes(String(current.result || "").toUpperCase());
    const candClosed = ["WIN", "LOSE"].includes(String(candidate.result || "").toUpperCase());

    if (candClosed && !currentClosed) return candidate;
    if (!candClosed && currentClosed) return current;

    const cs = safeScore(current.score_model ?? current.score);
    const ns = safeScore(candidate.score_model ?? candidate.score);
    if (ns !== cs) return ns > cs ? candidate : current;

    return safeOdd(candidate.odd) >= safeOdd(current.odd) ? candidate : current;
  }

  async function sbFetch(table, query) {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${table} ${res.status}: ${txt}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data.filter(r => !isExcludedCategory(r?.category)) : [];
  }

  function monthBounds(month) {
    const [year, mon] = String(month).split("-").map(Number);
    const first = `${year}-${pad2(mon)}-01`;
    const lastDate = new Date(year, mon, 0);
    let last = ymd(lastDate);
    const today = dublinToday();
    if (month === today.slice(0, 7) && today < last) last = today;
    return { first, last };
  }

  function getSelectedMonth() {
    const select = document.getElementById("month-select");
    if (select && select.value && /^\d{4}-\d{2}$/.test(select.value)) return select.value;
    return dublinToday().slice(0, 7);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setBadgeClass(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("badge-pos", "badge-neg", "badge-neutral");
    if (value > 0) el.classList.add("badge-pos");
    else if (value < 0) el.classList.add("badge-neg");
    else el.classList.add("badge-neutral");
  }

  function reliabilityLabel(total, winrate, needed) {
    if (!total || !Number.isFinite(winrate) || !Number.isFinite(needed)) return "Dati insufficienti";
    const diff = winrate - needed;
    if (total < 20) {
      if (diff >= 5) return "Buona ma campione ridotto";
      if (diff >= 0) return "Ok ma campione ridotto";
      return "Dati pochi (campione ridotto)";
    }
    if (total < 50) {
      if (diff >= 5) return "Buona";
      if (diff >= 0) return "Discreta";
      if (diff >= -3) return "Debole";
      return "Negativa";
    }
    if (diff >= 7) return "Molto buona";
    if (diff >= 3) return "Buona";
    if (diff >= 0) return "Discreta";
    if (diff >= -3) return "Debole";
    return "Negativa";
  }

  function buildRows(picks, results) {
    const resultMap = new Map();
    for (const r of results) {
      const fid = String(r.fixture_id || "").trim();
      const pick = String(r.pick || "").trim();
      if (!fid || !pick) continue;
      const key = `${fid}__${pick}`;
      resultMap.set(key, betterResolved(resultMap.get(key), r));
    }

    return picks.map(p => {
      const fid = String(p.fixture_id || "").trim();
      const pick = String(p.pick || "").trim();
      const res = resultMap.get(`${fid}__${pick}`) || {};
      return {
        ...p,
        fixture_id: fid,
        pick,
        match_date: p.match_date || res.picks_date || res.match_date || "",
        category: p.category || res.category || "ALTRO",
        model: p.model || res.model || "",
        odd: safeOdd(p.odd || res.odd),
        score: safeScore(p.score ?? res.score_model),
        result: String(res.result || "OPEN").toUpperCase(),
        status_short: String(res.status_short || "").toUpperCase(),
        final_score: res.final_score || "",
        goals_home: res.goals_home,
        goals_away: res.goals_away
      };
    }).filter(r => r.fixture_id && r.match_date);
  }

  function summarizeEventRows(rows) {
    let wins = 0;
    let loses = 0;
    let profit = 0;
    let oddsSum = 0;
    let closed = 0;

    for (const r of rows) {
      const res = String(r.result || "").toUpperCase();
      const odd = safeOdd(r.odd);
      if (res === "WIN") {
        wins += 1;
        closed += 1;
        profit += odd - 1;
        oddsSum += odd;
      } else if (res === "LOSE") {
        loses += 1;
        closed += 1;
        profit -= 1;
        oddsSum += odd;
      }
    }

    const total = rows.length;
    const open = Math.max(0, total - closed);
    const roi = closed > 0 ? (profit / closed) * 100 : null;
    const winrate = closed > 0 ? (wins / closed) * 100 : null;
    const avgOdd = closed > 0 ? oddsSum / closed : null;
    const needed = avgOdd && avgOdd > 1 ? 100 / avgOdd : null;

    return { total, closed, open, wins, loses, profit, roi, winrate, avgOdd, needed };
  }

  function classForNumber(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "";
    return n >= 0 ? "pos" : "neg";
  }

  function renderDay(day, rows, isToday) {
    const s = summarizeEventRows(rows);
    const roiTxt = s.roi === null ? "-" : `${s.roi.toFixed(1)}%`;
    const profitTxt = `${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(2)}u`;
    const openAttr = isToday ? " open" : "";
    const todayClass = isToday ? " open-today" : "";
    const badge = isToday ? `<span class="day-badge">ultimo giorno</span>` : "";
    const wlClass = s.closed ? "" : "";
    const valClass = classForNumber(s.profit);
    const roiClass = classForNumber(s.roi ?? 0);

    return `
      <details class="day-accordion${todayClass}"${openAttr} data-hotfix-day="${day}">
        <summary>
          <div class="day-summary-row">
            <div class="day-summary-main">
              <div class="day-summary-date"><strong>${formatDateIT(day)}</strong>${badge}</div>
              <div class="day-summary-sub">${s.total} eventi unici · ${s.closed} chiusi · ${s.open} ancora aperti</div>
            </div>
            <div class="day-summary-stats">
              <span class="day-stat-pill ${wlClass}">${s.wins}W / ${s.loses}L</span>
              <span class="day-stat-pill ${valClass}">${profitTxt}</span>
              <span class="day-stat-pill ${roiClass}">${roiTxt}</span>
              <span class="day-summary-toggle" aria-hidden="true"></span>
            </div>
          </div>
        </summary>
        <div class="day-accordion-body">
          <div class="day-detail-grid">
            <div class="day-detail-card"><span>Eventi unici</span><strong>${s.total}</strong></div>
            <div class="day-detail-card"><span>Stake reale</span><strong>${s.closed}</strong></div>
            <div class="day-detail-card"><span>Win / Lose</span><strong>${s.wins} / ${s.loses}</strong></div>
            <div class="day-detail-card ${valClass}"><span>Profitto</span><strong>${profitTxt}</strong></div>
            <div class="day-detail-card ${roiClass}"><span>ROI</span><strong>${roiTxt}</strong></div>
          </div>
          <div class="day-detail-note">Calcolo per evento: una sola pick valida per fixture, scelta in base allo score più alto tra quelle già risolte.</div>
        </div>
      </details>`;
  }

  function renderCategoryTable(rows) {
    const grouped = new Map();
    for (const r of rows) {
      const key = `${categoryKey(r.category)}__${r.fixture_id}`;
      grouped.set(key, bestPickForEvent(grouped.get(key), r));
    }

    const byCat = new Map();
    for (const r of grouped.values()) {
      const cat = categoryKey(r.category);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(r);
    }

    const stats = Array.from(byCat.entries()).map(([cat, items]) => {
      const s = summarizeEventRows(items);
      return { cat, ...s };
    }).filter(s => s.closed > 0)
      .sort((a, b) => b.closed - a.closed || categoryLabel(a.cat).localeCompare(categoryLabel(b.cat)));

    if (!stats.length) return "";

    const rowsHtml = stats.map(s => {
      const roi = s.roi === null ? "-" : s.roi.toFixed(1);
      const wr = s.winrate === null ? "-" : s.winrate.toFixed(1);
      const avg = s.avgOdd === null ? "-" : s.avgOdd.toFixed(2);
      const need = s.needed === null ? "-" : s.needed.toFixed(1);
      const reliability = reliabilityLabel(s.closed, s.winrate ?? NaN, s.needed ?? NaN);
      const roiClass = (s.roi ?? 0) >= 0 ? "badge-pos" : "badge-neg";
      const relClass = reliability.includes("Negativa") || reliability.includes("Debole") ? "badge-neg" : reliability.includes("Dati") ? "badge-neutral" : "badge-pos";
      return `
        <tr>
          <td data-label="Categoria">${categoryLabel(s.cat)}</td>
          <td data-label="Eventi">${s.closed}</td>
          <td data-label="Win">${s.wins}</td>
          <td data-label="Lose">${s.loses}</td>
          <td data-label="Winrate">${wr === "-" ? "-" : wr + "%"}</td>
          <td data-label="ROI" class="${roiClass}">${roi === "-" ? "-" : roi + "%"}</td>
          <td data-label="Quota media">${avg}</td>
          <td data-label="Break-even">${need === "-" ? "-" : need + "%"}</td>
          <td data-label="Reliability" class="${relClass}">${reliability}</td>
        </tr>`;
    }).join("");

    return `
      <div class="table-wrapper">
        <h2 class="section-title">Rendimento per categoria</h2>
        <table>
          <thead>
            <tr>
              <th>Categoria</th><th>Eventi</th><th>Win</th><th>Lose</th><th>Winrate</th><th>ROI</th><th>Quota media</th><th>Break-even</th><th>Reliability</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  function updateSummary(month, dayRows) {
    const allRows = Array.from(dayRows.values()).flat();
    const s = summarizeEventRows(allRows);
    const roi = s.roi === null ? "-" : `${s.roi.toFixed(1)}%`;
    const wr = s.winrate === null ? "-" : `${s.winrate.toFixed(1)}%`;
    const profit = `${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(2)} unità`;
    const needed = s.needed === null ? "-" : `${s.needed.toFixed(1)}%`;
    const avg = s.avgOdd === null ? "-" : s.avgOdd.toFixed(2);
    const rel = reliabilityLabel(s.closed, s.winrate ?? NaN, s.needed ?? NaN);
    const dates = Array.from(dayRows.keys()).sort();

    setText("summary-roi", roi);
    setText("summary-profit", `Profitto totale: ${profit}`);
    setText("summary-period", dates.length ? `${formatDateIT(dates[0])} → ${formatDateIT(dates[dates.length - 1])}` : monthLabel(month));
    setText("summary-days", `${dates.length} giorni con eventi`);
    setText("summary-winrate", wr);
    setText("summary-wl", `${s.wins} win / ${s.loses} lose`);
    setText("summary-winrate-needed", `Break-even: ${needed} · quota media ${avg}`);
    setText("summary-reliability", `Reliability: ${rel}`);
    setText("month-pill", monthLabel(month));

    setBadgeClass("summary-roi", s.roi ?? 0);
    setBadgeClass("summary-profit", s.profit);
    const relEl = document.getElementById("summary-reliability");
    if (relEl) {
      relEl.classList.remove("badge-pos", "badge-neg", "badge-neutral");
      if (rel.includes("Negativa") || rel.includes("Debole")) relEl.classList.add("badge-neg");
      else if (rel.includes("Dati")) relEl.classList.add("badge-neutral");
      else relEl.classList.add("badge-pos");
    }
  }

  async function loadROIHotfix() {
    const container = document.getElementById("table-container");
    if (!container) return;

    const month = getSelectedMonth();
    const { first, last } = monthBounds(month);
    const today = dublinToday();

    try {
      container.dataset.hotfixLoading = "1";

      const [picks, results] = await Promise.all([
        sbFetch("picks", `?match_date=gte.${first}&match_date=lte.${last}&select=*`),
        sbFetch("results", `?picks_date=gte.${first}&picks_date=lte.${last}&select=*`)
      ]);

      const merged = buildRows(picks, results);
      const perDayFixture = new Map();
      for (const r of merged) {
        const day = r.match_date;
        const key = `${day}__${r.fixture_id}`;
        perDayFixture.set(key, bestPickForEvent(perDayFixture.get(key), r));
      }

      const dayRows = new Map();
      for (const r of perDayFixture.values()) {
        if (!dayRows.has(r.match_date)) dayRows.set(r.match_date, []);
        dayRows.get(r.match_date).push(r);
      }

      const sortedDays = Array.from(dayRows.keys()).sort().reverse();
      updateSummary(month, dayRows);

      if (!sortedDays.length) {
        container.innerHTML = `<div class="table-wrapper"><div class="empty">Nessun dato disponibile per ${monthLabel(month)}.</div></div>`;
        return;
      }

      const dayHtml = sortedDays.map(day => renderDay(day, dayRows.get(day), day === today)).join("");
      const categoryHtml = renderCategoryTable(merged);
      container.innerHTML = `<div class="day-accordion-list">${dayHtml}</div>${categoryHtml}`;
    } catch (err) {
      console.error("Storico ROI hotfix error", err);
      container.innerHTML = `<div class="table-wrapper"><div class="empty">Errore nel caricamento dello storico ROI: ${String(err.message || err)}</div></div>`;
    } finally {
      delete container.dataset.hotfixLoading;
    }
  }

  function wireMonthControls() {
    const select = document.getElementById("month-select");
    if (select && !select.dataset.hotfixWired) {
      select.dataset.hotfixWired = "1";
      select.addEventListener("change", () => setTimeout(loadROIHotfix, 250));
    }

    const buttons = document.getElementById("month-buttons");
    if (buttons && !buttons.dataset.hotfixWired) {
      buttons.dataset.hotfixWired = "1";
      buttons.addEventListener("click", () => setTimeout(loadROIHotfix, 250));
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireMonthControls();
    setTimeout(loadROIHotfix, 350);
  });

  window.PBReloadROIHotfix = loadROIHotfix;
})();
