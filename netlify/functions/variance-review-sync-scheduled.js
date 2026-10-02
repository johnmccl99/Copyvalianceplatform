import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FETCH_TIMEOUT_MS = 10_000;
const SOFT_DEADLINE_MS = 25_000;
const EVALUATION_MARKER_KEY = "__evaluation__";
const ITEM_CONFLICT_COLS =
  "org_id,property_code,month_end,group_key,account_number";
const OPEN_STATUSES = "to_review,in_review";

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
      `[variance-review-sync-scheduled] supabase ${rest.method || "GET"} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return { ok: res.ok, status: res.status, body, raw: text };
}

export { EVALUATION_MARKER_KEY };

export function itemKeyOf({
  property_code,
  month_end,
  group_key,
  account_number,
}) {
  return [
    property_code,
    month_end,
    group_key,
    account_number == null ? "" : String(account_number),
  ].join("\u0000");
}

function isBreachFlag(flag) {
  return flag === "red" || flag === "orange";
}

function isOpenStatus(status) {
  return status === "to_review" || status === "in_review";
}

export function formatPct(pct) {
  const n = Number(pct);
  if (pct == null || !Number.isFinite(n)) return "n/a";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function buildCreatedNote(stateRow) {
  return `auto-created from variance_alert_state (${stateRow.flag}, ${formatPct(stateRow.pct_at_eval)})`;
}

export function buildItemRow(orgId, stateRow) {
  return {
    org_id: orgId,
    property_code: stateRow.property_code,
    month_end: stateRow.month_end,
    group_key: stateRow.group_key,
    account_number: stateRow.account_number ?? null,
    account_name: null,
    status: "to_review",
    flag_at_open: stateRow.flag,
    pct_at_open: stateRow.pct_at_eval ?? null,
  };
}

export function planReviewSync({ stateRows, items }) {
  const stateByKey = new Map();
  for (const r of stateRows || []) {
    if (!r || r.group_key === EVALUATION_MARKER_KEY) continue;
    stateByKey.set(itemKeyOf(r), r);
  }

  const itemKeys = new Set();
  for (const item of items || []) {
    if (!item) continue;
    itemKeys.add(itemKeyOf(item));
  }

  const creates = [];
  for (const s of stateByKey.values()) {
    if (isBreachFlag(s.flag) && !itemKeys.has(itemKeyOf(s))) creates.push(s);
  }

  const clears = [];
  const rebreaches = [];
  for (const item of items || []) {
    if (!item || !isOpenStatus(item.status)) continue;
    const state = stateByKey.get(itemKeyOf(item));
    const stillBreached = Boolean(state && isBreachFlag(state.flag));
    if (item.flag_cleared_at == null) {
      if (!stillBreached) clears.push(item);
    } else if (stillBreached) {
      rebreaches.push({ item, flag: state.flag });
    }
  }

  return { creates, clears, rebreaches };
}

async function syncOrg({ orgId, summary }) {
  const orgSummary = { org_id: orgId, created: 0, cleared: 0, rebreached: 0 };

  const stateRes = await pg(
    `/variance_alert_state?org_id=eq.${orgId}&group_key=neq.${EVALUATION_MARKER_KEY}&select=property_code,month_end,group_key,account_number,flag,pct_at_eval`,
  );
  if (!stateRes.ok)
    throw new Error(`variance_alert_state read -> ${stateRes.status}`);

  const itemsRes = await pg(
    `/variance_review_items?org_id=eq.${orgId}&select=id,property_code,month_end,group_key,account_number,status,flag_cleared_at`,
  );
  if (!itemsRes.ok)
    throw new Error(`variance_review_items read -> ${itemsRes.status}`);

  const { creates, clears, rebreaches } = planReviewSync({
    stateRows: stateRes.body,
    items: itemsRes.body,
  });

  if (creates.length) {
    const ins = await pg(
      `/variance_review_items?on_conflict=${ITEM_CONFLICT_COLS}`,
      {
        method: "POST",
        headers: {
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(creates.map((s) => buildItemRow(orgId, s))),
      },
    );
    if (!ins.ok)
      throw new Error(`variance_review_items insert -> ${ins.status}`);
    const inserted = (Array.isArray(ins.body) ? ins.body : []).filter(
      (r) => r?.id,
    );
    const noteByKey = new Map(
      creates.map((s) => [itemKeyOf(s), buildCreatedNote(s)]),
    );
    if (inserted.length) {
      const ev = await pg("/variance_review_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(
          inserted.map((r) => ({
            org_id: orgId,
            item_id: r.id,
            event_kind: "created",
            to_status: "to_review",
            note:
              noteByKey.get(itemKeyOf(r)) ??
              "auto-created from variance_alert_state",
          })),
        ),
      });
      if (!ev.ok)
        throw new Error(
          `variance_review_events insert (created) -> ${ev.status}`,
        );
    }
    orgSummary.created = inserted.length;
  }

  const now = new Date().toISOString();
  const idList = (rows) => rows.map((r) => `"${r.id}"`).join(",");

  if (clears.length) {
    const upd = await pg(
      `/variance_review_items?id=in.(${idList(clears)})&status=in.(${OPEN_STATUSES})&flag_cleared_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ flag_cleared_at: now }),
      },
    );
    if (!upd.ok)
      throw new Error(`variance_review_items clear-stamp -> ${upd.status}`);
    const updated = (Array.isArray(upd.body) ? upd.body : []).filter(
      (r) => r?.id,
    );
    if (updated.length) {
      const ev = await pg("/variance_review_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(
          updated.map((r) => ({
            org_id: orgId,
            item_id: r.id,
            event_kind: "flag_update",
            note: "underlying flag recovered",
          })),
        ),
      });
      if (!ev.ok)
        throw new Error(
          `variance_review_events insert (recovered) -> ${ev.status}`,
        );
    }
    orgSummary.cleared = updated.length;
  }

  if (rebreaches.length) {
    const flagById = new Map(rebreaches.map((rb) => [rb.item.id, rb.flag]));
    const upd = await pg(
      `/variance_review_items?id=in.(${idList(rebreaches.map((rb) => rb.item))})&status=in.(${OPEN_STATUSES})&flag_cleared_at=not.is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ flag_cleared_at: null }),
      },
    );
    if (!upd.ok)
      throw new Error(
        `variance_review_items rebreach-unstamp -> ${upd.status}`,
      );
    const updated = (Array.isArray(upd.body) ? upd.body : []).filter(
      (r) => r?.id,
    );
    if (updated.length) {
      const ev = await pg("/variance_review_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(
          updated.map((r) => ({
            org_id: orgId,
            item_id: r.id,
            event_kind: "flag_update",
            note: `flag re-breached (${flagById.get(r.id) || "red"})`,
          })),
        ),
      });
      if (!ev.ok)
        throw new Error(
          `variance_review_events insert (rebreached) -> ${ev.status}`,
        );
    }
    orgSummary.rebreached = updated.length;
  }

  console.log(
    `[variance-review-sync-scheduled] org ${orgId}: ${JSON.stringify({ created: orgSummary.created, cleared: orgSummary.cleared, rebreached: orgSummary.rebreached })}`,
  );
  summary.items_created += orgSummary.created;
  summary.flags_cleared += orgSummary.cleared;
  summary.flags_rebreached += orgSummary.rebreached;
  summary.orgs.push(orgSummary);
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
    console.error("[variance-review-sync-scheduled] missing SUPABASE env");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const startedAt = Date.now();
  const summary = {
    runDate: new Date().toISOString().slice(0, 10),
    orgs: [],
    items_created: 0,
    flags_cleared: 0,
    flags_rebreached: 0,
    orgs_deferred: 0,
    errors: [],
  };

  const orgRes = await pg("/variance_alert_state?select=org_id");
  if (!orgRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
  const orgIds = [
    ...new Set((orgRes.body || []).map((r) => r?.org_id).filter(Boolean)),
  ];

  for (const orgId of orgIds) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      summary.orgs_deferred += 1;
      console.error(
        `[variance-review-sync-scheduled] soft deadline hit — deferring org ${orgId} to the next run`,
      );
      continue;
    }
    try {
      await syncOrg({ orgId, summary });
    } catch (e) {
      console.error(
        `[variance-review-sync-scheduled] org ${orgId} failed:`,
        e?.message || e,
      );
      summary.errors.push(
        `org ${orgId}: ${String(e?.message || e).slice(0, 200)}`,
      );
    }
  }

  summary.elapsed_ms = Date.now() - startedAt;
  console.log("[variance-review-sync-scheduled]", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
