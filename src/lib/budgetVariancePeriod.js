import {
  lastClosedMonth,
  monthKey,
  isMonthKey,
  monthsBetween,
  shiftMonth,
} from "./dateFormat.js";

export function resolveVarianceThrough({
  now = new Date(),
  actualsThrough = null,
  actualsThroughKnown = true,
} = {}) {
  const calendar = lastClosedMonth(now);
  if (!calendar) return null;
  const ingest = isMonthKey(actualsThrough)
    ? actualsThrough
    : monthKey(actualsThrough);
  if (ingest) return ingest < calendar ? ingest : calendar;
  return actualsThroughKnown ? null : calendar;
}

export function monthsInRows(rows) {
  const seen = new Set();
  for (const r of rows || []) {
    const k = monthKey(r?.month_end);
    if (k) seen.add(k);
  }
  return [...seen].sort();
}

export function defaultVariancePeriod(
  rows,
  { now = new Date(), actualsThrough = null, actualsThroughKnown = true } = {},
) {
  const through = resolveVarianceThrough({
    now,
    actualsThrough,
    actualsThroughKnown,
  });
  if (!through) return null;
  const months = monthsInRows(rows);
  const inWindow = months.filter((m) => m <= through);
  if (!inWindow.length) return null;
  return {
    start: inWindow[0],
    end: inWindow[inWindow.length - 1],
    months: inWindow.length,
  };
}

export const FISCAL_YEAR_START_MONTH = 8;

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function fiscalYearStartFor(
  month,
  startMonth = FISCAL_YEAR_START_MONTH,
) {
  if (!isMonthKey(month)) return null;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m >= startMonth ? y : y - 1;
}

export function fiscalYearWindow(
  startYear,
  startMonth = FISCAL_YEAR_START_MONTH,
) {
  if (!Number.isInteger(startYear)) return null;
  const start = `${startYear}-${pad2(startMonth)}`;
  return { start, end: shiftMonth(start, 11), months: 12 };
}

export function fiscalYearDefaultPeriod(
  rows,
  { now = new Date(), startMonth = FISCAL_YEAR_START_MONTH } = {},
) {
  const todayKey = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
  const currentFy = fiscalYearStartFor(todayKey, startMonth);
  const wanted = fiscalYearWindow(currentFy, startMonth);
  const months = monthsInRows(rows);
  if (months.some((m) => m >= wanted.start && m <= wanted.end)) {
    return { period: wanted, wanted, fallback: false };
  }
  const earlier = months
    .map((m) => fiscalYearStartFor(m, startMonth))
    .filter((fy) => fy < currentFy);
  if (!earlier.length) return { period: null, wanted, fallback: false };
  return {
    period: fiscalYearWindow(Math.max(...earlier), startMonth),
    wanted,
    fallback: true,
  };
}

export function firstFutureFiscalYearPeriod(
  rows,
  { now = new Date(), startMonth = FISCAL_YEAR_START_MONTH } = {},
) {
  const todayKey = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
  const currentFy = fiscalYearStartFor(todayKey, startMonth);
  const later = monthsInRows(rows)
    .map((m) => fiscalYearStartFor(m, startMonth))
    .filter((fy) => fy > currentFy);
  if (!later.length) return null;
  return fiscalYearWindow(Math.min(...later), startMonth);
}

export function filterRowsToPeriod(rows, period) {
  if (!period || !isMonthKey(period.start) || !isMonthKey(period.end))
    return rows || [];
  return (rows || []).filter((r) => {
    const k = monthKey(r?.month_end);
    return k != null && k >= period.start && k <= period.end;
  });
}

export function periodCoverage(
  rows,
  period,
  { now = new Date(), actualsThrough = null, actualsThroughKnown = true } = {},
) {
  const through = resolveVarianceThrough({
    now,
    actualsThrough,
    actualsThroughKnown,
  });
  const months = period
    ? monthsInRows(rows).filter((m) => m >= period.start && m <= period.end)
    : monthsInRows(rows);
  const beyond = through ? months.filter((m) => m > through) : months;
  return {
    through,
    months: months.length,
    beyondActuals: beyond.length,
    firstBeyond: beyond[0] || null,
    complete: beyond.length === 0,
  };
}

function normalizeWindow(period) {
  if (!period || !isMonthKey(period.start) || !isMonthKey(period.end))
    return null;
  const span = monthsBetween(period.start, period.end);
  if (span == null) return null;
  return {
    start: period.start,
    end: period.end,
    months: span < 0 ? 0 : span + 1,
  };
}

export function samePeriod(a, b) {
  if (!a || !b) return a == null && b == null;
  return a.start === b.start && a.end === b.end;
}

export function periodMonthCount(period) {
  return normalizeWindow(period)?.months ?? 0;
}

export function priorYearPeriod(period) {
  const win = normalizeWindow(period);
  if (!win) return null;
  const start = shiftMonth(win.start, -12);
  const end = shiftMonth(win.end, -12);
  return normalizeWindow({ start, end });
}

export function makePeriodPair(baselinePeriod, comparePeriod = null) {
  const baseline = normalizeWindow(baselinePeriod);
  if (!baseline) return null;
  const compare = normalizeWindow(comparePeriod) || baseline;
  const linked = samePeriod(baseline, compare);
  return {
    baseline,
    compare: linked ? baseline : compare,
    linked,
    equalLength: baseline.months === compare.months,
  };
}

export function partitionRowsToPeriods(rows, pair) {
  const all = rows || [];
  if (!pair) return { baseline: all, compare: all, union: all, linked: true };
  const baseline = filterRowsToPeriod(all, pair.baseline);
  if (pair.linked) {
    return { baseline, compare: baseline, union: baseline, linked: true };
  }
  const compare = filterRowsToPeriod(all, pair.compare);
  const seen = new Set(baseline);
  const union = [...baseline, ...compare.filter((r) => !seen.has(r))];
  return { baseline, compare, union, linked: false };
}
