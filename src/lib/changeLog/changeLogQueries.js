import {
  supabase,
  fetchPropertyEntityLinks,
  fetchProperties,
} from "../supabaseClient.js";
import {
  displayVal,
  humanizeField,
  diffVersionSeries,
  diffPair,
  scrubInternalVocabulary,
  isUuidLike,
  namedEntity,
  sourceRef,
} from "./changeLogFormat.js";

export const CHANGE_TYPES = [
  "assumption",
  "itemized",
  "lease_adjustment",
  "rent_roll_version",
  "budget_seal",
  "writeback",
];

export const CHANGE_TYPE_LABELS = {
  assumption: "Budget Assumption",
  itemized: "Itemized Budget Edit",
  lease_adjustment: "Rent-Roll Adjustment",
  rent_roll_version: "Rent-Roll Version",
  budget_seal: "Budget Sealing",
  writeback: "Entrata Write-Back",
};

const PER_SURFACE_LIMIT = 5000;

function dayStartISO(d) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00.000Z`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}
function dayEndISO(d) {
  if (!d) return null;
  const dt = new Date(`${d}T23:59:59.999Z`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}
function applyRange(query, col, startISO, endISO) {
  let q = query;
  if (startISO) q = q.gte(col, startISO);
  if (endISO) q = q.lte(col, endISO);
  return q;
}

export async function loadPropertyLabelMaps() {
  const codeToKey = {};
  const entrataIdToKey = {};
  const keyToLabel = {};

  const [codeMap, props, links] = await Promise.all([
    supabase
      .from("budget_property_code_map")
      .select("property_code, property_id")
      .then((r) => (r.error ? [] : r.data || []))
      .catch(() => []),
    fetchProperties().catch(() => []),
    fetchPropertyEntityLinks().catch(() => []),
  ]);

  for (const p of props || []) {
    if (!p || p.id == null) continue;
    if (p.name) keyToLabel[p.id] = p.name;
    if (p.entrataPropertyId != null)
      entrataIdToKey[String(p.entrataPropertyId)] = p.id;
  }

  for (const m of codeMap) {
    const code = String(m?.property_code ?? "").trim();
    if (!code || m.property_id == null) continue;
    if (!codeToKey[code]) codeToKey[code] = m.property_id;
  }

  for (const l of links || []) {
    const code = String(l.propertyCode || "").trim();
    const eid = String(l.entrataId || "").trim();
    const key = l.propertyId || (eid ? entrataIdToKey[eid] : null) || null;
    if (!key) continue;
    if (code && !codeToKey[code]) codeToKey[code] = key;
    if (!keyToLabel[key] && l.property) keyToLabel[key] = l.property;
  }

  return { codeToKey, entrataIdToKey, keyToLabel };
}

export const UNIDENTIFIED_ACTOR = "Unidentified user";

async function resolveActorLabels(authIds) {
  const ids = [...new Set(authIds.filter(Boolean))];
  const map = {};
  if (!ids.length) return map;
  try {
    const { data } = await supabase
      .from("user_profiles")
      .select("auth_id, email, display_name")
      .in("auth_id", ids);
    for (const u of data || []) {
      const name = (u.display_name || "").trim();
      map[u.auth_id] = name || (u.email || "").trim() || UNIDENTIFIED_ACTOR;
    }
  } catch (_e) {}
  return map;
}

const ASSUMPTION_TARGETS = {
  itemized: "Itemized budget line",
  pdpq: "Per-door / per-quarter assumption",
};

function leaseEntity(adjustmentType, leaseId) {
  const kind = adjustmentType
    ? humanizeField(adjustmentType)
    : "Rent-roll adjustment";
  if (leaseId == null || isUuidLike(leaseId)) return kind;
  return `${kind} · Lease ${leaseId}`;
}

async function queryAssumptions(startISO, endISO) {
  const q = applyRange(
    supabase
      .from("assumption_propagation_applies")
      .select(
        "id, apply_token, change_set_name, property_codes, row_images, rows_updated, applied_by, applied_at",
      ),
    "applied_at",
    startISO,
    endISO,
  )
    .order("applied_at", { ascending: false })
    .limit(PER_SURFACE_LIMIT);
  const { data, error } = await q;
  if (error) throw error;
  const rows = [];
  for (const a of data || []) {
    const images = Array.isArray(a.row_images) ? a.row_images : [];
    const batchKey = a.id ? `assumption:${a.id}` : null;
    const why = scrubInternalVocabulary(a.change_set_name);
    for (const img of images) {
      const target =
        ASSUMPTION_TARGETS[img.target] ||
        (img.target ? humanizeField(img.target) : "Assumption");
      const rowRef =
        img.row_id != null && !isUuidLike(img.row_id) ? ` #${img.row_id}` : "";
      rows.push({
        change_type: "assumption",
        _code: img.property_code || null,
        _entrataId: null,
        _actorAuthId: a.applied_by || null,
        _actorText: null,
        _batchKey: batchKey,
        _batchLabel: why || "Assumption propagation",
        entity: `${target}${rowRef}`,
        field: img.field != null ? humanizeField(img.field) : "",
        ...diffPair(img.pre, img.post, img.field),
        changed_at: a.applied_at,
        source_ref: sourceRef("Assumption propagation", a.apply_token),
        why,
      });
    }
  }
  return { rows, truncated: (data || []).length >= PER_SURFACE_LIMIT };
}

