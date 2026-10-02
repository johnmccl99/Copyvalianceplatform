import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";
import { sendMail } from "./_ms-mail.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-6";
const MS_APP_SENDER =
  process.env.MS_APP_SENDER ||
  "security-digest@" + (process.env.VALIANCE_MS_DOMAIN || "valiancecap.com");

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

async function fetchOrgInputs(orgId, periodStart, periodEnd) {
  const s = `${periodStart}T00:00:00`;
  const e = `${periodEnd}T23:59:59.999`;

  const [
    auditEvents,
    vendorActivity,
    programCompletions,
    programUpcoming,
    programOverdue,
    rlsFindings,
    sessionActivity,
    exportActivity,
  ] = await Promise.all([
    pg(
      `/audit_log?org_id=eq.${orgId}&timestamp=gte.${s}&timestamp=lte.${e}&select=action,outcome,resource_type,timestamp,metadata&order=timestamp.desc&limit=200`,
    ),
    pg(
      `/security_vendors?org_id=eq.${orgId}&select=id,name,criticality,last_reviewed_at,next_review_at,ai_review_draft,ai_review_generated_at&order=criticality.desc&limit=100`,
    ),
    pg(
      `/security_program_runs?org_id=eq.${orgId}&completed_at=gte.${s}&completed_at=lte.${e}&select=task_id,outcome,evidence_url,completed_at&order=completed_at.desc`,
    ),
    pg(
      `/security_program_tasks?org_id=eq.${orgId}&status=eq.active&next_due_at=gte.${periodEnd}&next_due_at=lte.${addDays(periodEnd, 7)}&select=task_code,title,cadence,next_due_at&order=next_due_at.asc`,
    ),
    pg(
      `/security_program_tasks?org_id=eq.${orgId}&status=eq.active&next_due_at=lt.${periodStart}&select=task_code,title,cadence,next_due_at&order=next_due_at.asc`,
    ),
    pg(
      `/security_rls_drift_findings?detected_at=gte.${s}&detected_at=lte.${e}&select=table_name,policy_name,finding_type,severity,resolved_at&order=detected_at.desc&limit=50`,
    ),
    pg(
      `/user_sessions?org_id=eq.${orgId}&created_at=gte.${s}&created_at=lte.${e}&select=id,end_reason,created_at,ended_at&order=created_at.desc&limit=100`,
    ),
    pg(
      `/export_requests?org_id=eq.${orgId}&created_at=gte.${s}&created_at=lte.${e}&select=dataset_key,status,row_count,file_size_bytes&order=created_at.desc&limit=50`,
    ),
  ]);

  return {
    audit_events: auditEvents.body || [],
    vendors: vendorActivity.body || [],
    program_completions: programCompletions.body || [],
    program_upcoming: programUpcoming.body || [],
    program_overdue: programOverdue.body || [],
    rls_findings: rlsFindings.body || [],
    sessions: sessionActivity.body || [],
    exports: exportActivity.body || [],
  };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function summarizeInputs(inputs) {
  const highlights = [];
  const auth_failures = inputs.audit_events.filter(
    (a) => a.outcome === "denied" || a.outcome === "failure",
  ).length;
  if (auth_failures > 0)
    highlights.push(`${auth_failures} denied / failed events in audit log`);

  const policy_events = inputs.audit_events.filter((a) =>
    /policy|rls|permission/.test(a.action || ""),
  ).length;
  if (policy_events > 0)
    highlights.push(`${policy_events} policy or RLS events`);

  const new_drafts = inputs.vendors.filter(
    (v) => v.ai_review_generated_at,
  ).length;
  if (new_drafts > 0)
    highlights.push(`${new_drafts} vendor AI drafts awaiting triage`);

  if (inputs.program_overdue.length > 0)
    highlights.push(
      `${inputs.program_overdue.length} security program tasks OVERDUE`,
    );
  if (inputs.program_upcoming.length > 0)
    highlights.push(
      `${inputs.program_upcoming.length} security program tasks due in next 7 days`,
    );

  const unresolved_drift = inputs.rls_findings.filter(
    (f) => !f.resolved_at,
  ).length;
  if (unresolved_drift > 0)
    highlights.push(`${unresolved_drift} unresolved RLS drift findings`);

  const force_logouts = inputs.sessions.filter(
    (s) => s.end_reason === "force_logout",
  ).length;
  if (force_logouts > 0)
    highlights.push(`${force_logouts} force-logouts in session log`);

  const denied_exports = inputs.exports.filter(
    (e) => e.status === "denied",
  ).length;
  if (denied_exports > 0)
    highlights.push(`${denied_exports} export requests denied`);

  return {
    counts: {
      total_audit_events: inputs.audit_events.length,
      auth_failures,
      policy_events,
      vendor_ai_drafts: new_drafts,
      program_completed: inputs.program_completions.length,
      program_upcoming: inputs.program_upcoming.length,
      program_overdue: inputs.program_overdue.length,
      rls_findings_unresolved: unresolved_drift,
      sessions_started: inputs.sessions.length,
      sessions_force_logout: force_logouts,
      export_requests: inputs.exports.length,
      exports_denied: denied_exports,
    },
    highlights,
  };
}

async function generateNarrative(summary, periodStart, periodEnd) {
  if (!ANTHROPIC_KEY)
    return `Security digest for ${periodStart} → ${periodEnd}. ${summary.highlights.join(". ") || "No security events of note."}.`;
  const prompt =
    `You are the head of security for a commercial real estate private equity SaaS company. ` +
    `Write a weekly security digest for the CEO + security lead. Period: ${periodStart} to ${periodEnd}. ` +
    `Keep it under 250 words, prose only, no bullets, no emojis. Lead with what changed vs. a normal week. ` +
    `End with the single most important action to take this week.\n\n` +
    `DETERMINISTIC COUNTS + HIGHLIGHTS (cite specific numbers where relevant):\n` +
    JSON.stringify(summary, null, 2);

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.warn(
      "[security-digest-weekly] anthropic error:",
      res.status,
      txt.slice(0, 300),
    );
    return `Security digest for ${periodStart} → ${periodEnd}. AI narrative unavailable (upstream ${res.status}). Key counts: ${JSON.stringify(summary.counts)}.`;
  }
  const body = await res.json();
  return body?.content?.[0]?.text || "(empty)";
}

