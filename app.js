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

  function firstUrl(src) {
    const m = (src || "").match(/https?:\/\/[^\s)]+/);
    return m ? m[0] : null;
  }

  function shortSourceLabel(src) {
    let t = (src || "").split(/https?:\/\//)[0].trim();
    t = t.replace(/[\s:—\-.,;]+$/, "");
    if (t.length > 110) t = t.slice(0, 107).trimEnd() + "…";
    return t || "source";
  }

  function compactSource(src) {
    if (!src) return "";
    const u = firstUrl(src);
    const label = escapeHTML(shortSourceLabel(src));
    return `<div class="src-compact">📎 ${u ? `<a href="${u}" target="_blank" rel="noopener">${label}</a>` : label}</div>`;
  }

  function disclosure(what, bodyHTML) {
    return `<details class="disclosure"><summary><span class="lbl-closed">Show ${what}</span><span class="lbl-open">Hide ${what}</span></summary><div class="disclosure-body">${bodyHTML}</div></details>`;
  }

  const SRC_BASIS = {
    primary: ["primary", "✓ Primary source", "Primary source — read directly from the OEM's own release."],
    "primary-derived": ["primary", "✓ Primary source (derived)", "Primary source, derived — computed from two figures in the OEM's own release."],
    relayed: ["relayed", "⚠ GM official table — relayed, spot-check", "GM official table — figures relayed second-hand because the PDF blocks automated access; arithmetically cross-checked but not opened directly. Spot-check recommended."],
    secondary: ["secondary", "⚠ Secondary source — unverified", "Secondary source (trade press) — unverified."],
  };

  function srcBadge(q) {
    const m = SRC_BASIS[q];
    if (!m) return "";
    return `<div><span class="src-badge ${m[0]}" title="${escapeHTML(m[2])}">${escapeHTML(m[1])}</span></div>`;
  }

  function srcBasisLine(q) {
    const m = SRC_BASIS[q];
    return m ? `<div class="real-datapoint-note"><strong>Source basis:</strong> ${escapeHTML(m[2])}</div>` : "";
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
          ${srcBadge(d.source_quality)}
          ${compactSource(d.source)}
          ${disclosure("details &amp; sourcing", `${srcBasisLine(d.source_quality)}${d.note ? `<div class="real-datapoint-note">${escapeHTML(d.note)}</div>` : ""}${d.source ? `<div class="real-datapoint-source">📎 Source: ${linkify(d.source)}</div>` : ""}`)}
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
      .map((d) => {
        const collapsed = (d.note || "").length > 260 || !!d.headline;
        const head = `
          <div class="real-datapoint-head">
            <span class="real-datapoint-period">${escapeHTML(d.period ?? "—")}</span>
            <span class="real-datapoint-value">${escapeHTML(String(d.value ?? "—"))}</span>
          </div>`;
        if (!collapsed) {
          return `
        <div class="real-datapoint">
          ${head}
          ${d.note ? `<div class="real-datapoint-note">${escapeHTML(d.note)}</div>` : ""}
          ${d.source ? `<div class="real-datapoint-source">📎 Source: ${linkify(d.source)}</div>` : ""}
        </div>`;
        }
        return `
        <div class="real-datapoint">
          ${head}
          ${d.headline ? `<div class="real-datapoint-headline">${escapeHTML(d.headline)}</div>` : ""}
          ${compactSource(d.source)}
          ${disclosure("full note &amp; sourcing", `${d.note ? `<div class="real-datapoint-note">${escapeHTML(d.note)}</div>` : ""}${d.source ? `<div class="real-datapoint-source">📎 Source: ${linkify(d.source)}</div>` : ""}`)}
        </div>`;
      })
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
          ${note.detail ? disclosure("detail", `<div class="tracked-detail">${note.detail}</div>`) : ""}
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

  function yoyFromSeries(seriesObj, date) {
    const pts = seriesObj?.data;
    if (!pts || !pts.length) return null;
    const y = parseInt(date.slice(0, 4), 10);
    const prevDate = `${y - 1}${date.slice(4)}`;
    const cur = pts.find((p) => p.date === date);
    const prev = pts.find((p) => p.date === prevDate);
    if (!cur || !prev) return null;
    return { value: cur.value, prev: prev.value, pct: (cur.value / prev.value - 1) * 100 };
  }

  function fmtSigned(v, d = 1, suffix = "%") {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return `${v > 0 ? "+" : ""}${fmtNum(v, d)}${suffix}`;
  }

  function monthLabel(m) {
    if (m.startsWith("2026-10")) return "Oct 1–15";
    const d = new Date(`${m.slice(0, 7)}-01T00:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  }

  function quarterOfMonth(m) {
    const y = m.slice(0, 4);
    const mm = parseInt(m.slice(5, 7), 10);
    return `${y}Q${Math.ceil(mm / 3)}`;
  }

  function usedMonthsFor(usedMkt, quarter) {
    return (usedMkt?.data ?? []).filter((r) => /^\d{4}-\d{2}$/.test(r.month) && quarterOfMonth(r.month) === quarter);
  }

  function avgOf(rows, key) {
    const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
    if (vals.length !== rows.length || !vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function spreadOf(r) {
    if (r.retail_listing_yoy_pct === null || r.retail_listing_yoy_pct === undefined) return null;
    if (r.muvvi_yoy_pct === null || r.muvvi_yoy_pct === undefined) return null;
    return r.retail_listing_yoy_pct - r.muvvi_yoy_pct;
  }

  function renderCPIChart(fredData) {
    const used = fredData?.series?.CUSR0000SETA02;
    const neu = fredData?.series?.CUSR0000SETA01;
    const ctx = document.getElementById("chart-cpi");
    const oneLiner = document.getElementById("sec3-oneliner");
    if (!ctx || !used?.data?.length || !neu?.data?.length) {
      if (oneLiner) oneLiner.textContent = "CPI data unavailable — check data/fred-series.json.";
      return;
    }
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - YEARS_LOOKBACK);
    const build = (series) =>
      series.data
        .filter((p) => new Date(p.date) >= cutoff)
        .map((p) => {
          const y = yoyFromSeries(series, p.date);
          return y ? { x: p.date, y: y.pct } : null;
        })
        .filter(Boolean);

    new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          { label: "CPI used cars & trucks — YoY %", data: build(used), borderColor: "#c0562b", backgroundColor: "#c0562b", borderWidth: 2, pointRadius: 0, tension: 0.15 },
          { label: "CPI new vehicles — YoY %", data: build(neu), borderColor: "#1f5c8b", backgroundColor: "#1f5c8b", borderWidth: 2, pointRadius: 0, tension: 0.15 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { type: "time", time: { unit: "quarter" }, ticks: { color: axisColor() }, grid: { color: gridColor() } },
          y: {
            ticks: { color: axisColor(), callback: (v) => `${fmtNum(v, 0)}%` },
            grid: { color: (c) => (c.tick && c.tick.value === 0 ? axisColor() : gridColor()) },
            title: { display: true, text: "Year-over-year % change", color: axisColor() },
          },
        },
        plugins: {
          legend: { position: "bottom", labels: { color: axisColor(), boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { title: (items) => fmtDate(items[0].parsed.x), label: (item) => `${item.dataset.label}: ${fmtSigned(item.parsed.y, 1)}` } },
        },
      },
    });

    const lu = used.data[used.data.length - 1];
    const ln = neu.data[neu.data.length - 1];
    const yu = yoyFromSeries(used, lu.date);
    const yn = yoyFromSeries(neu, ln.date);
    if (oneLiner && yu && yn) {
      const gap = yn.pct - yu.pct;
      oneLiner.textContent = `Latest (${fmtDate(lu.date)}): used cars & trucks CPI ${fmtSigned(yu.pct)} YoY vs new vehicles ${fmtSigned(yn.pct)} YoY — used is running ${fmtNum(Math.abs(gap), 1)} pts ${gap >= 0 ? "below" : "above"} new.`;
    }
  }

  function chartBase(extraScales) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: extraScales,
      plugins: { legend: { position: "bottom", labels: { color: axisColor(), boxWidth: 12, font: { size: 10 } } } },
    };
  }

  function renderUsedMarket(containerEl, seriesObj) {
    const oneLiner = document.getElementById("sec6-oneliner");
    if (!seriesObj?.data?.length) {
      containerEl.innerHTML = emptyStateHTML("Used-market series", seriesObj?.source_guidance ?? "", null);
      return;
    }
    const rows = seriesObj.data.slice();
    const labels = rows.map((r) => monthLabel(r.month));
    const spreads = rows.map(spreadOf);

    const c1 = document.getElementById("chart-spread");
    if (c1) {
      new Chart(c1, {
        data: {
          labels,
          datasets: [
            { type: "bar", label: "Spread (retail YoY − wholesale YoY, pts)", data: spreads, backgroundColor: isDarkMode() ? "rgba(224,176,79,0.55)" : "rgba(138,90,0,0.35)", order: 3 },
            { type: "line", label: "Retail listing price YoY % (Cox/vAuto)", data: rows.map((r) => r.retail_listing_yoy_pct), borderColor: "#c0562b", backgroundColor: "#c0562b", borderWidth: 2, pointRadius: 3, tension: 0.1, spanGaps: false, order: 1 },
            { type: "line", label: "Wholesale MUVVI YoY % (Manheim)", data: rows.map((r) => r.muvvi_yoy_pct), borderColor: "#1f5c8b", backgroundColor: "#1f5c8b", borderWidth: 2, pointRadius: 3, tension: 0.1, order: 2 },
          ],
        },
        options: {
          ...chartBase({
            x: { ticks: { color: axisColor(), font: { size: 10 } }, grid: { color: gridColor() } },
            y: { ticks: { color: axisColor(), font: { size: 10 }, callback: (v) => `${fmtNum(v, 0)}` }, grid: { color: (c) => (c.tick && c.tick.value === 0 ? axisColor() : gridColor()) } },
          }),
        },
      });
    }

    const c2 = document.getElementById("chart-dayssupply");
    if (c2) {
      new Chart(c2, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "Retail days' supply (Cox/vAuto)", data: rows.map((r) => r.retail_days_supply), borderColor: "#c0562b", backgroundColor: "#c0562b", borderWidth: 2, pointRadius: 3, tension: 0.1, spanGaps: false },
            { label: "Wholesale days' supply (Manheim)", data: rows.map((r) => r.wholesale_days_supply), borderColor: "#1f5c8b", backgroundColor: "#1f5c8b", borderWidth: 2, pointRadius: 3, tension: 0.1 },
          ],
        },
        options: {
          ...chartBase({
            x: { ticks: { color: axisColor(), font: { size: 10 } }, grid: { color: gridColor() } },
            y: { beginAtZero: true, ticks: { color: axisColor(), font: { size: 10 } }, grid: { color: gridColor() } },
          }),
        },
      });
    }

    const full = rows.filter((r) => /^\d{4}-\d{2}$/.test(r.month));
    const last = full[full.length - 1];
    const prev = full[full.length - 2];
    const apr = full.find((r) => r.month === "2026-04");
    const partial = rows.find((r) => !/^\d{4}-\d{2}$/.test(r.month));
    if (oneLiner && last) {
      const sp = spreadOf(last);
      const spApr = apr ? spreadOf(apr) : null;
      oneLiner.textContent =
        `${monthLabel(last.month)} 2026: retail listing prices ${fmtSigned(last.retail_listing_yoy_pct, 0)} YoY vs wholesale (MUVVI) ${fmtSigned(last.muvvi_yoy_pct)} YoY → spread ${fmtSigned(sp, 1, " pts")}` +
        `${spApr !== null ? ` (April: ${fmtSigned(spApr, 1, " pts")})` : ""}. ` +
        `Days' supply: retail ${last.retail_days_supply}${prev ? ` (${monthLabel(prev.month)} ${prev.retail_days_supply})` : ""}, wholesale ${fmtNum(last.wholesale_days_supply, 1)}${prev ? ` (${monthLabel(prev.month)} ${fmtNum(prev.wholesale_days_supply, 1)})` : ""}.` +
        `${partial ? ` Early October: MUVVI ${fmtSigned(partial.muvvi_yoy_pct)} YoY, wholesale days' supply ${fmtNum(partial.wholesale_days_supply, 1)}.` : ""}`;
    }

    const body = rows
      .slice()
      .reverse()
      .map((r) => {
        const sp = spreadOf(r);
        const manUrl = (r.source.match(/https?:\/\/[^\s)]+/g) || [])[0];
        const retUrl = (r.source.match(/https?:\/\/[^\s)]+/g) || [])[1];
        const srcCell = [manUrl ? `<a href="${manUrl}" target="_blank" rel="noopener">📎 Manheim</a>` : "", retUrl ? `<a href="${retUrl}" target="_blank" rel="noopener">📎 Cox</a>` : ""].filter(Boolean).join("<br>");
        return `<tr>
          <td style="white-space:nowrap">${escapeHTML(r.month.length > 7 ? "2026-10 (1–15)" : r.month)}</td>
          <td class="num">${fmtNum(r.muvvi_index, 1)}<span class="sub">${fmtSigned(r.muvvi_yoy_pct)} YoY</span></td>
          <td class="num">${r.wholesale_days_supply === null ? "—" : fmtNum(r.wholesale_days_supply, 1)}</td>
          <td class="num">${r.retail_avg_listing_price === null ? "—" : "$" + fmtNum(r.retail_avg_listing_price, 0)}<span class="sub">${r.retail_listing_yoy_pct === null ? "YoY n/a" : fmtSigned(r.retail_listing_yoy_pct, 0) + " YoY"}</span></td>
          <td class="num">${r.retail_days_supply === null ? "—" : r.retail_days_supply}</td>
          <td class="num">${r.retail_sales_pace_yoy_pct === null ? "—" : fmtSigned(r.retail_sales_pace_yoy_pct)}</td>
          <td class="num"><strong>${sp === null ? "—" : fmtSigned(sp, 1, "")}</strong></td>
          <td>${srcCell}</td>
        </tr>`;
      })
      .join("");

    const notes = rows
      .slice()
      .reverse()
      .map((r) => `<p style="margin:4px 0;"><strong>${escapeHTML(r.month)}</strong> — ${escapeHTML(r.note)}</p>`)
      .join("");

    containerEl.innerHTML = `
      <div class="table-scroll">
        <table class="data-table compact">
          <thead><tr>
            <th>Month</th><th class="num">Wholesale MUVVI</th><th class="num">Whsl days' supply</th>
            <th class="num">Retail avg listing</th><th class="num">Retail days' supply</th>
            <th class="num">Retail pace YoY</th><th class="num">Spread (pts)</th><th>Source</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${(() => {
        const di = dueInfo(seriesObj.maintenance);
        if (!di) return "";
        return `<p class="table-note ${di.overdue ? "overdue-note" : ""}">Hand-entered from Cox Automotive · last updated ${escapeHTML(seriesObj.last_updated ?? "—")} · ${di.overdue ? "OVERDUE — " : ""}next monthly update due ${escapeHTML(di.date)} (${di.overdue ? `${-di.days} days ago` : `in ${di.days} days`})</p>`;
      })()}
      ${disclosure("definitions &amp; update notes", `<p class="table-note">Spread = retail listing price YoY % minus MUVVI YoY % (computed here; Cox rounds listing-price YoY to whole percents, so ±0.5 pt). MUVVI is a mix/mileage/seasonally adjusted index (Jan 1997 = 100). Values are as first reported; Cox revises prior months. Hand-entered monthly from Cox Automotive — last updated ${escapeHTML(seriesObj.last_updated ?? "—")}.</p>${seriesObj.maintenance?.next_due_what ? `<p class="table-note">Next update: ${escapeHTML(seriesObj.maintenance.next_due_what)}</p>` : ""}`)}
      ${disclosure("notes by month (revisions &amp; caveats)", notes)}
    `;
  }

  function renderGpiUsed(containerEl, seriesObj, usedMkt) {
    const oneLiner = document.getElementById("sec8-oneliner");
    if (!seriesObj?.data?.length) {
      containerEl.innerHTML = emptyStateHTML("GPI used-vehicle series", seriesObj?.source_guidance ?? "", null);
      return;
    }
    const rows = seriesObj.data.slice().sort((a, b) => b.quarter.localeCompare(a.quarter));
    const latest = rows[0];
    const yearAgo = rows.find((r) => r.quarter === `${parseInt(latest.quarter.slice(0, 4), 10) - 1}Q${latest.quarter.slice(5)}`);
    const nextQ = (() => {
      const y = parseInt(latest.quarter.slice(0, 4), 10);
      const q = parseInt(latest.quarter.slice(5), 10);
      return q === 4 ? `${y + 1}Q1` : `${y}Q${q + 1}`;
    })();
    const pendingMonths = usedMonthsFor(usedMkt, nextQ);
    const pendingComp = rows.find((r) => r.quarter === `${parseInt(nextQ.slice(0, 4), 10) - 1}Q${nextQ.slice(5)}`);

    const cls = (v) => (v === null || v === undefined ? "" : v < 0 ? "neg" : v > 0 ? "pos" : "");
    const cell = (val, yoy, fmtVal) =>
      `${fmtVal(val)}<span class="sub ${cls(yoy)}">${yoy === null || yoy === undefined ? "" : fmtSigned(yoy) + " YoY"}</span>`;
    const units = (v) => fmtNum(v, 0);
    const gpu = (v) => "$" + fmtNum(v, 0);

    const mktPace = (q) => {
      const m = usedMonthsFor(usedMkt, q);
      return m.length === 3 ? avgOf(m, "retail_sales_pace_yoy_pct") : null;
    };

    let pendingRow = "";
    if (pendingMonths.length === 3 && pendingComp) {
      const pace = avgOf(pendingMonths, "retail_sales_pace_yoy_pct");
      const muv = avgOf(pendingMonths, "muvvi_yoy_pct");
      const lastM = pendingMonths[pendingMonths.length - 1];
      pendingRow = `<tr class="pending-row">
        <td><strong>${nextQ}</strong><span class="sub">reports Oct 28</span></td>
        <td class="num" colspan="2">awaiting GPI release<span class="sub">comp: ${units(pendingComp.us_retail_units)} units, ${gpu(pendingComp.us_retail_gpu)} GPU</span></td>
        <td class="num">awaiting<span class="sub">comp: ${pendingComp.us_days_supply}</span></td>
        <td class="num" colspan="2">awaiting GPI release<span class="sub">comp: ${gpu(pendingComp.ss_retail_gpu)} GPU</span></td>
        <td class="num">—</td>
        <td class="num">${fmtSigned(pace)}<span class="sub">MUVVI qtr avg ${fmtSigned(muv)} YoY · Sep retail days' supply ${lastM.retail_days_supply}</span></td>
        <td></td>
      </tr>`;
    }

    const body = rows
      .map((r) => {
        const usedRevShare = (r.used_rev_musd / r.total_rev_musd) * 100;
        const usedGpShare = (r.used_gp_musd / r.total_gp_musd) * 100;
        const pace = mktPace(r.quarter);
        const url = (r.source.match(/https?:\/\/[^\s)]+/g) || [])[0];
        return `<tr>
          <td style="white-space:nowrap"><strong>${r.quarter}</strong></td>
          <td class="num">${cell(r.us_retail_units, r.us_units_yoy_pct, units)}</td>
          <td class="num">${cell(r.us_retail_gpu, r.us_gpu_yoy_pct, gpu)}</td>
          <td class="num">${r.us_days_supply}<span class="sub">cons. ${r.cons_days_supply}</span></td>
          <td class="num">${cell(r.ss_retail_units, r.ss_units_yoy_pct, units)}</td>
          <td class="num">${cell(r.ss_retail_gpu, r.ss_gpu_yoy_pct, gpu)}</td>
          <td class="num">${fmtNum(usedRevShare, 1)}% rev<span class="sub">${fmtNum(usedGpShare, 1)}% of gross profit</span></td>
          <td class="num">${pace === null ? "—" : fmtSigned(pace)}</td>
          <td>${url ? `<a href="${url}" target="_blank" rel="noopener">📎 8-K Ex. 99.1</a>` : ""}</td>
        </tr>`;
      })
      .join("");

    const notes = rows.map((r) => `<p style="margin:4px 0;"><strong>${r.quarter}</strong> — ${linkify(r.note)}</p>`).join("");

    if (oneLiner) {
      oneLiner.textContent =
        `Latest (${latest.quarter}): same-store used retail units ${fmtSigned(latest.ss_units_yoy_pct)} YoY; U.S. used retail GPU ${gpu(latest.us_retail_gpu)} (${fmtSigned(latest.us_gpu_yoy_pct)}); U.S. days' supply ${latest.us_days_supply}. ` +
        (pendingComp ? `Q3 2026 results are scheduled for Oct 28 — year-ago comps: U.S. used retail units ${units(pendingComp.us_retail_units)}, U.S. used retail GPU ${gpu(pendingComp.us_retail_gpu)}, consolidated same-store GPU ${gpu(pendingComp.ss_retail_gpu)}, U.S. days' supply ${pendingComp.us_days_supply}.` : "");
    }

    containerEl.innerHTML = `
      <div class="table-scroll">
        <table class="data-table compact">
          <thead><tr>
            <th>Quarter</th><th class="num">U.S. used units</th><th class="num">U.S. used GPU</th>
            <th class="num">U.S. days' supply</th><th class="num">Same-store used units</th>
            <th class="num">Same-store used GPU</th><th class="num">Used % of rev / GP</th>
            <th class="num">Mkt retail pace</th><th>Source</th>
          </tr></thead>
          <tbody>${pendingRow}${body}</tbody>
        </table>
      </div>
      <p class="table-note">Hand-entered from GPI 8-K Exhibit 99.1 · last updated ${escapeHTML(seriesObj.last_updated ?? "—")}</p>
      ${disclosure("definitions &amp; methodology", `<p class="table-note">U.S. = reported retail units and GPU at period; days' supply is quarter-end (consolidated in grey beneath). "Same-store" = GPI's non-GAAP comparable-dealership metric, consolidated U.S.+U.K. Mkt retail pace = Cox's retail used unit sales pace YoY. Used share = total used (retail + wholesale) ÷ consolidated total, computed here from the dollar figures in each release. Market pace = simple average of Cox's three monthly YoY readings (Section 6) — not unit-weighted. Hand-entered from GPI 8-K Exhibit 99.1; last updated ${escapeHTML(seriesObj.last_updated ?? "—")}.</p>`)}
      ${disclosure("notes by quarter (call commentary &amp; caveats)", notes)}
    `;
  }

  function renderExecSummary(fredData, manualData) {
    const el = document.getElementById("exec-summary-body");
    if (!el) return;
    try {
      const rs = manualData?.real_series ?? {};
      const tn = manualData?.tracked_notes ?? {};
      const series = fredData?.series ?? {};
      const parts = [];

      // 1. New-vehicle same-store trend
      const sssPts = (rs.gpi_new_vehicle_sss?.data ?? []).slice().sort((a, b) => a.period.localeCompare(b.period));
      const newLatest = sssPts[sssPts.length - 1];
      if (sssPts.length >= 2) {
        const prev = sssPts[sssPts.length - 2];
        const direction = Math.abs(newLatest.value) < Math.abs(prev.value) ? "narrowed" : Math.abs(newLatest.value) > Math.abs(prev.value) ? "widened" : "held steady";
        parts.push(`GPI's same-store new-vehicle unit decline ${direction} from ${fmtNum(prev.value, 1)}% YoY in ${prev.period} to ${fmtNum(newLatest.value, 1)}% in ${newLatest.period} (the tracker carries no peer same-store series, so this is GPI's own trajectory, not a peer-relative gap).`);
      }

      // 2. Used — where the shortfall sat
      const usedRows = (rs.gpi_used_vehicle?.data ?? []).slice().sort((a, b) => a.quarter.localeCompare(b.quarter));
      const uL = usedRows[usedRows.length - 1];
      const mkt = rs.used_market_monthly?.data ?? [];
      if (uL) {
        const revShare = (uL.used_rev_musd / uL.total_rev_musd) * 100;
        const gpShare = (uL.used_gp_musd / uL.total_gp_musd) * 100;
        const qMonths = usedMonthsFor(rs.used_market_monthly, uL.quarter);
        const pace = qMonths.length === 3 ? avgOf(qMonths, "retail_sales_pace_yoy_pct") : null;
        let s = `Used is where the ${uL.quarter} shortfall was concentrated: same-store used retail units were ${fmtSigned(uL.ss_units_yoy_pct)} YoY${newLatest ? ` vs ${fmtSigned(newLatest.value)} for new` : ""}, U.S. used retail GPU was $${fmtNum(uL.us_retail_gpu, 0)} (${fmtSigned(uL.us_gpu_yoy_pct)}), and used is ${fmtNum(revShare, 0)}% of revenue but only ${fmtNum(gpShare, 0)}% of gross profit.`;
        if (pace !== null) s += ` The market was softer too (Cox retail used sales pace averaged ${fmtSigned(pace)} YoY over the quarter), but GPI trailed it by ~${fmtNum(Math.abs(uL.ss_units_yoy_pct - pace), 0)} pts, pointing at sourcing/execution rather than demand alone.`;
        const fullM = mkt.filter((r) => /^\d{4}-\d{2}$/.test(r.month));
        const m = fullM[fullM.length - 1];
        const mPrev = fullM[fullM.length - 2];
        if (m && spreadOf(m) !== null) {
          s += ` Heading into the Q3 print: ${monthLabel(m.month)} wholesale (MUVVI) was ${fmtSigned(m.muvvi_yoy_pct)} YoY against retail listing prices ${fmtSigned(m.retail_listing_yoy_pct, 0)}, a ${fmtNum(spreadOf(m), 1)}-pt spread, but retail days' supply rose to ${m.retail_days_supply}${mPrev ? ` from ${mPrev.retail_days_supply}` : ""}.`;
        }
        parts.push(s);
      }

      // 3. Leverage
      const lev = tn.leverage_trajectory;
      parts.push(lev?.status ? `Leverage stood at ${lev.status}.` : "Leverage data isn't yet populated in the tracker.");

      // 4. Trucks: SAAR, OEM, affordability
      const dl = series.DLTRUCKSSAAR;
      const fl = series.FLTRUCKSSAAR;
      const al = series.ALTSALES;
      const loanData = series.TERMCBAUTO48NS?.data;
      const gasData = series.GASREGW?.data;
      const txurData = series.TXUR?.data;
      if (dl?.data?.length && fl?.data?.length && al?.data?.length) {
        const date = dl.data[dl.data.length - 1].date;
        const yd = yoyFromSeries(dl, date);
        const yf = yoyFromSeries(fl, date);
        const ya = yoyFromSeries(al, date);
        let s = "";
        if (yd && yf && ya) {
          s += `On trucks, domestic light-truck SAAR was ${fmtNum(yd.value, 2)}M in ${fmtDate(date)} (${fmtSigned(yd.pct)} YoY) while imported trucks were ${fmtSigned(yf.pct)} and total light-vehicle SAAR ${fmtSigned(ya.pct)} (Section 1)`;
        }
        const oem = rs.oem_truck_deliveries?.data ?? [];
        const fordRows = oem.filter((r) => r.oem === "Ford").sort((a, b) => b.quarter.localeCompare(a.quarter));
        const fseries = oem.filter((r) => r.oem === "Ford - F-Series").sort((a, b) => b.quarter.localeCompare(a.quarter));
        if (fordRows.length >= 2 && fordRows[0].yoy_pct !== null && fordRows[1].yoy_pct !== null) {
          const fs = fseries.find((r) => r.quarter === fordRows[0].quarter);
          s += `${s ? "; " : "On trucks, "}Ford's ${fordRows[0].quarter} truck sales were ${fmtSigned(fordRows[0].yoy_pct)} YoY${fs ? ` (F-Series ${fmtSigned(fs.yoy_pct)})` : ""} vs ${fmtSigned(fordRows[1].yoy_pct)} in ${fordRows[1].quarter} (Section 4)`;
        }
        if (loanData?.length && gasData?.length && txurData?.length) {
          s += `; financing and fuel remain headwinds GPI management has cited — 48-month auto loan rate ${fmtNum(loanData[loanData.length - 1].value, 2)}%, gas $${fmtNum(gasData[gasData.length - 1].value, 2)}/gal, Texas unemployment ${fmtNum(txurData[txurData.length - 1].value, 1)}% (Section 2)`;
        }
        if (s) parts.push(s + ".");
      }

      el.textContent = parts.join(" ");
    } catch (e) {
      console.error(e);
      el.textContent = "Could not compute executive summary from current data.";
    }
  }

  function dueInfo(maint) {
    if (!maint || !maint.next_due) return null;
    const due = new Date(`${maint.next_due}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) return null;
    const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
    return { date: maint.next_due, days, overdue: days < 0, soon: days >= 0 && days <= 7 };
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
      ${(() => {
        const di = dueInfo(rs.used_market_monthly?.maintenance);
        if (!di) return "";
        const flag = di.overdue ? `<span class="due-flag overdue">OVERDUE by ${-di.days}d</span>` : di.soon ? `<span class="due-flag soon">due in ${di.days}d</span>` : `<span class="due-flag">in ${di.days}d</span>`;
        return `<span class="freshness-item"><span class="dot" style="background:var(--real)"></span>Section 6 (used market) next update due: <strong>${escapeHTML(di.date)}</strong> ${flag}</span>`;
      })()}
    `;
  }

  async function init() {
    let fredData = null;
    try {
      fredData = await loadJSON("data/fred-series.json");
      renderSAARChart(fredData);
      renderDemandBackdrop(fredData);
      renderCPIChart(fredData);
    } catch (e) {
      console.error(e);
      ["sec1-oneliner", "sec2-oneliner", "sec3-oneliner"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "Could not load live FRED data.";
      });
    }

    let manual = null;
    try {
      manual = await loadJSON("data/manual-data.json");
      const rs = manual.real_series || {};
      const tn = manual.tracked_notes || {};

      renderOemTable(document.getElementById("content-oem"), rs.oem_truck_deliveries);
      renderRealTable(document.getElementById("content-atp"), rs.truck_atp, ["Period", "ATP ($)"]);
      renderUsedMarket(document.getElementById("content-used-mkt"), rs.used_market_monthly);

      const sss = document.getElementById("content-gpi-sss");
      renderRealTable(sss, rs.gpi_new_vehicle_sss, ["Period", "SSS % YoY"]);
      const tx = document.createElement("div");
      sss.appendChild(tx);
      renderRealTable(tx, rs.gpi_texas_new_unit_growth, ["Period", "Texas Growth % YoY"]);

      renderGpiUsed(document.getElementById("content-gpi-used"), rs.gpi_used_vehicle, rs.used_market_monthly);

      renderTrackedCard(document.getElementById("content-rebrand"), tn.rebranding_seo);
      renderTrackedCard(document.getElementById("content-valuline"), tn.val_u_line);
      renderTrackedCard(document.getElementById("content-disposal"), tn.dealership_disposal);
      renderTrackedCard(document.getElementById("content-leverage"), tn.leverage_trajectory);

      renderRealTable(document.getElementById("content-ps"), rs.gpi_ps_growth, ["Period", "P&S Customer-Pay SSS % YoY"]);
    } catch (e) {
      console.error(e);
    }

    renderFreshnessBar(fredData, manual);
    renderExecSummary(fredData, manual);

    const setAll = (open) => document.querySelectorAll("details.disclosure").forEach((d) => (d.open = open));
    document.getElementById("expand-all")?.addEventListener("click", () => setAll(true));
    document.getElementById("collapse-all")?.addEventListener("click", () => setAll(false));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
