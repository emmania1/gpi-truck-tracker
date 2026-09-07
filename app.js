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
            ticks: { color: axisColor() },
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
            ticks: { color: axisColor(), font: { size: 9 } },
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
          ${d.source ? `<div class="real-datapoint-source">Source: ${linkify(d.source)}</div>` : ""}
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

  async function init() {
    try {
      const fredData = await loadJSON("data/fred-series.json");
      renderSAARChart(fredData);
      renderDemandBackdrop(fredData);
    } catch (e) {
      console.error(e);
      const oneLiner1 = document.getElementById("sec1-oneliner");
      if (oneLiner1) oneLiner1.textContent = "Could not load live FRED data.";
      const oneLiner2 = document.getElementById("sec2-oneliner");
      if (oneLiner2) oneLiner2.textContent = "Could not load live FRED data.";
    }

    try {
      const manual = await loadJSON("data/manual-data.json");
      const rs = manual.real_series || {};
      const tn = manual.tracked_notes || {};

      renderRealTable(document.getElementById("sec3-content"), rs.ford_truck_deliveries, ["Period", "Ford Value"]);
      const sec3b = document.createElement("div");
      document.getElementById("sec3-content").appendChild(sec3b);
      renderRealTable(sec3b, rs.gm_truck_deliveries, ["Period", "GM Value"]);

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
  }

  document.addEventListener("DOMContentLoaded", init);
})();
