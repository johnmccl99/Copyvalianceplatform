export const ENGINE_VERSION = "engine@v1";
export const EXPLANATION_VERSION = 1;

export const DEFAULT_ENGINE_CONFIG = {
  cov_stable_max: 0.25,
  cov_lumpy_min: 0.75,
  min_history_months: 12,
  agreement_high_max_pct: 10,
  growth_gap_flag_bps: 300,
  contractual_rate_flag_bps: 25,
  trailing_zero_months: 3,
  level_shift_recent_months: 3,
  level_shift_ratio: 0.5,
  prior_fy_dormancy_ratio: 0.05,
  lease_up_ratio_max: 1.5,
  spike_median_gap_pct: 15,
  seasonal_profile_months: 24,
};

export const RULE_IDS = Object.freeze({
  R0: "R0-scope-gate",
  R1: "R1-stable-run-rate",
  R2: "R2-seasonal-level",
  R3: "R3-revenue-lm12",
  R4: "R4-lumpy-salvage",
  R5: "R5-contract-verify",
  R6: "R6-growth-verify",
  R7: "R7-manual",
});

export const CONFIDENCE_GRADES = Object.freeze([
  "high",
  "medium",
  "low",
  "manual",
]);

export const RECORD_KINDS = Object.freeze([
  "suggestion",
  "verification",
  "manual_note",
  "override",
  "acceptance",
]);

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function round4(v) {
  return Math.round(num(v) * 10000) / 10000;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

const EPS = 1e-9;

export function fmtMoney(v, { decimals = 0 } = {}) {
  const n = num(v);
  return (
    "$" +
    Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

export function fmtPct(v, { decimals = 1 } = {}) {
  const n = num(v);
  return `${n.toFixed(decimals)}%`;
}

export function seriesStats(series, config = DEFAULT_ENGINE_CONFIG) {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...(config || {}) };
  const rows = (series || []).map((r) => ({
    month: r.month,
    amount: num(r.amount),
  }));
  const n = rows.length;
  const amounts = rows.map((r) => r.amount);

  const last12 = amounts.slice(-12);
  const last6 = amounts.slice(-6);
  const last3 = amounts.slice(-3);
  const prior12 = amounts.slice(-24, -12);

  const t3Mean = last3.length === 3 ? mean(last3) : null;
  const t6Mean = last6.length === 6 ? mean(last6) : null;
  const t12Mean = last12.length >= 1 ? mean(last12) : null;
  const t12Median = last12.length >= 1 ? median(last12) : null;
  const t12Total =
    last12.length >= 1 ? last12.reduce((s, v) => s + v, 0) : null;
  const priorFyTotal =
    prior12.length === 12 ? prior12.reduce((s, v) => s + v, 0) : null;

  let cov12 = null;
  if (t12Mean !== null && last12.length >= 3) {
    cov12 = Math.abs(t12Mean) < EPS ? null : stddev(last12) / Math.abs(t12Mean);
  }

  let crossWindowAgreementPct = null;
  if (t3Mean !== null && t6Mean !== null && t12Mean !== null) {
    const windows = [t3Mean, t6Mean, t12Mean];
    const base = Math.abs(mean(windows));
    if (base > EPS) {
      let maxDelta = 0;
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          maxDelta = Math.max(maxDelta, Math.abs(windows[i] - windows[j]));
        }
      }
      crossWindowAgreementPct = (maxDelta / base) * 100;
    }
  }

  const tz = cfg.trailing_zero_months;
  const tail = amounts.slice(-tz);
  const trailingZero =
    n >= tz &&
    t12Mean !== null &&
    Math.abs(t12Mean) > EPS &&
    tail.length === tz &&
    tail.every((v) => Math.abs(v) < EPS);

  let levelShift = false;
  if (last12.length === 12) {
    const rec = last12.slice(-cfg.level_shift_recent_months);
    const older = last12.slice(0, 12 - cfg.level_shift_recent_months);
    const recMean = mean(rec);
    const olderMean = mean(older);
    if (olderMean !== null && Math.abs(olderMean) > EPS) {
      levelShift =
        Math.abs(recMean - olderMean) / Math.abs(olderMean) >
        cfg.level_shift_ratio;
    }
  }

  const lastMonthAmount = n ? amounts[n - 1] : null;
  const lastNonZero = [...amounts].reverse().find((v) => Math.abs(v) > EPS);

  return {
    months_of_history: n,
    window_from: n ? rows[Math.max(0, n - 12)].month : null,
    window_to: n ? rows[n - 1].month : null,
    months_used: last12.length,
    t3_mean: t3Mean === null ? null : round2(t3Mean),
    t6_mean: t6Mean === null ? null : round2(t6Mean),
    t12_mean: t12Mean === null ? null : round2(t12Mean),
    t12_median: t12Median === null ? null : round2(t12Median),
    t12_total: t12Total === null ? null : round2(t12Total),
    prior_fy_total: priorFyTotal === null ? null : round2(priorFyTotal),
    cov12: cov12 === null ? null : round4(cov12),
    cross_window_agreement_pct:
      crossWindowAgreementPct === null ? null : round2(crossWindowAgreementPct),
    regime_break: Boolean(trailingZero || levelShift),
    regime_break_kind: trailingZero
      ? "trailing_zero"
      : levelShift
        ? "level_shift"
        : null,
    last_month_amount:
      lastMonthAmount === null ? null : round2(lastMonthAmount),
    last_nonzero_amount: lastNonZero === undefined ? null : round2(lastNonZero),
  };
}

