export const SYNTHETIC_ROW_KEY_PREFIX = "space-";

export function syntheticRowKey(unitSpaceId) {
  return SYNTHETIC_ROW_KEY_PREFIX + String(unitSpaceId);
}

export const VACANT_TENANT_LABEL = "Vacant";
export const PENDING_TENANT_LABEL = "Pending";
export const VACANT_STATUS_LABEL = "Vacant";
export const PENDING_STATUS_LABEL = "Pending";

export const ROSTER_ROW_SOURCE = "roster";

export const UNKNOWN_STATUS_IS_TENANTED = false;

const TENANTED_STATUS_PREFIXES = ["occupied", "on notice"];

function toFiniteNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asObject(v) {
  if (!v) return null;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? v : null;
}

function spaceListOf(rawUnitSpaces) {
  const container = asObject(rawUnitSpaces);
  if (!container) return [];
  const list = container.unitSpace;
  if (Array.isArray(list))
    return list.filter((s) => s && typeof s === "object");
  if (list && typeof list === "object") return [list];
  return [];
}

export function extractUnitSpaces(entrataUnitRows) {
  const rows = Array.isArray(entrataUnitRows) ? entrataUnitRows : [];
  const byId = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const raw = asObject(row.raw);
    if (!raw) continue;

    for (const space of spaceListOf(raw.unitSpaces)) {
      const id = toFiniteNumber(space.unitSpaceId);
      if (id == null) continue;
      if (byId.has(id)) continue;

      byId.set(id, {
        unit_space_id: id,
        space_number: space.unitNumber == null ? "" : String(space.unitNumber),
        parent_unit_number:
          row.unit_number == null ? "" : String(row.unit_number),
        unit_id: row.unit_id == null ? null : row.unit_id,
        property_id: row.property_id == null ? null : row.property_id,
        space_configuration:
          space.spaceConfiguration == null
            ? null
            : String(space.spaceConfiguration),
        market_rent: toFiniteNumber(space.marketRent),
        square_feet: toFiniteNumber(space.SquareFeet),
        availability_status:
          space.availabilityStatus == null
            ? ""
            : String(space.availabilityStatus),
      });
    }
  }

  return Array.from(byId.values());
}

export function isVacantStatus(availabilityStatus) {
  if (availabilityStatus == null) return false;
  return String(availabilityStatus).trim().toLowerCase().startsWith("vacant");
}

export function isTenantedStatus(
  availabilityStatus,
  { unknownIsTenanted = UNKNOWN_STATUS_IS_TENANTED } = {},
) {
  if (availabilityStatus == null) return unknownIsTenanted;
  const s = String(availabilityStatus).trim().toLowerCase();
  if (!s) return unknownIsTenanted;
  if (isVacantStatus(s)) return false;
  for (const prefix of TENANTED_STATUS_PREFIXES) {
    if (s.startsWith(prefix)) return true;
  }
  return unknownIsTenanted;
}

export function classifySpace(space, leasedSpaceIds) {
  const id = toFiniteNumber(space && space.unit_space_id);
  const leased =
    leasedSpaceIds && typeof leasedSpaceIds.has === "function" && id != null
      ? leasedSpaceIds.has(id)
      : false;
  if (leased) return "leased";
  if (isTenantedStatus(space && space.availability_status))
    return "occupied_no_lease";
  return "vacant";
}

export function leasedSpaceIdsFrom(rentRollRows) {
  const rows = Array.isArray(rentRollRows) ? rentRollRows : [];
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const direct = toFiniteNumber(row.unit_space_id);
    const fromRaw =
      direct == null ? toFiniteNumber(asObject(row.raw)?.unitSpaceId) : null;
    const id = direct != null ? direct : fromRaw;
    if (id != null) ids.add(id);
  }
  return ids;
}

