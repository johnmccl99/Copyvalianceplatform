export function computePortfolioOccupancyTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const t = list.reduce(
    (acc, r) => {
      acc.totalUnits += (r && r.totalUnits) || 0;
      acc.occupiedUnits += (r && r.occupiedUnits) || 0;
      acc.leasedUnits += (r && r.leasedUnits) || 0;
      acc.noticeUnits += (r && r.noticeUnits) || 0;
      acc.inPlaceRent += (r && r.inPlaceRent) || 0;
      acc.marketRent += (r && r.marketRent) || 0;
      return acc;
    },
    {
      totalUnits: 0,
      occupiedUnits: 0,
      leasedUnits: 0,
      noticeUnits: 0,
      inPlaceRent: 0,
      marketRent: 0,
    },
  );
  return {
    ...t,
    propertyCount: list.length,
    vacantUnits: Math.max(t.totalUnits - t.leasedUnits, 0),
    physicalOccupancyPct:
      t.totalUnits > 0 ? (t.occupiedUnits / t.totalUnits) * 100 : null,
    leasedPct: t.totalUnits > 0 ? (t.leasedUnits / t.totalUnits) * 100 : null,
    economicOccupancyPct:
      t.marketRent > 0 ? (t.inPlaceRent / t.marketRent) * 100 : null,
    noticePct: t.totalUnits > 0 ? (t.noticeUnits / t.totalUnits) * 100 : null,
    avgInPlaceRent:
      t.occupiedUnits > 0 ? t.inPlaceRent / t.occupiedUnits : null,
  };
}

export const OCCUPANCY_READY = "ready";
export const OCCUPANCY_NO_UNITS = "no_units";
export const OCCUPANCY_LEASES_UNREADABLE = "leases_unreadable";

export function classifyPortfolioOccupancySubstrate({
  rowCount = 0,
  totals = null,
  leaseDataLastSeen = null,
} = {}) {
  const t = totals && typeof totals === "object" ? totals : {};
  if (!(rowCount > 0) || !(t.totalUnits > 0)) return OCCUPANCY_NO_UNITS;
  if (t.occupiedUnits > 0 || t.leasedUnits > 0) return OCCUPANCY_READY;
  return leaseDataLastSeen ? OCCUPANCY_READY : OCCUPANCY_LEASES_UNREADABLE;
}

export const OCCUPANCY_LEASES_UNREADABLE_COPY = {
  title: "Lease data could not be read",
  body:
    "Unit rows loaded for the synced properties but no readable lease rows came " +
    "back, so occupancy cannot be computed — the 0% this page would otherwise " +
    "show is missing data, not an empty portfolio. If an Entrata sync has " +
    "already run, ask an administrator to confirm your role can read the " +
    "Entrata lease tables.",
};

export function computeUnitLeaseMatchSummary(rows, { floorPct = 95 } = {}) {
  const list = Array.isArray(rows)
    ? rows.filter((r) => r && typeof r === "object")
    : [];
  const pick = (r, camel, snake) =>
    r[camel] !== undefined ? r[camel] : r[snake];
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const floor = Math.min(
    Math.max(Number.isFinite(Number(floorPct)) ? Number(floorPct) : 95, 0),
    100,
  );

  const parsed = list.map((r) => ({
    propertyId: pick(r, "propertyId", "property_id") ?? null,
    propertyName: pick(r, "propertyName", "property_name") ?? null,
    activeUnits: num(pick(r, "activeUnits", "active_units")) || 0,
    leaseRows: num(pick(r, "leaseRows", "lease_rows")) || 0,
    unresolvedRows: num(pick(r, "unresolvedRows", "unresolved_rows")) || 0,
    recoveredRows:
      num(pick(r, "resolvedByUnitNumber", "resolved_by_unit_number")) || 0,
    unitsMissing:
      num(
        pick(r, "unitsMissingFromInventory", "units_missing_from_inventory"),
      ) || 0,
    matchPct: num(pick(r, "matchPct", "match_pct")),
    legacyMatchPct: num(pick(r, "legacyMatchPct", "legacy_match_pct")),
  }));

  const evaluated = parsed.filter((p) => p.matchPct != null && p.leaseRows > 0);
  const belowFloorRows = evaluated.filter((p) => p.matchPct < floor);
  const regressedRows = evaluated.filter(
    (p) => p.legacyMatchPct != null && p.matchPct < p.legacyMatchPct,
  );

  return {
    propertyCount: parsed.length,
    evaluatedCount: evaluated.length,
    atFullMatch: evaluated.filter((p) => p.matchPct >= 100).length,
    belowFloor: belowFloorRows.length,
    regressed: regressedRows.length,
    recoveredByUnitNumber: parsed.reduce((a, p) => a + p.recoveredRows, 0),
    unitsMissingFromInventory: parsed.reduce((a, p) => a + p.unitsMissing, 0),
    floorPct: floor,
    worst: evaluated.length
      ? evaluated.reduce((lo, p) => (p.matchPct < lo.matchPct ? p : lo))
          .matchPct
      : null,
    offenders: belowFloorRows
      .slice()
      .sort((a, b) => a.matchPct - b.matchPct)
      .map((p) => ({
        propertyId: p.propertyId,
        propertyName: p.propertyName,
        matchPct: p.matchPct,
        legacyMatchPct: p.legacyMatchPct,
        unresolvedRows: p.unresolvedRows,
        unitsMissingFromInventory: p.unitsMissing,
      })),
  };
}

