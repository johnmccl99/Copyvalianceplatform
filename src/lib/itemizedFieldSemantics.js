import {
  resolveSemantics,
  resolveActiveBedsSemantic,
} from "./assumptionSemanticCatalog.js";
import { ITEMIZED_EDITOR_COLUMNS } from "./budgetItemized.js";

export const SEMANTIC_DISPLAY = {
  period_amount: {
    label: "Amount",
    unit: "currency",
    hint: "Dollar amount per period landing.",
  },
  stride: {
    label: "Frequency",
    unit: "text",
    hint: "How often the amount lands.",
  },
  window_start: {
    label: "First Month",
    unit: "date",
    hint: "Start of the effective window.",
  },
  window_end: {
    label: "Last Month",
    unit: "date",
    hint: "End of the effective window. Blank means open-ended.",
  },
  growth_rate: {
    label: "Annual increase",
    unit: "fraction",
    hint: "Escalator fraction — 0.03 means 3% a year.",
  },
  numeric_factor: {
    label: "Adjustment",
    unit: "number",
    hint: "Numeric factor. Meaning varies by account.",
  },
  occupancy_input: {
    label: "Occupancy input",
    unit: "number",
    hint: "Read by value shape — flag, ratio, or bed count.",
  },
  dollar_amount: {
    label: "Dollar amount",
    unit: "currency",
    hint: "A dollar amount, not a rate.",
  },
  participation_factor: {
    label: "Participation",
    unit: "fraction",
    hint: "Share of turn counts this line participates in.",
  },
  turn_count: {
    label: "Units turned",
    unit: "count",
    hint: "A unit/bed turn count, not a rate.",
  },
  delinquency_rate: {
    label: "Delinquency rate",
    unit: "fraction",
    hint: "Fraction of revenue — 0.01 means 1%.",
  },
  fee_rate: {
    label: "Fee rate",
    unit: "fraction",
    hint: "Contractual rate — 0.03 means 3%.",
  },
  flag: {
    label: "Active beds flag",
    unit: "flag",
    hint: "0 or 1, used as a switch rather than a quantity.",
  },
  occupancy_ratio: {
    label: "Occupancy",
    unit: "fraction",
    hint: "Fraction occupied — 0.95 means 95%.",
  },
  bed_count: {
    label: "Bed count",
    unit: "count",
    hint: "A per-property bed count.",
  },
};

const FIELD_LABEL_OVERRIDES = {
  "dollar_amount|growth": {
    label: "Monthly fee",
    hint: "A dollar amount, not a rate.",
  },
};

function fallbackFor(field) {
  const col = ITEMIZED_EDITOR_COLUMNS.find((c) => c.field === field);
  return {
    label: col ? col.label : prettifyFieldName(field),
    unit: "text",
    hint: "",
    semantic: null,
  };
}

export function prettifyFieldName(field) {
  return String(field || "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function describeItemizedField({
  category,
  account_number: accountNumber,
  field,
  value,
} = {}) {
  const row = resolveSemantics({
    category,
    account_number: accountNumber,
    field,
  });
  if (!row) return fallbackFor(field);

  let semantic = row.semantic;
  if (semantic === "occupancy_input") {
    const shaped = resolveActiveBedsSemantic(value);
    if (shaped && shaped !== "unclassified" && SEMANTIC_DISPLAY[shaped])
      semantic = shaped;
  }

  const base = SEMANTIC_DISPLAY[semantic];
  if (!base) return { ...fallbackFor(field), semantic };

  const override = FIELD_LABEL_OVERRIDES[`${semantic}|${field}`];
  return { ...base, ...(override || {}), semantic };
}

export function isReinterpretedField({
  category,
  account_number: accountNumber,
  field,
  value,
} = {}) {
  const here = describeItemizedField({
    category,
    account_number: accountNumber,
    field,
    value,
  });
  const def = describeItemizedField({
    category: null,
    account_number: null,
    field,
    value,
  });
  return Boolean(here.semantic) && here.semantic !== def.semantic;
}

export function columnHeaderLabel({ rows, category, field, fallback }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return fallback;

  const semantics = new Set();
  let firstLabel = null;
  for (const row of list) {
    const d = describeItemizedField({
      category,
      account_number: row?.account_number,
      field,
      value: row?.[field],
    });
    if (!d.semantic) return fallback;
    if (!semantics.has(d.semantic)) {
      semantics.add(d.semantic);
      if (firstLabel === null) firstLabel = d.label;
    }
    if (semantics.size > 1) return fallback;
  }
  return firstLabel || fallback;
}

export function isPlausibleRate(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n) < 1;
}

export function asPercentHint(value, { suffix = " a year" } = {}) {
  if (!isPlausibleRate(value)) return "";
  const n = Number(value);
  if (n === 0) return "No increase";
  const pct = Number((n * 100).toFixed(4));
  return `= ${pct}%${suffix}`;
}

export function describesARate({
  category,
  account_number: accountNumber,
  field,
  value,
} = {}) {
  const d = describeItemizedField({
    category,
    account_number: accountNumber,
    field,
    value,
  });
  const rateLike =
    d.semantic === "growth_rate" ||
    d.semantic === "fee_rate" ||
    d.semantic === "delinquency_rate" ||
    d.semantic === "occupancy_ratio";
  return rateLike && isPlausibleRate(value);
}
