import { buildCoaStatementLayout } from "./coaStatementLayout.js";
import { aggregateByAccount } from "./priorYearVariance/priorYearVariance.js";
import { isBalanceClassAccount } from "./glAccountClass.js";
import { formatMonthLabel, monthKey } from "./dateFormat.js";
import { pctChange } from "./variancePercent.js";

export const PY_VARIANCE_MEASURES = [
  { key: "py", field: "py_amount" },
  { key: "current", field: "current_amount" },
  { key: "pyAvail", field: "__py_available_n" },
];

export const PY_STATEMENT_TAIL_LABEL =
  "Balance sheet and accounts outside the workbook income statement (included above in no subtotal)";

function money(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(py, current) {
  return pctChange(current, py);
}

function normalizeForLayout(src) {
  const months = [...new Set(src.map((r) => String(r.month_end)))].sort();
  const idx = new Map(months.map((m, i) => [m, i]));
  return src.map((r) => ({
    ...r,
    month_index: idx.get(String(r.month_end)),
    __py_available_n: r.py_available ? 1 : 0,
  }));
}

function blankMonthly(len) {
  return Array.from({ length: len }, () => ({
    py: null,
    current: null,
    variance: null,
    pct_variance: null,
    py_available: false,
  }));
}

function monthlyOf(r, len) {
  const p = r.measures?.py?.monthly || [];
  const c = r.measures?.current?.monthly || [];
  const a = r.measures?.pyAvail?.monthly || [];
  const out = [];
  for (let i = 0; i < len; i += 1) {
    const py = money(p[i]);
    const current = money(c[i]);
    out.push({
      py,
      current,
      variance: current - py,
      pct_variance: pct(py, current),
      py_available: money(a[i]) > 0,
    });
  }
  return out;
}

function totalsOf(r) {
  const py = money(r.measures?.py?.total);
  const current = money(r.measures?.current?.total);
  return {
    py,
    current,
    variance: current - py,
    pct_variance: pct(py, current),
    py_available: money(r.measures?.pyAvail?.total) > 0,
  };
}

export function buildPyVarianceStatementRows({
  specRows,
  rows,
  balanceSheetAccounts = null,
  includeBalanceSheet = false,
} = {}) {
  const src = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const layout = buildCoaStatementLayout({
    specRows,
    rows: normalizeForLayout(src),
    balanceSheetAccounts,
    measures: PY_VARIANCE_MEASURES,
  });

  const sectionByAccount = new Map();
  for (const r of src) {
    const a = String(r.account_number);
    if (!sectionByAccount.has(a) && r.noi_section)
      sectionByAccount.set(a, r.noi_section);
  }

  const len = layout.axis.length;
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
        py: null,
        current: null,
        variance: null,
        pct_variance: null,
        py_available: false,
        monthly: blankMonthly(len),
      });
    } else if (r.kind === "account") {
      bodyAccounts.add(String(r.accountNumber));
      out.push({
        kind: "account",
        key: r.accountNumber,
        account_number: r.accountNumber,
        account_name: r.accountName,
        noi_section: sectionByAccount.get(String(r.accountNumber)) || null,
        depth: r.depth,
        ...totalsOf(r),
        monthly: monthlyOf(r, len),
      });
    } else {
      out.push({
        kind: r.isGrandTotal ? "total" : "subtotal",
        key: `__stmt_sub_${r.specRow}__`,
        account_number: `__stmt_sub_${r.specRow}__`,
        line_label: r.label,
        noi_section: null,
        depth: r.depth,
        ...totalsOf(r),
        monthly: monthlyOf(r, len),
      });
    }
  }

  const tailSource = src.filter(
    (r) => !bodyAccounts.has(String(r.account_number)),
  );
  const tailAll = aggregateByAccount(tailSource);
  const tail = includeBalanceSheet
    ? tailAll
    : tailAll.filter((r) => !isBalanceClassAccount(r.account_number));

  if (tail.length > 0) {
    out.push({
      kind: "header",
      key: "__stmt_tail__",
      account_number: "__stmt_tail__",
      line_label: PY_STATEMENT_TAIL_LABEL,
      headerKind: "section",
      depth: 0,
      noi_section: null,
      py: null,
      current: null,
      variance: null,
      pct_variance: null,
      py_available: false,
      monthly: blankMonthly(len),
    });
    for (const r of tail) {
      out.push({
        kind: "account",
        key: r.account_number,
        account_number: r.account_number,
        account_name: r.account_name,
        noi_section: r.noi_section || null,
        depth: 0,
        py: money(r.py),
        current: money(r.current),
        variance: money(r.current) - money(r.py),
        pct_variance: pct(money(r.py), money(r.current)),
        py_available: r.py_available === true,
        monthly: blankMonthly(len),
      });
    }
  }

  return {
    rows: out,
    axis: layout.axis.map((m) => ({
      ...m,
      label: formatMonthLabel(monthKey(m.month_end)),
    })),
    tailCount: tail.length,
    bodyAccountCount: bodyAccounts.size,
    orphans: layout.orphans,
  };
}
