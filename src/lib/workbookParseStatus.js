export const WORKBOOK_PARSE_STALE_MS = 15 * 60 * 1000;

const IN_FLIGHT_STATUSES = new Set(["queued", "running"]);

export function lastWriteAtMs(row) {
  if (!row || typeof row !== "object") return null;
  let newest = null;
  for (const value of [row.updated_at, row.last_parsed_at, row.created_at]) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

export function isInFlightStatus(status) {
  return IN_FLIGHT_STATUSES.has(status);
}

export function isParseStalled(row, nowMs = Date.now()) {
  if (!isInFlightStatus(row?.last_parse_status)) return false;
  const lastWrite = lastWriteAtMs(row);
  if (lastWrite === null) return true;
  return nowMs - lastWrite >= WORKBOOK_PARSE_STALE_MS;
}

export function isParseInFlight(row, nowMs = Date.now()) {
  return (
    isInFlightStatus(row?.last_parse_status) && !isParseStalled(row, nowMs)
  );
}

export function parseStatusLabel(row, nowMs = Date.now()) {
  const status = row?.last_parse_status;
  if (!status) return "not parsed";
  if (isParseStalled(row, nowMs)) return `${status} · stalled`;
  return status;
}

export function whereStatusUnchanged(query, previousStatus) {
  return previousStatus === null || previousStatus === undefined
    ? query.is("last_parse_status", null)
    : query.eq("last_parse_status", previousStatus);
}

export function parseStalledExplanation(row, nowMs = Date.now()) {
  if (!isParseStalled(row, nowMs)) return null;
  return `This row has claimed "${row.last_parse_status}" since its last write, which is longer than the 15-minute cap on a parse run. No parse can still be in progress, so Re-parse is available again.`;
}
