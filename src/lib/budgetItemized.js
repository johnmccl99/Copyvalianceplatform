import {
  ITEMIZED_CATEGORIES,
  FREQUENCY_VALUES,
  INCREASE_FREQUENCY_VALUES,
  FREQUENCY_MONTHS,
  frequencyMonths,
} from "../../netlify/functions/_budget-workbook-parser.js";

export {
  ITEMIZED_CATEGORIES,
  FREQUENCY_VALUES,
  INCREASE_FREQUENCY_VALUES,
  FREQUENCY_MONTHS,
  frequencyMonths,
};

export const ITEMIZED_EDITOR_COLUMNS = [
  {
    field: "line_description",
    label: "Line Description",
    type: "text",
    width: 220,
  },
  { field: "data_source", label: "Data Source", type: "text", width: 130 },
  { field: "reference", label: "Reference", type: "text", width: 120 },
  { field: "frequency", label: "Frequency", type: "frequency", width: 130 },
  { field: "first_month", label: "First Month", type: "date", width: 150 },
  { field: "amount", label: "Amount", type: "number", width: 120 },
  { field: "last_month", label: "Last Month", type: "date", width: 150 },
  { field: "adjustments", label: "Adjustments", type: "number", width: 120 },
  {
    field: "function_2",
    label: "Workbook Function 2",
    type: "text",
    width: 150,
    help: "Column 9 of the v26 workbook's itemized block, stored as text and carried through unchanged. Its meaning varies by category, so this header does not name one — open a row's card to see that row.",
  },
  { field: "growth", label: "Increase", type: "number", width: 100 },
  {
    field: "active_beds_pct",
    label: "Active Beds %",
    type: "number",
    width: 110,
  },
  {
    field: "category_label",
    label: "Category Label",
    type: "text",
    width: 150,
  },
  {
    field: "account_number",
    label: "Account Number",
    type: "text",
    width: 140,
  },
  { field: "noi_build_bucket", label: "NOI Build", type: "text", width: 140 },
  {
    field: "increase_frequency",
    label: "Increase Every",
    type: "increaseFrequency",
    width: 150,
  },
  {
    field: "increase_interval_months",
    label: "Custom Months",
    type: "number",
    width: 130,
  },
];

export const ITEMIZED_PASTE_FIELD_ORDER = ITEMIZED_EDITOR_COLUMNS.slice(
  0,
  13,
).map((c) => c.field);

const FIELD_TYPE = Object.fromEntries(
  ITEMIZED_EDITOR_COLUMNS.map((c) => [c.field, c.type]),
);

export function formatItemizedAmountForDisplay(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).trim());
  if (!Number.isFinite(n) || String(v).trim() === "") return String(v);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const GROWTH_MIN = -100;
export const GROWTH_MAX = 1000;

