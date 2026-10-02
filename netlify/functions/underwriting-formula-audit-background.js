import { createHmac, timingSafeEqual } from "node:crypto";

import { applySecurity, jsonResponse } from "./_security.js";
import {
  evaluateFormula,
  _internal as _evalInternal,
} from "./lib/excel-formula-evaluator.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const CHUNK_SIZE = 400;
const FINDINGS_BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const PER_CELL_TIMEOUT_MS = 5_000;
const NUMERIC_TOL_REL = 0.01;
const NUMERIC_TOL_ABS = 1.0;

async function sr(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw: text };
}

const INTERNAL_SIG_HEADER = "x-audit-sig";
const INTERNAL_TS_HEADER = "x-audit-ts";
const INTERNAL_MAX_SKEW_SEC = 60;

function internalSigningKey() {
  if (!SERVICE_ROLE_KEY) return null;
  return createHmac("sha256", SERVICE_ROLE_KEY)
    .update("audit-self-trigger-v1")
    .digest();
}

function signInternal(ts, rawBody) {
  const key = internalSigningKey();
  if (!key) return null;
  const t = String(ts);
  return createHmac("sha256", key)
    .update(`${t.length}.${t}.${rawBody}`)
    .digest("hex");
}

function headerValue(event, name) {
  const h = event.headers || {};
  if (h[name] !== undefined) return h[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return undefined;
}

function verifyInternalSignature(event, rawBody) {
  try {
    const ts = headerValue(event, INTERNAL_TS_HEADER);
    const sig = headerValue(event, INTERNAL_SIG_HEADER);
    if (!ts || !sig) return false;

    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > INTERNAL_MAX_SKEW_SEC)
      return false;

    const expected = signInternal(String(ts), rawBody);
    if (!expected) return false;

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(sig), "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function resolveSelfUrl(event) {
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const host = event.headers?.host || event.headers?.Host;
  if (!host) throw new Error("cannot resolve self URL — no host header");
  return `${proto}://${host}/.netlify/functions/underwriting-formula-audit-background`;
}

async function triggerSelf(event, body) {
  const url = resolveSelfUrl(event);
  const upstreamAuth =
    event.headers?.authorization || event.headers?.Authorization || "";
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://credashboardproperty.netlify.app",
  };
  if (upstreamAuth) headers.Authorization = upstreamAuth;

  const payload = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = signInternal(ts, payload);
  if (sig) {
    headers[INTERNAL_TS_HEADER] = ts;
    headers[INTERNAL_SIG_HEADER] = sig;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: payload,
    });
    if (!res.ok && res.status !== 202) {
      let respBody = "";
      try {
        respBody = (await res.text())?.slice(0, 400);
      } catch {}
      console.warn(
        "[audit] self-trigger non-2xx:",
        res.status,
        body.mode,
        "— url:",
        url,
        "— body:",
        respBody,
      );
    }
  } catch (e) {
    console.warn("[audit] self-trigger threw:", e?.message);
  }
}

