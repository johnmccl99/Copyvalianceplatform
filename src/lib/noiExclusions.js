import { formatDate } from "./dateFormat.js";

export function noiExclusionMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (r == null || r.account_number == null) continue;
    map.set(String(r.account_number), {
      accountNumber: String(r.account_number),
      reason: r.reason == null ? "" : String(r.reason),
      decidedBy: r.decided_by == null ? "" : String(r.decided_by),
      decidedOn: r.decided_on == null ? "" : String(r.decided_on),
    });
  }
  return map;
}

export function noiExclusionTitle(entry) {
  if (!entry) return null;
  const parts = [];
  if (entry.reason) parts.push(entry.reason);
  const who = [
    entry.decidedBy,
    entry.decidedOn ? formatDate(entry.decidedOn) : "",
  ]
    .filter(Boolean)
    .join(", ");
  const head = `Excluded from NOI${parts.length ? ` \u2014 ${parts.join("; ")}` : ""}`;
  return who ? `${head} (${who})` : head;
}

export function splitNoiExcludedRows(rows, map) {
  const excluded = [];
  const mismatched = [];
  for (const r of rows || []) {
    if (map && map.has(String(r.account_number))) excluded.push(r);
    else mismatched.push(r);
  }
  return { excluded, mismatched };
}
