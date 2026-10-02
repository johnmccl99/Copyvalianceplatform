import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";
import { freezeEffectiveRoll } from "../../src/lib/rentRollVersions.js";
import {
  materializeEffectiveRoll,
  startOfDayInstant,
} from "./_rent-roll-materialize.js";
import {
  PORTFOLIO_TIME_ZONE,
  todayIso,
} from "../../src/lib/entrataLeaseStatus.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CALL_TIMEOUT_MS = 30_000;

async function pg(
  path,
  { bearer = SERVICE_KEY, method = "GET", body = null } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      method,
      signal: controller.signal,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { ok: res.ok, status: res.status, body: json, raw: text };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      raw:
        e && e.name === "AbortError"
          ? "timeout"
          : (e && e.message) || "fetch error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function weekStartISO(now) {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString();
}

async function findUnmappedEntrataProperties(mappedIds) {
  if (mappedIds.length > 500) return { ids: null, skipped: "too_many_mapped" };
  const inList = mappedIds.map((v) => encodeURIComponent(v)).join(",");
  const res = await pg(
    `/entrata_leases?select=property_id&limit=1000${inList ? `&property_id=not.in.(${inList})` : ""}`,
  );
  if (!res.ok || !Array.isArray(res.body))
    return { ids: null, skipped: `status_${res.status}` };
  return {
    ids: [
      ...new Set(res.body.map((r) => r.property_id).filter((v) => v != null)),
    ],
    skipped: null,
  };
}

export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "[rent-roll-capture-scheduled] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server not configured" }),
    };
  }

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

  const now = new Date();
  const startedAt = Date.now();
  const windowStart = weekStartISO(now);
  const sweepAsOf = todayIso(PORTFOLIO_TIME_ZONE);
  const sweepAsOfInstant = startOfDayInstant(sweepAsOf, PORTFOLIO_TIME_ZONE);
  const label = `Weekly snapshot ${sweepAsOf}`;
  const summary = {
    started_at: new Date(startedAt).toISOString(),
    label,
    window_start: windowStart,
    properties_examined: 0,
    captured: 0,
    skipped_existing: 0,
    skipped_empty: 0,
    pointer_bootstrapped: 0,
    unmapped_entrata_properties: [],
    errors: [],
  };

  const propsRes = await pg(
    "/properties?entrata_property_id=not.is.null&select=id,org_id,name,entrata_property_id",
  );
  if (!propsRes.ok || !Array.isArray(propsRes.body)) {
    console.error(
      `[rent-roll-capture-scheduled] enumerate failed: ${propsRes.status} ${(propsRes.raw || "").slice(0, 200)}`,
    );
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Failed to enumerate properties" }),
    };
  }
  summary.properties_examined = propsRes.body.length;

  const mappedIds = propsRes.body
    .map((p) => p.entrata_property_id)
    .filter((v) => v != null);
  const unmapped = await findUnmappedEntrataProperties(mappedIds);
  if (unmapped.ids && unmapped.ids.length) {
    summary.unmapped_entrata_properties = unmapped.ids;
    console.error(
      `[rent-roll-capture-scheduled] ${unmapped.ids.length} Entrata property id(s) have synced leases but no properties.entrata_property_id mapping, so they are NEVER captured: ${unmapped.ids.join(", ")}`,
    );
  } else if (unmapped.skipped) {
    summary.unmapped_check_skipped = unmapped.skipped;
  }

  for (const prop of propsRes.body) {
    const entrataPropertyId = prop.entrata_property_id;
    const orgId = prop.org_id;
    try {
      const existing = await pg(
        `/rent_roll_versions?property_id=eq.${encodeURIComponent(entrataPropertyId)}&org_id=eq.${encodeURIComponent(orgId)}&created_at=gte.${encodeURIComponent(windowStart)}&select=id&limit=1`,
      );
      if (
        existing.ok &&
        Array.isArray(existing.body) &&
        existing.body.length > 0
      ) {
        summary.skipped_existing += 1;
        continue;
      }

      const { effectiveRows, error: materializeErr } =
        await materializeEffectiveRoll({
          pg,
          bearer: SERVICE_KEY,
          entrataPropertyId,
          asOf: sweepAsOf,
        });
      if (materializeErr) {
        summary.errors.push({
          property_id: entrataPropertyId,
          org_id: orgId,
          stage: materializeErr.stage,
          status: materializeErr.status,
        });
        continue;
      }
      if (!effectiveRows.length) {
        summary.skipped_empty += 1;
        continue;
      }

      const frozen = freezeEffectiveRoll(
        { rows: effectiveRows },
        {
          property_id: entrataPropertyId,
          label,
          status: "draft",
          signed_off_by: null,
          created_by: null,
        },
      );

      const pointer = await pg(
        `/rent_roll_version_current?property_id=eq.${encodeURIComponent(entrataPropertyId)}&org_id=eq.${encodeURIComponent(orgId)}&select=version_id&limit=1`,
      );
      const pointerUnset =
        pointer.ok && Array.isArray(pointer.body) && pointer.body.length === 0;

      const rpc = await pg("/rpc/capture_rent_roll_version", {
        method: "POST",
        body: {
          p_org: orgId,
          p_property_id: entrataPropertyId,
          p_label: label,
          p_lines: frozen.lines,
          p_as_of: sweepAsOfInstant,
          p_status: "draft",
          p_signed_off_by: null,
          p_content_signature: frozen.content_signature,
          p_summary: frozen.header.summary,
          p_created_by: null,
          p_make_current: pointerUnset,
        },
      });
      if (!rpc.ok) {
        summary.errors.push({
          property_id: entrataPropertyId,
          org_id: orgId,
          stage: "rpc",
          status: rpc.status,
          message: (rpc.raw || "").slice(0, 160),
        });
        continue;
      }
      summary.captured += 1;
      if (pointerUnset) summary.pointer_bootstrapped += 1;
    } catch (e) {
      summary.errors.push({
        property_id: entrataPropertyId,
        org_id: orgId,
        stage: "exception",
        message: ((e && e.message) || String(e)).slice(0, 160),
      });
    }
  }

  summary.elapsed_ms = Date.now() - startedAt;
  console.log(
    `[rent-roll-capture-scheduled] ${JSON.stringify({ ...summary, errors: summary.errors.slice(0, 20), error_count: summary.errors.length })}`,
  );
  return {
    statusCode: 200,
    body: JSON.stringify({ ...summary, error_count: summary.errors.length }),
  };
};
