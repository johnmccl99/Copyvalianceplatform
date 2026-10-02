import { EMPTY } from "./numberFormat.js";

export const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTH_LONG = [
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
export const MONTH_LONG_NAMES = Object.freeze([...MONTH_LONG]);

export function isMonthKey(ym) {
  return (
    typeof ym === "string" &&
    MONTH_KEY_RE.test(ym) &&
    Number(ym.slice(5, 7)) >= 1 &&
    Number(ym.slice(5, 7)) <= 12
  );
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_ONLY_RE = /^(\d{4})-(\d{2})$/;
const NAKED_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

function toUtcDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const s = value.trim();
    const ymd = s.match(DATE_ONLY_RE);
    if (ymd) return new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]));
    const ym = s.match(MONTH_ONLY_RE);
    if (ym) return new Date(Date.UTC(+ym[1], +ym[2] - 1, 1));
    const normalized = NAKED_TIMESTAMP_RE.test(s)
      ? `${s.replace(" ", "T")}Z`
      : s;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function monthKey(value) {
  const d = toUtcDate(value);
  if (!d) return null;
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseMonthKey(ym) {
  if (!isMonthKey(ym)) return null;
  return { year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) };
}

export function shiftMonth(ym, n) {
  if (!isMonthKey(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + Number(n || 0);
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

export function monthStartIso(ym) {
  if (!isMonthKey(ym)) return null;
  return `${ym}-01`;
}

export function monthEndIso(ym) {
  if (!isMonthKey(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function monthsBetween(startYm, endYm) {
  const a = parseMonthKey(startYm);
  const b = parseMonthKey(endYm);
  if (!a || !b) return null;
  return b.year * 12 + (b.month - 1) - (a.year * 12 + (a.month - 1));
}

export function monthRange(startYm, endYm) {
  const span = monthsBetween(startYm, endYm);
  if (span == null || span < 0) return [];
  const out = [];
  for (let i = 0; i <= span; i++) out.push(shiftMonth(startYm, i));
  return out;
}

export function currentMonthKey(now = new Date()) {
  return monthKey(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  );
}

export function lastClosedMonth(now = new Date()) {
  return shiftMonth(currentMonthKey(now), -1);
}

export function formatMonthLabel(ym, { long = false } = {}) {
  const p = parseMonthKey(ym);
  if (!p) return EMPTY;
  const names = long ? MONTH_LONG : MONTH_SHORT;
  return `${names[p.month - 1]} ${p.year}`;
}

export function toISODate(value) {
  const d = toUtcDate(value);
  if (!d) return null;
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function parseISODate(s) {
  const d = toUtcDate(s);
  return d || null;
}

const DATE_STYLES = {
  full: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
  numeric: { year: "numeric", month: "numeric", day: "numeric" },
  monthYear: { year: "numeric", month: "short" },
  longMonthYear: { year: "numeric", month: "long" },
  weekday: { weekday: "short" },
  weekdayLong: { weekday: "long" },
  monthDay: { month: "short", day: "numeric" },
  monthShort: { month: "short" },
  weekdayFull: {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  },
};

export function formatDate(value, { style = "full", empty = EMPTY } = {}) {
  const d = toUtcDate(value);
  if (!d) return empty;
  const bag = DATE_STYLES[style] || DATE_STYLES.full;
  return d.toLocaleDateString("en-US", { ...bag, timeZone: "UTC" });
}

export function formatDateRange(range, { empty = EMPTY } = {}) {
  const a = toUtcDate(range?.start);
  const b = toUtcDate(range?.end);
  if (!a && !b) return empty;
  if (a && !b) return `${formatDate(a)} – …`;
  if (!a && b) return `… – ${formatDate(b)}`;
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) {
    return `${MONTH_SHORT[a.getUTCMonth()]} ${a.getUTCDate()} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${formatDate(a, { style: "monthDay" })} – ${MONTH_SHORT[b.getUTCMonth()]} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  return `${formatDate(a)} – ${formatDate(b)}`;
}

const TIMESTAMP_STYLES = {
  full: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  date: { year: "numeric", month: "short", day: "numeric" },
  numeric: { year: "numeric", month: "numeric", day: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
  monthDayTime: {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
};

export function formatTimestamp(value, { style = "full", empty = EMPTY } = {}) {
  const d = toUtcDate(value);
  if (!d) return empty;
  const bag = TIMESTAMP_STYLES[style] || TIMESTAMP_STYLES.full;
  return d.toLocaleString("en-US", bag);
}

export function todayISODate(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function calendarDaysBetween(from, to) {
  const a = toUtcDate(from);
  const b = toUtcDate(to);
  if (!a || !b) return null;
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((dayB - dayA) / 86400000);
}

export function dateYear(value) {
  const d = toUtcDate(value);
  return d ? d.getUTCFullYear() : null;
}

export function quarterOfMonth(month1based) {
  const m = Number(month1based);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return Math.floor((m - 1) / 3) + 1;
}

export function formatQuarter(value, { shortYear = false } = {}) {
  const d = toUtcDate(value);
  if (!d) return EMPTY;
  const q = quarterOfMonth(d.getUTCMonth() + 1);
  const y = d.getUTCFullYear();
  return shortYear ? `Q${q} '${String(y).slice(-2)}` : `Q${q} ${y}`;
}

export function parseQuarterLabel(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^Q([1-4])\s+'?(\d{2}|\d{4})$/i);
  if (!m) return null;
  const q = Number(m[1]);
  let y = Number(m[2]);
  if (m[2].length === 2) y = 2000 + y;
  return { year: y, quarter: q };
}

export const PERIOD_TOKENS = Object.freeze(["MTD", "QTD", "YTD", "T12"]);

export const PERIOD_LABELS = Object.freeze({
  MTD: "Month to date",
  QTD: "Quarter to date",
  YTD: "Year to date",
  T12: "Trailing 12 months",
});

export function canonicalPeriodToken(tok) {
  if (typeof tok !== "string") return null;
  const t = tok.trim().toUpperCase();
  if (t === "TTM") return "T12";
  return PERIOD_TOKENS.includes(t) ? t : null;
}

export function periodWindow(token, anchorYm = lastClosedMonth()) {
  const t = canonicalPeriodToken(token);
  const anchor = parseMonthKey(anchorYm);
  if (!t || !anchor) return null;
  let start;
  switch (t) {
    case "MTD":
      start = anchorYm;
      break;
    case "QTD": {
      const q = quarterOfMonth(anchor.month);
      const firstMonth = (q - 1) * 3 + 1;
      start = `${String(anchor.year).padStart(4, "0")}-${String(firstMonth).padStart(2, "0")}`;
      break;
    }
    case "YTD":
      start = `${String(anchor.year).padStart(4, "0")}-01`;
      break;
    case "T12":
      start = shiftMonth(anchorYm, -11);
      break;
    default:
      return null;
  }
  return {
    token: t,
    start,
    end: anchorYm,
    months: monthRange(start, anchorYm),
  };
}

export function parsePeriodString(s) {
  if (typeof s !== "string") return null;
  const str = s.trim();
  if (!str) return null;
  if (/^custom$/i.test(str)) return { kind: "custom" };

  const rel = canonicalPeriodToken(str);
  if (rel) return { kind: "relative", token: rel };

  const ytdYear = str.match(/^YTD\s+(\d{4})$/i);
  if (ytdYear) return { kind: "ytdYear", year: Number(ytdYear[1]) };

  const fy = str.match(/^FY\s+'?(\d{2}|\d{4})$/i);
  if (fy)
    return {
      kind: "fy",
      year: fy[1].length === 2 ? 2000 + Number(fy[1]) : Number(fy[1]),
    };

  const q = parseQuarterLabel(str);
  if (q) return { kind: "quarter", ...q };

  return null;
}