async function fetchAllFormulaKeys(graphId) {
  const keys = [];
  let offset = 0;
  while (true) {
    const r = await sr(
      `/property_underwriting_model_nodes?graph_id=eq.${graphId}` +
        `&formula=not.is.null&select=sheet,cell&limit=${PAGE_SIZE}&offset=${offset}`,
    );
    if (!r.ok)
      throw new Error(
        `fetchAllFormulaKeys at offset ${offset}: HTTP ${r.status} ${r.raw?.slice(0, 200)}`,
      );
    if (!Array.isArray(r.data) || r.data.length === 0) break;
    for (const n of r.data) {
      if (n.sheet && n.cell)
        keys.push(`${n.sheet}\x00${String(n.cell).toUpperCase()}`);
    }
    if (r.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return keys;
}

async function fetchAllEdges(graphId) {
  const edges = [];
  let offset = 0;
  while (true) {
    const r = await sr(
      `/property_underwriting_model_edges?graph_id=eq.${graphId}` +
        `&select=from_sheet,from_cell,to_sheet,to_cell&limit=${PAGE_SIZE}&offset=${offset}`,
    );
    if (!r.ok)
      throw new Error(
        `fetchAllEdges at offset ${offset}: HTTP ${r.status} ${r.raw?.slice(0, 200)}`,
      );
    if (!Array.isArray(r.data) || r.data.length === 0) break;
    edges.push(...r.data);
    if (r.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return edges;
}

const KEYS_PER_IN_BATCH = 200;

async function fetchNodesForKeys(graphId, cellKeys, withFormula) {
  if (!cellKeys.length) return [];
  const bySheet = new Map();
  for (const k of cellKeys) {
    const idx = k.indexOf("\x00");
    if (idx < 0) continue;
    const sheet = k.slice(0, idx);
    const cell = k.slice(idx + 1);
    if (!bySheet.has(sheet)) bySheet.set(sheet, []);
    bySheet.get(sheet).push(cell);
  }
  const out = [];
  for (const [sheet, cells] of bySheet) {
    for (let i = 0; i < cells.length; i += KEYS_PER_IN_BATCH) {
      const batch = cells.slice(i, i + KEYS_PER_IN_BATCH);
      const inList = batch.map((c) => `"${c}"`).join(",");
      const select = withFormula
        ? "sheet,cell,formula,value_num,value_text,value_date"
        : "sheet,cell,value_num,value_text,value_date";
      const r = await sr(
        `/property_underwriting_model_nodes?graph_id=eq.${graphId}` +
          `&sheet=eq.${encodeURIComponent(sheet)}` +
          `&cell=in.(${encodeURIComponent(inList)})` +
          `&select=${select}`,
      );
      if (!r.ok)
        throw new Error(
          `fetchNodesForKeys batch sheet=${sheet}: HTTP ${r.status} ${r.raw?.slice(0, 200)}`,
        );
      if (Array.isArray(r.data)) out.push(...r.data);
    }
  }
  return out;
}

function clampNumeric10_6(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v) >= 9999 ? null : v;
}

async function batchInsertFindings(runId, graphId, findings) {
  if (!findings.length) return { inserted: 0 };
  let inserted = 0;
  for (let i = 0; i < findings.length; i += FINDINGS_BATCH_SIZE) {
    const chunk = findings.slice(i, i + FINDINGS_BATCH_SIZE).map((f) => ({
      run_id: runId,
      graph_id: graphId,
      sheet: f.sheet,
      cell: f.cell,
      formula: (f.formula || "").slice(0, 4000),
      status: f.status,
      model_value: { value: f.modelValue ?? null },
      platform_value:
        f.platformValue &&
        typeof f.platformValue === "object" &&
        f.platformValue.error
          ? { error: f.platformValue.error }
          : { value: f.platformValue ?? null },
      absolute_drift: clampNumeric10_6(f.absoluteDrift),
      relative_drift: clampNumeric10_6(f.relativeDrift),
      reason: f.reason ?? null,
    }));
    const r = await sr("/property_underwriting_formula_audit_findings", {
      method: "POST",
      prefer: "return=minimal",
      body: chunk,
    });
    if (!r.ok)
      throw new Error(
        `batchInsertFindings at offset ${i}: HTTP ${r.status} ${r.raw?.slice(0, 200)}`,
      );
    inserted += chunk.length;
  }
  return { inserted };
}

async function handlePlan(event, body) {
  const { run_id: runId, graph_id: graphId } = body;
  if (!runId || !graphId)
    return jsonResponse(400, { error: "plan: run_id and graph_id required" });

  console.log("[audit:plan] run", runId, "graph", graphId);
  const startTime = Date.now();

  try {
    console.log("[audit:plan] reading formula cell keys…");
    const formulaKeys = await fetchAllFormulaKeys(graphId);
    console.log("[audit:plan]", formulaKeys.length, "formula cells");

    console.log("[audit:plan] reading edges…");
    const edges = await fetchAllEdges(graphId);
    console.log("[audit:plan]", edges.length, "edges");

    const refsByFromKey = new Map();
    for (const e of edges) {
      const fk = `${e.from_sheet}\x00${String(e.from_cell || "").toUpperCase()}`;
      const tk = `${e.to_sheet}\x00${String(e.to_cell || "").toUpperCase()}`;
      if (!e.from_sheet || !e.from_cell || !e.to_sheet || !e.to_cell) continue;
      if (!refsByFromKey.has(fk)) refsByFromKey.set(fk, new Set());
      refsByFromKey.get(fk).add(tk);
    }
    edges.length = 0;

    const totalChunks = Math.ceil(formulaKeys.length / CHUNK_SIZE);
    console.log(
      "[audit:plan]",
      totalChunks,
      "chunks of up to",
      CHUNK_SIZE,
      "cells each",
    );

    const chunkRows = [];
    for (let i = 0; i < totalChunks; i++) {
      const slice = formulaKeys.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const sliceSet = new Set(slice);
      const refSet = new Set();
      for (const fk of slice) {
        const refs = refsByFromKey.get(fk);
        if (refs) for (const r of refs) if (!sliceSet.has(r)) refSet.add(r);
      }
      const toDb = (k) => {
        const idx = k.indexOf("\x00");
        return idx < 0
          ? { s: k, c: "" }
          : { s: k.slice(0, idx), c: k.slice(idx + 1) };
      };
      chunkRows.push({
        run_id: runId,
        graph_id: graphId,
        chunk_index: i,
        total_chunks: totalChunks,
        status: "pending",
        formula_keys: slice.map(toDb),
        ref_keys: Array.from(refSet).map(toDb),
      });
    }

    console.log("[audit:plan] persisting", chunkRows.length, "chunk rows…");
    for (let i = 0; i < chunkRows.length; i += 10) {
      const batch = chunkRows.slice(i, i + 10);
      const r = await sr("/property_underwriting_formula_audit_chunks", {
        method: "POST",
        prefer: "return=minimal",
        body: batch,
      });
      if (!r.ok)
        throw new Error(
          `plan: chunk insert at ${i}: HTTP ${r.status} ${r.raw?.slice(0, 200)}`,
        );
    }

    await sr(`/property_underwriting_formula_audit_runs?id=eq.${runId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        total_formulas: formulaKeys.length,
        total_chunks: totalChunks,
        architecture: "chunked",
      },
    });

    console.log(
      "[audit:plan] done in",
      Date.now() - startTime,
      "ms — triggering execute(0)",
    );

    await triggerSelf(event, {
      mode: "execute",
      run_id: runId,
      chunk_index: 0,
    });

    return jsonResponse(202, {
      ok: true,
      mode: "plan",
      total_chunks: totalChunks,
    });
  } catch (e) {
    console.error("[audit:plan] ERROR:", e?.message, e?.stack);
    await sr(`/property_underwriting_formula_audit_runs?id=eq.${runId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "error",
        completed_at: new Date().toISOString(),
        error_message: `plan: ${e?.message?.slice(0, 1000) || String(e)}`,
      },
    });
    return jsonResponse(500, { error: "plan failed", detail: e?.message });
  }
}

async function handleExecute(event, body) {
  const { run_id: runId, chunk_index: chunkIndex } = body;
  if (!runId || typeof chunkIndex !== "number") {
    return jsonResponse(400, {
      error: "execute: run_id and chunk_index required",
    });
  }

  console.log("[audit:execute] run", runId, "chunk", chunkIndex);
  const startTime = Date.now();

  try {
    const chunkRes = await sr(
      `/property_underwriting_formula_audit_chunks?run_id=eq.${runId}&chunk_index=eq.${chunkIndex}` +
        `&select=id,graph_id,formula_keys,ref_keys,total_chunks,status&limit=1`,
    );
    if (
      !chunkRes.ok ||
      !Array.isArray(chunkRes.data) ||
      !chunkRes.data.length
    ) {
      throw new Error(`chunk row not found: run=${runId} index=${chunkIndex}`);
    }
    const chunk = chunkRes.data[0];
    const chunkId = chunk.id;
    const graphId = chunk.graph_id;
    if (chunk.status === "running") {
      console.warn(
        "[audit:execute] chunk",
        chunkIndex,
        "already running — likely Netlify retry of OOM. Marking error and skipping.",
      );
      await sr(`/property_underwriting_formula_audit_chunks?id=eq.${chunkId}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          status: "error",
          completed_at: new Date().toISOString(),
          error_message:
            "OOM-retry-detected: previous attempt killed by Lambda memory cap",
        },
      });
      const r0 = await sr(
        `/property_underwriting_formula_audit_runs?id=eq.${runId}&select=chunks_complete`,
      );
      const prior0 = r0.data?.[0]?.chunks_complete ?? 0;
      await sr(`/property_underwriting_formula_audit_runs?id=eq.${runId}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { chunks_complete: prior0 + 1 },
      });
      const next0 = chunkIndex + 1;
      if (next0 < (chunk.total_chunks || 0)) {
        await triggerSelf(event, {
          mode: "execute",
          run_id: runId,
          chunk_index: next0,
        });
      } else {
        await triggerSelf(event, { mode: "finalize", run_id: runId });
      }
      return jsonResponse(202, {
        ok: true,
        mode: "execute",
        chunk: chunkIndex,
        skipped: "oom-retry",
      });
    }
    const fromDb = (kv) => {
      if (typeof kv === "string") return kv;
      return `${kv?.s ?? ""}\x00${String(kv?.c ?? "").toUpperCase()}`;
    };
    const formulaKeys = (chunk.formula_keys || []).map(fromDb);
    const refKeys = (chunk.ref_keys || []).map(fromDb);
    const totalChunks = chunk.total_chunks;

    await sr(`/property_underwriting_formula_audit_chunks?id=eq.${chunkId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "running", started_at: new Date().toISOString() },
    });

    console.log(
      "[audit:execute] chunk",
      chunkIndex,
      "/",
      totalChunks - 1,
      "—",
      formulaKeys.length,
      "formula cells,",
      refKeys.length,
      "ref cells",
    );

    const [formulaNodes, refNodes, graphMeta] = await Promise.all([
      fetchNodesForKeys(graphId, formulaKeys, true),
      fetchNodesForKeys(graphId, refKeys, false),
      sr(
        `/property_underwriting_model_graphs?id=eq.${graphId}&select=named_ranges&limit=1`,
      ),
    ]);
    const namedRanges =
      (graphMeta.ok && graphMeta.data?.[0]?.named_ranges) || null;
    console.log(
      "[audit:execute] loaded",
      formulaNodes.length,
      "formula nodes,",
      refNodes.length,
      "ref nodes,",
      namedRanges
        ? `${Object.keys(namedRanges).length} named ranges`
        : "no named ranges",
    );

    const valueByKey = new Map();
    const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
    function isoDateToExcelSerial(iso) {
      if (typeof iso !== "string" || iso.length < 10) return null;
      const t = Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso);
      if (!Number.isFinite(t)) return null;
      return Math.round((t - EXCEL_EPOCH_MS) / 86_400_000);
    }
    const seedNode = (n) => {
      if (!n.sheet || !n.cell) return;
      const k = `${n.sheet}\x00${String(n.cell).toUpperCase()}`;
      let v = null;
      if (typeof n.value_num === "number" && Number.isFinite(n.value_num)) {
        v = n.value_num;
      } else if (n.value_date) {
        const serial = isoDateToExcelSerial(n.value_date);
        if (serial !== null) v = serial;
      } else if (n.value_text != null && n.value_text !== "") {
        v = String(n.value_text);
      }
      valueByKey.set(k, v);
    };
    for (const n of refNodes) seedNode(n);
    for (const n of formulaNodes) seedNode(n);

    try {
      const { parseFormula } = _evalInternal;
      const RANGE_EXPANSION_CAP = 5000;
      const colToNumLocal = (c) => {
        let n = 0;
        for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n;
      };
      const numToColLocal = (n) => {
        let s = "";
        while (n > 0) {
          const r = (n - 1) % 26;
          s = String.fromCharCode(65 + r) + s;
          n = Math.floor((n - 1) / 26);
        }
        return s;
      };
      const extraKeysSet = new Set();
      function collect(n, currentSheet) {
        if (!n) return;
        if (n.type === "RANGE") {
          const sheet = n.sheet || currentSheet;
          const sCol = colToNumLocal(n.start.col);
          const eCol = colToNumLocal(n.end.col);
          const cells = (n.end.row - n.start.row + 1) * (eCol - sCol + 1);
          if (cells > RANGE_EXPANSION_CAP) return;
          for (let r = n.start.row; r <= n.end.row; r++) {
            for (let c = sCol; c <= eCol; c++) {
              const key = `${sheet}\x00${numToColLocal(c)}${r}`;
              if (!valueByKey.has(key)) extraKeysSet.add(key);
            }
          }
          return;
        }
        if (n.type === "REF") {
          const sheet = n.sheet || currentSheet;
          const key = `${sheet}\x00${n.col}${n.row}`;
          if (!valueByKey.has(key)) extraKeysSet.add(key);
          return;
        }
        if (Array.isArray(n.args))
          for (const a of n.args) collect(a, currentSheet);
        if (n.left) collect(n.left, currentSheet);
        if (n.right) collect(n.right, currentSheet);
        if (n.expr) collect(n.expr, currentSheet);
      }
      for (const node of formulaNodes) {
        if (!node.formula) continue;
        try {
          const ast = parseFormula(node.formula, node.sheet);
          collect(ast, node.sheet);
        } catch {}
      }
      const extraKeys = Array.from(extraKeysSet);
      if (extraKeys.length) {
        console.log(
          "[audit:execute] range-expansion: fetching",
          extraKeys.length,
          "additional cells",
        );
        const extraNodes = await fetchNodesForKeys(graphId, extraKeys, false);
        for (const n of extraNodes) seedNode(n);
        console.log(
          "[audit:execute] range-expansion: seeded",
          extraNodes.length,
          "cells; valueByKey size now",
          valueByKey.size,
        );
      }
    } catch (e) {
      console.warn("[audit:execute] range-expansion failed:", e?.message);
    }

    let currentRefCount = 0;
    let currentNullCount = 0;
    function resolveCell(sheet, cell) {
      const k = `${sheet}\x00${String(cell).toUpperCase()}`;
      currentRefCount += 1;
      if (!valueByKey.has(k)) {
        currentNullCount += 1;
        return null;
      }
      const v = valueByKey.get(k);
      if (v == null) currentNullCount += 1;
      return v;
    }

    const RSS_DELTA_BOMB_BYTES = 80 * 1024 * 1024;
    const CHUNK_RSS_CEILING_BYTES = 700 * 1024 * 1024;
    let verified = 0,
      mismatched = 0,
      skipped = 0,
      errors = 0;
    let bombsSkipped = 0;
    const findings = [];
    let evalIdx = 0;
    const startMem = process.memoryUsage();
    console.log(
      "[audit:execute] eval loop start — heap",
      Math.round(startMem.heapUsed / 1e6),
      "MB rss",
      Math.round(startMem.rss / 1e6),
      "MB,",
      formulaNodes.length,
      "formulas",
    );
    for (const node of formulaNodes) {
      if (!node.formula) continue;
      const preMem = process.memoryUsage();
      if (preMem.rss > CHUNK_RSS_CEILING_BYTES) {
        console.warn(
          "[audit:execute] chunk RSS ceiling hit at idx",
          evalIdx,
          "/",
          formulaNodes.length,
          "rss",
          Math.round(preMem.rss / 1e6),
          "MB — stopping early",
        );
        break;
      }
      evalIdx += 1;
      currentRefCount = 0;
      currentNullCount = 0;
      const finding = evaluateOne(node, resolveCell, namedRanges);
      const postMem = process.memoryUsage();
      if (postMem.rss - preMem.rss > RSS_DELTA_BOMB_BYTES) {
        console.error(
          "[audit:execute] BOMB formula at idx",
          evalIdx,
          `${node.sheet}!${node.cell}`,
          "rss-delta",
          Math.round((postMem.rss - preMem.rss) / 1e6),
          "MB",
          "formula-len",
          node.formula.length,
          "formula",
          node.formula.slice(0, 500),
        );
        bombsSkipped += 1;
        findings.push({
          sheet: node.sheet,
          cell: node.cell,
          formula: node.formula,
          modelValue: null,
          platformValue: null,
          status: "skip",
          absoluteDrift: null,
          relativeDrift: null,
          reason: `formula_too_heavy:heap_delta=${Math.round((postHeap - preHeap) / 1e6)}MB`,
        });
        skipped += 1;
        if (typeof global !== "undefined" && typeof global.gc === "function")
          global.gc();
        continue;
      }
      if (evalIdx % 50 === 0) {
        console.log(
          "[audit:execute] @" + evalIdx,
          "heap",
          Math.round(postMem.heapUsed / 1e6),
          "MB",
          "rss",
          Math.round(postMem.rss / 1e6),
          "MB",
          "last",
          `${node.sheet}!${node.cell}`,
        );
      }
      if (finding.status === "mismatch" && currentNullCount > 0) {
        try {
          const ast = _evalInternal.parseFormula(node.formula, node.sheet);
          const wantedKeys = new Set();
          (function walk(n) {
            if (!n) return;
            if (n.type === "REF") {
              const sheet = n.sheet || node.sheet;
              const key = `${sheet}\x00${n.col}${n.row}`;
              if (!valueByKey.has(key) || valueByKey.get(key) == null)
                wantedKeys.add(key);
              return;
            }
            if (n.type === "RANGE") {
              const sheet = n.sheet || node.sheet;
              const sCol = (function colN(c) {
                let n = 0;
                for (const ch of c.toUpperCase())
                  n = n * 26 + (ch.charCodeAt(0) - 64);
                return n;
              })(n.start.col);
              const eCol = (function colN(c) {
                let n = 0;
                for (const ch of c.toUpperCase())
                  n = n * 26 + (ch.charCodeAt(0) - 64);
                return n;
              })(n.end.col);
              const tot = (n.end.row - n.start.row + 1) * (eCol - sCol + 1);
              if (tot > 5000) return;
              const numToCol = (n) => {
                let s = "";
                while (n > 0) {
                  const r = (n - 1) % 26;
                  s = String.fromCharCode(65 + r) + s;
                  n = Math.floor((n - 1) / 26);
                }
                return s;
              };
              for (let r = n.start.row; r <= n.end.row; r++) {
                for (let c = sCol; c <= eCol; c++) {
                  const key = `${sheet}\x00${numToCol(c)}${r}`;
                  if (!valueByKey.has(key) || valueByKey.get(key) == null)
                    wantedKeys.add(key);
                }
              }
              return;
            }
            if (Array.isArray(n.args)) for (const a of n.args) walk(a);
            if (n.left) walk(n.left);
            if (n.right) walk(n.right);
            if (n.expr) walk(n.expr);
            if (n.operand) walk(n.operand);
          })(ast);
          if (wantedKeys.size > 0 && wantedKeys.size <= 1000) {
            const refetched = await fetchNodesForKeys(
              graphId,
              Array.from(wantedKeys),
              false,
            );
            let seededCount = 0;
            for (const n of refetched) {
              seedNode(n);
              seededCount += 1;
            }
            if (seededCount > 0) {
              currentRefCount = 0;
              currentNullCount = 0;
              const finding2 = evaluateOne(node, resolveCell, namedRanges);
              const oldDrift = Math.abs(finding.absoluteDrift || 0);
              const newDrift = Math.abs(finding2.absoluteDrift || 0);
              if (finding2.status === "verified" || newDrift < oldDrift) {
                Object.assign(finding, finding2);
                if (finding.status === "verified") {
                  console.log(
                    "[audit:execute] recovery-fetch verified",
                    `${node.sheet}!${node.cell}`,
                    "after seeding",
                    seededCount,
                    "cells",
                  );
                }
              }
            }
          }
        } catch (e) {
          console.warn(
            "[audit:execute] recovery-fetch failed for",
            `${node.sheet}!${node.cell}`,
            e?.message,
          );
        }
      }
      if (
        finding.status === "mismatch" &&
        currentRefCount >= 2 &&
        currentNullCount * 2 >= currentRefCount
      ) {
        finding.status = "skip";
        finding.reason = `ingest_data_gap:${currentNullCount}_of_${currentRefCount}_refs_null`;
        finding.absoluteDrift = null;
        finding.relativeDrift = null;
      }
      if (finding.status === "verified") verified += 1;
      else if (finding.status === "mismatch") {
        mismatched += 1;
        findings.push(finding);
      } else if (finding.status === "skip") {
        skipped += 1;
        findings.push(finding);
      } else if (finding.status === "error") {
        errors += 1;
        findings.push(finding);
      }
    }

    await batchInsertFindings(runId, graphId, findings);
    await sr(`/property_underwriting_formula_audit_chunks?id=eq.${chunkId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "complete",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        verified_count: verified,
        mismatched_count: mismatched,
        skipped_count: skipped,
        errors_count: errors,
      },
    });
    const runRes = await sr(
      `/property_underwriting_formula_audit_runs?id=eq.${runId}&select=chunks_complete`,
    );
    const prior = runRes.data?.[0]?.chunks_complete ?? 0;
    await sr(`/property_underwriting_formula_audit_runs?id=eq.${runId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        chunks_complete: prior + 1,
        evaluated_so_far: (prior + 1) * CHUNK_SIZE,
        error_message: `[progress] chunk ${chunkIndex + 1}/${totalChunks} complete`,
      },
    });

    console.log(
      "[audit:execute] chunk",
      chunkIndex,
      "complete:",
      verified,
      "verified,",
      mismatched,
      "mismatched,",
      skipped,
      "skipped,",
      errors,
      "errors,",
      "duration",
      Date.now() - startTime,
      "ms",
    );

    const nextIndex = chunkIndex + 1;
    if (nextIndex < totalChunks) {
      await triggerSelf(event, {
        mode: "execute",
        run_id: runId,
        chunk_index: nextIndex,
      });
    } else {
      await triggerSelf(event, { mode: "finalize", run_id: runId });
    }

    return jsonResponse(202, { ok: true, mode: "execute", chunk: chunkIndex });
  } catch (e) {
    console.error("[audit:execute] ERROR:", e?.message, e?.stack);
    await sr(`/property_underwriting_formula_audit_runs?id=eq.${runId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "error",
        completed_at: new Date().toISOString(),
        error_message: `execute(${chunkIndex}): ${e?.message?.slice(0, 1000) || String(e)}`,
      },
    });
    return jsonResponse(500, { error: "execute failed", detail: e?.message });
  }
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
function isoDateToExcelSerial(iso) {
  if (typeof iso !== "string" || iso.length < 10) return null;
  const t = Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - EXCEL_EPOCH_MS) / 86_400_000);
}

