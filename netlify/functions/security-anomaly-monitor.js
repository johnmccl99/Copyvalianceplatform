import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";
import { getMsAppToken, sendMail } from "./_ms-mail.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MS_APP_SENDER = process.env.MS_APP_SENDER || "";

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

function findBurstWindow(sortedMs, n, spanMs) {
  for (let i = 0; i + n - 1 < sortedMs.length; i++) {
    if (sortedMs[i + n - 1] - sortedMs[i] <= spanMs) return i;
  }
  return -1;
}

async function detectFailedAuthBursts(orgId) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const r = await pg(
    `/audit_log?org_id=eq.${orgId}&action=like.auth.*&outcome=in.(failure,denied)` +
      `&timestamp=gte.${since}&select=id,user_id,action,timestamp,metadata&order=timestamp.desc&limit=500`,
  );
  if (!r.ok || !r.body?.length) return [];

  const byUser = new Map();
  for (const row of r.body) {
    if (!row.user_id) continue;
    const md = row.metadata;
    if (md && md.phase === "mfa_verify" && md.purpose === "stepup") continue;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(new Date(row.timestamp).getTime());
  }
  const findings = [];
  for (const [user_id, timestamps] of byUser) {
    timestamps.sort((a, b) => a - b);
    const at = findBurstWindow(timestamps, 5, 5 * 60 * 1000);
    if (at !== -1) {
      findings.push({
        user_id,
        count: timestamps.length,
        window_minutes: 5,
        first_ts: new Date(timestamps[at]).toISOString(),
      });
    }
  }
  return findings;
}

const SAFE_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const LOOKUP_URL_BUDGET = 3000;

async function resolveEmailsToOrgs(emails) {
  const map = new Map();
  let lookupFailures = 0;
  const safe = emails.filter((e) => SAFE_EMAIL.test(e));

  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const e of safe) {
    const cost = e.length + 3;
    if (current.length && currentLen + cost > LOOKUP_URL_BUDGET) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(e);
    currentLen += cost;
  }
  if (current.length) chunks.push(current);

  for (const chunk of chunks) {
    const list = chunk.map((e) => `"${encodeURIComponent(e)}"`).join(",");
    const r = await pg(`/user_profiles?email=in.(${list})&select=email,org_id`);
    if (!r.ok) {
      lookupFailures += chunk.length;
      console.error(
        "[security-anomaly-monitor] profile lookup failed",
        r.status,
        (r.raw || "").slice(0, 200),
      );
      continue;
    }
    for (const p of r.body || []) {
      if (p.email && p.org_id) map.set(String(p.email).toLowerCase(), p.org_id);
    }
  }
  return { map, lookupFailures };
}

async function detectPreauthFailedAuthBursts() {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const r = await pg(
    `/audit_log?user_id=is.null&action=eq.auth.sign_in.failure` +
      `&timestamp=gte.${since}&select=id,timestamp,outcome,metadata` +
      `&order=timestamp.desc&limit=2000`,
  );
  if (!r.ok || !r.body?.length)
    return { findings: [], unattributed: 0, skipped: 0 };

  const byEmail = new Map();
  let skipped = 0;
  for (const row of r.body) {
    const email = row?.metadata?.email;
    if (!email || typeof email !== "string") {
      skipped++;
      continue;
    }
    const key = email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(new Date(row.timestamp).getTime());
  }
  if (!byEmail.size)
    return { findings: [], unattributed: 0, skipped, lookupFailures: 0 };

  const { map: orgByEmail, lookupFailures } = await resolveEmailsToOrgs([
    ...byEmail.keys(),
  ]);

  const findings = [];
  let unattributed = 0;

  const sprayCandidates = new Map();
  for (const [email, stamps] of byEmail) {
    stamps.sort((a, b) => a - b);
    const orgId = orgByEmail.get(email);
    if (!orgId) {
      unattributed++;
      continue;
    }

    if (stamps.length >= 2) {
      if (!sprayCandidates.has(orgId)) sprayCandidates.set(orgId, []);
      sprayCandidates.get(orgId).push({ email, firstMs: stamps[0] });
    }

    const at = findBurstWindow(stamps, 5, 5 * 60 * 1000);
    if (at !== -1) {
      findings.push({
        org_id: orgId,
        type: "targeted",
        email,
        count: stamps.length,
        window_minutes: 5,
        first_ts: new Date(stamps[at]).toISOString(),
      });
    }
  }

  for (const [orgId, entries] of sprayCandidates) {
    const firsts = entries.map((e) => e.firstMs).sort((a, b) => a - b);
    const at = findBurstWindow(firsts, 5, 15 * 60 * 1000);
    if (at === -1) continue;
    const lo = firsts[at];
    const hi = firsts[at] + 15 * 60 * 1000;
    const hit = entries.filter((e) => e.firstMs >= lo && e.firstMs <= hi);
    findings.push({
      org_id: orgId,
      type: "spray",
      distinct_accounts: hit.length,
      window_minutes: 15,
      first_ts: new Date(lo).toISOString(),
    });
  }

  return { findings, unattributed, skipped, lookupFailures };
}

