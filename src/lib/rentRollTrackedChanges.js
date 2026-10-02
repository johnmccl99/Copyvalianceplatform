import { supabase } from "./supabaseClient.js";
import {
  ADJ_TYPE_CHARGE_OVERRIDE,
  ADJ_TYPE_FIELD_OVERRIDE,
  ADJ_TYPE_LEASE_RENT_OVERRIDE,
  ADJ_TYPE_LEASE_RENT_OVERRIDE_WORKBOOK,
  ADJ_TYPE_MASTER_LEASE_GROUP,
  ADJ_TYPE_MTM_OCCUPIED,
  ADJ_TYPE_OFF_ENTRATA_LEASE,
  chargeOverrideEntries,
  normalizeUnitKey,
} from "./rentRollAdjustments.js";
import {
  fieldOverrideEntries,
  normalizeFieldKey,
} from "./rentRollFieldOverrides.js";
import { normalizeChargeCode } from "./rentRollChargeColumns.js";
import { isUtilityFormulaValue } from "./rentRollMoneyOverride.js";

const FIELD_COLUMNS = {
  tenant: "tenant_name",
  unitType: "unit_type_name",
  unitSf: "unit_sqft",
  leaseStart: "lease_start",
  leaseEnd: "lease_end",
  deposit: "deposit",
};

const OFF_ENTRATA_COLUMNS = {
  tenant: "tenant_name",
  status: "status",
  leaseStart: "lease_start",
  leaseEnd: "lease_end",
  rentCharges: "rent",
  deposit: "deposit",
};

const RENT_COLUMN = "rentCharges";
const STATUS_COLUMN = "status";
const CHARGE_KEY_PREFIX = "charge:";

const RENT_WRITING_TYPES = new Set([
  ADJ_TYPE_MTM_OCCUPIED,
  ADJ_TYPE_MASTER_LEASE_GROUP,
  ADJ_TYPE_LEASE_RENT_OVERRIDE,
  ADJ_TYPE_LEASE_RENT_OVERRIDE_WORKBOOK,
]);

const blank = (v) => v == null || v === "";

function statedValue(type, payload, target) {
  const p = payload || {};
  switch (target.kind) {
    case "rent": {
      if (type === ADJ_TYPE_OFF_ENTRATA_LEASE)
        return blank(p.rent) ? undefined : Number(p.rent);
      if (!RENT_WRITING_TYPES.has(type)) return undefined;
      return blank(p.rent_override) ? undefined : Number(p.rent_override);
    }
    case "status": {
      if (type === ADJ_TYPE_OFF_ENTRATA_LEASE)
        return blank(p.status) ? undefined : String(p.status);
      if (type === ADJ_TYPE_MTM_OCCUPIED) return p.override_status || "Current";
      return undefined;
    }
    case "charge": {
      if (type !== ADJ_TYPE_CHARGE_OVERRIDE) return undefined;
      const entry = chargeOverrideEntries(p).find(
        (e) => e.code === target.code,
      );
      return entry ? entry.amount : undefined;
    }
    case "field": {
      if (type !== ADJ_TYPE_FIELD_OVERRIDE) return undefined;
      const entry = fieldOverrideEntries(p).find(
        (e) => normalizeFieldKey(e.field) === target.field,
      );
      return entry ? entry.value : undefined;
    }
    case "off_entrata": {
      if (type !== ADJ_TYPE_OFF_ENTRATA_LEASE) return undefined;
      const v = p[target.field];
      return v === undefined ? undefined : v;
    }
    default:
      return undefined;
  }
}

function sameValue(a, b) {
  if (a === undefined || b === undefined) return a === b;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return String(a) === String(b);
}

