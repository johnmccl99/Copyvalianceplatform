import { applySecurity, jsonResponse } from "./_security.js";
import { ADAPTERS, syncOneResource } from "./_connector-adapters.js";
import { rollupConnectorSummary } from "./_connector-rollup.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const MAX_ITERATIONS = 60;
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
      `/connectors?id=eq.${connector_id}&select=id,org_id,vendor,status&limit=1`,
    );
    if (!connRes.ok || !Array.isArray(connRes.body) || !connRes.body.length) {
      return jsonResponse(404, { error: "Connector not found" });
    }
    const connector = connRes.body[0];
    if (connector.org_id !== profile.orgId)
      return jsonResponse(403, { error: "Not your org" });
    if (connector.vendor !== "dropbox")
      return jsonResponse(400, { error: "Not a Dropbox connector" });

    const adapter = ADAPTERS[connector.vendor];
    if (!adapter)
      return jsonResponse(500, {
        error: "No adapter registered for this vendor",
      });

    const startedAt = Date.now();
    const runReport = {
      iterations: 0,
      totalRead: 0,
      totalWritten: 0,
      finished: false,
      lastStatus: null,
      endedReason: null,
    };
    const runsThisDrain = [];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
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
          resourceType: "files",
          triggeredBy: "drain_bg",
        });
      } catch (e) {
        runReport.endedReason = "exception";
        runReport.lastError = e?.message || String(e);
        break;
      }
      runReport.iterations += 1;
      runReport.totalRead += out?.rowsRead || 0;
      runReport.totalWritten += out?.rowsWritten || 0;
      runReport.lastStatus = out?.status || null;
      runsThisDrain.push(out);

      if (out?.status !== "partial") {
        runReport.finished = out?.status === "success";
        runReport.endedReason =
          out?.status === "success"
            ? "walk_complete"
            : out?.status === "error"
              ? "adapter_error"
              : `status_${out?.status || "unknown"}`;
        break;
      }

      if ((out?.rowsRead || 0) === 0) {
        runReport.finished = true;
        runReport.endedReason = "zero_row_partial";
        break;
      }

      await new Promise((r) => setTimeout(r, 250));
    }
    if (runReport.endedReason === null) runReport.endedReason = "iteration_cap";

    try {
      if (runsThisDrain.length) {
        await rollupConnectorSummary({
          bearer: SERVICE_ROLE_KEY,
          connectorId: connector.id,
          runs: runsThisDrain,
          connector,
        });
      }
    } catch (e) {
      console.warn(
        "[dropbox-drain-background] rollup failed:",
        e?.message || e,
      );
    }

    console.log(
      "[dropbox-drain-background] finished:",
      JSON.stringify(runReport),
    );

    return jsonResponse(200, runReport);
  } catch (e) {
    console.error("[dropbox-drain-background] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
