import { supabase } from "./supabaseClient.js";

export const GL_TOLERANCES = Object.freeze({
  pipelineTol: 0.005,
  acctAbsTol: 250,
  acctRelTol: 0.01,
  bucketAbsTol: 1000,
  bucketRelTol: 0.005,
  coverageFloorPct: 95,
});

export const DRIFT_PROMINENCE = Object.freeze({
  leaseChanges: 2,
  rentDeltaAbs: 1000,
});

export const STALE_SOURCE_DAYS = 5;

export const UNIT_LEASE_THRESHOLDS = Object.freeze({
  matchFloorPct: 95,
});

const GL_TOLERANCE_PARAMS = Object.freeze({
  p_pipeline_tol: GL_TOLERANCES.pipelineTol,
  p_acct_abs_tol: GL_TOLERANCES.acctAbsTol,
  p_acct_rel_tol: GL_TOLERANCES.acctRelTol,
});

export async function fetchGlReconciliation(
  propertyCode,
  { monthStart = null, monthEnd = null } = {},
) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("check_gl_reconciliation", {
    p_property_code: propertyCode,
    p_month_start: monthStart,
    p_month_end: monthEnd,
    ...GL_TOLERANCE_PARAMS,
    p_bucket_abs_tol: GL_TOLERANCES.bucketAbsTol,
    p_bucket_rel_tol: GL_TOLERANCES.bucketRelTol,
  });
  if (error) {
    console.error("fetchGlReconciliation error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchGlReconciliationSummary({
  monthStart = null,
  monthEnd = null,
} = {}) {
  const { data, error } = await supabase.rpc(
    "check_gl_reconciliation_summary",
    {
      p_month_start: monthStart,
      p_month_end: monthEnd,
      ...GL_TOLERANCE_PARAMS,
      p_coverage_floor: GL_TOLERANCES.coverageFloorPct,
    },
  );
  if (error) {
    console.error("fetchGlReconciliationSummary error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchRentRollDrift(propertyId = null) {
  const { data, error } = await supabase.rpc("check_rent_roll_drift", {
    p_property_id: propertyId,
  });
  if (error) {
    console.error("fetchRentRollDrift error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchUnitLeaseMatch({
  matchFloorPct = UNIT_LEASE_THRESHOLDS.matchFloorPct,
} = {}) {
  const { data, error } = await supabase.rpc("check_unit_lease_match", {
    p_match_floor: matchFloorPct,
  });
  if (error) {
    console.error("fetchUnitLeaseMatch error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export function isStaleSource(ts) {
  const d = daysSince(ts);
  return d !== null && d > STALE_SOURCE_DAYS;
}

function daysSince(ts) {
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  return Number.isFinite(ms) ? ms / 86400000 : null;
}

export function deriveGlRowMeta(row) {
  if (!row) return { refreshPending: false, staleSource: false };
  const state = row.state;
  const substrateAsOf = row.substrate_as_of
    ? new Date(row.substrate_as_of)
    : null;
  const entrataAsOf = row.entrata_as_of ? new Date(row.entrata_as_of) : null;
  const refreshPending = Boolean(
    (state === "diverge" || state === "entrata_only") &&
    row.check_type === "pipeline" &&
    substrateAsOf &&
    entrataAsOf &&
    entrataAsOf > substrateAsOf,
  );
  const subAge = daysSince(row.substrate_as_of);
  const entAge = daysSince(row.entrata_as_of);
  const staleSource = Boolean(
    (subAge !== null && subAge > STALE_SOURCE_DAYS) ||
    (entAge !== null && entAge > STALE_SOURCE_DAYS),
  );
  return { refreshPending, staleSource };
}

export function glStateTone(state) {
  switch (state) {
    case "agree":
    case "match":
      return "agree";
    case "diverge":
    case "duplicate_origin":
    case "substrate_only":
    case "entrata_only":
      return "diverge";
    case "partial":
    case "explained":
    case "not_comparable":
      return "explained";
    case "no_data":
    default:
      return "unavailable";
  }
}

export function summarizeGlMonths(rows) {
  const byMonth = new Map();
  for (const r of rows || []) {
    if (!r || r.grain !== "account" || !r.month_end) continue;
    const m = byMonth.get(r.month_end) || {
      monthEnd: r.month_end,
      checkType: r.check_type,
      accounts: 0,
      diverged: 0,
      netDelta: 0,
      grossDelta: 0,
      substrateAsOf: null,
      entrataAsOf: null,
    };
    m.accounts += 1;
    m.netDelta += Number(r.delta) || 0;
    if (glStateTone(r.state) === "diverge") {
      m.diverged += 1;
      m.grossDelta += Math.abs(Number(r.delta) || 0);
    }
    if (
      r.substrate_as_of &&
      (!m.substrateAsOf || r.substrate_as_of > m.substrateAsOf)
    ) {
      m.substrateAsOf = r.substrate_as_of;
    }
    if (
      r.entrata_as_of &&
      (!m.entrataAsOf || r.entrata_as_of > m.entrataAsOf)
    ) {
      m.entrataAsOf = r.entrata_as_of;
    }
    byMonth.set(r.month_end, m);
  }
  const months = [...byMonth.values()]
    .sort((a, b) => (a.monthEnd < b.monthEnd ? -1 : 1))
    .map((m) => ({ ...m, state: m.diverged > 0 ? "diverge" : "agree" }));
  const divergedList = months.filter((m) => m.state === "diverge");
  return {
    months,
    totalMonths: months.length,
    divergedMonths: divergedList.length,
    latest: months.length ? months[months.length - 1] : null,
    worst: divergedList.reduce(
      (w, m) => (!w || m.grossDelta > w.grossDelta ? m : w),
      null,
    ),
  };
}

export function classifyDriftProminence(drift, thresholds = DRIFT_PROMINENCE) {
  if (!drift) return "quiet";
  const changes =
    (Number(drift.leases_changed) || 0) +
    (Number(drift.leases_added) || 0) +
    (Number(drift.leases_removed) || 0);
  const rentMoved = Math.abs(Number(drift.base_rent_delta) || 0);
  return changes >= thresholds.leaseChanges ||
    rentMoved >= thresholds.rentDeltaAbs
    ? "notable"
    : "quiet";
}

export function describeDrift(drift) {
  if (!drift) return null;
  const changes =
    (Number(drift.leases_changed) || 0) +
    (Number(drift.leases_added) || 0) +
    (Number(drift.leases_removed) || 0);
  const rentMoved = Number(drift.base_rent_delta) || 0;
  const adjMoved = Number(drift.adjustments_changed) || 0;
  if (changes === 0 && rentMoved === 0 && adjMoved === 0) {
    return "live roll matches the signed version";
  }
  const parts = [];
  if (changes > 0) parts.push(`${changes} lease${changes === 1 ? "" : "s"}`);
  if (rentMoved !== 0) {
    parts.push(
      `${rentMoved < 0 ? "-" : ""}$${Math.abs(rentMoved).toLocaleString(
        "en-US",
        {
          maximumFractionDigits: 0,
        },
      )} base rent`,
    );
  }
  if (adjMoved > 0)
    parts.push(`${adjMoved} adjustment${adjMoved === 1 ? "" : "s"}`);
  return `live roll has moved ${parts.join(" / ")} since`;
}
