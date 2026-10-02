import { applySecurity, jsonResponse } from "./_security.js";
import { recompute } from "./lib/formula-recompute.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

async function sr(path, { method = "GET", body = null, prefer = null } = {}) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

async function pg(
  path,
  { bearer, method = "GET", body = null, prefer = null } = {},
) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

function makePostgrestDataSource(graphId) {
  const FRONTIER_CHUNK = 10;
  const FRONTIER_CONCURRENCY = 6;
  const FETCH_NODES_CHUNK = 2000;

  function parseCellTextToColRow(cell) {
    const m = String(cell)
      .toUpperCase()
      .match(/^\$?([A-Z]+)\$?(\d+)$/);
    if (!m) return null;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col_n: col, row_n: parseInt(m[2], 10) };
  }

  async function findParentsChunk(frontier) {
    const r = await sr("/rpc/recompute_find_parents", {
      method: "POST",
      body: { p_graph_id: graphId, p_frontier: frontier },
    });
    if (!r.ok) {
      const msg = (r.raw || "").slice(0, 200);
      const transient =
        (r.status === 500 && /statement timeout/i.test(msg)) ||
        r.status === 504 ||
        r.status === 524;
      const err = new Error(`recompute_find_parents HTTP ${r.status}: ${msg}`);
      err.transient = transient;
      throw err;
    }
    return Array.isArray(r.body) ? r.body : [];
  }

  async function findParentsAdaptive(frontier) {
    if (frontier.length === 0) return [];
    try {
      return await findParentsChunk(frontier);
    } catch (e) {
      if (!e.transient || frontier.length <= 1) throw e;
      const mid = Math.floor(frontier.length / 2);
      const [a, b] = await Promise.all([
        findParentsAdaptive(frontier.slice(0, mid)),
        findParentsAdaptive(frontier.slice(mid)),
      ]);
      return a.concat(b);
    }
  }

  async function findParentsBatched(frontier) {
    const chunks = [];
    for (let i = 0; i < frontier.length; i += FRONTIER_CHUNK) {
      chunks.push(frontier.slice(i, i + FRONTIER_CHUNK));
    }
    const all = [];
    for (let i = 0; i < chunks.length; i += FRONTIER_CONCURRENCY) {
      const slice = chunks.slice(i, i + FRONTIER_CONCURRENCY);
      const results = await Promise.all(
        slice.map((c) => findParentsAdaptive(c)),
      );
      for (const r of results) for (const p of r) all.push(p);
    }
    return all;
  }

  return {
    async fetchEdgesByTo(toCellsBySheet) {
      const frontier = [];
      for (const [sheet, cells] of toCellsBySheet) {
        for (const cell of cells) {
          const parsed = parseCellTextToColRow(cell);
          if (parsed)
            frontier.push({
              sheet,
              cell: String(cell).toUpperCase(),
              col_n: parsed.col_n,
              row_n: parsed.row_n,
            });
        }
      }
      const parents = await findParentsBatched(frontier);
      return parents.map((p) => ({
        from_sheet: p.sheet,
        from_cell: p.cell,
        to_sheet: null,
        to_cell: null,
      }));
    },

    async fetchNodes(cellsBySheet) {
      const keys = [];
      for (const [sheet, cells] of cellsBySheet) {
        for (const cell of cells) keys.push({ sheet, cell });
      }
      const all = [];
      for (let i = 0; i < keys.length; i += FETCH_NODES_CHUNK) {
        const slice = keys.slice(i, i + FETCH_NODES_CHUNK);
        const r = await sr("/rpc/recompute_fetch_nodes_by_keys", {
          method: "POST",
          body: { p_graph_id: graphId, p_keys: slice },
        });
        if (!r.ok)
          throw new Error(
            `recompute_fetch_nodes_by_keys HTTP ${r.status}: ${(r.raw || "").slice(0, 200)}`,
          );
        if (Array.isArray(r.body)) for (const n of r.body) all.push(n);
      }
      return all;
    },

    async fetchNodesByKeysRPC(keys) {
      const all = [];
      for (let i = 0; i < keys.length; i += FETCH_NODES_CHUNK) {
        const slice = keys.slice(i, i + FETCH_NODES_CHUNK);
        const r = await sr("/rpc/recompute_fetch_nodes_by_keys", {
          method: "POST",
          body: { p_graph_id: graphId, p_keys: slice },
        });
        if (!r.ok)
          throw new Error(
            `recompute_fetch_nodes_by_keys HTTP ${r.status}: ${(r.raw || "").slice(0, 200)}`,
          );
        if (Array.isArray(r.body)) for (const n of r.body) all.push(n);
      }
      return all;
    },
  };
}

