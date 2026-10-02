import {
  isExcludedRentRollStatus,
  isOnRentRollAsOf,
  normalizeAsOf,
} from "./entrataLeaseStatus.js";
import {
  normalizeChargeCode,
  titleCaseChargeCode,
  RENT_CHARGE_CODES,
  MARKET_UTILITY_CHARGE_CODE,
} from "./rentRollChargeColumns.js";
import {
  isUtilityFormulaValue,
  MONEY_FORMULA_VALUE,
} from "./rentRollMoneyOverride.js";
import {
  OVERRIDABLE_FIELDS,
  OVERRIDABLE_FIELD_MAP,
  isOverridableField,
  normalizeFieldKey,
  overridableFieldLabel,
  fieldOverrideEntries,
  coerceFieldOverrideValue,
} from "./rentRollFieldOverrides.js";

export const ADJ_TYPE_MTM_OCCUPIED = "mtm_occupied";
export const ADJ_TYPE_MASTER_LEASE_GROUP = "master_lease_group";
export const ADJ_TYPE_OFF_ENTRATA_LEASE = "off_entrata_lease";
export const ADJ_TYPE_LEASE_RENT_OVERRIDE = "lease_rent_override";
export const ADJ_TYPE_LEASE_RENT_OVERRIDE_WORKBOOK =
  "lease_rent_override_workbook";
export const ADJ_TYPE_CHARGE_OVERRIDE = "charge_override";
export const ADJ_TYPE_FIELD_OVERRIDE = "field_override";