export function seasonalMonthShares(series, config = DEFAULT_ENGINE_CONFIG) {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...(config || {}) };
  const rows = (series || []).slice(-cfg.seasonal_profile_months);
  if (rows.length < 12) return null;
  const byMonth = new Map();
  for (const r of rows) {
    const m = Number(String(r.month).slice(5, 7));
    if (!m) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(num(r.amount));
  }
  if (byMonth.size < 12) return null;
  const monthMeans = [];
  for (let m = 1; m <= 12; m++) monthMeans.push(mean(byMonth.get(m)));
  const total = monthMeans.reduce((s, v) => s + v, 0);
  if (Math.abs(total) < EPS) return null;
  const shares = monthMeans.map((v) => v / total);
  if (shares.some((s) => s < 0)) return null;
  return shares.map((s) => round4(s));
}

export function classifyAccount({
  stats,
  routing = null,
  config = DEFAULT_ENGINE_CONFIG,
}) {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...(config || {}) };
  const reasons = [];

  if (routing && routing.route_rule === "R5") {
    reasons.push(
      "catalogue routes this account to contractual verification (never derived)",
    );
    return { rule: RULE_IDS.R5, band: null, reasons };
  }

  if (stats.months_of_history < cfg.min_history_months) {
    reasons.push(
      `only ${stats.months_of_history} months of history (< ${cfg.min_history_months} required)`,
    );
    return {
      rule: RULE_IDS.R7,
      band: null,
      reasons,
      manual_reason: "short_history",
    };
  }

  const cov = stats.cov12;
  const lumpy = cov === null || cov >= cfg.cov_lumpy_min;

  if (!lumpy && stats.regime_break) {
    reasons.push(
      stats.regime_break_kind === "trailing_zero"
        ? `last ${cfg.trailing_zero_months} months are zero while the trailing-12 mean is not — the account regime changed`
        : "the recent-month level shifted materially against the rest of the trailing 12 — the account regime changed",
    );
    return {
      rule: RULE_IDS.R7,
      band: null,
      reasons,
      manual_reason: "regime_break",
    };
  }

  if (routing && routing.route_rule === "R3") {
    reasons.push(
      "catalogue routes this account to the revenue LM×12 rule (GPR family)",
    );
    return { rule: RULE_IDS.R3, band: null, reasons };
  }
  if (routing && routing.route_rule === "R4-i") {
    reasons.push(
      "catalogue routes this account to the statutory-accrual salvage (R4-i)",
    );
    return {
      rule: RULE_IDS.R4,
      band: "lumpy",
      reasons,
      salvage_hint: "latest_accrual",
    };
  }

  if (lumpy) {
    reasons.push(
      cov === null
        ? "trailing-12 mean is ~zero — no stable level to derive from (lumpy band)"
        : `CoV ${cov.toFixed(2)} >= ${cfg.cov_lumpy_min} (lumpy band — detector, not deriver)`,
    );
    return { rule: RULE_IDS.R4, band: "lumpy", reasons };
  }

  if (cov < cfg.cov_stable_max) {
    reasons.push(`CoV ${cov.toFixed(2)} < ${cfg.cov_stable_max} (stable band)`);
    return { rule: RULE_IDS.R1, band: "stable", reasons };
  }
  if (
    stats.cross_window_agreement_pct !== null &&
    stats.cross_window_agreement_pct <= cfg.agreement_high_max_pct
  ) {
    reasons.push(
      `T3/T6/T12 agree within ${fmtPct(stats.cross_window_agreement_pct)} (<= ${cfg.agreement_high_max_pct}% — window agreement is the stability signal despite CoV ${cov.toFixed(2)})`,
    );
    return { rule: RULE_IDS.R1, band: "stable", reasons };
  }
  reasons.push(
    `CoV ${cov.toFixed(2)} in [${cfg.cov_stable_max}, ${cfg.cov_lumpy_min}) without window agreement (moderate/seasonal band)`,
  );
  return { rule: RULE_IDS.R2, band: "moderate", reasons };
}

