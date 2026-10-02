import {
  buildMonthAxis,
  formatMonthLabel,
  firstFiguredMonthIndex,
  trimLeadingEmptyMonths,
  toNumber,
  COA_SECTION_ORDER,
  BALANCE_SECTION_ORDER,
  NOI_SECTION_LABELS,
  UNMAPPED_BUCKET_KEY,
  UNMAPPED_BUCKET_SUBTOTAL_LABEL,
  bucketDisplayLabel,
} from "./budgetOutputSurfaces.js";
import {
  buildCoaStatementLayout,
  coaCountStatementAccounts,
  coaIncomeStatementAccounts,
  COA_ORPHAN_NOTE,
} from "./coaStatementLayout.js";
import COA_STATEMENT_SPEC from "./coaStatementSpec.json";
import { budgetCellIsDash } from "./budgetCellFormat.js";

export {
  buildMonthAxis,
  formatMonthLabel,
  firstFiguredMonthIndex,
  trimLeadingEmptyMonths,
  toNumber,
  NOI_SECTION_LABELS,
  COA_ORPHAN_NOTE,
};

const PORTFOLIO_IS_MEMBERSHIP = coaIncomeStatementAccounts(
  COA_STATEMENT_SPEC.incomeStatement,
);

export const PORTFOLIO_UNPLACED_NOTE =
  "income-statement accounts whose production band disagrees with the workbook layout, " +
  "so the statement above cannot place them inside a subtotal without moving the NOI strike point. " +
  "They are here, outside every subtotal, rather than absent.";

export function buildPortfolioCoaStatementLayout(
  rows,
  hideZeroBalanceAccounts = false,
) {
  return buildCoaStatementLayout({
    specRows: COA_STATEMENT_SPEC.incomeStatement,
    rows,
    balanceSheetAccounts: COA_STATEMENT_SPEC.balanceSheetAccounts,
    includeEmptyAccounts: true,
    hideZeroBalanceAccounts,
  });
}

export function splitPortfolioCoaStatementExcluded(excluded) {
  const unplaced = [];
  const balanceSheet = [];
  for (const row of excluded || []) {
    if (PORTFOLIO_IS_MEMBERSHIP.has(String(row.account_number)))
      unplaced.push(row);
    else balanceSheet.push(row);
  }
  return { unplaced, balanceSheet };
}

export function countPortfolioStatementAccounts(layout) {
  return coaCountStatementAccounts(layout);
}

export function portfolioTrimmedLeadingMonthsNote(rows, fromMonthIndex) {
  if (fromMonthIndex == null) return null;
  const axis = buildMonthAxis(rows);
  if (axis.length === 0) return null;
  const cut = axis.findIndex((m) => m.month_index === fromMonthIndex);
  if (cut <= 0) return null;
  const windowStart = formatMonthLabel(axis[0].month_end);
  const first = formatMonthLabel(axis[cut].month_end);
  return (
    `The grid starts at ${first}, the portfolio's first month carrying any figure. ` +
    `The ${cut === 1 ? "column" : `${cut} columns`} before it ${cut === 1 ? "belongs" : "belong"} to the v26 model window, ` +
    `which opens at ${windowStart}, and ${cut === 1 ? "is" : "are"} empty because the portfolio carries no figure before that month — ` +
    `not because data is missing. Both statements and their supporting grids start at the same month.`
  );
}

function axisPositionMap(axis) {
  const m = new Map();
  for (let i = 0; i < axis.length; i++) m.set(axis[i].month_index, i);
  return m;
}

function foldPresence(previous, next) {
  if (next === true) return true;
  if (next === false) return previous === true ? true : false;
  return previous === undefined ? null : previous;
}

