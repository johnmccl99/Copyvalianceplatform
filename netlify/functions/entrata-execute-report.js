import { applySecurity, jsonResponse } from "./_security.js";
import { ENTRATA_WRITE_METHODS } from "../../src/lib/entrataWriteMethods.js";
import { resolveStepMethodVersion } from "../../src/lib/entrataReportComposerVersion.js";

export function findWriteStep(steps) {
  if (!Array.isArray(steps)) return null;
  for (const s of steps) {
    const method = String(s?.vendor_method || "").trim();
    if (method && ENTRATA_WRITE_METHODS.has(method)) {
      return { step: s, method };
    }
  }
  return null;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const ENTRATA_BASE = {
  us: "https://apis.entrata.com/ext/orgs",
  eu: "https://apis.entrata.global/ext/orgs",
};

const ENTRATA_CALL_TIMEOUT_MS = 20_000;
const MAX_STEPS_PER_REPORT = 10;

function pgUser(
  path,
  jwt,
  { method = "GET", body = null, prefer = null } = {},
) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function pgServiceRole(
  path,
  { method = "GET", body = null, prefer = null } = {},
) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function entrataRpcBody(
  methodName,
  params = {},
  version = "r1",
  pagination = null,
) {
  const body = {
    auth: { type: "apikey" },
    requestId: Math.floor(Math.random() * 1_000_000),
    method: { name: methodName, version, params },
  };
  if (pagination && typeof pagination === "object") {
    if (pagination.page_no != null) body.page_no = pagination.page_no;
    if (pagination.per_page != null) body.per_page = pagination.per_page;
  }
  return body;
}

function computeDateTokens() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = now.getUTCMonth() + 1;
  const todayIso = now.toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  const firstOfMonth = `${yyyy}-${pad(mm)}-01`;
  const firstOfYear = `${yyyy}-01-01`;
  const lastFullMonthIdx = mm === 1 ? 12 : mm - 1;
  const lastFullMonthYear = mm === 1 ? yyyy - 1 : yyyy;
  const lastFullMonthStart = `${lastFullMonthYear}-${pad(lastFullMonthIdx)}-01`;
  const lastDay = new Date(
    Date.UTC(lastFullMonthYear, lastFullMonthIdx, 0),
  ).getUTCDate();
  const lastFullMonthEnd = `${lastFullMonthYear}-${pad(lastFullMonthIdx)}-${pad(lastDay)}`;
  return {
    today: todayIso,
    today_first_of_month: firstOfMonth,
    today_first_of_year: firstOfYear,
    last_full_month_start: lastFullMonthStart,
    last_full_month_end: lastFullMonthEnd,
  };
}

function formatDate(iso, format) {
  if (!format || !iso || typeof iso !== "string") return iso;
  if (format.toUpperCase() === "MM/DD/YYYY") {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  }
  return iso;
}

function resolveParams(params, ctx) {
  if (params == null) return {};
  const tokens = computeDateTokens();
  const minusN = (n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const lookupRaw = (key) => {
    if (key === "entrata_property_id") return String(ctx.entrataPropertyId);
    if (Object.prototype.hasOwnProperty.call(tokens, key)) return tokens[key];
    const m = key.match(/^today_minus_(\d+)$/);
    if (m) return minusN(parseInt(m[1], 10));
    return null;
  };
  const sub = (v) => {
    if (typeof v !== "string") return v;
    return v.replace(
      /\$\{([a-z0-9_]+)(?::([A-Za-z0-9/-]+))?\}/gi,
      (full, key, fmt) => {
        const raw = lookupRaw(key);
        if (raw == null) return full;
        return fmt ? formatDate(raw, fmt) : raw;
      },
    );
  };
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) out[k] = v.map(sub);
    else if (v && typeof v === "object") {
      const o = {};
      for (const [k2, v2] of Object.entries(v)) o[k2] = sub(v2);
      out[k] = o;
    } else out[k] = sub(v);
  }
  return out;
}

function readRateLimitHeaders(res) {
  return {
    minute_remaining: res.headers.get("X-RateLimit-Minute-Remaining"),
    hour_remaining: res.headers.get("X-RateLimit-Hour-Remaining"),
    day_remaining: res.headers.get("X-RateLimit-Day-Remaining"),
  };
}

