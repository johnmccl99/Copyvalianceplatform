import { applySecurity, jsonResponse } from "./_security.js";

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

async function resolveUserProfile(userJwt) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?select=id,org_id&limit=1`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        Accept: "application/json",
      },
    },
  );
  const text = await r.text();
  let rows = null;
  try {
    rows = JSON.parse(text);
  } catch {}
  if (!Array.isArray(rows) || !rows.length) return null;
  return { userId: rows[0].id, orgId: rows[0].org_id };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 30 },
  });
  if (gate.error) return gate.error;

  try {
    const clientId =
      process.env.VITE_MS_CLIENT_ID || "3acf08d4-96db-4658-a210-8378a4b509ea";
    const tenantId = process.env.VITE_MS_TENANT_ID || "organizations";
    if (!clientId || !SERVICE_ROLE_KEY || !SUPABASE_URL) {
      console.error(
        "[ms-refresh-token] Missing env vars (need clientId, SERVICE_ROLE_KEY, SUPABASE_URL)",
      );
      return jsonResponse(500, { error: "Server not configured" });
    }

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveUserProfile(userJwt);
    if (!profile?.userId) {
      return jsonResponse(403, {
        error: "No user_profiles row for this Supabase user",
      });
    }

    const rowRes = await sr(
      `/user_ms_integrations?user_id=eq.${encodeURIComponent(profile.userId)}` +
        `&select=id,user_id,refresh_token_encrypted,revoked_at&limit=1`,
    );
    if (!rowRes.ok || !Array.isArray(rowRes.body) || !rowRes.body.length) {
      return jsonResponse(404, {
        error: "Not connected to Microsoft",
        reauth: true,
      });
    }
    const row = rowRes.body[0];
    if (row.revoked_at) {
      return jsonResponse(410, {
        error: "Microsoft connection revoked",
        reauth: true,
      });
    }
    if (!row.refresh_token_encrypted) {
      return jsonResponse(404, {
        error: "No refresh token stored",
        reauth: true,
      });
    }

    const decRes = await sr("/rpc/ms_decrypt_refresh_token", {
      method: "POST",
      body: { ciphertext: row.refresh_token_encrypted },
    });
    if (!decRes.ok || typeof decRes.body !== "string" || !decRes.body.length) {
      console.error(
        "[ms-refresh-token] Decrypt failed:",
        decRes.status,
        decRes.raw,
      );
      return jsonResponse(500, { error: "Failed to decrypt refresh token" });
    }
    const refreshToken = decRes.body;

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://credashboardproperty.netlify.app",
      },
      body: params.toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorCode = data?.error || "unknown";
      const errorDesc = data?.error_description || "";
      console.error(
        "[ms-refresh-token] Azure error:",
        response.status,
        errorCode,
        errorDesc,
      );

      const needsReauth = [
        "invalid_grant",
        "interaction_required",
        "consent_required",
        "invalid_client",
        "unauthorized_client",
      ].includes(errorCode);

      await sr(`/user_ms_integrations?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: {
          last_refresh_error: `${errorCode}: ${errorDesc}`.slice(0, 500),
          last_error_at: new Date().toISOString(),
          ...(needsReauth ? { revoked_at: new Date().toISOString() } : {}),
        },
      });
      return jsonResponse(response.status, {
        error: "Refresh failed",
        reauth: needsReauth,
      });
    }

    let persisted = false;
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      const encRes = await sr("/rpc/ms_encrypt_refresh_token", {
        method: "POST",
        body: { plaintext: data.refresh_token },
      });
      if (encRes.ok) {
        await sr(`/user_ms_integrations?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: {
            refresh_token_encrypted: encRes.body,
            last_refreshed_at: new Date().toISOString(),
            last_refresh_error: null,
            last_error_at: null,
          },
        });
        persisted = true;
      }
    } else {
      await sr(`/user_ms_integrations?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: {
          last_refreshed_at: new Date().toISOString(),
          last_refresh_error: null,
          last_error_at: null,
        },
      });
    }

    return jsonResponse(200, {
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      scope: data.scope,
      rotated: persisted,
    });
  } catch (err) {
    console.error("[ms-refresh-token] Unexpected error:", err);
    return jsonResponse(500, { error: "Internal error" });
  }
};
