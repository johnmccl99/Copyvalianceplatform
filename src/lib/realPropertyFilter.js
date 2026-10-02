export function buildRealPropertyFilterContext(links) {
  const list = Array.isArray(links) ? links : [];
  const rpIds = new Set();
  const aopIds = new Set();
  let realPropertyCount = 0;
  let aopCount = 0;
  for (const l of list) {
    if (!l || typeof l !== "object") continue;
    const cls = l.classification ?? l.entity_classification ?? "";
    const rawId = l.entrataId ?? l.entrata_id ?? null;
    const id = rawId == null ? "" : String(rawId).trim();
    if (cls === "RP") {
      realPropertyCount += 1;
      if (id) rpIds.add(id);
    } else if (cls === "AOP") {
      aopCount += 1;
      if (id) aopIds.add(id);
    }
  }
  return {
    enabled: aopIds.size > 0,
    rpIds,
    aopIds,
    realPropertyCount,
    aopCount,
    entityCount: realPropertyCount + aopCount,
  };
}

export function disabledRealPropertyFilterContext() {
  return buildRealPropertyFilterContext([]);
}

export function applyRealPropertyFilter(rows, context, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!context || !context.enabled) return list;
  const aopIds = context.aopIds instanceof Set ? context.aopIds : new Set();
  if (aopIds.size === 0) return list;
  const getPropertyId =
    typeof opts.getPropertyId === "function"
      ? opts.getPropertyId
      : (r) => r && r.propertyId;
  const hasActivity =
    typeof opts.hasActivity === "function" ? opts.hasActivity : () => false;
  const out = [];
  for (const row of list) {
    const rawId = getPropertyId(row);
    const id = rawId == null ? "" : String(rawId).trim();
    if (!id || !aopIds.has(id)) {
      out.push(row);
      continue;
    }
    if (hasActivity(row)) {
      const name = row && row.propertyName ? String(row.propertyName) : null;
      out.push({
        ...row,
        aopFlagged: true,
        propertyName: name ? `${name} (AOP)` : name,
      });
    }
  }
  return out;
}

export function occupancyRowHasActivity(r) {
  if (!r) return false;
  return (
    (r.totalUnits || 0) > 0 ||
    (r.occupiedUnits || 0) > 0 ||
    (r.leasedUnits || 0) > 0 ||
    (r.noticeUnits || 0) > 0 ||
    (r.inPlaceRent || 0) > 0 ||
    (r.marketRent || 0) > 0
  );
}

export function leaseExpirationRowHasActivity(r) {
  if (!r) return false;
  return (
    (r.expiring365 || 0) > 0 ||
    (r.exposure365 || 0) > 0 ||
    (r.atRiskCount || 0) > 0 ||
    (r.mtmCount || 0) > 0 ||
    (r.expiringInPlaceRent || 0) > 0
  );
}

export function concessionRowHasActivity(r) {
  if (!r) return false;
  return (
    (r.totalLeases || 0) > 0 ||
    (r.concessionLeaseCount || 0) > 0 ||
    (r.concessionTotal || 0) > 0 ||
    (r.annualRentTotal || 0) > 0
  );
}

export function workOrderRowHasActivity(r) {
  if (!r) return false;
  return (
    (r.openCount || 0) > 0 ||
    (r.totalCount || 0) > 0 ||
    (r.emergencyTotal || 0) > 0
  );
}
