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
const STALE_THRESHOLD_MS = 24 * 3_600_000;

const SWEEP_ABSENCE_THRESHOLD_MS = 14 * 3_600_000;

const SWEEP_SOURCES = [
  {
    outcome: "sweep_trigger_coa",
    entry: "sweep_trigger_coa_entry",
    label: "COA cache sweep",
    slots: "02:20, 08:20, 14:20, 20:20 UTC",
  },
  {
    outcome: "sweep_trigger_portfolio",
    entry: "sweep_trigger_portfolio_entry",
    label: "Portfolio rollup sweep",
    slots: "02:50, 08:50, 14:50, 20:50 UTC",
  },
];

const CACHE_LABELS = {
  budget_coa_monthly_cache:
    "Budget COA monthly (per-property variance + NOI build)",
  portfolio_budget_noi_build_cache: "Portfolio budget NOI build (org rollup)",
};

export function classifyCacheFreshness(
  row,
  nowMs = Date.now(),
  staleMs = STALE_THRESHOLD_MS,
) {
  if (!row) return { stale: false, ageMs: null };
  const last = row.last_refreshed_at;
  if (!last) return { stale: true, ageMs: null };
  const t = new Date(last).getTime();
  if (!Number.isFinite(t)) return { stale: true, ageMs: null };
  const ageMs = nowMs - t;
  return { stale: ageMs > staleMs, ageMs };
}

export function selectStaleCaches(
  rows,
  nowMs = Date.now(),
  staleMs = STALE_THRESHOLD_MS,
) {
  const out = [];
  for (const r of rows || []) {
    if (!r) continue;
    const { stale, ageMs } = classifyCacheFreshness(r, nowMs, staleMs);
    if (stale) out.push({ ...r, age_ms: ageMs });
  }
  return out.sort((a, b) => {
    const an = a.age_ms == null;
    const bn = b.age_ms == null;
    if (an && bn) {
      return (
        String(a.cache_name).localeCompare(String(b.cache_name)) ||
        String(a.org_id).localeCompare(String(b.org_id))
      );
    }
    if (an) return -1;
    if (bn) return 1;
    return b.age_ms - a.age_ms;
  });
}

export function groupByOrg(rows) {
  const byOrg = new Map();
  for (const r of rows || []) {
    if (!r?.org_id) continue;
    if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []);
    byOrg.get(r.org_id).push(r);
  }
  return byOrg;
}