function renderHtmlEmail(narrative, summary, periodStart, periodEnd) {
  const countsRows = Object.entries(summary.counts)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 8px;color:#555">${k.replace(/_/g, " ")}</td><td style="padding:4px 8px;font-family:monospace">${v}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#222">
<h2 style="margin:0 0 4px">Weekly security digest</h2>
<div style="color:#888;font-size:13px;margin-bottom:18px">${periodStart} → ${periodEnd}</div>
<div style="white-space:pre-wrap;line-height:1.55;font-size:15px">${narrative.replace(/</g, "&lt;")}</div>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
<div style="font-size:12px;color:#555;margin-bottom:6px">Deterministic counts (source of truth):</div>
<table style="border-collapse:collapse;font-size:13px"><tbody>${countsRows}</tbody></table>
<p style="color:#aaa;font-size:11px;margin-top:24px">Auto-generated by security-digest-weekly. Reply to discuss or correct.</p>
</body></html>`;
}

async function fetchAdmins(orgId) {
  const r = await pg(
    `/user_profiles?org_id=eq.${orgId}&is_admin=eq.true&is_active=eq.true&select=email,display_name`,
  );
  if (!r.ok) return [];
  return r.body || [];
}

async function sendEmailViaMsGraph(recipients, subject, html) {
  if (!recipients.length) {
    return { sent: false, reason: "no recipients" };
  }
  const result = await sendMail({
    to: recipients,
    subject,
    html,
    sender: MS_APP_SENDER,
    saveToSentItems: true,
    onTokenError: (status, txt) =>
      console.warn(
        "[security-digest-weekly] client_credentials failed:",
        status,
        txt.slice(0, 300),
      ),
  });
  if (result.sent) return { sent: true };
  if (result.reason === "not_configured") {
    return {
      sent: false,
      reason: "MS_APP_CLIENT_{ID,SECRET} or MS_APP_TENANT_ID not configured",
    };
  }
  return {
    sent: false,
    reason: `ms-graph ${result.status}: ${(result.bodyText || "").slice(0, 300)}`,
  };
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

  const today = new Date();
  const periodEnd = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const periodStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const orgs = await pg(`/organizations?active=not.is.false&select=id,name`);
  if (!orgs.ok) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "fetch orgs failed" }),
    };
  }

  const results = [];
  for (const org of orgs.body || []) {
    try {
      const inputs = await fetchOrgInputs(org.id, periodStart, periodEnd);
      const summary = summarizeInputs(inputs);
      const narrative = await generateNarrative(
        summary,
        periodStart,
        periodEnd,
      );
      const html = renderHtmlEmail(narrative, summary, periodStart, periodEnd);
      const admins = await fetchAdmins(org.id);
      const recipients = admins.map((a) => a.email).filter(Boolean);
      const delivery = await sendEmailViaMsGraph(
        recipients,
        `Weekly security digest — ${periodEnd}`,
        html,
      );

      await pg("/security_digests", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          org_id: org.id,
          period_start: periodStart,
          period_end: periodEnd,
          summary: narrative,
          key_findings: summary.highlights,
          raw_inputs: {
            counts: summary.counts,
            timestamp: new Date().toISOString(),
          },
          sent_to: recipients,
          sent_at: delivery.sent ? new Date().toISOString() : null,
          send_error: delivery.sent ? null : delivery.reason || "unknown",
        }),
      });

      results.push({
        org: org.name,
        sent: delivery.sent,
        recipients: recipients.length,
        highlights: summary.highlights.length,
      });
    } catch (e) {
      console.error(
        `[security-digest-weekly] org ${org.name} failed:`,
        e?.message || e,
      );
      results.push({ org: org.name, error: String(e?.message || e) });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      period_start: periodStart,
      period_end: periodEnd,
      orgs_processed: results.length,
      results,
    }),
  };
};
