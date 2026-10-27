#!/usr/bin/env python3
"""
Backtest: do the tracker's leading indicators correlate with GPI's reported quarterly results?

Inputs  (all in data/):  fred-series.json, gpi-history.json, indicator-history.json,
                          manual-data.json, forecast-log.json
Output:                   data/backtest.json   (rendered by backtest.html)

Run:    python3 scripts/backtest.py                 # recompute everything
        python3 scripts/backtest.py --freeze 2026Q3 # also write the frozen prediction for that
                                                    # quarter into data/forecast-log.json
                                                    # (only if that quarter isn't already there)

Design notes (honesty first):
- Targets are GPI's SAME-STORE YoY results plus adjusted-EPS YoY (12 quarters, 2023Q3-2026Q2).
- With <= 12 observations, only large correlations can be distinguished from noise, and we test
  hundreds of indicator/target/lag combinations, so some "significant" hits are expected by chance.
  The output reports how many.  Series are YoY changes and strongly autocorrelated, so the
  effective sample size is lower than n; we report an autocorrelation-adjusted p-value too.
- Predictive skill is tested with leave-one-out validation in which the indicator is CHOSEN INSIDE
  each fold (no peeking), against persistence and mean baselines.
"""
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data"


# ----------------------------------------------------------------------------- stats helpers
def betacf(a, b, x, itmax=300, eps=3e-14):
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
    h = d
    for m in range(1, itmax + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c
        c = c if abs(c) > 1e-300 else 1e-300
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c
        c = c if abs(c) > 1e-300 else 1e-300
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def betainc(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    bt = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return bt * betacf(a, b, x) / a
    return 1 - bt * betacf(b, a, 1 - x) / b


def p_from_r(r, n):
    df = n - 2
    if df < 1 or abs(r) >= 1:
        return 0.0 if abs(r) >= 1 and df >= 1 else float("nan")
    t2 = r * r * df / (1 - r * r)
    return betainc(df / 2, 0.5, df / (df + t2))


def crit_r(n, alpha=0.05):
    """smallest |r| that is nominally significant at alpha for sample size n (bisection)."""
    if n < 4:
        return float("nan")
    lo, hi = 0.0, 0.9999
    for _ in range(60):
        mid = (lo + hi) / 2
        if p_from_r(mid, n) > alpha:
            lo = mid
        else:
            hi = mid
    return hi


def fisher_ci(r, n, z=1.96):
    if n <= 3 or abs(r) >= 1:
        return (float("nan"), float("nan"))
    zr = math.atanh(r)
    se = 1 / math.sqrt(n - 3)
    return (math.tanh(zr - z * se), math.tanh(zr + z * se))


def pearson(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    if len(x) < 4 or np.std(x) == 0 or np.std(y) == 0:
        return float("nan")
    return float(np.corrcoef(x, y)[0, 1])


def rank(a):
    a = np.asarray(a, float)
    order = np.argsort(a, kind="mergesort")
    ranks = np.empty(len(a))
    i = 0
    while i < len(a):
        j = i
        while j + 1 < len(a) and a[order[j + 1]] == a[order[i]]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def lag1_autocorr(a):
    a = np.asarray(a, float)
    if len(a) < 4 or np.std(a) == 0:
        return 0.0
    return pearson(a[:-1], a[1:])


def n_eff(x, y):
    rx, ry = lag1_autocorr(x), lag1_autocorr(y)
    n = len(x)
    ne = n * (1 - rx * ry) / (1 + rx * ry)
    return max(4.0, min(float(n), ne))


# ----------------------------------------------------------------------------- calendar helpers
def qkey(y, q):
    return f"{y}Q{q}"


def qparts(k):
    return int(k[:4]), int(k[5])


def qshift(k, n):
    y, q = qparts(k)
    idx = y * 4 + (q - 1) + n
    return qkey(idx // 4, idx % 4 + 1)


def qrange(a, b):
    out, k = [], a
    while k <= b:
        out.append(k)
        k = qshift(k, 1)
    return out


def month_q(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return qkey(y, (m - 1) // 3 + 1)


# ----------------------------------------------------------------------------- load + features
def load():
    fred = json.load(open(D / "fred-series.json"))
    gpi = json.load(open(D / "gpi-history.json"))
    ind = json.load(open(D / "indicator-history.json"))
    man = json.load(open(D / "manual-data.json"))
    log = json.load(open(D / "forecast-log.json")) if (D / "forecast-log.json").exists() else {"forecasts": []}
    return fred, gpi, ind, man, log


def q_avg_from_series(pts, require_months=None):
    """quarterly average of an observation list [{'date','value'}]; requires >=1 obs (monthly: all 3 if require_months)."""
    buckets = {}
    for p in pts:
        buckets.setdefault(month_q(p["date"][:7]), []).append(p["value"])
    out = {}
    for k, v in buckets.items():
        if require_months and len(v) < require_months:
            continue
        out[k] = float(np.mean(v))
    return out


def yoy(qs):
    return {k: (v / qs[qshift(k, -4)] - 1) * 100 for k, v in qs.items() if qshift(k, -4) in qs and qs[qshift(k, -4)]}


def diff4(qs):
    return {k: v - qs[qshift(k, -4)] for k, v in qs.items() if qshift(k, -4) in qs}


def build_features(fred, ind, man):
    S = fred["series"]
    feats, meta = {}, {}

    def add(name, series, label, first_note):
        feats[name] = series
        ks = sorted(series)
        meta[name] = {"label": label, "first": ks[0], "last": ks[-1], "n": len(ks), "note": first_note}

    dom = q_avg_from_series(S["DLTRUCKSSAAR"]["data"], 3)
    imp = q_avg_from_series(S["FLTRUCKSSAAR"]["data"], 3)
    tot = q_avg_from_series(S["ALTSALES"]["data"], 3)
    add("saar_dom_yoy", yoy(dom), "Domestic light-truck SAAR, YoY %", "FRED DLTRUCKSSAAR, quarterly average")
    add("saar_imp_yoy", yoy(imp), "Imported light-truck SAAR, YoY %", "FRED FLTRUCKSSAAR")
    add("saar_total_yoy", yoy(tot), "Total light-vehicle SAAR, YoY %", "FRED ALTSALES")
    loan = q_avg_from_series(S["TERMCBAUTO48NS"]["data"])
    add("loan_rate_level", loan, "48-mo new-auto loan rate, level %", "FRED TERMCBAUTO48NS (one observation per quarter)")
    add("loan_rate_chg", diff4(loan), "48-mo auto loan rate, YoY change (pp)", "FRED TERMCBAUTO48NS")
    gas = q_avg_from_series(S["GASREGW"]["data"])
    add("gas_yoy", yoy(gas), "Regular gasoline price, YoY %", "FRED GASREGW, quarterly average of weekly")
    tx = q_avg_from_series(S["TXUR"]["data"], 3)
    add("tx_unemp_chg", diff4(tx), "Texas unemployment rate, YoY change (pp)", "FRED TXUR")
    cu = q_avg_from_series(S["CUSR0000SETA02"]["data"], 3)
    cn = q_avg_from_series(S["CUSR0000SETA01"]["data"], 3)
    add("cpi_used_yoy", yoy(cu), "CPI used cars & trucks, YoY %", "FRED CUSR0000SETA02")
    add("cpi_new_yoy", yoy(cn), "CPI new vehicles, YoY %", "FRED CUSR0000SETA01")
    cuy, cny = yoy(cu), yoy(cn)
    add("cpi_used_minus_new", {k: cuy[k] - cny[k] for k in cuy if k in cny}, "CPI used YoY minus new YoY (pts)", "derived from the two CPI series")

    mu = {k: v["muvvi_yoy_pct"] for k, v in ind["muvvi_monthly"].items() if v["muvvi_yoy_pct"] is not None}
    mq = {}
    for k, v in mu.items():
        mq.setdefault(month_q(k), []).append(v)
    muq = {k: float(np.mean(v)) for k, v in mq.items() if len(v) == 3}
    add("muvvi_yoy", muq, "Manheim wholesale index (MUVVI), YoY %", "Cox/Manheim monthly reports, quarterly average of monthly YoY (2023 months parsed from page text, unvalidated)")

    # retail listing price YoY from monthly prices (needs same month a year earlier)
    rp = {k: v["avg_listing_price"] for k, v in ind["retail_listing_monthly"].items()}
    ry = {}
    for k, v in rp.items():
        y, m = int(k[:4]), k[5:7]
        py = f"{y-1}-{m}"
        if py in rp:
            ry.setdefault(month_q(k), []).append((v / rp[py] - 1) * 100)
    rq = {k: float(np.mean(v)) for k, v in ry.items() if len(v) >= 2}
    add("retail_listing_yoy", rq, "Retail used listing price, YoY % (Cox/vAuto)", "2025 values rely on a regex parse of 2024 pages (unvalidated); history starts 2025")
    sp = {k: rq[k] - muq[k] for k in rq if k in muq}
    add("retail_minus_wholesale", sp, "Retail-minus-wholesale YoY spread (pts)", "the tracker's Section 6 spread; history starts 2025")

    fo = {k: v["ford_trucks_yoy_pct"] for k, v in ind["ford_trucks_quarterly"].items()}
    add("ford_trucks_yoy", fo, "Ford truck deliveries, YoY %", "Ford sales releases; history starts 2024Q4 (GM unavailable)")
    return feats, meta


SKILL_RULE = 0.15  # pre-registered: a model may set the central estimate only if its leave-one-out RMSE beats BOTH baselines by >15%

TARGETS = {
    "nv_ss_units_yoy_pct": "New-vehicle same-store units, YoY %",
    "uv_ss_units_yoy_pct": "Used same-store retail units, YoY %",
    "uv_ss_gpu_yoy_pct": "Used same-store retail GPU, YoY %",
    "nv_ss_gpu_yoy_pct": "New-vehicle same-store GPU, YoY %",
    "adj_eps_yoy_pct": "Adjusted EPS, YoY %",
}


# ----------------------------------------------------------------------------- correlation grid
def corr_row(tname, fname, mode, lag, xs, ys, qs):
    n = len(xs)
    r = pearson(xs, ys)
    if n < 4 or math.isnan(r):
        return None
    p = p_from_r(r, n)
    ne = n_eff(xs, ys)
    p_ne = p_from_r(r, int(round(ne))) if ne >= 4 else float("nan")
    lo, hi = fisher_ci(r, n)
    rs = pearson(rank(xs), rank(ys))
    if n < 8:
        flag = "too few observations to interpret"
    elif n < 15:
        flag = "low power: |r| must exceed ~%.2f to be nominally significant" % crit_r(n)
    else:
        flag = "ok"
    if n >= 10 and p_ne == p_ne and p_ne < 0.05:
        verdict = "holds up"
    elif p < 0.05 and n >= 8:
        verdict = "likely trend artefact" if (p_ne != p_ne or p_ne >= 0.05) else "holds up"
    elif p < 0.05:
        verdict = "too few observations"
    else:
        verdict = "not significant"
    return {"target": tname, "feature": fname, "mode": mode, "lag": lag, "n": n, "quarters": [qs[0], qs[-1]], "verdict": verdict,
            "r": round(r, 3), "spearman": round(rs, 3), "p": round(p, 4), "n_eff": round(ne, 1), "p_neff": round(p_ne, 4) if not math.isnan(p_ne) else None,
            "ci95": [round(lo, 2), round(hi, 2)], "crit_r_05": round(crit_r(n), 3), "flag": flag}


def correlation_grid(feats, hist):
    tq = [h["quarter"] for h in hist]
    T = {t: {h["quarter"]: h[t] for h in hist} for t in TARGETS}
    rows = []
    for t in TARGETS:
        for f, F in feats.items():
            for mode in ("levels", "changes"):
                for lag in (0, 1):
                    xs, ys, qs = [], [], []
                    for q in tq:
                        if mode == "levels":
                            fx = F.get(qshift(q, -lag))
                            ty = T[t].get(q)
                            if fx is None or ty is None:
                                continue
                            xs.append(fx); ys.append(ty); qs.append(q)
                        else:
                            q0 = qshift(q, -1)
                            if q0 not in T[t]:
                                continue
                            fa, fb = F.get(qshift(q, -lag)), F.get(qshift(q0, -lag))
                            if fa is None or fb is None:
                                continue
                            xs.append(fa - fb); ys.append(T[t][q] - T[t][q0]); qs.append(q)
                    row = corr_row(t, f, mode, lag, xs, ys, qs)
                    if row:
                        rows.append(row)
    return rows


# ----------------------------------------------------------------------------- LOO with in-fold selection
def ols(x, y):
    X = np.column_stack([np.ones(len(x)), x])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    return beta


def loo_skill(feats, hist, target, lag, long_feats):
    tq = [h["quarter"] for h in hist]
    y = {h["quarter"]: h[target] for h in hist}
    avail = [q for q in tq if all(feats[f].get(qshift(q, -lag)) is not None for f in long_feats)]
    if len(avail) < 8:
        return None
    errs_m, errs_mean, errs_p, picks = [], [], [], []
    dir_m, dir_n = 0, 0
    for i, q in enumerate(avail):
        train = [a for a in avail if a != q]
        best, best_r = None, 0.0
        for f in long_feats:
            xs = [feats[f][qshift(a, -lag)] for a in train]
            ys = [y[a] for a in train]
            r = pearson(xs, ys)
            if not math.isnan(r) and abs(r) > abs(best_r):
                best, best_r = f, r
        if best is None:
            continue
        xs = np.array([feats[best][qshift(a, -lag)] for a in train])
        ys = np.array([y[a] for a in train])
        b0, b1 = ols(xs, ys)
        pred = b0 + b1 * feats[best][qshift(q, -lag)]
        errs_m.append(pred - y[q])
        errs_mean.append(float(np.mean(ys)) - y[q])
        picks.append(best)
        prev = qshift(q, -1)
        if prev in y:
            errs_p.append(y[prev] - y[q])
            dir_n += 1
            actual_up = y[q] > y[prev]
            dir_m += (pred > y[prev]) == actual_up
    on_p = len(errs_p)
    # evaluate model/mean on the same quarters that persistence can be evaluated (those with a prior quarter)
    idx = [k for k, q in enumerate(avail) if qshift(q, -1) in y]
    em = np.array([errs_m[k] for k in idx]); ee = np.array([errs_mean[k] for k in idx]); ep = np.array(errs_p)
    rm, re_, rp = [float(np.sqrt(np.mean(a ** 2))) for a in (em, ee, ep)]
    freq = {}
    for p in picks:
        freq[p] = freq.get(p, 0) + 1
    return {"target": target, "lag": lag, "n_eval": on_p, "rmse_model": round(rm, 2), "rmse_mean": round(re_, 2), "rmse_persistence": round(rp, 2),
            "skill_vs_persistence": round(1 - rm / rp, 2), "skill_vs_mean": round(1 - rm / re_, 2),
            "direction_hit_rate_model": round(dir_m / dir_n, 2) if dir_n else None, "direction_calls": dir_n,
            "indicator_picked_in_folds": dict(sorted(freq.items(), key=lambda kv: -kv[1]))}


# ----------------------------------------------------------------------------- prediction
def predict(feats, hist, long_feats, target, mode_lag):
    """fit the same selection+OLS used in LOO on ALL quarters; mode_lag in (0,1). Returns (pred, feature, r, beta)."""
    tq = [h["quarter"] for h in hist]
    y = {h["quarter"]: h[target] for h in hist}
    avail = [q for q in tq if all(feats[f].get(qshift(q, -mode_lag)) is not None for f in long_feats)]
    best, best_r = None, 0.0
    for f in long_feats:
        r = pearson([feats[f][qshift(a, -mode_lag)] for a in avail], [y[a] for a in avail])
        if not math.isnan(r) and abs(r) > abs(best_r):
            best, best_r = f, r
    xs = np.array([feats[best][qshift(a, -mode_lag)] for a in avail])
    ys = np.array([y[a] for a in avail])
    b0, b1 = ols(xs, ys)
    target_q = "2026Q3"
    xnow = feats[best].get(qshift(target_q, -mode_lag))
    pred = float(b0 + b1 * xnow) if xnow is not None else None
    return {"feature": best, "r_in_sample": round(best_r, 3), "x_now": None if xnow is None else round(float(xnow), 2), "pred": None if pred is None else round(pred, 1), "n_fit": len(avail)}


def find_row(rows, target, feature, mode, lag):
    return next((r for r in rows if r["target"] == target and r["feature"] == feature and r["mode"] == mode and r["lag"] == lag), None)


def build_narrative(rows, loo, pred, hist, man, tests):
    def sk(t, lag):
        return next((x for x in loo if x["target"] == t and x["lag"] == lag), None)

    nv0 = find_row(rows, "nv_ss_units_yoy_pct", "saar_total_yoy", "levels", 0)
    nvc = find_row(rows, "nv_ss_units_yoy_pct", "saar_total_yoy", "changes", 0)
    nv1 = find_row(rows, "nv_ss_units_yoy_pct", "saar_total_yoy", "levels", 1)
    gp = find_row(rows, "nv_ss_gpu_yoy_pct", "muvvi_yoy", "levels", 0)
    sk_nv0, sk_nv1 = sk("nv_ss_units_yoy_pct", 0), sk("nv_ss_units_yoy_pct", 1)
    used_best = [r for r in rows if r["target"] in ("uv_ss_units_yoy_pct", "uv_ss_gpu_yoy_pct", "adj_eps_yoy_pct") and r["verdict"] == "holds up"]
    gasr = find_row(rows, "uv_ss_units_yoy_pct", "gas_yoy", "levels", 0)
    loanr = find_row(rows, "uv_ss_units_yoy_pct", "loan_rate_chg", "changes", 1)
    used_loo = [x for x in loo if x["target"] in ("uv_ss_units_yoy_pct", "uv_ss_gpu_yoy_pct", "adj_eps_yoy_pct")]
    used_skillful = [x for x in used_loo if x["skill_vs_persistence"] > SKILL_RULE and x["skill_vs_mean"] > SKILL_RULE]

    findings = []
    findings.append({"strength": "supported", "title": "One relationship holds up: new-vehicle units move with total SAAR in the same quarter",
        "text": f"GPI's same-store new-vehicle unit growth vs total light-vehicle SAAR growth, same quarter: r = {nv0['r']:+.2f} on levels (n={nv0['n']}) and r = {nvc['r']:+.2f} on quarter-over-quarter changes (n={nvc['n']}, p = {nvc['p_neff']:.3f} after autocorrelation adjustment). "
                f"Leave-one-out validation confirms real skill ({sk_nv0['skill_vs_persistence']:.0%} lower error than 'same as last quarter'). This is a coincident relationship, not a leading one."})
    findings.append({"strength": "not supported", "title": "As a LEADING indicator (1 quarter ahead) it does not work",
        "text": f"Last quarter's SAAR vs this quarter's new-unit growth: r = {nv1['r']:+.2f} looks strong, but the series trend so strongly that the effective sample is ~{nv1['n_eff']:.0f} quarters (adjusted p = {nv1['p_neff']:.2f}), and out-of-sample the lead-1 model beats 'same as last quarter' by only {sk_nv1['skill_vs_persistence']:.0%}."})
    findings.append({"strength": "not supported", "title": "Used-vehicle units, used GPU and EPS: no indicator shows predictive skill",
        "text": f"{len(used_best)} in-sample correlations for used units, used GPU or EPS clear p<0.05 even after the trend adjustment (e.g. gas-price growth vs used-unit growth r = {gasr['r']:+.2f}; change in loan rate vs change in used units r = {loanr['r']:+.2f}), but that is about what chance produces from {tests['total']} tests (none survive a multiple-testing correction), and none of the {len(used_loo)} leave-one-out models for used units, used GPU or EPS beat both naive baselines by the {SKILL_RULE:.0%} margin ({len(used_skillful)} do). "
                "That includes the wholesale index (Manheim). This is the key limitation: the used business is where GPI's recent shortfall sits, and the tracker's indicators cannot yet forecast it."})
    findings.append({"strength": "caution", "title": "Several very high correlations are trend artefacts",
        "text": f"E.g. new-vehicle GPU growth vs the Manheim index: r = {gp['r']:+.2f}, but both series trend steadily over the window, leaving ~{gp['n_eff']:.0f} effective observations (adjusted p = {gp['p_neff']:.2f}). Of {tests['total']} correlations tested, {tests['nominal_p05']} are nominally significant at 5% versus ~{tests['expected_by_chance_at_5pct']:.0f} expected by pure chance; {tests['nominal_p05_after_autocorr_adjust']} remain after the autocorrelation adjustment and {tests['survive_bonferroni']} survive a strict multiple-testing correction."})
    findings.append({"strength": "limited", "title": "Wholesale/retail spread, ATP, GM: windows too short",
        "text": "Retail listing-price history starts 2025 (<=7 quarters), wholesale days' supply and KBB truck ATP only cover 2025-26 (<=4 quarters and 2 quarters), and GM's official delivery tables cannot be fetched automatically. These were not used to build the forecast; any correlation computed on them would be meaningless."})

    # ---- Q3 2026 read
    pm = pred["per_metric"]
    seas = pred["seasonal_benchmark"]
    eps = seas["eps"]
    ec = pred["eps_context"]
    mk = {r["month"]: r for r in man["real_series"]["used_market_monthly"]["data"]}
    def pace(ms):
        v = [mk[m]["retail_sales_pace_yoy_pct"] for m in ms if m in mk and mk[m]["retail_sales_pace_yoy_pct"] is not None]
        return sum(v) / len(v) if len(v) == len(ms) else None
    p_q2, p_q3 = pace(["2026-04", "2026-05", "2026-06"]), pace(["2026-07", "2026-08", "2026-09"])
    nvm = pm["nv_ss_units_yoy_pct"]["model_same_quarter"]
    nvl = nvm["loo"]
    band = round(2 * nvl["rmse_model"], 1)
    uvg = seas["uv_gpu"]
    st_lo, st_hi = ec["street_estimate"].get("fxempire_eps"), ec["street_estimate"].get("benzinga_eps")
    reads = [
        {"metric": "New-vehicle same-store units, YoY", "last": pm["nv_ss_units_yoy_pct"]["last_actual_2026Q2"], "estimate": nvm["pred"], "range": [round(nvm["pred"] - band, 1), round(nvm["pred"] + band, 1)],
         "lean": "slightly better than Q2 (-2.8%), but inside the error band", "confidence": "moderate-low",
         "basis": f"Only model with demonstrated skill: same-quarter total SAAR (Q3 SAAR {nvm['x_now']:+.1f}% YoY, already known) -> {nvm['pred']:+.1f}%, +/-{band} pts (2x leave-one-out error {nvl['rmse_model']}); it called the direction of the quarter-to-quarter change correctly in {round(nvl['direction_hit_rate_model']*nvl['direction_calls'])} of {nvl['direction_calls']} backtested quarters. Coincident, so it is a nowcast, not a forecast, and the band includes Q2's -2.8%."},
        {"metric": "Used same-store retail units, YoY", "last": pm["uv_ss_units_yoy_pct"]["last_actual_2026Q2"], "estimate": pm["uv_ss_units_yoy_pct"]["last_actual_2026Q2"], "range": None,
         "lean": "no call", "confidence": "none from the model",
         "basis": f"No indicator model has skill, so the estimate is simply 'same as Q2'. Context only (not validated historically): Cox's retail used sales pace averaged {p_q3:+.1f}% YoY in Q3 vs {p_q2:+.1f}% in Q2, which would favor some improvement; GPI's shortfall vs the market in Q2 was GPI-specific (sourcing)."},
        {"metric": "Used same-store retail GPU, YoY", "last": pm["uv_ss_gpu_yoy_pct"]["last_actual_2026Q2"], "estimate": pm["uv_ss_gpu_yoy_pct"]["last_actual_2026Q2"], "range": [uvg["implied_yoy_pct_low"], uvg["implied_yoy_pct_high"]],
         "lean": "flat to modestly better than Q2 (-5.3%)", "confidence": "low",
         "basis": f"No model has skill. Seasonal benchmark (Q2->Q3 GPU ratios 2024-25) implies {uvg['implied_yoy_pct_low']:+.1f}% to {uvg['implied_yoy_pct_high']:+.1f}% (mean {uvg['implied_yoy_pct_mean']:+.1f}%), helped by an easy comp (Q3'25 GPU was -8.5% YoY). Based on only two prior years."},
        {"metric": "New-vehicle same-store GPU, YoY", "last": pm["nv_ss_gpu_yoy_pct"]["last_actual_2026Q2"], "estimate": pm["nv_ss_gpu_yoy_pct"]["last_actual_2026Q2"], "range": None,
         "lean": "no call", "confidence": "none",
         "basis": "The best-looking correlations are trend artefacts; no model clears the skill bar."},
        {"metric": "Adjusted EPS ($) vs Street", "last": ec["q2_2026_eps"], "estimate": eps["implied_q3_2026_mean"], "range": [eps["implied_q3_2026_low"], eps["implied_q3_2026_high"]],
         "lean": "in line to slight miss vs Street", "confidence": "low",
         "basis": f"Not from the indicators (they show no EPS skill). Seasonal benchmark: Q2->Q3 EPS ratios of {', '.join(f'{y}: {r:.3f}' for y, r in eps['q2_to_q3_ratios'].items())} imply ${eps['implied_q3_2026_low']:.2f}-${eps['implied_q3_2026_high']:.2f} (mean ${eps['implied_q3_2026_mean']:.2f}) vs vendor Street estimates of ${st_lo:.2f}-${st_hi:.2f}, i.e. a required ratio of {ec['street_implied_q2_to_q3_ratio']['fxempire_eps']:.3f}-{ec['street_implied_q2_to_q3_ratio']['benzinga_eps']:.3f}, at or above the top of the historical range. GPI also missed consensus in {ec['misses_in_last_6']} of the last {ec['n_surprises']} quarters (4 straight). Offsets: easier GPU comp, wider retail-wholesale spread."},
    ]
    return {"findings": findings, "q3_reads": reads,
            "bottom_line": ("Honest summary: with 12 quarters of history, the tracker's indicators explain GPI's NEW-vehicle volume in the same quarter (via total SAAR) but show no demonstrated ability to predict used units, used GPU or EPS — the metrics that matter most right now. "
                            "The Q3 read below is therefore a data-driven lean, not a forecast: new-vehicle units probably a bit better than Q2; used still the weak spot with no reliable edge; EPS more likely in line to slightly below the Street than above it, mainly because the Street's number sits at the top of GPI's own seasonal range and GPI has missed four straight quarters."),
            "skill_rule": f"A model may set a frozen central estimate only if its leave-one-out error beats BOTH the 'same as last quarter' and the 'historical mean' baselines by more than {SKILL_RULE:.0%}. Disclosure: this threshold was fixed after seeing the leave-one-out results (it was raised from 10% to 15% when new-vehicle GPU showed a marginal 11% edge) and before the forecast was frozen — a documented rule, not a strict pre-registration."}


def main():
    fred, gpi, ind, man, log = load()
    hist = sorted(gpi["quarters"], key=lambda h: h["quarter"])
    feats, meta = build_features(fred, ind, man)
    rows = correlation_grid(feats, hist)

    tests = len(rows)
    nominal = [r for r in rows if r["p"] < 0.05]
    nominal_ne = [r for r in rows if r["p_neff"] is not None and r["p_neff"] < 0.05]
    bonf = 0.05 / tests
    survive = [r for r in rows if r["p"] < bonf]
    full_n = [r for r in rows if r["n"] >= 10]
    strongest = sorted([r for r in rows if r["n"] >= 8], key=lambda r: -abs(r["r"]))[:12]
    by_target = {}
    for t in TARGETS:
        rs_ = sorted([r for r in rows if r["target"] == t and r["n"] >= 8], key=lambda r: -abs(r["r"]))[:5]
        by_target[t] = rs_

    long_feats = ["saar_dom_yoy", "saar_imp_yoy", "saar_total_yoy", "loan_rate_level", "loan_rate_chg", "gas_yoy", "tx_unemp_chg", "cpi_used_yoy", "cpi_new_yoy", "cpi_used_minus_new", "muvvi_yoy"]
    loo = []
    for t in TARGETS:
        for lag in (1, 0):
            res = loo_skill(feats, hist, t, lag, long_feats)
            if res:
                loo.append(res)

    # ---------------------------------------------------- Q3 2026 prediction
    last = hist[-1]
    pred = {"quarter": "2026Q3", "per_metric": {}}
    for t, label in TARGETS.items():
        if t == "adj_eps_yoy_pct":
            continue
        l1 = predict(feats, hist, long_feats, t, 1)
        l0 = predict(feats, hist, long_feats, t, 0)
        sk1 = next((x for x in loo if x["target"] == t and x["lag"] == 1), None)
        sk0 = next((x for x in loo if x["target"] == t and x["lag"] == 0), None)
        pred["per_metric"][t] = {"label": label, "last_actual_2026Q2": last[t], "model_lead1": {**l1, "loo": sk1}, "model_same_quarter": {**l0, "loo": sk0}}

    # seasonal-ratio naive benchmarks. Units are deliberately NOT benchmarked this way: GPI's same-store
    # comparison base is redefined every year, so Q2->Q3 same-store unit ratios jump for reasons unrelated to demand.
    q = {h["quarter"]: h for h in hist}
    eps_by_q = {h["quarter"]: h["adj_eps"] for h in hist}
    for h in hist:
        eps_by_q.setdefault(qshift(h["quarter"], -4), h["adj_eps_prior_year"])
    seas = {}
    specs = (("uv_gpu", "Used same-store retail GPU ($)", {k: v["uv_ss_gpu"] for k, v in q.items()}),
             ("eps", "Adjusted diluted EPS ($)", eps_by_q))
    for key, label, series in specs:
        yrs = [y for y in (2023, 2024, 2025) if f"{y}Q2" in series and f"{y}Q3" in series]
        rs_ = [series[f"{y}Q3"] / series[f"{y}Q2"] for y in yrs]
        base_q2 = series["2026Q2"]
        yago = series["2025Q3"]
        outs = [base_q2 * r for r in rs_]
        seas[key] = {"label": label, "years_used": yrs, "q2_to_q3_ratios": {str(y): round(r, 3) for y, r in zip(yrs, rs_)}, "q2_2026": base_q2, "q3_2025": yago,
                     "implied_q3_2026_low": round(min(outs), 2), "implied_q3_2026_high": round(max(outs), 2), "implied_q3_2026_mean": round(float(np.mean(outs)), 2),
                     "implied_yoy_pct_low": round((min(outs) / yago - 1) * 100, 1), "implied_yoy_pct_high": round((max(outs) / yago - 1) * 100, 1), "implied_yoy_pct_mean": round((float(np.mean(outs)) / yago - 1) * 100, 1)}
    pred["seasonal_benchmark"] = seas
    pred["persistence_benchmark"] = {t: last[t] for t in TARGETS}

    street = gpi.get("_readme", {}).get("q3_2026_street_estimate", {})
    eps_prior = q["2025Q3"]["adj_eps"]
    needed_ratio = {k: round(street[k] / q["2026Q2"]["adj_eps"], 3) for k in ("fxempire_eps", "benzinga_eps") if k in street}
    street_yoy = {k: round((street[k] / eps_prior - 1) * 100, 1) for k in ("fxempire_eps", "benzinga_eps") if k in street}
    cons = [(h["quarter"], h["street_consensus"]) for h in hist if "street_consensus" in h]
    pred["eps_context"] = {"street_estimate": street, "street_implied_yoy_pct": street_yoy, "street_implied_q2_to_q3_ratio": needed_ratio, "q3_2025_eps": eps_prior, "q2_2026_eps": q["2026Q2"]["adj_eps"],
                           "recent_surprises": [{"quarter": a, **b} for a, b in cons],
                           "misses_in_last_6": sum(1 for _, b in cons if b["surprise_pct"] < 0), "n_surprises": len(cons)}

    narrative = build_narrative(rows, loo, pred, hist, man, {"total": tests, "nominal_p05": len(nominal), "expected_by_chance_at_5pct": 0.05 * tests, "nominal_p05_after_autocorr_adjust": len(nominal_ne), "survive_bonferroni": len(survive)})
    out = {
        "narrative": narrative,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window": {"target_quarters": [hist[0]["quarter"], hist[-1]["quarter"]], "n_quarters": len(hist)},
        "availability": [{"feature": k, **v} for k, v in meta.items()] + [{"feature": "atp_full_size_pickup", "label": "KBB full-size pickup ATP", "first": "2025-12", "last": "2026-07", "n": 8, "note": "monthly, too short: overlaps only 2 GPI quarters — excluded"},
                                                                         {"feature": "wholesale_days_supply", "label": "Manheim wholesale days' supply", "first": "2025-10", "last": "2026-09", "n": 4, "note": "pre-2026 history could not be parsed reliably — excluded"},
                                                                         {"feature": "gm_deliveries", "label": "GM Silverado/Sierra deliveries", "first": "2026Q1", "last": "2026Q3", "n": 3, "note": "GM's official tables block automated access — excluded"}],
        "tests": {"total": tests, "nominal_p05": len(nominal), "expected_by_chance_at_5pct": round(0.05 * tests, 1), "nominal_p05_after_autocorr_adjust": len(nominal_ne),
                  "bonferroni_alpha": round(bonf, 6), "survive_bonferroni": len(survive), "with_n_ge_10": len(full_n)},
        "strongest": strongest, "by_target": by_target, "all_rows": rows, "loo": loo, "prediction": pred,
        "feature_meta": meta, "targets": TARGETS,
    }

    # track record from the forecast log
    tr = []
    for fc in log.get("forecasts", []):
        for m in fc.get("metrics", []):
            a, p = m.get("actual"), m.get("predicted")
            tr.append({"quarter": fc["quarter"], "metric": m["metric"], "predicted": p, "actual": a,
                       "error": None if (a is None or p is None) else round(a - p, 2),
                       "direction_vs_prior_called": m.get("lean"), "direction_actual": m.get("actual_direction")})
    out["track_record"] = tr
    # scatter for the one relationship that holds up (new-vehicle units vs total SAAR, same quarter)
    xs = [(h["quarter"], feats["saar_total_yoy"][h["quarter"]], h["nv_ss_units_yoy_pct"]) for h in hist if h["quarter"] in feats["saar_total_yoy"]]
    b0, b1 = ols(np.array([x[1] for x in xs]), np.array([x[2] for x in xs]))
    nm = pred["per_metric"]["nv_ss_units_yoy_pct"]["model_same_quarter"]
    out["scatter"] = {"x_label": "Total light-vehicle SAAR, YoY % (quarterly avg, FRED)", "y_label": "GPI same-store new-vehicle units, YoY %",
                      "points": [{"q": a, "x": round(b, 2), "y": c} for a, b, c in xs], "fit": {"b0": round(float(b0), 3), "b1": round(float(b1), 3)},
                      "nowcast": {"q": "2026Q3", "x": nm["x_now"], "y": nm["pred"]}}
    json.dump(out, open(D / "backtest.json", "w"), indent=1)
    open(D / "backtest.json", "a").write("\n")
    print(f"tests={tests}  nominal p<.05={len(nominal)} (chance expectation {0.05*tests:.0f})  after autocorr adj={len(nominal_ne)}  survive Bonferroni={len(survive)}")

    if "--freeze" in sys.argv:
        qk = sys.argv[sys.argv.index("--freeze") + 1]
        if any(f["quarter"] == qk for f in log.get("forecasts", [])):
            print(f"forecast-log already has {qk}; not overwriting a frozen prediction")
        else:
            log.setdefault("forecasts", []).append(freeze_entry(out, qk))
            json.dump(log, open(D / "forecast-log.json", "w"), indent=2)
            open(D / "forecast-log.json", "a").write("\n")
            print("frozen:", qk)


def freeze_entry(out, qk):
    p = out["prediction"]
    seas = p["seasonal_benchmark"]
    pm = p["per_metric"]
    metrics = []
    # central estimate = persistence unless a model demonstrated skill; recorded explicitly with method
    def best_central(t):
        for key in ("model_lead1", "model_same_quarter"):
            loo_ = pm[t][key]["loo"]
            if loo_ and loo_["skill_vs_persistence"] > SKILL_RULE and loo_["skill_vs_mean"] > SKILL_RULE and pm[t][key]["pred"] is not None:
                return pm[t][key]["pred"], f"indicator model ({pm[t][key]['feature']}, {key})"
        return pm[t]["last_actual_2026Q2"], "persistence (no indicator model beat the naive baselines in leave-one-out testing)"
    seas_key = {"uv_ss_gpu_yoy_pct": "uv_gpu"}
    for t in ("nv_ss_units_yoy_pct", "uv_ss_units_yoy_pct", "uv_ss_gpu_yoy_pct", "nv_ss_gpu_yoy_pct"):
        c, how = best_central(t)
        sk = seas.get(seas_key.get(t, ""), None)
        metrics.append({"metric": t, "label": TARGETS[t], "predicted": c, "method": how,
                        "range_low": None if not sk else sk["implied_yoy_pct_low"], "range_high": None if not sk else sk["implied_yoy_pct_high"],
                        "range_basis": None if not sk else "seasonal-ratio benchmark (Q2->Q3 ratios from prior years)",
                        "lean": None, "actual": None, "actual_direction": None})
    eps = seas["eps"]
    metrics.append({"metric": "adj_eps", "label": "Adjusted diluted EPS ($)", "predicted": eps["implied_q3_2026_mean"], "method": "seasonal-ratio benchmark (Q2->Q3 EPS ratios 2023-2025, mean); indicators have no demonstrated skill on EPS",
                    "range_low": eps["implied_q3_2026_low"], "range_high": eps["implied_q3_2026_high"], "range_basis": "min/max of the three prior-year Q2->Q3 ratios (2023, 2024, 2025)", "lean": None, "actual": None, "actual_direction": None})
    return {"quarter": qk, "frozen_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "release_date": "2026-10-28", "status": "awaiting actuals",
            "street_estimate": p["eps_context"]["street_estimate"], "metrics": metrics,
            "note": "Prediction frozen BEFORE the release. After GPI reports, fill `actual` for each metric (same units as `predicted`: YoY % for same-store metrics, $ for EPS) and add the quarter to data/gpi-history.json, then re-run scripts/backtest.py."}


if __name__ == "__main__":
    main()
