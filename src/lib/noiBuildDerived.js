import { pctChange } from "./variancePercent.js";

export const NOI_LINE_ID = 300;
export const TOTAL_OPEX_LINE_ID = 299;
export const UNMAPPED_LINE_ID = "unmapped";
export const UNMAPPED_LINE_LABEL = "Unmapped accounts";

const MONEY_LINE_TYPES = new Set(["detail", "subtotal", "total"]);
const PLACEHOLDER_LINE_TYPES = new Set([
  "placeholder_uwpf",
  "derived_placeholder",
]);

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function covered(v) {
  return (
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
  );
}

function normaliseBucket(bucket) {
  const s = bucket == null ? "" : String(bucket).trim();
  return s === "" ? null : s;
}

function categorySectionMap(categories) {
  const map = new Map();
  if (Array.isArray(categories)) {
    for (const c of categories) {
      const name = normaliseBucket(c?.bucket_name);
      if (name) map.set(name, c.section ?? null);
    }
    return map;
  }
  for (const [name, value] of Object.entries(categories || {})) {
    const key = normaliseBucket(name);
    if (!key) continue;
    map.set(key, typeof value === "string" ? value : (value?.section ?? null));
  }
  return map;
}

function lineSection(buckets, sectionByBucket) {
  const sections = new Set(buckets.map((b) => sectionByBucket.get(b) ?? null));
  if (sections.size === 1) {
    const only = [...sections][0];
    return only === "revenue" || only === "operating_expense" ? only : null;
  }
  const operatingOnly = [...sections].every(
    (s) => s === "revenue" || s === "operating_expense",
  );
  return operatingOnly ? "revenue" : null;
}

function sumBuckets(buckets, byBucket, preserveNulls) {
  let budget = 0;
  let actual = 0;
  let budgetCovered = 0;
  let actualCovered = 0;
  for (const b of buckets) {
    const agg = byBucket.get(b);
    if (!agg) continue;
    budget += agg.budget;
    actual += agg.actual;
    budgetCovered += agg.budgetMonths;
    actualCovered += agg.actualMonths;
  }
  return finishSides(
    budget,
    actual,
    budgetCovered,
    actualCovered,
    preserveNulls,
  );
}

function finishSides(
  budget,
  actual,
  budgetCovered,
  actualCovered,
  preserveNulls,
) {
  const b = preserveNulls && budgetCovered === 0 ? null : budget;
  const a = preserveNulls && actualCovered === 0 ? null : actual;
  const variance = b === null || a === null ? null : a - b;
  return {
    budget: b,
    actual: a,
    variance,
    pct_variance: variance === null ? null : pctChange(a, b),
  };
}