async function queryItemized(startISO, endISO) {
  const q = applyRange(
    supabase
      .schema("raw")
      .from("itemized_versions")
      .select(
        "id, itemized_id, property_code, category, change_kind, changed_by, changed_at, row_snapshot",
      ),
    "changed_at",
    startISO,
    endISO,
  )
    .order("changed_at", { ascending: false })
    .limit(PER_SURFACE_LIMIT);
  const { data, error } = await q;
  if (error) throw error;
  const rows = diffVersionSeries(
    data || [],
    "itemized_id",
    (v, field, oldV, newV) => ({
      change_type: "itemized",
      _code: v.property_code || null,
      _entrataId: null,
      _actorAuthId: v.changed_by || null,
      _actorText: null,
      entity:
        v.category ||
        (v.row_snapshot && v.row_snapshot.category) ||
        "Itemized line",
      field,
      old_value: oldV,
      new_value: newV,
      changed_at: v.changed_at,
      source_ref: sourceRef("Itemized budget line", v.itemized_id),
      why: "",
    }),
  );
  return { rows, truncated: (data || []).length >= PER_SURFACE_LIMIT };
}

async function queryLeaseAdjustments(startISO, endISO) {
  const rows = [];
  let truncated = false;

  let versions = [];
  try {
    const q = applyRange(
      supabase
        .from("lease_adjustment_versions")
        .select(
          "id, adjustment_id, property_id, adjustment_type, change_kind, changed_by, changed_at, row_snapshot",
        ),
      "changed_at",
      startISO,
      endISO,
    )
      .order("changed_at", { ascending: false })
      .limit(PER_SURFACE_LIMIT);
    const { data, error } = await q;
    if (error) throw error;
    versions = data || [];
    truncated = versions.length >= PER_SURFACE_LIMIT;
  } catch (_e) {
    versions = [];
  }
  const versionedIds = new Set(versions.map((v) => v.adjustment_id));
  rows.push(
    ...diffVersionSeries(versions, "adjustment_id", (v, field, oldV, newV) => ({
      change_type: "lease_adjustment",
      _code: null,
      _entrataId: v.property_id != null ? String(v.property_id) : null,
      _actorAuthId: v.changed_by || null,
      _actorText: null,
      entity: leaseEntity(
        v.adjustment_type,
        v.row_snapshot && v.row_snapshot.lease_id,
      ),
      field,
      old_value: oldV,
      new_value: newV,
      changed_at: v.changed_at,
      source_ref: sourceRef("Rent-roll adjustment", v.adjustment_id),
      why: "",
    })),
  );

  try {
    const q = applyRange(
      supabase
        .from("lease_adjustments")
        .select(
          "id, property_id, adjustment_type, lease_id, note, is_active, signed_off_by, updated_at, updated_by, created_by",
        ),
      "updated_at",
      startISO,
      endISO,
    )
      .order("updated_at", { ascending: false })
      .limit(PER_SURFACE_LIMIT);
    const { data, error } = await q;
    if (error) throw error;
    if ((data || []).length >= PER_SURFACE_LIMIT) truncated = true;
    for (const adj of data || []) {
      if (versionedIds.has(adj.id)) continue;
      rows.push({
        change_type: "lease_adjustment",
        _code: null,
        _entrataId: adj.property_id != null ? String(adj.property_id) : null,
        _actorAuthId: adj.updated_by || adj.created_by || null,
        _actorText: null,
        entity: leaseEntity(adj.adjustment_type, adj.lease_id),
        field: "(current state)",
        old_value: "(history not captured)",
        new_value: [
          adj.is_active ? "active" : "inactive",
          adj.note ? `note: ${adj.note}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        changed_at: adj.updated_at,
        source_ref: sourceRef("Rent-roll adjustment", adj.id),
        why: "Recorded before change history was captured",
      });
    }
  } catch (_e) {}
  return { rows, truncated };
}

async function queryRentRollVersions(startISO, endISO) {
  let q = supabase
    .from("rent_roll_versions")
    .select(
      "id, property_id, label, status, line_count, created_by, created_at, signed_off_by, signed_off_at, locked_by, locked_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(PER_SURFACE_LIMIT);
  if (endISO) q = q.lte("created_at", endISO);
  if (startISO) q = q.gte("updated_at", startISO);
  const { data, error } = await q;
  if (error) throw error;
  const inRange = (iso) =>
    iso && (!startISO || iso >= startISO) && (!endISO || iso <= endISO);
  const rows = [];
  for (const v of data || []) {
    const base = {
      change_type: "rent_roll_version",
      _code: null,
      _entrataId: v.property_id != null ? String(v.property_id) : null,
      entity: namedEntity("Rent-roll version", v.label),
      old_value: "",
      why: "",
    };
    if (inRange(v.created_at)) {
      rows.push({
        ...base,
        _actorAuthId: v.created_by || null,
        _actorText: null,
        field: "created",
        new_value: `${v.line_count ?? 0} lines`,
        changed_at: v.created_at,
        source_ref: sourceRef("Rent-roll version", v.id),
      });
    }
    if (inRange(v.signed_off_at)) {
      rows.push({
        ...base,
        _actorAuthId: null,
        _actorText: v.signed_off_by || null,
        field: "signed off",
        new_value: "signed",
        changed_at: v.signed_off_at,
        source_ref: sourceRef("Rent-roll version", v.id),
      });
    }
    if (inRange(v.locked_at)) {
      rows.push({
        ...base,
        _actorAuthId: v.locked_by || null,
        _actorText: null,
        field: "locked",
        new_value: "locked",
        changed_at: v.locked_at,
        source_ref: sourceRef("Rent-roll version", v.id),
      });
    }
  }
  return { rows, truncated: (data || []).length >= PER_SURFACE_LIMIT };
}

async function queryBudgetSeals(startISO, endISO) {
  const q = applyRange(
    supabase
      .from("budget_snapshots")
      .select(
        "id, property_code, label, month_end_min, month_end_max, line_count, sealed_by, sealed_at",
      ),
    "sealed_at",
    startISO,
    endISO,
  )
    .order("sealed_at", { ascending: false })
    .limit(PER_SURFACE_LIMIT);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data || []).map((s) => {
    const span = [s.month_end_min, s.month_end_max]
      .filter(Boolean)
      .join(" to ");
    return {
      change_type: "budget_seal",
      _code: s.property_code || null,
      _entrataId: null,
      _actorAuthId: s.sealed_by || null,
      _actorText: null,
      entity: namedEntity("Budget snapshot", s.label),
      field: "sealed",
      old_value: "",
      new_value: [`${s.line_count ?? 0} lines`, span]
        .filter(Boolean)
        .join(" · "),
      changed_at: s.sealed_at,
      source_ref: sourceRef("Budget snapshot", s.id),
      why: "",
    };
  });
  return { rows, truncated: (data || []).length >= PER_SURFACE_LIMIT };
}

async function queryWritebacks(startISO, endISO) {
  const q = applyRange(
    supabase
      .from("audit_log")
      .select(
        "id, action, resource_type, resource_name, metadata, outcome, user_email, timestamp",
      )
      .ilike("action", "entrata.budget.writeback%"),
    "timestamp",
    startISO,
    endISO,
  )
    .order("timestamp", { ascending: false })
    .limit(PER_SURFACE_LIMIT);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data || []).map((e) => {
    const meta = e.metadata || {};
    const ref = String(meta.resource_ref || "").trim();
    const refCode = ref.split(":")[0].trim() || null;
    const code = meta.property_code || refCode || null;
    const eid = meta.property_id != null ? String(meta.property_id) : null;
    const summary = meta.summary || {};

    const mode = String(e.action || "")
      .split(".")
      .pop();
    const applied = meta.entrata_applied;
    const failed = e.outcome === "failure" || applied === false;

    let field;
    if (mode === "dry_run") field = "previewed (not sent to Entrata)";
    else if (failed) field = "send to Entrata failed";
    else field = "sent to Entrata";

    const counts = [
      summary.accountsTotal != null ? `${summary.accountsTotal} accounts` : "",
      summary.monthsCovered != null ? `${summary.monthsCovered} months` : "",
      meta.entrata_status ? `Entrata responded ${meta.entrata_status}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      change_type: "writeback",
      _code: code,
      _entrataId: eid,
      _actorAuthId: null,
      _actorText: e.user_email || null,
      entity: e.resource_name || "Entrata write-back",
      field,
      old_value: "",
      new_value: counts || "(event only)",
      changed_at: e.timestamp,
      source_ref: ref ? `Entrata write-back (${ref})` : "Entrata write-back",
      why: "",
    };
  });
  return { rows, truncated: (data || []).length >= PER_SURFACE_LIMIT };
}

const SURFACE_FNS = {
  assumption: queryAssumptions,
  itemized: queryItemized,
  lease_adjustment: queryLeaseAdjustments,
  rent_roll_version: queryRentRollVersions,
  budget_seal: queryBudgetSeals,
  writeback: queryWritebacks,
};

export async function buildChangeLog({
  startDate,
  endDate,
  changeTypes,
  labelMaps = null,
  isAdmin = false,
} = {}) {
  const startISO = dayStartISO(startDate);
  const endISO = dayEndISO(endDate);
  const types = (
    Array.isArray(changeTypes) && changeTypes.length
      ? changeTypes
      : CHANGE_TYPES
  ).filter((t) => SURFACE_FNS[t]);

  const maps = labelMaps || (await loadPropertyLabelMaps());

  const settled = await Promise.allSettled(
    types.map((t) => SURFACE_FNS[t](startISO, endISO)),
  );

  const intermediate = [];
  const notes = [];
  let truncated = false;
  settled.forEach((res, i) => {
    const t = types[i];
    if (res.status === "fulfilled") {
      intermediate.push(...res.value.rows);
      if (res.value.truncated) {
        truncated = true;
        notes.push(
          `${CHANGE_TYPE_LABELS[t]}: results capped at ${PER_SURFACE_LIMIT} — narrow the date range for completeness.`,
        );
      }
    } else {
      console.error(`changeLog surface "${t}" failed:`, res.reason);
      notes.push(
        `${CHANGE_TYPE_LABELS[t]}: could not be loaded. The rest of the log is complete.`,
      );
    }
  });

  if (
    types.includes("writeback") &&
    !isAdmin &&
    !intermediate.some((r) => r.change_type === "writeback")
  ) {
    notes.push(
      "Entrata Write-Back: the audit log is admin-visible, so write-back events may be limited or empty with your access.",
    );
  }

  const actorMap = await resolveActorLabels(
    intermediate.map((r) => r._actorAuthId),
  );
  const labelForKey = new Map();
  const withLabel = (key, fallback) => {
    const k = String(key);
    if (!labelForKey.has(k))
      labelForKey.set(k, maps.keyToLabel?.[key] || fallback);
    return { property_key: k, property_label: labelForKey.get(k) };
  };

  const resolveProperty = (r) => {
    if (r._code) {
      const code = String(r._code).trim();
      const key = maps.codeToKey?.[code];
      if (key) return withLabel(key, code);
      return withLabel(`code:${code}`, code);
    }
    if (r._entrataId) {
      const eid = String(r._entrataId).trim();
      const key = maps.entrataIdToKey?.[eid];
      if (key) return withLabel(key, `Entrata property ${eid}`);
      return withLabel(
        `entrata:${eid}`,
        `Unmapped property (Entrata ID ${eid})`,
      );
    }
    return { property_key: "", property_label: "—" };
  };

  const finalize = (r) => {
    const { property_key, property_label } = resolveProperty(r);

    let changed_by_label;
    if (r._actorText) changed_by_label = r._actorText;
    else if (r._actorAuthId)
      changed_by_label = actorMap[r._actorAuthId] || UNIDENTIFIED_ACTOR;
    else changed_by_label = "not captured";

    return {
      change_type: r.change_type,
      change_type_label: CHANGE_TYPE_LABELS[r.change_type] || r.change_type,
      property_key,
      property_label,
      entity: r.entity || "",
      field: r.field || "",
      old_value: r.old_value ?? "",
      new_value: r.new_value ?? "",
      changed_by_label,
      changed_at: r.changed_at || null,
      source_ref: r.source_ref || "",
      why: r.why || "",
      batch_key: r._batchKey || null,
      batch_label: r._batchLabel || "",
    };
  };

  const rows = intermediate.map(finalize);
  rows.sort(
    (a, b) => new Date(b.changed_at || 0) - new Date(a.changed_at || 0),
  );

  return { rows, notes, truncated, count: rows.length };
}
