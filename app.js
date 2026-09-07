(function () {
  const YEARS_LOOKBACK = 5;

  const SERIES_COLORS = {
    DLTRUCKSSAAR: "#1f5c8b",
    FLTRUCKSSAAR: "#c0562b",
    ALTSALES: "#5a4a9e",
  };

  function fmtDate(d) {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short" });
  }

  function fmtNum(n, digits = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function isDarkMode() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function axisColor() {
    return isDarkMode() ? "#9b9a94" : "#6b6a64";
  }

  function gridColor() {
    return isDarkMode() ? "#33353a" : "#e1e0db";
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  function renderSAARChart(fredData) {
    const series = fredData.series || {};
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - YEARS_LOOKBACK);

    const datasets = [];
    let latestByCode = {};
    let allDates = new Set();

    for (const code of ["DLTRUCKSSAAR", "FLTRUCKSSAAR", "ALTSALES"]) {
      const s = series[code];
      if (!s || !s.data || !s.data.length) continue;
      const pts = s.data.filter((p) => new Date(p.date) >= cutoff);
      pts.forEach((p) => allDates.add(p.date));
      latestByCode[code] = s.data[s.data.length - 1];
      datasets.push({
        label: s.name,
        data: pts.map((p) => ({ x: p.date, y: p.value })),
        borderColor: SERIES_COLORS[code],
        backgroundColor: SERIES_COLORS[code],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
      });
    }

    const ctx = document.getElementById("chart-saar");
    if (!ctx) return;

    new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "time",
            time: { unit: "quarter" },
            ticks: { color: axisColor() },
            grid: { color: gridColor() },
          },
          y: {
            ticks: { color: axisColor(), callback: (v) => `${fmtNum(v, 1)}M` },
            grid: { color: gridColor() },
            title: { display: true, text: "Millions of Units (SAAR)", color: axisColor() },
          },
        },
        plugins: {
          legend: { position: "bottom", labels: { color: axisColor(), boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: (items) => fmtDate(items[0].parsed.x),
            },
          },
        },
      },
    });

    const dl = latestByCode.DLTRUCKSSAAR;
    const fl = latestByCode.FLTRUCKSSAAR;
    const alt = latestByCode.ALTSALES;
    const oneLiner = document.getElementById("sec1-oneliner");
    if (oneLiner && dl && fl && alt) {
      oneLiner.textContent = `Latest (${fmtDate(dl.date)}): domestic light trucks ${fmtNum(dl.value)}M SAAR, imported ${fmtNum(fl.value)}M SAAR, total light vehicles ${fmtNum(alt.value)}M SAAR.`;
    } else if (oneLiner) {
      oneLiner.textContent = "FRED data unavailable — check data/fred-series.json.";
    }
  }

  function renderMiniChart(canvasId, seriesObj, opts) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !seriesObj || !seriesObj.data || !seriesObj.data.length) return null;

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - YEARS_LOOKBACK);
    const pts = seriesObj.data.filter((p) => new Date(p.date) >= cutoff);

    new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          {
            label: seriesObj.name,
            data: pts.map((p) => ({ x: p.date, y: p.value })),
            borderColor: opts.color,
            backgroundColor: opts.color,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "time",
            time: { unit: "year" },
            ticks: { color: axisColor(), font: { size: 9 } },
            grid: { color: gridColor() },
          },
          y: {
            ticks: {
              color: axisColor(),
              font: { size: 9 },
              callback: (v) => `${opts.prefix ?? ""}${fmtNum(v, opts.decimals ?? 1)}${opts.suffix ?? ""}`,
            },
            grid: { color: gridColor() },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => fmtDate(items[0].parsed.x),
              label: (item) => `${opts.prefix ?? ""}${fmtNum(item.parsed.y, opts.decimals ?? 1)}${opts.suffix ?? ""}`,
            },
          },
        },
      },
    });

    return seriesObj.data[seriesObj.data.length - 1];
  }

  function renderDemandBackdrop(fredData) {
    const series = fredData.series || {};
    const loan = renderMiniChart("chart-autoloan", series.TERMCBAUTO48NS, { color: "#1f5c8b", decimals: 2, suffix: "%" });
    const gas = renderMiniChart("chart-gas", series.GASREGW, { color: "#c0562b", decimals: 2, prefix: "$" });
    const txur = renderMiniChart("chart-txunemployment", series.TXUR, { color: "#5a4a9e", decimals: 1, suffix: "%" });

    const oneLiner = document.getElementById("sec2-oneliner");
    if (!oneLiner) return;
    if (loan && gas && txur) {
      oneLiner.textContent = `Latest: 48-mo auto loan rate ${fmtNum(loan.value, 2)}% (${fmtDate(loan.date)}), gas $${fmtNum(gas.value, 2)}/gal (${fmtDate(gas.date)}), Texas unemployment ${fmtNum(txur.value, 1)}% (${fmtDate(txur.date)}).`;
    } else {
      oneLiner.textContent = "FRED data unavailable — check data/fred-series.json.";
    }
  }

  function emptyStateHTML(label, sourceGuidance, flag) {
    return `
      <div class="empty-state">
        Awaiting data — ${label} has not been entered yet.<br/>
        <span style="font-size:0.78rem;">Source: ${sourceGuidance}</span>
        ${flag ? `<div class="flag">${flag}</div>` : ""}
      </div>
    `;
  }

  function escapeHTML(s) {
    const div = document.createElement("div");
    div.textContent = s ?? "";
    return div.innerHTML;
  }

  function linkify(text) {
    const escaped = escapeHTML(text);
    return escaped.replace(/(https?:\/\/[^\s)]+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  }

  function renderOemTable(containerEl, seriesObj) {
    if (!seriesObj || !seriesObj.data || seriesObj.data.length === 0) {
      containerEl.innerHTML = emptyStateHTML(seriesObj ? seriesObj.label : "This series", seriesObj ? seriesObj.source_guidance : "", seriesObj ? seriesObj.flag : null);
      return;
    }
    const sorted = seriesObj.data
      .slice()
      .sort((a, b) => (a.quarter === b.quarter ? a.oem.localeCompare(b.oem) : b.quarter.localeCompare(a.quarter)));

    const rows = sorted
      .map((d) => {
        const yoy = d.yoy_pct === null || d.yoy_pct === undefined ? "n/a" : `${d.yoy_pct > 0 ? "+" : ""}${fmtNum(d.yoy_pct, 1)}%`;
        return `
        <div class="real-datapoint">
          <div class="oem-fields">
            <span class="oem-field"><span class="oem-field-label">Quarter</span>${escapeHTML(d.quarter ?? "—")}</span>
            <span class="oem-field"><span class="oem-field-label">OEM</span>${escapeHTML(d.oem ?? "—")}</span>
            <span class="oem-field"><span class="oem-field-label">Truck Units</span>${escapeHTML(fmtNum(d.truck_units, 0))}</span>
            <span class="oem-field"><span class="oem-field-label">YoY %</span>${escapeHTML(yoy)}</span>
          </div>
          ${d.note ? `<div class="real-datapoint-note">${escapeHTML(d.note)}</div>` : ""}
          ${d.source ? `<div class="real-datapoint-source">📎 Source: ${linkify(d.source)}</div>` : ""}
        </div>`;
      })
      .join("");

    containerEl.innerHTML = `
      <div class="real-datapoint-label">${escapeHTML(seriesObj.label)}</div>
      ${rows}
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Series last updated: ${escapeHTML(seriesObj.last_updated ?? "—")}</div>
    `;
  }

  function renderRealTable(containerEl, seriesObj, columns) {
    if (!seriesObj || !seriesObj.data || seriesObj.data.length === 0) {
      containerEl.innerHTML = emptyStateHTML(seriesObj ? seriesObj.label : "This series", seriesObj ? seriesObj.source_guidance : "", seriesObj ? seriesObj.flag : null);
      return;
    }
    const cards = seriesObj.data
      .slice()
      .reverse()
      .map(
        (d) => `
        <div class="real-datapoint">
          <div class="real-datapoint-head">
            <span class="real-datapoint-period">${escapeHTML(d.period ?? "—")}</span>
            <span class="real-datapoint-value">${escapeHTML(String(d.value ?? "—"))}</span>
          </div>
          ${d.note ? `<div class="real-datapoint-note">${escapeHTML(d.note)}</div>` : ""}
          ${d.source ? `<div class="real-datapoint-source">📎 Source: ${linkify(d.source)}</div>` : ""}
        </div>`
      )
      .join("");
    containerEl.innerHTML = `
      <div class="real-datapoint-label">${escapeHTML(seriesObj.label)} <span style="color:var(--text-muted);font-weight:400;">(${escapeHTML(columns[1])})</span></div>
      ${cards}
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Last updated: ${escapeHTML(seriesObj.last_updated ?? "—")}</div>
    `;
  }

  function renderTrackedCard(containerEl, note) {
    if (!note) {
      containerEl.innerHTML = `<div class="empty-state">No tracked note found.</div>`;
      return;
    }
    const isEmpty = !note.detail && note.status === "awaiting data";
    if (isEmpty) {
      containerEl.innerHTML = emptyStateHTML(note.label, "hand-maintained — see data/manual-data.json", null);
      return;
    }
    containerEl.innerHTML = `
      <div class="tracked-card">
        <div>
          <div class="tracked-status">${note.status}</div>
          ${note.target ? `<div class="tracked-target">Target: ${note.target}</div>` : ""}
          <div class="tracked-detail">${note.detail}</div>
        </div>
        <div class="tracked-updated">Updated ${note.last_updated ?? "—"}</div>
      </div>
    `;
  }

  function fmtTimestamp(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  }

  function daysSince(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return (Date.now() - d.getTime()) / 86400000;
  }

  function findPointNearDaysAgo(data, days) {
    if (!data || !data.length) return null;
    const target = Date.now() - days * 86400000;
    let best = data[0];
    let bestDiff = Math.abs(new Date(data[0].date).getTime() - target);
    for (const p of data) {
      const diff = Math.abs(new Date(p.date).getTime() - target);
      if (diff < bestDiff) {
        best = p;
        bestDiff = diff;
      }
    }
    return best;
  }

  function renderExecSummary(fredData, manualData) {
    const el = document.getElementById("exec-summary-body");
    if (!el) return;
    try {
      const rs = manualData?.real_series ?? {};
      const tn = manualData?.tracked_notes ?? {};
      const series = fredData?.series ?? {};

      // 1. GPI same-store new-vehicle unit trend (narrowing/holding/widening)
      const sssPts = (rs.gpi_new_vehicle_sss?.data ?? []).slice().sort((a, b) => a.period.localeCompare(b.period));
      let sssSentence = "GPI's same-store new-vehicle trend isn't yet populated in the tracker.";
      if (sssPts.length >= 2) {
        const prev = sssPts[sssPts.length - 2];
        const cur = sssPts[sssPts.length - 1];
        const direction = Math.abs(cur.value) < Math.abs(prev.value) ? "narrowed" : Math.abs(cur.value) > Math.abs(prev.value) ? "widened" : "held steady";
        sssSentence = `GPI's own same-store new-vehicle unit decline ${direction} from ${fmtNum(prev.value, 1)}% YoY in ${prev.period} to ${fmtNum(cur.value, 1)}% YoY in ${cur.period} — the tracker doesn't carry a peer same-store series, so this reflects GPI's own trajectory only, not a peer-relative gap.`;
      }

      // 2. Leverage trajectory — reuse the already-sourced status string verbatim
      const lev = tn.leverage_trajectory;
      const levSentence = lev?.status
        ? `Leverage stood at ${lev.status}.`
        : "Leverage data isn't yet populated in the tracker.";

      // 3. Truck SAAR stability vs affordability backdrop (Sections 1-2 only)
      let saarSentence = "Live SAAR/affordability data isn't yet available to characterize truck-specific softness.";
      const dlData = series.DLTRUCKSSAAR?.data;
      const loanData = series.TERMCBAUTO48NS?.data;
      const gasData = series.GASREGW?.data;
      const txurData = series.TXUR?.data;
      if (dlData?.length && loanData?.length && gasData?.length && txurData?.length) {
        const dlLatest = dlData[dlData.length - 1];
        const dlYearAgo = findPointNearDaysAgo(dlData, 365);
        const dlChangePct = dlYearAgo ? ((dlLatest.value - dlYearAgo.value) / dlYearAgo.value) * 100 : null;
        const dlWord = dlChangePct === null ? "moved" : Math.abs(dlChangePct) < 3 ? "held roughly stable" : dlChangePct > 0 ? "risen" : "declined";
        const loanLatest = loanData[loanData.length - 1];
        const gasLatest = gasData[gasData.length - 1];
        const txurLatest = txurData[txurData.length - 1];
        saarSentence = `Meanwhile, domestic light-truck SAAR has ${dlWord}${dlChangePct !== null ? ` (${dlChangePct >= 0 ? "+" : ""}${fmtNum(dlChangePct, 1)}% vs a year earlier)` : ""} at ${fmtNum(dlLatest.value, 2)}M units (Section 1), even as the 48-month new-auto loan rate (${fmtNum(loanLatest.value, 2)}%), gas prices ($${fmtNum(gasLatest.value, 2)}/gal), and Texas unemployment (${fmtNum(txurLatest.value, 1)}%) — all cited by GPI management as demand drags (Section 2) — stay elevated, suggesting the truck softness GPI describes reads more as an affordability/execution story than a broad SAAR collapse.`;
      }

      el.textContent = `${sssSentence} ${levSentence} ${saarSentence}`;
    } catch (e) {
      console.error(e);
      el.textContent = `Could not compute executive summary from current data. [debug: ${e && e.message}]`;
    }
  }

  function renderFreshnessBar(fredData, manualData) {
    const bar = document.getElementById("freshness-bar");
    if (!bar) return;

    const liveUpdated = fredData?.meta?.last_updated ?? null;
    const liveAgeDays = liveUpdated ? daysSince(liveUpdated) : null;
    const liveStale = liveAgeDays !== null && liveAgeDays > 40;

    let manualLatest = null;
    const rs = manualData?.real_series ?? {};
    const tn = manualData?.tracked_notes ?? {};
    for (const s of Object.values(rs)) {
      if (s.last_updated && (!manualLatest || s.last_updated > manualLatest)) manualLatest = s.last_updated;
    }
    for (const n of Object.values(tn)) {
      if (n.last_updated && (!manualLatest || n.last_updated > manualLatest)) manualLatest = n.last_updated;
    }

    bar.innerHTML = `
      <span class="freshness-item">
        <span class="dot" style="background:var(--live)"></span>
        Live data last refreshed: <strong>${liveUpdated ? fmtTimestamp(liveUpdated) : "unavailable"}</strong>
        ${liveStale ? `<span class="stale-flag">STALE — ${Math.floor(liveAgeDays)}d old</span>` : ""}
      </span>
      <span class="freshness-item">
        <span class="dot" style="background:var(--real)"></span>
        Manual/tracked entries last edited: <strong>${manualLatest ?? "unknown"}</strong>
      </span>
    `;
  }

  async function init() {
    let fredData = null;
    try {
      fredData = await loadJSON("data/fred-series.json");
      renderSAARChart(fredData);
      renderDemandBackdrop(fredData);
    } catch (e) {
      console.error(e);
      const oneLiner1 = document.getElementById("sec1-oneliner");
      if (oneLiner1) oneLiner1.textContent = "Could not load live FRED data.";
      const oneLiner2 = document.getElementById("sec2-oneliner");
      if (oneLiner2) oneLiner2.textContent = "Could not load live FRED data.";
    }

    let manual = null;
    try {
      manual = await loadJSON("data/manual-data.json");
      const rs = manual.real_series || {};
      const tn = manual.tracked_notes || {};

      renderOemTable(document.getElementById("sec3-content"), rs.oem_truck_deliveries);

      const sec4a = document.getElementById("sec4-content");
      renderRealTable(sec4a, rs.gpi_new_vehicle_sss, ["Period", "SSS % YoY"]);
      const sec4b = document.createElement("div");
      sec4a.appendChild(sec4b);
      renderRealTable(sec4b, rs.gpi_texas_new_unit_growth, ["Period", "Texas Growth % YoY"]);

      renderRealTable(document.getElementById("sec5-content"), rs.truck_atp, ["Period", "ATP ($)"]);

      renderTrackedCard(document.getElementById("sec6-content"), tn.rebranding_seo);
      renderTrackedCard(document.getElementById("sec7-content"), tn.val_u_line);
      renderTrackedCard(document.getElementById("sec8-content"), tn.dealership_disposal);
      renderTrackedCard(document.getElementById("sec9-content"), tn.leverage_trajectory);
    } catch (e) {
      console.error(e);
    }

    renderFreshnessBar(fredData, manual);
    renderExecSummary(fredData, manual);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