export const ADJUSTMENT_TYPES = [
  {
    key: ADJ_TYPE_MTM_OCCUPIED,
    label: "Rent-controlled MTM (treat as occupied)",
    description:
      "A rent-controlled month-to-month tenant that Entrata may report as " +
      "expired or non-current but who is, in fact, in place and paying. The " +
      "overlay marks the existing lease occupied.",
    requiresLeaseId: true,
    fields: [
      {
        name: "override_status",
        label: "Status label to show",
        type: "text",
        required: false,
        placeholder: "Current",
        help: 'Optional. Defaults to "Current" if left blank.',
      },
      {
        name: "rent_override",
        label: "Monthly rent override ($)",
        type: "number",
        money: true,
        entrataFrom: "rent",
        entrataKey: "lease_id",
        required: false,
        help: 'Optional. Leave on "Keep Entrata\'s figure" to keep the Entrata rent.',
      },
    ],
  },
  {
    key: ADJ_TYPE_MASTER_LEASE_GROUP,
    label: "Master-lease group",
    description:
      "Several Entrata leases that are economically one master lease. The " +
      "overlay tags each member with the group so the roll reads as a single " +
      "arrangement.",
    requiresLeaseId: false,
    fields: [
      {
        name: "group_name",
        label: "Group name",
        type: "text",
        required: true,
        placeholder: "Acme Master Lease",
      },
      {
        name: "master_tenant_name",
        label: "Master tenant",
        type: "text",
        required: false,
        help: "Optional. Display name for the combined arrangement.",
      },
      {
        name: "member_lease_ids",
        label: "Member lease IDs",
        type: "lease_id_list",
        required: true,
        help: "The Entrata leases that belong to this master lease.",
      },
      {
        name: "rent_override",
        label: "Monthly rent override per member unit ($)",
        type: "number",
        money: true,
        required: false,
        fullWidth: true,
        preview: "master_lease_group_rent",
        help:
          "Optional. This is the rent for EACH member unit, not the group total — " +
          "it replaces every member lease's Entrata rent. Leave on \"Keep " +
          "Entrata's figure\" to keep the Entrata rent on each member.",
      },
    ],
  },
  {
    key: ADJ_TYPE_OFF_ENTRATA_LEASE,
    label: "Off-Entrata (third-party-managed) lease",
    description:
      "A lease managed outside Entrata that will never sync. The overlay " +
      "appends it as an additional row, flagged as an adjustment.",
    requiresLeaseId: false,
    fields: [
      { name: "unit_number", label: "Unit", type: "text", required: true },
      { name: "tenant_name", label: "Tenant", type: "text", required: true },
      {
        name: "status",
        label: "Status",
        type: "text",
        required: false,
        placeholder: "Current",
      },
      {
        name: "lease_start",
        label: "Lease start",
        type: "date",
        required: false,
      },
      { name: "lease_end", label: "Lease end", type: "date", required: false },
      {
        name: "rent",
        label: "Monthly rent ($)",
        type: "number",
        required: false,
      },
      {
        name: "deposit",
        label: "Deposit ($)",
        type: "number",
        required: false,
      },
      {
        name: "managed_by",
        label: "Managed by",
        type: "text",
        required: false,
        help: "Third-party manager name.",
      },
    ],
  },
  {
    key: ADJ_TYPE_LEASE_RENT_OVERRIDE,
    label: "Per-lease rent override (bed-keyed)",
    description:
      "Sets the true economic rent for whichever lease occupies a specific bed, " +
      "matched by unit/space number rather than lease id. Use when the Entrata " +
      "rent for a bed is not its economic rent — e.g. a master-lease counterparty " +
      "whose rent was booked via journal entries, so the bed imports at one cent. " +
      "The override re-resolves the occupying lease on every render, so it keeps " +
      "working across Entrata's yearly lease-id rotation.",
    requiresLeaseId: false,
    fields: [
      {
        name: "unit_number",
        label: "Unit / space number (per-bed)",
        type: "text",
        bedPicker: true,
        required: true,
        help:
          "The bed this override applies to, picked off the roll. It applies to " +
          "the lease occupying that bed on the roll date. A bed not on this roll " +
          "can still be named by hand.",
      },
      {
        name: "rent_override",
        label: "Monthly economic rent ($)",
        type: "number",
        money: true,
        entrataFrom: "rent",
        entrataKey: "unit_number",
        required: true,
        help:
          "Replaces the Entrata rent for the lease on this bed. The bed that " +
          "imports at one cent because its rent was booked by journal entry is " +
          "the case this exists for — and an override to 0 states a bed that " +
          "truly pays nothing, which is a different claim from that one.",
      },
      {
        name: "unit_space_id",
        label: "Entrata unitSpaceId",
        type: "text",
        required: false,
        help:
          "Optional. The stable Entrata space id for this bed, when the source " +
          "sheet supplies it. Stored for durability; matching currently uses the " +
          "unit/space number (unit_space_id is not on the roll row yet).",
      },
      {
        name: "tenant_name",
        label: "Counterparty / tenant (audit only)",
        type: "text",
        required: false,
        help: "Optional. Recorded for audit and tie-breaking; not used for matching.",
      },
    ],
  },
  {
    key: ADJ_TYPE_CHARGE_OVERRIDE,
    label: "Charge column overrides (bed-keyed)",
    description:
      "Corrects any of the charge columns on one bed — the figures the roll, " +
      "the PDF and the Excel export all read. Entrata is left untouched: each " +
      "amount is layered over it, so removing the adjustment restores Entrata " +
      "exactly. A charge you do not list is not touched, and a blank amount is " +
      "not an override; to state a charge that genuinely is nil, override it to " +
      "0, which prints $0.00 where the roll would otherwise print an em-dash. " +
      "The Utility Flat Fee column can instead be told to use the utility " +
      "formula: the greater of what Entrata bills and the market rate, taken " +
      "out of rent so the row total does not move. Total Charges and Net " +
      "Effective recompute from the overrides — they are never typed.",
    requiresLeaseId: false,
    fields: [
      {
        name: "unit_number",
        label: "Unit / space number (per-bed)",
        type: "text",
        bedPicker: true,
        required: true,
        placeholder: "1001-1001-A",
        help:
          "Picked off this roll. Matched per bed, so an apartment-level label " +
          "adjusts only the row carrying that label. A bed the roll does not " +
          "carry can still be named by hand — matching stays exact.",
      },
      {
        name: "charges",
        label: "Charge columns to correct",
        type: "charge_override_list",
        required: true,
        fullWidth: true,
        help:
          "Each row names one charge column and the monthly amount this bed is " +
          "charged for it. The picker offers the codes this property bills; a " +
          "code it bills nobody can still be typed, and earns a column of its " +
          "own. Rent and Retail Rent are not charge columns — the Rent column " +
          "has its own override type above.",
      },
    ],
  },
  {
    key: ADJ_TYPE_FIELD_OVERRIDE,
    label: "Row field corrections (bed-keyed)",
    description:
      "Corrects the stored, non-computed values on one bed — the resident's " +
      "name and the unit type today — where Entrata carries them wrongly and " +
      "cannot be edited in time. Entrata is left untouched: the value is " +
      "layered over it, so removing the adjustment restores Entrata exactly. A " +
      "field you do not list is not touched. GPR, Net Effective and Total " +
      "Charges are computed from other cells and are not correctable here.",
    requiresLeaseId: false,
    fields: [
      {
        name: "unit_number",
        label: "Unit / space number (per-bed)",
        type: "text",
        bedPicker: true,
        required: true,
        placeholder: "1001-1001-A",
        help:
          "Picked off this roll. Matched per bed, so an apartment-level label " +
          "adjusts only the row carrying that label. A bed the roll does not " +
          "carry can still be named by hand — matching stays exact.",
      },
      {
        name: "fields",
        label: "Row values to correct",
        type: "field_override_list",
        required: true,
        fullWidth: true,
        help:
          "Each row names one column and the value it should read on this bed. " +
          "An empty value is a real correction — it blanks the column — so " +
          "remove a row you did not mean to state rather than clearing it.",
      },
    ],
  },
  {
    key: ADJ_TYPE_LEASE_RENT_OVERRIDE_WORKBOOK,
    label: "Per-lease rent overrides (workbook upload)",
    description:
      "Upload a workbook of per-bed economic rents. Rows for this property are " +
      "matched and previewed before they are written as per-lease rent overrides.",
    entryMode: true,
    writesAs: ADJ_TYPE_LEASE_RENT_OVERRIDE,
    requiresLeaseId: false,
    fields: [
      {
        name: "workbook",
        label: "Workbook",
        type: "workbook",
        required: true,
        fullWidth: true,
      },
    ],
  },
];

