import { CURRENT_ROLL, filterByStatus, isRollPreset } from "./rentRollView.js";
import {
  buildVacancyRows,
  expandGroupLeaseSpaceNumbers,
  leasedSpaceIdsFrom,
  rosterSpaceNumberSet,
  spaceIdByNumber,
} from "./rentRollSpaces.js";

export function coveredSpaceIds(rows, spaces) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = leasedSpaceIdsFrom(list);

  const spaceList = Array.isArray(spaces) ? spaces : [];
  if (!spaceList.length) return ids;
  const numbers = rosterSpaceNumberSet(spaceList);
  const byNumber = spaceIdByNumber(spaceList);
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const unitNumber = row.unit_number;
    if (typeof unitNumber !== "string" || !unitNumber.includes(",")) continue;
    for (const name of expandGroupLeaseSpaceNumbers(unitNumber, numbers)) {
      const id = byNumber.get(name);
      if (id != null) ids.add(id);
    }
  }
  return ids;
}

export function withHiddenLeaseVacancies(rows, spaces, status, bedRows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!isRollPreset(status)) return list;

  const spaceList = Array.isArray(spaces) ? spaces : [];
  if (!spaceList.length) return list;

  const covered = coveredSpaceIds(list, spaceList);
  const minted = buildVacancyRows(spaceList, covered);
  if (!minted.length) return list;

  const pool = new Map();
  for (const row of Array.isArray(bedRows) ? bedRows : []) {
    if (row && row.unit_space_id != null && !pool.has(row.unit_space_id)) {
      pool.set(row.unit_space_id, row);
    }
  }
  const restored = pool.size
    ? minted.map((row) => pool.get(row.unit_space_id) || row)
    : minted;
  return list.concat(restored);
}

export function withRestoredPresetCounts(options, rows, spaces, extra = {}) {
  const list = Array.isArray(options) ? options : [];
  const spaceList = Array.isArray(spaces) ? spaces : [];
  if (!list.length || !spaceList.length) return list;

  const countRows =
    typeof extra.countRows === "function" ? extra.countRows : (r) => r.length;
  const shown = countRows(
    withHiddenLeaseVacancies(
      filterByStatus(rows, CURRENT_ROLL),
      spaceList,
      CURRENT_ROLL,
      extra.bedRows,
    ),
  );

  let changed = false;
  const next = list.map((option) => {
    if (!option || option.value !== CURRENT_ROLL || option.count === shown)
      return option;
    changed = true;
    return { ...option, count: shown };
  });
  return changed ? next : list;
}
