import {
  expandGroupLeaseSpaceNumbers,
  rosterSpaceNumberSet,
  spaceIdByNumber,
} from "./rentRollSpaces.js";
import { isRosterRow } from "./rentRollView.js";

export function indexWorkbookBedspaceSf(workbookRows) {
  const list = Array.isArray(workbookRows) ? workbookRows : [];
  const byLabel = new Map();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const label = r.space_label == null ? "" : String(r.space_label).trim();
    if (!label || byLabel.has(label)) continue;
    const sf = toFiniteNumber(r.bedspace_sf);
    if (sf == null) continue;
    byLabel.set(label, sf);
  }
  return byLabel;
}

export function indexSpaceSquareFeet(spaces, workbookRows) {
  const list = Array.isArray(spaces) ? spaces : [];
  const workbookByLabel = indexWorkbookBedspaceSf(workbookRows);
  const sfById = new Map();
  const sfByNumber = new Map();

  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const n = s.space_number == null ? "" : String(s.space_number);
    const sf =
      n && workbookByLabel.has(n)
        ? workbookByLabel.get(n)
        : toFiniteNumber(s.square_feet);
    if (sf == null) continue;
    if (s.unit_space_id != null && !sfById.has(s.unit_space_id)) {
      sfById.set(s.unit_space_id, sf);
    }
    if (n && !sfByNumber.has(n)) sfByNumber.set(n, sf);
  }

  return { sfById, sfByNumber };
}

export function bedspaceSfForRow(row, index, lookups) {
  if (!row || typeof row !== "object") return ABSENT;
  const { sfById, sfByNumber } = index || {};
  if (!(sfById instanceof Map) || !(sfByNumber instanceof Map)) return ABSENT;

  if (isRosterRow(row)) {
    const byId =
      row.unit_space_id != null ? sfById.get(row.unit_space_id) : undefined;
    if (byId != null) return { bedspaceSf: byId, spaces: 1 };
    const n = row.unit_number == null ? "" : String(row.unit_number);
    const byNumber = n ? sfByNumber.get(n) : undefined;
    return byNumber == null ? ABSENT : { bedspaceSf: byNumber, spaces: 1 };
  }

  const numbers = expandGroupLeaseSpaceNumbers(
    row.unit_number,
    lookups && lookups.numberSet,
  );
  if (numbers.length > 1) {
    let sum = 0;
    let found = 0;
    for (const n of numbers) {
      const sf = sfByNumber.get(n);
      if (sf != null) {
        sum += sf;
        found += 1;
      }
    }
    if (found > 0 && found === numbers.length)
      return { bedspaceSf: sum, spaces: found };
    return ABSENT;
  }

  const id = row.unit_space_id;
  const byId = id != null ? sfById.get(id) : undefined;
  if (byId != null) return { bedspaceSf: byId, spaces: 1 };
  const label = numbers.length === 1 ? numbers[0] : null;
  const byNumber = label ? sfByNumber.get(label) : undefined;
  return byNumber == null ? ABSENT : { bedspaceSf: byNumber, spaces: 1 };
}

export function attachBedspaceSfToRows(rows, spaces, workbookRows) {
  const list = Array.isArray(rows) ? rows : [];
  const spaceList = Array.isArray(spaces) ? spaces : [];
  if (!spaceList.length) return list;

  const index = indexSpaceSquareFeet(spaceList, workbookRows);
  if (!index.sfById.size && !index.sfByNumber.size) return list;

  const lookups = {
    numberSet: rosterSpaceNumberSet(spaceList),
    idByNumber: spaceIdByNumber(spaceList),
  };

  return list.map((row) => {
    if (!row || typeof row !== "object") return row;
    const { bedspaceSf, spaces: n } = bedspaceSfForRow(row, index, lookups);
    if (bedspaceSf == null) return row;
    return { ...row, bedspace_sf: bedspaceSf, bedspace_sf_spaces: n };
  });
}

export function bedspaceSfCoverage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  let recorded = 0;
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    total += 1;
    if (toFiniteNumber(row.bedspace_sf) != null) recorded += 1;
  }
  return { total, recorded, missing: total - recorded };
}

const ABSENT = { bedspaceSf: null, spaces: 0 };

function toFiniteNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