export function trackedSourceFor(row, columnKey) {
  if (!row || !columnKey) return null;
  const applied = Array.isArray(row.adjustments)
    ? row.adjustments.filter(Boolean)
    : [];
  if (applied.length === 0) return null;

  if (row.source === "adjustment") {
    const field = OFF_ENTRATA_COLUMNS[columnKey];
    if (!field) return null;
    const adj =
      applied.find(
        (a) =>
          a.adjustment_type === ADJ_TYPE_OFF_ENTRATA_LEASE &&
          String(a.id) === String(row.adjustment_id),
      ) || null;
    if (!adj) return null;
    const target =
      columnKey === RENT_COLUMN
        ? { kind: "rent" }
        : columnKey === STATUS_COLUMN
          ? { kind: "status" }
          : { kind: "off_entrata", field };
    return statedValue(adj.adjustment_type, adj.payload, target) === undefined
      ? null
      : { adjustment: adj, target };
  }

  if (columnKey === RENT_COLUMN) {
    const target = { kind: "rent" };
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const a = applied[i];
      if (statedValue(a.adjustment_type, a.payload, target) !== undefined)
        return { adjustment: a, target };
    }
    return null;
  }

  if (columnKey === STATUS_COLUMN) {
    const target = { kind: "status" };
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const a = applied[i];
      if (a.adjustment_type === ADJ_TYPE_MTM_OCCUPIED)
        return { adjustment: a, target };
    }
    return null;
  }

  const bed = normalizeUnitKey(row.split_of_unit_number ?? row.unit_number);
  const onThisBed = (a) =>
    normalizeUnitKey((a.payload || {}).unit_number) === bed;

  if (columnKey.startsWith(CHARGE_KEY_PREFIX)) {
    const code = normalizeChargeCode(columnKey.slice(CHARGE_KEY_PREFIX.length));
    if (!code) return null;
    const target = { kind: "charge", code };
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const a = applied[i];
      if (a.adjustment_type !== ADJ_TYPE_CHARGE_OVERRIDE || !onThisBed(a))
        continue;
      const v = statedValue(a.adjustment_type, a.payload, target);
      if (v !== undefined && !isUtilityFormulaValue(v))
        return { adjustment: a, target };
    }
    return null;
  }

  const field = FIELD_COLUMNS[columnKey];
  if (field) {
    const target = { kind: "field", field };
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const a = applied[i];
      if (a.adjustment_type !== ADJ_TYPE_FIELD_OVERRIDE || !onThisBed(a))
        continue;
      if (statedValue(a.adjustment_type, a.payload, target) !== undefined)
        return { adjustment: a, target };
    }
  }
  return null;
}

function entrataValue(row, target) {
  if (row.source === "adjustment") return null;
  switch (target.kind) {
    case "rent":
      return row.rent ?? null;
    case "status":
      return row.status ?? null;
    case "charge": {
      const ec = row.entrata_charges;
      return ec && Object.prototype.hasOwnProperty.call(ec, target.code)
        ? ec[target.code]
        : null;
    }
    case "field": {
      const ev = row.entrata_values;
      if (ev && Object.prototype.hasOwnProperty.call(ev, target.field))
        return ev[target.field];
      return null;
    }
    default:
      return null;
  }
}

export function trackedChangeFor({
  row,
  columnKey,
  versionsByAdjustment = null,
  authors = {},
}) {
  const src = trackedSourceFor(row, columnKey);
  if (!src) return null;
  const { adjustment: adj, target } = src;
  const type = adj.adjustment_type;
  const current = statedValue(type, adj.payload, target);
  const nameOf = (uid) => (uid && authors && authors[uid]) || null;

  const versions = sortedVersions(versionsByAdjustment, adj.id).filter(
    (v) => v.change_kind !== "DELETE" && v.row_snapshot,
  );

  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const snap = versions[i].row_snapshot;
    const after = statedValue(
      snap.adjustment_type || type,
      snap.payload,
      target,
    );
    if (after === undefined) continue;
    const prevSnap = i > 0 ? versions[i - 1].row_snapshot : null;
    const before = prevSnap
      ? statedValue(prevSnap.adjustment_type || type, prevSnap.payload, target)
      : undefined;
    if (prevSnap && sameValue(before, after)) continue;
    return {
      author: nameOf(versions[i].changed_by),
      at: versions[i].changed_at || null,
      before: before === undefined ? entrataValue(row, target) : before,
      after,
      note: snap.note == null ? null : String(snap.note),
      adjustmentId: adj.id == null ? null : String(adj.id),
    };
  }

  return {
    author: nameOf(adj.updated_by || adj.created_by),
    at: adj.updated_at || adj.created_at || null,
    before: entrataValue(row, target),
    after: current,
    note: adj.note == null ? null : String(adj.note),
    adjustmentId: adj.id == null ? null : String(adj.id),
  };
}

