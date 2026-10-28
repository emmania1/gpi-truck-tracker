(function () {
  const esc = (s) => {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  };
  const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (v, d = 1, suf = "%") => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${fmt(v, d)}${suf}`);
  const dark = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const axis = () => (dark() ? "#9b9a94" : "#6b6a64");
  const grid = () => (dark() ? "#33353a" : "#e1e0db");

  async function loadJSON(p) {
    const r = await fetch(p, { cache: "no-store" });
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  }

  function disclosure(what, body) {
    return `<details class="disclosure"><summary><span class="lbl-closed">Show ${what}</span><span class="lbl-open">Hide ${what}</span></summary><div class="disclosure-body">${body}</div></details>`;
  }

  const MODE = {
    "levels-0": "level vs level, same quarter",
    "levels-1": "level vs level, indicator 1Q earlier",
    "changes-0": "change vs change, same quarter",
    "changes-1": "change vs change, indicator 1Q earlier",
  };
  const VERDICT_CLASS = { "holds up": "verdict-ok", "likely trend artefact": "relayed", "not significant": "", "too few observations": "relayed" };

  function badge(text, cls) {
    return `<span class="src-badge ${cls || ""}">${esc(text)}</span>`;
  }

  function isDollar(label) {
    return /\$/.test(label);
  }

  function renderMeta(d) {
    document.getElementById("bt-meta").innerHTML =
      `<span class="freshness-item">Computed <strong>${esc(d.generated_at)}</strong></span>` +
      `<span class="freshness-item"><strong>${d.window.n_quarters}</strong> quarters of GPI results (${esc(d.window.target_quarters[0])}–${esc(d.window.target_quarters[1])})</span>` +
      `<span class="freshness-item"><strong>${d.tests.total}</strong> indicator × result × lag correlations tested</span>`;
  }

  function renderBottom(d) {
    const n = d.narrative;
    const items = n.q3_reads
      .map((r) => {
        const dol = isDollar(r.metric);
        const est = dol ? `$${fmt(r.estimate, 2)}` : sg(r.estimate);
        return `<li><strong>${esc(r.metric)}:</strong> ${esc(r.lean)} (estimate ${est}; confidence: ${esc(r.confidence)}).</li>`;
      })
      .join("");
    document.getElementById("bt-bottom-body").innerHTML = `<p class="exec-lead">${esc(n.bottom_line)}</p><ul class="exec-list">${items}</ul>`;
  }

  function renderReads(d) {
    const html = d.narrative.q3_reads
      .map((r) => {
        const dol = isDollar(r.metric);
        const f = (v) => (v === null || v === undefined ? "—" : dol ? `$${fmt(v, 2)}` : sg(v));
        const range = r.range ? `${f(r.range[0])} to ${f(r.range[1])}` : "—";
        return `<div class="real-datapoint">
          <div class="real-datapoint-head"><span class="real-datapoint-period">${esc(r.metric)}</span></div>
          <div class="oem-fields">
            <span class="oem-field"><span class="oem-field-label">Q2 2026 actual</span>${f(r.last)}</span>
            <span class="oem-field"><span class="oem-field-label">Q3 estimate</span>${f(r.estimate)}</span>
            <span class="oem-field"><span class="oem-field-label">Range</span>${range}</span>
            <span class="oem-field"><span class="oem-field-label">Confidence</span>${esc(r.confidence)}</span>
          </div>
          <div class="real-datapoint-headline">Lean: ${esc(r.lean)}</div>
          ${disclosure("basis for this estimate", `<div class="real-datapoint-note">${esc(r.basis)}</div>`)}
        </div>`;
      })
      .join("");
    document.getElementById("bt-reads").innerHTML = html;

    const ec = d.prediction.eps_context;
    const rows = ec.recent_surprises
      .map((s) => `<tr><td>${esc(s.quarter)}</td><td class="num">$${fmt(s.consensus_eps, 2)}</td><td class="num">${sg(s.surprise_pct)}</td><td>${esc(s.vendor)}</td></tr>`)
      .join("");
    const st = ec.street_estimate;
    document.getElementById("bt-eps").innerHTML = disclosure(
      "Street context: Q3 estimate and GPI's recent EPS surprises (vendor data)",
      `<p class="table-note">Q3 2026 vendor consensus: <strong>$${fmt(st.fxempire_eps, 2)}</strong> (FXEmpire, ${st.fxempire_analysts} analysts) to <strong>$${fmt(st.benzinga_eps, 2)}</strong> (Benzinga) — implied YoY ${sg(ec.street_implied_yoy_pct.fxempire_eps)} to ${sg(ec.street_implied_yoy_pct.benzinga_eps)} vs Q3'25's $${fmt(ec.q3_2025_eps, 2)}. Missed consensus in ${ec.misses_in_last_6} of the last ${ec.n_surprises} quarters collected. Secondary sources; vendors disagree on both the estimate and the EPS definition.</p>
       <div class="table-scroll"><table class="data-table compact"><thead><tr><th>Quarter</th><th class="num">Consensus</th><th class="num">Surprise</th><th>Vendor / note</th></tr></thead><tbody>${rows}</tbody></table></div>`
    );
  }

  function renderLog(log) {
    const el = document.getElementById("bt-log");
    if (!log.forecasts || !log.forecasts.length) {
      el.innerHTML = `<div class="empty-state">No frozen forecast yet.</div>`;
      return;
    }
    el.innerHTML = log.forecasts
      .map((f) => {
        const body = f.metrics
          .map((m) => {
            const dol = m.metric === "adj_eps";
            const ff = (v) => (v === null || v === undefined ? "—" : dol ? `$${fmt(v, 2)}` : sg(v));
            const range = m.range_low !== null && m.range_low !== undefined ? `${ff(m.range_low)} to ${ff(m.range_high)}` : "—";
            const hasA = m.actual !== null && m.actual !== undefined;
            const err = hasA ? (dol ? `${m.actual - m.predicted >= 0 ? "+" : ""}$${fmt(m.actual - m.predicted, 2)}` : sg(m.actual - m.predicted, 1, " pts")) : "—";
            return `<tr><td>${esc(m.label)}</td><td class="num"><strong>${ff(m.predicted)}</strong></td><td class="num">${range}</td><td>${esc(m.method)}</td><td class="num">${hasA ? `<strong>${ff(m.actual)}</strong>` : '<span class="sub">awaiting release</span>'}</td><td class="num">${err}</td></tr>`;
          })
          .join("");
        return `<p class="table-note"><strong>${esc(f.quarter)}</strong> — frozen ${esc(f.frozen_at)} · release ${esc(f.release_date)} · status: <strong>${esc(f.status)}</strong></p>
          <div class="table-scroll"><table class="data-table compact"><thead><tr><th>Metric</th><th class="num">Predicted</th><th class="num">Range</th><th>Method</th><th class="num">Actual</th><th class="num">Actual − predicted</th></tr></thead><tbody>${body}</tbody></table></div>
          <p class="table-note">${esc(f.note)}</p>`;
      })
      .join("");
  }

  function renderFindings(d) {
    const t = d.tests;
    document.getElementById("bt-tests-line").textContent =
      `${t.total} correlations tested; ${t.nominal_p05} are nominally significant at 5% (chance alone would give ~${fmt(t.expected_by_chance_at_5pct, 0)}); ${t.nominal_p05_after_autocorr_adjust} remain after the autocorrelation adjustment; ${t.survive_bonferroni} survive a strict multiple-testing correction (α = ${t.bonferroni_alpha}).`;
    const cls = { supported: "verdict-ok", "not supported": "secondary", caution: "relayed", limited: "" };
    const lbl = { supported: "Supported", "not supported": "Not supported", caution: "Caution", limited: "Limited data" };
    document.getElementById("bt-findings").innerHTML = d.narrative.findings
      .map(
        (f) => `<div class="real-datapoint"><div class="real-datapoint-head"><span class="real-datapoint-period">${esc(f.title)}</span></div>
          <div>${badge(lbl[f.strength] || f.strength, cls[f.strength])}</div>
          <div class="real-datapoint-note">${esc(f.text)}</div></div>`
      )
      .join("");
  }

  function renderScatter(d) {
    const s = d.scatter;
    const ctx = document.getElementById("bt-scatter");
    if (!ctx || !s) return;
    const xs = s.points.map((p) => p.x);
    const xmin = Math.min(...xs, s.nowcast.x) - 0.5;
    const xmax = Math.max(...xs, s.nowcast.x) + 0.5;
    new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          { label: "GPI quarters (2023Q3–2026Q2)", data: s.points.map((p) => ({ x: p.x, y: p.y, q: p.q })), backgroundColor: "#1f5c8b", pointRadius: 4 },
          { label: "Fitted line", type: "line", data: [{ x: xmin, y: s.fit.b0 + s.fit.b1 * xmin }, { x: xmax, y: s.fit.b0 + s.fit.b1 * xmax }], borderColor: "#c0562b", borderWidth: 2, pointRadius: 0 },
          { label: "2026Q3 nowcast", data: [{ x: s.nowcast.x, y: s.nowcast.y, q: s.nowcast.q }], backgroundColor: "#c0562b", pointStyle: "rectRot", pointRadius: 8 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { title: { display: true, text: s.x_label, color: axis(), font: { size: 10 } }, ticks: { color: axis(), font: { size: 10 } }, grid: { color: grid() } },
          y: { title: { display: true, text: s.y_label, color: axis(), font: { size: 10 } }, ticks: { color: axis(), font: { size: 10 } }, grid: { color: grid() } },
        },
        plugins: {
          legend: { position: "bottom", labels: { color: axis(), boxWidth: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: (i) => `${i.raw.q ?? ""}: SAAR ${sg(i.parsed.x)}, units ${sg(i.parsed.y)}` } },
        },
      },
    });
    document.getElementById("bt-scatter-note").innerHTML =
      `<strong>Reading the chart:</strong> each dot is one quarter. GPI's same-store new-unit growth rises roughly ${fmt(s.fit.b1, 2)} pts for every 1 pt of total SAAR growth. Q3 2026 SAAR is already known (${sg(s.nowcast.x)} YoY), which puts the nowcast at ${sg(s.nowcast.y)} — close to the line, but this is a same-quarter relationship, so it describes the quarter rather than leading it.`;
  }

  function renderCorr(d) {
    const out = [];
    for (const [t, label] of Object.entries(d.targets)) {
      const rows = (d.by_target[t] || [])
        .map((r) => {
          const fl = d.feature_meta[r.feature]?.label || r.feature;
          return `<tr><td>${esc(fl)}</td><td>${esc(MODE[`${r.mode}-${r.lag}`] || "")}</td><td class="num">${r.n}</td><td class="num"><strong>${sg(r.r, 2, "")}</strong><span class="sub">95% CI ${fmt(r.ci95[0], 2)} to ${fmt(r.ci95[1], 2)}</span></td><td class="num">${fmt(r.p, 3)}</td><td class="num">${r.p_neff === null ? "—" : fmt(r.p_neff, 3)}<span class="sub">n_eff ${fmt(r.n_eff, 1)}</span></td><td>${badge(r.verdict, VERDICT_CLASS[r.verdict])}</td></tr>`;
        })
        .join("");
      out.push(`<h3 class="bt-h3">${esc(label)}</h3><div class="table-scroll"><table class="data-table compact"><thead><tr><th>Indicator</th><th>Test</th><th class="num">n</th><th class="num">r</th><th class="num">p</th><th class="num">adj. p</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table></div>`);
    }
    document.getElementById("bt-corr").innerHTML = out.join("");
  }

  function renderLoo(d) {
    const rows = d.loo
      .map((x) => {
        const good = x.skill_vs_persistence > 0.15 && x.skill_vs_mean > 0.15;
        const hit = x.direction_hit_rate_model === null ? "—" : `${Math.round(x.direction_hit_rate_model * x.direction_calls)}/${x.direction_calls}`;
        const picks = Object.entries(x.indicator_picked_in_folds).map(([k, v]) => `${d.feature_meta[k]?.label || k} (${v})`).join("; ");
        return `<tr><td>${esc(d.targets[x.target])}</td><td>${x.lag === 0 ? "same quarter" : "1Q lead"}</td><td class="num">${x.n_eval}</td><td class="num">${fmt(x.rmse_model, 2)}</td><td class="num">${fmt(x.rmse_persistence, 2)}</td><td class="num">${fmt(x.rmse_mean, 2)}</td><td class="num">${sg(x.skill_vs_persistence * 100, 0)}</td><td class="num">${sg(x.skill_vs_mean * 100, 0)}</td><td class="num">${hit}</td><td>${good ? badge("clears the bar", "verdict-ok") : badge("no skill", "")}${disclosure("indicators picked", esc(picks))}</td></tr>`;
      })
      .join("");
    document.getElementById("bt-loo").innerHTML = `<div class="table-scroll"><table class="data-table compact"><thead><tr><th>Result</th><th>Model</th><th class="num">Quarters tested</th><th class="num">Model error (RMSE, pts)</th><th class="num">"Same as last qtr" error</th><th class="num">"Historical mean" error</th><th class="num">Skill vs last qtr (%)</th><th class="num">Skill vs mean (%)</th><th class="num">Direction right</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    document.getElementById("bt-rule").innerHTML = `<strong>Decision rule:</strong> ${esc(d.narrative.skill_rule)}`;
  }

  function renderAvail(d) {
    const rows = d.availability
      .map((a) => `<tr><td>${esc(a.label || a.feature)}</td><td style="white-space:nowrap">${esc(a.first)} → ${esc(a.last)}</td><td class="num">${a.n}</td><td>${esc(a.note)}</td></tr>`)
      .join("");
    document.getElementById("bt-avail").innerHTML = `<div class="table-scroll"><table class="data-table compact"><thead><tr><th>Indicator</th><th>Window</th><th class="num">Quarters / months</th><th>Source &amp; limits</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  async function init() {
    try {
      const [d, log] = await Promise.all([loadJSON("data/backtest.json"), loadJSON("data/forecast-log.json")]);
      renderMeta(d);
      renderBottom(d);
      renderReads(d);
      renderLog(log);
      renderFindings(d);
      renderScatter(d);
      renderCorr(d);
      renderLoo(d);
      renderAvail(d);
    } catch (e) {
      console.error(e);
      document.getElementById("bt-meta").textContent = "Could not load backtest data — check data/backtest.json.";
    }
    const setAll = (o) => document.querySelectorAll("details.disclosure").forEach((x) => (x.open = o));
    document.getElementById("expand-all")?.addEventListener("click", () => setAll(true));
    document.getElementById("collapse-all")?.addEventListener("click", () => setAll(false));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