export function expandGroupLeaseSpaceNumbers(unitNumber, rosterSpaceNumberSet) {
  if (unitNumber == null) return [];
  const raw = String(unitNumber).trim();
  if (!raw) return [];

  const roster =
    rosterSpaceNumberSet && typeof rosterSpaceNumberSet.has === "function"
      ? rosterSpaceNumberSet
      : new Set();

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return parts.slice(0, 1);

  const first = parts[0];
  const out = [];
  const seen = new Set();
  const take = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };

  if (roster.has(first)) take(first);

  for (let p = 1; p < parts.length; p += 1) {
    const part = parts[p];

    if (roster.has(part)) {
      take(part);
      continue;
    }

    const hits = new Set();
    for (let i = first.length; i >= 1; i -= 1) {
      const candidate = first.slice(0, i) + part;
      if (roster.has(candidate)) hits.add(candidate);
    }

    if (hits.size === 1) take(hits.values().next().value);
  }

  return out;
}

export function rosterSpaceNumberSet(spaces) {
  const set = new Set();
  for (const s of Array.isArray(spaces) ? spaces : []) {
    if (s && typeof s === "object" && s.space_number)
      set.add(String(s.space_number));
  }
  return set;
}

export function spaceIdByNumber(spaces) {
  const map = new Map();
  for (const s of Array.isArray(spaces) ? spaces : []) {
    if (!s || typeof s !== "object") continue;
    const n = s.space_number;
    const id = toFiniteNumber(s.unit_space_id);
    if (!n || id == null) continue;
    if (!map.has(String(n))) map.set(String(n), id);
  }
  return map;
}

export function buildVacancyRows(spaces, leasedSpaceIds) {
  const list = Array.isArray(spaces) ? spaces : [];
  const out = [];

  for (const space of list) {
    if (!space || typeof space !== "object") continue;
    const bucket = classifySpace(space, leasedSpaceIds);
    if (bucket === "leased") continue;

    const isVacant = bucket === "vacant";
    const rent = null;

    out.push({
      row_key: syntheticRowKey(space.unit_space_id),
      unit_space_id: space.unit_space_id,
      unit_id: space.unit_id == null ? null : space.unit_id,
      property_id: space.property_id == null ? null : space.property_id,
      unit_number: space.space_number,
      parent_unit_number: space.parent_unit_number,
      space_configuration:
        space.space_configuration == null ? null : space.space_configuration,
      market_rent: space.market_rent == null ? null : space.market_rent,
      availability_status: space.availability_status || "",
      bucket,

      tenant_name: isVacant ? VACANT_TENANT_LABEL : PENDING_TENANT_LABEL,
      tenant_id: null,
      tenant_email: "",

      lease_id: null,
      lease_start: null,
      lease_end: null,
      move_in: null,
      move_out: null,

      rent,
      effective_rent: rent,
      deposit: null,

      status: isVacant ? VACANT_STATUS_LABEL : PENDING_STATUS_LABEL,
      effective_status: isVacant ? VACANT_STATUS_LABEL : PENDING_STATUS_LABEL,
      occupied: false,
      is_mtm: false,

      source: ROSTER_ROW_SOURCE,
      adjusted: false,
      adjustments: [],
      adjustment_id: null,
      group: null,
      last_seen_at: null,
    });
  }

  return out;
}

export function spaceOccupancy(spaces, leasedSpaceIds) {
  const list = Array.isArray(spaces) ? spaces : [];
  let leased = 0;
  let vacant = 0;
  let occupiedNoLease = 0;
  let roster = 0;

  for (const space of list) {
    if (!space || typeof space !== "object") continue;
    roster += 1;
    const bucket = classifySpace(space, leasedSpaceIds);
    if (bucket === "leased") leased += 1;
    else if (bucket === "vacant") vacant += 1;
    else occupiedNoLease += 1;
  }

  const occupancyPct =
    roster === 0 ? null : Math.round((leased / roster) * 1000) / 10;

  return { roster, leased, vacant, occupiedNoLease, occupancyPct };
}

export function occupiedNoLeaseSentence(counts) {
  const n =
    counts && Number.isFinite(Number(counts.occupiedNoLease))
      ? Number(counts.occupiedNoLease)
      : 0;
  if (n <= 0) return null;
  const subject = n === 1 ? "1 bed is" : n + " beds are";
  return (
    subject +
    " occupied per Entrata but " +
    (n === 1 ? "has" : "have") +
    " no lease in term on this date."
  );
}
