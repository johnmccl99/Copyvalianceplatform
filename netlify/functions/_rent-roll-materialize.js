import { overlayAdjustments } from "../../src/lib/rentRollAdjustments.js";
import { attachChargesToRows } from "../../src/lib/rentRollChargeColumns.js";
import { applyFieldOverridesToRows } from "../../src/lib/rentRollFieldOverrides.js";
import { RENT_PLAUSIBLE_MIN } from "../../src/lib/rentRollView.js";
import {
  normalizeAsOf,
  rentRollDateQueryString,
  resolveRentRollRows,
} from "../../src/lib/entrataLeaseStatus.js";

export const ENTRATA_LEASE_COLUMNS =
  "lease_id, unit_id, unit_number, status, " +
  "lease_start_date, lease_end_date, move_in_date, move_out_date, " +
  "rent, deposit, primary_customer_id, primary_customer_name, " +
  "primary_customer_email, is_mtm, last_seen_at, space_configuration";

export const LEASE_ADJUSTMENT_COLUMNS =
  "id, org_id, property_id, adjustment_type, lease_id, payload, note, is_active";

export function mapEntrataLeaseRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    lease_id: row.lease_id,
    unit_id: row.unit_id,
    unit_number: row.unit_number || "",
    status: row.status || "",
    lease_start: row.lease_start_date || null,
    lease_end: row.lease_end_date || null,
    move_in: row.move_in_date || null,
    move_out: row.move_out_date || null,
    rent: row.rent === null || row.rent === undefined ? null : Number(row.rent),
    deposit:
      row.deposit === null || row.deposit === undefined
        ? null
        : Number(row.deposit),
    tenant_id: row.primary_customer_id || null,
    tenant_name: row.primary_customer_name || "",
    tenant_email: row.primary_customer_email || "",
    is_mtm: !!row.is_mtm,
    last_seen_at: row.last_seen_at || null,
    space_configuration: row.space_configuration || null,
  };
}

export function startOfDayInstant(asOf, timeZone) {
  const on = normalizeAsOf(asOf);
  const utcMidnight = Date.parse(`${on}T00:00:00Z`);
  if (!Number.isFinite(utcMidnight)) return null;
  if (!timeZone) return new Date(utcMidnight).toISOString();
  const wallOffset = (at) => {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(at))
      .reduce((acc, part) => {
        if (part.type !== "literal") acc[part.type] = part.value;
        return acc;
      }, {});
    const hour = p.hour === "24" ? 0 : Number(p.hour);
    return (
      Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        hour,
        Number(p.minute),
        Number(p.second),
      ) - at
    );
  };
  try {
    const guess = utcMidnight - wallOffset(utcMidnight);
    return new Date(utcMidnight - wallOffset(guess)).toISOString();
  } catch {
    return new Date(utcMidnight).toISOString();
  }
}

export async function materializeEffectiveRoll({
  pg,
  bearer,
  entrataPropertyId,
  asOf,
}) {
  const on = normalizeAsOf(asOf);
  const baseRes = await pg(
    `/entrata_leases?property_id=eq.${encodeURIComponent(entrataPropertyId)}&${rentRollDateQueryString(on)}&select=${encodeURIComponent(ENTRATA_LEASE_COLUMNS)}&order=unit_number.asc`,
    { bearer },
  );
  if (!baseRes.ok || !Array.isArray(baseRes.body)) {
    return {
      effectiveRows: null,
      error: { stage: "base", status: baseRes.status },
    };
  }
  const adjRes = await pg(
    `/lease_adjustments?property_id=eq.${encodeURIComponent(entrataPropertyId)}&select=${encodeURIComponent(LEASE_ADJUSTMENT_COLUMNS)}&order=created_at.asc`,
    { bearer },
  );
  if (!adjRes.ok || !Array.isArray(adjRes.body)) {
    return {
      effectiveRows: null,
      error: { stage: "adjustments", status: adjRes.status },
    };
  }
  const baseRows = resolveRentRollRows(baseRes.body, on)
    .map(mapEntrataLeaseRow)
    .filter(Boolean);
  const { rows: effectiveRows } = overlayAdjustments(baseRows, adjRes.body, {
    asOf: on,
  });

  const chargeRes = await pg("/rpc/entrata_rent_roll_charge_matrix", {
    bearer,
    method: "POST",
    body: {
      p_property_id: Number(entrataPropertyId),
      p_as_of: on.slice(0, 10),
    },
  }).catch((e) => {
    console.error(
      "materializeEffectiveRoll: charge matrix call threw; capturing charges as not-recorded",
      e,
    );
    return { ok: false, status: 0, body: null };
  });

  if (!chargeRes.ok || !Array.isArray(chargeRes.body)) {
    console.error(
      "materializeEffectiveRoll: charge matrix unavailable (status %s); capturing charges as not-recorded",
      chargeRes.status,
    );
    return {
      effectiveRows: applyFieldOverridesToRows(effectiveRows || []),
      error: null,
      chargesCaptured: false,
    };
  }

  const withCharges = attachChargesToRows(
    effectiveRows || [],
    chargeRes.body,
    RENT_PLAUSIBLE_MIN,
  );
  return {
    effectiveRows: applyFieldOverridesToRows(withCharges),
    error: null,
    chargesCaptured: true,
  };
}
