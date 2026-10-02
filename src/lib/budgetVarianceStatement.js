import { buildCoaStatementLayout } from "./coaStatementLayout.js";
import { aggregateCoaByAccount, monthsForAccount } from "./budgetVariance.js";
import { isBalanceClassAccount } from "./glAccountClass.js";
import { formatMonthLabel } from "./dateFormat.js";
import { pctChange } from "./variancePercent.js";

export const VARIANCE_MEASURES = [
  { key: "budget", field: "budget_amount" },
  { key: "actual", field: "actual_amount" },
];

export const STATEMENT_TAIL_LABEL =
  "Balance sheet and accounts outside the workbook income statement (included above in no subtotal)";

function monthKeyAt(axis, i) {
  return String(axis[i]?.month_end || "").slice(0, 7) || null;
}

function blankMonthly(axis) {
  return axis.map((_, i) => ({
    month_key: monthKeyAt(axis, i),
    budget: null,
    actual: null,
    variance: null,
    pct_variance: null,
  }));
}

function pct(budget, actual) {
  return pctChange(actual, budget);
}

function money(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function moneyOrNull(v, preserveNulls) {
  if (!preserveNulls) return money(v);
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function varianceOf(budget, actual) {
  if (budget === null || actual === null) return null;
  return actual - budget;
}

function pctOf(budget, actual) {
  if (budget === null || actual === null) return null;
  return pct(budget, actual);
}

function coverageOf(r, preserveNulls) {
  if (!preserveNulls) return null;
  const b = r.measures?.budget;
  const a = r.measures?.actual;
  const uncovered =
    (b?.uncoveredContributions || 0) + (a?.uncoveredContributions || 0);
  if (uncovered === 0) return null;
  return {
    baselineCovered: b?.coveredContributions || 0,
    baselineUncovered: b?.uncoveredContributions || 0,
    compareCovered: a?.coveredContributions || 0,
    compareUncovered: a?.uncoveredContributions || 0,
  };
}

function monthlyOf(r, axis, preserveNulls) {
  const b = r.measures?.budget?.monthly || [];
  const a = r.measures?.actual?.monthly || [];
  const out = [];
  for (let i = 0; i < axis.length; i += 1) {
    const budget = moneyOrNull(b[i], preserveNulls);
    const actual = moneyOrNull(a[i], preserveNulls);
    out.push({
      month_key: monthKeyAt(axis, i),
      budget,
      actual,
      variance: varianceOf(budget, actual),
      pct_variance: pctOf(budget, actual),
    });
  }
  return out;
}

function tailMonthlyOf(rawRows, accountNumber, axis, preserveNulls) {
  const byMonth = new Map();
  for (const m of monthsForAccount(rawRows, accountNumber, { preserveNulls })) {
    byMonth.set(String(m.month_end || "").slice(0, 7), m);
  }
  return axis.map((_, i) => {
    const key = monthKeyAt(axis, i);
    const m = byMonth.get(key);
    const budget = m ? moneyOrNull(m.budget, preserveNulls) : null;
    const actual = m ? moneyOrNull(m.actual, preserveNulls) : null;
    return {
      month_key: key,
      budget,
      actual,
      variance: varianceOf(budget, actual),
      pct_variance: pctOf(budget, actual),
    };
  });
}

function subtotalDisplayRow(r, axis, preserveNulls) {
  const budget = moneyOrNull(r.measures?.budget?.total, preserveNulls);
  const actual = moneyOrNull(r.measures?.actual?.total, preserveNulls);
  return {
    kind: r.isGrandTotal ? "total" : "subtotal",
    key: `__stmt_sub_${r.specRow}__`,
    account_number: `__stmt_sub_${r.specRow}__`,
    line_label: r.label,
    noi_section: null,
    depth: r.depth,
    budget,
    actual,
    variance: varianceOf(budget, actual),
    pct_variance: pctOf(budget, actual),
    monthly: monthlyOf(r, axis, preserveNulls),
    coverage: coverageOf(r, preserveNulls),
    member_account_numbers: Array.isArray(r.memberAccountNumbers)
      ? r.memberAccountNumbers.slice()
      : [],
  };
}

export function buildVarianceStatementRows({
  specRows,
  rows,
  balanceSheetAccounts = null,
  includeBalanceSheet = false,
  preserveNulls = false,
} = {}) {
  const src = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const layout = buildCoaStatementLayout({
    specRows,
    rows: src,
    balanceSheetAccounts,
    measures: VARIANCE_MEASURES,
    preserveNullMeasures: preserveNulls,
  });

  const sectionByAccount = new Map();
  for (const r of src) {
    const a = String(r.account_number);
    if (!sectionByAccount.has(a) && r.noi_section)
      sectionByAccount.set(a, r.noi_section);
  }

  const axis = layout.axis;
  const out = [];
  const bodyAccounts = new Set();

  for (const r of layout.rows) {
    if (r.kind === "header") {
      out.push({
        kind: "header",
        key: `__stmt_hdr_${r.specRow}__`,
        account_number: `__stmt_hdr_${r.specRow}__`,
        line_label: r.label,
        headerKind: r.headerKind,
        depth: r.depth,
        noi_section: null,
        budget: null,
        actual: null,
        variance: null,
        pct_variance: null,
        monthly: blankMonthly(axis),
        member_account_numbers: [],
      });
    } else if (r.kind === "account") {
      const budget = moneyOrNull(r.measures?.budget?.total, preserveNulls);
      const actual = moneyOrNull(r.measures?.actual?.total, preserveNulls);
      bodyAccounts.add(String(r.accountNumber));
      out.push({
        kind: "account",
        key: r.accountNumber,
        account_number: r.accountNumber,
        account_name: r.accountName,
        noi_section: sectionByAccount.get(String(r.accountNumber)) || null,
        depth: r.depth,
        budget,
        actual,
        variance: varianceOf(budget, actual),
        pct_variance: pctOf(budget, actual),
        monthly: monthlyOf(r, axis, preserveNulls),
        coverage: coverageOf(r, preserveNulls),
        member_account_numbers: [String(r.accountNumber)],
      });
    } else {
      out.push(subtotalDisplayRow(r, axis, preserveNulls));
    }
  }

  const tailSource = src.filter(
    (r) => !bodyAccounts.has(String(r.account_number)),
  );
  const tailAll = aggregateCoaByAccount(tailSource, { preserveNulls });
  const tail = includeBalanceSheet
    ? tailAll
    : tailAll.filter((r) => !isBalanceClassAccount(r.account_number));

  if (tail.length > 0) {
    out.push({
      kind: "header",
      key: "__stmt_tail__",
      account_number: "__stmt_tail__",
      line_label: STATEMENT_TAIL_LABEL,
      headerKind: "section",
      depth: 0,
      noi_section: null,
      budget: null,
      actual: null,
      variance: null,
      pct_variance: null,
      monthly: blankMonthly(axis),
      member_account_numbers: [],
    });
    for (const r of tail) {
      out.push({
        kind: "account",
        key: r.account_number,
        account_number: r.account_number,
        account_name: r.account_name,
        noi_section: r.noi_section || null,
        depth: 0,
        budget: moneyOrNull(r.budget, preserveNulls),
        actual: moneyOrNull(r.actual, preserveNulls),
        variance: varianceOf(
          moneyOrNull(r.budget, preserveNulls),
          moneyOrNull(r.actual, preserveNulls),
        ),
        pct_variance: pctOf(
          moneyOrNull(r.budget, preserveNulls),
          moneyOrNull(r.actual, preserveNulls),
        ),
        monthly: tailMonthlyOf(
          tailSource,
          r.account_number,
          axis,
          preserveNulls,
        ),
        member_account_numbers: [String(r.account_number)],
      });
    }
  }

  return {
    rows: out,
    axis: axis.map((m) => ({
      ...m,
      label: formatMonthLabel(String(m.month_end || "").slice(0, 7)),
    })),
    tailCount: tail.length,
    bodyAccountCount: bodyAccounts.size,
    orphans: layout.orphans,
  };
}