function evaluateOne(node, resolveCell, namedRanges = null) {
  const formula = node.formula;
  let modelValue = null;
  if (typeof node.value_num === "number" && Number.isFinite(node.value_num)) {
    modelValue = node.value_num;
  } else if (node.value_date) {
    const serial = isoDateToExcelSerial(node.value_date);
    if (serial !== null) modelValue = serial;
  } else if (node.value_text != null && node.value_text !== "") {
    modelValue = String(node.value_text);
  }

  const result = evaluateFormula(formula, node.sheet, resolveCell, {
    timeoutMs: PER_CELL_TIMEOUT_MS,
    namedRanges,
  });

  if (result.skipped) {
    return {
      sheet: node.sheet,
      cell: node.cell,
      formula,
      modelValue,
      platformValue: null,
      status: "skip",
      absoluteDrift: null,
      relativeDrift: null,
      reason: result.reason,
    };
  }
  if (result.error) {
    const modelStr = typeof modelValue === "string" ? modelValue.trim() : "";
    if (modelStr === result.error) {
      return {
        sheet: node.sheet,
        cell: node.cell,
        formula,
        modelValue,
        platformValue: { error: result.error },
        status: "verified",
        absoluteDrift: null,
        relativeDrift: null,
      };
    }
    if (modelValue == null) {
      return {
        sheet: node.sheet,
        cell: node.cell,
        formula,
        modelValue,
        platformValue: { error: result.error },
        status: "skip",
        absoluteDrift: null,
        relativeDrift: null,
        reason: `platform_errored_no_model_value:${result.error}`,
      };
    }
    if (modelValue === 0) {
      return {
        sheet: node.sheet,
        cell: node.cell,
        formula,
        modelValue,
        platformValue: { error: result.error },
        status: "skip",
        absoluteDrift: null,
        relativeDrift: null,
        reason: `model_zero_platform_errored:${result.error}`,
      };
    }
    if (typeof modelValue === "string") {
      return {
        sheet: node.sheet,
        cell: node.cell,
        formula,
        modelValue,
        platformValue: { error: result.error },
        status: "skip",
        absoluteDrift: null,
        relativeDrift: null,
        reason: `model_text_platform_errored:${result.error}`,
      };
    }
    return {
      sheet: node.sheet,
      cell: node.cell,
      formula,
      modelValue,
      platformValue: { error: result.error },
      status: "error",
      absoluteDrift: null,
      relativeDrift: null,
      reason: `formula errored: ${result.error}`,
    };
  }

  const platformValue = result.value;

  if (modelValue == null) {
    return {
      sheet: node.sheet,
      cell: node.cell,
      formula,
      modelValue: null,
      platformValue,
      status: "skip",
      absoluteDrift: null,
      relativeDrift: null,
      reason: "no model-cached value to compare against",
    };
  }

  if (typeof modelValue === "number" && typeof platformValue === "number") {
    const absDrift = Math.abs(platformValue - modelValue);
    const relDrift =
      modelValue !== 0
        ? absDrift / Math.abs(modelValue)
        : platformValue === 0
          ? 0
          : Infinity;
    const pass = absDrift <= NUMERIC_TOL_ABS || relDrift <= NUMERIC_TOL_REL;
    return {
      sheet: node.sheet,
      cell: node.cell,
      formula,
      modelValue,
      platformValue,
      status: pass ? "verified" : "mismatch",
      absoluteDrift: absDrift,
      relativeDrift: modelValue !== 0 ? relDrift : null,
    };
  }

  if (modelValue === 0 && platformValue === null) {
    return {
      sheet: node.sheet,
      cell: node.cell,
      formula,
      modelValue,
      platformValue,
      status: "verified",
      absoluteDrift: 0,
      relativeDrift: 0,
    };
  }

  if (typeof modelValue === "string" && typeof platformValue === "boolean") {
    const lower = modelValue.trim().toLowerCase();
    if (lower === "true" || lower === "false") {
      const coerced = lower === "true";
      return {
        sheet: node.sheet,
        cell: node.cell,
        formula,
        modelValue,
        platformValue,
        status: coerced === platformValue ? "verified" : "mismatch",
        absoluteDrift: null,
        relativeDrift: null,
      };
    }
  }
  if (typeof modelValue === "boolean" && typeof platformValue === "string") {
    const lower = platformValue.trim().toLowerCase();
    if (lower === "true" || lower === "false") {
      const coerced = lower === "true";
      return {
        sheet: node.sheet,
        cell: node.cell,
        formula,
        modelValue,
        platformValue,
        status: coerced === modelValue ? "verified" : "mismatch",
        absoluteDrift: null,
        relativeDrift: null,
      };
    }
  }

  if (typeof modelValue === "string" && typeof platformValue === "string") {
    return {
      sheet: node.sheet,
      cell: node.cell,
      formula,
      modelValue,
      platformValue,
      status: modelValue === platformValue ? "verified" : "mismatch",
      absoluteDrift: null,
      relativeDrift: null,
    };
  }

  return {
    sheet: node.sheet,
    cell: node.cell,
    formula,
    modelValue,
    platformValue,
    status: "mismatch",
    absoluteDrift: null,
    relativeDrift: null,
    reason: `type mismatch: model=${typeof modelValue} platform=${typeof platformValue}`,
  };
}