export const ADJUSTMENT_TYPE_MAP = ADJUSTMENT_TYPES.reduce((m, t) => {
  m[t.key] = t;
  return m;
}, {});

export function getAdjustmentTypeMeta(type) {
  return ADJUSTMENT_TYPE_MAP[type] || null;
}

export function adjustmentTypeLabel(type) {
  const meta = ADJUSTMENT_TYPE_MAP[type];
  return meta ? meta.label : type;
}

export function validateAdjustment(
  type,
  payload = {},
  { leaseId = null } = {},
) {
  const errors = {};
  const meta = ADJUSTMENT_TYPE_MAP[type];
  if (!meta) {
    return {
      ok: false,
      errors: { _type: `Unknown adjustment type "${type}".` },
    };
  }
  if (meta.entryMode) {
    throw new Error(
      `Adjustment type "${type}" is an entry mode and cannot be saved directly.`,
    );
  }
  if (meta.requiresLeaseId && (leaseId == null || leaseId === "")) {
    errors._leaseId = "A lease must be selected for this adjustment type.";
  }
  for (const field of meta.fields) {
    const v = payload[field.name];
    if (field.required) {
      if (field.type === "lease_id_list") {
        if (!Array.isArray(v) || v.length === 0) {
          errors[field.name] = `${field.label} is required.`;
        }
      } else if (field.type === "charge_override_list") {
        if (chargeOverrideEntries(payload).length === 0) {
          errors[field.name] =
            `${field.label} is required — name at least one ` +
            "charge column and its amount.";
        }
      } else if (field.type === "field_override_list") {
        if (fieldOverrideEntries(payload).length === 0) {
          errors[field.name] =
            `${field.label} is required — name at least one ` +
            "column and the value it should read.";
        }
      } else if (v == null || v === "") {
        errors[field.name] = `${field.label} is required.`;
      }
    }
    if (
      field.type === "number" &&
      v != null &&
      v !== "" &&
      Number.isNaN(Number(v))
    ) {
      errors[field.name] = `${field.label} must be a number.`;
    }
  }
  if (type === ADJ_TYPE_CHARGE_OVERRIDE) {
    const rows =
      Array.isArray(payload.charges) && payload.charges.length > 0
        ? payload.charges
        : [{ charge_code: payload.charge_code, amount: payload.amount }];
    const seen = new Map();
    const rowErrors = {};
    rows.forEach((entry, i) => {
      const code = normalizeChargeCode(entry && entry.charge_code);
      const amount = entry ? entry.amount : null;
      const blankAmount = amount == null || amount === "";
      if (!code && blankAmount) return;
      if (!code) {
        rowErrors[i] = "Name the charge column this amount belongs to.";
        return;
      }
      if (RENT_CHARGE_CODES.has(code)) {
        rowErrors[i] =
          "Rent and Retail Rent are the Rent column, not charge columns. " +
          "Use the per-lease rent override to correct a rent.";
        return;
      }
      if (
        isUtilityFormulaValue(amount) &&
        code !== MARKET_UTILITY_CHARGE_CODE
      ) {
        rowErrors[i] =
          "The utility formula applies to the Utility Flat Fee column only. " +
          "Enter an amount for this charge instead.";
        return;
      }
      if (
        !isUtilityFormulaValue(amount) &&
        (blankAmount || !Number.isFinite(Number(amount)))
      ) {
        rowErrors[i] =
          "Enter the amount — 0 states a charge that is genuinely nil.";
        return;
      }
      if (seen.has(code)) {
        rowErrors[i] =
          `This charge column is already listed on row ${seen.get(code) + 1}.`;
        return;
      }
      seen.set(code, i);
    });
    if (Object.keys(rowErrors).length > 0) errors.charges_rows = rowErrors;
  }
  if (type === ADJ_TYPE_FIELD_OVERRIDE) {
    const rows = Array.isArray(payload.fields) ? payload.fields : [];
    const seen = new Map();
    const rowErrors = {};
    rows.forEach((entry, i) => {
      const key = normalizeFieldKey(entry && entry.field);
      const value = entry ? entry.value : null;
      if (!key && (value == null || value === "")) return;
      if (!key) {
        rowErrors[i] = "Name the column this value belongs to.";
        return;
      }
      if (!isOverridableField(key)) {
        rowErrors[i] =
          "That column cannot be corrected by an adjustment. " +
          `Correctable columns: ${OVERRIDABLE_FIELDS.map((f) => f.label).join(", ")}.`;
        return;
      }
      if (value == null) {
        rowErrors[i] =
          "Enter the value this column should read, " +
          "or remove the row to leave it as Entrata has it.";
        return;
      }
      if (
        OVERRIDABLE_FIELD_MAP[key].type === "money" &&
        !coerceFieldOverrideValue(key, value).ok
      ) {
        rowErrors[i] =
          "Enter the amount in dollars — 0 states a figure that is truly nil.";
        return;
      }
      if (
        OVERRIDABLE_FIELD_MAP[key].type === "date" &&
        !coerceFieldOverrideValue(key, value).ok
      ) {
        rowErrors[i] = OVERRIDABLE_FIELD_MAP[key].allowsEmpty
          ? 'Enter the date as YYYY-MM-DD, or tick "No end date" to state a ' +
            "lease that is open-ended."
          : "Enter the date as YYYY-MM-DD. A lease always has a start, so an " +
            "empty box here would blank the printed date rather than correct it.";
        return;
      }
      if (
        OVERRIDABLE_FIELD_MAP[key].type === "number" &&
        !coerceFieldOverrideValue(key, value).ok
      ) {
        rowErrors[i] =
          "Enter the area in square feet as a number that is not " +
          "negative, or remove the row to leave it as Entrata has it.";
        return;
      }
      if (seen.has(key)) {
        rowErrors[i] =
          `${overridableFieldLabel(key)} is already listed on row ${seen.get(key) + 1}.`;
        return;
      }
      seen.set(key, i);
    });

    const startAt = seen.get("lease_start");
    const endAt = seen.get("lease_end");
    if (
      startAt != null &&
      endAt != null &&
      !rowErrors[startAt] &&
      !rowErrors[endAt]
    ) {
      const start = coerceFieldOverrideValue(
        "lease_start",
        rows[startAt].value,
      );
      const end = coerceFieldOverrideValue("lease_end", rows[endAt].value);
      if (
        start.ok &&
        end.ok &&
        start.value !== "" &&
        end.value !== "" &&
        end.value < start.value
      ) {
        rowErrors[endAt] =
          "The lease end is before the lease start. Check both " +
          "dates — a lease cannot end before it begins.";
      }
    }

    if (Object.keys(rowErrors).length > 0) errors.fields_rows = rowErrors;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function masterLeaseGroupRentPreview(payload = {}, rollLeaseIds = null) {
  const raw = payload.rent_override;
  if (raw == null || raw === "") return null;
  const perUnit = Number(raw);
  if (Number.isNaN(perUnit)) return null;
  const ids = Array.isArray(payload.member_lease_ids)
    ? payload.member_lease_ids
    : [];
  const onRoll =
    rollLeaseIds == null
      ? null
      : new Set(Array.from(rollLeaseIds, (x) => String(x)));
  const distinct = new Set();
  for (const id of ids) {
    const key = String(id);
    if (onRoll && !onRoll.has(key)) continue;
    distinct.add(key);
  }
  const members = distinct.size;
  return { perUnit, members, total: perUnit * members };
}

function baseRowOf(r, asOf) {
  const status = r.status || "";
  return {
    ...r,
    source: "entrata",
    adjusted: false,
    adjustments: [],
    group: null,
    effective_rent: r.rent == null ? null : Number(r.rent),
    effective_status: status,
    occupied: isOnRentRollAsOf(r, asOf),
  };
}

function applyMtmOccupied({ adj, byLease }) {
  const row = byLease.get(String(adj.lease_id));
  if (!row) return;
  const payload = adj.payload || {};
  row.adjusted = true;
  row.occupied = true;
  row.effective_status = payload.override_status || "Current";
  if (payload.rent_override != null && payload.rent_override !== "") {
    row.effective_rent = Number(payload.rent_override);
  }
  row.adjustments.push(adj);
}

function applyMasterLeaseGroup({ adj, byLease }) {
  const payload = adj.payload || {};
  const ids = Array.isArray(payload.member_lease_ids)
    ? [...new Set(payload.member_lease_ids.map((x) => String(x)))]
    : [];
  const groupInfo = {
    adjustment_id: adj.id || null,
    group_name: payload.group_name || "Master lease",
    master_tenant_name: payload.master_tenant_name || null,
  };
  const hasRentOverride =
    payload.rent_override != null && payload.rent_override !== "";
  for (const id of ids) {
    const row = byLease.get(String(id));
    if (!row) continue;
    row.adjusted = true;
    row.group = groupInfo;
    if (hasRentOverride) row.effective_rent = Number(payload.rent_override);
    row.adjustments.push(adj);
  }
}

function applyOffEntrataLease({ adj, added, asOf }) {
  const payload = adj.payload || {};
  const status = payload.status || "Current";
  const start = payload.lease_start || null;
  const end = payload.lease_end || null;
  const occupied =
    !isExcludedRentRollStatus(status) &&
    (start == null || String(start).slice(0, 10) <= asOf) &&
    (end == null || String(end).slice(0, 10) >= asOf);
  const rent =
    payload.rent == null || payload.rent === "" ? null : Number(payload.rent);
  added.push({
    lease_id: null,
    adjustment_id: adj.id || null,
    unit_id: null,
    unit_number: payload.unit_number || "",
    tenant_name: payload.tenant_name || "",
    tenant_email: "",
    status,
    lease_start: start,
    lease_end: end,
    move_in: null,
    move_out: null,
    rent,
    deposit:
      payload.deposit == null || payload.deposit === ""
        ? null
        : Number(payload.deposit),
    is_mtm: false,
    managed_by: payload.managed_by || null,
    source: "adjustment",
    adjusted: true,
    adjustments: [adj],
    group: null,
    effective_rent: rent,
    effective_status: status,
    occupied,
  });
}

export function normalizeUnitKey(v) {
  return String(v == null ? "" : v).trim();
}

function applyLeaseRentOverride({ adj, byBed }) {
  const payload = adj.payload || {};
  const key = normalizeUnitKey(payload.unit_number);
  if (!key) return;
  const rows = byBed.get(key);
  if (!rows || rows.length === 0) return;
  const hasRentOverride =
    payload.rent_override != null && payload.rent_override !== "";
  if (!hasRentOverride) return;
  const rent = Number(payload.rent_override);
  for (const row of rows) {
    row.adjusted = true;
    row.effective_rent = rent;
    row.adjustments.push(adj);
  }
}

export function chargeOverrideEntries(payload = {}) {
  const raw =
    Array.isArray(payload.charges) && payload.charges.length > 0
      ? payload.charges
      : [{ charge_code: payload.charge_code, amount: payload.amount }];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry) continue;
    const code = normalizeChargeCode(entry.charge_code);
    if (!code) continue;
    if (entry.amount == null || entry.amount === "") continue;
    const amount = isUtilityFormulaValue(entry.amount)
      ? MONEY_FORMULA_VALUE
      : Number(entry.amount);
    if (typeof amount === "number" && !Number.isFinite(amount)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, amount });
  }
  return out;
}

