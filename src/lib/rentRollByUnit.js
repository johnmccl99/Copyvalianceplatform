import {
  BY_UNIT_ROW_KEY,
  isRosterRow,
  leasedAs,
  spaceOption,
  unitStatus,
  OCCUPANCY_MIXED,
  OCCUPANCY_SHORT_LABELS,
  rollOccupancy,
} from "./rentRollView.js";

export const BY_UNIT_NOUN = "unit";

export const BY_UNIT_BASIS = { MATCHING: "matching", WHOLE: "whole" };

export function normalizeByUnitBasis(basis) {
  return basis === BY_UNIT_BASIS.WHOLE
    ? BY_UNIT_BASIS.WHOLE
    : BY_UNIT_BASIS.MATCHING;
}

const VALUE_SEPARATOR = ", ";
const COUNT_MARK = " \u00d7 ";

export const MIXED_PREFIX = "Mixed \u2014 ";

export function distinctValues(values) {
  const counts = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

export function countDistinct(values) {
  const distinct = distinctValues(values);
  if (!distinct.length) return null;
  return distinct
    .map((d) => (d.count > 1 ? d.value + COUNT_MARK + d.count : d.value))
    .join(VALUE_SEPARATOR);
}

export function listDistinct(values) {
  const distinct = distinctValues(values);
  if (!distinct.length) return null;
  return distinct.map((d) => d.value).join(VALUE_SEPARATOR);
}

function combinedOccupancyKey(members) {
  const keys = new Set();
  for (const row of members) {
    const key = rollOccupancy(row);
    if (key) keys.add(key);
  }
  if (!keys.size) return null;
  if (keys.size > 1) return OCCUPANCY_MIXED;
  return [...keys][0];
}

export function summaryValue(values) {
  const distinct = distinctValues(values);
  if (!distinct.length) return null;
  const list = distinct.map((d) => d.value).join(VALUE_SEPARATOR);
  return distinct.length > 1 ? MIXED_PREFIX + list : list;
}

export function countUnits(rows) {
  const seen = new Set();
  let loose = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.unit_id == null || row.unit_id === "") {
      loose += 1;
      continue;
    }
    seen.add(String(row.unit_id));
  }
  return seen.size + loose;
}

export function byUnitRollBasis(rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const marker = row ? row[BY_UNIT_ROW_KEY] : null;
    if (marker) return normalizeByUnitBasis(marker.basis);
  }
  return BY_UNIT_BASIS.MATCHING;
}

export function byUnitBasisSentence(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const whole = byUnitRollBasis(list) === BY_UNIT_BASIS.WHOLE;
  let units = 0;
  let beds = 0;
  for (const row of list) {
    if (!row) continue;
    units += 1;
    const n = Number(
      row[BY_UNIT_ROW_KEY] ? row[BY_UNIT_ROW_KEY].bedCount : NaN,
    );
    beds += Number.isFinite(n) ? n : 1;
  }
  const unitWord = units === 1 ? "unit" : "units";
  const bedWord = beds === 1 ? "bed" : "beds";
  return (
    "One row per unit: each row combines the beds of one apartment, and every" +
    " money column is the sum across them. Unit SF describes the apartment and" +
    " is not summed. " +
    (whole
      ? "Basis: the whole apartment \u2014 where any bed matched the current" +
        " filters, every bed of that apartment is included, so these rows go" +
        " beyond the filter. The "
      : "Basis: only the matching beds \u2014 a row covers the beds of that" +
        " apartment that matched the current filters, and no others. The ") +
    units +
    " " +
    unitWord +
    " below " +
    (units === 1 ? "covers" : "cover") +
    " " +
    beds +
    " " +
    bedWord +
    "."
  );
}

function toAmount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickDate(values, wantEarliest) {
  let best = null;
  for (const value of values) {
    if (value == null || value === "") continue;
    if (best == null) {
      best = value;
      continue;
    }
    const a = Date.parse(best);
    const b = Date.parse(value);
    const cmp =
      Number.isFinite(a) && Number.isFinite(b)
        ? b < a
          ? -1
          : b > a
            ? 1
            : 0
        : String(value).localeCompare(String(best));
    if (wantEarliest ? cmp < 0 : cmp > 0) best = value;
  }
  return best;
}

function sumField(members, read, contributes) {
  let sum = null;
  for (const member of members) {
    if (!contributes(member)) continue;
    const amount = toAmount(read(member));
    if (amount == null) return null;
    sum = (sum == null ? 0 : sum) + amount;
  }
  return sum;
}

const gprContributes = () => true;
const leaseMoneyContributes = (row) => !isRosterRow(row);
const chargeContributes = (row) =>
  !isRosterRow(row) && row && row.lease_id != null;

function chargeValueOf(row, code) {
  if (!row || !row.charges || typeof row.charges !== "object") return null;
  const v = row.charges[code];
  if (v != null) return v;
  return row.charges_observed === true && row.lease_id != null ? 0 : null;
}