function compareAccountNumbers(a, b) {
  const sa = String(a == null ? "" : a);
  const sb = String(b == null ? "" : b);
  return sa.localeCompare(sb, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function bucketSubtotalLabel(bucket) {
  if (bucket === UNMAPPED_BUCKET_KEY) return UNMAPPED_BUCKET_SUBTOTAL_LABEL;
  if (!bucket) return "Total";
  const trimmed = String(bucket).trim();
  if (!trimmed) return "Total";
  if (/^total\b/i.test(trimmed)) return trimmed;
  return `Total ${trimmed}`;
}

export const PORTFOLIO_ZERO_LEGEND = Object.freeze({
  caption:
    'Showing every account in the portfolio rollup. Toggle "Hide zero balance accounts" to drop rows that are zero in every month.',
  cell: "Dash — the portfolio figure for that month rounds to zero across the properties summed here.",
  sourced:
    "Dash — zero for that month, and at least one contributing property has a source row behind it. A booked zero, not missing data.",
  missing:
    "Blank — no contributing property has a budget or actual row for that account-month.",
  rounded:
    "Dash — a real portfolio figure smaller than half a cent. Too small for the grid to print as a figure, but not a zero and not missing data.",
  subtotal:
    "Dash — the accounts in this group sum to zero for that month across contributing properties. A subtotal has no source row of its own, so this is arithmetic.",
  balanceCell:
    "Dash — no movement that month and a zero ending balance, summed across contributing properties.",
  balanceMissing:
    "Blank change line — no contributing property has a row for that month. The ending balance beneath it is carried forward and still stands.",
});

function isPortfolioDisplayZero(v) {
  return budgetCellIsDash(v);
}

export function portfolioZeroCellTitle(value, presence = true) {
  if (presence === false) return PORTFOLIO_ZERO_LEGEND.missing;
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (!isPortfolioDisplayZero(n)) return undefined;
  if (n !== 0) return PORTFOLIO_ZERO_LEGEND.rounded;
  return presence === true
    ? PORTFOLIO_ZERO_LEGEND.sourced
    : PORTFOLIO_ZERO_LEGEND.cell;
}

export function portfolioSubtotalCellTitle(value) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return isPortfolioDisplayZero(n) ? PORTFOLIO_ZERO_LEGEND.subtotal : undefined;
}

export function portfolioBalanceCellTitle({
  change,
  balance,
  changePresent = true,
} = {}) {
  if (changePresent === false) return PORTFOLIO_ZERO_LEGEND.balanceMissing;
  if (!isPortfolioDisplayZero(change) || !isPortfolioDisplayZero(balance))
    return undefined;
  return PORTFOLIO_ZERO_LEGEND.balanceCell;
}

export function countPortfolioGridAccounts(sections) {
  let n = 0;
  for (const s of sections || []) {
    for (const b of (s && s.buckets) || [])
      n += ((b && b.accounts) || []).length;
  }
  return n;
}

export function hidePortfolioZeroBalanceAccounts(
  sections,
  valueKey = "monthly",
) {
  const out = [];
  for (const s of sections || []) {
    const buckets = [];
    for (const b of (s && s.buckets) || []) {
      const accounts = ((b && b.accounts) || []).filter((a) => {
        const series = (a && a[valueKey]) || [];
        return (
          series.some((v) => !isPortfolioDisplayZero(v)) ||
          !isPortfolioDisplayZero(a && a.total)
        );
      });
      if (accounts.length > 0) buckets.push({ ...b, accounts });
    }
    if (buckets.length > 0) out.push({ ...s, buckets });
  }
  return out;
}

export function buildCoverageBand(rows, axis) {
  const byIdx = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const idx = Number(r.month_index);
    if (!Number.isFinite(idx)) continue;
    const pc = toNumber(r.property_count);
    const apc = toNumber(r.actual_property_count);
    const cur = byIdx.get(idx);
    if (!cur) byIdx.set(idx, { pc, apc });
    else {
      cur.pc = Math.max(cur.pc, pc);
      cur.apc = Math.max(cur.apc, apc);
    }
  }
  return (axis || []).map(({ month_index, month_end }) => {
    const c = byIdx.get(month_index) || { pc: 0, apc: 0 };
    let coverage = "forecast";
    if (c.pc > 0 && c.apc >= c.pc) coverage = "actual";
    else if (c.apc > 0) coverage = "mixed";
    return {
      month_index,
      month_end,
      property_count: c.pc,
      actual_property_count: c.apc,
      coverage,
    };
  });
}

