import { applySecurity, jsonResponse } from "./_security.js";

const DEFAULT_ALLOWED_REDIRECTS = [
  "https://credashboardproperty.netlify.app/auth/quickbooks/callback",
  "http://localhost:5173/auth/quickbooks/callback",
];

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

function isAllowedRedirect(uri) {
  const allowed = (process.env.ALLOWED_QB_REDIRECT_URIS || "")
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

async function resolveAdminProfile(userJwt) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?select=id,org_id,is_admin,role&limit=1`,
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
  const p = rows[0];
  const isAdmin = p.is_admin === true || p.role === "gp_admin";
  return { userId: p.id, orgId: p.org_id, isAdmin };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 20 },
  });
  if (gate.error) return gate.error;

  try {
    const { code, codeVerifier, redirectUri, realmId, environment } =
      gate.body || {};
    if (!code || !codeVerifier || !redirectUri || !realmId) {
      return jsonResponse(400, {
        error:
          "Missing required parameters (code, codeVerifier, redirectUri, realmId)",
      });
    }
    if (
      typeof code !== "string" ||
      code.length > 2000 ||
      typeof codeVerifier !== "string" ||
      codeVerifier.length > 200 ||
      typeof redirectUri !== "string" ||
      redirectUri.length > 500 ||
      typeof realmId !== "string" ||
      !/^[0-9]+$/.test(realmId)
    ) {
      return jsonResponse(400, { error: "Invalid parameter format" });
    }
    if (!isAllowedRedirect(redirectUri)) {
      console.error("[qb-token-exchange] Rejected redirectUri:", redirectUri);
      return jsonResponse(400, { error: "Invalid redirect URI" });
    }

    const clientId = process.env.VITE_QB_CLIENT_ID;
    const clientSecret = process.env.QB_CLIENT_SECRET;
    const env =
      environment === "sandbox"
        ? "sandbox"
        : process.env.VITE_QB_ENVIRONMENT || "production";
    if (!clientId || !clientSecret) {
      console.error(
        "[qb-token-exchange] Missing VITE_QB_CLIENT_ID / QB_CLIENT_SECRET env vars",
      );
      return jsonResponse(500, {
        error: "QuickBooks integration not configured",
      });
    }
    if (!SERVICE_ROLE_KEY || !SUPABASE_URL) {
      console.error(
        "[qb-token-exchange] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      );
      return jsonResponse(500, { error: "Server not configured" });
    }

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile?.userId) {
      return jsonResponse(403, {
        error: "No user_profiles row for this session",
      });
    }
    if (!profile.isAdmin) {
      return jsonResponse(403, {
        error: "Only org admins can connect QuickBooks",
      });
    }

    const tokenUrl =
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: params.toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[qb-token-exchange] Intuit error:", response.status, data);
      return jsonResponse(response.status, {
        error: "Token exchange failed",
        detail: data?.error_description || data?.error || "unknown",
      });
    }

    if (!data.refresh_token) {
      console.error("[qb-token-exchange] Intuit returned no refresh_token");
      return jsonResponse(500, {
        error: "Intuit did not return a refresh token",
      });
    }

    const encRes = await sr("/rpc/qb_encrypt_refresh_token", {
      method: "POST",
      body: { plaintext: data.refresh_token },
    });
    if (!encRes.ok) {
      console.error(
        "[qb-token-exchange] Encrypt failed:",
        encRes.status,
        encRes.raw,
      );
      return jsonResponse(500, { error: "Failed to persist refresh token" });
    }
    const encryptedHex = encRes.body;

    const accessExpiresAt = new Date(
      Date.now() + Number(data.expires_in || 3600) * 1000,
    ).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + Number(data.x_refresh_token_expires_in || 8726400) * 1000,
    ).toISOString();

    const upsertRes = await sr("/org_qb_integrations?on_conflict=org_id", {
      method: "POST",
      body: {
        org_id: profile.orgId,
        refresh_token_encrypted: encryptedHex,
        access_token_expires_at: accessExpiresAt,
        refresh_token_expires_at: refreshExpiresAt,
        realm_id: realmId,
        environment: env,
        scopes_granted: "com.intuit.quickbooks.accounting",
        connected_by: profile.userId,
        last_refreshed_at: new Date().toISOString(),
        last_refresh_error: null,
        last_error_at: null,
        revoked_at: null,
      },
      prefer: "resolution=merge-duplicates",
    });
    if (!upsertRes.ok) {
      console.error(
        "[qb-token-exchange] Upsert failed:",
        upsertRes.status,
        upsertRes.raw,
      );
      return jsonResponse(500, { error: "Failed to persist QB integration" });
    }

    const connectorRes = await sr("/connectors?on_conflict=org_id%2Cvendor", {
      method: "POST",
      body: {
        org_id: profile.orgId,
        vendor: "quickbooks",
        display_name: "QuickBooks Online",
        status: "connected",
        connected_by: profile.userId,
        config: { realm_id: realmId, environment: env, schedule: "daily" },
      },
      prefer: "resolution=merge-duplicates",
    });
    if (!connectorRes.ok) {
      console.error(
        "[qb-token-exchange] connectors upsert failed:",
        connectorRes.status,
        connectorRes.raw,
      );
    }

    return jsonResponse(200, {
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      realm_id: realmId,
      environment: env,
      persisted: true,
    });
  } catch (err) {
    console.error("[qb-token-exchange] Unexpected error:", err);
    return jsonResponse(500, { error: "Internal error", detail: err.message });
  }
};