export function formatAge(ageMs) {
  if (ageMs == null) return "never refreshed";
  const hours = ageMs / 3_600_000;
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function classifySweepAbsence(
  observation,
  nowMs = Date.now(),
  thresholdMs = SWEEP_ABSENCE_THRESHOLD_MS,
) {
  if (!observation) return { absent: false, ageMs: null, diagnosis: "unknown" };
  if (observation.queryFailed)
    return { absent: false, ageMs: null, diagnosis: "unknown" };

  const parse = (v) => {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const okAt = parse(observation.lastOkAt);
  const entryAt = parse(observation.lastEntryAt);
  const ageMs = okAt == null ? null : nowMs - okAt;

  if (ageMs != null && ageMs <= thresholdMs) {
    return { absent: false, ageMs, diagnosis: "healthy" };
  }

  const entryAge = entryAt == null ? null : nowMs - entryAt;
  const entryRecent = entryAge != null && entryAge <= thresholdMs;
  const diagnosis = entryRecent
    ? "invoked_without_success"
    : okAt == null && entryAt == null
      ? "no_invocation_record"
      : "not_invoked";

  return { absent: true, ageMs, diagnosis };
}

export function selectAbsentSweeps(
  observations,
  nowMs = Date.now(),
  thresholdMs = SWEEP_ABSENCE_THRESHOLD_MS,
) {
  const out = [];
  for (const o of observations || []) {
    if (!o) continue;
    const { absent, ageMs, diagnosis } = classifySweepAbsence(
      o,
      nowMs,
      thresholdMs,
    );
    if (absent) out.push({ ...o, age_ms: ageMs, diagnosis });
  }
  return out.sort((a, b) => {
    const an = a.age_ms == null;
    const bn = b.age_ms == null;
    if (an && bn) return String(a.source).localeCompare(String(b.source));
    if (an) return -1;
    if (bn) return 1;
    return b.age_ms - a.age_ms;
  });
}

const DIAGNOSIS_TEXT = {
  invoked_without_success: "ran but did not complete successfully",
  not_invoked: "has not been invoked",
  no_invocation_record: "has no invocation record at all",
};

export function describeSweepDiagnosis(diagnosis) {
  return DIAGNOSIS_TEXT[diagnosis] || "has not reported a successful run";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildCacheFreshnessEmail({ caches, appUrl, thresholdHours }) {
  const n = caches.length;
  const subject = `[Data Freshness] ${n} budget cache${n === 1 ? "" : "s"} stale`;
  const rows = caches
    .map(
      (c) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600">${escapeHtml(CACHE_LABELS[c.cache_name] || c.cache_name)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600;color:#dc2626">${escapeHtml(formatAge(c.age_ms))}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#6b7280">${escapeHtml(c.last_refreshed_at ? String(c.last_refreshed_at).replace("T", " ").slice(0, 16) + "Z" : "never")}</td>
        </tr>`,
    )
    .join("");
  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;color:#222">
      <h2 style="margin:0 0 4px">Budget data freshness alert</h2>
      <div style="color:#888;font-size:13px;margin-bottom:14px">
        ${n} cache${n === 1 ? " has" : "s have"} not refreshed in over ${thresholdHours} hours.
        Portfolio-level budget and variance figures are being served from this
        data, so they are currently older than the underlying records.
        Single-property views read live and are unaffected.
      </div>
      <table style="border-collapse:collapse;font-size:13px;width:100%">
        <thead>
          <tr style="background:#f3f4f6;text-align:left">
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Cache</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Age</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Last refreshed</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#4b5563">
        The refresh runs every 6 hours. An age past ${thresholdHours} hours means
        several cycles have failed. Sign in at
        <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a>; the per-attempt
        outcome for every property is recorded in
        <code>portfolio_budget_cache_refresh_log</code>.
      </p>
      <p style="color:#9ca3af;font-size:11px;margin-top:24px">
        Generated by budget-cache-freshness-scheduled (nightly). This alert
        re-sends each night until the cache refreshes.
      </p>
    </div>`;
  return { subject, html };
}

export function buildSweepAbsenceEmail({ sweeps, appUrl, thresholdHours }) {
  const n = sweeps.length;
  const subject = `[Data Pipeline] ${n} budget refresh sweep${n === 1 ? "" : "s"} not reporting success`;
  const rows = sweeps
    .map(
      (s) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600">${escapeHtml(s.label || s.source)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600;color:#dc2626">${escapeHtml(s.age_ms == null ? "no successful run on record" : formatAge(s.age_ms))}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#6b7280">${escapeHtml(describeSweepDiagnosis(s.diagnosis))}</td>
        </tr>`,
    )
    .join("");
  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;color:#222">
      <h2 style="margin:0 0 4px">Budget refresh pipeline alert</h2>
      <div style="color:#888;font-size:13px;margin-bottom:14px">
        ${n} scheduled refresh sweep${n === 1 ? " has" : "s have"} not recorded a
        successful run in over ${thresholdHours} hours. This is an early warning:
        the figures on the platform are still being served normally and may look
        current, but nothing is refreshing them, so they will begin to age until
        this is resolved.
      </div>
      <table style="border-collapse:collapse;font-size:13px;width:100%">
        <thead>
          <tr style="background:#f3f4f6;text-align:left">
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Sweep</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Last success</th>
            <th style="padding:6px 10px;border:1px solid #e5e7eb">Diagnosis</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#4b5563">
        Each sweep runs every 6 hours, so ${thresholdHours} hours without a
        success means at least two consecutive cycles produced nothing. Sign in at
        <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a>; every trigger
        attempt is recorded in <code>portfolio_budget_cache_refresh_log</code>.
      </p>
      <p style="color:#9ca3af;font-size:11px;margin-top:24px">
        Generated by budget-cache-freshness-scheduled. This alert re-sends every
        6 hours until a sweep reports success.
      </p>
    </div>`;
  return { subject, html };
}

async function fetchSweepObservations() {
  const one = async (source, okOnly) => {
    const filters = [
      `source=eq.${encodeURIComponent(source)}`,
      ...(okOnly ? ["ok=is.true"] : []),
      "select=created_at",
      "order=created_at.desc",
      "limit=1",
    ].join("&");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/portfolio_budget_cache_refresh_log?${filters}`,
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) throw new Error(`${source} -> ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) && body[0] ? body[0].created_at : null;
  };

  return Promise.all(
    SWEEP_SOURCES.map(async (s) => {
      try {
        const [lastOkAt, lastEntryAt] = await Promise.all([
          one(s.outcome, true),
          one(s.entry, false),
        ]);
        return {
          ...s,
          source: s.outcome,
          lastOkAt,
          lastEntryAt,
          queryFailed: false,
        };
      } catch (e) {
        console.error(
          `[budget-cache-freshness] sweep log read failed for ${s.outcome}:`,
          e?.message || e,
        );
        return {
          ...s,
          source: s.outcome,
          lastOkAt: null,
          lastEntryAt: null,
          queryFailed: true,
        };
      }
    }),
  );
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
    console.error("[budget-cache-freshness] missing SUPABASE env");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const startedAt = Date.now();
  const summary = {
    runDate: new Date().toISOString().slice(0, 10),
    cachesExamined: 0,
    stale: 0,
    sweepsAbsent: 0,
    orgsAlerted: 0,
    emailsSent: 0,
    orgsSkippedNoRecipients: 0,
  };

  let rows;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/budget_cache_freshness`,
      {
        method: "POST",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error(
        `[budget-cache-freshness] freshness RPC -> ${res.status}: ${text.slice(0, 200)}`,
      );
      return { statusCode: 500, body: JSON.stringify({ ok: false }) };
    }
    rows = JSON.parse(text);
  } catch (e) {
    console.error(
      "[budget-cache-freshness] freshness RPC threw:",
      e?.message || e,
    );
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }

  if (!Array.isArray(rows)) {
    console.error(
      "[budget-cache-freshness] freshness RPC returned a non-array",
    );
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }

  summary.cachesExamined = rows.length;
  const stale = selectStaleCaches(rows, startedAt, STALE_THRESHOLD_MS);
  summary.stale = stale.length;

  const absent = selectAbsentSweeps(
    await fetchSweepObservations(),
    startedAt,
    SWEEP_ABSENCE_THRESHOLD_MS,
  );
  summary.sweepsAbsent = absent.length;

  if (!stale.length && !absent.length) {
    console.log("[budget-cache-freshness]", JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  if (stale.length) {
    console.error(
      "[budget-cache-freshness] STALE CACHES: " +
        JSON.stringify(
          stale.map((c) => ({
            cache: c.cache_name,
            org_id: c.org_id,
            age: formatAge(c.age_ms),
            last: c.last_refreshed_at,
          })),
        ),
    );
  }
  if (absent.length) {
    console.error(
      "[budget-cache-freshness] SWEEPS NOT REPORTING SUCCESS: " +
        JSON.stringify(
          absent.map((s) => ({
            sweep: s.source,
            since: formatAge(s.age_ms),
            last_ok: s.lastOkAt,
            diagnosis: s.diagnosis,
          })),
        ),
    );
  }

  const thresholdHours = Math.round(STALE_THRESHOLD_MS / 3_600_000);
  const absenceHours = Math.round(SWEEP_ABSENCE_THRESHOLD_MS / 3_600_000);

  const orgsWithStale = groupByOrg(stale);
  const alertTargets = new Map();
  for (const [orgId, orgCaches] of orgsWithStale) {
    alertTargets.set(orgId, { staleCaches: orgCaches, absentSweeps: [] });
  }
  if (absent.length) {
    for (const orgId of groupByOrg(rows).keys()) {
      if (!alertTargets.has(orgId))
        alertTargets.set(orgId, { staleCaches: [], absentSweeps: [] });
      alertTargets.get(orgId).absentSweeps = absent;
    }
  }

  for (const [
    orgId,
    { staleCaches: orgCaches, absentSweeps },
  ] of alertTargets) {
    try {
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?org_id=eq.${encodeURIComponent(orgId)}&is_active=eq.true&select=id,email,display_name,role`,
        {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            Accept: "application/json",
          },
        },
      );
      const profiles = pr.ok ? await pr.json() : [];
      if (!pr.ok) {
        console.error(
          `[budget-cache-freshness] user_profiles for org ${orgId} -> ${pr.status}`,
        );
      }
      const recipients = resolveAlertRecipients(
        profiles,
        VARIANCE_ALERT_DEFAULTS.eligibleRoles,
      );
      if (!recipients.length) {
        summary.orgsSkippedNoRecipients += 1;
        console.error(
          `[budget-cache-freshness] org ${orgId}: no eligible internal recipients — ${orgCaches.length} stale cache(s) and ${absentSweeps.length} non-reporting sweep(s) unreported`,
        );
        continue;
      }

      const messages = [];
      if (orgCaches.length) {
        messages.push(
          buildCacheFreshnessEmail({
            caches: orgCaches,
            appUrl: APP_BASE_URL,
            thresholdHours,
          }),
        );
      }
      if (absentSweeps.length) {
        messages.push(
          buildSweepAbsenceEmail({
            sweeps: absentSweeps,
            appUrl: APP_BASE_URL,
            thresholdHours: absenceHours,
          }),
        );
      }

      for (const { subject, html } of messages) {
        let mailResult = { sent: false, reason: "send_threw" };
        try {
          mailResult = await sendMail({
            to: recipients,
            subject,
            html,
            timeoutMs: FETCH_TIMEOUT_MS,
            onTokenError: (status, txt) =>
              console.error(
                "[budget-cache-freshness] ms-graph token failed:",
                status,
                String(txt).slice(0, 200),
              ),
          });
        } catch (e) {
          console.error(
            `[budget-cache-freshness] email send threw for org ${orgId}:`,
            e?.message || e,
          );
        }
        if (mailResult.sent) {
          summary.emailsSent += 1;
        } else {
          console.error(
            `[budget-cache-freshness] email send failed for org ${orgId} ("${subject}"): ${mailResult.reason}${mailResult.status ? ` (upstream ${mailResult.status})` : ""}`,
          );
        }
      }
      summary.orgsAlerted += 1;
    } catch (e) {
      console.error(
        `[budget-cache-freshness] org ${orgId} failed:`,
        e?.message || e,
      );
    }
  }

  summary.elapsed_ms = Date.now() - startedAt;
  console.error("[budget-cache-freshness]", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
