import { applySecurity, jsonResponse } from "./_security.js";
import { getDropboxAccessToken } from "./_dropbox-token.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

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

const pgFromSr = ({ path, method = "GET", body = null, prefer = null }) =>
  sr(path, { method, body, prefer });

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

async function resolveProfile(userJwt) {
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
  const flag = p.is_admin;
  const truthyAdmin =
    flag === true || flag === "t" || flag === "true" || flag === 1;
  const adminRole = ["admin", "gp_admin", "gp-admin"].includes(
    String(p.role || "").toLowerCase(),
  );
  return { userId: p.id, orgId: p.org_id, isAdmin: truthyAdmin || adminRole };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 30 },
  });
  if (gate.error) return gate.error;

  try {
    const { dropbox_account_id } = JSON.parse(event.body || "{}");
    if (!dropbox_account_id)
      return jsonResponse(400, { error: "dropbox_account_id required" });

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (!profile.isAdmin) return jsonResponse(403, { error: "Admin required" });

    const rowRes = await sr(
      `/org_dropbox_accounts?id=eq.${encodeURIComponent(dropbox_account_id)}&select=id,org_id&limit=1`,
    );
    if (!rowRes.ok || !Array.isArray(rowRes.body) || !rowRes.body.length) {
      return jsonResponse(404, { error: "Dropbox account not found" });
    }
    if (rowRes.body[0].org_id !== profile.orgId) {
      return jsonResponse(403, { error: "Not your org" });
    }

    const out = await getDropboxAccessToken({
      acctId: dropbox_account_id,
      pgFn: pgFromSr,
      path: "manual",
    });

    if (out.ok) {
      return jsonResponse(200, {
        ok: true,
        access_token: out.access_token,
        expires_at: out.expires_at,
      });
    }

    switch (out.class) {
      case "account_not_found":
        return jsonResponse(404, { error: "Dropbox account not found" });
      case "no_refresh_token":
        return jsonResponse(409, {
          error: "No refresh token stored — reconnect Dropbox",
          needs_reauth: true,
        });
      case "decrypt_failed":
        return jsonResponse(500, { error: "Refresh token decrypt failed" });
      case "config_missing":
      case "no_service_role":
        return jsonResponse(500, { error: "Server misconfiguration" });
      case "access_token_encrypt_failed":
        return jsonResponse(500, { error: "Access token encrypt failed" });
      case "no_access_token":
        return jsonResponse(502, { error: "Dropbox returned no access_token" });
      case "network_error":
        return jsonResponse(500, {
          error: "Internal error",
          message: out.detail,
        });
      case "invalid_grant":
      case "refresh_rejected":
      default:
        return jsonResponse(out.http || 502, {
          error: "Dropbox refresh failed",
          details: out.detail || "unknown",
          ...(out.needs_reauth ? { needs_reauth: true } : {}),
        });
    }
  } catch (e) {
    console.error("[dropbox-refresh-token] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
