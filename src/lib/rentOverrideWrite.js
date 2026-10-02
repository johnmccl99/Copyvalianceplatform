import { normalizeLabel } from "./rentOverrideWorkbook.js";

export const OVERRIDE_TYPE = "lease_rent_override";

export const MASTER_LEASE_GROUP_TYPE = "master_lease_group";

export function detectGroupCollisions(matched = [], existingByProperty = {}) {
  const collisions = [];
  for (const m of matched || []) {
    const leaseId = m && m.bed ? m.bed.lease_id : null;
    if (leaseId == null) continue;
    const pid = String(m.entrataPropertyId);
    const groups = (existingByProperty[pid] || []).filter(
      (a) =>
        a &&
        a.adjustment_type === MASTER_LEASE_GROUP_TYPE &&
        a.is_active !== false &&
        a.payload &&
        a.payload.rent_override != null &&
        a.payload.rent_override !== "" &&
        Array.isArray(a.payload.member_lease_ids) &&
        a.payload.member_lease_ids.some((id) => String(id) === String(leaseId)),
    );
    if (groups.length) {
      collisions.push({
        entrataPropertyId: m.entrataPropertyId,
        unitNumber: m.unitNumber,
        leaseId,
        groups: groups.map((g) => ({
          id: g.id,
          group_name: (g.payload && g.payload.group_name) || null,
        })),
      });
    }
  }
  return collisions;
}

function payloadFor(matchedEntry) {
  const row = matchedEntry.row || {};
  return {
    unit_number: matchedEntry.unitNumber,
    rent_override: row.rent,
    unit_space_id: row.unitSpaceId || null,
    tenant_name: row.tenant || null,
  };
}

function activeOverridesForBed(existing, unitNumber) {
  const target = normalizeLabel(unitNumber);
  return (existing || []).filter(
    (a) =>
      a &&
      a.adjustment_type === OVERRIDE_TYPE &&
      a.is_active !== false &&
      normalizeLabel(a.payload && a.payload.unit_number) === target,
  );
}

export function planOverrideWrites(matched = [], existingByProperty = {}) {
  const inserts = [];
  const updates = [];
  const unchanged = [];
  const conflicts = [];

  for (const m of matched || []) {
    const pid = String(m.entrataPropertyId);
    const payload = payloadFor(m);
    const existing = activeOverridesForBed(
      existingByProperty[pid],
      m.unitNumber,
    );

    if (existing.length > 1) {
      conflicts.push({ ...m, reason: "multiple-active-overrides", existing });
      continue;
    }
    if (existing.length === 1) {
      const cur = Number(
        existing[0].payload && existing[0].payload.rent_override,
      );
      if (cur === Number(payload.rent_override)) {
        unchanged.push({ ...m, id: existing[0].id });
      } else {
        updates.push({
          ...m,
          id: existing[0].id,
          propertyId: m.entrataPropertyId,
          payload,
        });
      }
    } else {
      inserts.push({ ...m, propertyId: m.entrataPropertyId, payload });
    }
  }

  return {
    inserts,
    updates,
    unchanged,
    conflicts,
    summary: {
      inserts: inserts.length,
      updates: updates.length,
      unchanged: unchanged.length,
      conflicts: conflicts.length,
      writes: inserts.length + updates.length,
    },
  };
}
