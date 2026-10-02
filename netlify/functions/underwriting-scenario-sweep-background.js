import { applySecurity, jsonResponse } from "./_security.js";
import { recompute } from "./lib/formula-recompute.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const SOFT_DEADLINE_MS = 13 * 60 * 1000;

const STALE_HEARTBEAT_MS = 60 * 1000;

const ZOMBIE_THRESHOLD_MIN = 20;

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
    `${SUPABASE_URL}/rest/v1/user_profiles?auth_id=eq.${encodeURIComponent(authUserId)}&select=id,org_id&limit=1`,
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
  return { ok: true, orgId: callerOrgId, userId: callerUserId };
}

async function fetchSweepRow(sweepId) {
  const r = await sr(
    `/property_underwriting_scenario_sweeps?id=eq.${sweepId}&limit=1`,
  );
  if (!r.ok) throw new Error(`sweep row fetch HTTP ${r.status}`);
  if (!Array.isArray(r.body) || !r.body.length)
    throw new Error("sweep row not found");
  return r.body[0];
}

async function findRunningSweepOnGraph(graphId) {
  const r = await sr(
    `/property_underwriting_scenario_sweeps?graph_id=eq.${graphId}&status=eq.running&order=started_at.desc&limit=1`,
  );
  if (!r.ok || !Array.isArray(r.body) || !r.body.length) return null;
  return r.body[0];
}

