export const RENT_PLAUSIBLE_MIN = 100;

export function effectiveRentOf(row) {
  if (!row) return null;
  const raw = row.effective_rent != null ? row.effective_rent : row.rent;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const ROSTER_SOURCE = "roster";

export function isRosterRow(row) {
  return !!row && row.source === ROSTER_SOURCE;
}

export const BY_UNIT_ROW_KEY = "by_unit";

export function isByUnitRow(row) {
  return !!row && !!row[BY_UNIT_ROW_KEY];
}

export function isByUnitRoll(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) if (isByUnitRow(row)) return true;
  return false;
}

export function byUnitCell(row, key) {
  if (!isByUnitRow(row)) return null;
  const value = row[BY_UNIT_ROW_KEY][key];
  return value == null ? null : value;
}

export function byUnitBedCount(row) {
  if (!isByUnitRow(row)) return null;
  const n = Number(row[BY_UNIT_ROW_KEY].bedCount);
  return Number.isFinite(n) ? n : null;
}

const ROW_NOUNS = { bed: "bed", unit: "unit", lease: "lease" };

export function rowNounSingular(noun) {
  return ROW_NOUNS[noun] || ROW_NOUNS.lease;
}

export function rowNounPlural(noun) {
  return rowNounSingular(noun) + "s";
}

export function rentCoverage(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => !isRosterRow(r));
  let recorded = 0;
  let missing = 0;
  let implausible = 0;
  for (const row of list) {
    const rent = effectiveRentOf(row);
    const leaseRent = row ? Number(row.split_unit_rent_total) : NaN;
    const basis = Number.isFinite(leaseRent) ? leaseRent : rent;
    if (rent == null) missing += 1;
    else if (basis < RENT_PLAUSIBLE_MIN) implausible += 1;
    else recorded += 1;
  }
  return { total: list.length, recorded, missing, implausible };
}

const leaseCount = (n) => n + (n === 1 ? " lease" : " leases");

export function rentCoverageHeadline(coverage) {
  const c = coverage || {};
  if (!c.total) return null;
  const pct = Math.round((c.recorded / c.total) * 100);
  return (
    c.recorded +
    " of " +
    leaseCount(c.total) +
    " (" +
    pct +
    "%) carry a recorded rent of $" +
    RENT_PLAUSIBLE_MIN +
    " or more."
  );
}

export function rentCoverageCompact(coverage) {
  const c = coverage || {};
  if (!c.total) return null;
  return c.recorded + " of " + c.total + " with a recorded rent";
}

export function rentCoverageSentence(coverage) {
  const c = coverage || {};
  if (!c.total) return null;

  const lease = leaseCount;
  const head = rentCoverageHeadline(c);

  const gaps = [];
  if (c.missing > 0) {
    gaps.push(
      lease(c.missing) +
        (c.missing === 1 ? " has" : " have") +
        " no rent recorded",
    );
  }
  if (c.implausible > 0) {
    gaps.push(
      lease(c.implausible) +
        (c.implausible === 1 ? " records" : " record") +
        " less than $" +
        RENT_PLAUSIBLE_MIN,
    );
  }
  if (!gaps.length) return head;

  return (
    head +
    " " +
    gaps.join(" and ") +
    ". The Monthly Rent figure above sums every value as synced, including those."
  );
}

function searchHaystack(row) {
  if (!row) return "";
  return [row.unit_number, row.tenant_name]
    .filter((v) => v != null && v !== "")
    .join(" ")
    .toLowerCase();
}

export function searchRows(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const terms = String(query == null ? "" : query)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return list;
  return list.filter((row) => {
    const hay = searchHaystack(row);
    return terms.every((t) => hay.includes(t));
  });
}

export const ALL_STATUSES = "__all__";
export const NO_STATUS = "__none__";
export const NO_STATUS_LABEL = "No status recorded";

export function statusOf(row) {
  if (!row) return null;
  const s = row.effective_status || row.status;
  return s == null || s === "" ? null : String(s);
}

export const CURRENT_ROLL = "__current_roll__";
export const PRE_LEASING_ROLL = "__pre_leasing_roll__";
export const CURRENT_ROLL_LABEL = "Current roll";
export const PRE_LEASING_ROLL_LABEL = "Pre-leasing roll";

