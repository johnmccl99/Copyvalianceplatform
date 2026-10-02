import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOLDEN_MANIFEST = [
  { table: "user_profiles", policy: "user_profiles_select_own", cmd: "SELECT" },
  { table: "user_profiles", policy: "user_profiles_select_org", cmd: "SELECT" },

  {
    table: "organizations",
    policy: "organizations_select_self",
    cmd: "SELECT",
  },

  { table: "audit_log", policy: "rls_audit_log_insert", cmd: "INSERT" },
  { table: "audit_log", policy: "rls_audit_log_select", cmd: "SELECT" },

  {
    table: "security_vendors",
    policy: "security_vendors_select_org_members",
    cmd: "SELECT",
  },
  {
    table: "security_vendors",
    policy: "security_vendors_insert_admin",
    cmd: "INSERT",
  },
  {
    table: "security_vendors",
    policy: "security_vendors_update_admin",
    cmd: "UPDATE",
  },
  {
    table: "security_vendors",
    policy: "security_vendors_delete_admin",
    cmd: "DELETE",
  },

  {
    table: "security_program_tasks",
    policy: "security_program_tasks_select_members",
    cmd: "SELECT",
  },
  {
    table: "security_program_tasks",
    policy: "security_program_tasks_write_admin",
    cmd: "ALL",
  },

  {
    table: "security_program_runs",
    policy: "security_program_runs_select_members",
    cmd: "SELECT",
  },
  {
    table: "security_program_runs",
    policy: "security_program_runs_insert_admin",
    cmd: "INSERT",
  },

  { table: "connectors", policy: "rls_connectors_select", cmd: "SELECT" },
  {
    table: "org_dropbox_accounts",
    policy: "org_dropbox_accounts_select_org",
    cmd: "SELECT",
  },
  {
    table: "org_plaid_items",
    policy: "rls_org_plaid_items_select_org",
    cmd: "SELECT",
  },
  {
    table: "org_qb_integrations",
    policy: "rls_org_qb_integrations_select",
    cmd: "SELECT",
  },

  {
    table: "session_policies",
    policy: "rls_session_policies_select_org",
    cmd: "SELECT",
  },
  {
    table: "user_sessions",
    policy: "rls_user_sessions_select_own",
    cmd: "SELECT",
  },
  {
    table: "ip_allowlist",
    policy: "rls_ip_allowlist_select_org",
    cmd: "SELECT",
  },
  {
    table: "ip_access_policy",
    policy: "rls_ip_access_policy_select_org",
    cmd: "SELECT",
  },

  {
    table: "export_policies",
    policy: "rls_export_policies_select_org",
    cmd: "SELECT",
  },
  {
    table: "export_requests",
    policy: "rls_export_requests_select_org",
    cmd: "SELECT",
  },
  {
    table: "export_audit_log",
    policy: "rls_export_audit_log_select_admin",
    cmd: "SELECT",
  },

  {
    table: "property_underwriting_unit_mix",
    policy: "rls_property_underwriting_unit_mix_select",
    cmd: "SELECT",
  },
  {
    table: "property_underwriting_waterfall_tiers",
    policy: "rls_property_underwriting_waterfall_tiers_select",
    cmd: "SELECT",
  },
  {
    table: "property_underwriting_debt_schedule",
    policy: "rls_property_underwriting_debt_schedule_select",
    cmd: "SELECT",
  },
];

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

async function fetchLivePolicies() {
  const r = await pg("/rpc/list_rls_policies", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`list_rls_policies failed: ${r.status} ${r.raw}`);
  return r.body || [];
}

async function insertFinding(finding) {
  return pg("/security_rls_drift_findings", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(finding),
  });
}

async function logAudit(action, metadata, outcome = "success") {
  return pg("/audit_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      org_id: null,
      user_email: "system@security-rls-drift-nightly",
      user_role: "system",
      action,
      resource_type: "rls_policy",
      outcome,
      metadata,
    }),
  });
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

  if (!SERVICE_KEY || !SUPABASE_URL) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const startedAt = new Date();
  let live = [];
  try {
    live = await fetchLivePolicies();
  } catch (e) {
    console.error(
      "[security-rls-drift-nightly] fetch failed:",
      e?.message || e,
    );
    await logAudit(
      "security_program.rls_drift_scan_failed",
      { error: String(e?.message || e) },
      "failure",
    );
    return { statusCode: 500, body: JSON.stringify({ error: "fetch failed" }) };
  }

  const liveByKey = new Map();
  for (const p of live) {
    liveByKey.set(`${p.table_name}.${p.policy_name}`, p);
  }

  const findings = [];

  for (const exp of GOLDEN_MANIFEST) {
    const key = `${exp.table}.${exp.policy}`;
    if (!liveByKey.has(key)) {
      findings.push({
        schema_name: "public",
        table_name: exp.table,
        policy_name: exp.policy,
        finding_type: "missing_policy",
        severity: "critical",
        expected: { cmd: exp.cmd },
        actual: null,
      });
    }
  }

  const manifestTables = new Set(GOLDEN_MANIFEST.map((m) => m.table));
  const manifestKeys = new Set(
    GOLDEN_MANIFEST.map((m) => `${m.table}.${m.policy}`),
  );
  for (const p of live) {
    if (!manifestTables.has(p.table_name)) continue;
    const key = `${p.table_name}.${p.policy_name}`;
    if (manifestKeys.has(key)) continue;
    findings.push({
      schema_name: p.schema_name,
      table_name: p.table_name,
      policy_name: p.policy_name,
      finding_type: "extra_policy",
      severity: "medium",
      expected: null,
      actual: {
        cmd: p.cmd,
        permissive: p.permissive,
        roles: p.roles,
        qual: p.qual,
        with_check: p.with_check,
      },
    });
  }

  const persistedErrors = [];
  for (const f of findings) {
    const r = await insertFinding(f);
    if (!r.ok)
      persistedErrors.push(
        `${f.table_name}.${f.policy_name}: ${r.status} ${r.raw.slice(0, 200)}`,
      );
  }

  await logAudit(
    "security_program.rls_drift_scan_completed",
    {
      findings_count: findings.length,
      missing: findings.filter((f) => f.finding_type === "missing_policy")
        .length,
      extra: findings.filter((f) => f.finding_type === "extra_policy").length,
      persist_errors: persistedErrors.length,
      elapsed_ms: Date.now() - startedAt.getTime(),
    },
    findings.length > 0 ? "failure" : "success",
  );

  console.log(
    `[security-rls-drift-nightly] findings=${findings.length} persist_errors=${persistedErrors.length}`,
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      started_at: startedAt.toISOString(),
      elapsed_ms: Date.now() - startedAt.getTime(),
      manifest_size: GOLDEN_MANIFEST.length,
      live_policies: live.length,
      findings_count: findings.length,
      persist_errors: persistedErrors,
    }),
  };
};