export function computeBankAccountRosterSummary(rows) {
  const list = Array.isArray(rows)
    ? rows.filter((r) => r && typeof r === "object")
    : [];
  const paymentMethodMix = {};
  let disabledAccounts = 0;
  const byProp = new Map();
  for (const r of list) {
    const t = r.accountType || "Unknown";
    paymentMethodMix[t] = (paymentMethodMix[t] || 0) + 1;
    if (r.isDisabled) disabledAccounts += 1;
    const pid = r.propertyId == null ? null : String(r.propertyId);
    if (!byProp.has(pid)) {
      byProp.set(pid, {
        propertyId: r.propertyId,
        propertyName: r.propertyName || null,
        accountCount: 0,
        accounts: [],
      });
    }
    const bucket = byProp.get(pid);
    bucket.accountCount += 1;
    bucket.accounts.push(r);
  }
  const accountsByProperty = Array.from(byProp.values()).sort((a, b) => {
    const an = (a.propertyName || "").toLowerCase();
    const bn = (b.propertyName || "").toLowerCase();
    if (an && !bn) return -1;
    if (!an && bn) return 1;
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
  return {
    totalAccounts: list.length,
    propertyCount: accountsByProperty.length,
    disabledAccounts,
    paymentMethodMix,
    accountsByProperty,
  };
}

export function computeLeaseExpirationTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const t = list.reduce(
    (acc, r) => {
      acc.expiring30 += (r && r.expiring30) || 0;
      acc.expiring60 += (r && r.expiring60) || 0;
      acc.expiring90 += (r && r.expiring90) || 0;
      acc.expiring180 += (r && r.expiring180) || 0;
      acc.expiring365 += (r && r.expiring365) || 0;
      acc.exposure30 += (r && r.exposure30) || 0;
      acc.exposure60 += (r && r.exposure60) || 0;
      acc.exposure90 += (r && r.exposure90) || 0;
      acc.exposure180 += (r && r.exposure180) || 0;
      acc.exposure365 += (r && r.exposure365) || 0;
      acc.atRiskCount += (r && r.atRiskCount) || 0;
      acc.atRiskExposure += (r && r.atRiskExposure) || 0;
      acc.expiringInPlaceRent += (r && r.expiringInPlaceRent) || 0;
      acc.expiringMarketRent += (r && r.expiringMarketRent) || 0;
      acc.mtmCount += (r && r.mtmCount) || 0;
      return acc;
    },
    {
      expiring30: 0,
      expiring60: 0,
      expiring90: 0,
      expiring180: 0,
      expiring365: 0,
      exposure30: 0,
      exposure60: 0,
      exposure90: 0,
      exposure180: 0,
      exposure365: 0,
      atRiskCount: 0,
      atRiskExposure: 0,
      expiringInPlaceRent: 0,
      expiringMarketRent: 0,
      mtmCount: 0,
    },
  );
  return {
    ...t,
    propertyCount: list.length,
    rentGap:
      t.expiringMarketRent > 0
        ? t.expiringMarketRent - t.expiringInPlaceRent
        : null,
    rentGapPct:
      t.expiringMarketRent > 0
        ? ((t.expiringMarketRent - t.expiringInPlaceRent) /
            t.expiringMarketRent) *
          100
        : null,
    atRiskPct: t.expiring90 > 0 ? (t.atRiskCount / t.expiring90) * 100 : null,
  };
}

export function computeLeaseConcessionTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const t = list.reduce(
    (acc, r) => {
      acc.totalLeases += (r && r.totalLeases) || 0;
      acc.concessionLeaseCount += (r && r.concessionLeaseCount) || 0;
      acc.concessionTotal += (r && r.concessionTotal) || 0;
      acc.oneTimeConcessionTotal += (r && r.oneTimeConcessionTotal) || 0;
      acc.recurringConcessionTotal += (r && r.recurringConcessionTotal) || 0;
      acc.annualRentTotal += (r && r.annualRentTotal) || 0;
      return acc;
    },
    {
      totalLeases: 0,
      concessionLeaseCount: 0,
      concessionTotal: 0,
      oneTimeConcessionTotal: 0,
      recurringConcessionTotal: 0,
      annualRentTotal: 0,
    },
  );
  return {
    ...t,
    propertyCount: list.length,
    concessionPenetrationPct:
      t.totalLeases > 0 ? (t.concessionLeaseCount / t.totalLeases) * 100 : null,
    avgConcessionPerLease:
      t.concessionLeaseCount > 0
        ? t.concessionTotal / t.concessionLeaseCount
        : null,
    concessionPctOfLeaseValue:
      t.annualRentTotal > 0
        ? (t.concessionTotal / t.annualRentTotal) * 100
        : null,
    oneTimeSharePct:
      t.concessionTotal > 0
        ? (t.oneTimeConcessionTotal / t.concessionTotal) * 100
        : null,
  };
}