export function isStatusPreset(value) {
  return value === CURRENT_ROLL || value === PRE_LEASING_ROLL;
}

export function isRollPreset(value) {
  return isStatusPreset(value);
}

export function matchesStatusPreset() {
  return true;
}

export function statusOptions(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const rollLabel = options.rollLabel || CURRENT_ROLL_LABEL;
  const counts = new Map();
  let none = 0;
  for (const row of list) {
    const s = statusOf(row);
    if (s == null) none += 1;
    else counts.set(s, (counts.get(s) || 0) + 1);
  }
  const opts = [...counts.keys()]
    .sort((a, b) => collator.compare(a, b))
    .map((s) => ({ value: s, label: s, count: counts.get(s) }));
  if (none > 0)
    opts.push({ value: NO_STATUS, label: NO_STATUS_LABEL, count: none });
  const presetCount = (preset) =>
    list.filter((row) => matchesStatusPreset(row, preset)).length;
  return [
    {
      value: CURRENT_ROLL,
      label: rollLabel,
      count: presetCount(CURRENT_ROLL),
      preset: true,
    },
    ...opts,
  ];
}

export function filterByStatus(rows, value) {
  const list = Array.isArray(rows) ? rows : [];
  if (!value || value === ALL_STATUSES) return list;
  if (isStatusPreset(value))
    return list.filter((row) => matchesStatusPreset(row, value));
  if (value === NO_STATUS) return list.filter((row) => statusOf(row) == null);
  return list.filter((row) => statusOf(row) === value);
}

export function filterResultSentence(shown, total, options) {
  const o = options || {};
  const q = String(o.query == null ? "" : o.query).trim();
  const statusValue = o.statusValue || null;
  const statusLabel = isStatusPreset(statusValue)
    ? null
    : o.statusLabel || null;
  const columnLabels = (
    Array.isArray(o.columnLabels) ? o.columnLabels : []
  ).filter(Boolean);
  const rangeLabels = (
    Array.isArray(o.rangeLabels) ? o.rangeLabels : []
  ).filter(Boolean);
  if (!q && !statusLabel && !columnLabels.length && !rangeLabels.length)
    return null;

  const noun = o.noun || "lease";
  const plural = (n) => noun + (n === 1 ? "" : "s");

  const statusPhrase = !statusLabel
    ? null
    : statusLabel === NO_STATUS_LABEL
      ? "with no status recorded"
      : "with status " + statusLabel;

  const andList = (items) =>
    items.length <= 1
      ? items.join("")
      : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  const columnPhrase = columnLabels.length
    ? "filtered by " + andList(columnLabels)
    : null;
  const rangePhrase = rangeLabels.length
    ? "with " + andList(rangeLabels)
    : null;

  if (shown === 0) {
    const colTail = [columnPhrase, rangePhrase]
      .filter(Boolean)
      .map((p) => ", " + p)
      .join("");
    if (q)
      return (
        "No " +
        noun +
        ' matches "' +
        q +
        '"' +
        (statusPhrase ? " " + statusPhrase : "") +
        colTail +
        "."
      );
    if (statusLabel) {
      return statusLabel === NO_STATUS_LABEL
        ? "Every " +
            noun +
            " on this roll has a status recorded" +
            colTail +
            "."
        : "No " + noun + " has status " + statusLabel + colTail + ".";
    }
    if (columnLabels.length) {
      return (
        "No " +
        noun +
        " matches the column filters on " +
        andList(columnLabels) +
        (rangePhrase ? " " + rangePhrase : "") +
        "."
      );
    }
    return "No " + noun + " has " + andList(rangeLabels) + ".";
  }

  const tail = [
    q ? 'matching "' + q + '"' : null,
    statusPhrase,
    columnPhrase,
    rangePhrase,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    "Showing " + shown + " of " + total + " " + plural(total) + " " + tail + "."
  );
}

