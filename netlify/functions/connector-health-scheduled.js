import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";
import { sendMail } from "./_ms-mail.js";
import {
  resolveAlertRecipients,
  VARIANCE_ALERT_DEFAULTS,
} from "../../src/lib/varianceAlertConfig.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.URL ||
  "https://credashboardproperty.netlify.app";

const FETCH_TIMEOUT_MS = 10_000;
const STALE_THRESHOLD_MS = 48 * 3_600_000;

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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    console.error(
      `[connector-health-scheduled] supabase ${init.method || "GET"} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return { ok: res.ok, status: res.status, body };
}

export function classifyConnectorHealth(
  connector,
  nowMs = Date.now(),
  staleMs = STALE_THRESHOLD_MS,
) {
  if (!connector) return { unhealthy: false, reason: null };
  if (connector.status === "error") return { unhealthy: true, reason: "error" };
  const cadence = connector?.config?.schedule || "daily";
  if (cadence === "manual") return { unhealthy: false, reason: null };
  const last = connector.last_sync_at;
  if (!last) return { unhealthy: false, reason: null };
  const t = new Date(last).getTime();
  if (Number.isFinite(t) && nowMs - t > staleMs)
    return { unhealthy: true, reason: "stale" };
  return { unhealthy: false, reason: null };
}

export function selectStaleResources(
  connector,
  freshness,
  nowMs = Date.now(),
  staleMs = STALE_THRESHOLD_MS,
) {
  if (!connector || (connector?.config?.schedule || "daily") === "manual")
    return [];
  const out = [];
  for (const f of freshness || []) {
    if (!f || f.connector_id !== connector.id) continue;
    const basis = f.last_fresh_at || f.last_run_at;
    const t = basis ? new Date(basis).getTime() : NaN;
    if (Number.isFinite(t) && nowMs - t > staleMs) {
      out.push({
        resource_type: f.resource_type,
        last_fresh_at: f.last_fresh_at,
        last_status: f.last_status,
        last_error: f.last_error,
      });
    }
  }
  return out.sort((a, b) =>
    String(a.resource_type).localeCompare(String(b.resource_type)),
  );
}

export function selectUnhealthyConnectors(
  connectors,
  nowMs = Date.now(),
  staleMs = STALE_THRESHOLD_MS,
  freshness = [],
) {
  const out = [];
  for (const c of connectors || []) {
    if (!c || c.vendor === "mock") continue;
    const { unhealthy, reason } = classifyConnectorHealth(c, nowMs, staleMs);
    const staleResources = selectStaleResources(c, freshness, nowMs, staleMs);
    if (unhealthy)
      out.push({
        ...c,
        health_reason: reason,
        stale_resources: staleResources,
      });
    else if (staleResources.length)
      out.push({
        ...c,
        health_reason: "stale_resource",
        stale_resources: staleResources,
      });
  }
  const rank = { error: 0, stale: 1, stale_resource: 2 };
  return out.sort(
    (a, b) =>
      rank[a.health_reason] - rank[b.health_reason] ||
      String(a.vendor).localeCompare(String(b.vendor)),
  );
}

export function groupByOrg(connectors) {
  const byOrg = new Map();
  for (const c of connectors || []) {
    if (!c?.org_id) continue;
    if (!byOrg.has(c.org_id)) byOrg.set(c.org_id, []);
    byOrg.get(c.org_id).push(c);
  }
  return byOrg;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function reasonLabel(reason) {
  return reason === "error"
    ? "Errored"
    : reason === "stale"
      ? "Stale (>48h)"
      : reason === "stale_resource"
        ? "Resource stale (>48h)"
        : "Unknown";
}

function fmtLastSync(v) {
  if (!v) return "never";
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return String(v);
  return new Date(t).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export function buildConnectorHealthEmail({ connectors, appUrl }) {
  const n = connectors.length;
  const subject = `[Connector Health] ${n} connector${n === 1 ? "" : "s"} need attention`;
  const rows = connectors
    .map(
      (c) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600">${escapeHtml(c.display_name || c.vendor)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb">${escapeHtml(c.vendor)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600;color:${c.health_reason === "error" ? "#dc2626" : "#ea580c"}">${escapeHtml(reasonLabel(c.health_reason))}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#6b7280">${escapeHtml(fmtLastSync(c.last_sync_at))}</td>
        </tr>${(c.stale_resources || [])
          .map(
            (r) => `
        <tr>
          <td colspan="4" style="padding:4px 10px 4px 24px;border:1px solid #e5e7eb;color:#6b7280;font-size:12px">${escapeHtml(r.resource_type)} — last fresh ${escapeHtml(fmtLastSync(r.last_fresh_at))}${r.last_status && r.last_status !== "success" ? ` · latest run ${escapeHtml(r.last_status)}${r.last_error ? `: ${escapeHtml(String(r.last_error).slice(0, 160))}` : ""}` : ""}</td>
        </tr>`,
          )
          .join("")}`,
    )
    .join("");
  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;color:#222">
      <h2 style="margin:0 0 4px">Connector health alert</h2>
      <div style="color:#888;font-size:13px;margin-bottom:14px">${n} connector${n === 1 ? "" : "s"} not syncing normally. A connector in this state is not pulling fresh data.</div>
      <table style="border-collapse:collapse;font-size:13px;width:100%">
        <thead>
          <tr style="background:#f3f4f6;text-align:left">
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Connector</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Vendor</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">State</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Last sync</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#4b5563">
        Sign in and open Settings → Integrations to inspect or reconnect:
        <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a>.
        An <strong>errored</strong> connector had a resource fail; a
        <strong>stale</strong> connector has not synced in over 48 hours; a
        <strong>resource stale</strong> connector is syncing but one or more of
        its resources has not pulled fresh data in over 48 hours. A
        connector whose OAuth token has expired (e.g. Dropbox) must be
        reconnected manually.
      </p>
      <p style="color:#9ca3af;font-size:11px;margin-top:24px">
        Generated by connector-health-scheduled (nightly). This alert re-sends
        each night until the connector recovers.
      </p>
    </div>`;
  return { subject, html };
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
    console.error("[connector-health-scheduled] missing SUPABASE env");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const startedAt = Date.now();
  const summary = {
    runDate: new Date().toISOString().slice(0, 10),
    connectorsExamined: 0,
    unhealthy: 0,
    orgsAlerted: 0,
    emailsSent: 0,
    orgsSkippedNoRecipients: 0,
    errors: [],
  };

  const listRes = await pg(
    "/connectors?select=id,org_id,vendor,display_name,status,last_sync_at,last_sync_status,config",
  );
  if (!listRes.ok || !Array.isArray(listRes.body)) {
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
  summary.connectorsExamined = listRes.body.length;

  const freshRes = await pg(
    "/connector_resource_freshness?select=connector_id,resource_type,last_fresh_at,last_run_at,last_status,last_error",
  );
  const freshness =
    freshRes.ok && Array.isArray(freshRes.body) ? freshRes.body : [];

  const unhealthy = selectUnhealthyConnectors(
    listRes.body,
    startedAt,
    STALE_THRESHOLD_MS,
    freshness,
  );
  summary.unhealthy = unhealthy.length;

  if (!unhealthy.length) {
    console.log("[connector-health-scheduled]", JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  for (const [orgId, orgConnectors] of groupByOrg(unhealthy)) {
    try {
      const profilesRes = await pg(
        `/user_profiles?org_id=eq.${orgId}&is_active=eq.true&select=id,email,display_name,role`,
      );
      const recipients = profilesRes.ok
        ? resolveAlertRecipients(
            profilesRes.body,
            VARIANCE_ALERT_DEFAULTS.eligibleRoles,
          )
        : [];
      if (!recipients.length) {
        summary.orgsSkippedNoRecipients += 1;
        console.error(
          `[connector-health-scheduled] org ${orgId}: no eligible internal recipients — ${orgConnectors.length} unhealthy connector(s) unreported`,
        );
        continue;
      }

      const { subject, html } = buildConnectorHealthEmail({
        connectors: orgConnectors,
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
              "[connector-health-scheduled] ms-graph token failed:",
              status,
              String(txt).slice(0, 200),
            ),
        });
      } catch (e) {
        console.error(
          `[connector-health-scheduled] email send threw for org ${orgId}:`,
          e?.message || e,
        );
      }
      summary.orgsAlerted += 1;
      if (mailResult.sent) {
        summary.emailsSent += 1;
      } else {
        console.error(
          `[connector-health-scheduled] email send failed for org ${orgId}: ${mailResult.reason}${mailResult.status ? ` (upstream ${mailResult.status})` : ""}`,
        );
      }
    } catch (e) {
      console.error(
        `[connector-health-scheduled] org ${orgId} failed:`,
        e?.message || e,
      );
      summary.errors.push(
        `org ${orgId}: ${String(e?.message || e).slice(0, 200)}`,
      );
    }
  }

  summary.elapsed_ms = Date.now() - startedAt;
  console.log("[connector-health-scheduled]", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