export function deriveNoiBuildLines(
  rows,
  template,
  { preserveNulls = false } = {},
) {
  const lines = Array.isArray(template?.lines) ? template.lines : [];
  const sectionByBucket = categorySectionMap(template?.categories);
  const templateBuckets = new Set();
  for (const line of lines) {
    const own = normaliseBucket(line?.noi_category);
    if (own) templateBuckets.add(own);
    for (const agg of line?.aggregation_categories || []) {
      const b = normaliseBucket(agg);
      if (b) templateBuckets.add(b);
    }
  }

  const byBucket = new Map();
  const unmapped = {
    budget: 0,
    actual: 0,
    budgetMonths: 0,
    actualMonths: 0,
    accounts: new Map(),
  };
  for (const r of rows || []) {
    const hasBudget = covered(r?.budget_amount);
    const hasActual = covered(r?.actual_amount);
    const bucket = normaliseBucket(r?.noi_build_bucket);
    if (bucket && !templateBuckets.has(bucket) && sectionByBucket.has(bucket))
      continue;
    if (!bucket || !templateBuckets.has(bucket)) {
      unmapped.budget += num(r?.budget_amount);
      unmapped.actual += num(r?.actual_amount);
      if (hasBudget) unmapped.budgetMonths += 1;
      if (hasActual) unmapped.actualMonths += 1;
      const acct = r?.account_number == null ? null : String(r.account_number);
      if (acct && !unmapped.accounts.has(acct)) {
        unmapped.accounts.set(acct, {
          account_number: acct,
          account_name: r?.account_name ?? null,
          noi_build_bucket: bucket,
        });
      }
      continue;
    }
    let agg = byBucket.get(bucket);
    if (!agg) {
      agg = { budget: 0, actual: 0, budgetMonths: 0, actualMonths: 0 };
      byBucket.set(bucket, agg);
    }
    agg.budget += num(r?.budget_amount);
    agg.actual += num(r?.actual_amount);
    if (hasBudget) agg.budgetMonths += 1;
    if (hasActual) agg.actualMonths += 1;
  }

  const out = [...lines]
    .filter((line) => line && line.line_id != null)
    .sort((x, y) => num(x.display_order) - num(y.display_order))
    .map((line) => {
      const base = {
        line_id: line.line_id,
        line_label: line.line_label,
        line_type: line.line_type,
        display_order: line.display_order,
        indent_level: line.indent_level ?? 0,
        parent_group_label: line.parent_group_label ?? null,
        noi_category: line.noi_category ?? null,
        placeholder_tooltip: line.placeholder_tooltip ?? null,
        placeholder: PLACEHOLDER_LINE_TYPES.has(line.line_type),
        unmapped: false,
        account_numbers: [],
      };
      if (!MONEY_LINE_TYPES.has(line.line_type)) {
        return {
          ...base,
          buckets: [],
          noi_section: null,
          budget: null,
          actual: null,
          variance: null,
          pct_variance: null,
        };
      }
      const buckets =
        line.line_type === "detail"
          ? [normaliseBucket(line.noi_category)].filter(Boolean)
          : (line.aggregation_categories || [])
              .map(normaliseBucket)
              .filter(Boolean);
      return {
        ...base,
        buckets,
        noi_section: lineSection(buckets, sectionByBucket),
        ...sumBuckets(buckets, byBucket, preserveNulls),
      };
    });

  if (unmapped.accounts.size > 0) {
    const last = out.length ? num(out[out.length - 1].display_order) : 0;
    out.push({
      line_id: UNMAPPED_LINE_ID,
      line_label: UNMAPPED_LINE_LABEL,
      line_type: "detail",
      display_order: last + 1,
      indent_level: 0,
      parent_group_label: null,
      noi_category: null,
      placeholder_tooltip: null,
      placeholder: false,
      unmapped: true,
      buckets: [],
      noi_section: null,
      account_numbers: [...unmapped.accounts.keys()].sort(),
      accounts: [...unmapped.accounts.values()].sort((a, b) =>
        a.account_number.localeCompare(b.account_number),
      ),
      ...finishSides(
        unmapped.budget,
        unmapped.actual,
        unmapped.budgetMonths,
        unmapped.actualMonths,
        preserveNulls,
      ),
    });
  }

  return out;
}

export function statementLineByLabel(statementRows, label) {
  const target = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!target) return null;
  return (
    (statementRows || []).find(
      (r) =>
        (r?.kind === "subtotal" || r?.kind === "total") &&
        String(r.line_label ?? "")
          .trim()
          .toLowerCase() === target,
    ) || null
  );
}

export function reconcileDerivedNoi(
  derivedLines,
  statementRows,
  { tolerance = 0.005 } = {},
) {
  const derived = (derivedLines || []).find(
    (l) => Number(l?.line_id) === NOI_LINE_ID,
  );
  const statement = statementLineByLabel(statementRows, "Net Operating Income");
  if (!derived || !statement) return null;
  const gap = (a, b) =>
    a === null || a === undefined || b === null || b === undefined
      ? null
      : num(a) - num(b);
  const budgetGap = gap(statement.budget, derived.budget);
  const actualGap = gap(statement.actual, derived.actual);
  const within = (g) => g === null || Math.abs(g) < tolerance;
  return {
    reconciled: within(budgetGap) && within(actualGap),
    budgetGap,
    actualGap,
  };
}