export function verifyGrowth({
  statedGrowth,
  sealedAnnual,
  trailingAnnual,
  config,
}) {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...(config || {}) };
  if (
    statedGrowth === null ||
    statedGrowth === undefined ||
    sealedAnnual === null ||
    sealedAnnual === undefined ||
    trailingAnnual === null ||
    trailingAnnual === undefined ||
    Math.abs(num(trailingAnnual)) < EPS
  ) {
    return null;
  }
  const impliedGrowth = num(sealedAnnual) / num(trailingAnnual) - 1;
  const statedBps = Math.round(num(statedGrowth) * 10000);
  const impliedBps = Math.round(impliedGrowth * 10000);
  const gapBps = Math.abs(statedBps - impliedBps);
  return {
    stated_growth: round4(num(statedGrowth)),
    implied_growth: round4(impliedGrowth),
    gap_bps: gapBps,
    flag: gapBps > cfg.growth_gap_flag_bps,
  };
}

export function verifyContractRate({
  feeSeries,
  baseSeries,
  statedRate,
  config,
}) {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...(config || {}) };
  const fee = (feeSeries || []).map((r) => num(r.amount ?? r));
  const base = (baseSeries || []).map((r) => num(r.amount ?? r));
  const feeTotal = fee.reduce((s, v) => s + v, 0);
  const baseTotal = base.reduce((s, v) => s + v, 0);
  if (!fee.length || !base.length || Math.abs(baseTotal) < EPS) return null;
  const observedRate = Math.abs(feeTotal) / Math.abs(baseTotal);
  const observedBps = Math.round(observedRate * 10000);
  const statedBps =
    statedRate === null || statedRate === undefined
      ? null
      : Math.round(num(statedRate) * 10000);
  const deviationBps =
    statedBps === null ? null : Math.abs(observedBps - statedBps);
  return {
    observed_rate: round4(observedRate),
    observed_bps: observedBps,
    stated_bps: statedBps,
    deviation_bps: deviationBps,
    flag: deviationBps !== null && deviationBps > cfg.contractual_rate_flag_bps,
  };
}

