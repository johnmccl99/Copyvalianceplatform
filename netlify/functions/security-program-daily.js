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

async function fetchDueAndOverdue() {
  const today = new Date();
  const horizon = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const todayStr = today.toISOString().slice(0, 10);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const due = await pg(
    `/security_program_tasks?status=eq.active` +
      `&next_due_at=gte.${todayStr}` +
      `&next_due_at=lte.${horizonStr}` +
      `&select=id,org_id,task_code,title,cadence,next_due_at,escalation_threshold_days,control_refs`,
  );

  const overdue = await pg(
    `/security_program_tasks?status=eq.active` +
      `&next_due_at=lt.${todayStr}` +
      `&select=id,org_id,task_code,title,cadence,next_due_at,escalation_threshold_days,control_refs`,
  );

  return {
    due: due.ok ? due.body || [] : [],
    overdue: overdue.ok ? overdue.body || [] : [],
  };
}

function daysBetween(dateStr, todayDate) {
  const d = new Date(dateStr + "T00:00:00Z");
  return Math.floor(
    (todayDate.getTime() - d.getTime()) / (24 * 60 * 60 * 1000),
  );
}

async function logAuditEvent({
  orgId,
  action,
  resourceType,
  resourceId,
  resourceName,
  outcome,
  metadata,
}) {
  return pg("/audit_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      org_id: orgId,
      user_id: null,
      user_email: "system@security-program-daily",
      user_role: "system",
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      resource_name: resourceName,
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
    console.error(
      "[security-program-daily] misconfigured: missing SERVICE_KEY or SUPABASE_URL",
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const startedAt = new Date();
  const { due, overdue } = await fetchDueAndOverdue();
  console.log(
    `[security-program-daily] due_soon=${due.length} overdue=${overdue.length}`,
  );

  const results = {
    due_soon_logged: 0,
    overdue_logged: 0,
    escalated: 0,
    errors: [],
  };

  for (const t of due) {
    try {
      const days_until_due = daysBetween(t.next_due_at, startedAt) * -1;
      await logAuditEvent({
        orgId: t.org_id,
        action: "security_program.task_due_soon",
        resourceType: "security_program_task",
        resourceId: t.id,
        resourceName: t.title,
        outcome: "success",
        metadata: {
          task_code: t.task_code,
          cadence: t.cadence,
          next_due_at: t.next_due_at,
          days_until_due,
          control_refs: t.control_refs,
        },
      });
      results.due_soon_logged += 1;
    } catch (e) {
      results.errors.push(`due ${t.task_code}: ${e.message || e}`);
    }
  }

  for (const t of overdue) {
    try {
      const days_overdue = daysBetween(t.next_due_at, startedAt);
      const should_escalate =
        days_overdue >= (t.escalation_threshold_days || 0);
      await logAuditEvent({
        orgId: t.org_id,
        action: should_escalate
          ? "security_program.task_escalated"
          : "security_program.task_overdue",
        resourceType: "security_program_task",
        resourceId: t.id,
        resourceName: t.title,
        outcome: should_escalate ? "failure" : "success",
        metadata: {
          task_code: t.task_code,
          cadence: t.cadence,
          next_due_at: t.next_due_at,
          days_overdue,
          escalation_threshold_days: t.escalation_threshold_days || 0,
          escalated: should_escalate,
          control_refs: t.control_refs,
        },
      });
      results.overdue_logged += 1;
      if (should_escalate) results.escalated += 1;
    } catch (e) {
      results.errors.push(`overdue ${t.task_code}: ${e.message || e}`);
    }
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  console.log(`[security-program-daily] done in ${elapsedMs}ms`, results);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      started_at: startedAt.toISOString(),
      elapsed_ms: elapsedMs,
      ...results,
    }),
  };
};