async function verifyOwnership(userJwt, authUserId, propertyId, graphId) {
  if (!authUserId)
    return { ok: false, code: 401, error: "unverified caller identity" };

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?auth_id=eq.${encodeURIComponent(authUserId)}&select=id,org_id,email,role&limit=1`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        Accept: "application/json",
      },
    },
  );
  const profiles = await profileRes.json().catch(() => null);
  if (!Array.isArray(profiles) || !profiles.length)
    return { ok: false, code: 401, error: "profile not found" };
  const callerOrgId = profiles[0].org_id;
  const callerUserId = profiles[0].id;
  const callerEmail = profiles[0].email || null;
  const callerRole = profiles[0].role || null;

  const propRes = await sr(`/properties?id=eq.${propertyId}&select=id,org_id`);
  if (!propRes.ok || !Array.isArray(propRes.body) || !propRes.body.length) {
    return { ok: false, code: 404, error: "property not found" };
  }
  if (propRes.body[0].org_id !== callerOrgId) {
    return { ok: false, code: 403, error: "property not in caller org" };
  }

  const graphRes = await sr(
    `/property_underwriting_model_graphs?id=eq.${graphId}&select=id,property_id,org_id&limit=1`,
  );
  if (!graphRes.ok || !Array.isArray(graphRes.body) || !graphRes.body.length) {
    return { ok: false, code: 404, error: "graph not found" };
  }
  if (
    graphRes.body[0].property_id !== propertyId ||
    graphRes.body[0].org_id !== callerOrgId
  ) {
    return {
      ok: false,
      code: 403,
      error: "graph does not belong to property/org",
    };
  }
  return {
    ok: true,
    orgId: callerOrgId,
    userId: callerUserId,
    authUserId,
    userEmail: callerEmail,
    actorRole: callerRole,
  };
}

function pickValueColumn(v) {
  if (typeof v === "number" && Number.isFinite(v))
    return { value_num: v, value_text: null, value_date: null };
  if (typeof v === "boolean")
    return { value_num: v ? 1 : 0, value_text: null, value_date: null };
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v))
      return { value_num: null, value_text: null, value_date: v };
    return { value_num: null, value_text: v.slice(0, 4000), value_date: null };
  }
  return { value_num: null, value_text: null, value_date: null };
}

function parseScalarRpc(body, keyName) {
  if (typeof body === "number") return body;
  if (Array.isArray(body) && body.length) {
    const f = body[0];
    if (typeof f === "number") return f;
    if (f && typeof f === "object") {
      const v = f[keyName];
      if (typeof v === "number") return v;
      const vs = Object.values(f).filter((x) => typeof x === "number");
      if (vs.length) return vs[0];
    }
  }
  if (body && typeof body === "object" && typeof body[keyName] === "number")
    return body[keyName];
  return 0;
}

async function persistDiff(graphId, diff) {
  if (!diff.length) return { updated: 0, failed: 0 };
  const diffs = diff.map((d) => ({
    sheet: d.sheet,
    cell: d.cell,
    ...pickValueColumn(d.newValue),
  }));
  const r = await sr(`/rpc/recompute_persist_diff`, {
    method: "POST",
    body: { p_graph_id: graphId, p_diffs: diffs },
  });
  if (!r.ok) return { updated: 0, failed: diff.length };
  const updated = parseScalarRpc(r.body, "recompute_persist_diff");
  return { updated, failed: diff.length - updated };
}

async function persistDirtyInputs(graphId, dirtyCells) {
  if (!dirtyCells.length) return { updated: 0, failed: 0 };
  const diffs = dirtyCells.map((dc) => ({
    sheet: dc.sheet,
    cell: String(dc.cell).toUpperCase(),
    ...pickValueColumn(dc.value),
  }));
  const r = await sr(`/rpc/recompute_persist_diff`, {
    method: "POST",
    body: { p_graph_id: graphId, p_diffs: diffs },
  });
  if (!r.ok) return { updated: 0, failed: dirtyCells.length };
  const updated = parseScalarRpc(r.body, "recompute_persist_diff");
  return { updated, failed: dirtyCells.length - updated };
}

async function writebackCanonicals(propertyId, graphId, diff) {
  if (!diff.length) return { written: 0 };
  const cellsBySheet = new Map();
  for (const d of diff) {
    if (!cellsBySheet.has(d.sheet)) cellsBySheet.set(d.sheet, new Set());
    cellsBySheet.get(d.sheet).add(d.cell);
  }
  const canonByCell = new Map();
  for (const [sheet, cells] of cellsBySheet) {
    const arr = Array.from(cells);
    for (let i = 0; i < arr.length; i += 80) {
      const chunk = arr.slice(i, i + 80);
      const inList = "(" + chunk.map((c) => `"${c}"`).join(",") + ")";
      const r = await sr(
        `/property_underwriting_model_nodes?graph_id=eq.${graphId}` +
          `&sheet=eq.${encodeURIComponent(sheet)}` +
          `&cell=in.${encodeURIComponent(inList)}` +
          `&canonical_key=not.is.null&select=sheet,cell,canonical_key`,
      );
      if (r.ok && Array.isArray(r.body)) {
        for (const n of r.body)
          canonByCell.set(`${n.sheet}\x00${n.cell}`, n.canonical_key);
      }
    }
  }
  if (!canonByCell.size) return { written: 0 };
  const patch = {};
  for (const d of diff) {
    const ck = canonByCell.get(`${d.sheet}\x00${d.cell}`);
    if (ck) patch[ck] = d.newValue;
  }
  if (!Object.keys(patch).length) return { written: 0 };
  const r = await sr(`/rpc/merge_property_canonical_values`, {
    method: "POST",
    body: { p_property_id: propertyId, p_patch: patch },
  });
  if (!r.ok) return { written: 0 };
  const rowsTouched = parseScalarRpc(r.body, "merge_property_canonical_values");
  return { written: rowsTouched > 0 ? Object.keys(patch).length : 0 };
}

export function buildAuditLogRow({
  orgId,
  authUserId,
  userEmail,
  actorRole,
  propertyId,
  graphId,
  dirtyCells,
  diff,
}) {
  return {
    org_id: orgId,
    user_id: authUserId,
    user_email: userEmail || null,
    action: "underwriting.recompute",
    resource_type: "property",
    resource_id: propertyId,
    outcome: "success",
    metadata: {
      actor_role: actorRole || null,
      graph_id: graphId,
      dirty_cell_count: dirtyCells.length,
      diff_count: diff.length,
      first_dirty_cells: dirtyCells
        .slice(0, 5)
        .map((c) => `${c.sheet}!${c.cell}`),
      first_diff: diff
        .slice(0, 5)
        .map((d) => ({
          cell: `${d.sheet}!${d.cell}`,
          old: d.oldValue,
          new: d.newValue,
        })),
    },
  };
}

async function auditLog({
  userJwt,
  orgId,
  authUserId,
  userEmail,
  actorRole,
  propertyId,
  graphId,
  dirtyCells,
  diff,
}) {
  try {
    const r = await pg("/audit_log", {
      bearer: userJwt,
      method: "POST",
      prefer: "return=minimal",
      body: [
        buildAuditLogRow({
          orgId,
          authUserId,
          userEmail,
          actorRole,
          propertyId,
          graphId,
          dirtyCells,
          diff,
        }),
      ],
    });
    if (!r.ok)
      console.error(
        "[recompute-bg:audit-log] failed: HTTP",
        r.status,
        r.raw?.slice(0, 200),
      );
  } catch (e) {
    console.warn("[recompute-bg:audit-log] failed:", e?.message);
  }
}

async function updateJob(jobId, patch) {
  const r = await sr(`/property_underwriting_recompute_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: patch,
  });
  if (!r.ok)
    console.warn("[recompute-bg:update] HTTP", r.status, r.raw?.slice(0, 200));
  return r.ok;
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 20 },
  });
  if (gate.error) return gate.error;

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const { property_id, graph_id, dirty_cells, dry_run, target_cells } = body;
  if (!property_id) return jsonResponse(400, { error: "property_id required" });
  if (!graph_id) return jsonResponse(400, { error: "graph_id required" });
  if (!Array.isArray(dirty_cells) || !dirty_cells.length) {
    return jsonResponse(400, {
      error: "dirty_cells must be a non-empty array",
    });
  }
  for (const dc of dirty_cells) {
    if (!dc || typeof dc.sheet !== "string" || typeof dc.cell !== "string") {
      return jsonResponse(400, {
        error: "each dirty_cell needs {sheet, cell, value}",
      });
    }
  }
  if (dirty_cells.length > 200) {
    return jsonResponse(413, {
      error: "too many dirty_cells (max 200 per request)",
    });
  }
  const isDryRun = dry_run === true || dry_run === "true" || dry_run === 1;

  const userJwt = (
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ""
  ).replace(/^Bearer\s+/i, "");
  if (!userJwt) return jsonResponse(401, { error: "missing bearer token" });
  const owner = await verifyOwnership(
    userJwt,
    gate.user?.id,
    property_id,
    graph_id,
  );
  if (!owner.ok) return jsonResponse(owner.code, { error: owner.error });

  const runningRes = await sr(
    `/property_underwriting_recompute_jobs?graph_id=eq.${graph_id}&status=eq.running&select=id&limit=1`,
  );
  if (
    runningRes.ok &&
    Array.isArray(runningRes.body) &&
    runningRes.body.length
  ) {
    return jsonResponse(409, {
      error: "a recompute job is already running on this graph",
      job_id: runningRes.body[0].id,
    });
  }

  const insertRes = await sr("/property_underwriting_recompute_jobs", {
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        org_id: owner.orgId,
        property_id,
        graph_id,
        triggered_by: owner.userId,
        status: "running",
        dirty_cells,
      },
    ],
  });
  if (!insertRes.ok || !Array.isArray(insertRes.body) || !insertRes.body[0]) {
    return jsonResponse(500, {
      error: "failed to create job row",
      detail: insertRes.raw?.slice(0, 200),
    });
  }
  const jobId = insertRes.body[0].id;

  try {
    await runRecompute({
      jobId,
      propertyId: property_id,
      graphId: graph_id,
      orgId: owner.orgId,
      userJwt,
      authUserId: owner.authUserId,
      userEmail: owner.userEmail,
      actorRole: owner.actorRole,
      dirtyCells: dirty_cells,
      isDryRun,
      targetCells: Array.isArray(target_cells) ? target_cells : null,
    });
  } catch (e) {
    console.error(
      "[recompute-bg] job",
      jobId,
      "failed:",
      e?.message,
      e?.stack?.slice(0, 500),
    );
    await updateJob(jobId, {
      status: "error",
      error_message: (e?.message || String(e)).slice(0, 1000),
      completed_at: new Date().toISOString(),
    });
  }

  return jsonResponse(202, { job_id: jobId, status: "started" });
};