export function chargeOverrideFormRows(payload = {}) {
  const rows =
    Array.isArray(payload.charges) && payload.charges.length > 0
      ? payload.charges.map((e) => ({
          charge_code: e && e.charge_code != null ? String(e.charge_code) : "",
          amount: e && e.amount != null ? e.amount : "",
        }))
      : [];
  if (rows.length === 0 && (payload.charge_code || payload.amount != null)) {
    rows.push({
      charge_code:
        payload.charge_code == null ? "" : String(payload.charge_code),
      amount: payload.amount == null ? "" : payload.amount,
    });
  }
  if (rows.length === 0) rows.push({ charge_code: "", amount: "" });
  return rows;
}

export function summarizeChargeOverride(payload = {}, maxCodes = 3) {
  const entries = chargeOverrideEntries(payload);
  if (entries.length === 0) return "No charge stated";
  const shown = entries
    .slice(0, maxCodes)
    .map(
      (e) =>
        `${titleCaseChargeCode(e.code)} ${
          isUtilityFormulaValue(e.amount)
            ? "per utility formula"
            : formatMoney(e.amount)
        }`,
    );
  const rest = entries.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

function formatMoney(n) {
  return `$${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fieldOverrideFormRows(payload = {}) {
  const rows =
    Array.isArray(payload.fields) && payload.fields.length > 0
      ? payload.fields.map((e) => ({
          field: e && e.field != null ? String(e.field) : "",
          value: e && e.value != null ? String(e.value) : "",
        }))
      : [];
  if (rows.length === 0) rows.push({ field: "", value: null });
  return rows;
}

export function summarizeFieldOverride(payload = {}, maxFields = 3) {
  const entries = fieldOverrideEntries(payload);
  if (entries.length === 0) return "No value stated";
  const shown = entries.slice(0, maxFields).map((e) => {
    const meta = OVERRIDABLE_FIELD_MAP[e.field];
    const shownValue =
      meta && meta.type === "money"
        ? formatMoney(e.value)
        : e.value === ""
          ? "(blank)"
          : e.value;
    return `${overridableFieldLabel(e.field)} → ${shownValue}`;
  });
  const rest = entries.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

function applyChargeOverride({ adj, byBed }) {
  const payload = adj.payload || {};
  const key = normalizeUnitKey(payload.unit_number);
  if (!key) return;
  const entries = chargeOverrideEntries(payload).filter(
    (e) => !RENT_CHARGE_CODES.has(e.code),
  );
  if (entries.length === 0) return;
  const rows = byBed.get(key);
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    row.adjusted = true;
    const next = { ...(row.charge_overrides || {}) };
    for (const { code, amount } of entries) next[code] = amount;
    row.charge_overrides = next;
    row.adjustments.push(adj);
  }
}

function applyFieldOverride({ adj, byBed }) {
  const payload = adj.payload || {};
  const key = normalizeUnitKey(payload.unit_number);
  if (!key) return;
  const entries = fieldOverrideEntries(payload);
  if (entries.length === 0) return;
  const rows = byBed.get(key);
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    row.adjusted = true;
    const next = { ...(row.field_overrides || {}) };
    for (const { field, value } of entries) next[field] = value;
    row.field_overrides = next;
    row.adjustments.push(adj);
  }
}

export const OVERLAY_HANDLERS = {
  [ADJ_TYPE_MTM_OCCUPIED]: applyMtmOccupied,
  [ADJ_TYPE_MASTER_LEASE_GROUP]: applyMasterLeaseGroup,
  [ADJ_TYPE_OFF_ENTRATA_LEASE]: applyOffEntrataLease,
  [ADJ_TYPE_LEASE_RENT_OVERRIDE]: applyLeaseRentOverride,
  [ADJ_TYPE_LEASE_RENT_OVERRIDE_WORKBOOK]: applyLeaseRentOverride,
  [ADJ_TYPE_CHARGE_OVERRIDE]: applyChargeOverride,
  [ADJ_TYPE_FIELD_OVERRIDE]: applyFieldOverride,
};

export const ADJ_APPLY_PRIORITY = {
  [ADJ_TYPE_LEASE_RENT_OVERRIDE]: 1,
  [ADJ_TYPE_LEASE_RENT_OVERRIDE_WORKBOOK]: 1,
};

export function overlayAdjustments(baseRows, adjustments, options = {}) {
  const asOf = normalizeAsOf(options.asOf);
  const base = (baseRows || []).map((r) => baseRowOf(r, asOf));
  const byLease = new Map();
  for (const r of base) {
    if (r.lease_id != null) byLease.set(String(r.lease_id), r);
  }
  const byBed = new Map();
  for (const r of base) {
    const key = normalizeUnitKey(r.unit_number);
    if (!key) continue;
    if (!byBed.has(key)) byBed.set(key, []);
    byBed.get(key).push(r);
  }
  const added = [];
  const active = (adjustments || [])
    .filter((a) => a && a.is_active !== false)
    .map((a, i) => [a, i])
    .sort(
      (x, y) =>
        (ADJ_APPLY_PRIORITY[x[0].adjustment_type] || 0) -
          (ADJ_APPLY_PRIORITY[y[0].adjustment_type] || 0) || x[1] - y[1],
    )
    .map((pair) => pair[0]);
  let applied = 0;
  let skipped = 0;
  for (const adj of active) {
    const handler = OVERLAY_HANDLERS[adj.adjustment_type];
    if (!handler) {
      skipped += 1;
      continue;
    }
    handler({ adj, byLease, byBed, base, added, asOf });
    applied += 1;
  }
  const rows = base.concat(added);
  return {
    rows,
    summary: summarizeOverlay(base, added, {
      applied,
      skippedUnknownTypes: skipped,
    }),
  };
}

export function summarizeOverlay(base, added, extra = {}) {
  const adjustedEntrata = base.filter((r) => r.adjusted).length;
  const totalRent = base
    .concat(added)
    .reduce((acc, r) => acc + (Number(r.effective_rent) || 0), 0);
  const occupied = base.concat(added).filter((r) => r.occupied).length;
  return {
    entrataRows: base.length,
    adjustedEntrataRows: adjustedEntrata,
    addedRows: added.length,
    totalRows: base.length + added.length,
    occupiedRows: occupied,
    totalEffectiveRent: totalRent,
    ...extra,
  };
}

export function displayedAdjustmentCount(summary, fallbackRowCount) {
  if (summary && Number.isFinite(summary.applied)) return summary.applied;
  return Number.isFinite(fallbackRowCount) ? fallbackRowCount : 0;
}

export function entrataBaseParity(baseRows, overlaidRows) {
  const base = baseRows || [];
  if (base.length === 0) return 1;
  const overlaidEntrata = (overlaidRows || []).filter(
    (r) => r.source === "entrata",
  );
  const byLease = new Map();
  for (const r of overlaidEntrata) byLease.set(String(r.lease_id), r);
  let unchanged = 0;
  for (const b of base) {
    const o = byLease.get(String(b.lease_id));
    if (!o) continue;
    const same =
      o.unit_number === (b.unit_number || "") &&
      sameNum(o.rent, b.rent) &&
      o.lease_start === (b.lease_start ?? null) &&
      o.lease_end === (b.lease_end ?? null) &&
      o.status === (b.status || "");
    if (same) unchanged += 1;
  }
  return unchanged / base.length;
}

function sameNum(a, b) {
  const an = a == null ? null : Number(a);
  const bn = b == null ? null : Number(b);
  if (an == null && bn == null) return true;
  return an === bn;
}
