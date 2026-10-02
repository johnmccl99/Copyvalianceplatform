import { pctChange } from "../variancePercent.js";

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(budget, actual) {
  return pctChange(actual, budget);
}

export function calcChainCacheKey(lineId, period) {
  const start = period?.start || "";
  const end = period?.end || "";
  return `${lineId}|${start}|${end}`;
}

export function calcChainKind(lineType, hasRows) {
  if (!hasRows) return "empty";
  if (lineType === "placeholder_uwpf" || lineType === "derived_placeholder")
    return "placeholder";
  if (lineType === "subtotal" || lineType === "total") return "rollup";
  return "detail";
}

export function formatRollupFormula(aggregationCategories) {
  if (
    !Array.isArray(aggregationCategories) ||
    aggregationCategories.length === 0
  )
    return null;
  return (
    aggregationCategories
      .filter((b) => b != null && String(b).length > 0)
      .join(" + ") || null
  );
}

export function reshapeCalcChain(rows, lineMeta = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const first = list[0] || {};

  const line_id = first.line_id ?? lineMeta.line_id ?? null;
  const line_label = first.line_label ?? lineMeta.line_label ?? null;
  const line_type = first.line_type ?? lineMeta.line_type ?? null;
  const noi_category = first.line_noi_category ?? lineMeta.noi_category ?? null;
  const aggregation_categories =
    first.aggregation_categories ?? lineMeta.aggregation_categories ?? null;
  const placeholder_tooltip =
    first.placeholder_tooltip ?? lineMeta.placeholder_tooltip ?? null;

  const kind = calcChainKind(line_type, list.length > 0);

  if (kind === "placeholder" || kind === "empty") {
    return {
      line_id,
      line_label,
      line_type,
      noi_category,
      aggregation_categories,
      placeholder_tooltip,
      kind,
      formula:
        kind === "placeholder"
          ? null
          : formatRollupFormula(aggregation_categories),
      contributors: [],
      totals: {
        budget: null,
        actual: null,
        variance: null,
        pct_variance: null,
      },
    };
  }

  const contributors = list
    .filter((r) => r.node_kind === "account" || r.node_kind === "bucket")
    .map((r) => {
      const budget = num(r.budget_amount);
      const actual = num(r.actual_amount);
      return {
        node_kind: r.node_kind,
        account_number: r.child_account_number ?? null,
        noi_build_bucket: r.child_noi_build_bucket ?? null,
        label:
          r.child_label ??
          r.child_account_number ??
          r.child_noi_build_bucket ??
          "",
        noi_section: r.child_noi_section ?? null,
        budget,
        actual,
        variance: actual - budget,
        pct_variance: pct(budget, actual),
        contributor_order: r.contributor_order ?? null,
      };
    });

  let totBudget = 0;
  let totActual = 0;
  for (const c of contributors) {
    totBudget += c.budget;
    totActual += c.actual;
  }

  return {
    line_id,
    line_label,
    line_type,
    noi_category,
    aggregation_categories,
    placeholder_tooltip,
    kind,
    formula:
      kind === "rollup" ? formatRollupFormula(aggregation_categories) : null,
    contributors,
    totals: {
      budget: totBudget,
      actual: totActual,
      variance: totActual - totBudget,
      pct_variance: pct(totBudget, totActual),
    },
  };
}
