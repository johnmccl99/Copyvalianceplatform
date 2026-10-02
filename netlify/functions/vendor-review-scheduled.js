import { runReview } from "./vendor-review.js";
import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEAD_DAYS = 7;
const MAX_PER_RUN = 20;

async function fetchDueVendors() {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];
  const today = new Date();
  const horizon = new Date(today.getTime() + LEAD_DAYS * 24 * 60 * 60 * 1000);
  const todayStr = today.toISOString().slice(0, 10);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const url =
    `${SUPABASE_URL}/rest/v1/security_vendors` +
    `?status=eq.active` +
    `&next_review_at=gte.${todayStr}` +
    `&next_review_at=lte.${horizonStr}` +
    `&ai_review_draft=is.null` +
    `&select=id,name,next_review_at` +
    `&order=next_review_at.asc` +
    `&limit=${MAX_PER_RUN}`;

  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    console.error(
      "[vendor-review-scheduled] fetch failed:",
      res.status,
      await res.text(),
    );
    return [];
  }
  return res.json();
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

  if (!SERVICE_KEY) {
    console.error(
      "[vendor-review-scheduled] SUPABASE_SERVICE_ROLE_KEY missing",
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const vendors = await fetchDueVendors();
  console.log(
    `[vendor-review-scheduled] ${vendors.length} vendor(s) due for pre-review`,
  );

  const results = [];
  for (const v of vendors) {
    try {
      const r = await runReview({ vendorId: v.id, useServiceRole: true });
      results.push({
        id: v.id,
        name: v.name,
        next_review_at: v.next_review_at,
        status: r.error ? "error" : "ok",
        error: r.error,
      });
    } catch (e) {
      results.push({
        id: v.id,
        name: v.name,
        status: "error",
        error: e?.message || String(e),
      });
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ran_at: new Date().toISOString(),
      processed: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    }),
  };
};