async function runRecompute({
  jobId,
  propertyId,
  graphId,
  orgId,
  userJwt,
  authUserId,
  userEmail,
  actorRole,
  dirtyCells,
  isDryRun,
  targetCells,
}) {
  let namedRanges = null;
  try {
    const nrRes = await sr(
      `/property_underwriting_model_graphs?id=eq.${graphId}&select=named_ranges&limit=1`,
    );
    if (nrRes.ok && nrRes.body?.[0])
      namedRanges = nrRes.body[0].named_ranges || null;
  } catch (e) {
    console.warn(
      "[recompute-bg] named_ranges fetch failed (treating as empty):",
      e?.message,
    );
  }

  const dataSource = makePostgrestDataSource(graphId);
  const dirtyForRecompute = dirtyCells.map((dc) => ({
    sheet: dc.sheet,
    cell: String(dc.cell).toUpperCase(),
  }));
  const newValues = new Map();
  for (const dc of dirtyCells) {
    newValues.set(`${dc.sheet}\x00${String(dc.cell).toUpperCase()}`, dc.value);
  }

  const result = await recompute(dirtyForRecompute, newValues, dataSource, {
    perCellTimeoutMs: 5000,
    namedRanges,
  });

  let persisted = { updated: 0, failed: 0 };
  let inputs = { updated: 0, failed: 0 };
  let canonical = { written: 0 };
  if (!isDryRun) {
    persisted = await persistDiff(graphId, result.diff);
    inputs = await persistDirtyInputs(graphId, dirtyCells);
    canonical = await writebackCanonicals(propertyId, graphId, [
      ...result.diff,
      ...dirtyCells.map((dc) => ({
        sheet: dc.sheet,
        cell: String(dc.cell).toUpperCase(),
        newValue: dc.value,
      })),
    ]);
    await auditLog({
      userJwt,
      orgId,
      authUserId,
      userEmail,
      actorRole,
      propertyId,
      graphId,
      dirtyCells,
      diff: result.diff,
    });
  }

  const wantedSet = targetCells
    ? new Set(
        targetCells.map((t) => `${t.sheet}!${String(t.cell).toUpperCase()}`),
      )
    : null;
  const head = result.diff.slice(0, 5000);
  const headKeys = new Set(head.map((d) => `${d.sheet}!${d.cell}`));
  const extra = wantedSet
    ? result.diff.filter(
        (d) =>
          wantedSet.has(`${d.sheet}!${d.cell}`) &&
          !headKeys.has(`${d.sheet}!${d.cell}`),
      )
    : [];
  const diffOut = [...head, ...extra].map((d) => ({
    sheet: d.sheet,
    cell: d.cell,
    formula: d.formula?.slice(0, 200),
    old_value: d.oldValue,
    new_value: d.newValue,
  }));

  const summary = {
    ok: true,
    dry_run: isDryRun,
    summary: {
      dirty_cells: dirtyCells.length,
      evaluated: result.evaluated,
      diff_count: result.diff.length,
      skipped: result.skipped,
      errors: result.errors,
      preserved_null_clobbers: result.preservedNullClobbers || 0,
      skipped_non_closure: result.skippedNonClosure || 0,
      persisted_cells: persisted.updated,
      persisted_failed: persisted.failed,
      input_cells_persisted: inputs.updated,
      input_cells_failed: inputs.failed,
      canonicals_updated: canonical.written,
      skip_reasons: result.skipReasonsDist || {},
      error_reasons: result.errorReasonsDist || {},
    },
    skipped_cells: (result.skippedCells || []).map((c) => ({
      sheet: c.sheet,
      cell: c.cell,
      reason: c.reason,
    })),
    errored_cells: (result.erroredCells || []).map((c) => ({
      sheet: c.sheet,
      cell: c.cell,
      reason: c.reason,
    })),
    diff: diffOut,
  };

  await updateJob(jobId, {
    status: "complete",
    result_summary: summary,
    completed_at: new Date().toISOString(),
  });
}
