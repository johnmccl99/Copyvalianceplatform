import { isBalanceClassAccount } from "./glAccountClass.js";
import { pctChange } from "./variancePercent.js";

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function aggregateCoaByAccount(rows, { preserveNulls = false } = {}) {
  const covered = (v) =>
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  const byAcct = new Map();
  for (const r of rows || []) {
    const key = r.account_number;
    let a = byAcct.get(key);
    if (!a) {
      a = {
        account_number: r.account_number,
        account_name: r.account_name,
        noi_section: r.noi_section,
        noi_build_bucket: r.noi_build_bucket,
        budget: 0,
        actual: 0,
        realized_variance: 0,
        forward_variance: 0,
        months: 0,
        budgetMonths: 0,
        actualMonths: 0,
        uncoveredMonths: 0,
      };
      byAcct.set(key, a);
    }
    const hasBudget = covered(r.budget_amount);
    const hasActual = covered(r.actual_amount);
    const b = num(r.budget_amount);
    const ac = num(r.actual_amount);
    if (hasBudget) a.budgetMonths += 1;
    if (hasActual) a.actualMonths += 1;
    if (!hasBudget || !hasActual) a.uncoveredMonths += 1;
    a.budget += b;
    a.actual += ac;
    a.months += 1;
    if (!preserveNulls || (hasBudget && hasActual)) {
      if (r.is_actual) a.realized_variance += ac - b;
      else a.forward_variance += ac - b;
    }
  }
  return [...byAcct.values()]
    .map((a) => {
      const budget = preserveNulls && a.budgetMonths === 0 ? null : a.budget;
      const actual = preserveNulls && a.actualMonths === 0 ? null : a.actual;
      const variance =
        budget === null || actual === null ? null : actual - budget;
      return {
        ...a,
        budget,
        actual,
        variance,
        pct_variance: variance === null ? null : pctChange(actual, budget),
      };
    })
    .sort((x, y) => Math.abs(y.variance ?? 0) - Math.abs(x.variance ?? 0));
}

export function aggregateNoiByLine(rows) {
  const byLine = new Map();
  for (const r of rows || []) {
    const key = r.line_id;
    let a = byLine.get(key);
    if (!a) {
      a = {
        line_id: r.line_id,
        line_label: r.line_label,
        line_type: r.line_type,
        display_order: r.display_order,
        noi_section: r.noi_section,
        budget: 0,
        actual: 0,
        hasBudget: false,
      };
      byLine.set(key, a);
    }
    if (r.budget_amount != null) {
      a.budget += num(r.budget_amount);
      a.hasBudget = true;
    }
    if (r.actual_amount != null) a.actual += num(r.actual_amount);
  }
  return [...byLine.values()]
    .map((a) => ({
      line_id: a.line_id,
      line_label: a.line_label,
      line_type: a.line_type,
      display_order: a.display_order,
      noi_section: a.noi_section,
      budget: a.hasBudget ? a.budget : null,
      actual: a.actual,
      variance: a.hasBudget ? a.actual - a.budget : null,
      pct_variance: a.hasBudget ? pctChange(a.actual, a.budget) : null,
    }))
    .sort((x, y) => (x.display_order ?? 0) - (y.display_order ?? 0));
}

export function summarizeVariance(rows) {
  let budget = 0;
  let actual = 0;
  for (const r of rows || []) {
    budget += num(r.budget_amount);
    actual += num(r.actual_amount);
  }
  return {
    budget,
    actual,
    variance: actual - budget,
    pct_variance: pctChange(actual, budget),
  };
}

export const STATEMENT_HEADLINE_LABEL = "Net Income";

export function headlineFromStatementRows(
  rows,
  label = STATEMENT_HEADLINE_LABEL,
) {
  const target = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!target) return null;
  const row = (rows || []).find(
    (candidate) =>
      (candidate?.kind === "subtotal" || candidate?.kind === "total") &&
      String(candidate.line_label ?? "")
        .trim()
        .toLowerCase() === target,
  );
  if (!row) return null;
  return {
    label: row.line_label,
    account_numbers: row.member_account_numbers || [],
    budget: row.budget,
    actual: row.actual,
    variance: row.variance,
    pct_variance: row.pct_variance,
    period_total_actual_sum: row.period_total_actual_sum,
  };
}

export const OTHER_EXPENSES_TOTAL_LABEL = "Total Other Expenses";
export const MORTGAGE_RESERVES_LABEL = "Total Mortgage & Reserves";