const PRIVILEGE_ACTIONS = [
  "user.role_changed",
  "user.deactivated",
  "user.invited",
  "auth.mfa.disabled",
  "auth.session.force_logout",
  "admin.settings.changed",
  "admin.org.configured",
  "data.export.approved",
  "data.export.denied",
  "RESET_ORG_DATA",
  "FEATURE_FLAG_UPDATE",
];

const SYSTEM_ACTOR = "__system__";

async function detectPrivilegeBursts(orgId) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const actionList = PRIVILEGE_ACTIONS.map((a) => `"${a}"`).join(",");
  const r = await pg(
    `/audit_log?org_id=eq.${orgId}&action=in.(${actionList})` +
      `&timestamp=gte.${since}&select=id,user_id,action,timestamp&order=timestamp.desc&limit=500`,
  );
  if (!r.ok || !r.body?.length) return [];

  const byUser = new Map();
  for (const row of r.body) {
    const key = row.user_id || SYSTEM_ACTOR;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(row);
  }
  const findings = [];
  for (const [key, rows] of byUser) {
    if (rows.length >= 3) {
      findings.push({
        user_id: key === SYSTEM_ACTOR ? null : key,
        actor: key === SYSTEM_ACTOR ? "system" : "user",
        count: rows.length,
        window_minutes: 60,
        actions: [...new Set(rows.map((row) => row.action))],
      });
    }
  }
  return findings;
}

async function detectMassExports(orgId) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const r = await pg(
    `/export_audit_log?org_id=eq.${orgId}&action=eq.completed&created_at=gte.${since}` +
      `&select=id,user_id,row_count,file_size_bytes,created_at`,
  );
  if (!r.ok || !r.body?.length) return [];

  const findings = [];
  const byUser = new Map();
  for (const row of r.body) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }
  for (const [user_id, rows] of byUser) {
    if (rows.length >= 10) {
      findings.push({
        user_id,
        count: rows.length,
        type: "count",
        total_rows: rows.reduce((s, r) => s + (r.row_count || 0), 0),
      });
    }
  }
  for (const row of r.body) {
    if ((row.row_count || 0) >= 1_000_000) {
      findings.push({
        user_id: row.user_id,
        export_id: row.id,
        type: "size",
        row_count: row.row_count,
        file_size_bytes: row.file_size_bytes,
      });
    }
  }
  return findings;
}

async function detectSessionAnomalies(orgId) {
  const r = await pg(
    `/v_session_anomalies?org_id=eq.${orgId}&select=anomaly_type,subject_id,description,evidence`,
  );
  if (!r.ok || !r.body?.length) return [];
  return r.body;
}

async function detectRlsDriftCritical(orgId) {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const r = await pg(
    `/security_rls_drift_findings?severity=eq.critical&resolved_at=is.null` +
      `&detected_at=lt.${cutoff}` +
      `&select=id,table_name,policy_name,finding_type,detected_at`,
  );
  if (!r.ok) return [];
  return r.body || [];
}

