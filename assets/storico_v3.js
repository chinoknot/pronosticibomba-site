(() => {
  // ====== SETTINGS ======
  const DEBUG_ENABLED = new URLSearchParams(location.search).get("debug") === "1";

  // Start showing months from Dec 2025 (month0 = 11)
  const PROJECT_START = { y: 2025, m0: 11 };

  const SUPABASE_URL = "https://oiudaxsyvhjpjjhglejd.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pdWRheHN5dmhqcGpqaGdsZWpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMDk0OTcsImV4cCI6MjA3OTU4NTQ5N30.r7kz3FdijAhsJLz1DcEtobJLaPCqygrQGgCPpSc-05A";

  function $(id) { return document.getElementById(id); }

  // ====== DEBUG PANEL (optional) ======
  function showDebugPanel() {
    const panel = $("debug-panel");
    if (!panel) return;
    panel.style.display = "block";
    const btn = $("debug-close");
    if (btn) btn.onclick = () => (panel.style.display = "none");
  }
  function logDebug(msg) {
    const pre = $("debug-log");
    if (!pre) return;
    pre.textContent += (pre.textContent ? "\n" : "") + String(msg);
    if (DEBUG_ENABLED) showDebugPanel();
  }
  function logErrorToUI(title, err) {
    const txt = err && (err.stack || err.message) ? (err.stack || err.message) : String(err);
    logDebug("[" + title + "] " + txt);
    showDebugPanel();
  }
  window.addEventListener("error", (e) => logErrorToUI("JS Error", e.error || e.message || e));
  window.addEventListener("unhandledrejection", (e) => logErrorToUI("Promise Rejection", e.reason || e));

  // ====== SUPABASE FETCH ======
  async function sbFetch(table, query) {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
    try {
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
        },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Supabase error ${res.status}: ${t}`);
      }
      return await res.json();
    } catch (e) {
      logErrorToUI("Fetch error", e);
      throw e;
    }
  }

  // ====== HELPERS ======
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function formatDateIT(ymd) {
    if (!ymd || typeof ymd !== "string") return "-";
    const [y, m, d] = ymd.split("-");
    if (!y || !m || !d) return ymd;
    return `${d}/${m}/${y}`;
  }

  function dateToYMD_UTC(dt) {
    const y = dt.getUTCFullYear();
    const m = pad2(dt.getUTCMonth() + 1);
    const d = pad2(dt.getUTCDate());
    return `${y}-${m}-${d}`;
  }

  function monthNameIT(m0) {
    return ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"][m0] || "";
  }

  function getMonthRangeUTC(year, month0) {
    const start = new Date(Date.UTC(year, month0, 1));
    const end = new Date(Date.UTC(year, month0 + 1, 0));
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (year === todayUTC.getUTCFullYear() && month0 === todayUTC.getUTCMonth() && end > todayUTC) {
      return { start, end: todayUTC };
    }
    return { start, end };
  }

  function listDatesInRangeUTC(start, end) {
    const out = [];
    const cur = new Date(start);
    while (cur <= end) {
      out.push(dateToYMD_UTC(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }

  function safeOdd(o) {
    const n = Number(o);
    if (!isFinite(n) || n <= 1) return 1.0;
    return n;
  }

  function resultRank(r) {
    const res = String((r && r.result) || "").toUpperCase();
    const st = String((r && r.status_short) || "").toUpperCase();
    if (res === "WIN") return 50;
    if (res === "LOSE") return 40;
    if (res === "VOID") return 30;
    if (st === "FT") return 20;
    return 10;
  }

  function normalizeCatKey(k) {
    return String(k || "").trim().toUpperCase();
  }

  const CATEGORY_LABELS = {
    BEST_TIPS_OF_DAY: "Scelte d’Élite",
    SAFE_PICKS: "Selezioni Affidabili",
    VALUE_PICKS: "Quote di Valore",
    OVER_UNDER_TIPS: "Tendenze Goal",
    BTTS_TIPS: "BTTS",
    SINGLE_GAME: "Pick Esclusiva",
    TOP_5_TIPS: "Pick Esclusiva",
    DNB_ENGINE: "DNB Engine",
    COMBO_DC_O15: "Combo Doppia Chance + Over 1.5",
  // Categories that should NOT appear in "Rendimento per categoria" (UI-only exclusions)
  const EXCLUDED_CATEGORY_KEYS = new Set([
    "SAFE_PICKS",
  ]);

  };

  function getCategoryLabel(catKey) {
    const k = normalizeCatKey(catKey);
    return CATEGORY_LABELS[k] || (catKey || "Altro").replaceAll("_", " ");
  }

  function deriveCategoryKeyFromPick(p) {
    const cat = normalizeCatKey(p && p.category);
    const model = normalizeCatKey(p && p.model);
    const pickRaw = String((p && p.pick) || "").trim().toLowerCase();

    const isDc =
      pickRaw.startsWith("1x") || pickRaw.startsWith("x2") ||
      pickRaw.includes("1x &") || pickRaw.includes("x2 &") ||
      pickRaw.includes("1x & over") || pickRaw.includes("x2 & over");
    const isO15 = pickRaw.includes("over 1.5");
    const isComboByModel = model.includes("O1_5") && (model.includes("DC") || model.includes("1X") || model.includes("X2"));

    if ((isDc && isO15) || isComboByModel) return "COMBO_DC_O15";
    if (cat === "SINGLE_GAME" || cat === "TOP_5_TIPS") return "SINGLE_GAME";
    return cat || "ALTRO";
  }

  function reliabilityLabel(sampleSize, winrate, winrateNeeded) {
    if (!isFinite(sampleSize) || sampleSize <= 0) return "Dati pochi";
    const delta = winrate - winrateNeeded;
    if (sampleSize < 8) return "Buona ma campione ridotto";
    if (delta >= 8) return "Molto forte";
    if (delta >= 4) return "Buona";
    if (delta >= 1.5) return "Discreta";
    if (delta >= -1.5) return "In bilico";
    if (delta >= -4) return "Debole";
    return "Negativa";
  }

  function setSummaryDashes() {
    const idsToDash = [
      "summary-period","summary-days","summary-winrate","summary-wl",
      "summary-roi","summary-profit","summary-winrate-needed","summary-reliability"
    ];
    idsToDash.forEach(id => { const el = $(id); if (el) el.textContent = "-"; });
  }

  // ====== CORE ======
  async function loadHistoryMonth(year, month0) {
    const monthPill = $("month-pill");
    const tableContainer = $("table-container");

    setSummaryDashes();

    const range = getMonthRangeUTC(year, month0);
    const startStr = dateToYMD_UTC(range.start);
    const endStr = dateToYMD_UTC(range.end);

    if (monthPill) {
      monthPill.textContent = `${monthNameIT(month0)} ${year} (${formatDateIT(startStr)} → ${formatDateIT(endStr)})`;
    }

    if (tableContainer) {
      tableContainer.innerHTML = `
        <div class="table-wrapper">
          <div class="empty">Carico dati di ${monthNameIT(month0)} ${year}...</div>
        </div>
      `;
    }

    const picks = await sbFetch("picks", `?match_date=gte.${startStr}&match_date=lte.${endStr}&select=*`);
    const results = await sbFetch("results", `?picks_date=gte.${startStr}&picks_date=lte.${endStr}&select=*`);

    if (!Array.isArray(picks) || picks.length === 0) {
      if (tableContainer) {
        tableContainer.innerHTML = `
          <div class="table-wrapper">
            <div class="empty">Nessun dato disponibile per il mese selezionato.</div>
          </div>
        `;
      }
      return;
    }

    const resultMap = new Map();
    if (Array.isArray(results)) {
      for (const r of results) {
        const pd = String(r.picks_date || "").trim();
        const fid = String(r.fixture_id || "").trim();
        const pickText = String(r.pick || "").trim();
        if (!pd || (!fid && !pickText)) continue;
        const key = pd + "__" + fid + "__" + pickText;
        const existing = resultMap.get(key);
        if (!existing || resultRank(r) > resultRank(existing)) resultMap.set(key, r);
      }
    }

    function pickResult(p) {
      const pd = String(p.match_date || "").trim();
      const fid = String(p.fixture_id || "").trim();
      const pickText = String(p.pick || "").trim();
      const key = pd + "__" + fid + "__" + pickText;
      const res = resultMap.get(key) || {};
      return (res.result || "").toUpperCase();
    }

    function chooseBestResolvedPick(list) {
      const resolved = list.filter(p => {
        const r = pickResult(p);
        return r === "WIN" || r === "LOSE";
      });
      if (!resolved.length) return null;

      const wins = resolved.filter(p => pickResult(p) === "WIN");
      const pool = wins.length ? wins : resolved;

      pool.sort((a, b) => {
        const sa = Number(a.score || 0);
        const sb = Number(b.score || 0);
        if (sb !== sa) return sb - sa;
        return safeOdd(b.odd) - safeOdd(a.odd);
      });
      return pool[0];
    }

    const picksByDate = new Map();
    for (const p of picks) {
      const d = String(p.match_date || "").trim();
      if (!d) continue;
      if (!picksByDate.has(d)) picksByDate.set(d, []);
      picksByDate.get(d).push(p);
    }

    const dates = listDatesInRangeUTC(range.start, range.end);

    const byDay = new Map();
    const byCategory = {};

    let totalWins = 0, totalLoses = 0, totalStake = 0, totalProfit = 0, totalOddsSum = 0, totalOddsCount = 0;

    function ensureCat(k) {
      const kk = normalizeCatKey(k) || "ALTRO";
      if (EXCLUDED_CATEGORY_KEYS.has(kk)) return null;
      if (!byCategory[kk]) byCategory[kk] = { wins:0, loses:0, stake:0, profit:0, oddsSum:0, oddsCount:0 };
      return byCategory[kk];
    }

    for (const d of dates) {
      const dayPicks = picksByDate.get(d) || [];
      if (!dayPicks.length) continue;

      const byFixture = {};
      for (const p of dayPicks) {
        const fid = String(p.fixture_id || "").trim();
        if (!fid) continue;
        (byFixture[fid] ||= []).push(p);
      }

      let wins = 0, loses = 0, stake = 0, profit = 0;

      for (const fid of Object.keys(byFixture)) {
        const chosen = chooseBestResolvedPick(byFixture[fid]);
        if (!chosen) continue;

        const r = pickResult(chosen);
        const odd = safeOdd(chosen.odd);
        const catKey = deriveCategoryKeyFromPick(chosen);

        stake += 1; totalStake += 1;
        const cat = ensureCat(catKey);
        if (cat) cat.stake += 1;

        if (r === "WIN") {
          wins += 1; totalWins += 1;
          profit += odd - 1; totalProfit += odd - 1;
          if (cat) { cat.wins += 1; cat.profit += odd - 1; }
        } else {
          loses += 1; totalLoses += 1;
          profit -= 1; totalProfit -= 1;
          if (cat) { cat.loses += 1; cat.profit -= 1; }
        }

        totalOddsSum += odd; totalOddsCount += 1;
        if (cat) { cat.oddsSum += odd; cat.oddsCount += 1; }
      }

      const played = wins + loses;
      if (played > 0) byDay.set(d, { wins, loses, stake, profit });
    }

    const playedTotal = totalWins + totalLoses;
    const winrateTotal = playedTotal > 0 ? ((totalWins / playedTotal) * 100).toFixed(1) : "-";
    const roiTotal = totalStake > 0 ? ((totalProfit / totalStake) * 100).toFixed(1) : "-";
    const avgOdd = totalOddsCount > 0 ? (totalOddsSum / totalOddsCount) : null;
    const winNeed = (avgOdd && avgOdd > 1) ? (100 / avgOdd).toFixed(1) : "-";

    if ($("summary-period")) $("summary-period").textContent = `${formatDateIT(startStr)} → ${formatDateIT(endStr)}`;
    if ($("summary-days")) $("summary-days").textContent = `${byDay.size} giorni con picks giocate`;
    if ($("summary-winrate")) $("summary-winrate").textContent = (winrateTotal === "-" ? "-" : `${winrateTotal}%`);
    if ($("summary-wl")) $("summary-wl").textContent = playedTotal ? `${totalWins} win / ${totalLoses} lose` : "-";

    const roiEl = $("summary-roi");
    if (roiEl) {
      roiEl.textContent = (roiTotal === "-" ? "-" : `${roiTotal}%`);
      roiEl.className = "summary-value " + (roiTotal === "-" ? "badge-neutral" : (parseFloat(roiTotal) >= 0 ? "badge-pos" : "badge-neg"));
    }

    const profEl = $("summary-profit");
    if (profEl) {
      if (!playedTotal) {
        profEl.textContent = "-";
        profEl.className = "summary-value-small badge-neutral";
      } else {
        profEl.textContent = totalProfit >= 0 ? `Profitto totale: +${totalProfit.toFixed(2)} unità` : `Profitto totale: ${totalProfit.toFixed(2)} unità`;
        profEl.className = "summary-value-small " + (totalProfit >= 0 ? "badge-pos" : "badge-neg");
      }
    }

    const needEl = $("summary-winrate-needed");
    if (needEl) needEl.textContent = (winNeed === "-" || !avgOdd) ? "Winrate necessaria: -" : `Winrate necessaria per break-even: ${winNeed}% (quota media ~ ${avgOdd.toFixed(2)})`;

    const relEl = $("summary-reliability");
    if (relEl) {
      if (winrateTotal === "-" || winNeed === "-") {
        relEl.textContent = "-";
        relEl.className = "summary-value-small badge-neutral";
      } else {
        const label = reliabilityLabel(playedTotal, parseFloat(winrateTotal), parseFloat(winNeed));
        relEl.textContent = `Reliability: ${label}`;
        let cls = "badge-neutral";
        if (label.startsWith("Molto") || label.startsWith("Buona")) cls = "badge-pos";
        else if (label.startsWith("Debole") || label.startsWith("Negativa")) cls = "badge-neg";
        relEl.className = "summary-value-small " + cls;
      }
    }

    // ===== TABLES =====
    const sortedDays = Array.from(byDay.keys()).sort().reverse();
    let html = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Picks giocate</th>
              <th>Win</th>
              <th>Lose</th>
              <th>ROI giornaliero</th>
              <th>Profitto</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const day of sortedDays) {
      const s = byDay.get(day);
      const played = (s.wins || 0) + (s.loses || 0);
      const roiDay = s.stake > 0 ? ((s.profit / s.stake) * 100).toFixed(1) : "-";
      const profitStr = s.profit >= 0 ? `+${s.profit.toFixed(2)}` : s.profit.toFixed(2);
      const roiClass = roiDay === "-" ? "badge-neutral" : (parseFloat(roiDay) >= 0 ? "badge-pos" : "badge-neg");

      html += `
        <tr>
          <td data-label="Data">${formatDateIT(day)}</td>
          <td data-label="Picks giocate">${played}</td>
          <td data-label="Win">${s.wins}</td>
          <td data-label="Lose">${s.loses}</td>
          <td data-label="ROI giornaliero" class="${roiClass}">${roiDay === "-" ? "-" : roiDay + "%"}</td>
          <td data-label="Profitto">${profitStr} u</td>
        </tr>
      `;
    }

    html += `</tbody></table></div>`;

    const catKeys = Object.keys(byCategory)
      .filter(k => !EXCLUDED_CATEGORY_KEYS.has(normalizeCatKey(k)))
      .sort((a, b) => a.localeCompare(b));
    if (catKeys.length) {
      html += `
        <div class="table-wrapper">
          <h2 class="section-title">Rendimento per categoria di modello</h2>
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Picks giocate</th>
                <th>Win</th>
                <th>Lose</th>
                <th>Winrate</th>
                <th>ROI (stake=1)</th>
                <th>Quota media</th>
                <th>Winrate pareggio</th>
                <th>Reliability</th>
              </tr>
            </thead>
            <tbody>
      `;

      for (const ck of catKeys) {
        const c = byCategory[ck];
        const played = (c.wins || 0) + (c.loses || 0);
        const winrate = played > 0 ? ((c.wins / played) * 100).toFixed(1) : "-";
        const roi = c.stake > 0 ? ((c.profit / c.stake) * 100).toFixed(1) : "-";
        const avgO = c.oddsCount > 0 ? (c.oddsSum / c.oddsCount) : null;
        const avgOstr = avgO ? avgO.toFixed(2) : "-";
        const winNeedCat = (avgO && avgO > 1) ? (100 / avgO).toFixed(1) : "-";
        const roiClass = roi === "-" ? "badge-neutral" : (parseFloat(roi) >= 0 ? "badge-pos" : "badge-neg");

        let rel = "-";
        let relClass = "badge-neutral";
        if (played > 0 && winrate !== "-" && winNeedCat !== "-") {
          rel = reliabilityLabel(played, parseFloat(winrate), parseFloat(winNeedCat));
          if (rel.startsWith("Molto") || rel.startsWith("Buona")) relClass = "badge-pos";
          else if (rel.startsWith("Debole") || rel.startsWith("Negativa")) relClass = "badge-neg";
        }

        html += `
          <tr>
            <td data-label="Categoria">${getCategoryLabel(ck)}</td>
            <td data-label="Picks giocate">${played}</td>
            <td data-label="Win">${c.wins}</td>
            <td data-label="Lose">${c.loses}</td>
            <td data-label="Winrate">${winrate === "-" ? "-" : winrate + "%"}</td>
            <td data-label="ROI" class="${roiClass}">${roi === "-" ? "-" : roi + "%"}</td>
            <td data-label="Quota media">${avgOstr}</td>
            <td data-label="Winrate pareggio">${winNeedCat === "-" ? "-" : winNeedCat + "%"}</td>
            <td data-label="Reliability" class="${relClass}">${rel}</td>
          </tr>
        `;
      }

      html += `</tbody></table></div>`;
    }

    if (tableContainer) tableContainer.innerHTML = html;
  }

  // ====== MONTH UI ======
  function monthKey(y, m0) { return `${y}-${pad2(m0 + 1)}`; }

  function buildMonthList() {
    const now = new Date();
    let y = now.getFullYear();
    let m0 = now.getMonth();

    const out = [];
    // go backwards until PROJECT_START (inclusive)
    while (true) {
      out.push({ y, m0 });
      if (y === PROJECT_START.y && m0 === PROJECT_START.m0) break;
      m0 -= 1;
      if (m0 < 0) { m0 = 11; y -= 1; }
      // safety stop
      if (y < 2000) break;
    }
    return out; // newest -> oldest
  }

  function selectMonthUI(selected) {
    const wrap = $("month-buttons");
    if (wrap) {
      Array.from(wrap.querySelectorAll("button")).forEach(b => {
        const k = b.getAttribute("data-month-key");
        b.style.borderColor = "rgba(148,163,184,0.35)";
        b.style.opacity = "0.85";
        if (k === selected) {
          b.style.borderColor = "rgba(248,250,252,0.65)";
          b.style.opacity = "1";
        }
      });
    }
    const sel = $("month-select");
    if (sel) sel.value = selected;
  }

  function buildMonthButtons() {
    const wrap = $("month-buttons");
    if (!wrap) return;

    const months = buildMonthList();
    wrap.innerHTML = "";

    months.forEach((mm) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${monthNameIT(mm.m0)} ${mm.y}`;
      btn.setAttribute("data-month-key", monthKey(mm.y, mm.m0));

      btn.style.padding = "4px 10px";
      btn.style.borderRadius = "999px";
      btn.style.border = "1px solid rgba(148,163,184,0.35)";
      btn.style.background = "rgba(15, 23, 42, 0.9)";
      btn.style.color = "var(--text-main)";
      btn.style.fontSize = "0.78rem";
      btn.style.cursor = "pointer";
      btn.style.opacity = "0.85";

      btn.addEventListener("click", async () => {
        const key = monthKey(mm.y, mm.m0);
        selectMonthUI(key);
        await loadHistoryMonth(mm.y, mm.m0);
      });

      wrap.appendChild(btn);
    });
  }

  function buildMonthSelect() {
    const sel = $("month-select");
    if (!sel) return;

    const months = buildMonthList();
    sel.innerHTML = "";

    months.forEach(mm => {
      const opt = document.createElement("option");
      opt.value = monthKey(mm.y, mm.m0);
      opt.textContent = `${monthNameIT(mm.m0)} ${mm.y}`;
      sel.appendChild(opt);
    });

    sel.addEventListener("change", async () => {
      const [yStr, mStr] = sel.value.split("-");
      const y = Number(yStr);
      const m0 = Number(mStr) - 1;
      selectMonthUI(sel.value);
      await loadHistoryMonth(y, m0);
    });
  }

  function initDefaultMonth() {
    const now = new Date();
    let y = now.getFullYear();
    let m0 = now.getMonth();

    // If we're before project start (shouldn't happen), clamp
    if (y < PROJECT_START.y || (y === PROJECT_START.y && m0 < PROJECT_START.m0)) {
      y = PROJECT_START.y;
      m0 = PROJECT_START.m0;
    }

    const key = monthKey(y, m0);
    selectMonthUI(key);
    loadHistoryMonth(y, m0);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (DEBUG_ENABLED) { logDebug("Debug attivo (?debug=1)."); showDebugPanel(); }
    buildMonthButtons();
    buildMonthSelect();
    initDefaultMonth();
  });
})();