export function otherExpensesResidualFromStatementRows(
  rows,
  label = "Other Expenses",
) {
  const total = headlineFromStatementRows(rows, OTHER_EXPENSES_TOTAL_LABEL);
  if (!total) return null;
  const interest = statementAccountTotals(rows, DEBT_SERVICE_INTEREST_ACCOUNTS);
  const interestAccounts = new Set(DEBT_SERVICE_INTEREST_ACCOUNTS);
  const budget = num(total.budget) - num(interest?.budget);
  const actual = num(total.actual) - num(interest?.actual);
  const averaged = total.period_total_actual_sum !== undefined;
  return {
    label,
    account_numbers: (total.account_numbers || []).filter(
      (account) => !interestAccounts.has(String(account)),
    ),
    budget,
    actual,
    variance: actual - budget,
    pct_variance: pctChange(actual, budget),
    ...(averaged
      ? {
          period_total_actual_sum:
            num(total.period_total_actual_sum) -
            num(interest?.period_total_actual_sum ?? interest?.actual),
        }
      : {}),
  };
}

export const DEBT_SERVICE_INTEREST_ACCOUNTS = ["60001", "60002"];
export const DEBT_SERVICE_LABEL = "Debt service";
export const CASH_FLOW_LABEL = "Cash flow";

export function statementAccountTotals(rows, accountNumbers) {
  const wanted = new Set((accountNumbers || []).map((a) => String(a)));
  let budget = 0;
  let actual = 0;
  let actualSum = 0;
  let averaged = false;
  let found = 0;
  const foundAccounts = [];
  for (const row of rows || []) {
    if (row?.kind !== "account") continue;
    if (!wanted.has(String(row.account_number))) continue;
    budget += num(row.budget);
    actual += num(row.actual);
    if (row.period_total_actual_sum !== undefined) averaged = true;
    actualSum += num(row.period_total_actual_sum ?? row.actual);
    found += 1;
    foundAccounts.push(String(row.account_number));
  }
  if (!found) return null;
  return {
    budget,
    actual,
    ...(averaged ? { period_total_actual_sum: actualSum } : {}),
    rowCount: found,
    account_numbers: foundAccounts,
  };
}

function principalOrNull(principal) {
  if (!principal) return null;
  const half = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const budget = half(principal.budget);
  const actual = half(principal.actual);
  if (budget === null && actual === null) return null;
  return { budget, actual };
}

function addPrincipalHalf(statementHalf, principalHalf) {
  if (principalHalf === null) return null;
  return num(statementHalf) + principalHalf;
}

function partialVariance(budget, actual) {
  if (budget === null || actual === null) {
    return { variance: null, pct_variance: null };
  }
  return { variance: actual - budget, pct_variance: pctChange(actual, budget) };
}

export const PRINCIPAL_LINE_ID = 602;

export function principalFromDebtSources(proformaRows, actualRows) {
  const is602 = (r) => Number(r?.line_id) === PRINCIPAL_LINE_ID;
  const budgetRows = (proformaRows || []).filter(is602);
  const actual602 = (actualRows || []).filter(is602);
  if (!budgetRows.length && !actual602.length) return null;
  return {
    budget: budgetRows.length
      ? budgetRows.reduce((t, r) => t + num(r.amount), 0)
      : null,
    actual: actual602.length
      ? actual602.reduce((t, r) => t + num(r.amount), 0)
      : null,
    budgetMonths: budgetRows.length,
    actualMonths: actual602.length,
    mixedDirectionMonths: actual602.filter((r) => r.mixed_direction).length,
  };
}

export function debtServiceFromStatementRows(
  rows,
  principal,
  label = DEBT_SERVICE_LABEL,
) {
  const p = principalOrNull(principal);
  if (!p) return null;
  const interest = statementAccountTotals(rows, DEBT_SERVICE_INTEREST_ACCOUNTS);
  if (!interest) return null;
  const budget = addPrincipalHalf(interest.budget, p.budget);
  const actual = addPrincipalHalf(interest.actual, p.actual);
  return { label, budget, actual, ...partialVariance(budget, actual) };
}

export function cashFlowFromStatementRows(
  rows,
  principal,
  label = CASH_FLOW_LABEL,
) {
  const p = principalOrNull(principal);
  if (!p) return null;
  const netIncome = headlineFromStatementRows(rows, STATEMENT_HEADLINE_LABEL);
  if (!netIncome) return null;
  const budget = addPrincipalHalf(netIncome.budget, p.budget);
  const actual = addPrincipalHalf(netIncome.actual, p.actual);
  return { label, budget, actual, ...partialVariance(budget, actual) };
}

export function isFavorable(variance, noiSection) {
  if (variance == null || !Number.isFinite(variance) || variance === 0)
    return null;
  if (noiSection === "revenue") return variance > 0;
  if (noiSection === "operating_expense") return variance > 0;
  return null;
}

