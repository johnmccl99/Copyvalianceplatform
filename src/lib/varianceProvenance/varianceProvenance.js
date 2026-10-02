import { pctChange } from "../variancePercent.js";

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const COMPARISON = {
  BUDGET: "budget",
  PRIOR_YEAR: "prior_year",
  UNDERWRITING: "underwriting",
};

const COMPARISON_META = {
  [COMPARISON.BUDGET]: {
    formula: "Variance = Actual − Budget",
    actualRole: "Actual",
    baselineRole: "Budget",
  },
  [COMPARISON.PRIOR_YEAR]: {
    formula: "Variance = Current − Prior Year",
    actualRole: "Current",
    baselineRole: "Prior Year",
  },
  [COMPARISON.UNDERWRITING]: {
    formula: "Variance = Actual T12 − Underwritten",
    actualRole: "Actual T12",
    baselineRole: "Underwritten",
  },
};

export function comparisonFormula(comparison) {
  return (COMPARISON_META[comparison] || COMPARISON_META[COMPARISON.BUDGET])
    .formula;
}

export function buildVarianceHeader({
  comparison,
  label,
  actual,
  baseline,
  actualRole = null,
  baselineRole = null,
  formula = null,
  actualSource,
  baselineSource,
  actualAsOf,
  baselineAsOf,
  baselineAvailable = true,
}) {
  const meta =
    COMPARISON_META[comparison] || COMPARISON_META[COMPARISON.BUDGET];
  const a = num(actual);
  const b = num(baseline);
  const value = baselineAvailable ? a - b : null;
  return {
    comparison,
    label: label ?? null,
    formula: formula || meta.formula,
    value,
    pct: baselineAvailable ? pctChange(a, b) : null,
    baselineAvailable,
    operands: [
      {
        role: "actual",
        label: actualRole || meta.actualRole,
        value: a,
        source: actualSource ?? null,
        asOf: actualAsOf ?? null,
      },
      {
        role: "baseline",
        label: baselineRole || meta.baselineRole,
        value: baselineAvailable ? b : null,
        source: baselineSource ?? null,
        asOf: baselineAsOf ?? null,
      },
    ],
  };
}

export function buildGlChain({
  rows,
  reconcilesTo,
  reconcileLabel = "Actual",
}) {
  const list = Array.isArray(rows) ? rows : [];
  const mapped = list.map((r) => ({
    transaction_date: r.transaction_date ?? null,
    amount: num(r.amount),
    balance: r.balance != null ? num(r.balance) : null,
    source: r.source ?? null,
  }));
  const sum = mapped.reduce((s, r) => s + r.amount, 0);
  const target = reconcilesTo == null ? null : num(reconcilesTo);
  const ok = target != null && Math.abs(sum - target) < 0.5;
  return {
    kind: "gl",
    caption: `GL monthly net change (${mapped.length})`,
    rows: mapped,
    reconciliation:
      target == null
        ? { sum, target: null, ok: false, label: reconcileLabel }
        : {
            sum,
            target,
            ok,
            label: reconcileLabel,
            asserts:
              mapped.length === 1
                ? `GL monthly net change = ${reconcileLabel}`
                : `Σ ${mapped.length} GL monthly rows = ${reconcileLabel}`,
          },
  };
}
