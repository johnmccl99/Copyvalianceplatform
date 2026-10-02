import { applySecurity, jsonResponse } from "./_security.js";
import {
  ADAPTERS,
  syncOneResource,
  claimConnectorLease,
  releaseConnectorLease,
  FUNCTION_SAFE_CAP_MS,
} from "./_connector-adapters.js";
import {
  rollupConnectorSummary,
  carryResourceErrors,
} from "./_connector-rollup.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const MAX_WALL_CLOCK_MS = 13 * 60_000;

async function sr(path, { method = "GET", body = null, prefer = null } = {}) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

function decodeJwtSub(jwt) {
  try {
    const [, payloadB64] = jwt.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf8"),
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}

async function resolveAdminProfile(userJwt) {
  const sub = decodeJwtSub(userJwt);
  if (!sub) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?auth_id=eq.${encodeURIComponent(sub)}&select=id,org_id,is_admin,role&limit=1`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        Accept: "application/json",
      },
    },
  );
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || !rows.length) return null;
  const p = rows[0];
  const truthyAdmin =
    p.is_admin === true ||
    p.is_admin === "t" ||
    p.is_admin === "true" ||
    p.is_admin === 1;
  const adminRole = ["admin", "gp_admin", "gp-admin"].includes(
    String(p.role || "").toLowerCase(),
  );
  return { userId: p.id, orgId: p.org_id, isAdmin: truthyAdmin || adminRole };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  try {
    const { connector_id } = JSON.parse(event.body || "{}");
    if (!connector_id)
      return jsonResponse(400, { error: "connector_id required" });

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (!profile.isAdmin) return jsonResponse(403, { error: "Admin required" });

    const connRes = await sr(
      `/connectors?id=eq.${connector_id}&select=id,org_id,vendor,status,config&limit=1`,
    );
    if (!connRes.ok || !Array.isArray(connRes.body) || !connRes.body.length) {
      return jsonResponse(404, { error: "Connector not found" });
    }
    const connector = connRes.body[0];
    if (connector.org_id !== profile.orgId)
      return jsonResponse(403, { error: "Not your org" });
    if (connector.vendor !== "entrata")
      return jsonResponse(400, { error: "Not an Entrata connector" });

    const adapter = ADAPTERS[connector.vendor];
    if (!adapter)
      return jsonResponse(500, {
        error: "No adapter registered for this vendor",
      });

    const lease = await claimConnectorLease({
      connector,
      bearer: SERVICE_ROLE_KEY,
    });
    if (!lease.acquired) {
      return jsonResponse(200, {
        ok: true,
        skipped: true,
        reason: "sync_in_progress",
        heldUntil: lease.heldUntil,
      });
    }

    const startedAt = Date.now();
    const resources = adapter.resources.slice();
    const runReport = { resources: [], endedReason: null };

    const runsThisSync = [];

    for (const resourceType of resources) {
      if (Date.now() - startedAt > MAX_WALL_CLOCK_MS) {
        runReport.endedReason = "wall_clock";
        break;
      }
      let out;
      try {
        out = await syncOneResource({
          bearer: SERVICE_ROLE_KEY,
          connector,
          adapter,
          resourceType,
          triggeredBy: "sync_bg",
          functionDeadline: startedAt + FUNCTION_SAFE_CAP_MS,
        });
      } catch (e) {
        const errorMessage = e?.message || String(e);
        runReport.resources.push({ resourceType, error: errorMessage });
        runsThisSync.push({
          resourceType,
          status: "error",
          errorMessage,
          rowsRead: 0,
          rowsWritten: 0,
        });
        try {
          await sr("/connector_sync_runs", {
            method: "POST",
            prefer: "return=minimal",
            body: {
              connector_id: connector.id,
              org_id: connector.org_id,
              direction: "in",
              resource_type: resourceType,
              status: "error",
              triggered_by: "sync_bg",
              completed_at: new Date().toISOString(),
              error_message: errorMessage.slice(0, 500),
              payload: { diag: { orchestrator_exception: true } },
            },
          });
        } catch (e2) {
          console.error(
            "[entrata-sync-background] failed to record exception run row:",
            e2?.message || e2,
          );
        }
        continue;
      }
      runReport.resources.push({
        resourceType,
        rowsRead: out?.rowsRead || 0,
        rowsWritten: out?.rowsWritten || 0,
        status: out?.error ? "error" : out?.partial ? "partial" : "success",
      });
      runsThisSync.push(out);
    }
    if (runReport.endedReason === null)
      runReport.endedReason = "all_resources_done";

    try {
      if (runsThisSync.length) {
        const carried = await carryResourceErrors({
          bearer: SERVICE_ROLE_KEY,
          connector,
          runs: runsThisSync,
        });
        await rollupConnectorSummary({
          bearer: SERVICE_ROLE_KEY,
          connectorId: connector.id,
          runs: [...runsThisSync, ...carried],
          connector,
        });
      }
    } catch (e) {
      console.warn("[entrata-sync-background] rollup failed:", e?.message || e);
    }

    console.log(
      "[entrata-sync-background] finished:",
      JSON.stringify(runReport),
    );
    await releaseConnectorLease({
      connector,
      bearer: SERVICE_ROLE_KEY,
      heldUntil: lease.heldUntil,
    });
    return jsonResponse(200, runReport);
  } catch (e) {
    console.error("[entrata-sync-background] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