export function rollupBySection(rows) {
  const bySec = new Map();
  for (const r of rows || []) {
    const sec = r.noi_section || "other";
    let a = bySec.get(sec);
    if (!a) {
      a = { noi_section: sec, budget: 0, actual: 0 };
      bySec.set(sec, a);
    }
    a.budget += num(r.budget_amount);
    a.actual += num(r.actual_amount);
  }
  const order = {
    revenue: 0,
    operating_expense: 1,
    below_noi: 2,
    asset: 3,
    liability: 4,
    other: 5,
  };
  return [...bySec.values()]
    .map((a) => ({
      ...a,
      variance: a.actual - a.budget,
      pct_variance: pctChange(a.actual, a.budget),
    }))
    .sort((x, y) => (order[x.noi_section] ?? 9) - (order[y.noi_section] ?? 9));
}

function chartLabel(a) {
  const number =
    a.account_number == null ? "" : String(a.account_number).trim();
  const name = (a.account_name || "").trim();
  if (number && name) return `${number} · ${name}`;
  return number || name || "—";
}

export function topVarianceAccounts(accountRows, n = 10) {
  return [...(accountRows || [])]
    .sort((x, y) => Math.abs(y.variance ?? 0) - Math.abs(x.variance ?? 0))
    .slice(0, n)
    .map((a) => ({
      account_number: a.account_number,
      label: chartLabel(a),
      actual: a.actual,
      variance: a.variance,
      noi_section: a.noi_section,
      period_total_actual_sum: a.period_total_actual_sum,
    }));
}

function subtotalRow(rows, { key, label, kind, noiSection }) {
  let budget = 0;
  let actual = 0;
  for (const r of rows) {
    budget += num(r.budget);
    actual += num(r.actual);
  }
  return {
    kind,
    key,
    account_number: key,
    line_label: label,
    noi_section: noiSection,
    budget,
    actual,
    variance: actual - budget,
    pct_variance: pctChange(actual, budget),
  };
}

const byAccountNumber = (a, b) =>
  String(a.account_number).localeCompare(String(b.account_number), undefined, {
    numeric: true,
  });

export function buildIncomeStatementRows(
  accountRows,
  { includeBalanceSheet = false } = {},
) {
  const rows = accountRows || [];

  const revenueForSum = rows.filter((r) => r.noi_section === "revenue");
  const opexForSum = rows.filter((r) => r.noi_section === "operating_expense");
  const totalOpex = subtotalRow(opexForSum, {
    key: "__total_operating_expenses__",
    label: "Total Operating Expenses (realized to-date)",
    kind: "subtotal",
    noiSection: "operating_expense",
  });
  const noi = subtotalRow([...revenueForSum, ...opexForSum], {
    key: "__net_operating_income__",
    label: "Net Operating Income (realized to-date)",
    kind: "total",
    noiSection: null,
  });

  const isBal = (r) => isBalanceClassAccount(r.account_number);
  const revenue = rows
    .filter((r) => !isBal(r) && r.noi_section === "revenue")
    .sort(byAccountNumber);
  const opex = rows
    .filter((r) => !isBal(r) && r.noi_section === "operating_expense")
    .sort(byAccountNumber);
  const belowNoi = rows
    .filter(
      (r) =>
        !isBal(r) &&
        r.noi_section !== "revenue" &&
        r.noi_section !== "operating_expense",
    )
    .sort(byAccountNumber);
  const balanceSheet = rows.filter(isBal).sort(byAccountNumber);

  const out = [];
  for (const r of revenue) out.push({ kind: "account", ...r });
  for (const r of opex) out.push({ kind: "account", ...r });
  out.push(totalOpex);
  out.push(noi);
  for (const r of belowNoi) out.push({ kind: "account", ...r });
  if (includeBalanceSheet) {
    for (const r of balanceSheet) out.push({ kind: "account", ...r });
  }
  return out;
}

export function monthsForAccount(
  rows,
  accountNumber,
  { preserveNulls = false } = {},
) {
  const value = (v) => {
    if (!preserveNulls) return num(v);
    if (v === null || v === undefined || v === "") return null;
    return Number.isFinite(Number(v)) ? Number(v) : null;
  };
  return (rows || [])
    .filter((r) => r.account_number === accountNumber)
    .map((r) => {
      const budget = value(r.budget_amount);
      const actual = value(r.actual_amount);
      return {
        month_index: r.month_index,
        month_end: r.month_end,
        is_actual: r.is_actual,
        budget,
        actual,
        variance: budget === null || actual === null ? null : actual - budget,
      };
    })
    .sort((x, y) => (x.month_index ?? 0) - (y.month_index ?? 0));
}