export function synthesizePortfolioNoiBuild(rows) {
  const axis = buildMonthAxis(rows);
  const len = axis.length;
  if (len === 0) return { axis: [], coverage: [], rows: [], hasData: false };
  const pos = axisPositionMap(axis);

  const byLine = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const col = pos.get(Number(r.month_index));
    if (col == null) continue;
    const lineId = r.line_id;
    if (lineId == null) continue;
    let entry = byLine.get(lineId);
    if (!entry) {
      entry = {
        line_id: lineId,
        display_order: Number(r.display_order ?? lineId),
        line_label: r.line_label || "",
        parent_group_label: r.parent_group_label || null,
        line_type: r.line_type || "detail",
        indent_level: Number(r.indent_level ?? 0),
        placeholder_tooltip: r.placeholder_tooltip || null,
        is_subtotal: Boolean(r.is_subtotal),
        monthly: new Array(len).fill(null),
        actualMonthly: new Array(len).fill(null),
        forecastMonthly: new Array(len).fill(null),
        hasAmount: false,
      };
      byLine.set(lineId, entry);
    }
    if (r.amount != null) {
      for (let i = 0; i < len; i++) {
        if (entry.monthly[i] == null) {
          entry.monthly[i] = 0;
          entry.actualMonthly[i] = 0;
          entry.forecastMonthly[i] = 0;
        }
      }
      entry.monthly[col] = toNumber(r.amount);
      entry.actualMonthly[col] = toNumber(r.actual_amount);
      entry.forecastMonthly[col] = toNumber(r.forecast_amount);
      entry.hasAmount = true;
    }
  }

  const out = [];
  for (const entry of byLine.values()) {
    let total = null;
    let actualTotal = null;
    let forecastTotal = null;
    if (entry.hasAmount) {
      total = 0;
      actualTotal = 0;
      forecastTotal = 0;
      for (let i = 0; i < len; i++) {
        total += entry.monthly[i] == null ? 0 : entry.monthly[i];
        actualTotal +=
          entry.actualMonthly[i] == null ? 0 : entry.actualMonthly[i];
        forecastTotal +=
          entry.forecastMonthly[i] == null ? 0 : entry.forecastMonthly[i];
      }
    }
    entry.total = total;
    entry.actualTotal = actualTotal;
    entry.forecastTotal = forecastTotal;
    out.push(entry);
  }
  out.sort((a, b) => a.display_order - b.display_order);

  return {
    axis,
    coverage: buildCoverageBand(rows, axis),
    rows: out,
    hasData: out.length > 0,
  };
}

export function groupPortfolioCoaForGrid(rows) {
  const axis = buildMonthAxis(rows);
  const len = axis.length;
  if (len === 0)
    return { axis: [], coverage: [], sections: [], hasData: false };
  const pos = axisPositionMap(axis);

  const sectionMap = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const col = pos.get(Number(r.month_index));
    if (col == null) continue;
    const section = r.noi_section || "below_noi";
    const bucket = r.noi_build_bucket || UNMAPPED_BUCKET_KEY;
    const acct = r.account_number == null ? "" : String(r.account_number);
    if (!sectionMap.has(section)) sectionMap.set(section, new Map());
    const bucketMap = sectionMap.get(section);
    if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
    const acctMap = bucketMap.get(bucket);
    let row = acctMap.get(acct);
    if (!row) {
      row = {
        account_number: acct,
        account_name: r.account_name || "",
        monthly: new Array(len).fill(0),
        actualMonthly: new Array(len).fill(0),
        forecastMonthly: new Array(len).fill(0),
        amountPresentByMonth: new Array(len).fill(undefined),
      };
      acctMap.set(acct, row);
    }
    if (!row.account_name && r.account_name) row.account_name = r.account_name;
    row.monthly[col] += toNumber(r.amount);
    row.actualMonthly[col] += toNumber(r.actual_amount);
    row.forecastMonthly[col] += toNumber(r.forecast_amount);
    row.amountPresentByMonth[col] = foldPresence(
      row.amountPresentByMonth[col],
      r.amount_source_present,
    );
  }

  const sections = [];
  for (const sectionKey of COA_SECTION_ORDER) {
    if (!sectionMap.has(sectionKey)) continue;
    const bucketMap = sectionMap.get(sectionKey);
    const buckets = [...bucketMap.entries()].map(([bucket, acctMap]) => {
      const accounts = [...acctMap.values()]
        .sort((a, b) =>
          compareAccountNumbers(a.account_number, b.account_number),
        )
        .map((a) => ({
          account_number: a.account_number,
          account_name: a.account_name,
          monthly: a.monthly,
          actualMonthly: a.actualMonthly,
          forecastMonthly: a.forecastMonthly,
          amountPresentByMonth: a.amountPresentByMonth.map((present) =>
            present === undefined ? null : present,
          ),
          total: a.monthly.reduce((s, v) => s + v, 0),
        }));
      const subMonthly = new Array(len).fill(0);
      for (const a of accounts) {
        for (let i = 0; i < len; i++) subMonthly[i] += a.monthly[i];
      }
      return {
        bucket,
        label: bucketDisplayLabel(bucket),
        accounts,
        subtotal: {
          label: bucketSubtotalLabel(bucket),
          monthly: subMonthly,
          total: subMonthly.reduce((s, v) => s + v, 0),
        },
      };
    });
    sections.push({
      key: sectionKey,
      label: NOI_SECTION_LABELS[sectionKey] || sectionKey,
      buckets,
    });
  }

  return {
    axis,
    coverage: buildCoverageBand(rows, axis),
    sections,
    hasData: sections.length > 0,
  };
}

