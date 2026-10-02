import { supabase, getRealPropertyFilterContext } from "./supabaseClient.js";

let _scopeItemsPromise = null;

export function resetUnifiedViewScopeCache() {
  _scopeItemsPromise = null;
}

async function loadScopeItemsOnce() {
  const [codeMapRes, propsRes] = await Promise.all([
    supabase
      .from("budget_property_code_map")
      .select("property_id, property_code"),
    supabase
      .from("properties")
      .select("id, name, entrata_property_id, property_type"),
  ]);

  if (codeMapRes.error) throw codeMapRes.error;

  const degraded = Boolean(propsRes.error);
  if (propsRes.error) {
    console.error(
      "buildScopeItems properties lookup error (degraded — codes only):",
      propsRes.error,
    );
  }

  const propById = new Map();
  for (const p of degraded ? [] : propsRes.data || []) {
    if (p && p.id != null) propById.set(p.id, p);
  }

  const items = [];
  const seenCodes = new Set();
  for (const m of codeMapRes.data || []) {
    const code = (
      m?.property_code == null ? "" : String(m.property_code)
    ).trim();
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    const p =
      m.property_id != null ? propById.get(m.property_id) || null : null;
    const entrataId =
      p?.entrata_property_id == null
        ? null
        : String(p.entrata_property_id).trim() || null;
    items.push({
      code,
      name: (p?.name || "").trim() || code,
      entrataId,
      tag: p?.property_type || null,
    });
  }

  let context = null;
  try {
    context = await getRealPropertyFilterContext();
  } catch (err) {
    console.error(
      "buildScopeItems RP-filter context unavailable — failing open:",
      err,
    );
    context = null;
  }
  let out = items;
  if (
    context &&
    context.enabled &&
    context.aopIds instanceof Set &&
    context.aopIds.size > 0
  ) {
    out = items.filter(
      (it) => it.entrataId == null || !context.aopIds.has(it.entrataId),
    );
  }

  out.sort((a, b) => a.name.localeCompare(b.name));

  const classified = Boolean(
    context && context.enabled && context.aopIds instanceof Set,
  );
  let coverage = null;
  if (!degraded) {
    const mappedPropertyIds = new Set();
    for (const m of codeMapRes.data || []) {
      if (m && m.property_id != null) mappedPropertyIds.add(m.property_id);
    }
    const unregistered = [];
    let aopExcludedCount = items.length - out.length;
    for (const p of propsRes.data || []) {
      if (!p || p.id == null || mappedPropertyIds.has(p.id)) continue;
      const entrataId =
        p.entrata_property_id == null
          ? null
          : String(p.entrata_property_id).trim() || null;
      if (classified && entrataId != null && context.aopIds.has(entrataId)) {
        aopExcludedCount += 1;
        continue;
      }
      unregistered.push({
        name: (p.name || "").trim() || String(p.id),
        entrataId,
      });
    }
    unregistered.sort((a, b) => a.name.localeCompare(b.name));
    coverage = {
      verified: classified,
      inScopeCount: out.length,
      unregistered,
      aopExcludedCount,
    };
  }

  return { items: out, coverage, cacheable: !degraded };
}

function loadScope({ refresh = false } = {}) {
  if (!_scopeItemsPromise || refresh) {
    let self = null;
    self = loadScopeItemsOnce().then(
      ({ items, coverage, cacheable }) => {
        if (!cacheable && _scopeItemsPromise === self)
          _scopeItemsPromise = null;
        return { items, coverage };
      },
      (err) => {
        console.error("buildScopeItems error:", err);
        if (_scopeItemsPromise === self) _scopeItemsPromise = null;
        return { items: [], coverage: null };
      },
    );
    _scopeItemsPromise = self;
  }
  return _scopeItemsPromise;
}

export async function buildScopeItems(opts) {
  return (await loadScope(opts)).items;
}

export async function buildScopeCoverage(opts) {
  return (await loadScope(opts)).coverage;
}

const VARIANCE_SET_CHUNK_SIZE = 10;

function isStatementTimeout(error) {
  if (!error) return false;
  return (
    String(error.code || "").includes("57014") ||
    /statement timeout|canceling statement/i.test(error.message || "")
  );
}

async function rpcVarianceChunk(chunkCodes) {
  let res = await supabase.rpc("get_budget_variance_set", {
    p_property_codes: chunkCodes,
  });
  if (res && res.error && isStatementTimeout(res.error)) {
    await new Promise((r) => setTimeout(r, 500));
    res = await supabase.rpc("get_budget_variance_set", {
      p_property_codes: chunkCodes,
    });
  }
  return (
    res || {
      data: null,
      error: new Error("get_budget_variance_set: empty response"),
    }
  );
}

function extractVarianceMeta(rows, into = {}) {
  for (const row of rows) {
    const code = (
      row?.property_code == null ? "" : String(row.property_code)
    ).trim();
    if (code && !(code in into)) {
      into[code] = {
        actualsThrough: row.actuals_through ?? null,
        actualsThroughKnown: row.actuals_through_known === true,
        dataRefreshedAt: row.data_refreshed_at ?? null,
      };
    }
  }
  return into;
}

export async function fetchBudgetVarianceSet(codes, { onChunk } = {}) {
  const unique = [
    ...new Set(
      (Array.isArray(codes) ? codes : [])
        .map((c) => (c == null ? "" : String(c)).trim())
        .filter(Boolean),
    ),
  ];
  if (unique.length === 0)
    return { data: [], metaByProperty: {}, error: null, partial: false };

  const chunks = [];
  for (let i = 0; i < unique.length; i += VARIANCE_SET_CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + VARIANCE_SET_CHUNK_SIZE));
  }
  const totalChunks = chunks.length;
  let completedChunks = 0;

  const results = await Promise.all(
    chunks.map((chunk) =>
      rpcVarianceChunk(chunk)
        .catch((err) => ({ data: null, error: err }))
        .then((res) => {
          completedChunks += 1;
          if (typeof onChunk === "function") {
            const rows = Array.isArray(res.data) && !res.error ? res.data : [];
            try {
              onChunk({
                rows,
                metaByProperty: extractVarianceMeta(rows),
                chunkCodes: chunk,
                error: res.error || null,
                completedChunks,
                totalChunks,
              });
            } catch (cbErr) {
              console.error(
                "fetchBudgetVarianceSet onChunk callback error:",
                cbErr,
              );
            }
          }
          return res;
        }),
    ),
  );

  const data = [];
  const metaByProperty = {};
  let error = null;
  for (const res of results) {
    if (res.error) {
      if (!error) error = res.error;
      console.error("fetchBudgetVarianceSet chunk error:", res.error);
      continue;
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    data.push(...rows);
    extractVarianceMeta(rows, metaByProperty);
  }

  return {
    data,
    metaByProperty,
    error,
    partial: error != null && data.length > 0,
  };
}

export function filterRowsToSet(rows, selectedProperties, getPropertyId) {
  const list = Array.isArray(rows) ? rows : [];
  const accessor =
    typeof getPropertyId === "function"
      ? getPropertyId
      : (r) => r && r.property_id;
  const idSet = new Set();
  for (const p of Array.isArray(selectedProperties) ? selectedProperties : []) {
    if (!p || p.entrataId == null) continue;
    const id = String(p.entrataId).trim();
    if (id) idSet.add(id);
  }
  if (idSet.size === 0) return [];
  const out = [];
  for (const row of list) {
    const raw = accessor(row);
    if (raw == null) continue;
    const id = String(raw).trim();
    if (id && idSet.has(id)) out.push(row);
  }
  return out;
}