export function combineRowsByUnit(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  const chargeColumns =
    options && Array.isArray(options.chargeColumns)
      ? options.chargeColumns
      : [];
  const basis = normalizeByUnitBasis(options && options.basis);
  const extras =
    basis === BY_UNIT_BASIS.WHOLE
      ? indexByUnit(options && options.allRows)
      : null;

  const order = [];
  const groups = new Map();
  for (const row of list) {
    if (!row || row.unit_id == null || row.unit_id === "") {
      order.push(row);
      continue;
    }
    const key = String(row.unit_id);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
      continue;
    }
    const members = [row];
    groups.set(key, members);
    order.push(members);
  }

  return order.map((entry) => {
    if (!Array.isArray(entry)) return entry;
    const members = extras ? withMissingBeds(entry, extras) : entry;
    return combineOneUnit(members, chargeColumns, basis);
  });
}

function indexByUnit(rows) {
  const byUnit = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.unit_id == null || row.unit_id === "") continue;
    const key = String(row.unit_id);
    const list = byUnit.get(key);
    if (list) list.push(row);
    else byUnit.set(key, [row]);
  }
  return byUnit;
}

function withMissingBeds(members, extrasByUnit) {
  const all = extrasByUnit.get(String(members[0].unit_id));
  if (!all || all.length === 0) return members;
  const seen = new Set(members);
  const seenKeys = new Set(members.map(rowIdentity).filter((k) => k != null));
  const out = members.slice();
  for (const row of all) {
    if (seen.has(row)) continue;
    const key = rowIdentity(row);
    if (key != null && seenKeys.has(key)) continue;
    if (key != null) seenKeys.add(key);
    out.push(row);
  }
  return out;
}

function rowIdentity(row) {
  if (!row) return null;
  if (row.row_key != null) return "k:" + String(row.row_key);
  if (row.lease_id != null) return "l:" + String(row.lease_id);
  if (row.space_id != null) return "s:" + String(row.space_id);
  return null;
}

function combineOneUnit(members, chargeColumns, basis) {
  const first = members[0];
  const allRoster = members.every((r) => isRosterRow(r));

  const spaceLabels = listDistinct(members.map((r) => r.unit_number));
  const unitLabel =
    first.unit_label == null ? null : String(first.unit_label).trim();
  const unitCell = !unitLabel
    ? spaceLabels
    : !spaceLabels || spaceLabels === unitLabel
      ? unitLabel
      : unitLabel + " (" + spaceLabels + ")";

  const combined = {
    [BY_UNIT_ROW_KEY]: {
      bedCount: members.length,
      spaceOption: countDistinct(members.map((r) => spaceOption(r))),
      unitStatus: countDistinct(members.map((r) => unitStatus(r))),
      leasedAs: countDistinct(members.map((r) => leasedAs(r))),
      unitStatusSummary: summaryValue(members.map((r) => unitStatus(r))),
      occupancyKey: combinedOccupancyKey(members),
      occupancySummary: summaryValue(
        members.map((r) => OCCUPANCY_SHORT_LABELS[rollOccupancy(r)] || null),
      ),
      basis: normalizeByUnitBasis(basis),
    },
    lease_id: null,
    unit_id: first.unit_id,
    row_key: "unit-" + String(first.unit_id),
    unit_number: unitCell,
    unit_label: first.unit_label != null ? first.unit_label : null,
    unit_type_name: first.unit_type_name != null ? first.unit_type_name : null,
    unit_sqft: first.unit_sqft != null ? first.unit_sqft : null,
    bedspace_sf: null,
    source: allRoster
      ? first.source
      : members.every((r) => r.source === first.source)
        ? first.source
        : "entrata",
    tenant_name: listDistinct(members.map((r) => r.tenant_name)),
    effective_status: countDistinct(
      members.map((r) => r.effective_status || r.status),
    ),
    status: countDistinct(members.map((r) => r.status)),
    lease_start: pickDate(
      members.map((r) => r.lease_start),
      true,
    ),
    lease_end: pickDate(
      members.map((r) => r.lease_end),
      false,
    ),
    is_mtm: members.some((r) => !!r.is_mtm),
    occupied: members.some((r) => !!r.occupied),
    adjusted: members.some((r) => !!r.adjusted),
    tracked_members: members,
    charges_observed: members.every((r) => r.charges_observed === true),
    charges: {},
    gpr: sumField(members, (r) => r.gpr, gprContributes),
    rent_charges: sumField(
      members,
      (r) => r.rent_charges,
      leaseMoneyContributes,
    ),
    total_charges: sumField(
      members,
      (r) => r.total_charges,
      leaseMoneyContributes,
    ),
    net_effective: sumField(
      members,
      (r) => r.net_effective,
      leaseMoneyContributes,
    ),
    deposit: sumField(members, (r) => r.deposit, leaseMoneyContributes),
  };

  for (const col of chargeColumns) {
    if (!col || !col.code) continue;
    const sum = sumField(
      members,
      (r) => chargeValueOf(r, col.code),
      chargeContributes,
    );
    if (sum != null) combined.charges[col.code] = sum;
  }

  return combined;
}
