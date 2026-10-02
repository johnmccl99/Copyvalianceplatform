import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

function plaidHost(env) {
  if (env === "production") return "https://production.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://sandbox.plaid.com";
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

async function resolveAdmin(userJwt) {
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
  return {
    userId: p.id,
    orgId: p.org_id,
    isAdmin: p.is_admin === true || p.role === "gp_admin",
  };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 20 },
  });
  if (gate.error) return gate.error;

  const clientId = process.env.VITE_PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.VITE_PLAID_ENVIRONMENT || "sandbox";
  if (!clientId || !secret || !SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return jsonResponse(500, { error: "Server not configured" });
  }

  try {
    const { public_token, institution, accounts } = gate.body || {};
    if (
      !public_token ||
      typeof public_token !== "string" ||
      public_token.length > 2000
    ) {
      return jsonResponse(400, { error: "public_token required" });
    }

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdmin(userJwt);
    if (!profile?.userId)
      return jsonResponse(403, { error: "No user_profiles row" });
    if (!profile.isAdmin)
      return jsonResponse(403, { error: "Only org admins can connect banks" });

    const res = await fetch(`${plaidHost(env)}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, secret, public_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[plaid-exchange] Plaid error:", res.status, data);
      return jsonResponse(res.status, {
        error: "public_token exchange failed",
        detail: data?.error_message || data?.error_code || "unknown",
      });
    }

    const accessToken = data.access_token;
    const itemId = data.item_id;
    if (!accessToken || !itemId) {
      return jsonResponse(500, {
        error: "Plaid returned no access_token / item_id",
      });
    }

    const encRes = await sr("/rpc/plaid_encrypt_access_token", {
      method: "POST",
      body: { plaintext: accessToken },
    });
    if (!encRes.ok) {
      console.error(
        "[plaid-exchange] Encrypt failed:",
        encRes.status,
        encRes.raw,
      );
      return jsonResponse(500, { error: "Failed to persist access token" });
    }

    const upRes = await sr("/org_plaid_items?on_conflict=org_id%2Citem_id", {
      method: "POST",
      body: {
        org_id: profile.orgId,
        access_token_encrypted: encRes.body,
        item_id: itemId,
        institution_id: institution?.institution_id || institution?.id || null,
        institution_name: institution?.name || null,
        environment: env,
        status: "active",
        accounts_count: Array.isArray(accounts) ? accounts.length : 0,
        connected_by: profile.userId,
        last_error_code: null,
        last_error_message: null,
        last_error_at: null,
        revoked_at: null,
      },
      prefer: "resolution=merge-duplicates",
    });
    if (!upRes.ok) {
      console.error("[plaid-exchange] Upsert failed:", upRes.status, upRes.raw);
      return jsonResponse(500, { error: "Failed to persist plaid item" });
    }

    const connRes = await sr("/connectors?on_conflict=org_id%2Cvendor", {
      method: "POST",
      body: {
        org_id: profile.orgId,
        vendor: "plaid",
        display_name: "Plaid (Bank Accounts)",
        status: "connected",
        connected_by: profile.userId,
        config: { environment: env, schedule: "daily" },
      },
      prefer: "resolution=merge-duplicates",
    });
    if (!connRes.ok) {
      console.warn(
        "[plaid-exchange] connectors upsert warn:",
        connRes.status,
        connRes.raw,
      );
    }

    return jsonResponse(200, {
      persisted: true,
      item_id: itemId,
      institution_name: institution?.name || null,
      environment: env,
      accounts_count: Array.isArray(accounts) ? accounts.length : 0,
    });
  } catch (err) {
    console.error("[plaid-exchange] Unexpected:", err);
    return jsonResponse(500, { error: "Internal error", detail: err.message });
  }
};
