const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHUNK_TIMEOUT_MS = 90_000;

const WALL_CLOCK_BUDGET_MS = 11 * 60_000;

const MAX_CHUNKS = 40;

const DEFAULT_MAX_ARMS = 3;
const DEFAULT_BUDGET_SECONDS = 60;
const DEFAULT_MIN_AGE_SECONDS = 3600;
const DEFAULT_MAX_SOURCE_AGE_SECONDS = 604_800;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function callChunkRpc({
  orgId,
  maxArms,
  budgetSeconds,
  minAgeSeconds,
  maxSourceAgeSeconds,
}) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/refresh_portfolio_budget_cache_chunk`,
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
        p_max_arms: maxArms,
        p_budget_seconds: budgetSeconds,
        p_min_age_seconds: minAgeSeconds,
        p_max_source_age_seconds: maxSourceAgeSeconds,
        p_source: "portfolio_arm_sweep",
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
      "[portfolio-cache-sweep] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
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
  const maxArms = clampInt(req.max_arms, 1, 30, DEFAULT_MAX_ARMS);
  const budgetSeconds = clampInt(
    req.budget_seconds,
    5,
    180,
    DEFAULT_BUDGET_SECONDS,
  );
  const minAgeSeconds = clampInt(
    req.min_age_seconds,
    0,
    86_400,
    DEFAULT_MIN_AGE_SECONDS,
  );
  const maxSourceAgeSeconds = clampInt(
    req.max_source_age_seconds,
    3_600,
    604_800,
    DEFAULT_MAX_SOURCE_AGE_SECONDS,
  );

  const startedAt = Date.now();
  const summary = {
    org_id: orgId,
    chunks: 0,
    arms_refreshed: 0,
    arms_failed: 0,
    arms_skipped: 0,
    arms_remaining: null,
    rows_written: 0,
    failures: [],
    skips: [],
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
        maxArms,
        budgetSeconds,
        minAgeSeconds,
        maxSourceAgeSeconds,
      });
    } catch (err) {
      const aborted = err && err.name === "TimeoutError";
      console.error(
        `[portfolio-cache-sweep] chunk ${aborted ? "timed out" : "threw"}: ${err && err.message}`,
      );
      summary.stopped_because = aborted ? "chunk_timeout" : "chunk_threw";
      break;
    }

    if (!chunk.ok) {
      console.error(
        `[portfolio-cache-sweep] chunk non-200: ${chunk.status} ${(chunk.raw || "").slice(0, 300)}`,
      );
      summary.stopped_because = `chunk_http_${chunk.status}`;
      break;
    }

    const b = chunk.body || {};
    const refreshed = Number(b.arms_refreshed) || 0;
    const failed = Number(b.arms_failed) || 0;
    const skipped = Number(b.arms_skipped) || 0;
    const remaining = Number(b.arms_remaining) || 0;

    summary.chunks += 1;
    summary.arms_refreshed += refreshed;
    summary.arms_failed += failed;
    summary.arms_skipped += skipped;
    summary.rows_written += Number(b.rows_written) || 0;
    summary.arms_remaining = remaining;
    if (Array.isArray(b.failures) && b.failures.length) {
      summary.failures.push(...b.failures.slice(0, 5));
    }
    if (Array.isArray(b.skips) && b.skips.length) {
      summary.skips.push(...b.skips.slice(0, 5));
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
    summary.stopped_because === "complete" &&
    summary.arms_failed === 0 &&
    summary.arms_skipped === 0;
  if (clean) {
    console.log("[portfolio-cache-sweep]", JSON.stringify(summary));
  } else {
    console.error(
      "[portfolio-cache-sweep] INCOMPLETE",
      JSON.stringify(summary),
    );
  }

  return { statusCode: clean ? 200 : 500, body: JSON.stringify(summary) };
};
