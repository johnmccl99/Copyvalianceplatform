import {
  MONTH_LONG_NAMES,
  formatMonthLabel,
  isMonthKey,
  monthEndIso,
  monthKey,
  monthRange,
  parseMonthKey,
  shiftMonth,
} from "./dateFormat.js";
import { pctChange } from "./variancePercent.js";

export const NO_COUNTERPART = "—";

const YEAR_JOIN = " ／ ";

function monthOfYearName(ym) {
  const p = parseMonthKey(ym);
  return p ? MONTH_LONG_NAMES[p.month - 1] : null;
}

function yearOf(ym) {
  return parseMonthKey(ym)?.year ?? null;
}

function occurrenceTokens(months) {
  const seen = new Map();
  return months.map((m) => {
    const moy = parseMonthKey(m)?.month ?? 0;
    const n = seen.get(moy) || 0;
    seen.set(moy, n + 1);
    return { month: m, token: `${moy}#${n}` };
  });
}

export function buildPeriodPairColumns(pair) {
  if (!pair || pair.linked) return [];
  const baselineMonths = monthRange(pair.baseline?.start, pair.baseline?.end);
  const compareMonths = monthRange(pair.compare?.start, pair.compare?.end);

  const compareByToken = new Map();
  for (const { month, token } of occurrenceTokens(compareMonths)) {
    compareByToken.set(token, month);
  }

  const columns = [];
  for (const { month, token } of occurrenceTokens(baselineMonths)) {
    const counterpart = compareByToken.get(token) ?? null;
    if (counterpart) compareByToken.delete(token);
    columns.push({ baselineMonth: month, compareMonth: counterpart });
  }
  for (const month of compareByToken.values()) {
    columns.push({ baselineMonth: null, compareMonth: month });
  }

  const shift = alignmentShiftMonths(pair);
  const anchorOf = (c) =>
    c.baselineMonth ||
    (shift == null ? c.compareMonth : shiftMonth(c.compareMonth, shift)) ||
    "";
  columns.sort((a, b) => {
    const cmp = String(anchorOf(a)).localeCompare(String(anchorOf(b)));
    return cmp !== 0
      ? cmp
      : String(a.compareMonth || "").localeCompare(
          String(b.compareMonth || ""),
        );
  });

  return columns.map((c, index) => {
    const named = c.baselineMonth || c.compareMonth;
    const baselineYear = yearOf(c.baselineMonth);
    const compareYear = yearOf(c.compareMonth);
    return {
      index,
      key: `${c.baselineMonth || NO_COUNTERPART}~${c.compareMonth || NO_COUNTERPART}`,
      monthName: monthOfYearName(named),
      baselineMonth: c.baselineMonth,
      compareMonth: c.compareMonth,
      baselineYear,
      compareYear,
      paired: Boolean(c.baselineMonth && c.compareMonth),
      yearsLabel: `${baselineYear ?? NO_COUNTERPART}${YEAR_JOIN}${compareYear ?? NO_COUNTERPART}`,
      label: `${monthOfYearName(named)} ${baselineYear ?? NO_COUNTERPART}${YEAR_JOIN}${compareYear ?? NO_COUNTERPART}`,
      month_end: monthEndIso(named),
    };
  });
}

export function alignmentShiftMonths(pair) {
  const a = pair?.compare?.start;
  const b = pair?.baseline?.start;
  if (!isMonthKey(a) || !isMonthKey(b)) return null;
  return 12 * (parseMonthKey(b).year - parseMonthKey(a).year);
}

function rowIdentityKey(row) {
  return [
    row?.account_number ?? "",
    row?.line_id ?? "",
    row?.line_label ?? "",
  ].join("|");
}

function addPreservingNull(acc, value) {
  if (value === null || value === undefined || value === "") return acc;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return acc;
  return (acc === null ? 0 : acc) + n;
}