export function prettyItemizedCategory(cat) {
  return String(cat || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function canonicalizeFrequency(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  const squash = (x) => x.toLowerCase().replace(/[^a-z]/g, "");
  const target = squash(s);
  for (const f of FREQUENCY_VALUES) {
    if (squash(f) === target) return f;
  }
  return s;
}

export function parseToIsoDate(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoOrNull(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return isoOrNull(+m[3], +m[1], +m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 0 && serial < 100000) {
      const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function isoOrNull(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function normalizeItemizedValue(raw, type) {
  const empty = raw == null || String(raw).trim() === "";
  if (type === "number") {
    if (empty) return { value: "", valid: true };
    const cleaned = String(raw).replace(/[$,%\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n)
      ? { value: n, valid: true }
      : { value: String(raw).trim(), valid: false };
  }
  if (type === "date") {
    if (empty) return { value: "", valid: true };
    const iso = parseToIsoDate(raw);
    return iso
      ? { value: iso, valid: true }
      : { value: String(raw).trim(), valid: false };
  }
  if (type === "frequency") {
    if (empty) return { value: "", valid: true };
    return { value: canonicalizeFrequency(raw), valid: true };
  }
  return { value: empty ? "" : String(raw).trim(), valid: true };
}

function looksLikeHeaderRow(cells) {
  const at = (i) =>
    String(cells[i] == null ? "" : cells[i])
      .trim()
      .toLowerCase();
  return at(1) === "data source" || at(3) === "frequency";
}

export function parsePastedItemized(tsv) {
  if (!tsv || typeof tsv !== "string" || !tsv.trim()) {
    return { rows: [], skippedHeader: false, error: "Clipboard was empty." };
  }
  const lines = tsv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = [];
  let skippedHeader = false;
  let sawFirstContentLine = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const cells = line.split("\t");
    if (!sawFirstContentLine) {
      sawFirstContentLine = true;
      if (looksLikeHeaderRow(cells)) {
        skippedHeader = true;
        continue;
      }
    }
    const row = {};
    const cellErrors = {};
    for (let c = 0; c < ITEMIZED_PASTE_FIELD_ORDER.length; c++) {
      const field = ITEMIZED_PASTE_FIELD_ORDER[c];
      const norm = normalizeItemizedValue(cells[c], FIELD_TYPE[field]);
      row[field] = norm.value;
      if (!norm.valid) cellErrors[field] = true;
    }
    if (Object.keys(cellErrors).length) row._cellErrors = cellErrors;
    rows.push(row);
  }
  if (rows.length === 0) {
    return {
      rows: [],
      skippedHeader,
      error: "No data rows found in the pasted content.",
    };
  }
  return { rows, skippedHeader, error: null };
}

export function validateItemizedRow(row, opts = {}) {
  const errors = {};
  const warnings = {};
  const coa =
    opts.coaAccounts instanceof Set
      ? opts.coaAccounts
      : new Set(Array.isArray(opts.coaAccounts) ? opts.coaAccounts : []);
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  const num = (v) => Number(String(v).replace(/[$,%\s]/g, ""));

  if (
    has(row.frequency) &&
    !FREQUENCY_VALUES.has(canonicalizeFrequency(row.frequency))
  ) {
    errors.frequency = `Must be one of: ${[...FREQUENCY_VALUES].join(", ")}`;
  }
  for (const f of ["amount", "adjustments", "active_beds_pct"]) {
    if (has(row[f]) && !Number.isFinite(num(row[f])))
      errors[f] = "Must be a number";
  }
  if (has(row.growth)) {
    const g = num(row.growth);
    if (!Number.isFinite(g)) errors.growth = "Must be a number";
    else if (g < GROWTH_MIN || g > GROWTH_MAX) {
      errors.growth = `Must be between ${GROWTH_MIN} and ${GROWTH_MAX}`;
    }
  }
  const fm = has(row.first_month) ? parseToIsoDate(row.first_month) : null;
  const lm = has(row.last_month) ? parseToIsoDate(row.last_month) : null;
  if (has(row.first_month) && !fm) errors.first_month = "Must be a valid date";
  if (has(row.last_month) && !lm) errors.last_month = "Must be a valid date";
  if (fm && lm && lm < fm)
    errors.last_month = "Must be on or after First Month";

  if (has(row.increase_frequency)) {
    if (!INCREASE_FREQUENCY_VALUES.has(row.increase_frequency)) {
      errors.increase_frequency = "Not a valid increase cadence";
    } else if (
      row.increase_frequency === "Custom" &&
      !has(row.increase_interval_months)
    ) {
      errors.increase_interval_months = "Required when the cadence is Custom";
    } else {
      const im = frequencyMonths(
        row.increase_frequency,
        row.increase_interval_months,
      );
      const lineM = frequencyMonths(row.frequency);
      if (im !== null && lineM !== null && im < lineM) {
        errors.increase_frequency = `Cannot apply more often than the line's own ${row.frequency} frequency`;
      }
    }
  } else if (has(row.increase_interval_months)) {
    errors.increase_interval_months =
      "Set an increase cadence of Custom to use this";
  }

  if (has(row.increase_interval_months)) {
    const n = num(row.increase_interval_months);
    if (!Number.isInteger(n))
      errors.increase_interval_months = "Must be a whole number of months";
    else if (n < 1 || n > 120)
      errors.increase_interval_months = "Must be between 1 and 120 months";
  }
  if (
    has(row.account_number) &&
    coa.size > 0 &&
    !coa.has(String(row.account_number).trim())
  ) {
    warnings.account_number = "Not in this property Chart of Accounts";
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}