async function callEntrataStep({
  baseUrl,
  subdomain,
  apiKey,
  gatewayPath,
  vendorMethod,
  vendorMethodVersion,
  resolvedParams,
  pagination = null,
}) {
  const url = `${baseUrl}/${encodeURIComponent(subdomain)}${gatewayPath}`;
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENTRATA_CALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(
        entrataRpcBody(
          vendorMethod,
          resolvedParams,
          vendorMethodVersion || "r1",
          pagination,
        ),
      ),
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    const duration = Date.now() - t0;
    const rl = readRateLimitHeaders(res);
    if (!res.ok) {
      return {
        ok: false,
        http_status: res.status,
        duration_ms: duration,
        rows: [],
        row_count: 0,
        error:
          body?.response?.error?.message ||
          body?.error ||
          text.slice(0, 300) ||
          `HTTP ${res.status}`,
        rate_limit: rl,
      };
    }
    const result = body?.response?.result ?? null;
    return {
      ok: true,
      http_status: res.status,
      duration_ms: duration,
      result,
      rate_limit: rl,
    };
  } catch (err) {
    const duration = Date.now() - t0;
    return {
      ok: false,
      http_status: 0,
      duration_ms: duration,
      rows: [],
      row_count: 0,
      error:
        err.name === "AbortError"
          ? "Entrata call timed out"
          : err.message || String(err),
      rate_limit: {
        minute_remaining: null,
        hour_remaining: null,
        day_remaining: null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function pickRowsForSummary(result) {
  if (result == null) return [];
  if (Array.isArray(result)) return result;
  if (typeof result !== "object") return [];
  for (const v of Object.values(result)) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      for (const v2 of Object.values(v)) {
        if (Array.isArray(v2)) return v2;
      }
    }
  }
  return [];
}

function replaceFirstArray(result, replacement) {
  if (result == null) return replacement;
  if (Array.isArray(result)) return replacement;
  if (typeof result !== "object") return result;
  const out = { ...result };
  for (const [k, v] of Object.entries(result)) {
    if (Array.isArray(v)) {
      out[k] = replacement;
      return out;
    }
    if (v && typeof v === "object") {
      const nested = { ...v };
      let replaced = false;
      for (const [k2, v2] of Object.entries(v)) {
        if (Array.isArray(v2)) {
          nested[k2] = replacement;
          replaced = true;
          break;
        }
      }
      if (replaced) {
        out[k] = nested;
        return out;
      }
    }
  }
  return out;
}

const ITERATE_ALL_PAGE_CAP = 50;
const ITERATE_ALL_SLEEP_MS = 200;

async function executeStepWithPagination({
  baseUrl,
  subdomain,
  apiKey,
  step,
  vendorMethod,
  gatewayPath,
  vendorMethodVersion,
  resolvedParams,
}) {
  const pagination = step.pagination || null;
  const iterateAll = pagination?.iterate_all_pages === true;

  if (!iterateAll) {
    const single = await callEntrataStep({
      baseUrl,
      subdomain,
      apiKey,
      gatewayPath,
      vendorMethod,
      vendorMethodVersion,
      resolvedParams,
      pagination: pagination
        ? { page_no: pagination.page_no, per_page: pagination.per_page }
        : null,
    });
    return single;
  }

  const perPage = Number(pagination.per_page);
  if (!Number.isFinite(perPage) || perPage <= 0) {
    return {
      ok: false,
      http_status: 0,
      duration_ms: 0,
      rows: [],
      row_count: 0,
      error: "iterate_all_pages requires a numeric per_page > 0",
      rate_limit: {
        minute_remaining: null,
        hour_remaining: null,
        day_remaining: null,
      },
    };
  }
  const startPage = Number.isFinite(Number(pagination.page_no))
    ? Number(pagination.page_no)
    : 1;

  const t0 = Date.now();
  const accumulatedRows = [];
  let lastSuccessResult = null;
  let lastCallResult = null;
  let lastRateLimit = null;
  let pagesFetched = 0;
  let currentPage = startPage;
  let stoppedReason = "completed";

  while (pagesFetched < ITERATE_ALL_PAGE_CAP) {
    lastCallResult = await callEntrataStep({
      baseUrl,
      subdomain,
      apiKey,
      gatewayPath,
      vendorMethod,
      vendorMethodVersion,
      resolvedParams,
      pagination: { page_no: currentPage, per_page: perPage },
    });
    pagesFetched += 1;
    if (lastCallResult?.rate_limit) lastRateLimit = lastCallResult.rate_limit;

    if (!lastCallResult.ok) {
      stoppedReason = `error_on_page_${currentPage}`;
      break;
    }
    lastSuccessResult = lastCallResult.result;
    const pageRows = pickRowsForSummary(lastCallResult.result);
    accumulatedRows.push(...pageRows);

    if (pageRows.length < perPage) {
      stoppedReason = "end_of_data";
      break;
    }

    const minuteRemaining = Number(lastCallResult.rate_limit?.minute_remaining);
    if (Number.isFinite(minuteRemaining) && minuteRemaining <= 1) {
      stoppedReason = "rate_limit_approaching";
      break;
    }

    currentPage += 1;
    if (pagesFetched < ITERATE_ALL_PAGE_CAP) {
      await new Promise((resolve) => setTimeout(resolve, ITERATE_ALL_SLEEP_MS));
    } else {
      stoppedReason = "page_cap_reached";
    }
  }

  const synthesizedResult =
    lastSuccessResult != null
      ? replaceFirstArray(lastSuccessResult, accumulatedRows)
      : null;

  if (lastSuccessResult == null && lastCallResult && !lastCallResult.ok) {
    return {
      ok: false,
      http_status: lastCallResult.http_status,
      duration_ms: Date.now() - t0,
      rows: [],
      row_count: 0,
      error: lastCallResult.error,
      rate_limit: lastRateLimit,
      iterate_all_meta: {
        pages_fetched: pagesFetched,
        total_rows: 0,
        stopped_reason: stoppedReason,
      },
    };
  }

  return {
    ok: true,
    http_status: lastCallResult?.http_status ?? 200,
    duration_ms: Date.now() - t0,
    result: synthesizedResult,
    rate_limit: lastRateLimit,
    iterate_all_meta: {
      pages_fetched: pagesFetched,
      total_rows: accumulatedRows.length,
      stopped_reason: stoppedReason,
    },
  };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!userJwt) return jsonResponse(401, { error: "Missing JWT" });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return jsonResponse(500, { error: "Server not configured" });
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const reportId = String(parsed.report_id || "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      reportId,
    )
  ) {
    return jsonResponse(400, { error: "report_id (UUID) required" });
  }

  const reportRes = await pgUser(
    `/property_custom_reports?id=eq.${reportId}&select=id,org_id,property_id,name,endpoint_chain&limit=1`,
    userJwt,
  );
  if (!reportRes.ok)
    return jsonResponse(reportRes.status, { error: "Report fetch failed" });
  const reportRows = await reportRes.json().catch(() => null);
  if (!Array.isArray(reportRows) || !reportRows.length) {
    return jsonResponse(404, { error: "Report not found or not accessible" });
  }
  const report = reportRows[0];

  const chain = report.endpoint_chain || {};
  const steps = Array.isArray(chain?.steps) ? chain.steps : [];
  if (!steps.length) return jsonResponse(400, { error: "Report has no steps" });
  if (steps.length > MAX_STEPS_PER_REPORT) {
    return jsonResponse(400, {
      error: `Reports are capped at ${MAX_STEPS_PER_REPORT} steps in V1.`,
    });
  }

  const writeViolation = findWriteStep(steps);
  if (writeViolation) {
    console.error("[entrata-execute-report] BLOCKED write attempt", {
      report_id: reportId,
      org_id: report.org_id,
      step_id: writeViolation.step?.step_id || null,
      endpoint_name: writeViolation.step?.endpoint_name || null,
      vendor_method: writeViolation.method,
    });
    return jsonResponse(403, {
      error: `Custom Reports are read-only. The endpoint "${writeViolation.method}" is a write method and cannot be executed from this surface.`,
    });
  }

  const propRes = await pgUser(
    `/properties?id=eq.${report.property_id}&select=id,entrata_property_id&limit=1`,
    userJwt,
  );
  if (!propRes.ok)
    return jsonResponse(propRes.status, { error: "Property fetch failed" });
  const propRows = await propRes.json().catch(() => null);
  if (
    !Array.isArray(propRows) ||
    !propRows.length ||
    !propRows[0].entrata_property_id
  ) {
    return jsonResponse(409, {
      error:
        "Property is not mapped to Entrata. Set entrata_property_id on the property first.",
    });
  }
  const entrataPropertyId = propRows[0].entrata_property_id;

  const acctRes = await pgServiceRole(
    `/org_entrata_accounts?org_id=eq.${report.org_id}&select=id,subdomain,region,api_key_encrypted&limit=1`,
  );
  if (!acctRes.ok)
    return jsonResponse(500, { error: "Entrata account fetch failed" });
  const acctRows = await acctRes.json().catch(() => null);
  if (
    !Array.isArray(acctRows) ||
    !acctRows.length ||
    !acctRows[0].api_key_encrypted
  ) {
    return jsonResponse(409, {
      error: "No Entrata account connected for this org.",
    });
  }
  const acct = acctRows[0];

  const decRes = await pgServiceRole("/rpc/entrata_decrypt_api_key", {
    method: "POST",
    body: { p_ciphertext: acct.api_key_encrypted },
  });
  if (!decRes.ok)
    return jsonResponse(500, { error: "Credential decrypt failed" });
  const decTxt = await decRes.text();
  let apiKey = null;
  try {
    apiKey = JSON.parse(decTxt);
  } catch {
    apiKey = decTxt;
  }
  apiKey = typeof apiKey === "string" ? apiKey.replace(/^"|"$/g, "") : null;
  if (!apiKey)
    return jsonResponse(500, {
      error: "Credential decrypt produced empty key",
    });

  const baseUrl = ENTRATA_BASE[acct.region === "eu" ? "eu" : "us"];

  const stepResults = [];
  let lastRateLimit = null;
  let aggregateOk = true;
  let anyOk = false;

  for (const step of steps) {
    const vendorMethod = String(step?.vendor_method || "").trim();
    const gatewayPath = String(
      step?.gateway_path_template || step?.gateway_path || "",
    ).trim();
    if (!vendorMethod || !gatewayPath) {
      stepResults.push({
        step_id: step?.step_id || null,
        endpoint_name: step?.endpoint_name || null,
        ok: false,
        error:
          "Step is missing vendor_method or gateway_path_template; re-save the report in the composer.",
      });
      aggregateOk = false;
      continue;
    }
    const resolvedParams = resolveParams(step.params || {}, {
      entrataPropertyId,
    });
    const vendorMethodVersion = resolveStepMethodVersion(step);
    const callResult = await executeStepWithPagination({
      baseUrl,
      subdomain: acct.subdomain,
      apiKey,
      step,
      vendorMethod,
      gatewayPath,
      vendorMethodVersion,
      resolvedParams,
    });
    if (callResult.rate_limit) lastRateLimit = callResult.rate_limit;
    if (callResult.ok) {
      anyOk = true;
      const rowsPreview = pickRowsForSummary(callResult.result);
      stepResults.push({
        step_id: step.step_id || null,
        endpoint_name: step.endpoint_name || null,
        vendor_method: vendorMethod,
        ok: true,
        http_status: callResult.http_status,
        duration_ms: callResult.duration_ms,
        row_count: rowsPreview.length,
        result: callResult.result,
        ...(callResult.iterate_all_meta
          ? { iterate_all_meta: callResult.iterate_all_meta }
          : {}),
      });
    } else {
      aggregateOk = false;
      stepResults.push({
        step_id: step.step_id || null,
        endpoint_name: step.endpoint_name || null,
        vendor_method: vendorMethod,
        ok: false,
        http_status: callResult.http_status,
        duration_ms: callResult.duration_ms,
        error: callResult.error,
        ...(callResult.iterate_all_meta
          ? { iterate_all_meta: callResult.iterate_all_meta }
          : {}),
      });
    }
  }

  const overallStatus = aggregateOk ? "success" : anyOk ? "partial" : "error";

  const summary = {
    steps: stepResults.map((s) => ({
      step_id: s.step_id,
      endpoint_name: s.endpoint_name,
      ok: s.ok,
      row_count: s.row_count ?? 0,
      duration_ms: s.duration_ms ?? null,
      error: s.error ?? null,
    })),
    rate_limit_remaining: lastRateLimit,
    executed_at: new Date().toISOString(),
  };
  try {
    await pgUser(`/property_custom_reports?id=eq.${reportId}`, userJwt, {
      method: "PATCH",
      body: {
        last_executed_at: summary.executed_at,
        last_execution_status: overallStatus,
        result_summary: summary,
      },
    });
  } catch (err) {
    console.warn(
      "[entrata-execute-report] result write failed:",
      err?.message || err,
    );
  }

  return jsonResponse(200, {
    ok: true,
    status: overallStatus,
    steps: stepResults,
    rate_limit: lastRateLimit,
    report: { id: report.id, name: report.name },
  });
};

export {
  entrataRpcBody,
  resolveParams,
  formatDate,
  replaceFirstArray,
  executeStepWithPagination,
  ITERATE_ALL_PAGE_CAP,
  ITERATE_ALL_SLEEP_MS,
};
