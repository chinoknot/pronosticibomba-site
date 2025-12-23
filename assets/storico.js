/* PronosticiBomba - Storico ROI (mensile)
   NOTE: file esterno per compatibilità CSP (niente script inline).
*/
(() => {
  const DEBUG_ENABLED = new URLSearchParams(location.search).get("debug") === "1";

  function $(id) { return document.getElementById(id); }

  function showDebugPanel() {
    const panel = $("debug-panel");
    if (!panel) return;
    panel.style.display = "block";
    const btn = $("debug-close");
    if (btn) btn.onclick = () => (panel.style.display = "none");
  }
  function logDebug(msg) {
    const panel = $("debug-panel");
    const pre = $("debug-log");
    if (!panel || !pre) return;
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

  // ===== Supabase =====
  // Manteniamo questi valori come nel tuo index attuale (stessa istanza Supabase).
  const SUPABASE_URL = "https://tijzxlmnhdaxsyvhjpjjhglejd.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1pbyIsInJlZiI6InRpanp4bG1uaGQeGF4c3l2aGpwampobGdlejQiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMzQ5MzM5OCwiZXhwIjoyMDc5NTg1NDk3fQ.r7kz3FdijAhsJLz1DcEtobJLaPCqygrQGgCPpSc-05A";

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
        const err = new Error(`Errore dati ${res.status}: ${t}`);
        logErrorToUI("Fetch error", err);
        throw err;
      }
      return await res.json();
    } catch (e) {
      logErrorToUI("Network/CORS", e);
      throw e;
    }
  }

  // ===== Utils =====
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function safeOdd(o) {
    const n = Number(o);
    if (!isFinite(n) || n <= 1) return 1.0;
    return n;
  }

  function monthNameIT(m0) {
    return ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"][m0] || "";
  }

  function formatDateIT(ymd) {
    // ymd = YYYY-MM-DD
    if (!ymd || typeof ymd !== "string") return "-";
    const [y,m,d] = ymd.split("-");
    if (!y || !m || !d) return ymd;
    return `${d}/${m}/${y}`;
  }

  function dateToYMD_UTC(dt) {
    const y = dt.getUTCFullYear();
    const m = pad2(dt.getUTCMonth() + 1);
    const d = pad2(dt.getUTCDate());
    return `${y}-${m}-${d}`;
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

  function resultRank(r) {
    const res = String((r && r.result) || "").toUpperCase();
    const st = String((r && r.status_short) || "").toUpperCase();
    // Ordine: WIN/LOSE definiti > VOID > altri.
    if (res === "WIN") return 50;
    if (res === "LOSE") return 40;
    if (res === "VOID") return 30;
    if (st === "FT") return 20;
    return 10;
  }

  function normalizeCatKey(k) {
    return String(k || "").trim().toUpperCase();
  }

  // Etichette category: usa le stesse del tuo sito se vuoi.
  function getCategoryLabel(catKey) {
    const k = normalizeCatKey(catKey);
    const map = {
      "BEST_TIPS_OF_DAY": "ELITE PICKS",
      "SINGLE_GAME": "EXCLUSIVE PICK",
      "SAFE_PICKS": "RELIABLE PICKS",
      "SAFE_GOALS": "SAFE GOALS",
      "COMBO_DOPPIA_O15": "DOUBLE CHANCE + OVER 1.5",
      "GG_SPECIAL": "GG SPECIAL",
      "HT_GOAL_ENGINE": "HT GOAL ENGINE",
      "DNB_ENGINE": "DNB ENGINE",
      "OVER_UNDER_TIPS": "GOALS TRENDS",
      "VALUE_PICKS": "VALUE PICKS",
      "ALTRO": "ALTRO"
    };
    return map[k] || (catKey || "ALTRO");
  }

  // Come derivare la categoria dalla pick (se già presente in p.category ok)
  function deriveCategoryKeyFromPick(p) {
    const raw = String((p && p.category) || "").trim();
    return raw ? raw : "ALTRO";
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

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ===== Core monthly loader =====
  async function loadHistoryMonth(year, month0) {
    const monthPill = $("month-pill");
    const tableContainer = $("table-container");

    // Reset UI
    const idsToDash = [
      "summary-period","summary-days","summary-winrate","summary-wl",
      "summary-roi","summary-profit","summary-winrate-needed","summary-reliability"
    ];
    idsToDash.forEach(id => { const el = $(id); if (el) el.textContent = "-"; });

    const range = getMonthRangeUTC(year, month0);
    const startStr = dateToYMD_UTC(range.start);
    const endStr = dateToYMD_UTC(range.end);

    if (monthPill) {
      monthPill.textContent = `${monthNameIT(month0)} ${year} (${formatDateIT(startStr)} → ${formatDateIT(endStr)})`;
    }

    if (tableContainer) {
      tableContainer.innerHTML = `
        <div class="table-wrapper">
          <div class="empty">Carico dati di ${escapeHtml(monthNameIT(month0))} ${year}...</div>
        </div>
      `;
    }

    // Fetch picks + results in 2 calls
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

    // Map results by day+fixture+pick (keep best rank)
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

      // prefer WIN picks if exist (matches your current logic)
      const wins = resolved.filter(p => pickResult(p) === "WIN");
      const pool = wins.length ? wins : resolved;

      pool.sort((a, b) => {
        const sa = Number(a.score || 0);
        const sb = Number(b.score || 0);
        if (sb !== sa) return sb - sa;
        const oa = safeOdd(a.odd);
        const ob = safeOdd(b.odd);
        return ob - oa;
      });

      return pool[0];
    }

    // Group picks by date
    const picksByDate = new Map();
    for (const p of picks) {
      const d = String(p.match_date || "").trim();
      if (!d) continue;
      if (!picksByDate.has(d)) picksByDate.set(d, []);
      picksByDate.get(d).push(p);
    }

    const dates = listDatesInRangeUTC(range.start, range.end);

    // Per-day aggregation
    const byDay = new Map();
    const byCategory = {};
    const byCategorySeen = {};

    let totalWins = 0, totalLoses = 0, totalStake = 0, totalProfit = 0, totalOddsSum = 0, totalOddsCount = 0;

    for (const d of dates) {
      const dayPicks = picksByDate.get(d) || [];
      if (!dayPicks.length) continue;

      // group by fixture
      const byFixture = {};
      for (const p of dayPicks) {
        const fid = String(p.fixture_id || "").trim();
        if (!fid) continue;
        if (!byFixture[fid]) byFixture[fid] = [];
        byFixture[fid].push(p);
      }

      // seen fixtures per category (count unique fixture per category)
      const seenByCatToday = {};
      for (const fid of Object.keys(byFixture)) {
        const cats = new Set();
        for (const p of byFixture[fid]) cats.add(deriveCategoryKeyFromPick(p) || "ALTRO");
        for (const ck of cats) seenByCatToday[ck] = (seenByCatToday[ck] || 0) + 1;
      }
      for (const [ck, cnt] of Object.entries(seenByCatToday)) {
        const k = normalizeCatKey(ck) || "ALTRO";
        byCategorySeen[k] = (byCategorySeen[k] || 0) + (cnt || 0);
      }

      let wins = 0, loses = 0, stake = 0, profit = 0, oddsSum = 0, oddsCount = 0;

      function ensureCat(catKey) {
        const k = normalizeCatKey(catKey) || "ALTRO";
        if (!byCategory[k]) byCategory[k] = { wins:0, loses:0, stake:0, profit:0, oddsSum:0, oddsCount:0 };
        return byCategory[k];
      }

      for (const fid of Object.keys(byFixture)) {
        const chosen = chooseBestResolvedPick(byFixture[fid]);
        if (!chosen) continue;

        const r = pickResult(chosen);
        const odd = safeOdd(chosen.odd);
        const catKey = deriveCategoryKeyFromPick(chosen);

        stake += 1;
        totalStake += 1;

        const cat = ensureCat(catKey);
        cat.stake += 1;

        if (r === "WIN") {
          wins += 1; totalWins += 1;
          profit += odd - 1; totalProfit += odd - 1;
          cat.wins += 1; cat.profit += odd - 1;
        } else {
          loses += 1; totalLoses += 1;
          profit -= 1; totalProfit -= 1;
          cat.loses += 1; cat.profit -= 1;
        }

        oddsSum += odd; oddsCount += 1;
        totalOddsSum += odd; totalOddsCount += 1;
        cat.oddsSum += odd; cat.oddsCount += 1;
      }

      const played = wins + loses;
      if (played > 0) {
        byDay.set(d, { wins, loses, stake, profit });
      }
    }

    // Fill summary
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
    if (needEl) {
      needEl.textContent = (winNeed === "-" || !avgOdd) ? "Winrate necessaria: -" : `Winrate necessaria per break-even: ${winNeed}% (quota media ~ ${avgOdd.toFixed(2)})`;
    }

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

    // Build daily table
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

    // Category table
    const catKeys = Object.keys(byCategory).sort((a,b) => a.localeCompare(b));
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
        if (played === 0) {
          const seen = byCategorySeen[ck] || 0;
          rel = seen > 0 ? "Solo VOID/PENDING" : "-";
        } else if (winrate !== "-" && winNeedCat !== "-") {
          rel = reliabilityLabel(played, parseFloat(winrate), parseFloat(winNeedCat));
          if (rel.startsWith("Molto") || rel.startsWith("Buona")) relClass = "badge-pos";
          else if (rel.startsWith("Debole") || rel.startsWith("Negativa")) relClass = "badge-neg";
        }

        html += `
          <tr>
            <td data-label="Categoria">${escapeHtml(getCategoryLabel(ck))}</td>
            <td data-label="Picks giocate">${played}</td>
            <td data-label="Win">${c.wins}</td>
            <td data-label="Lose">${c.loses}</td>
            <td data-label="Winrate">${winrate === "-" ? "-" : winrate + "%"}</td>
            <td data-label="ROI" class="${roiClass}">${roi === "-" ? "-" : roi + "%"}</td>
            <td data-label="Quota media">${avgOstr}</td>
            <td data-label="Winrate pareggio">${winNeedCat === "-" ? "-" : winNeedCat + "%"}</td>
            <td data-label="Reliability" class="${relClass}">${escapeHtml(rel)}</td>
          </tr>
        `;
      }

      html += `</tbody></table></div>`;
    }

    if (tableContainer) tableContainer.innerHTML = html;
  }

  function buildMonthButtons() {
    const wrap = $("month-buttons");
    if (!wrap) return;

    const now = new Date();
    const baseY = now.getFullYear();
    const baseM = now.getMonth();

    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(baseY, baseM - i, 1);
      months.push({ y: d.getFullYear(), m0: d.getMonth() });
    }

    wrap.innerHTML = "";
    months.forEach((mm, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${monthNameIT(mm.m0)} ${mm.y}`;
      btn.style.padding = "4px 10px";
      btn.style.borderRadius = "999px";
      btn.style.border = "1px solid rgba(148,163,184,0.35)";
      btn.style.background = "rgba(15, 23, 42, 0.9)";
      btn.style.color = "var(--text-main)";
      btn.style.fontSize = "0.78rem";
      btn.style.cursor = "pointer";
      btn.style.opacity = "0.85";

      btn.addEventListener("click", async () => {
        Array.from(wrap.querySelectorAll("button")).forEach(b => {
          b.style.borderColor = "rgba(148,163,184,0.35)";
          b.style.opacity = "0.85";
        });
        btn.style.borderColor = "rgba(248,250,252,0.65)";
        btn.style.opacity = "1";
        await loadHistoryMonth(mm.y, mm.m0);
      });

      wrap.appendChild(btn);

      if (idx === 0) {
        // auto select current month
        setTimeout(() => btn.click(), 0);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (DEBUG_ENABLED) {
      logDebug("Debug attivo (?debug=1).");
      showDebugPanel();
    }
    buildMonthButtons();
    // se dopo 3s ancora vuoto, logga hint
    setTimeout(() => {
      const pill = $("month-pill");
      const roi = $("summary-roi");
      if (pill && pill.textContent.trim() === "-" && roi && roi.textContent.trim() === "-") {
        logDebug("Nessun dato caricato: possibile blocco CSP o fetch/CORS. Se sei su HTTPS, probabile CSP su script.");
      }
    }, 3000);
  });
})();
