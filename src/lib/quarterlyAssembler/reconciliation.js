export const RECON_CLEAN = "clean";
export const RECON_PARTIAL = "partial";
export const RECON_STALE = "stale";

export function computeReconciliationStatus({
  monthStates,
  sealedAt,
  quarterStart,
  blockCoverages,
}) {
  if (sealedAt && quarterStart && sealedAt.slice(0, 10) < quarterStart) {
    return RECON_STALE;
  }

  const allMonthsClosed =
    Array.isArray(monthStates) &&
    monthStates.length > 0 &&
    monthStates.every((m) => m.state === "closed");

  const anyUnavailable = (blockCoverages || []).some(
    (c) => c === "unavailable",
  );

  if (!allMonthsClosed || anyUnavailable || !sealedAt) {
    return RECON_PARTIAL;
  }
  return RECON_CLEAN;
}

export function isExportBlocked(status, operatorOverride) {
  return status === RECON_STALE && !operatorOverride;
}