async function computeFunctionalCells(graphId) {
  const t0 = Date.now();
  const canonRes = await sr(
    `/property_underwriting_model_nodes?graph_id=eq.${graphId}` +
      `&canonical_key=not.is.null&select=sheet,cell&limit=2000`,
  );
  if (!canonRes.ok || !Array.isArray(canonRes.data)) {
    throw new Error(
      `functional-graph: canonicals fetch failed: HTTP ${canonRes.status}`,
    );
  }
  const functional = new Set();
  let frontier = new Set();
  for (const n of canonRes.data) {
    const k = `${n.sheet}\x00${n.cell}`;
    if (!functional.has(k)) {
      functional.add(k);
      frontier.add(k);
    }
  }
  console.log(
    "[audit:finalize:functional] seeded with",
    functional.size,
    "canonical outputs",
  );

  const MAX_ROUNDS = 30;
  let rounds = 0;
  while (frontier.size > 0 && rounds < MAX_ROUNDS) {
    rounds += 1;
    const bySheet = new Map();
    for (const k of frontier) {
      const idx = k.indexOf("\x00");
      const s = k.slice(0, idx);
      const c = k.slice(idx + 1);
      if (!bySheet.has(s)) bySheet.set(s, []);
      bySheet.get(s).push(c);
    }
    const newFrontier = new Set();
    for (const [sheet, cells] of bySheet) {
      for (let i = 0; i < cells.length; i += 80) {
        const chunk = cells.slice(i, i + 80);
        const inList = "(" + chunk.map((c) => `"${c}"`).join(",") + ")";
        const edgesRes = await sr(
          `/property_underwriting_model_edges?graph_id=eq.${graphId}` +
            `&from_sheet=eq.${encodeURIComponent(sheet)}` +
            `&from_cell=in.${encodeURIComponent(inList)}` +
            `&select=to_sheet,to_cell&limit=10000`,
        );
        if (!edgesRes.ok || !Array.isArray(edgesRes.data)) continue;
        for (const e of edgesRes.data) {
          const k = `${e.to_sheet}\x00${e.to_cell}`;
          if (!functional.has(k)) {
            functional.add(k);
            newFrontier.add(k);
          }
        }
      }
    }
    frontier = newFrontier;
  }
  const elapsed = Date.now() - t0;
  console.log(
    "[audit:finalize:functional] closure:",
    functional.size,
    "cells in",
    rounds,
    "rounds,",
    elapsed,
    "ms",
  );
  return functional;
}

