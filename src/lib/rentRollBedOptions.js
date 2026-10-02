import { normalizeUnitKey } from "./rentRollAdjustments.js";

export const BED_MATCH_EMPTY = "empty";
export const BED_MATCH_FOUND = "found";
export const BED_MATCH_MISSING = "missing";
export const BED_MATCH_UNKNOWN = "unknown";

export function bedOptions(rows) {
  if (!Array.isArray(rows)) return [];

  const byKey = new Map();
  for (const row of rows) {
    if (!row) continue;
    const key = normalizeUnitKey(row.unit_number);
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing) {
      existing.rows += 1;
      if (!existing.tenant_name && row.tenant_name)
        existing.tenant_name = String(row.tenant_name);
      continue;
    }

    byKey.set(key, {
      unit_number: key,
      tenant_name: row.tenant_name ? String(row.tenant_name) : "",
      rows: 1,
    });
  }

  return [...byKey.values()].map((o) => ({
    ...o,
    label: bedOptionLabel(o),
  }));
}

function bedOptionLabel(o) {
  const who = o.tenant_name || "Vacant";
  return o.rows > 1
    ? `${o.unit_number} · ${who} (${o.rows} rows)`
    : `${o.unit_number} · ${who}`;
}

export function bedMatchState(value, rows) {
  const key = normalizeUnitKey(value);
  if (!key) return BED_MATCH_EMPTY;
  if (!Array.isArray(rows) || rows.length === 0) return BED_MATCH_UNKNOWN;
  const found = rows.some((r) => r && normalizeUnitKey(r.unit_number) === key);
  return found ? BED_MATCH_FOUND : BED_MATCH_MISSING;
}

export function bedRowCount(value, rows) {
  const key = normalizeUnitKey(value);
  if (!key || !Array.isArray(rows)) return 0;
  return rows.filter((r) => r && normalizeUnitKey(r.unit_number) === key)
    .length;
}

export function bedMatchMessage(value, rows) {
  const state = bedMatchState(value, rows);
  if (state === BED_MATCH_EMPTY) return null;
  if (state === BED_MATCH_UNKNOWN) {
    return {
      tone: "muted",
      text:
        "This roll has not loaded, so the bed cannot be checked. The correction " +
        "will still be matched by this exact label when it does.",
    };
  }
  if (state === BED_MATCH_MISSING) {
    return {
      tone: "warn",
      text:
        "No bed on this roll carries that label. Matching is exact, so this " +
        "correction will change nothing unless the label is spelled the way the " +
        "roll's Unit column spells it — or the bed is not on the roll yet.",
    };
  }
  const n = bedRowCount(value, rows);
  return {
    tone: "ok",
    text:
      n > 1
        ? `Matches ${n} rows on this roll carrying that label.`
        : "Matches one bed on this roll.",
  };
}
