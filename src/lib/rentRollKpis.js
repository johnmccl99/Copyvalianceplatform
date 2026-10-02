import { isRosterRow } from "./rentRollView.js";
import { rentColumnTotal } from "./rentRollTotals.js";

export const OCCUPIED_ROSTER_SUB = "beds with a lease in term on this date";
export const OCCUPIED_LEASE_SUB = "current / active / notice + MTM-occupied";

export function rentRollKpis(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  const occupancy = (options && options.occupancy) || null;

  const leaseRows = list.filter((r) => !isRosterRow(r));

  return {
    leaseRows,
    leases: leaseRows.length,
    entrataCount: leaseRows.filter((r) => r.source !== "adjustment").length,
    addedCount: leaseRows.filter((r) => r.source === "adjustment").length,
    adjustedCount: leaseRows.filter(
      (r) => r.source !== "adjustment" && r.adjusted,
    ).length,
    occupiedLeases: leaseRows.filter((r) => r.occupied).length,
    occupancy,
    rent: rentColumnTotal(list),
    noun: occupancy ? "bed" : "lease",
  };
}

export function leasesSubLabel(k) {
  const entrata = (k && k.entrataCount) || 0;
  const added = (k && k.addedCount) || 0;
  return (
    entrata +
    " from Entrata" +
    (added > 0 ? " + " + added + " off-Entrata" : "")
  );
}

export function occupiedCard(k) {
  const occupancy = (k && k.occupancy) || null;
  if (occupancy && occupancy.roster > 0) {
    return {
      label: "Occupied " + occupancy.leased + " / " + occupancy.roster,
      value: String(occupancy.leased),
      sub: OCCUPIED_ROSTER_SUB,
    };
  }
  return {
    label: "Occupied",
    value: String((k && k.occupiedLeases) || 0),
    sub: OCCUPIED_LEASE_SUB,
  };
}

export function kpiBasisSentence(wholeCount, shownCount, noun) {
  const whole = Number(wholeCount);
  const shown = Number(shownCount);
  if (!Number.isFinite(whole) || !Number.isFinite(shown)) return null;
  if (shown >= whole) return null;
  const word = noun === "bed" ? "beds" : "leases";
  return (
    "The figures above describe the whole property. The table below shows " +
    shown +
    " of " +
    whole +
    " rows, matching the filter in place when this was exported. " +
    "Counts of " +
    word +
    " are unaffected by that filter."
  );
}
