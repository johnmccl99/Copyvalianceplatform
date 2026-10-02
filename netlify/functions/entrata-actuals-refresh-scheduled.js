import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RPC_TIMEOUT_MS = 60_000;

async function callRefreshRpc() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/refresh_entrata_gl_actual_from_transactions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    return { ok: res.ok, status: res.status, body, raw: text };
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "[entrata-actuals-refresh] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server not configured" }),
    };
  }

  const manualSecret = process.env.SCHEDULED_RUN_SECRET || "";
  const provided = event?.headers?.["x-scheduled-secret"] || "";
  const isScheduled = isNetlifyScheduledEvent(event);
  const isAuthorizedManual = manualSecret && provided === manualSecret;
  if (!isScheduled && !isAuthorizedManual) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Scheduled invocation only" }),
    };
  }

  let res;
  try {
    res = await callRefreshRpc();
  } catch (err) {
    const aborted = err && err.name === "AbortError";
    console.error(
      `[entrata-actuals-refresh] RPC ${aborted ? "timed out" : "threw"}: ${err && err.message}`,
    );
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: aborted ? "Refresh timed out" : "Refresh failed",
      }),
    };
  }

  if (!res.ok) {
    console.error(
      `[entrata-actuals-refresh] RPC non-200: ${res.status} ${(res.raw || "").slice(0, 300)}`,
    );
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Refresh failed" }),
    };
  }

  const rowsUpserted = typeof res.body === "number" ? res.body : null;

  const summary = { ok: true, rows_upserted: rowsUpserted };
  console.log(`[entrata-actuals-refresh] ${JSON.stringify(summary)}`);
  return { statusCode: 200, body: JSON.stringify(summary) };
};