export function gradeConfidence({
  rule,
  stats,
  config = DEFAULT_ENGINE_CONFIG,
  caveatCount = 0,
}) {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...(config || {}) };
  const basis = [];
  if (rule === RULE_IDS.R7 || rule === RULE_IDS.R0) {
    basis.push("routed to manual judgment (R7)");
    return { grade: "manual", basis };
  }
  if (rule === RULE_IDS.R4) {
    basis.push("lumpy band — salvage rule at best (detector, not deriver)");
    return { grade: "low", basis };
  }
  if (rule === RULE_IDS.R5 || rule === RULE_IDS.R6) {
    if (stats && stats.months_used >= 12 && !stats.regime_break) {
      basis.push("full trailing-12 verification window, no regime break");
      return { grade: "high", basis };
    }
    basis.push("partial verification window");
    return { grade: "medium", basis };
  }
  if (rule === RULE_IDS.R2) {
    basis.push("moderate/seasonal CoV band — level derives, shape is noisy");
    return { grade: "medium", basis };
  }
  const fullWindow = stats && stats.months_used >= 12;
  const agrees =
    rule === RULE_IDS.R3 ||
    (stats &&
      stats.cross_window_agreement_pct !== null &&
      stats.cross_window_agreement_pct <= cfg.agreement_high_max_pct);
  if (
    fullWindow &&
    agrees &&
    !(stats && stats.regime_break) &&
    caveatCount === 0
  ) {
    basis.push(
      "stable derivation: full window, cross-window agreement inside the high-grade gate, no regime break",
    );
    return { grade: "high", basis };
  }
  basis.push(
    caveatCount > 0
      ? "stable band with caveats"
      : "stable band but the high-grade gates (window/agreement) were not all met",
  );
  return { grade: "medium", basis };
}

function windowPhrase(stats) {
  if (!stats || !stats.window_from || !stats.window_to)
    return "the available GL history";
  return `${stats.months_used} months of Entrata GL actuals (${String(stats.window_from).slice(0, 7)} to ${String(stats.window_to).slice(0, 7)})`;
}

function comparatorSentence(comparator) {
  if (
    !comparator ||
    comparator.workbook_value === null ||
    comparator.workbook_value === undefined
  ) {
    return "No sealed budget value was available to compare against.";
  }
  const basis = comparator.basis === "annual" ? "/yr" : "/mo";
  const delta =
    comparator.magnitude_delta_pct === null ||
    comparator.magnitude_delta_pct === undefined
      ? ""
      : ` — ${fmtPct(Math.abs(comparator.magnitude_delta_pct))} ${comparator.magnitude_delta_pct <= 0 ? "below" : "above"} the derived value`;
  return `The sealed budget carries ${fmtMoney(comparator.workbook_value)}${basis}${delta}.`;
}