export function pairRowsToColumns(partition, columns) {
  const part = partition || {
    baseline: [],
    compare: [],
    union: [],
    linked: true,
  };
  if (part.linked || !Array.isArray(columns) || columns.length === 0) {
    return part.union || [];
  }

  const columnOfBaselineMonth = new Map();
  const columnOfCompareMonth = new Map();
  for (const c of columns) {
    if (c.baselineMonth) columnOfBaselineMonth.set(c.baselineMonth, c);
    if (c.compareMonth) columnOfCompareMonth.set(c.compareMonth, c);
  }

  const cells = new Map();
  const cellFor = (column, row) => {
    const id = rowIdentityKey(row);
    const key = `${column.index}\u0000${id}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        column,
        template: row,
        budget: null,
        actual: null,
        baselineSeen: false,
        compareSeen: false,
      };
      cells.set(key, cell);
    }
    return cell;
  };

  for (const row of part.baseline || []) {
    const column = columnOfBaselineMonth.get(monthKey(row?.month_end));
    if (!column) continue;
    const cell = cellFor(column, row);
    cell.budget = addPreservingNull(cell.budget, row?.budget_amount);
    cell.baselineSeen = true;
  }
  for (const row of part.compare || []) {
    const column = columnOfCompareMonth.get(monthKey(row?.month_end));
    if (!column) continue;
    const cell = cellFor(column, row);
    cell.actual = addPreservingNull(cell.actual, row?.actual_amount);
    cell.compareSeen = true;
  }

  const out = [];
  for (const cell of cells.values()) {
    const { column, template } = cell;
    out.push({
      ...template,
      month_index: column.index,
      month_end: column.month_end,
      budget_amount: cell.budget,
      actual_amount: cell.actual,
      baseline_covers_month: cell.baselineSeen,
      compare_covers_month: cell.compareSeen,
      pair_column_key: column.key,
      pair_baseline_month: column.baselineMonth,
      pair_compare_month: column.compareMonth,
      pair_paired: column.paired,
    });
  }
  out.sort((a, b) => a.month_index - b.month_index);
  return out;
}

export function pairColumnCoverage(columns) {
  const cols = Array.isArray(columns) ? columns : [];
  let paired = 0;
  let baselineOnly = 0;
  let compareOnly = 0;
  for (const c of cols) {
    if (c.baselineMonth && c.compareMonth) paired += 1;
    else if (c.baselineMonth) baselineOnly += 1;
    else if (c.compareMonth) compareOnly += 1;
  }
  return { paired, baselineOnly, compareOnly, columns: cols.length };
}

export function periodPairTotalHeading(
  pair,
  { totalLabel = "Period total" } = {},
) {
  const baselineMonths = pair?.baseline?.months ?? 0;
  const compareMonths = pair?.compare?.months ?? 0;
  const average =
    Boolean(pair) && !pair.linked && baselineMonths !== compareMonths;
  return {
    average,
    label: average ? "Average / month" : totalLabel,
    sidesLabel:
      pair && !pair.linked
        ? `${periodSpanLabel(pair.baseline)}${YEAR_JOIN}${periodSpanLabel(pair.compare)}`
        : "",
    baselineMonths,
    compareMonths,
  };
}

export function averagePeriodTotals(rows, pair) {
  const divisors = averageDivisors(pair);
  if (!divisors) return rows || [];

  const baselineMonths = divisors.baseline;
  const compareMonths = divisors.compare;

  const perMonth = (value, months) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n / months : null;
  };

  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row) return row;
    if (row.kind === "header") return row;
    const budget = perMonth(row.budget, baselineMonths);
    const actual = perMonth(row.actual, compareMonths);
    const absent = budget === null || actual === null;
    const noNegZero = (n) => (n === 0 ? 0 : n);
    const variance = absent ? null : noNegZero(actual - budget);
    return {
      ...row,
      budget: budget === null ? null : noNegZero(budget),
      actual: actual === null ? null : noNegZero(actual),
      variance,
      pct_variance: absent ? null : noNegZero(pctChange(actual, budget)),
      period_total_is_average: true,
      period_total_actual_sum:
        actual === null ? null : noNegZero(Number(row.actual)),
      period_total_baseline_months: baselineMonths,
      period_total_compare_months: compareMonths,
    };
  });
}

export function averageDivisors(pair) {
  const heading = periodPairTotalHeading(pair);
  if (!heading.average) return null;
  if (!(heading.baselineMonths > 0) || !(heading.compareMonths > 0))
    return null;
  return { baseline: heading.baselineMonths, compare: heading.compareMonths };
}

export function pairCoverageSentence(pair, columns) {
  if (!pair) return { text: "", nothingPaired: false };
  const spans = `${periodSpanLabel(pair.baseline)} against ${periodSpanLabel(pair.compare)}`;
  if (pair.linked) {
    return {
      text: `${spans} — the same months on both sides, so every month pairs.`,
      nothingPaired: false,
    };
  }
  const { paired, baselineOnly, compareOnly } = pairColumnCoverage(columns);
  if (paired === 0) {
    return {
      text: `${spans} — these two windows share no calendar month, so nothing is paired and no variance is struck.`,
      nothingPaired: true,
    };
  }
  const unmatched = baselineOnly + compareOnly;
  const pairs = `${paired} ${paired === 1 ? "month pairs" : "months pair"} by calendar month`;
  const tail =
    unmatched === 0
      ? "."
      : `; ${unmatched} ${unmatched === 1 ? "month keeps its column" : "months keep their columns"}` +
        " with an em-dash on the side that does not reach it, and no variance.";
  return { text: `${spans} — ${pairs}${tail}`, nothingPaired: false };
}

export function periodSpanLabel(window) {
  if (!window || !isMonthKey(window.start) || !isMonthKey(window.end))
    return NO_COUNTERPART;
  const start = formatMonthLabel(window.start);
  if (window.start === window.end) return start;
  return `${start} – ${formatMonthLabel(window.end)}`;
}