async function markNonFunctionalFindings(runId, functional) {
  const PAGE = 1000;
  let offset = 0;
  const idsToFlip = new Set();
  const seenIds = new Set();
  let nonFuncMismatched = 0;
  let nonFuncErrors = 0;

  while (true) {
    const r = await sr(
      `/property_underwriting_formula_audit_findings?run_id=eq.${runId}` +
        `&status=in.(mismatch,error)&select=id,sheet,cell,status` +
        `&limit=${PAGE}&offset=${offset}`,
    );
    if (!r.ok || !Array.isArray(r.data)) {
      console.warn(
        "[audit:finalize:functional] page query failed at offset",
        offset,
        "HTTP",
        r.status,
        r.raw?.slice(0, 200),
      );
      break;
    }
    if (r.data.length === 0) break;
    for (const f of r.data) {
      if (seenIds.has(f.id)) continue;
      seenIds.add(f.id);
      const k = `${f.sheet}\x00${f.cell}`;
      if (!functional.has(k)) {
        idsToFlip.add(f.id);
        if (f.status === "mismatch") nonFuncMismatched += 1;
        else if (f.status === "error") nonFuncErrors += 1;
      }
    }
    if (r.data.length < PAGE) break;
    offset += PAGE;
  }

  const BATCH = 200;
  const idsArr = Array.from(idsToFlip);
  for (let i = 0; i < idsArr.length; i += BATCH) {
    const chunk = idsArr.slice(i, i + BATCH);
    const inList = "(" + chunk.map((id) => `"${id}"`).join(",") + ")";
    const upd = await sr(
      `/property_underwriting_formula_audit_findings?id=in.${encodeURIComponent(inList)}`,
      {
        method: "PATCH",
        prefer: "return=minimal",
        body: { is_functional: false },
      },
    );
    if (!upd.ok) {
      console.warn(
        "[audit:finalize:functional] PATCH batch",
        i,
        "HTTP",
        upd.status,
        upd.raw?.slice(0, 150),
      );
    }
  }
  console.log(
    "[audit:finalize:functional] flagged",
    nonFuncMismatched,
    "non-functional mismatches,",
    nonFuncErrors,
    "non-functional errors out of",
    idsArr.length,
    "total flipped",
  );
  return {
    non_functional_mismatched: nonFuncMismatched,
    non_functional_errors: nonFuncErrors,
  };
}

