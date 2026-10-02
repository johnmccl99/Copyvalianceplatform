import { applySecurity, jsonResponse } from "./_security.js";

const DEFAULT_ALLOWED_REDIRECTS = [
  "https://credashboardproperty.netlify.app/auth/microsoft/callback",
  "http://localhost:5173/auth/microsoft/callback",
];

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

function isAllowedRedirect(uri) {
  const allowed = (process.env.ALLOWED_REDIRECT_URIS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ALLOWED_REDIRECTS;
  return list.includes(uri);
}

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
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?auth_id=eq.${""}`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        Accept: "application/json",
      },
    },
  );
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
    rateLimit: { maxPerMinute: 20 },
  });
  if (gate.error) return gate.error;

  try {
    const { code, codeVerifier, redirectUri } = gate.body || {};
    if (!code || !codeVerifier || !redirectUri) {
      return jsonResponse(400, { error: "Missing required parameters" });
    }
    if (
      typeof code !== "string" ||
      code.length > 2000 ||
      typeof codeVerifier !== "string" ||
      codeVerifier.length > 200 ||
      typeof redirectUri !== "string" ||
      redirectUri.length > 500
    ) {
      return jsonResponse(400, { error: "Invalid parameter format" });
    }
    if (!isAllowedRedirect(redirectUri)) {
      console.error("[ms-token-exchange] Rejected redirectUri:", redirectUri);
      return jsonResponse(400, { error: "Invalid redirect URI" });
    }

    const clientId =
      process.env.VITE_MS_CLIENT_ID || "3acf08d4-96db-4658-a210-8378a4b509ea";
    const tenantId = process.env.VITE_MS_TENANT_ID || "organizations";
    if (!clientId) {
      console.error(
        "[ms-token-exchange] Missing VITE_MS_CLIENT_ID env var (and no fallback)",
      );
      return jsonResponse(500, {
        error: "Microsoft integration not configured",
      });
    }
    if (!SERVICE_ROLE_KEY || !SUPABASE_URL) {
      console.error(
        "[ms-token-exchange] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      );
      return jsonResponse(500, {
        error: "Server not configured for persistent MS integration",
      });
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

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const redirectOrigin = (() => {
      try {
        return new URL(redirectUri).origin;
      } catch {
        return "https://credashboardproperty.netlify.app";
      }
    })();
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: redirectOrigin,
      },
      body: params.toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[ms-token-exchange] Azure error:", response.status, data);
      return jsonResponse(response.status, { error: "Token exchange failed" });
    }

    if (data.refresh_token) {
      const encRes = await sr("/rpc/ms_encrypt_refresh_token", {
        method: "POST",
        body: { plaintext: data.refresh_token },
      });
      if (!encRes.ok) {
        console.error(
          "[ms-token-exchange] Encrypt failed:",
          encRes.status,
          encRes.raw,
        );
        return jsonResponse(500, { error: "Failed to persist refresh token" });
      }
      const encryptedHex = encRes.body;

      let msUserId = null,
        msTenantId = null;
      if (
        typeof data.id_token === "string" &&
        data.id_token.split(".").length === 3
      ) {
        try {
          const payload = JSON.parse(
            Buffer.from(data.id_token.split(".")[1], "base64url").toString(
              "utf8",
            ),
          );
          msUserId = payload.oid || null;
          msTenantId = payload.tid || null;
        } catch {}
      }

      const upsertRes = await sr("/user_ms_integrations?on_conflict=user_id", {
        method: "POST",
        body: {
          user_id: profile.userId,
          org_id: profile.orgId,
          refresh_token_encrypted: encryptedHex,
          scopes_granted: data.scope || "",
          ms_user_id: msUserId,
          ms_tenant_id: msTenantId,
          last_refreshed_at: new Date().toISOString(),
          last_refresh_error: null,
          last_error_at: null,
          revoked_at: null,
        },
        prefer: "resolution=merge-duplicates",
      });
      if (!upsertRes.ok) {
        console.error(
          "[ms-token-exchange] Upsert failed:",
          upsertRes.status,
          upsertRes.raw,
        );
        return jsonResponse(500, { error: "Failed to persist MS integration" });
      }
    } else {
      console.warn(
        "[ms-token-exchange] Azure did not return a refresh_token. " +
          "Ensure offline_access is in the requested scopes.",
      );
    }

    return jsonResponse(200, {
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      scope: data.scope,
      persisted: !!data.refresh_token,
    });
  } catch (err) {
    console.error("[ms-token-exchange] Unexpected error:", err);
    return jsonResponse(500, { error: "Internal error" });
  }
};
