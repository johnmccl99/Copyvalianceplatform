import {
  PORTFOLIO_TIME_ZONE,
  normalizeAsOf,
  todayIso,
} from "./entrataLeaseStatus.js";
import { formatAsOf } from "./rentRollAsOfView.js";

export const PERIOD_DAY = "day";
export const PERIOD_MONTH = "month";

export const TENSE_PAST = "past";
export const TENSE_PRESENT = "present";
export const TENSE_FUTURE = "future";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthEnd(iso) {
  const on = normalizeAsOf(iso);
  const year = Number(on.slice(0, 4));
  const month = Number(on.slice(5, 7));
  return `${on.slice(0, 7)}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
}

export function monthStart(iso) {
  return `${normalizeAsOf(iso).slice(0, 7)}-01`;
}

export function rentRollPeriod(asOf, options = {}) {
  const timeZone = options.timeZone || PORTFOLIO_TIME_ZONE;
  const today = options.today
    ? normalizeAsOf(options.today)
    : todayIso(timeZone);
  const on = normalizeAsOf(asOf);

  const laterMonth = on.slice(0, 7) > today.slice(0, 7);
  const tense =
    on === today ? TENSE_PRESENT : on < today ? TENSE_PAST : TENSE_FUTURE;

  if (laterMonth) {
    return {
      kind: PERIOD_MONTH,
      start: monthStart(on),
      end: monthEnd(on),
      asOf: on,
      tense: TENSE_FUTURE,
      today,
    };
  }
  return { kind: PERIOD_DAY, start: on, end: on, asOf: on, tense, today };
}

export function isPreLeasingPeriod(period) {
  return !!period && period.kind === PERIOD_MONTH;
}

export function monthLabel(iso) {
  const on = normalizeAsOf(iso);
  return `${MONTH_NAMES[Number(on.slice(5, 7)) - 1]} ${on.slice(0, 4)}`;
}

export function rentRollPeriodLabel(period) {
  if (!period) return "Current roll";
  if (isPreLeasingPeriod(period))
    return `Pre-leasing roll — ${monthLabel(period.start)}`;
  if (period.tense === TENSE_PAST) return "Historical roll";
  if (period.tense === TENSE_FUTURE) return "Forward roll";
  return "Current roll";
}

export function rentRollPeriodCaption(asOf, options = {}) {
  const period = rentRollPeriod(asOf, options);
  const on = formatAsOf(period.asOf);
  const label = rentRollPeriodLabel(period);
  const basis = isPreLeasingPeriod(period)
    ? ` · charges as of ${formatAsOf(period.end)}`
    : "";
  return on ? `${label} — as of ${on}${basis}` : label;
}

export function rentRollPeriodSentence(period) {
  if (!isPreLeasingPeriod(period)) return "";
  return (
    `Pre-leasing roll for ${monthLabel(period.start)} — every lease in place ` +
    "during the month, including month-to-month, plus every remaining bed as vacant. " +
    "The bed total does not change with the date."
  );
}
