import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";

const FIRE_TIMEOUT_MS = 10_000;

const LOG_TIMEOUT_MS = 5_000;

const TRIGGER_SOURCE = "sweep_trigger_coa";
const ENTRY_SOURCE = "sweep_trigger_coa_entry";

async function logTrigger({
  ok,
  errorMessage,
  durationMs,
  source = TRIGGER_SOURCE,
}) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "[budget-cache-refresh-scheduled] cannot record trigger: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
    return;
  }
  try {
    const res = await fetch(
      `${url}/rest/v1/portfolio_budget_cache_refresh_log`,
      {
        method: "POST",
        signal: AbortSignal.timeout(LOG_TIMEOUT_MS),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          org_id: null,
          source,
          ok,
          error_message: errorMessage
            ? String(errorMessage).slice(0, 500)
            : null,
          duration_ms: Number.isFinite(durationMs)
            ? Math.trunc(durationMs)
            : null,
        }),
      },
    );
    if (!res.ok) {
      console.error(
        `[budget-cache-refresh-scheduled] trigger log write failed: ${res.status}`,
      );
    }
  } catch (e) {
    console.error(
      `[budget-cache-refresh-scheduled] trigger log write threw: ${e?.message || e}`,
    );
  }
}

export const handler = async (event) => {
  const startedAt = Date.now();
  const finish = async (statusCode, payload, { ok, errorMessage }) => {
    await logTrigger({ ok, errorMessage, durationMs: Date.now() - startedAt });
    return { statusCode, body: JSON.stringify(payload) };
  };

  await logTrigger({
    ok: true,
    errorMessage: null,
    durationMs: 0,
    source: ENTRY_SOURCE,
  });

  const manualSecret = process.env.SCHEDULED_RUN_SECRET || "";
  const provided = event?.headers?.["x-scheduled-secret"] || "";
  const isScheduled = isNetlifyScheduledEvent(event);
  const isAuthorizedManual = manualSecret && provided === manualSecret;
  if (!isScheduled && !isAuthorizedManual) {
    return finish(
      401,
      { error: "Scheduled invocation only" },
      {
        ok: false,
        errorMessage:
          "invocation guard rejected the caller (not a recognized Netlify scheduled event, no valid x-scheduled-secret)",
      },
    );
  }

  if (!manualSecret) {
    console.error(
      "[budget-cache-refresh-scheduled] SCHEDULED_RUN_SECRET is not set — cannot authenticate the background refresh; cache will go stale",
    );
    return finish(
      500,
      { error: "Not configured" },
      {
        ok: false,
        errorMessage:
          "SCHEDULED_RUN_SECRET is not set — cannot authenticate the background refresh",
      },
    );
  }

  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "";
  if (!base) {
    console.error(
      "[budget-cache-refresh-scheduled] no site URL in env — cannot fire background refresh",
    );
    return finish(
      500,
      { error: "Not configured" },
      {
        ok: false,
        errorMessage:
          "no site URL in env (URL / DEPLOY_PRIME_URL / DEPLOY_URL)",
      },
    );
  }

  try {
    const res = await fetch(
      `${base}/.netlify/functions/budget-cache-refresh-background`,
      {
        method: "POST",
        signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "x-scheduled-secret": manualSecret,
        },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok && res.status !== 202) {
      const t = await res.text();
      console.error(
        `[budget-cache-refresh-scheduled] fire non-2xx: ${res.status} ${t.slice(0, 200)}`,
      );
      return finish(
        502,
        { error: "Fire failed" },
        {
          ok: false,
          errorMessage: `background fire returned ${res.status}: ${t.slice(0, 200)}`,
        },
      );
    }
    console.log(
      `[budget-cache-refresh-scheduled] fired background refresh (${res.status})`,
    );
    return finish(200, { ok: true }, { ok: true, errorMessage: null });
  } catch (e) {
    const aborted = e && e.name === "TimeoutError";
    console.error(
      `[budget-cache-refresh-scheduled] fire ${aborted ? "timed out" : "threw"}: ${e?.message || e}`,
    );
    return finish(
      502,
      { error: "Fire failed" },
      {
        ok: false,
        errorMessage: `background fire ${aborted ? "timed out" : "threw"}: ${e?.message || e}`,
      },
    );
  }
};