export function buildNarrative({
  rule,
  stats,
  computed,
  subject,
  growthCheck,
  rateCheck,
  manualReason,
  reasons,
}) {
  const g =
    computed &&
    computed.stated_growth !== null &&
    computed.stated_growth !== undefined
      ? `, grown ${fmtPct(computed.stated_growth * 100)} per the stated escalator,`
      : "";
  switch (rule) {
    case RULE_IDS.R1: {
      return (
        `Derived from ${windowPhrase(stats)}. This account is stable month-to-month ` +
        `(CoV ${stats.cov12}${stats.cross_window_agreement_pct !== null ? `, T3/T6/T12 agree within ${fmtPct(stats.cross_window_agreement_pct)}` : ""}), ` +
        `so the trailing-12 average of ${fmtMoney(stats.t12_mean)}/mo${g} gives ` +
        `${fmtMoney(computed.derived_value)}/mo spread flat. ` +
        comparatorSentence(computed.comparator)
      );
    }
    case RULE_IDS.R2: {
      const spreadNote =
        computed.spread === "seasonal_profile"
          ? "spread by the observed month-share profile (opt-in)"
          : "spread flat (the house budgeting convention for this band)";
      return (
        `Derived from ${windowPhrase(stats)}. Month-to-month variance is moderate/seasonal ` +
        `(CoV ${stats.cov12}), where the trailing-12 LEVEL derives well even when the shape is noisy: ` +
        `${fmtMoney(stats.t12_total)}/yr${g} gives ${fmtMoney(computed.derived_annual)}/yr, ` +
        `${fmtMoney(computed.derived_value)}/mo ${spreadNote}. ` +
        comparatorSentence(computed.comparator)
      );
    }
    case RULE_IDS.R3: {
      return (
        `Derived from the last actual month of scheduled revenue: ${fmtMoney(stats.last_month_amount)} × 12${g} ` +
        `gives ${fmtMoney(computed.derived_annual)}/yr (${fmtMoney(computed.derived_value)}/mo). ` +
        `Last-month annualization is the validated rule for the GPR family — trailing averages lag the current rent roll. ` +
        comparatorSentence(computed.comparator) +
        (growthCheck && growthCheck.flag
          ? ` Growth check: stated ${fmtPct(growthCheck.stated_growth * 100)} vs implied ${fmtPct(growthCheck.implied_growth * 100)} — gap ${growthCheck.gap_bps} bps exceeds the flag threshold.`
          : "")
      );
    }
    case RULE_IDS.R4: {
      if (computed.salvage_path === "latest_accrual") {
        return (
          `Statutory/assessed account: trailing means distort over true-ups, so recency wins (R4-i). ` +
          `The latest accrual level of ${fmtMoney(computed.latest_accrual)}/mo × 12 gives ` +
          `${fmtMoney(computed.derived_annual)}/yr. ` +
          comparatorSentence(computed.comparator)
        );
      }
      if (computed.salvage_path === "prior_fy") {
        return (
          `This account is dormant in the trailing 12 (total ${fmtMoney(stats.t12_total)}) but carried ` +
          `${fmtMoney(stats.prior_fy_total)} in the prior fiscal year — an annual-cadence allowance. ` +
          `The 24-month lookback salvage suggests ${fmtMoney(computed.derived_annual)}/yr. ` +
          comparatorSentence(computed.comparator)
        );
      }
      return (
        `This account is lumpy (CoV ${stats.cov12 === null ? "n/a" : stats.cov12}) and no salvage rule applies — ` +
        `the honest answer is judgment, not derivation. The trailing history is shown as context: ` +
        `T12 total ${fmtMoney(stats.t12_total)}, prior-FY total ${stats.prior_fy_total === null ? "n/a" : fmtMoney(stats.prior_fy_total)}. ` +
        comparatorSentence(computed.comparator)
      );
    }
    case RULE_IDS.R5: {
      if (!rateCheck) {
        return (
          "Contractual account — never derived from history. No posted fee/base window was available to verify the effective rate; " +
          "verify the contract terms directly."
        );
      }
      return (
        `Contractual account — never derived. Verification over ${windowPhrase(stats)}: observed effective rate ` +
        `${(rateCheck.observed_bps / 100).toFixed(2)}% of the base` +
        (rateCheck.stated_bps !== null
          ? ` vs stated ${(rateCheck.stated_bps / 100).toFixed(2)}% — deviation ${rateCheck.deviation_bps} bps${rateCheck.flag ? " (exceeds the flag threshold: stale contract terms or GL mis-coding)" : " (within tolerance)"}.`
          : "; no stated rate on file to compare.")
      );
    }
    case RULE_IDS.R6: {
      if (!growthCheck) {
        return "Growth is a stated policy input (house convention ~3%); no observed level ratio was available to verify it against.";
      }
      return (
        `Growth is a stated policy input, not derived. Stated ${fmtPct(growthCheck.stated_growth * 100)} vs the observed ` +
        `level ratio ${fmtPct(growthCheck.implied_growth * 100)} — gap ${growthCheck.gap_bps} bps` +
        (growthCheck.flag
          ? " (exceeds the flag threshold — review the stated escalator)."
          : " (within tolerance).")
      );
    }
    case RULE_IDS.R7:
    default: {
      const why =
        manualReason === "short_history"
          ? `only ${stats ? stats.months_of_history : 0} months of GL history exist`
          : manualReason === "regime_break"
            ? `the account's regime changed inside the window (${stats && stats.regime_break_kind === "trailing_zero" ? "activity stopped in the trailing months" : "the recent level shifted materially"})`
            : manualReason === "lease_up_ramp"
              ? "the sealed budget sits far above trailing actuals — a lease-up/ramp plan that GL history cannot derive"
              : (reasons && reasons[0]) ||
                "the derivation rules routed this line to judgment";
      return (
        `Manual routing: ${why}. The engine does not invent a number here — ` +
        `the observed history is attached as context for the analyst` +
        (stats && stats.t12_total !== null
          ? ` (trailing ${stats.months_used}-month total ${fmtMoney(stats.t12_total)})`
          : "") +
        `.`
      );
    }
  }
}