export function isUnidentifiedRow(row) {
  if (!row) return true;
  const empty = (v) => v == null || v === "";
  return (
    empty(row.unit_number) &&
    empty(row.tenant_name) &&
    effectiveRentOf(row) == null &&
    empty(row.lease_start) &&
    empty(row.lease_end) &&
    empty(row.effective_status) &&
    empty(row.status)
  );
}

export function unidentifiedRowLabel(row) {
  const id = row && row.lease_id != null ? row.lease_id : null;
  return id == null ? "Unidentified lease" : "Lease " + id;
}

export const NO_UNIT_ASSIGNED_LABEL = "No unit assigned";

export function unitCellLabel(row) {
  if (isUnidentifiedRow(row)) return unidentifiedRowLabel(row);
  const unit =
    row && row.unit_number != null ? String(row.unit_number).trim() : "";
  return unit || NO_UNIT_ASSIGNED_LABEL;
}

export const NOT_MOVED_IN_LABEL = "Lease started · not moved in";

export function leaseNotMovedIn(row, asOf) {
  if (!row || isRosterRow(row) || isByUnitRow(row)) return false;
  const start =
    typeof row.lease_start === "string" ? row.lease_start.slice(0, 10) : "";
  const moveIn =
    typeof row.move_in === "string" ? row.move_in.slice(0, 10) : "";
  const on = typeof asOf === "string" ? asOf.slice(0, 10) : "";
  if (!start || !moveIn || !on) return false;
  return start <= on && moveIn > on;
}

export const MTM_MARKER = "MTM";
const LEASE_END_EMPTY = "—";

export function leaseEndCell(row) {
  const end = row && row.lease_end != null ? String(row.lease_end).trim() : "";
  if (end) return end;
  return row && row.is_mtm ? MTM_MARKER : LEASE_END_EMPTY;
}

export function leasingGrain(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const withUnit = list.filter(
    (r) =>
      r &&
      r.lease_id != null &&
      r.lease_id !== "" &&
      r.unit_id != null &&
      r.unit_id !== "",
  );
  const perUnit = new Map();
  for (const r of withUnit) {
    const key = String(r.unit_id);
    perUnit.set(key, (perUnit.get(key) || 0) + 1);
  }
  let sharedUnits = 0;
  for (const n of perUnit.values()) if (n > 1) sharedUnits += 1;
  return {
    rows: withUnit.length,
    units: perUnit.size,
    sharedUnits,
    spaceLeased: sharedUnits > 0,
  };
}