async function detectAuditChainBreak(orgId) {
  const r = await rpc("audit_log_verify_chain", {
    p_org_id: orgId,
    p_limit: 5000,
  });
  if (!r.ok) return [];
  const row = Array.isArray(r.body) ? r.body[0] : r.body;
  if (row && row.ok === false) {
    return [
      {
        first_bad_id: row.first_bad_id,
        reason: row.reason,
        rows_checked: row.rows_checked,
      },
    ];
  }
  return [];
}

async function fetchOrgAdminEmails(orgId) {
  const r = await pg(
    `/user_profiles?org_id=eq.${orgId}&is_admin=eq.true&is_active=eq.true&select=email,display_name`,
  );
  if (!r.ok) {
    console.error(
      "[security-anomaly-monitor] admin recipient lookup failed",
      r.status,
      (r.raw || "").slice(0, 200),
    );
    return [];
  }
  return (r.body || []).map((p) => ({
    email: p.email,
    name: p.display_name || p.email,
  }));
}

async function sendAlertEmail(orgId, anomalies) {
  const token = await getMsAppToken();
  if (!token || !MS_APP_SENDER) {
    console.warn(
      "[security-anomaly-monitor] MS Graph not configured; skipping email",
    );
    return { sent: false, reason: "ms_graph_not_configured" };
  }
  const recipients = await fetchOrgAdminEmails(orgId);
  if (!recipients.length) {
    console.warn(
      "[security-anomaly-monitor] No admin recipients for org",
      orgId,
    );
    return { sent: false, reason: "no_recipients" };
  }
  const highOrCritical = anomalies.filter(
    (a) => a.severity === "high" || a.severity === "critical",
  );
  if (!highOrCritical.length)
    return { sent: false, reason: "no_high_severity" };

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
      <h2 style="color: ${highOrCritical.some((a) => a.severity === "critical") ? "#dc2626" : "#ea580c"}; margin: 0 0 8px 0;">
        ${highOrCritical.some((a) => a.severity === "critical") ? "⚠ Critical" : "⚠ High-Severity"} Security Anomaly Detected
      </h2>
      <p style="color: #4b5563;">
        ${highOrCritical.length} new ${highOrCritical.length === 1 ? "anomaly" : "anomalies"}
        detected by the SIEM monitor at ${new Date().toISOString()}.
      </p>
      <table style="border-collapse: collapse; width: 100%; font-size: 13px;">
        <thead>
          <tr style="background: #f3f4f6; text-align: left;">
            <th style="padding: 8px; border: 1px solid #e5e7eb;">Severity</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb;">Detector</th>
            <th style="padding: 8px; border: 1px solid #e5e7eb;">Description</th>
          </tr>
        </thead>
        <tbody>
          ${highOrCritical
            .map(
              (a) => `
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e7eb; color: ${a.severity === "critical" ? "#dc2626" : "#ea580c"}; font-weight: 600; text-transform: uppercase;">${a.severity}</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">${a.detector}</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">${a.title}<br/><span style="color: #6b7280; font-size: 12px;">${a.description}</span></td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      <p style="margin-top: 16px; color: #4b5563; font-size: 13px;">
        <strong>Action:</strong> Open Admin Console → Security Program → Anomalies to triage.
      </p>
      <p style="color: #9ca3af; font-size: 11px; margin-top: 32px;">
        Generated by security-anomaly-monitor (Netlify scheduled function).
        This email is sent for HIGH and CRITICAL anomalies only.
      </p>
    </div>
  `;

  const subject = `[Security Alert] ${highOrCritical.length} ${highOrCritical.some((a) => a.severity === "critical") ? "critical" : "high"}-severity anomal${highOrCritical.length === 1 ? "y" : "ies"} detected`;
  const result = await sendMail({
    to: recipients.map((r) => ({ address: r.email, name: r.name })),
    subject,
    html,
    sender: MS_APP_SENDER,
    saveToSentItems: "false",
  });
  if (!result.sent) {
    const failureTag =
      result.status != null ? String(result.status) : result.reason || "failed";
    console.warn(
      "[security-anomaly-monitor] sendMail failed",
      failureTag,
      (result.bodyText || "").slice(0, 300),
    );
    return { sent: false, reason: `sendMail_${failureTag}` };
  }
  return { sent: true, recipients: recipients.map((r) => r.email) };
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
    console.error("[security-anomaly-monitor] missing env");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "env not configured" }),
    };
  }

  const orgsRes = await pg(
    `/organizations?subscription_status=in.(active,trial)&select=id,name`,
  );
  if (!orgsRes.ok) {
    console.error(
      "[security-anomaly-monitor] org listing failed",
      orgsRes.status,
      (orgsRes.raw || "").slice(0, 200),
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "org listing failed" }),
    };
  }
  const orgs = orgsRes.body || [];

  const summary = { startedAt, orgs: [], total_anomalies: 0, emails_sent: 0 };

  const preauth = await detectPreauthFailedAuthBursts();
  const preauthByOrg = new Map();
  for (const f of preauth.findings) {
    if (!preauthByOrg.has(f.org_id)) preauthByOrg.set(f.org_id, []);
    preauthByOrg.get(f.org_id).push(f);
  }
  summary.preauth = {
    findings: preauth.findings.length,
    unattributed_addresses: preauth.unattributed,
    rows_without_identifier: preauth.skipped,
    profile_lookup_failures: preauth.lookupFailures,
    dropped_inactive_org: preauth.findings.filter(
      (f) => !orgs.some((o) => o.id === f.org_id),
    ).length,
  };

  for (const org of orgs) {
    const orgId = org.id;
    const orgAnomalies = [];

    const [failedBursts, privBursts, exports, sessions, rlsDrift, chainBreak] =
      await Promise.all([
        detectFailedAuthBursts(orgId),
        detectPrivilegeBursts(orgId),
        detectMassExports(orgId),
        detectSessionAnomalies(orgId),
        detectRlsDriftCritical(orgId),
        detectAuditChainBreak(orgId),
      ]);

    for (const f of failedBursts) {
      const r = await rpc("security_anomaly_upsert", {
        p_org_id: orgId,
        p_detector: "failed_auth_burst",
        p_severity: "high",
        p_subject_type: "user",
        p_subject_id: f.user_id,
        p_title: "Repeated authentication failures",
        p_description: `${f.count} failed-auth events for this user in the past hour (≥5 in 5-min window)`,
        p_evidence: f,
        p_dedupe_window: "hour",
      });
      if (r.ok && r.body)
        orgAnomalies.push({
          ...r.body[0],
          severity: "high",
          detector: "failed_auth_burst",
          title: "Repeated authentication failures",
          description: `${f.count} failed events`,
        });
    }
    for (const f of preauthByOrg.get(orgId) || []) {
      const targeted = f.type === "targeted";
      const title = targeted
        ? "Repeated failed sign-ins against one account"
        : "Failed sign-ins across multiple accounts";
      const description = targeted
        ? `${f.count} pre-authentication sign-in failures against a single account in the past hour (>=5 within 5 minutes)`
        : `${f.distinct_accounts} distinct accounts in this org saw pre-authentication sign-in failures within 15 minutes`;
      const r = await rpc("security_anomaly_upsert", {
        p_org_id: orgId,
        p_detector: "preauth_failed_auth_burst",
        p_severity: "medium",
        p_subject_type: targeted ? "email" : "org",
        p_subject_id: targeted ? f.email : orgId,
        p_title: title,
        p_description: description,
        p_evidence: f,
        p_dedupe_window: "hour",
      });
      if (r.ok && r.body)
        orgAnomalies.push({
          ...r.body[0],
          severity: "medium",
          detector: "preauth_failed_auth_burst",
          title,
          description,
        });
    }
    for (const f of privBursts) {
      const r = await rpc("security_anomaly_upsert", {
        p_org_id: orgId,
        p_detector: "privilege_burst",
        p_severity: "high",
        p_subject_type: f.actor === "system" ? "org" : "user",
        p_subject_id: f.actor === "system" ? null : f.user_id,
        p_title: "Privilege-event burst",
        p_description: `${f.count} privilege/admin actions in 1 hour: ${f.actions.slice(0, 5).join(", ")}`,
        p_evidence: f,
        p_dedupe_window: "hour",
      });
      if (r.ok && r.body)
        orgAnomalies.push({
          ...r.body[0],
          severity: "high",
          detector: "privilege_burst",
          title: "Privilege-event burst",
          description: `${f.count} privilege actions`,
        });
    }
    for (const f of exports) {
      const r = await rpc("security_anomaly_upsert", {
        p_org_id: orgId,
        p_detector: "mass_export",
        p_severity: "high",
        p_subject_type: "user",
        p_subject_id: f.user_id,
        p_title: f.type === "size" ? "Large export" : "High export volume",
        p_description:
          f.type === "size"
            ? `Single export ≥1M rows (${f.row_count.toLocaleString()})`
            : `${f.count} exports in 1 hour, totaling ${f.total_rows.toLocaleString()} rows`,
        p_evidence: f,
        p_dedupe_window: "hour",
      });
      if (r.ok && r.body)
        orgAnomalies.push({
          ...r.body[0],
          severity: "high",
          detector: "mass_export",
          title: "Mass export",
          description: "see DB",
        });
    }
    for (const f of sessions) {
      const sev = f.anomaly_type === "concurrent_sessions" ? "medium" : "low";
      const r = await rpc("security_anomaly_upsert", {
        p_org_id: orgId,
        p_detector: f.anomaly_type,
        p_severity: sev,
        p_subject_type: "session",
        p_subject_id: f.subject_id,
        p_title:
          f.anomaly_type === "concurrent_sessions"
            ? "Concurrent session policy breach"
            : "Idle session timeout breach",
        p_description: f.description,
        p_evidence: f.evidence,
        p_dedupe_window: "hour",
      });
      if (r.ok && r.body)
        orgAnomalies.push({
          ...r.body[0],
          severity: sev,
          detector: f.anomaly_type,
          title: "session anomaly",
          description: f.description,
        });
    }
    for (const f of rlsDrift) {
      const r = await rpc("security_anomaly_upsert", {
        p_org_id: orgId,
        p_detector: "rls_drift_critical",
        p_severity: "high",
        p_subject_type: "rls_policy",
        p_subject_id: `${f.table_name}.${f.policy_name}`,
        p_title: "Critical RLS drift unresolved",
        p_description: `Critical drift on ${f.table_name}.${f.policy_name} (${f.finding_type}) detected ${f.detected_at}`,
        p_evidence: f,
        p_dedupe_window: "day",
      });
      if (r.ok && r.body)
        orgAnomalies.push({
          ...r.body[0],
          severity: "high",
          detector: "rls_drift_critical",
          title: "Critical RLS drift",
          description: "see DB",
        });
    }
    for (const f of chainBreak) {
      const r = await rpc("security_anomaly_upsert", {
        p_org_id: orgId,
        p_detector: "audit_chain_break",
        p_severity: "critical",
        p_subject_type: "audit_chain",
        p_subject_id: String(f.first_bad_id),
        p_title: "Audit log integrity violation",
        p_description: `Hash chain broken at audit_log id=${f.first_bad_id}: ${f.reason}`,
        p_evidence: f,
        p_dedupe_window: "day",
      });
      if (r.ok && r.body)
        orgAnomalies.push({
          ...r.body[0],
          severity: "critical",
          detector: "audit_chain_break",
          title: "Audit log integrity violation",
          description: f.reason,
        });
    }

    let emailRes = { sent: false };
    const newHighCrit = orgAnomalies.filter(
      (a) => a.was_new && (a.severity === "high" || a.severity === "critical"),
    );
    if (newHighCrit.length > 0) {
      emailRes = await sendAlertEmail(orgId, orgAnomalies);
      if (emailRes.sent) {
        for (const a of newHighCrit) {
          await pg(`/security_anomalies?id=eq.${a.anomaly_id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              email_sent_at: new Date().toISOString(),
              email_recipients: emailRes.recipients,
            }),
          });
        }
      }
    }

    summary.orgs.push({
      org_id: orgId,
      org_name: org.name,
      anomalies_upserted: orgAnomalies.length,
      new_high_critical: newHighCrit.length,
      email_sent: emailRes.sent,
    });
    summary.total_anomalies += orgAnomalies.length;
    if (emailRes.sent) summary.emails_sent += 1;
  }

  summary.completedAt = new Date().toISOString();
  console.log("[security-anomaly-monitor]", JSON.stringify(summary));

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
