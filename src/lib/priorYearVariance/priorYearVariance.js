import { isBalanceClassAccount } from "../glAccountClass.js";
import { pctChange } from "../variancePercent.js";

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function aggregateByAccount(rows) {
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
        py: 0,
        current: 0,
        py_months: 0,
        months: 0,
      };
      byAcct.set(key, a);
    }
    a.py += num(r.py_amount);
    a.current += num(r.current_amount);
    a.months += 1;
    if (r.py_available) a.py_months += 1;
  }
  return [...byAcct.values()]
    .map((a) => ({
      account_number: a.account_number,
      account_name: a.account_name,
      noi_section: a.noi_section,
      noi_build_bucket: a.noi_build_bucket,
      py: a.py,
      current: a.current,
      months: a.months,
      py_available: a.py_months > 0,
      variance: a.current - a.py,
      pct_variance: pctChange(a.current, a.py),
    }))
    .sort((x, y) => Math.abs(y.variance) - Math.abs(x.variance));
}

export function summarizePyVariance(rows) {
  let py = 0;
  let current = 0;
  let pyAvailableRows = 0;
  for (const r of rows || []) {
    py += num(r.py_amount);
    current += num(r.current_amount);
    if (r.py_available) pyAvailableRows += 1;
  }
  return {
    py,
    current,
    variance: current - py,
    pct_variance: pctChange(current, py),
    py_available: pyAvailableRows > 0,
    py_available_rows: pyAvailableRows,
  };
}

export function hasPriorYearOverlap(rows) {
  return (rows || []).some((r) => r.py_available);
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
      a = { noi_section: sec, py: 0, current: 0 };
      bySec.set(sec, a);
    }
    a.py += num(r.py_amount);
    a.current += num(r.current_amount);
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
      variance: a.current - a.py,
      pct_variance: pctChange(a.current, a.py),
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
  return (accountRows || [])
    .filter((a) => a.py_available)
    .slice(0, n)
    .map((a) => ({
      account_number: a.account_number,
      label: chartLabel(a),
      variance: a.variance,
      noi_section: a.noi_section,
    }));
}

export function monthsForAccount(rows, accountNumber) {
  return (rows || [])
    .filter((r) => r.account_number === accountNumber)
    .map((r) => ({
      month_index: r.month_index,
      month_end: r.month_end,
      py_month_end: r.py_month_end,
      py_available: r.py_available,
      py: num(r.py_amount),
      current: num(r.current_amount),
      variance: num(r.current_amount) - num(r.py_amount),
    }))
    .sort((x, y) => String(x.month_end).localeCompare(String(y.month_end)));
}

export function buildIncomeStatementRows(
  accountRows,
  { includeBalanceSheet = false } = {},
) {
  const rows = accountRows || [];

  const pySubtotal = (memberRows, { key, label, kind, noiSection }) => {
    let py = 0;
    let current = 0;
    let pyAvail = false;
    for (const r of memberRows) {
      py += num(r.py);
      current += num(r.current);
      if (r.py_available) pyAvail = true;
    }
    return {
      kind,
      key,
      account_number: key,
      line_label: label,
      noi_section: noiSection,
      py,
      current,
      py_available: pyAvail,
      variance: current - py,
      pct_variance: pctChange(current, py),
    };
  };

  const revenueForSum = rows.filter((r) => r.noi_section === "revenue");
  const opexForSum = rows.filter((r) => r.noi_section === "operating_expense");
  const totalOpex = pySubtotal(opexForSum, {
    key: "__total_operating_expenses__",
    label: "Total Operating Expenses",
    kind: "subtotal",
    noiSection: "operating_expense",
  });
  const noi = pySubtotal([...revenueForSum, ...opexForSum], {
    key: "__net_operating_income__",
    label: "Net Operating Income",
    kind: "total",
    noiSection: null,
  });

  const byAccountNumber = (a, b) =>
    String(a.account_number).localeCompare(
      String(b.account_number),
      undefined,
      { numeric: true },
    );
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

export function aggregatePyNoiByLine(rows) {
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
        py: 0,
        current: 0,
        py_months: 0,
        months: 0,
      };
      byLine.set(key, a);
    }
    a.py += num(r.py_amount);
    a.current += num(r.current_amount);
    a.months += 1;
    if (r.py_available) a.py_months += 1;
  }
  return [...byLine.values()]
    .map((a) => ({
      line_id: a.line_id,
      line_label: a.line_label,
      line_type: a.line_type,
      display_order: a.display_order,
      noi_section: a.noi_section,
      py: a.py,
      current: a.current,
      months: a.months,
      py_available: a.py_months > 0,
      variance: a.current - a.py,
      pct_variance: pctChange(a.current, a.py),
    }))
    .sort((x, y) => (x.display_order ?? 0) - (y.display_order ?? 0));
}