export function leasingGrainSentence(grain) {
  const g = grain || {};
  if (!g.rows || !g.units || !g.spaceLeased) return null;
  const per = Math.round((g.rows / g.units) * 100) / 100;
  return (
    g.rows +
    " leases across " +
    g.units +
    (g.units === 1 ? " unit" : " units") +
    " (" +
    per +
    " per unit). On this property a row is one leased space, not a " +
    "whole unit, so Monthly Rent and the counts above are per space — not per unit."
  );
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const LEASED_AS_BED = "Bed";
export const LEASED_AS_ENTIRE_UNIT = "Entire unit";

export function leasedAs(row) {
  if (!row || isRosterRow(row)) return null;
  if (isByUnitRow(row)) return byUnitCell(row, "leasedAs");
  if (row.split_bed_count != null) return LEASED_AS_BED;
  const cfg =
    typeof row.space_configuration === "string"
      ? row.space_configuration.trim()
      : "";
  if (!cfg) return null;
  if (/^entire\s+unit/i.test(cfg)) return LEASED_AS_ENTIRE_UNIT;
  if (/^(private|shared)/i.test(cfg)) return LEASED_AS_BED;
  return null;
}

export const UNIT_STATUS_MEASURED = {
  "occupied (unavailable)": "Occupied No Notice",
  "vacant ready (unavailable)": "Vacant Unrented Ready",
};

export function unitStatus(row) {
  if (!row) return null;
  if (isByUnitRow(row)) return byUnitCell(row, "unitStatus");
  const unitNumber = typeof row.unit_number === "string" ? row.unit_number : "";
  if (unitNumber.includes(",")) return null;
  const raw =
    typeof row.availability_status === "string"
      ? row.availability_status.trim()
      : "";
  if (!raw) return null;
  return UNIT_STATUS_MEASURED[raw.toLowerCase()] || raw;
}

export const OCCUPANCY_OCCUPIED = "occupied";
export const OCCUPANCY_VACANT = "vacant";
export const OCCUPANCY_OCCUPIED_NO_LEASE = "occupied_no_lease";
export const OCCUPANCY_MIXED = "mixed";

export const OCCUPANCY_LABELS = {
  [OCCUPANCY_OCCUPIED]: "Occupied — lease in term",
  [OCCUPANCY_VACANT]: "Vacant — no lease in term",
  [OCCUPANCY_OCCUPIED_NO_LEASE]: "Pending — no lease in term",
};

export const OCCUPANCY_SHORT_LABELS = {
  [OCCUPANCY_OCCUPIED]: "Occupied",
  [OCCUPANCY_VACANT]: "Vacant",
  [OCCUPANCY_OCCUPIED_NO_LEASE]: "Pending",
};

const ROSTER_VACANT_STATUS = "vacant";
const ROSTER_PENDING_STATUSES = new Set([
  "pending",
  "occupied (no lease in term)",
]);

function rosterOccupancyKey(row) {
  const bucket =
    typeof row.bucket === "string" ? row.bucket.trim().toLowerCase() : "";
  if (bucket === OCCUPANCY_VACANT) return OCCUPANCY_VACANT;
  if (bucket === OCCUPANCY_OCCUPIED_NO_LEASE)
    return OCCUPANCY_OCCUPIED_NO_LEASE;
  const status =
    typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (ROSTER_PENDING_STATUSES.has(status)) return OCCUPANCY_OCCUPIED_NO_LEASE;
  if (status === ROSTER_VACANT_STATUS) return OCCUPANCY_VACANT;
  return OCCUPANCY_VACANT;
}

export function rollOccupancy(row) {
  if (!row || typeof row !== "object") return null;
  if (isByUnitRow(row)) return byUnitCell(row, "occupancyKey");
  if (isRosterRow(row)) return rosterOccupancyKey(row);
  return OCCUPANCY_OCCUPIED;
}

export function spaceOption(row) {
  if (!row) return null;
  if (isByUnitRow(row)) return byUnitCell(row, "spaceOption");
  if (isRosterRow(row)) {
    if (rosterOccupancyKey(row) !== OCCUPANCY_OCCUPIED_NO_LEASE) return null;
    const rosterCfg =
      typeof row.space_configuration === "string"
        ? row.space_configuration.trim()
        : "";
    return rosterCfg || null;
  }
  const cfg =
    typeof row.space_configuration === "string"
      ? row.space_configuration.trim()
      : "";
  return cfg || null;
}

export const RENT_ROLL_COLUMNS = [
  {
    key: "unit",
    label: "Unit / Space",
    type: "text",
    get: (r) => r.unit_number,
  },

  {
    key: "spaceOption",
    label: "Space Option",
    type: "text",
    get: (r) => spaceOption(r),
  },
  {
    key: "unitType",
    label: "Unit Type",
    type: "text",
    get: (r) => r.unit_type_name || null,
  },
  {
    key: "unitSf",
    label: "Unit SF",
    type: "number",
    totalable: false,
    get: (r) => (r && r.unit_sqft != null ? r.unit_sqft : null),
  },
  {
    key: "bedspaceSf",
    label: "Bedspace SF",
    type: "number",
    totalable: false,
    get: (r) => (r && r.bedspace_sf != null ? r.bedspace_sf : null),
  },
  {
    key: "leasedAs",
    label: "Leased as",
    type: "text",
    get: (r) => leasedAs(r),
  },
  {
    key: "unitStatus",
    label: "Unit Status",
    type: "text",
    get: (r) => unitStatus(r),
  },
  {
    key: "status",
    label: "Status",
    type: "text",
    get: (r) => r.effective_status || r.status,
  },
  { key: "tenant", label: "Resident", type: "text", get: (r) => r.tenant_name },
  {
    key: "leaseStart",
    label: "Lease Start",
    type: "date",
    get: (r) => r.lease_start,
  },
  {
    key: "leaseEnd",
    label: "Lease End",
    type: "date",
    get: (r) => r.lease_end,
  },
  {
    key: "gpr",
    label: "GPR",
    type: "number",
    get: (r) => (r && r.gpr != null ? r.gpr : null),
  },
  {
    key: "rentCharges",
    label: "Rent",
    type: "number",
    get: (r) => (r && r.rent_charges != null ? r.rent_charges : null),
  },
  {
    key: "totalCharges",
    label: "Total Charges",
    type: "number",
    get: (r) => (r && r.total_charges != null ? r.total_charges : null),
  },
  {
    key: "deposit",
    label: "Deposit Held",
    type: "number",
    get: (r) => (r && r.deposit != null ? Number(r.deposit) : null),
  },
];

export const CHARGE_COLUMN_ANCHOR_KEY = "gpr";

export const RENT_TOTAL_COLUMN = {
  key: "__rentTotal__",
  label: "Rent",
  type: "number",
  get: (r) =>
    r && r.rent_charges != null ? r.rent_charges : effectiveRentOf(r),
};

export const RENT_ROLL_LOCKED_COLUMNS = ["unit"];

export const DEFAULT_HIDDEN_SPINE_KEYS = [
  "unitType",
  "leasedAs",
  "status",
  "bedspaceSf",
];

export function defaultHiddenColumns(chargeColumns) {
  const hidden = {};
  for (const key of DEFAULT_HIDDEN_SPINE_KEYS) hidden[key] = true;
  hidden.netEffective = true;
  if (Array.isArray(chargeColumns)) {
    for (const c of chargeColumns) {
      if (!c) continue;
      if (c.marketUtility === true) continue;
      const key = c.key || (c.code != null ? `charge:${c.code}` : null);
      if (key) hidden[key] = true;
    }
  }
  return hidden;
}

export function buildRentRollColumns(chargeColumns = [], options = {}) {
  const charges = Array.isArray(chargeColumns) ? chargeColumns : [];
  const dynamic = charges.map((c) => ({
    key: "charge:" + c.code,
    label: c.label,
    type: "number",
    charge: true,
    get: (r) => {
      if (!r || !r.charges || typeof r.charges !== "object") return null;
      const v = r.charges[c.code];
      if (v != null) return v;
      return r.charges_observed === true && r.lease_id != null ? 0 : null;
    },
  }));

  const hasConcession =
    options.netEffective !== false &&
    charges.some((c) => /concession/i.test(c.code));
  const net = hasConcession
    ? [
        {
          key: "netEffective",
          label: "Net Effective",
          type: "number",
          netEffective: true,
          get: (r) => (r && r.net_effective != null ? r.net_effective : null),
        },
      ]
    : [];

  const insertedAll = dynamic.concat(net);

  const suppressed = new Set();
  if (options.gpr === false) suppressed.add("gpr");
  if (options.totalCharges === false) suppressed.add("totalCharges");
  const hidden = options.hidden;
  if (hidden && typeof hidden === "object") {
    for (const key of Object.keys(hidden)) {
      if (hidden[key]) suppressed.add(key);
    }
  }
  const spine = suppressed.size
    ? RENT_ROLL_COLUMNS.filter((c) => !suppressed.has(c.key))
    : RENT_ROLL_COLUMNS;

  const inserted = insertedAll.filter((c) => !suppressed.has(c.key));

  if (!inserted.length) return spine.slice();

  const anchorAt = RENT_ROLL_COLUMNS.findIndex(
    (c) => c.key === CHARGE_COLUMN_ANCHOR_KEY,
  );
  if (anchorAt < 0) return spine.concat(inserted);

  const order = new Map(RENT_ROLL_COLUMNS.map((c, i) => [c.key, i]));
  let at = -1;
  for (let i = 0; i < spine.length; i += 1) {
    const pos = order.get(spine[i].key);
    if (pos == null || pos > anchorAt) break;
    at = i;
  }

  return spine
    .slice(0, at + 1)
    .concat(inserted)
    .concat(spine.slice(at + 1));
}

function isBlankValue(v) {
  return v == null || v === "";
}

function compareValues(a, b, type) {
  if (type === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return 0;
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  if (type === "date") {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isNaN(ta) || Number.isNaN(tb))
      return collator.compare(String(a), String(b));
    return ta === tb ? 0 : ta < tb ? -1 : 1;
  }
  if (type === "bool") {
    const ba = a ? 1 : 0;
    const bb = b ? 1 : 0;
    return ba === bb ? 0 : ba < bb ? -1 : 1;
  }
  return collator.compare(String(a), String(b));
}

export function sortRows(rows, key, dir, columns = RENT_ROLL_COLUMNS) {
  const list = Array.isArray(rows) ? rows : [];
  const registry =
    Array.isArray(columns) && columns.length ? columns : RENT_ROLL_COLUMNS;
  const col = registry.find((c) => c && c.key === key);
  if (
    !col ||
    typeof col.get !== "function" ||
    (dir !== "asc" && dir !== "desc")
  )
    return list;
  const sign = dir === "desc" ? -1 : 1;
  return list
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const va = col.get(a.row);
      const vb = col.get(b.row);
      const aBlank = isBlankValue(va);
      const bBlank = isBlankValue(vb);
      if (aBlank && bBlank) return a.index - b.index;
      if (aBlank) return 1;
      if (bBlank) return -1;
      const cmp = compareValues(va, vb, col.type);
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    })
    .map((entry) => entry.row);
}

