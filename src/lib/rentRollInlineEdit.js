import {
  ADJ_TYPE_CHARGE_OVERRIDE,
  ADJ_TYPE_FIELD_OVERRIDE,
  ADJ_TYPE_LEASE_RENT_OVERRIDE,
  ADJ_TYPE_OFF_ENTRATA_LEASE,
  chargeOverrideEntries,
  normalizeUnitKey,
  validateAdjustment,
} from "./rentRollAdjustments.js";
import {
  OVERRIDABLE_FIELD_MAP,
  fieldOverrideEntries,
  normalizeFieldKey,
} from "./rentRollFieldOverrides.js";
import { normalizeChargeCode } from "./rentRollChargeColumns.js";

export const INLINE_MODE_ENTRATA = "entrata";
export const INLINE_MODE_OFF_ENTRATA = "off_entrata";

export const INLINE_KIND_FIELD = "field";
export const INLINE_KIND_RENT = "rent";
export const INLINE_KIND_CHARGE = "charge";
export const INLINE_KIND_OFF_ENTRATA = "off_entrata";

const CHARGE_KEY_PREFIX = "charge:";

export const INLINE_FIELD_COLUMNS = {
  tenant: "tenant_name",
  unitType: "unit_type_name",
  leaseStart: "lease_start",
  leaseEnd: "lease_end",
  deposit: "deposit",
};

export const INLINE_RENT_COLUMN = "rentCharges";

const INLINE_OFF_ENTRATA_COLUMNS = {
  tenant: { field: "tenant_name", type: "text" },
  status: { field: "status", type: "text" },
  leaseStart: { field: "lease_start", type: "date" },
  leaseEnd: { field: "lease_end", type: "date" },
  rentCharges: { field: "rent", type: "money" },
  deposit: { field: "deposit", type: "money" },
};

export function inlineRowMode(row) {
  if (!row) return null;
  if (row.source === "adjustment") {
    return row.adjustment_id != null ? INLINE_MODE_OFF_ENTRATA : null;
  }
  if (row.lease_id == null) return null;
  return normalizeUnitKey(row.unit_number) ? INLINE_MODE_ENTRATA : null;
}

export function isInlineEditableRow(row) {
  return inlineRowMode(row) != null;
}

export function inlineEditableColumn(column, mode) {
  if (!column || !column.key || !mode) return null;

  if (mode === INLINE_MODE_OFF_ENTRATA) {
    const spec = INLINE_OFF_ENTRATA_COLUMNS[column.key];
    if (!spec) return null;
    return {
      kind: INLINE_KIND_OFF_ENTRATA,
      field: spec.field,
      type: spec.type,
    };
  }

  if (column.key === INLINE_RENT_COLUMN) {
    return { kind: INLINE_KIND_RENT, type: "money" };
  }
  if (column.charge === true && column.key.startsWith(CHARGE_KEY_PREFIX)) {
    const code = normalizeChargeCode(
      column.key.slice(CHARGE_KEY_PREFIX.length),
    );
    return code ? { kind: INLINE_KIND_CHARGE, code, type: "money" } : null;
  }
  const field = INLINE_FIELD_COLUMNS[column.key];
  if (!field) return null;
  const meta = OVERRIDABLE_FIELD_MAP[field];
  return meta ? { kind: INLINE_KIND_FIELD, field, type: meta.type } : null;
}

function candidatesFor(row, type) {
  const bed = normalizeUnitKey(row && row.unit_number);
  const applied = Array.isArray(row && row.adjustments) ? row.adjustments : [];
  return applied.filter(
    (a) =>
      a &&
      a.adjustment_type === type &&
      a.is_active !== false &&
      a.id != null &&
      normalizeUnitKey((a.payload || {}).unit_number) === bed,
  );
}

function offEntrataAdjustment(row) {
  const applied = Array.isArray(row && row.adjustments) ? row.adjustments : [];
  return (
    applied.find(
      (a) =>
        a &&
        a.adjustment_type === ADJ_TYPE_OFF_ENTRATA_LEASE &&
        String(a.id) === String(row.adjustment_id),
    ) || null
  );
}

function moneyValue(v) {
  return v == null || v === "" ? "" : v;
}

