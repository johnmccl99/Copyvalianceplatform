import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function pg(path, init = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init.headers || {}),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body, raw: text };
}

async function rpc(name, params) {
  return pg(`/rpc/${name}`, { method: "POST", body: JSON.stringify(params) });
}

export const handler = async (event) => {
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

  const startedAt = new Date().toISOString();
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "env not configured" }),
    };
  }

  const archiveRes = await rpc("audit_log_archive_old", {
    p_retention_days: 730,
  });
  const archive = Array.isArray(archiveRes.body)
    ? archiveRes.body[0]
    : archiveRes.body;

  const purgeRes = await rpc("audit_log_archive_purge", {
    p_purge_after_days: 2555,
  });
  const purge = Array.isArray(purgeRes.body) ? purgeRes.body[0] : purgeRes.body;

  const summary = {
    startedAt,
    completedAt: new Date().toISOString(),
    archive: archiveRes.ok ? archive : { error: archiveRes.raw?.slice(0, 300) },
    purge: purgeRes.ok ? purge : { error: purgeRes.raw?.slice(0, 300) },
  };

  console.log("[security-audit-log-archive-monthly]", JSON.stringify(summary));

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
