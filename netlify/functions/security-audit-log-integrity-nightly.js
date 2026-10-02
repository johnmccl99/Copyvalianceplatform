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

  const orgs = await pg(
    `/organizations?subscription_status=in.(active,trial)&select=id,name`,
  );
  const summary = { startedAt, orgs: [], chains_ok: 0, chains_broken: 0 };

  for (const org of orgs.body || []) {
    const verify = await rpc("audit_log_verify_chain", {
      p_org_id: org.id,
      p_limit: 10_000_000,
    });
    const result = Array.isArray(verify.body) ? verify.body[0] : verify.body;

    if (!verify.ok) {
      summary.orgs.push({ org_id: org.id, error: verify.raw?.slice(0, 300) });
      continue;
    }

    if (result?.ok === true) {
      summary.chains_ok += 1;
      summary.orgs.push({
        org_id: org.id,
        org_name: org.name,
        ok: true,
        rows_checked: result.rows_checked,
      });
    } else {
      summary.chains_broken += 1;
      summary.orgs.push({
        org_id: org.id,
        org_name: org.name,
        ok: false,
        first_bad_id: result.first_bad_id,
        reason: result.reason,
      });
      await rpc("security_anomaly_upsert", {
        p_org_id: org.id,
        p_detector: "audit_chain_break",
        p_severity: "critical",
        p_subject_type: "audit_chain",
        p_subject_id: String(result.first_bad_id),
        p_title: "Audit log integrity violation (nightly verification)",
        p_description: `Hash chain broken at audit_log id=${result.first_bad_id}: ${result.reason}. Detected by nightly full-chain verifier.`,
        p_evidence: result,
        p_dedupe_window: "day",
      });
    }
  }

  summary.completedAt = new Date().toISOString();
  console.log(
    "[security-audit-log-integrity-nightly]",
    JSON.stringify(summary),
  );

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