export function inlineEditInitialValues(row, columns) {
  const mode = inlineRowMode(row);
  const values = {};
  if (!mode) return values;

  if (mode === INLINE_MODE_OFF_ENTRATA) {
    const payload = (offEntrataAdjustment(row) || {}).payload || {};
    for (const col of columns || []) {
      const spec = inlineEditableColumn(col, mode);
      if (!spec) continue;
      const raw = payload[spec.field];
      values[col.key] =
        spec.type === "money"
          ? moneyValue(raw)
          : raw == null
            ? ""
            : String(raw);
    }
    return values;
  }

  const fieldOverrides = (row && row.field_overrides) || {};
  const chargeOverrides = (row && row.charge_overrides) || {};
  const rentAdj = candidatesFor(row, ADJ_TYPE_LEASE_RENT_OVERRIDE)[0] || null;

  for (const col of columns || []) {
    const spec = inlineEditableColumn(col, mode);
    if (!spec) continue;
    if (spec.kind === INLINE_KIND_RENT) {
      values[col.key] = moneyValue(
        rentAdj ? (rentAdj.payload || {}).rent_override : "",
      );
    } else if (spec.kind === INLINE_KIND_CHARGE) {
      values[col.key] = moneyValue(chargeOverrides[spec.code]);
    } else {
      const stated = fieldOverrides[spec.field];
      values[col.key] =
        spec.type === "money"
          ? moneyValue(stated)
          : stated == null
            ? ""
            : String(stated);
    }
  }
  return values;
}