function sortedVersions(versionsByAdjustment, adjustmentId) {
  if (!versionsByAdjustment || adjustmentId == null) return [];
  const key = String(adjustmentId);
  const list =
    versionsByAdjustment instanceof Map
      ? versionsByAdjustment.get(key)
      : versionsByAdjustment[key];
  if (!Array.isArray(list)) return [];
  return [...list]
    .filter(Boolean)
    .sort((a, b) =>
      String(a.changed_at || "").localeCompare(String(b.changed_at || "")),
    );
}

export function indexVersionsByAdjustment(versions) {
  const m = new Map();
  for (const v of Array.isArray(versions) ? versions : []) {
    if (!v || v.adjustment_id == null) continue;
    const k = String(v.adjustment_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  }
  return m;
}

const money = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
};

export const TRACKED_VALUE_LABEL = "Lease override";

export function formatTrackedChange(change, kind = "text") {
  if (!change) return null;
  const fmt = (v) => {
    if (v == null || v === "") return null;
    if (kind === "money") return money(v);
    if (kind === "number") {
      const n = Number(v);
      return Number.isFinite(n) ? n.toLocaleString() : String(v);
    }
    return String(v);
  };
  return {
    ...change,
    before: fmt(change.before),
    after: fmt(change.after),
    valueLabel: TRACKED_VALUE_LABEL,
  };
}

export function trackedChangesForMembers(row, columnKey, history = {}) {
  const members =
    row && Array.isArray(row.tracked_members) ? row.tracked_members : [];
  const kind = trackedColumnKind(columnKey);
  const out = [];
  for (const member of members) {
    const change = trackedChangeFor({
      row: member,
      columnKey,
      versionsByAdjustment: history.versionsByAdjustment || null,
      authors: history.authors || {},
    });
    if (!change) continue;
    const bed =
      member.unit_number == null
        ? null
        : String(member.unit_number).trim() || null;
    out.push({ ...formatTrackedChange(change, kind), bed });
  }
  return out;
}

export function trackedColumnKind(columnKey) {
  if (
    columnKey === RENT_COLUMN ||
    columnKey === "deposit" ||
    columnKey.startsWith(CHARGE_KEY_PREFIX)
  )
    return "money";
  if (columnKey === "unitSf") return "number";
  if (columnKey === "leaseStart" || columnKey === "leaseEnd") return "date";
  return "text";
}

export async function loadTrackedChanges(adjustments) {
  const ids = [
    ...new Set(
      (Array.isArray(adjustments) ? adjustments : [])
        .filter((a) => a && a.id != null)
        .map((a) => String(a.id)),
    ),
  ];
  const empty = { versionsByAdjustment: new Map(), authors: {} };
  if (ids.length === 0) return empty;

  let versions = [];
  try {
    const { data, error } = await supabase
      .from("lease_adjustment_versions")
      .select(
        "id, adjustment_id, adjustment_type, change_kind, changed_by, changed_at, row_snapshot",
      )
      .in("adjustment_id", ids)
      .order("changed_at", { ascending: true });
    if (error) throw error;
    versions = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(
      "loadTrackedChanges: version read failed; marks fall back to adjustment rows",
      e,
    );
  }

  const actorIds = new Set();
  for (const v of versions)
    if (v && v.changed_by) actorIds.add(String(v.changed_by));
  for (const a of Array.isArray(adjustments) ? adjustments : []) {
    if (!a) continue;
    if (a.updated_by) actorIds.add(String(a.updated_by));
    if (a.created_by) actorIds.add(String(a.created_by));
  }

  const authors = {};
  if (actorIds.size > 0) {
    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("auth_id, display_name")
        .in("auth_id", [...actorIds]);
      if (error) throw error;
      for (const u of Array.isArray(data) ? data : []) {
        const name = (u && u.display_name ? String(u.display_name) : "").trim();
        if (u && u.auth_id && name) authors[String(u.auth_id)] = name;
      }
    } catch (e) {
      console.error(
        'loadTrackedChanges: author lookup failed; marks show "Unidentified user"',
        e,
      );
    }
  }

  return { versionsByAdjustment: indexVersionsByAdjustment(versions), authors };
}
