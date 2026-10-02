export const OVERRIDABLE_FIELDS = [
  {
    key: "tenant_name",
    label: "Resident",
    column: "Resident",
    type: "text",
    help:
      "The resident's name as it should print. Corrects the Resident column on " +
      "the roll, the PDF and the Excel export, and the name a frozen version " +
      "captures from here on.",
  },
  {
    key: "unit_type_name",
    label: "Unit Type",
    column: "Unit Type",
    type: "text",
    help:
      "The unit type as it should read — Entrata's own value comes from the " +
      "unit record, so correcting it here corrects every bed in the unit that " +
      "carries the label you name.",
  },
  {
    key: "lease_start",
    label: "Lease Start",
    column: "Lease Start",
    type: "date",
    help:
      "The lease start as it should print, as YYYY-MM-DD. Corrects the printed " +
      "date, the date sort and the date filter — it does NOT change whether " +
      "this bed is on the roll for a given as-of date, which Entrata's own " +
      "dates settle before any adjustment is read.",
  },
  {
    key: "lease_end",
    label: "Lease End",
    column: "Lease End",
    type: "date",
    allowsEmpty: true,
    help:
      'The lease end as it should print, as YYYY-MM-DD. "No end date" states a ' +
      "genuinely open-ended (month-to-month) lease, which the roll prints as " +
      "MTM rather than as a date. It does NOT bring a bed back onto a roll " +
      "Entrata's dates excluded: a lease Entrata dates as ended is never " +
      "fetched for that as-of date, so there is no row to correct.",
  },
  {
    key: "unit_sqft",
    label: "Unit SF",
    column: "Unit SF",
    type: "number",
    closedToNewOverrides: true,
    help:
      "The apartment's floor area in square feet — not the bed's. Bedspace SF " +
      "is a separate column from a separate source and is unaffected. On a " +
      "by-unit roll the apartment line reads its first bed, so correcting " +
      "that bed moves the apartment line too.",
  },
  {
    key: "deposit",
    label: "Deposit Held",
    column: "Deposit Held",
    type: "money",
    help:
      "The security deposit still held for this bed — the net of the Security " +
      'Deposit AR rows on the roll. "Genuinely $0.00" states a bed that holds ' +
      "nothing, which a frozen version prints as $0.00 rather than the " +
      "em-dash it prints for a deposit Entrata does not carry.",
  },
];

export const ENTERABLE_FIELDS = OVERRIDABLE_FIELDS.filter(
  (f) => !f.closedToNewOverrides,
);

export const OVERRIDABLE_FIELD_MAP = OVERRIDABLE_FIELDS.reduce((m, f) => {
  m[f.key] = f;
  return m;
}, {});

export function isOverridableField(key) {
  return Object.prototype.hasOwnProperty.call(
    OVERRIDABLE_FIELD_MAP,
    normalizeFieldKey(key),
  );
}

export function overridableFieldLabel(key) {
  const f = OVERRIDABLE_FIELD_MAP[normalizeFieldKey(key)];
  return f ? f.label : String(key == null ? "" : key);
}

export function normalizeFieldKey(key) {
  if (key == null) return "";
  return String(key).trim().toLowerCase();
}

export function isIsoDate(value) {
  const s = String(value == null ? "" : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function fieldOverrideEntries(payload = {}) {
  const raw = Array.isArray(payload.fields) ? payload.fields : [];
  const out = [];
  const seen = new Set();

  for (const entry of raw) {
    if (!entry) continue;
    const key = normalizeFieldKey(entry.field);
    if (!key || !isOverridableField(key)) continue;
    if (seen.has(key)) continue;

    const coerced = coerceFieldOverrideValue(key, entry.value);
    if (!coerced.ok) continue;

    seen.add(key);
    out.push({ field: key, value: coerced.value });
  }

  return out;
}

export function coerceFieldOverrideValue(key, value) {
  const meta = OVERRIDABLE_FIELD_MAP[normalizeFieldKey(key)];
  if (!meta) return { ok: false, value: null };
  if (value == null) return { ok: false, value: null };

  if (meta.type === "date") {
    const s = String(value).trim();
    if (s === "")
      return meta.allowsEmpty
        ? { ok: true, value: "" }
        : { ok: false, value: null };
    return isIsoDate(s) ? { ok: true, value: s } : { ok: false, value: null };
  }

  if (meta.type === "number") {
    if (String(value).trim() === "") return { ok: false, value: null };
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return { ok: false, value: null };
    return { ok: true, value: n };
  }

  if (meta.type === "money") {
    if (String(value).trim() === "") return { ok: false, value: null };
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false, value: null };
    return { ok: true, value: n };
  }

  return { ok: true, value: String(value) };
}

export function applyFieldOverridesToRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];

  return rows.map((row) => {
    const overrides = row && row.field_overrides;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
      return row;

    const entries = Object.entries(overrides)
      .map(([k, v]) => [normalizeFieldKey(k), coerceFieldOverrideValue(k, v)])
      .filter(([, c]) => c.ok)
      .map(([k, c]) => [k, c.value]);
    if (entries.length === 0) return row;

    const next = { ...row };
    const entrata = { ...(row.entrata_values || {}) };

    for (const [key, value] of entries) {
      if (!Object.prototype.hasOwnProperty.call(entrata, key)) {
        entrata[key] = row[key] ?? null;
      }
      next[key] = value;
    }

    if (next.lease_end === "" && !next.is_mtm) {
      if (!Object.prototype.hasOwnProperty.call(entrata, "is_mtm")) {
        entrata.is_mtm = row.is_mtm ?? null;
      }
      next.is_mtm = true;
    }

    next.entrata_values = entrata;
    return next;
  });
}