function sameStatement(a, b, type) {
  const aBlank = a == null || a === "";
  const bBlank = b == null || b === "";
  if (aBlank || bBlank) return aBlank && bBlank;
  if (type === "money" || type === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return String(a) === String(b);
}

function statedFields(adj) {
  const out = new Map();
  for (const e of fieldOverrideEntries((adj && adj.payload) || {}))
    out.set(e.field, e.value);
  return out;
}

function statedCharges(adj) {
  const out = new Map();
  for (const e of chargeOverrideEntries((adj && adj.payload) || {}))
    out.set(e.code, e.amount);
  return out;
}

function write(
  action,
  { adjustmentType, adjustmentId = null, payload = null, leaseId = null },
) {
  return { action, adjustmentType, adjustmentId, payload, leaseId };
}

const TOO_MANY =
  "Two adjustments of this kind already apply to this bed. " +
  "Open the full editor below to correct them — inline editing cannot choose " +
  "between them on your behalf.";

export function planInlineEdit({ row, columns, values }) {
  const mode = inlineRowMode(row);
  if (!mode) {
    return {
      writes: [],
      errors: { _row: "This row cannot be edited in place." },
      changed: false,
    };
  }

  const cols = Array.isArray(columns) ? columns : [];
  const initial = inlineEditInitialValues(row, cols);
  const errors = {};
  const writes = [];

  const changes = [];
  for (const col of cols) {
    const spec = inlineEditableColumn(col, mode);
    if (!spec) continue;
    const next = values ? values[col.key] : undefined;
    if (next === undefined) continue;
    if (sameStatement(next, initial[col.key], spec.type)) continue;
    changes.push({ column: col.key, spec, value: next });
  }
  if (changes.length === 0) return { writes: [], errors: {}, changed: false };

  if (mode === INLINE_MODE_OFF_ENTRATA) {
    const adj = offEntrataAdjustment(row);
    if (!adj) {
      return {
        writes: [],
        errors: {
          _row: "The adjustment behind this row could not be read. Reload the roll and try again.",
        },
        changed: true,
      };
    }
    const payload = { ...(adj.payload || {}) };
    for (const change of changes) {
      payload[change.spec.field] = change.value === "" ? "" : change.value;
    }
    const { ok, errors: engineErrors } = validateAdjustment(
      ADJ_TYPE_OFF_ENTRATA_LEASE,
      payload,
      { leaseId: null },
    );
    if (!ok) {
      attachEngineErrors(errors, engineErrors, changes, mode);
      return { writes: [], errors, changed: true };
    }
    writes.push(
      write("update", {
        adjustmentType: ADJ_TYPE_OFF_ENTRATA_LEASE,
        adjustmentId: adj.id,
        payload,
      }),
    );
    return { writes, errors, changed: true };
  }

  const bed = normalizeUnitKey(row.unit_number);

  const fieldChanges = changes.filter((c) => c.spec.kind === INLINE_KIND_FIELD);
  if (fieldChanges.length > 0) {
    const candidates = candidatesFor(row, ADJ_TYPE_FIELD_OVERRIDE);
    if (candidates.length > 1) {
      for (const c of fieldChanges) errors[c.column] = TOO_MANY;
    } else {
      const existing = candidates[0] || null;
      const stated = statedFields(existing);
      for (const c of fieldChanges) {
        const key = normalizeFieldKey(c.spec.field);
        if (c.value === "" || c.value == null) stated.delete(key);
        else stated.set(key, c.value);
      }
      const fields = [...stated.entries()].map(([field, value]) => ({
        field,
        value,
      }));
      if (fields.length === 0) {
        if (existing) {
          writes.push(
            write("deactivate", {
              adjustmentType: ADJ_TYPE_FIELD_OVERRIDE,
              adjustmentId: existing.id,
            }),
          );
        }
      } else {
        const payload = { unit_number: bed, fields };
        const { ok, errors: engineErrors } = validateAdjustment(
          ADJ_TYPE_FIELD_OVERRIDE,
          payload,
          { leaseId: null },
        );
        if (!ok)
          attachEngineErrors(errors, engineErrors, fieldChanges, mode, fields);
        else {
          writes.push(
            write(existing ? "update" : "insert", {
              adjustmentType: ADJ_TYPE_FIELD_OVERRIDE,
              adjustmentId: existing ? existing.id : null,
              payload,
            }),
          );
        }
      }
    }
  }

  const rentChange = changes.find((c) => c.spec.kind === INLINE_KIND_RENT);
  if (rentChange) {
    const candidates = candidatesFor(row, ADJ_TYPE_LEASE_RENT_OVERRIDE);
    if (candidates.length > 1) errors[rentChange.column] = TOO_MANY;
    else {
      const existing = candidates[0] || null;
      if (rentChange.value === "" || rentChange.value == null) {
        if (existing) {
          writes.push(
            write("deactivate", {
              adjustmentType: ADJ_TYPE_LEASE_RENT_OVERRIDE,
              adjustmentId: existing.id,
            }),
          );
        }
      } else {
        const payload = { unit_number: bed, rent_override: rentChange.value };
        const { ok, errors: engineErrors } = validateAdjustment(
          ADJ_TYPE_LEASE_RENT_OVERRIDE,
          payload,
          { leaseId: null },
        );
        if (!ok) {
          errors[rentChange.column] =
            engineErrors.rent_override ||
            engineErrors._type ||
            "Enter the monthly rent in dollars.";
        } else {
          writes.push(
            write(existing ? "update" : "insert", {
              adjustmentType: ADJ_TYPE_LEASE_RENT_OVERRIDE,
              adjustmentId: existing ? existing.id : null,
              payload,
            }),
          );
        }
      }
    }
  }

  const chargeChanges = changes.filter(
    (c) => c.spec.kind === INLINE_KIND_CHARGE,
  );
  if (chargeChanges.length > 0) {
    const candidates = candidatesFor(row, ADJ_TYPE_CHARGE_OVERRIDE);
    if (candidates.length > 1) {
      for (const c of chargeChanges) errors[c.column] = TOO_MANY;
    } else {
      const existing = candidates[0] || null;
      const stated = statedCharges(existing);
      for (const c of chargeChanges) {
        if (c.value === "" || c.value == null) stated.delete(c.spec.code);
        else stated.set(c.spec.code, c.value);
      }
      const charges = [...stated.entries()].map(([charge_code, amount]) => ({
        charge_code,
        amount,
      }));
      if (charges.length === 0) {
        if (existing) {
          writes.push(
            write("deactivate", {
              adjustmentType: ADJ_TYPE_CHARGE_OVERRIDE,
              adjustmentId: existing.id,
            }),
          );
        }
      } else {
        const payload = { unit_number: bed, charges };
        const { ok, errors: engineErrors } = validateAdjustment(
          ADJ_TYPE_CHARGE_OVERRIDE,
          payload,
          { leaseId: null },
        );
        if (!ok)
          attachEngineErrors(
            errors,
            engineErrors,
            chargeChanges,
            mode,
            null,
            charges,
          );
        else {
          writes.push(
            write(existing ? "update" : "insert", {
              adjustmentType: ADJ_TYPE_CHARGE_OVERRIDE,
              adjustmentId: existing ? existing.id : null,
              payload,
            }),
          );
        }
      }
    }
  }

  if (Object.keys(errors).length > 0)
    return { writes: [], errors, changed: true };
  return { writes, errors, changed: true };
}

function attachEngineErrors(
  errors,
  engineErrors,
  changes,
  mode,
  fields = null,
  charges = null,
) {
  const byIndex = engineErrors.fields_rows || engineErrors.charges_rows || null;
  const entries = fields || charges || null;
  if (byIndex && entries) {
    for (const [index, message] of Object.entries(byIndex)) {
      const entry = entries[Number(index)];
      const key =
        entry && (entry.field || normalizeChargeCode(entry.charge_code));
      const change = changes.find((c) =>
        c.spec.field
          ? normalizeFieldKey(c.spec.field) === key
          : c.spec.code === key,
      );
      if (change) errors[change.column] = message;
      else errors._row = message;
    }
  }
  for (const [key, message] of Object.entries(engineErrors)) {
    if (key === "fields_rows" || key === "charges_rows") continue;
    if (typeof message !== "string") continue;
    const change =
      mode === INLINE_MODE_OFF_ENTRATA
        ? changes.find((c) => c.spec.field === key)
        : null;
    if (change) errors[change.column] = message;
    else if (!errors._row) errors._row = message;
  }
  if (Object.keys(errors).length === 0)
    errors._row = "This edit was refused. Check the values and try again.";
}
