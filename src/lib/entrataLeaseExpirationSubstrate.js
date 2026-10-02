export const LEASE_EXPIRATION_READY = "ready";
export const LEASE_EXPIRATION_NO_EXPIRATIONS = "no_expirations";
export const LEASE_EXPIRATION_UNREADABLE = "unreadable";

const count = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function classifyLeaseExpirationSubstrate({
  rowCount = 0,
  totals = null,
  leaseDataLastSeen = null,
} = {}) {
  const t = totals && typeof totals === "object" ? totals : {};
  if (count(rowCount) > 0 && count(t.expiring365) > 0)
    return LEASE_EXPIRATION_READY;
  if (count(rowCount) <= 0) return LEASE_EXPIRATION_UNREADABLE;
  const leaseDataReadable = Boolean(leaseDataLastSeen) || count(t.mtmCount) > 0;
  return leaseDataReadable
    ? LEASE_EXPIRATION_NO_EXPIRATIONS
    : LEASE_EXPIRATION_UNREADABLE;
}

export const LEASE_EXPIRATION_EMPTY_COPY = {
  [LEASE_EXPIRATION_NO_EXPIRATIONS]: {
    title: "No lease expirations in the next 12 months",
    body:
      "Lease data for the synced properties was read successfully and no " +
      "fixed-term lease expires within the next 12 months, so the pipeline " +
      "is genuinely empty rather than unavailable. Month-to-month leases " +
      "auto-renew and are excluded from this pipeline.",
  },
  [LEASE_EXPIRATION_UNREADABLE]: {
    title: "Lease data could not be read",
    body:
      "No readable lease rows came back for the synced properties, so this " +
      "pipeline cannot tell you whether anything is expiring — the zeros it " +
      "would otherwise show are missing data, not an empty expiration " +
      "schedule. The pipeline is built from the properties, units, and leases " +
      "synced from Entrata: connect an Entrata account under Admin Console → " +
      "Integrations and run a sync. If the sync has already run, ask an " +
      "administrator to confirm your role can read the Entrata lease tables.",
  },
};
