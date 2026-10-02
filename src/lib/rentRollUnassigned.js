import { NO_UNIT_ASSIGNED_LABEL, unitCellLabel } from "./rentRollView.js";

export const UNASSIGNED_SECTION_HEADING =
  "Future tenants not yet assigned a unit";

export const UNASSIGNED_SECTION_NOTE =
  "These leases are signed but no unit or bed has been selected in Entrata yet, " +
  "so they hold no space on the roll above and are excluded from its counts and totals.";

export function isUnassignedLeaseRow(row) {
  if (!row || typeof row !== "object") return false;
  return unitCellLabel(row) === NO_UNIT_ASSIGNED_LABEL;
}

export function partitionUnassignedLeases(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const unassigned = list.filter(isUnassignedLeaseRow);
  if (!unassigned.length) return { rows: list, unassigned };
  return { rows: list.filter((row) => !isUnassignedLeaseRow(row)), unassigned };
}
