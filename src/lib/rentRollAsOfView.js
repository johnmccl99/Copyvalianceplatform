import {
  firstOfCurrentMonth,
  nextMonthStart,
  normalizeAsOf,
  todayIso,
  PORTFOLIO_TIME_ZONE,
} from "./entrataLeaseStatus.js";

const MONTHS = [
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

export function formatAsOf(iso) {
  const s = String(iso || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const month = MONTHS[Number(s.slice(5, 7)) - 1];
  const day = Number(s.slice(8, 10));
  if (!month || day < 1 || day > 31) return "";
  return `${month} ${day}, ${s.slice(0, 4)}`;
}

export function defaultAsOf(timeZone = PORTFOLIO_TIME_ZONE) {
  return todayIso(timeZone);
}

export function isDefaultAsOf(iso, timeZone = PORTFOLIO_TIME_ZONE) {
  return normalizeAsOf(iso) === defaultAsOf(timeZone);
}

export function asOfPresets(timeZone = PORTFOLIO_TIME_ZONE) {
  const today = defaultAsOf(timeZone);
  const monthStart = firstOfCurrentMonth(timeZone);
  const presets = [{ key: "today", label: "Today", date: today }];
  if (monthStart !== today)
    presets.push({
      key: "month-start",
      label: "Month start",
      date: monthStart,
    });
  presets.push({
    key: "next-month",
    label: "Next month",
    date: nextMonthStart(monthStart),
  });
  return presets;
}

export function asOfBounds(timeZone = PORTFOLIO_TIME_ZONE) {
  const year = Number(defaultAsOf(timeZone).slice(0, 4));
  return { min: `${year - 1}-01-01`, max: `${year + 5}-12-31` };
}

export function asOfPlausibilityMessage(iso, timeZone = PORTFOLIO_TIME_ZONE) {
  const s = String(iso || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const { min, max } = asOfBounds(timeZone);
  if (s >= min && s <= max) return null;
  return `${formatAsOf(s) || s} is outside the roll's range (${formatAsOf(min)} to ${formatAsOf(max)}). Check the year — the roll was not changed.`;
}

export function rentRollAsOfSentence(iso) {
  const label = formatAsOf(normalizeAsOf(iso));
  return label ? `Rent roll as of ${label}` : "";
}

export const UNIT_STATUS_LIVE_CAPTION = "Live — ignores the as-of date";

export function unitStatusLiveNote(asOf) {
  const label = formatAsOf(asOf);
  const when = label ? `on ${label}` : "on the selected date";
  return (
    "Unit Status is the bed's status in Entrata right now, as of the last sync — " +
    `not its status ${when}. It does not change when you change the as-of date; ` +
    "the lease columns do."
  );
}

const STALE_SYNC_MS = 48 * 60 * 60 * 1000;

export function isSyncStale(maxLastSeen, nowMs = Date.now()) {
  if (!maxLastSeen) return true;
  const t = new Date(maxLastSeen).getTime();
  if (Number.isNaN(t)) return true;
  return nowMs - t > STALE_SYNC_MS;
}

export function emptyRollSentence({
  asOf,
  maxLastSeen,
  hasAnyLeases = null,
  nowMs = Date.now(),
} = {}) {
  const label = formatAsOf(normalizeAsOf(asOf));
  const stale = isSyncStale(maxLastSeen, nowMs);
  const staleClause =
    " The Entrata connector has not completed a recent successful sweep for this org, so this may be a sync gap — check Connectors in Settings.";
  const portfolioClause = stale
    ? ""
    : ` Most recent Entrata data across the portfolio: ${new Date(maxLastSeen).toLocaleString()}.`;

  if (hasAnyLeases === false) {
    const base = "No lease has ever synced for this property, at any date.";
    if (stale) return `${base}${staleClause}`;
    return `${base}${portfolioClause} Other properties are syncing, so this one has no lease data in Entrata rather than a gap on this particular date — no date will show a roll until it does. The property's underwritten rent assumptions are available now under Quarterly Reporting → Underwriting Model.`;
  }

  const base = label
    ? `No lease was in term on ${label}.`
    : "No lease was in term on the selected date.";

  if (stale) return `${base}${staleClause}`;

  if (hasAnyLeases === true) {
    return `${base}${portfolioClause} This property has leases on file, so it is between terms on this date rather than missing data — pick another date to see the roll at a different point in the year.`;
  }

  return `${base}${portfolioClause}`;
}

export function rentRollPdfSubtitle({
  asOf,
  maxLastSeen,
  freshnessKnown = true,
  includeOneTime = false,
  periodCaption = null,
} = {}) {
  const rollLine = periodCaption || rentRollAsOfSentence(asOf);
  const basis = includeOneTime ? "Charges include one-time charges" : null;
  const head = rollLine && basis ? `${rollLine} · ${basis}` : rollLine || basis;
  if (!freshnessKnown) return head;
  const freshness = maxLastSeen
    ? `Data current as of ${new Date(maxLastSeen).toLocaleString()}`
    : "Data freshness unknown";
  return head ? `${head} · ${freshness}` : freshness;
}

export function rentRollPdfFilename(propertyName, asOf) {
  const safe = String(propertyName || "Property").replace(/[^a-z0-9]+/gi, "-");
  return `RentRoll-${safe}-${normalizeAsOf(asOf)}.pdf`;
}
