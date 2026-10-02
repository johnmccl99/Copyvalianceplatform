import {
  expandGroupLeaseSpaceNumbers,
  rosterSpaceNumberSet,
  spaceIdByNumber,
} from "./rentRollSpaces.js";
import { isRosterRow } from "./rentRollView.js";

export function indexSpaceMarketRent(spaces) {
  const list = Array.isArray(spaces) ? spaces : [];
  const rentById = new Map();
  const rentByNumber = new Map();

  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const rent = toFiniteNumber(s.market_rent);
    if (rent == null) continue;
    if (s.unit_space_id != null && !rentById.has(s.unit_space_id)) {
      rentById.set(s.unit_space_id, rent);
    }
    const n = s.space_number == null ? "" : String(s.space_number);
    if (n && !rentByNumber.has(n)) rentByNumber.set(n, rent);
  }

  return { rentById, rentByNumber };
}

export function gprForRow(row, index, lookups) {
  if (!row || typeof row !== "object") return ABSENT;
  const { rentById, rentByNumber } = index || {};
  if (!(rentById instanceof Map) || !(rentByNumber instanceof Map))
    return ABSENT;

  if (isRosterRow(row)) {
    const direct = toFiniteNumber(row.market_rent);
    if (direct != null) return { gpr: direct, spaces: 1 };
    const byId =
      row.unit_space_id != null ? rentById.get(row.unit_space_id) : undefined;
    return byId == null ? ABSENT : { gpr: byId, spaces: 1 };
  }

  const numbers = expandGroupLeaseSpaceNumbers(
    row.unit_number,
    lookups && lookups.numberSet,
  );
  if (numbers.length > 1) {
    let sum = 0;
    let found = 0;
    for (const n of numbers) {
      const r = rentByNumber.get(n);
      if (r != null) {
        sum += r;
        found += 1;
      }
    }
    if (found > 0 && found === numbers.length)
      return { gpr: sum, spaces: found };
    return ABSENT;
  }

  const id = row.unit_space_id;
  const byId = id != null ? rentById.get(id) : undefined;
  if (byId != null) return { gpr: byId, spaces: 1 };
  const label = numbers.length === 1 ? numbers[0] : null;
  const byNumber = label ? rentByNumber.get(label) : undefined;
  return byNumber == null ? ABSENT : { gpr: byNumber, spaces: 1 };
}

export function attachGprToRows(rows, spaces) {
  const list = Array.isArray(rows) ? rows : [];
  const spaceList = Array.isArray(spaces) ? spaces : [];
  if (!spaceList.length) return list;

  const index = indexSpaceMarketRent(spaceList);
  const lookups = {
    numberSet: rosterSpaceNumberSet(spaceList),
    idByNumber: spaceIdByNumber(spaceList),
  };

  return list.map((row) => {
    if (!row || typeof row !== "object") return row;
    const { gpr, spaces: n } = gprForRow(row, index, lookups);
    if (gpr == null) return row;
    return { ...row, gpr, gpr_spaces: n };
  });
}

export function gprCoverage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  let recorded = 0;
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    total += 1;
    if (toFiniteNumber(row.gpr) != null) recorded += 1;
  }
  return { total, recorded, missing: total - recorded };
}

const ABSENT = { gpr: null, spaces: 0 };

function toFiniteNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