async function updateSweepRow(sweepId, patch) {
  await sr(`/property_underwriting_scenario_sweeps?id=eq.${sweepId}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { ...patch, last_updated_at: new Date().toISOString() },
  });
}

async function acquireSweepLock(sweepId) {
  const nowIso = new Date().toISOString();
  const staleCutoffIso = new Date(
    Date.now() - STALE_HEARTBEAT_MS,
  ).toISOString();
  const path =
    `/property_underwriting_scenario_sweeps` +
    `?id=eq.${sweepId}` +
    `&status=eq.running` +
    `&or=(last_updated_at.is.null,last_updated_at.lt.${encodeURIComponent(staleCutoffIso)})`;
  const r = await sr(path, {
    method: "PATCH",
    prefer: "return=representation",
    body: { last_updated_at: nowIso },
  });
  if (!r.ok)
    throw new Error(`lock acquire HTTP ${r.status}: ${r.raw?.slice(0, 200)}`);
  return Array.isArray(r.body) && r.body.length > 0;
}

export const handler = async (event) => {
  const sec = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
  });
  if (sec.error) return sec.error;

  const body = sec.body || {};

  const authUserId = sec.user?.id;
  const userJwt = (
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ""
  ).replace(/^Bearer\s+/i, "");

  if (body.sweep_id) {
    return await resumeSweep(String(body.sweep_id), userJwt, authUserId);
  }

  const { property_id, graph_id } = body;
  const variation_pct = Number(body.variation_pct ?? 0.05);
  if (!property_id) return jsonResponse(400, { error: "property_id required" });
  if (!graph_id) return jsonResponse(400, { error: "graph_id required" });
  if (!Number.isFinite(variation_pct) || Math.abs(variation_pct) > 1) {
    return jsonResponse(400, {
      error: "variation_pct must be a finite number with |v| ≤ 1",
    });
  }

  const owner = await verifyOwnership(
    userJwt,
    authUserId,
    property_id,
    graph_id,
  );
  if (!owner.ok) return jsonResponse(owner.code, { error: owner.error });

  const existing = await findRunningSweepOnGraph(graph_id);
  if (existing) {
    const lastMs = existing.last_updated_at
      ? new Date(existing.last_updated_at).getTime()
      : 0;
    const ageMs = lastMs ? Date.now() - lastMs : Infinity;
    if (ageMs < STALE_HEARTBEAT_MS) {
      return jsonResponse(409, {
        error: "sweep already running on this graph",
        sweep_id: existing.id,
      });
    }
    return await resumeSweepWithRow(existing, owner);
  }

  const nowIso = new Date().toISOString();
  const insertRes = await sr(`/property_underwriting_scenario_sweeps`, {
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        org_id: owner.orgId,
        property_id,
        graph_id,
        status: "running",
        variation_pct,
        triggered_by: owner.userId,
        last_updated_at: nowIso,
      },
    ],
  });
  if (!insertRes.ok || !Array.isArray(insertRes.body) || !insertRes.body[0]) {
    return jsonResponse(500, {
      error: "failed to create sweep row",
      detail: insertRes.raw?.slice(0, 200),
    });
  }
  const sweepId = insertRes.body[0].id;

  await runSweepGuarded(sweepId);
  return jsonResponse(202, { sweep_id: sweepId, status: "started" });
};

async function resumeSweep(sweepId, userJwt, authUserId) {
  let row;
  try {
    row = await fetchSweepRow(sweepId);
  } catch (e) {
    return jsonResponse(404, { error: e.message });
  }

  const owner = await verifyOwnership(
    userJwt,
    authUserId,
    row.property_id,
    row.graph_id,
  );
  if (!owner.ok) return jsonResponse(owner.code, { error: owner.error });

  if (row.status === "complete" || row.status === "error") {
    return jsonResponse(409, {
      error: `sweep already ${row.status}`,
      sweep_id: sweepId,
    });
  }

  return await resumeSweepWithRow(row, owner);
}

async function resumeSweepWithRow(row, _owner) {
  const got = await acquireSweepLock(row.id);
  if (!got) {
    return jsonResponse(409, {
      error: "sweep already in flight",
      sweep_id: row.id,
    });
  }
  await runSweepGuarded(row.id);
  return jsonResponse(202, { sweep_id: row.id, status: "resumed" });
}

async function runSweepGuarded(sweepId) {
  try {
    await runSweep(sweepId);
  } catch (e) {
    console.error(
      "[scenario-sweep] failed:",
      e?.message,
      e?.stack?.slice(0, 500),
    );
    try {
      await updateSweepRow(sweepId, {
        status: "error",
        error_message: (e?.message || String(e)).slice(0, 500),
        completed_at: new Date().toISOString(),
      });
    } catch (eUpd) {
      console.error("[scenario-sweep] error-write also failed:", eUpd?.message);
    }
  }
}

async function runSweep(sweepId) {
  const startTime = Date.now();

  const row = await fetchSweepRow(sweepId);
  const graphId = row.graph_id;
  const variationPct = Number(row.variation_pct ?? 0.05);
  const startIdx = Number(row.inputs_done || 0);

  const allResults = Array.isArray(row.results) ? row.results.slice() : [];
  const inputSummaries = Array.isArray(row.per_input_summary)
    ? row.per_input_summary.slice()
    : [];

  let namedRanges = null;
  try {
    const r = await sr(
      `/property_underwriting_model_graphs?id=eq.${graphId}&select=named_ranges&limit=1`,
    );
    if (r.ok && r.body?.[0]) namedRanges = r.body[0].named_ranges || null;
  } catch {}

  const inputsRes = await sr(
    `/property_underwriting_model_nodes` +
      `?graph_id=eq.${graphId}` +
      `&canonical_role=eq.input` +
      `&formula=is.null` +
      `&value_num=not.is.null` +
      `&select=sheet,cell,canonical_key,value_num` +
      `&order=canonical_key.asc` +
      `&limit=500`,
  );
  if (!inputsRes.ok || !Array.isArray(inputsRes.body)) {
    throw new Error(
      `inputs fetch HTTP ${inputsRes.status}: ${inputsRes.raw?.slice(0, 200)}`,
    );
  }
  const inputs = inputsRes.body;

  const outputsRes = await sr(
    `/property_underwriting_model_nodes` +
      `?graph_id=eq.${graphId}` +
      `&canonical_key=not.is.null` +
      `&select=sheet,cell,canonical_key,value_num,value_text,canonical_role` +
      `&limit=2000`,
  );
  if (!outputsRes.ok || !Array.isArray(outputsRes.body)) {
    throw new Error(`outputs fetch HTTP ${outputsRes.status}`);
  }
  const outputs = outputsRes.body;

  if (Number(row.total_inputs || 0) !== inputs.length) {
    await updateSweepRow(sweepId, { total_inputs: inputs.length });
  }

  if (startIdx >= inputs.length) {
    await updateSweepRow(sweepId, {
      status: "complete",
      inputs_done: inputs.length,
      results: allResults,
      per_input_summary: inputSummaries,
      completed_at: new Date().toISOString(),
    });
    return;
  }

  const dataSource = makePostgrestDataSource(graphId);

  for (let i = startIdx; i < inputs.length; i++) {
    const inp = inputs[i];
    const oldVal = Number(inp.value_num);
    const newVal = oldVal === 0 ? oldVal + 1 : oldVal * (1 + variationPct);
    if (!Number.isFinite(newVal) || newVal === oldVal) {
      inputSummaries.push({
        input_key: inp.canonical_key,
        input_sheet: inp.sheet,
        input_cell: inp.cell,
        outputs_changed: 0,
        outputs_dead: outputs.length,
        evaluator_errors: 0,
        evaluator_skips: 0,
        recompute_ms: 0,
        skipped_degenerate: true,
      });
      await updateSweepRow(sweepId, {
        inputs_done: i + 1,
        per_input_summary: inputSummaries,
        results: allResults,
      });
      if (Date.now() - startTime > SOFT_DEADLINE_MS) return;
      continue;
    }

    const dirty = [{ sheet: inp.sheet, cell: inp.cell }];
    const newValues = new Map([
      [`${inp.sheet}\x00${String(inp.cell).toUpperCase()}`, newVal],
    ]);

    const t0 = Date.now();
    let result;
    try {
      result = await recompute(dirty, newValues, dataSource, {
        perCellTimeoutMs: 5000,
        namedRanges,
      });
    } catch (e) {
      console.warn("[sweep] recompute threw on", inp.canonical_key, e?.message);
      inputSummaries.push({
        input_key: inp.canonical_key,
        input_sheet: inp.sheet,
        input_cell: inp.cell,
        outputs_changed: 0,
        outputs_dead: outputs.length,
        evaluator_errors: 0,
        evaluator_skips: 0,
        recompute_ms: Date.now() - t0,
        recompute_threw: e?.message?.slice(0, 200) || true,
      });
      await updateSweepRow(sweepId, {
        inputs_done: i + 1,
        per_input_summary: inputSummaries,
        results: allResults,
      });
      if (Date.now() - startTime > SOFT_DEADLINE_MS) return;
      continue;
    }
    const elapsedMs = Date.now() - t0;

    const valueMap = result.valueMap;
    let outputsChanged = 0;
    let outputsInScope = 0;
    for (const out of outputs) {
      const key = `${out.sheet}\x00${String(out.cell).toUpperCase()}`;
      if (!valueMap.has(key)) continue;
      outputsInScope += 1;
      const newOutVal = valueMap.get(key);
      const oldOutVal = out.value_num ?? out.value_text ?? null;

      const isNum =
        typeof newOutVal === "number" &&
        Number.isFinite(newOutVal) &&
        typeof oldOutVal === "number" &&
        Number.isFinite(oldOutVal);
      const absChange = isNum ? newOutVal - oldOutVal : null;
      const relChange = isNum && oldOutVal !== 0 ? absChange / oldOutVal : null;

      const meaningful = isNum
        ? Math.abs(absChange) > 1e-9 &&
          (oldOutVal === 0 || Math.abs(relChange) > 1e-9)
        : oldOutVal !== newOutVal &&
          newOutVal !== null &&
          newOutVal !== undefined;
      if (!meaningful) continue;

      outputsChanged++;
      allResults.push({
        input_key: inp.canonical_key,
        input_sheet: inp.sheet,
        input_cell: inp.cell,
        input_old: oldVal,
        input_new: newVal,
        output_key: out.canonical_key,
        output_sheet: out.sheet,
        output_cell: out.cell,
        output_role: out.canonical_role,
        output_old: oldOutVal,
        output_new: newOutVal,
        abs_change: absChange,
        rel_change: relChange,
      });
    }

    inputSummaries.push({
      input_key: inp.canonical_key,
      input_sheet: inp.sheet,
      input_cell: inp.cell,
      input_old: oldVal,
      input_new: newVal,
      outputs_total: outputs.length,
      outputs_in_scope: outputsInScope,
      outputs_changed: outputsChanged,
      outputs_dead: outputsInScope - outputsChanged,
      outputs_unreachable: outputs.length - outputsInScope,
      evaluator_errors: result.errors || 0,
      evaluator_skips: result.skipped || 0,
      preserved_null_clobbers: result.preservedNullClobbers || 0,
      recompute_ms: elapsedMs,
    });

    await updateSweepRow(sweepId, {
      inputs_done: i + 1,
      per_input_summary: inputSummaries,
      results: allResults,
    });

    if (Date.now() - startTime > SOFT_DEADLINE_MS) return;
  }

  await updateSweepRow(sweepId, {
    status: "complete",
    inputs_done: inputs.length,
    results: allResults,
    per_input_summary: inputSummaries,
    completed_at: new Date().toISOString(),
  });
}
