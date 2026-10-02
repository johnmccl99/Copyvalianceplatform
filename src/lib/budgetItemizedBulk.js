import {
  validateItemizedRow,
  FREQUENCY_VALUES,
  ITEMIZED_EDITOR_COLUMNS,
} from "./budgetItemized.js";

export const roundMoney = (n) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const BULK_PANEL_MIN_SELECTION = 2;

export function shouldShowBulkPanel(selectedCount) {
  return Number(selectedCount) >= BULK_PANEL_MIN_SELECTION;
}

export const BULK_FIELDS = {
  amount: { label: "Amount", type: "number", ops: ["set", "delta", "percent"] },
  growth: { label: "Increase", type: "number", ops: ["set", "delta"] },
  frequency: { label: "Frequency", type: "frequency", ops: ["set"] },
  first_month: { label: "First Month", type: "date", ops: ["set"] },
  last_month: { label: "Last Month", type: "date", ops: ["set"] },
};

const fieldLabel = (f) => {
  if (BULK_FIELDS[f]) return BULK_FIELDS[f].label;
  const col = ITEMIZED_EDITOR_COLUMNS.find((c) => c.field === f);
  if (col) return col.label;
  return String(f || "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

export function describeRowError(errors, field, proposed) {
  if (!errors) return "";
  const own = errors[field];
  if (own) return own;

  const otherKeys = Object.keys(errors).filter((k) => k !== field);
  if (otherKeys.length === 0) return "";

  const parts = otherKeys.map((k) => {
    const raw = proposed ? proposed[k] : undefined;
    const shown =
      raw === null || raw === undefined || raw === "" ? "blank" : String(raw);
    return `${fieldLabel(k)} (${shown}) ${lowerFirst(errors[k])}`;
  });

  return parts.join("; ");
}

const lowerFirst = (msg) => {
  const t = String(msg || "");
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
};

export const BULK_OPS = {
  set: { label: "Set to", needsNumber: false },
  delta: { label: "Change by (+/-)", needsNumber: true },
  percent: { label: "Change by (%)", needsNumber: true },
};

export function computeNewValue(row, field, op, rawValue) {
  const spec = BULK_FIELDS[field];
  if (!spec) return { ok: false, error: `Unknown field ${field}` };
  if (!spec.ops.includes(op))
    return {
      ok: false,
      error: `${spec.label} does not support "${BULK_OPS[op]?.label || op}"`,
    };

  if (op === "set") {
    if (spec.type === "frequency") {
      const v = String(rawValue == null ? "" : rawValue).trim();
      if (v !== "" && !FREQUENCY_VALUES.has(v))
        return { ok: false, error: `"${v}" is not a valid frequency` };
      return { ok: true, value: v === "" ? null : v };
    }
    if (spec.type === "date") {
      const v = String(rawValue == null ? "" : rawValue).trim();
      if (v === "") return { ok: true, value: null };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
        return { ok: false, error: `"${v}" is not a YYYY-MM-DD date` };
      return { ok: true, value: v };
    }
    const v = String(rawValue == null ? "" : rawValue).trim();
    if (v === "") return { ok: true, value: null };
    const n = Number(v);
    if (!Number.isFinite(n))
      return { ok: false, error: `"${v}" is not a number` };
    return { ok: true, value: n };
  }

  const base = row ? row[field] : null;
  const baseNum = base === "" || base == null ? null : Number(base);
  if (baseNum == null || !Number.isFinite(baseNum)) {
    return {
      ok: false,
      error: `This line has no ${BULK_FIELDS[field].label.toLowerCase()} to change`,
    };
  }
  const amt = Number(String(rawValue == null ? "" : rawValue).trim());
  if (!Number.isFinite(amt))
    return { ok: false, error: `"${rawValue}" is not a number` };

  if (op === "delta") return { ok: true, value: roundMoney(baseNum + amt) };
  if (op === "percent")
    return { ok: true, value: roundMoney(baseNum * (1 + amt / 100)) };
  return { ok: false, error: `Unknown operation ${op}` };
}

export const displayValue = (v) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

export function computeBulkPreview({ rows, field, op, value, coaAccounts }) {
  const target = Array.isArray(rows) ? rows : [];

  const raw = value == null ? "" : String(value).trim();
  if (raw === "") {
    return {
      changes: [],
      total: target.length,
      changed: 0,
      unchanged: 0,
      errored: 0,
      invalid: 0,
      pending: true,
      ok: false,
    };
  }

  const changes = [];
  let changed = 0,
    unchanged = 0,
    errored = 0,
    invalid = 0;

  for (const row of target) {
    const before = row ? row[field] : null;
    const res = computeNewValue(row, field, op, value);

    if (!res.ok) {
      errored += 1;
      changes.push({
        row,
        key: row?._key,
        before,
        after: null,
        state: "error",
        message: res.error,
      });
      continue;
    }

    const proposed = { ...row, [field]: res.value };
    const v = validateItemizedRow(proposed, { coaAccounts });
    const fieldErr = describeRowError(v.errors, field, proposed);

    const same = String(before ?? "") === String(res.value ?? "");
    if (fieldErr) {
      invalid += 1;
      changes.push({
        row,
        key: row?._key,
        before,
        after: res.value,
        state: "invalid",
        message: fieldErr,
      });
    } else if (same) {
      unchanged += 1;
      changes.push({
        row,
        key: row?._key,
        before,
        after: res.value,
        state: "unchanged",
        message: "",
      });
    } else {
      changed += 1;
      changes.push({
        row,
        key: row?._key,
        before,
        after: res.value,
        state: "changed",
        message: "",
      });
    }
  }

  return {
    changes,
    total: target.length,
    changed,
    unchanged,
    errored,
    invalid,
    pending: false,
    ok: changed > 0 && errored === 0 && invalid === 0,
  };
}

export function displayFieldValue(v, field) {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "amount" && Number.isFinite(Number(v))) {
    return Number(v).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return String(v);
}

export function bulkPreviewSummary(preview) {
  if (!preview || preview.total === 0) return "";
  if (preview.pending) return "Enter a value to see what would change.";
  const parts = [];
  parts.push(
    `${preview.changed} of ${preview.total} selected ${preview.total === 1 ? "line" : "lines"} would change.`,
  );
  if (preview.unchanged > 0)
    parts.push(
      `${preview.unchanged} already ${preview.unchanged === 1 ? "has" : "have"} that value.`,
    );
  if (preview.errored > 0) parts.push(`${preview.errored} cannot be computed.`);
  if (preview.invalid > 0)
    parts.push(`${preview.invalid} would become invalid.`);
  return parts.join(" ");
}
