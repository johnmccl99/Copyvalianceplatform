import { VARIANCE_ALERT_DEFAULTS } from "./varianceAlertConfig.js";

const currency = (n) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function formatVarianceAlertFieldValue(key, value) {
  if (value === undefined) {
    const fallback = VARIANCE_ALERT_DEFAULTS[key];
    return fallback === undefined
      ? "Not set"
      : `Platform default (${formatVarianceAlertFieldValue(key, fallback)})`;
  }
  if (value === null) return "Not set";
  switch (key) {
    case "groupPctThreshold":
    case "accountPctThreshold":
      return `${value}%`;
    case "accountDollarFloor":
    case "groupDollarFloor":
      return Number.isFinite(Number(value)) ? currency(value) : String(value);
    case "enabled":
      return value ? "Enabled" : "Disabled";
    case "eligibleRoles":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "alertBasis":
      return String(value).toUpperCase();
    default:
      return String(value);
  }
}

const sameValue = (a, b) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function varianceAlertFieldChanges(versions, authorNames = new Map()) {
  const nameOf = (id) => {
    if (!id) return null;
    const name =
      authorNames instanceof Map ? authorNames.get(id) : authorNames?.[id];
    return typeof name === "string" && name.trim() ? name.trim() : null;
  };

  const rows = (Array.isArray(versions) ? versions : [])
    .filter((row) => objectOrNull(row))
    .slice()
    .sort((a, b) =>
      String(a.changed_at ?? "").localeCompare(String(b.changed_at ?? "")),
    );

  const out = {};
  for (const row of rows) {
    const after = objectOrNull(row.config) || {};
    const before = objectOrNull(row.prev_config) || {};
    const keys = new Set([...Object.keys(after), ...Object.keys(before)]);
    for (const key of keys) {
      if (sameValue(after[key], before[key])) continue;
      (out[key] ||= []).unshift({
        author: nameOf(row.changed_by),
        at: row.changed_at ?? null,
        before: formatVarianceAlertFieldValue(key, before[key]),
        after: formatVarianceAlertFieldValue(key, after[key]),
        note:
          typeof row.note === "string" && row.note.trim()
            ? row.note.trim()
            : null,
      });
    }
  }
  return out;
}

export function varianceAlertAuthorNames(profiles) {
  const map = new Map();
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (!p?.auth_id) continue;
    const name =
      String(p.display_name ?? "").trim() || String(p.email ?? "").trim();
    if (name) map.set(String(p.auth_id), name);
  }
  return map;
}
