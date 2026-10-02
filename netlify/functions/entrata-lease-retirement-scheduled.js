import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";
export { isNetlifyScheduledEvent };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CALL_TIMEOUT_MS = 30_000;

export const MIN_COMPLETE_SWEEPS = 2;

export const PROTECT_SNAPSHOT_REFERENCED = false;

async function pg(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {}
    return { ok: res.ok, status: res.status, body: parsed, raw };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      raw: e?.name === "AbortError" ? "timeout" : String(e?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (event) => {
  const startedAt = new Date().toISOString();

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

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[entrata-lease-retirement-scheduled] env not configured");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const dryRun = process.env.RETIREMENT_APPLY !== "1";

  const rpc = await pg("/rpc/entrata_retire_stale_leases", {
    method: "POST",
    body: {
      p_org: null,
      p_min_complete_sweeps: MIN_COMPLETE_SWEEPS,
      p_dry_run: dryRun,
      p_protect_snapshot_referenced: PROTECT_SNAPSHOT_REFERENCED,
    },
  });

  if (!rpc.ok) {
    console.error(
      `[entrata-lease-retirement-scheduled] rpc failed [${rpc.status}]`,
    );
    return { statusCode: 502, body: JSON.stringify({ ok: false }) };
  }

  const rows = Array.isArray(rpc.body) ? rpc.body : [];
  const summary = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    dry_run: dryRun,
    min_complete_sweeps: MIN_COMPLETE_SWEEPS,
    orgs_evaluated: rows.length,
    total_retired: rows.reduce((n, r) => n + Number(r?.rows_retired || 0), 0),
    per_org: rows.map((r) => ({
      org_id: r?.result_org_id,
      cutoff_run_started: r?.cutoff_run_started,
      complete_sweeps_on_record: r?.complete_sweeps_on_record,
      rows_retired: r?.rows_retired,
      retired_current: r?.retired_current,
      retired_notice: r?.retired_notice,
      retired_null_status: r?.retired_null_status,
      protected_by_snapshot: r?.protected_by_snapshot,
    })),
  };

  console.log(
    `[entrata-lease-retirement-scheduled] ${JSON.stringify(summary)}`,
  );

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