export function computeWorkOrderBacklogSummary(rows) {
  const list = Array.isArray(rows)
    ? rows.filter((r) => r && typeof r === "object")
    : [];

  const PRIORITY_RANK = {
    emergency: 0,
    "very high": 1,
    high: 2,
    medium: 3,
    low: 4,
  };
  const rankOf = (label) => {
    const k = String(label || "")
      .trim()
      .toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, k)
      ? PRIORITY_RANK[k]
      : 5;
  };

  const byPriority = list
    .filter((r) => r.dimension === "priority")
    .map((r) => ({
      label: r.bucketLabel || "Unspecified",
      openCount: Number(r.openCount) || 0,
    }))
    .sort(
      (a, b) => rankOf(a.label) - rankOf(b.label) || b.openCount - a.openCount,
    );

  const byCategory = list
    .filter((r) => r.dimension === "category")
    .map((r) => ({
      label: r.bucketLabel || "Uncategorized",
      openCount: Number(r.openCount) || 0,
      avgDaysOpen: r.avgDaysOpen == null ? null : Number(r.avgDaysOpen),
    }))
    .sort(
      (a, b) => b.openCount - a.openCount || a.label.localeCompare(b.label),
    );

  const topProperties = list
    .filter((r) => r.dimension === "property")
    .map((r) => ({
      propertyId: r.propertyId == null ? null : Number(r.propertyId),
      label:
        r.bucketLabel ||
        (r.propertyId == null
          ? "Unknown property"
          : `Property ${r.propertyId}`),
      openCount: Number(r.openCount) || 0,
      avgDaysOpen: r.avgDaysOpen == null ? null : Number(r.avgDaysOpen),
    }))
    .sort(
      (a, b) => b.openCount - a.openCount || a.label.localeCompare(b.label),
    );

  const p = list.find((r) => r.dimension === "portfolio") || {};
  const emergencyTotal = Number(p.emergencyTotal) || 0;
  const emergencyWithinSla = Number(p.emergencyWithinSla) || 0;
  const portfolio = {
    openCount: Number(p.openCount) || 0,
    totalCount: Number(p.totalCount) || 0,
    avgDaysOpen: p.avgDaysOpen == null ? null : Number(p.avgDaysOpen),
    emergencyTotal,
    emergencyResolved: Number(p.emergencyResolved) || 0,
    emergencyWithinSla,
    emergencyOpen: Number(p.emergencyOpen) || 0,
    emergencySlaHitRatePct:
      emergencyTotal > 0 ? (emergencyWithinSla / emergencyTotal) * 100 : null,
  };

  return {
    byPriority,
    byCategory,
    topProperties,
    portfolio,
    propertyCount: topProperties.length,
  };
}