async function handleFinalize(event, body) {
  const { run_id: runId } = body;
  if (!runId) return jsonResponse(400, { error: "finalize: run_id required" });

  console.log("[audit:finalize] run", runId);

  try {
    const r = await sr(
      `/property_underwriting_formula_audit_chunks?run_id=eq.${runId}` +
        `&select=verified_count,mismatched_count,skipped_count,errors_count,total_chunks,formula_keys`,
    );
    if (!r.ok || !Array.isArray(r.data)) {
      throw new Error(`finalize: failed to read chunks: HTTP ${r.status}`);
    }
    let verified = 0,
      mismatched = 0,
      skipped = 0,
      errors = 0,
      totalEvaluated = 0;
    for (const c of r.data) {
      verified += c.verified_count || 0;
      mismatched += c.mismatched_count || 0;
      skipped += c.skipped_count || 0;
      errors += c.errors_count || 0;
      totalEvaluated += Array.isArray(c.formula_keys)
        ? c.formula_keys.length
        : 0;
    }

    const runRes = await sr(
      `/property_underwriting_formula_audit_runs?id=eq.${runId}&select=total_formulas,started_at,graph_id`,
    );
    const total = runRes.data?.[0]?.total_formulas || totalEvaluated;
    const coveragePct = total > 0 ? totalEvaluated / total : 1;
    const startedAt = runRes.data?.[0]?.started_at;
    const graphId = runRes.data?.[0]?.graph_id;
    const durationMs = startedAt
      ? Date.now() - new Date(startedAt).getTime()
      : null;

    let nonFuncCounts = {
      non_functional_mismatched: null,
      non_functional_errors: null,
    };
    if (graphId && mismatched + errors > 0) {
      try {
        const functional = await computeFunctionalCells(graphId);
        nonFuncCounts = await markNonFunctionalFindings(runId, functional);
      } catch (e) {
        console.warn("[audit:finalize:functional] closure failed:", e?.message);
      }
    }

    await sr(`/property_underwriting_formula_audit_runs?id=eq.${runId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "complete",
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        evaluated_so_far: totalEvaluated,
        verified_count: verified,
        mismatched_count: mismatched,
        skipped_count: skipped,
        errors_count: errors,
        coverage_pct: coveragePct,
        non_functional_mismatched_count:
          nonFuncCounts.non_functional_mismatched,
        non_functional_errors_count: nonFuncCounts.non_functional_errors,
        error_message: null,
      },
    });

    console.log(
      "[audit:finalize] complete:",
      verified,
      "verified,",
      mismatched,
      "mismatched (" +
        (nonFuncCounts.non_functional_mismatched ?? "?") +
        " non-functional),",
      skipped,
      "skipped,",
      errors,
      "errors (" +
        (nonFuncCounts.non_functional_errors ?? "?") +
        " non-functional). coverage:",
      (coveragePct * 100).toFixed(1) + "%",
    );

    return jsonResponse(200, {
      ok: true,
      mode: "finalize",
      run_id: runId,
      summary: {
        verified,
        mismatched,
        skipped,
        errors,
        coverage_pct: coveragePct,
        non_functional_mismatched: nonFuncCounts.non_functional_mismatched,
        non_functional_errors: nonFuncCounts.non_functional_errors,
      },
    });
  } catch (e) {
    console.error("[audit:finalize] ERROR:", e?.message, e?.stack);
    await sr(`/property_underwriting_formula_audit_runs?id=eq.${runId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "error",
        completed_at: new Date().toISOString(),
        error_message: `finalize: ${e?.message?.slice(0, 1000) || String(e)}`,
      },
    });
    return jsonResponse(500, { error: "finalize failed", detail: e?.message });
  }
}