export const BLANK_VALUE_KEY = "__blank__";
export const BLANK_VALUE_LABEL = "(Blank)";

export function columnValueKeyOf(col, row) {
  if (!col || typeof col.get !== "function") return BLANK_VALUE_KEY;
  const v = col.get(row);
  if (col.type === "bool") return v ? "Yes" : "No";
  if (isBlankValue(v)) return BLANK_VALUE_KEY;
  if (col.type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : BLANK_VALUE_KEY;
  }
  return String(v);
}

export function columnValueLabelOf(col, key) {
  if (key === BLANK_VALUE_KEY) return BLANK_VALUE_LABEL;
  if (col && col.type === "number") {
    const n = Number(key);
    return Number.isFinite(n)
      ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : key;
  }
  return key;
}

export function columnValueOptions(rows, col) {
  const list = Array.isArray(rows) ? rows : [];
  if (!col || typeof col.get !== "function") return [];
  const counts = new Map();
  for (const row of list) {
    const key = columnValueKeyOf(col, row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const blanks = counts.get(BLANK_VALUE_KEY) || 0;
  counts.delete(BLANK_VALUE_KEY);
  const opts = [...counts.keys()]
    .sort((a, b) =>
      col.type === "number" ? Number(a) - Number(b) : collator.compare(a, b),
    )
    .map((key) => ({
      value: key,
      label: columnValueLabelOf(col, key),
      count: counts.get(key),
    }));
  if (blanks > 0)
    opts.push({
      value: BLANK_VALUE_KEY,
      label: BLANK_VALUE_LABEL,
      count: blanks,
    });
  return opts;
}

export function activeColumnFilters(
  columnFilters,
  columns = RENT_ROLL_COLUMNS,
) {
  const filters =
    columnFilters && typeof columnFilters === "object" ? columnFilters : {};
  const registry =
    Array.isArray(columns) && columns.length ? columns : RENT_ROLL_COLUMNS;
  const out = [];
  for (const col of registry) {
    if (!col || !col.key) continue;
    const values = filters[col.key];
    if (!Array.isArray(values) || !values.length) continue;
    out.push({ key: col.key, col, values: [...new Set(values)] });
  }
  return out;
}

export function hasColumnFilters(columnFilters, columns = RENT_ROLL_COLUMNS) {
  return activeColumnFilters(columnFilters, columns).length > 0;
}

export function columnFilterLabels(columnFilters, columns = RENT_ROLL_COLUMNS) {
  return activeColumnFilters(columnFilters, columns).map(
    (f) => f.col.label || f.col.key,
  );
}

export function filterByColumnValues(
  rows,
  columnFilters,
  columns = RENT_ROLL_COLUMNS,
) {
  const list = Array.isArray(rows) ? rows : [];
  const active = activeColumnFilters(columnFilters, columns);
  if (!active.length) return list;
  const resolved = active.map((f) => ({ col: f.col, set: new Set(f.values) }));
  return list.filter((row) =>
    resolved.every(({ col, set }) => set.has(columnValueKeyOf(col, row))),
  );
}

export function toggleColumnValue(columnFilters, key, value) {
  const filters =
    columnFilters && typeof columnFilters === "object" ? columnFilters : {};
  const current = Array.isArray(filters[key]) ? filters[key] : [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : current.concat(value);
  const out = { ...filters };
  if (next.length) out[key] = next;
  else delete out[key];
  return out;
}

export function setColumnFilterValues(columnFilters, key, values) {
  const filters =
    columnFilters && typeof columnFilters === "object" ? columnFilters : {};
  const next = Array.isArray(values) ? [...new Set(values)] : [];
  const out = { ...filters };
  if (next.length) out[key] = next;
  else delete out[key];
  return out;
}

export function clearColumnFilter(columnFilters, key) {
  const filters =
    columnFilters && typeof columnFilters === "object" ? columnFilters : {};
  if (!(key in filters)) return filters;
  const out = { ...filters };
  delete out[key];
  return out;
}

export const NUMERIC_OPS = ["gte", "gt", "lte", "lt"];

export const NUMERIC_OP_LABELS = {
  gte: "≥",
  gt: ">",
  lte: "≤",
  lt: "<",
};

export const NUMERIC_OP_WORDS = {
  gte: "at least",
  gt: "over",
  lte: "at most",
  lt: "under",
};

export function isNumericColumn(col) {
  return !!col && col.type === "number";
}

export const DATE_OPS = ["onafter", "after", "onbefore", "before"];

const ISO_DATE_BODY = "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
const ISO_DATE_PREFIX = new RegExp("^" + ISO_DATE_BODY);
const ISO_DATE_EXACT = new RegExp("^" + ISO_DATE_BODY + "$");

export const DATE_OP_LABELS = {
  onafter: "on or after",
  after: "after",
  onbefore: "on or before",
  before: "before",
};

export const DATE_OP_WORDS = DATE_OP_LABELS;

export function isDateColumn(col) {
  return !!col && col.type === "date";
}

export function dateValueOf(col, row) {
  if (!isDateColumn(col) || typeof col.get !== "function") return null;
  const v = col.get(row);
  if (isBlankValue(v)) return null;
  const s = String(v).trim();
  return ISO_DATE_PREFIX.test(s) ? s.slice(0, 10) : null;
}

export function isUsableDateCondition(cond) {
  if (!cond || typeof cond !== "object") return false;
  if (!DATE_OPS.includes(cond.op)) return false;
  if (cond.value === "" || cond.value == null) return false;
  return ISO_DATE_EXACT.test(String(cond.value).trim());
}

export function matchesDateCondition(value, cond) {
  if (value == null || !isUsableDateCondition(cond)) return true;
  const d = String(cond.value).trim();
  if (cond.op === "onafter") return value >= d;
  if (cond.op === "after") return value > d;
  if (cond.op === "onbefore") return value <= d;
  return value < d;
}

export function numericValueOf(col, row) {
  if (!isNumericColumn(col) || typeof col.get !== "function") return null;
  const v = col.get(row);
  if (isBlankValue(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isUsableCondition(cond) {
  if (!cond || typeof cond !== "object") return false;
  if (!NUMERIC_OPS.includes(cond.op)) return false;
  if (cond.value === "" || cond.value == null) return false;
  return Number.isFinite(Number(cond.value));
}

export function matchesCondition(value, cond) {
  if (value == null || !isUsableCondition(cond)) return true;
  const n = Number(cond.value);
  if (cond.op === "gte") return value >= n;
  if (cond.op === "gt") return value > n;
  if (cond.op === "lte") return value <= n;
  return value < n;
}

export function activeColumnRanges(columnRanges, columns = RENT_ROLL_COLUMNS) {
  const ranges =
    columnRanges && typeof columnRanges === "object" ? columnRanges : {};
  const registry =
    Array.isArray(columns) && columns.length ? columns : RENT_ROLL_COLUMNS;
  const out = [];
  for (const col of registry) {
    if (!col || !col.key) continue;
    const isNum = isNumericColumn(col);
    const isDate = isDateColumn(col);
    if (!isNum && !isDate) continue;
    const raw = Array.isArray(ranges[col.key]) ? ranges[col.key] : [];
    const conds = raw.filter(isNum ? isUsableCondition : isUsableDateCondition);
    if (!conds.length) continue;
    out.push({
      key: col.key,
      col,
      conditions: conds,
      kind: isNum ? "number" : "date",
    });
  }
  return out;
}

export function hasColumnRanges(columnRanges, columns = RENT_ROLL_COLUMNS) {
  return activeColumnRanges(columnRanges, columns).length > 0;
}

export function columnRangeLabels(
  columnRanges,
  columns = RENT_ROLL_COLUMNS,
  blankPolicy = {},
) {
  const policy =
    blankPolicy && typeof blankPolicy === "object" ? blankPolicy : {};
  return activeColumnRanges(columnRanges, columns).map(
    ({ col, conditions, kind }) => {
      const parts = conditions.map((c) =>
        kind === "date"
          ? DATE_OP_WORDS[c.op] + " " + String(c.value).trim()
          : NUMERIC_OP_WORDS[c.op] +
            " " +
            Number(c.value).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            }),
      );
      const base = (col.label || col.key) + " " + parts.join(" and ");
      return kind === "date" && policy[col.key] === "hide"
        ? base + ", excluding those with no date"
        : base;
    },
  );
}

export function filterByColumnRanges(
  rows,
  columnRanges,
  columns = RENT_ROLL_COLUMNS,
  blankPolicy = {},
) {
  const list = Array.isArray(rows) ? rows : [];
  const active = activeColumnRanges(columnRanges, columns);
  if (!active.length) return list;
  const policy =
    blankPolicy && typeof blankPolicy === "object" ? blankPolicy : {};
  return list.filter((row) =>
    active.every(({ col, conditions, kind }) => {
      const v =
        kind === "date" ? dateValueOf(col, row) : numericValueOf(col, row);
      if (v == null) return kind === "date" && policy[col.key] !== "hide";
      const match = kind === "date" ? matchesDateCondition : matchesCondition;
      return conditions.every((c) => match(v, c));
    }),
  );
}

export function isHidingBlankDates(columnRanges, columns, blankPolicy, key) {
  const policy =
    blankPolicy && typeof blankPolicy === "object" ? blankPolicy : {};
  if (policy[key] !== "hide") return false;
  return activeColumnRanges(columnRanges, columns).some(
    (f) => f.key === key && f.kind === "date",
  );
}

export function blankCountFor(rows, col) {
  const list = Array.isArray(rows) ? rows : [];
  const isNum = isNumericColumn(col);
  const isDate = isDateColumn(col);
  if (!isNum && !isDate) return 0;
  const valueOf = isNum ? numericValueOf : dateValueOf;
  let n = 0;
  for (const row of list) if (valueOf(col, row) == null) n += 1;
  return n;
}

export function setRangeCondition(columnRanges, key, index, patch) {
  const ranges =
    columnRanges && typeof columnRanges === "object" ? columnRanges : {};
  const current = Array.isArray(ranges[key]) ? ranges[key] : [];
  const next = [current[0] || null, current[1] || null];
  const slot = index === 1 ? 1 : 0;
  next[slot] = {
    ...(next[slot] || { op: slot === 0 ? "gte" : "lte", value: "" }),
    ...(patch || {}),
  };
  const out = { ...ranges };
  const anyContent = next.some(
    (c) => c && ((c.value !== "" && c.value != null) || c.op),
  );
  if (anyContent) out[key] = next;
  else delete out[key];
  return out;
}

export function clearColumnRange(columnRanges, key) {
  const ranges =
    columnRanges && typeof columnRanges === "object" ? columnRanges : {};
  if (!(key in ranges)) return ranges;
  const out = { ...ranges };
  delete out[key];
  return out;
}

export function nextSortState(current, key) {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return { key: null, dir: null };
}

export function ariaSortFor(current, key) {
  if (!current || current.key !== key || !current.dir) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}
