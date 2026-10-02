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

async function resolveOrgId(userJwt) {
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
    const clientId = process.env.VITE_QB_CLIENT_ID;
    const clientSecret = process.env.QB_CLIENT_SECRET;
    if (!clientId || !clientSecret || !SERVICE_ROLE_KEY || !SUPABASE_URL) {
      console.error("[qb-refresh-token] Missing env vars");
      return jsonResponse(500, { error: "Server not configured" });
    }

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveOrgId(userJwt);
    if (!profile?.orgId) {
      return jsonResponse(403, {
        error: "No user_profiles row for this session",
      });
    }

    const rowRes = await sr(
      `/org_qb_integrations?org_id=eq.${encodeURIComponent(profile.orgId)}` +
        `&select=id,refresh_token_encrypted,realm_id,environment,revoked_at&limit=1`,
    );
    if (!rowRes.ok || !Array.isArray(rowRes.body) || !rowRes.body.length) {
      return jsonResponse(404, {
        error: "Not connected to QuickBooks",
        reauth: true,
      });
    }
    const row = rowRes.body[0];
    if (row.revoked_at) {
      return jsonResponse(410, {
        error: "QuickBooks connection revoked",
        reauth: true,
      });
    }
    if (!row.refresh_token_encrypted) {
      return jsonResponse(404, {
        error: "No refresh token stored",
        reauth: true,
      });
    }

    const decRes = await sr("/rpc/qb_decrypt_refresh_token", {
      method: "POST",
      body: { ciphertext: row.refresh_token_encrypted },
    });
    if (!decRes.ok || typeof decRes.body !== "string" || !decRes.body.length) {
      console.error(
        "[qb-refresh-token] Decrypt failed:",
        decRes.status,
        decRes.raw,
      );
      return jsonResponse(500, { error: "Failed to decrypt refresh token" });
    }
    const refreshToken = decRes.body;

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: params.toString(),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorCode = data?.error || "unknown";
      const errorDesc = data?.error_description || "";
      console.error(
        "[qb-refresh-token] Intuit error:",
        response.status,
        errorCode,
        errorDesc,
      );
      const needsReauth = [
        "invalid_grant",
        "unauthorized_client",
        "invalid_client",
      ].includes(errorCode);
      await sr(`/org_qb_integrations?id=eq.${encodeURIComponent(row.id)}`, {
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

    if (!data.refresh_token) {
      console.error(
        "[qb-refresh-token] Intuit returned no refresh_token on rotation",
      );
      return jsonResponse(500, { error: "Unexpected Intuit response" });
    }
    const encRes = await sr("/rpc/qb_encrypt_refresh_token", {
      method: "POST",
      body: { plaintext: data.refresh_token },
    });
    if (!encRes.ok) {
      console.error(
        "[qb-refresh-token] Re-encrypt failed:",
        encRes.status,
        encRes.raw,
      );
      return jsonResponse(500, {
        error: "Failed to persist rotated refresh token",
      });
    }
    const accessExpiresAt = new Date(
      Date.now() + Number(data.expires_in || 3600) * 1000,
    ).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + Number(data.x_refresh_token_expires_in || 8726400) * 1000,
    ).toISOString();
    await sr(`/org_qb_integrations?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: {
        refresh_token_encrypted: encRes.body,
        access_token_expires_at: accessExpiresAt,
        refresh_token_expires_at: refreshExpiresAt,
        last_refreshed_at: new Date().toISOString(),
        last_refresh_error: null,
        last_error_at: null,
      },
    });

    return jsonResponse(200, {
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      realm_id: row.realm_id,
      environment: row.environment,
      rotated: true,
    });
  } catch (err) {
    console.error("[qb-refresh-token] Unexpected error:", err);
    return jsonResponse(500, { error: "Internal error" });
  }
};