export function groupPortfolioRunningBalancesForGrid(rows) {
  const axis = buildMonthAxis(rows);
  const len = axis.length;
  if (len === 0)
    return { axis: [], coverage: [], sections: [], hasData: false };
  const pos = axisPositionMap(axis);

  const sectionMap = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const col = pos.get(Number(r.month_index));
    if (col == null) continue;
    const section = r.noi_section || "asset";
    const bucket = r.noi_build_bucket || UNMAPPED_BUCKET_KEY;
    const acct = r.account_number == null ? "" : String(r.account_number);
    if (!sectionMap.has(section)) sectionMap.set(section, new Map());
    const bucketMap = sectionMap.get(section);
    if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
    const acctMap = bucketMap.get(bucket);
    let row = acctMap.get(acct);
    if (!row) {
      row = {
        account_number: acct,
        account_name: r.account_name || "",
        running: new Array(len).fill(0),
        activity: new Array(len).fill(0),
        actualRunning: new Array(len).fill(0),
        forecastRunning: new Array(len).fill(0),
        activityPresentByMonth: new Array(len).fill(undefined),
      };
      acctMap.set(acct, row);
    }
    if (!row.account_name && r.account_name) row.account_name = r.account_name;
    row.running[col] = toNumber(r.running_balance);
    row.activity[col] = toNumber(r.monthly_activity);
    row.actualRunning[col] = toNumber(r.actual_running_balance);
    row.forecastRunning[col] = toNumber(r.forecast_running_balance);
    row.activityPresentByMonth[col] = foldPresence(
      row.activityPresentByMonth[col],
      r.monthly_activity_source_present,
    );
  }

  const sections = [];
  for (const sectionKey of BALANCE_SECTION_ORDER) {
    if (!sectionMap.has(sectionKey)) continue;
    const bucketMap = sectionMap.get(sectionKey);
    const buckets = [...bucketMap.entries()].map(([bucket, acctMap]) => {
      const accounts = [...acctMap.values()]
        .sort((a, b) =>
          compareAccountNumbers(a.account_number, b.account_number),
        )
        .map((a) => ({
          account_number: a.account_number,
          account_name: a.account_name,
          running: a.running,
          activity: a.activity,
          actualRunning: a.actualRunning,
          forecastRunning: a.forecastRunning,
          activityPresentByMonth: a.activityPresentByMonth.map((present) =>
            present === undefined ? null : present,
          ),
          total: a.running[len - 1],
        }));
      const subMonthly = new Array(len).fill(0);
      for (const a of accounts) {
        for (let i = 0; i < len; i++) subMonthly[i] += a.running[i];
      }
      return {
        bucket,
        label: bucketDisplayLabel(bucket),
        accounts,
        subtotal: {
          label: bucketSubtotalLabel(bucket),
          monthly: subMonthly,
          total: subMonthly[len - 1],
        },
      };
    });
    sections.push({
      key: sectionKey,
      label: NOI_SECTION_LABELS[sectionKey] || sectionKey,
      buckets,
    });
  }

  return {
    axis,
    coverage: buildCoverageBand(rows, axis),
    sections,
    hasData: sections.length > 0,
  };
}

export function portfolioScopeNote({ budgetPropertyCount, orgPropertyCount }) {
  const budget = Number(budgetPropertyCount);
  const org = Number(orgPropertyCount);
  const budgetKnown = Number.isFinite(budget) && budget > 0;
  const noun = (n) => (n === 1 ? "property" : "properties");

  if (!budgetKnown) {
    return "Every figure is summed across your organization's budget properties.";
  }
  if (!Number.isFinite(org) || org <= budget) {
    return `Every figure is summed across your organization's ${budget} budget ${noun(budget)}.`;
  }
  const gap = org - budget;
  return (
    `Every figure is summed across the ${budget} of your organization's ${org} ${noun(org)} that have a ` +
    `registered v26 budget workbook. The other ${gap} ${gap === 1 ? "is" : "are"} not in any figure on this page — ` +
    `${gap === 1 ? "it has" : "they have"} no budget to sum, which is also why the property picker elsewhere in ` +
    `Analysis lists ${org}.`
  );
}