export function deriveAccount({
  subject,
  series,
  statedGrowth = null,
  routing = null,
  comparator = null,
  contract = null,
  spreadMode = "flat",
  config = DEFAULT_ENGINE_CONFIG,
  derivedAt = null,
  derivedBy = ENGINE_VERSION,
}) {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...(config || {}) };
  const stats = seriesStats(series, cfg);
  const cls = classifyAccount({ stats, routing, config: cfg });
  const caveats = [];
  const g =
    statedGrowth === null || statedGrowth === undefined
      ? null
      : num(statedGrowth);

  const sealedAnnual =
    comparator &&
    comparator.sealed_annual !== undefined &&
    comparator.sealed_annual !== null
      ? num(comparator.sealed_annual)
      : null;
  const sealedMonthly =
    sealedAnnual !== null
      ? sealedAnnual / 12
      : comparator &&
          comparator.sealed_monthly !== undefined &&
          comparator.sealed_monthly !== null
        ? num(comparator.sealed_monthly)
        : null;

  let rule = cls.rule;
  let manualReason = cls.manual_reason || null;
  let computed = null;
  let growthCheck = null;
  let rateCheck = null;
  let recordKind = "suggestion";

  const mkComparator = (derived, basis) => {
    const wb = basis === "annual" ? sealedAnnual : sealedMonthly;
    if (wb === null || derived === null) {
      return {
        workbook_value: wb === null ? null : round2(wb),
        basis,
        delta_pct: null,
        magnitude_delta_pct: null,
      };
    }
    const deltaPct =
      Math.abs(wb) < EPS ? null : ((derived - wb) / Math.abs(wb)) * 100;
    const magDeltaPct =
      Math.abs(derived) < EPS
        ? null
        : ((Math.abs(wb) - Math.abs(derived)) / Math.abs(derived)) * 100;
    return {
      workbook_value: round2(wb),
      basis,
      delta_pct: deltaPct === null ? null : round2(deltaPct),
      magnitude_delta_pct: magDeltaPct === null ? null : round2(magDeltaPct),
    };
  };

  if (rule === RULE_IDS.R1) {
    const derivedMonthly = stats.t12_mean * (1 + (g ?? 0));
    computed = {
      derived_value: round2(derivedMonthly),
      derived_annual: round2(derivedMonthly * 12),
      chosen_window: "T12",
      spread: "flat",
      stated_growth: g,
      comparator: mkComparator(round2(derivedMonthly), "monthly"),
    };
    if (
      stats.t12_median !== null &&
      Math.abs(stats.t12_median) > EPS &&
      (Math.abs(stats.t12_mean - stats.t12_median) /
        Math.abs(stats.t12_median)) *
        100 >
        cfg.spike_median_gap_pct
    ) {
      const med12 = round2(stats.t12_median * (1 + (g ?? 0)));
      caveats.push(
        `Outlier months separate the trailing mean from the median; the Med12 robustness variant gives ${fmtMoney(med12)}/mo.`,
      );
    }
    growthCheck = verifyGrowth({
      statedGrowth: g,
      sealedAnnual,
      trailingAnnual: stats.t12_mean === null ? null : stats.t12_mean * 12,
      config: cfg,
    });
  } else if (rule === RULE_IDS.R2) {
    const level = stats.t12_total * (1 + (g ?? 0));
    let spread = "flat";
    let monthShares = null;
    if (spreadMode === "seasonal_profile") {
      monthShares = seasonalMonthShares(series, cfg);
      if (monthShares) spread = "seasonal_profile";
      else
        caveats.push(
          "Seasonal-profile spread was requested but the window has no usable month-share profile; fell back to flat.",
        );
    }
    computed = {
      derived_value: round2(level / 12),
      derived_annual: round2(level),
      chosen_window: "T12",
      spread,
      month_shares: monthShares,
      stated_growth: g,
      comparator: mkComparator(round2(level), "annual"),
    };
    growthCheck = verifyGrowth({
      statedGrowth: g,
      sealedAnnual,
      trailingAnnual: stats.t12_total,
      config: cfg,
    });
  } else if (rule === RULE_IDS.R3) {
    const lm = stats.last_month_amount;
    const annual = lm === null ? null : lm * 12 * (1 + (g ?? 0));
    if (
      annual !== null &&
      sealedAnnual !== null &&
      Math.abs(lm * 12) > EPS &&
      sealedAnnual / (lm * 12) > cfg.lease_up_ratio_max
    ) {
      rule = RULE_IDS.R7;
      manualReason = "lease_up_ramp";
      recordKind = "manual_note";
      computed = {
        derived_value: null,
        derived_annual: null,
        chosen_window: "LM",
        spread: null,
        stated_growth: g,
        context_lm12: round2(lm * 12),
        comparator: mkComparator(null, "annual"),
      };
    } else {
      computed = {
        derived_value: annual === null ? null : round2(annual / 12),
        derived_annual: annual === null ? null : round2(annual),
        chosen_window: "LM",
        spread: "flat",
        stated_growth: g,
        comparator: mkComparator(
          annual === null ? null : round2(annual),
          "annual",
        ),
      };
      growthCheck = verifyGrowth({
        statedGrowth: g,
        sealedAnnual,
        trailingAnnual: lm === null ? null : lm * 12,
        config: cfg,
      });
      if (growthCheck && growthCheck.flag) {
        caveats.push(
          `Stated growth ${fmtPct((g ?? 0) * 100)} differs from the sealed budget's implied level ratio by ${growthCheck.gap_bps} bps.`,
        );
      }
    }
  } else if (rule === RULE_IDS.R4) {
    if (
      cls.salvage_hint === "latest_accrual" &&
      stats.last_nonzero_amount !== null
    ) {
      const latest = stats.last_nonzero_amount;
      computed = {
        derived_value: round2(latest),
        derived_annual: round2(latest * 12),
        chosen_window: "latest_accrual",
        spread: "flat",
        salvage_path: "latest_accrual",
        latest_accrual: round2(latest),
        stated_growth: g,
        comparator: mkComparator(round2(latest * 12), "annual"),
      };
    } else if (
      stats.prior_fy_total !== null &&
      Math.abs(stats.prior_fy_total) > EPS &&
      stats.t12_total !== null &&
      Math.abs(stats.t12_total) <
        Math.abs(stats.prior_fy_total) * cfg.prior_fy_dormancy_ratio
    ) {
      computed = {
        derived_value: null,
        derived_annual: round2(stats.prior_fy_total),
        chosen_window: "PriorFY",
        spread: null,
        salvage_path: "prior_fy",
        stated_growth: g,
        comparator: mkComparator(round2(stats.prior_fy_total), "annual"),
      };
      caveats.push(
        "Annual-cadence allowance: the prior fiscal year carried the spend the trailing 12 skipped (T24 catches what T12 cannot). Landing month is judgment — history suggests the leasing-season turn.",
      );
    } else {
      computed = {
        derived_value: null,
        derived_annual: null,
        chosen_window: null,
        spread: null,
        salvage_path: "manual",
        stated_growth: g,
        comparator: mkComparator(null, "annual"),
      };
      recordKind = "manual_note";
      manualReason = manualReason || "lumpy_no_salvage";
    }
  } else if (rule === RULE_IDS.R5) {
    rateCheck = contract
      ? verifyContractRate({
          feeSeries: contract.fee_series,
          baseSeries: contract.base_series,
          statedRate: contract.stated_rate,
          config: cfg,
        })
      : null;
    computed = {
      derived_value: null,
      derived_annual: null,
      chosen_window: rateCheck ? "T12" : null,
      spread: null,
      stated_growth: null,
      rate_check: rateCheck,
      comparator: mkComparator(null, "annual"),
    };
    recordKind = "verification";
    if (rateCheck && rateCheck.flag) {
      caveats.push(
        `Observed effective rate deviates ${rateCheck.deviation_bps} bps from the stated contract rate — stale terms or GL mis-coding.`,
      );
    }
  } else {
    computed = {
      derived_value: null,
      derived_annual: null,
      chosen_window: null,
      spread: null,
      stated_growth: g,
      comparator: mkComparator(null, "annual"),
    };
    recordKind = "manual_note";
  }

  const confidence = gradeConfidence({
    rule,
    stats,
    config: cfg,
    caveatCount: caveats.length,
  });
  if (confidence.grade === "manual")
    recordKind = recordKind === "verification" ? "verification" : "manual_note";

  const narrative = buildNarrative({
    rule,
    stats,
    computed,
    subject,
    growthCheck,
    rateCheck,
    manualReason,
    reasons: cls.reasons,
  });

  const record = {
    explanation_version: EXPLANATION_VERSION,
    subject: {
      property_code: subject.property_code,
      account_number: subject.account_number,
      account_name: subject.account_name ?? null,
      category: subject.category,
      itemized_field: subject.itemized_field || "amount",
      field_semantic: (routing && routing.field_semantic) || null,
      fiscal_year: subject.fiscal_year,
    },
    rule: {
      id: rule,
      class: (routing && routing.assumption_class) || null,
      derivability:
        (routing && routing.derivability) ||
        (rule === RULE_IDS.R5 || rule === RULE_IDS.R6 ? "T-C" : "T-A"),
      workbook_source:
        (routing && routing.workbook_source) || subject.workbook_source || null,
      routing_reasons: cls.reasons,
      manual_reason: manualReason,
    },
    inputs: {
      series: "stg_budget_gl_actual",
      window: {
        from: stats.window_from,
        to: stats.window_to,
        months_used: stats.months_used,
        months_of_history: stats.months_of_history,
      },
      stats: {
        t3_mean: stats.t3_mean,
        t6_mean: stats.t6_mean,
        t12_mean: stats.t12_mean,
        t12_median: stats.t12_median,
        t12_total: stats.t12_total,
        prior_fy_total: stats.prior_fy_total,
        cov12: stats.cov12,
        cross_window_agreement_pct: stats.cross_window_agreement_pct,
        regime_break: stats.regime_break,
        regime_break_kind: stats.regime_break_kind,
        last_month_amount: stats.last_month_amount,
      },
      aux: {
        stated_growth: g,
        contract_terms:
          contract && contract.stated_rate !== undefined
            ? { stated_rate: contract.stated_rate }
            : null,
      },
      config_used: {
        cov_stable_max: cfg.cov_stable_max,
        cov_lumpy_min: cfg.cov_lumpy_min,
        min_history_months: cfg.min_history_months,
        agreement_high_max_pct: cfg.agreement_high_max_pct,
        growth_gap_flag_bps: cfg.growth_gap_flag_bps,
        contractual_rate_flag_bps: cfg.contractual_rate_flag_bps,
      },
    },
    computed,
    checks: { growth: growthCheck, contract_rate: rateCheck },
    confidence,
    caveats,
    provenance: {
      derived_at: derivedAt || new Date().toISOString(),
      derived_by: derivedBy,
      engine_version: ENGINE_VERSION,
    },
    narrative,
  };

  return {
    record,
    record_kind: recordKind,
    rule_id: rule,
    confidence_grade: confidence.grade,
    derived_value: computed ? computed.derived_value : null,
    narrative,
  };
}