async function handleKickoff(event, body) {
  const { graph_id, property_id } = body;
  if (!graph_id || !property_id) {
    return jsonResponse(400, { error: "graph_id and property_id required" });
  }
  const propRes = await sr(`/properties?id=eq.${property_id}&select=org_id`);
  if (!propRes.ok || !propRes.data?.length) {
    return jsonResponse(404, { error: "property not found" });
  }
  const orgId = propRes.data[0].org_id;

  const ins = await sr(`/property_underwriting_formula_audit_runs`, {
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        graph_id,
        property_id,
        org_id: orgId,
        status: "running",
        architecture: "chunked",
        started_at: new Date().toISOString(),
      },
    ],
  });
  if (!ins.ok || !ins.data?.length) {
    return jsonResponse(500, {
      error: "failed to create run",
      detail: ins.raw?.slice(0, 200),
    });
  }
  const runId = ins.data[0].id;
  console.log("[audit:kickoff] created run", runId, "for graph", graph_id);

  await triggerSelf(event, { mode: "plan", run_id: runId, graph_id });

  return jsonResponse(202, { ok: true, mode: "kickoff", run_id: runId });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin":
          "https://credashboardproperty.netlify.app",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const rawBody =
    event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "";

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const isInternal = verifyInternalSignature(event, rawBody);
  if (isInternal && body.mode) {
    console.log(
      "[audit] internal dispatch:",
      body.mode,
      "run",
      body.run_id || "(none)",
    );
    switch (body.mode) {
      case "plan":
        return handlePlan(event, body);
      case "execute":
        return handleExecute(event, body);
      case "finalize":
        return handleFinalize(event, body);
      default:
        return jsonResponse(400, { error: `unknown mode: ${body.mode}` });
    }
  }

  const sec = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
    maxBodyBytes: 2_000,
  });
  if (sec.error) return sec.error;

  return handleKickoff(event, body);
};
