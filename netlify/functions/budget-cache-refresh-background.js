const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHUNK_TIMEOUT_MS = 90_000;

const WALL_CLOCK_BUDGET_MS = 11 * 60_000;

const MAX_CHUNKS = 40;

const DEFAULT_MAX_PROPERTIES = 3;
const DEFAULT_BUDGET_SECONDS = 40;
const DEFAULT_MIN_AGE_SECONDS = 3600;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function callChunkRpc({
  orgId,
  maxProperties,
  budgetSeconds,
  minAgeSeconds,
}) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/refresh_budget_coa_monthly_cache_chunk`,
    {
      method: "POST",
      signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        p_org_id: orgId ?? null,
        p_max_properties: maxProperties,
        p_budget_seconds: budgetSeconds,
        p_min_age_seconds: minAgeSeconds,
        p_source: "coa_chunk_sweep",
      }),
    },
  );
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body, raw: text };
}

export const handler = async (event) => {
  if ((event?.httpMethod || "POST") !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const expected = process.env.SCHEDULED_RUN_SECRET || "";
  const provided = event?.headers?.["x-scheduled-secret"] || "";
  if (!expected || provided !== expected) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "[budget-cache-refresh] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server not configured" }),
    };
  }

  let req = {};
  try {
    req = event?.body ? JSON.parse(event.body) : {};
  } catch {
    req = {};
  }

  const orgId =
    typeof req.org_id === "string" && req.org_id ? req.org_id : null;
  const maxProperties = clampInt(
    req.max_properties,
    1,
    20,
    DEFAULT_MAX_PROPERTIES,
  );
  const budgetSeconds = clampInt(
    req.budget_seconds,
    5,
    120,
    DEFAULT_BUDGET_SECONDS,
  );
  const minAgeSeconds = clampInt(
    req.min_age_seconds,
    0,
    86_400,
    DEFAULT_MIN_AGE_SECONDS,
  );

  const startedAt = Date.now();
  const summary = {
    org_id: orgId,
    chunks: 0,
    properties_refreshed: 0,
    properties_failed: 0,
    properties_remaining: null,
    rows_written: 0,
    failures: [],
    stopped_because: null,
  };

  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    if (Date.now() - startedAt > WALL_CLOCK_BUDGET_MS) {
      summary.stopped_because = "wall_clock";
      break;
    }

    let chunk;
    try {
      chunk = await callChunkRpc({
        orgId,
        maxProperties,
        budgetSeconds,
        minAgeSeconds,
      });
    } catch (err) {
      const aborted = err && err.name === "TimeoutError";
      console.error(
        `[budget-cache-refresh] chunk ${aborted ? "timed out" : "threw"}: ${err && err.message}`,
      );
      summary.stopped_because = aborted ? "chunk_timeout" : "chunk_threw";
      break;
    }

    if (!chunk.ok) {
      console.error(
        `[budget-cache-refresh] chunk non-200: ${chunk.status} ${(chunk.raw || "").slice(0, 300)}`,
      );
      summary.stopped_because = `chunk_http_${chunk.status}`;
      break;
    }

    const b = chunk.body || {};
    const refreshed = Number(b.properties_refreshed) || 0;
    const failed = Number(b.properties_failed) || 0;
    const remaining = Number(b.properties_remaining) || 0;

    summary.chunks += 1;
    summary.properties_refreshed += refreshed;
    summary.properties_failed += failed;
    summary.rows_written += Number(b.rows_written) || 0;
    summary.properties_remaining = remaining;
    if (Array.isArray(b.failures) && b.failures.length) {
      summary.failures.push(...b.failures.slice(0, 5));
    }

    if (remaining === 0) {
      summary.stopped_because = "complete";
      break;
    }
    if (refreshed === 0) {
      summary.stopped_because =
        failed > 0 ? "no_progress_all_failing" : "no_progress";
      break;
    }
    if (i === MAX_CHUNKS - 1) summary.stopped_because = "max_chunks";
  }

  summary.elapsed_ms = Date.now() - startedAt;

  const clean =
    summary.stopped_because === "complete" && summary.properties_failed === 0;
  if (clean) {
    console.log("[budget-cache-refresh]", JSON.stringify(summary));
  } else {
    console.error("[budget-cache-refresh] INCOMPLETE", JSON.stringify(summary));
  }

  return { statusCode: clean ? 200 : 500, body: JSON.stringify(summary) };
};
