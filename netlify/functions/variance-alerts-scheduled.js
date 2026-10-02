import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";
import { sendMail } from "./_ms-mail.js";
import { classifyMateriality } from "../../src/lib/varianceMateriality.js";
import {
  resolveVarianceAlertConfig,
  resolveAlertRecipients,
} from "../../src/lib/varianceAlertConfig.js";
import { isBalanceClassAccount } from "../../src/lib/glAccountClass.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.URL ||
  "https://credashboardproperty.netlify.app";

const FETCH_TIMEOUT_MS = 10_000;
const SOFT_DEADLINE_MS = 25_000;
const EVALUATION_MARKER_KEY = "__evaluation__";
const STATE_CONFLICT_COLS =
  "org_id,property_code,month_end,group_key,account_number";

async function pg(path, init = {}) {
  const { expectStatuses = [], ...rest } = init;
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(rest.headers || {}),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...rest,
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok && !expectStatuses.includes(res.status)) {
    console.error(
      `[variance-alerts-scheduled] supabase ${rest.method || "GET"} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return { ok: res.ok, status: res.status, body, raw: text };
}

export const FLAG_RANK = Object.freeze({ none: 0, orange: 1, red: 2 });

export function transitionKind(prevFlag, nextFlag) {
  const prev = FLAG_RANK[prevFlag] ?? 0;
  const next = FLAG_RANK[nextFlag] ?? 0;
  if (next > prev) return "breach";
  if (next < prev) return "recovery";
  return null;
}

function stateKeyOf(groupKey, accountNumber) {
  return `${groupKey}\u0000${accountNumber == null ? "" : accountNumber}`;
}

export function groupKeyForClassifiedGroup(group) {
  if (
    group.noi_build_bucket != null &&
    String(group.noi_build_bucket).trim() !== ""
  ) {
    return String(group.noi_build_bucket);
  }
  return `__singleton__:${group.accounts?.[0]?.account_number}`;
}

export { isBalanceClassAccount };

export function scopeToOperatingBudgeted(rows) {
  const budgetByAcct = new Map();
  for (const r of rows || []) {
    if (!r || r.account_number == null) continue;
    const b = Number(r.budget_amount ?? r.budget);
    budgetByAcct.set(
      r.account_number,
      (budgetByAcct.get(r.account_number) || 0) + (Number.isFinite(b) ? b : 0),
    );
  }
  return (rows || []).filter((r) => {
    if (!r || r.account_number == null) return false;
    if (isBalanceClassAccount(r.account_number)) return false;
    return (budgetByAcct.get(r.account_number) || 0) !== 0;
  });
}

export function selectBasisRows(rows, basis) {
  const closedMonths = [
    ...new Set(
      (rows || []).filter((r) => r && r.has_gl_actual).map((r) => r.month_end),
    ),
  ].sort();
  if (!closedMonths.length)
    return { monthEnd: null, basisRows: [], closedMonths };
  const monthEnd = closedMonths[closedMonths.length - 1];
  if (basis === "monthly") {
    return {
      monthEnd,
      basisRows: (rows || []).filter((r) => r && r.month_end === monthEnd),
      closedMonths,
    };
  }
  const closedSet = new Set(closedMonths);
  return {
    monthEnd,
    basisRows: (rows || []).filter((r) => r && closedSet.has(r.month_end)),
    closedMonths,
  };
}

export function applyDollarFloor(
  classification,
  { accountDollarFloor = 0, groupDollarFloor = 0 } = {},
) {
  const acctFloor =
    Number.isFinite(accountDollarFloor) && accountDollarFloor > 0
      ? accountDollarFloor
      : 0;
  const grpFloor =
    Number.isFinite(groupDollarFloor) && groupDollarFloor > 0
      ? groupDollarFloor
      : 0;
  const byAccount = new Map();
  const byGroup = new Map();
  const groups = (classification?.groups || []).map((g) => {
    const groupKey = groupKeyForClassifiedGroup(g);
    const groupFlag =
      g.flag && Math.abs(Number(g.variance) || 0) >= grpFloor ? g.flag : null;
    byGroup.set(groupKey, groupFlag);
    const accounts = (g.accounts || []).map((a) => {
      const flag =
        a.flag && Math.abs(Number(a.variance) || 0) >= acctFloor
          ? a.flag
          : null;
      byAccount.set(a.account_number, flag);
      return { ...a, flag };
    });
    return { ...g, flag: groupFlag, accounts };
  });
  return { groups, byAccount, byGroup };
}

export function computeTransitions({ classification, stateRows }) {
  const prevByKey = new Map();
  for (const r of stateRows || []) {
    if (!r || r.group_key === EVALUATION_MARKER_KEY) continue;
    prevByKey.set(stateKeyOf(r.group_key, r.account_number), r);
  }

  const current = [];
  for (const g of classification?.groups || []) {
    const groupKey = groupKeyForClassifiedGroup(g);
    const groupLabel =
      g.noi_build_bucket != null && String(g.noi_build_bucket).trim() !== ""
        ? String(g.noi_build_bucket)
        : g.accounts?.[0]?.account_name ||
          String(g.accounts?.[0]?.account_number ?? groupKey);
    current.push({
      groupKey,
      accountNumber: null,
      label: groupLabel,
      flag: g.flag || "none",
      pct: g.pct ?? null,
    });
    for (const a of g.accounts || []) {
      current.push({
        groupKey,
        accountNumber: String(a.account_number),
        label: a.account_name
          ? `${a.account_name} (${a.account_number})`
          : String(a.account_number),
        flag: a.flag || "none",
        pct: a.pct ?? null,
      });
    }
  }

  const transitions = [];
  const statesToWrite = [];
  const seen = new Set();

  for (const c of current) {
    const key = stateKeyOf(c.groupKey, c.accountNumber);
    seen.add(key);
    const prev = prevByKey.get(key);
    const prevFlag = prev ? prev.flag : "none";
    const kind = transitionKind(prevFlag, c.flag);
    if (kind) {
      transitions.push({
        kind,
        scope: c.accountNumber == null ? "group" : "account",
        groupKey: c.groupKey,
        accountNumber: c.accountNumber,
        label: c.label,
        from: prevFlag,
        to: c.flag,
        pct: c.pct,
      });
    }
    if (kind || prev) {
      statesToWrite.push({
        groupKey: c.groupKey,
        accountNumber: c.accountNumber,
        flag: c.flag,
        pct: c.pct,
        transitioned: Boolean(kind),
      });
    }
  }

  for (const [key, prev] of prevByKey) {
    if (seen.has(key)) continue;
    if (prev.flag === "none") continue;
    transitions.push({
      kind: "recovery",
      scope: prev.account_number == null ? "group" : "account",
      groupKey: prev.group_key,
      accountNumber: prev.account_number,
      label:
        prev.account_number != null
          ? String(prev.account_number)
          : prev.group_key,
      from: prev.flag,
      to: "none",
      pct: null,
    });
    statesToWrite.push({
      groupKey: prev.group_key,
      accountNumber: prev.account_number,
      flag: "none",
      pct: null,
      transitioned: true,
    });
  }

  return { transitions, statesToWrite };
}

export function buildTransitionIdempotencyKey({
  propertyCode,
  monthEnd,
  groupKey,
  accountNumber,
  from,
  to,
  runDate,
}) {
  return [
    "variance",
    propertyCode,
    monthEnd,
    groupKey,
    accountNumber == null ? "-" : accountNumber,
    `${from}>${to}`,
    runDate,
  ].join(":");
}

function describePct(pct) {
  if (pct == null) return "unbudgeted activity";
  const signed = `${pct > 0 ? "+" : ""}${Number(pct).toFixed(1)}%`;
  return `${signed} vs budget (${pct > 0 ? "over" : "under"})`;
}

export function buildNotificationRow({
  orgId,
  userId,
  propertyCode,
  monthEnd,
  transition,
  appUrl,
  runDate,
}) {
  const isBreach = transition.kind === "breach";
  const severity = isBreach
    ? transition.to === "red"
      ? "critical"
      : "warning"
    : "info";
  const title = isBreach
    ? `Variance ${transition.to} flag — ${propertyCode}: ${transition.label}`
    : `Variance flag ${transition.to === "none" ? "cleared" : "downgraded"} — ${propertyCode}: ${transition.label}`;
  const message =
    `${propertyCode} · month ${monthEnd}: ${transition.scope} "${transition.label}" ` +
    `moved ${transition.from} -> ${transition.to} (${describePct(transition.pct)}). ` +
    (isBreach
      ? "Open the Budget Variance dashboard for amounts and drill-down."
      : "No action required; logged for the audit trail.");
  const transitionKey = buildTransitionIdempotencyKey({
    propertyCode,
    monthEnd,
    groupKey: transition.groupKey,
    accountNumber: transition.accountNumber,
    from: transition.from,
    to: transition.to,
    runDate,
  });
  return {
    org_id: orgId,
    user_id: userId,
    notification_type: "alert",
    title,
    message,
    severity,
    action_url: appUrl,
    resource_type: null,
    source: "variance-alerts-scheduled",
    source_ref: `${propertyCode}:${monthEnd}`,
    idempotency_key: `${transitionKey}:u:${userId}`,
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildAlertEmail({ propertyCode, monthEnd, breaches, appUrl }) {
  const subject = `[Variance Alert] ${propertyCode} — ${monthEnd}: ${breaches.length} new materiality ${breaches.length === 1 ? "flag" : "flags"}`;
  const rows = breaches
    .map(
      (t) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600;text-transform:uppercase;color:${t.to === "red" ? "#dc2626" : "#ea580c"}">${escapeHtml(t.to)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb">${t.scope === "group" ? "Group" : "Account"}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb">${escapeHtml(t.label)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb">${escapeHtml(describePct(t.pct))}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#6b7280">${escapeHtml(t.from)} &rarr; ${escapeHtml(t.to)}</td>
        </tr>`,
    )
    .join("");
  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;color:#222">
      <h2 style="margin:0 0 4px">Budget variance alert — ${escapeHtml(propertyCode)}</h2>
      <div style="color:#888;font-size:13px;margin-bottom:14px">Month: ${escapeHtml(monthEnd)} &middot; ${breaches.length} new materiality ${breaches.length === 1 ? "flag" : "flags"}</div>
      <table style="border-collapse:collapse;font-size:13px;width:100%">
        <thead>
          <tr style="background:#f3f4f6;text-align:left">
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Flag</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Scope</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Group / account</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Variance</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Transition</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#4b5563">
        Dollar amounts are intentionally omitted from email. Sign in and open
        the Budget Variance dashboard for amounts and the GL drill-down:
        <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a>
      </p>
      <p style="color:#9ca3af;font-size:11px;margin-top:24px">
        Generated by variance-alerts-scheduled (daily, after the actuals
        refresh). Alerts fire on threshold crossings only; an unchanged breach
        does not re-send.
      </p>
    </div>`;
  return { subject, html };
}

async function evaluateProperty({
  orgId,
  propertyCode,
  config,
  recipients,
  runDate,
  summary,
}) {
  const inputs = await pg("/rpc/get_variance_alert_inputs", {
    method: "POST",
    body: JSON.stringify({ p_org_id: orgId, p_property_code: propertyCode }),
  });
  if (!inputs.ok)
    throw new Error(`get_variance_alert_inputs -> ${inputs.status}`);
  const rows = inputs.body || [];

  const { monthEnd, basisRows } = selectBasisRows(rows, config.alertBasis);
  if (!monthEnd) {
    summary.properties_skipped_no_actuals += 1;
    return;
  }

  const scopedRows = scopeToOperatingBudgeted(basisRows);

  const classified = classifyMateriality(scopedRows, {
    groupPctThreshold: config.groupPctThreshold,
    accountPctThreshold: config.accountPctThreshold,
  });

  const classification = applyDollarFloor(classified, {
    accountDollarFloor: config.accountDollarFloor,
    groupDollarFloor: config.groupDollarFloor,
  });

  const stateRes = await pg(
    `/variance_alert_state?org_id=eq.${orgId}&property_code=eq.${encodeURIComponent(propertyCode)}&month_end=eq.${monthEnd}&select=group_key,account_number,flag`,
  );
  if (!stateRes.ok)
    throw new Error(`variance_alert_state read -> ${stateRes.status}`);

  const { transitions, statesToWrite } = computeTransitions({
    classification,
    stateRows: stateRes.body,
  });

  const fired = [];
  const firedNotificationIds = [];
  for (const t of transitions) {
    const rows = recipients.map((r) =>
      buildNotificationRow({
        orgId,
        userId: r.id,
        propertyCode,
        monthEnd,
        transition: t,
        appUrl: APP_BASE_URL,
        runDate,
      }),
    );
    const ins = await pg("/notifications", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows),
      expectStatuses: [409],
    });
    if (ins.ok) {
      fired.push(t);
      for (const inserted of Array.isArray(ins.body) ? ins.body : []) {
        if (inserted?.id)
          firedNotificationIds.push({ id: inserted.id, kind: t.kind });
      }
      summary.notifications_created += rows.length;
    } else if (ins.status === 409 && ins.body?.code === "23505") {
      summary.notifications_deduped += 1;
    } else {
      throw new Error(
        `notifications insert -> ${ins.status}${ins.body?.code ? ` (pg ${ins.body.code})` : ""}`,
      );
    }
  }

  const firedBreaches = fired.filter((t) => t.kind === "breach");
  summary.breaches += firedBreaches.length;
  summary.recoveries += fired.filter((t) => t.kind === "recovery").length;

  if (firedBreaches.length && recipients.length) {
    const { subject, html } = buildAlertEmail({
      propertyCode,
      monthEnd,
      breaches: firedBreaches,
      appUrl: APP_BASE_URL,
    });
    let mailResult = { sent: false, reason: "send_threw" };
    try {
      mailResult = await sendMail({
        to: recipients,
        subject,
        html,
        timeoutMs: FETCH_TIMEOUT_MS,
        onTokenError: (status, txt) =>
          console.error(
            "[variance-alerts-scheduled] ms-graph token failed:",
            status,
            String(txt).slice(0, 200),
          ),
      });
    } catch (e) {
      console.error(
        `[variance-alerts-scheduled] email send threw for ${propertyCode}:`,
        e?.message || e,
      );
    }
    if (mailResult.sent) {
      summary.emails_sent += 1;
      const breachIds = firedNotificationIds
        .filter((n) => n.kind === "breach")
        .map((n) => n.id);
      if (breachIds.length) {
        await pg(
          `/notifications?id=in.(${breachIds.map((i) => `"${i}"`).join(",")})`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ email_sent: true }),
          },
        );
      }
    } else {
      console.error(
        `[variance-alerts-scheduled] email send failed for ${propertyCode}: ${mailResult.reason}${mailResult.status ? ` (upstream ${mailResult.status})` : ""}`,
      );
    }
    await pg("/workflow_action_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        org_id: orgId,
        rule_id: null,
        rule_name: "variance-alerts-scheduled",
        action_type: "notification_sent",
        idempotency_key: `variance:email:${propertyCode}:${monthEnd}:${runDate}`,
        target_table: "notifications",
        target_id: null,
        payload: {
          property_code: propertyCode,
          month_end: monthEnd,
          breach_count: firedBreaches.length,
          recipient_count: recipients.length,
        },
        result: mailResult.sent ? "success" : "error",
        error_message: mailResult.sent ? null : mailResult.reason || "unknown",
      }),
      expectStatuses: [409],
    });
  }

  const now = new Date().toISOString();
  const configSnapshot = {
    groupPctThreshold: config.groupPctThreshold,
    accountPctThreshold: config.accountPctThreshold,
    alertBasis: config.alertBasis,
    accountDollarFloor: config.accountDollarFloor,
    groupDollarFloor: config.groupDollarFloor,
    usedDefaults: config.usedDefaults,
  };
  const baseRow = (s) => ({
    org_id: orgId,
    property_code: propertyCode,
    month_end: monthEnd,
    group_key: s.groupKey,
    account_number: s.accountNumber,
    flag: s.flag,
    pct_at_eval: s.pct,
    last_evaluated_at: now,
  });
  const transitionedRows = statesToWrite
    .filter((s) => s.transitioned)
    .map((s) => ({
      ...baseRow(s),
      last_transition_at: now,
      config_snapshot: configSnapshot,
    }));
  const unchangedRows = statesToWrite
    .filter((s) => !s.transitioned)
    .map(baseRow);
  const markerRow = {
    org_id: orgId,
    property_code: propertyCode,
    month_end: monthEnd,
    group_key: EVALUATION_MARKER_KEY,
    account_number: null,
    flag: "none",
    pct_at_eval: null,
    last_evaluated_at: now,
  };
  for (const batch of [transitionedRows, unchangedRows, [markerRow]]) {
    if (!batch.length) continue;
    const up = await pg(
      `/variance_alert_state?on_conflict=${STATE_CONFLICT_COLS}`,
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(batch),
      },
    );
    if (!up.ok) throw new Error(`variance_alert_state upsert -> ${up.status}`);
  }

  summary.properties_evaluated += 1;
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
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[variance-alerts-scheduled] missing SUPABASE env");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const startedAt = Date.now();
  const runDate = new Date().toISOString().slice(0, 10);
  const summary = {
    runDate,
    orgs: [],
    properties_evaluated: 0,
    properties_skipped_no_actuals: 0,
    properties_deferred: 0,
    breaches: 0,
    recoveries: 0,
    notifications_created: 0,
    notifications_deduped: 0,
    emails_sent: 0,
    errors: [],
  };

  const sealed = await pg(
    "/budget_snapshot_current?is_primary=is.true&select=org_id,property_code&order=org_id,property_code",
  );
  if (!sealed.ok) {
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
  const byOrg = new Map();
  for (const row of sealed.body || []) {
    if (!row?.org_id || !row?.property_code) continue;
    if (!byOrg.has(row.org_id)) byOrg.set(row.org_id, []);
    byOrg.get(row.org_id).push(row.property_code);
  }

  for (const [orgId, propertyCodes] of byOrg) {
    const orgSummary = { org_id: orgId, properties: propertyCodes.length };
    try {
      const settingsRes = await pg(
        `/platform_settings?org_id=eq.${orgId}&select=settings`,
      );
      const settings =
        settingsRes.ok && Array.isArray(settingsRes.body) && settingsRes.body[0]
          ? settingsRes.body[0].settings
          : null;
      const config = resolveVarianceAlertConfig(settings);
      if (config.usedDefaults) {
        console.log(
          `[variance-alerts-scheduled] org ${orgId}: no varianceAlerts config — using defaults 5/10 + gp/gp_admin/am`,
        );
      }
      if (!config.enabled) {
        orgSummary.skipped = "disabled_by_config";
        summary.orgs.push(orgSummary);
        continue;
      }

      const profilesRes = await pg(
        `/user_profiles?org_id=eq.${orgId}&is_active=eq.true&select=id,email,display_name,role`,
      );
      const recipients = profilesRes.ok
        ? resolveAlertRecipients(profilesRes.body, config.eligibleRoles)
        : [];
      if (!profilesRes.ok || !recipients.length) {
        console.error(
          `[variance-alerts-scheduled] org ${orgId}: ${profilesRes.ok ? "zero eligible internal recipients" : `user_profiles read -> ${profilesRes.status}`} — skipping org (no state writes; transitions stay pending)`,
        );
        orgSummary.skipped = profilesRes.ok
          ? "no_recipients"
          : "profiles_read_failed";
        summary.orgs.push(orgSummary);
        continue;
      }
      orgSummary.recipients = recipients.length;

      for (const propertyCode of propertyCodes) {
        if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
          summary.properties_deferred += 1;
          console.error(
            `[variance-alerts-scheduled] soft deadline hit — deferring ${propertyCode} to the next run`,
          );
          continue;
        }
        try {
          await evaluateProperty({
            orgId,
            propertyCode,
            config,
            recipients,
            runDate,
            summary,
          });
        } catch (e) {
          console.error(
            `[variance-alerts-scheduled] ${orgId}/${propertyCode} failed:`,
            e?.message || e,
          );
          summary.errors.push(
            `${propertyCode}: ${String(e?.message || e).slice(0, 200)}`,
          );
        }
      }
    } catch (e) {
      console.error(
        `[variance-alerts-scheduled] org ${orgId} failed:`,
        e?.message || e,
      );
      summary.errors.push(
        `org ${orgId}: ${String(e?.message || e).slice(0, 200)}`,
      );
    }
    summary.orgs.push(orgSummary);
  }

  summary.elapsed_ms = Date.now() - startedAt;
  console.log("[variance-alerts-scheduled]", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
