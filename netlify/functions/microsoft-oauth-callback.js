import { applySecurity, jsonResponse } from "./_security.js";

const DEFAULT_ALLOWED_REDIRECTS_WEB = [
  "https://credashboardproperty.netlify.app/auth/microsoft/callback-web",
  "http://localhost:5173/auth/microsoft/callback-web",
];

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const AZURE_FETCH_TIMEOUT_MS = 10_000;

function isAllowedRedirect(uri) {
  const allowed = (process.env.ALLOWED_REDIRECT_URIS_WEB || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ALLOWED_REDIRECTS_WEB;
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

async function postToAzureToken(tokenUrl, body) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), AZURE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    if (err?.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        data: {
          error: "timeout",
          error_description: "Azure /token request timed out",
        },
      };
    }
    return {
      ok: false,
      status: 502,
      data: {
        error: "network",
        error_description: err?.message || "fetch failed",
      },
    };
  } finally {
    clearTimeout(t);
  }
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
      console.error(
        "[microsoft-oauth-callback] Rejected redirectUri:",
        redirectUri,
      );
      return jsonResponse(400, { error: "Invalid redirect URI" });
    }

    const clientId =
      process.env.VITE_MS_CLIENT_ID || "3acf08d4-96db-4658-a210-8378a4b509ea";
    const clientSecret = process.env.MS_CONFIDENTIAL_CLIENT_SECRET || "";
    const tenantId = process.env.VITE_MS_TENANT_ID || "organizations";

    if (!clientId) {
      console.error(
        "[microsoft-oauth-callback] Missing VITE_MS_CLIENT_ID env var",
      );
      return jsonResponse(500, {
        error: "Microsoft integration not configured",
      });
    }
    if (!clientSecret) {
      console.error(
        "[microsoft-oauth-callback] Missing MS_CONFIDENTIAL_CLIENT_SECRET env var",
      );
      return jsonResponse(500, {
        error: "Server not configured for confidential-client OAuth",
      });
    }
    if (!SERVICE_ROLE_KEY || !SUPABASE_URL) {
      console.error(
        "[microsoft-oauth-callback] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
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
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const { ok, status, data } = await postToAzureToken(
      tokenUrl,
      params.toString(),
    );
    if (!ok) {
      console.error(
        "[microsoft-oauth-callback] Azure error:",
        status,
        data?.error,
        data?.error_description,
      );
      return jsonResponse(status >= 500 ? 502 : 400, {
        error: "Token exchange failed",
      });
    }

    let persisted = false;
    if (data.refresh_token) {
      const encRes = await sr("/rpc/ms_encrypt_refresh_token", {
        method: "POST",
        body: { plaintext: data.refresh_token },
      });
      if (!encRes.ok) {
        console.error(
          "[microsoft-oauth-callback] Encrypt failed:",
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
          "[microsoft-oauth-callback] Upsert failed:",
          upsertRes.status,
          upsertRes.raw,
        );
        return jsonResponse(500, { error: "Failed to persist MS integration" });
      }
      persisted = true;
    } else {
      console.warn(
        "[microsoft-oauth-callback] Azure did not return a refresh_token. " +
          "Ensure offline_access is in the requested scopes.",
      );
    }

    return jsonResponse(200, {
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      scope: data.scope,
      persisted,
    });
  } catch (err) {
    console.error("[microsoft-oauth-callback] Unexpected error:", err);
    return jsonResponse(500, { error: "Internal error" });
  }
};
