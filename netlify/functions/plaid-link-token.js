import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

function plaidHost(env) {
  if (env === "production") return "https://production.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://sandbox.plaid.com";
}

async function resolveUser(userJwt) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?select=id,org_id,is_admin,role,email&limit=1`,
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
    email: p.email,
    isAdmin: p.is_admin === true || p.role === "gp_admin",
  };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 30 },
    parseBody: false,
  });
  if (gate.error) return gate.error;

  const clientId = process.env.VITE_PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.VITE_PLAID_ENVIRONMENT || "sandbox";
  const webhook = process.env.VITE_PLAID_WEBHOOK_URL || null;

  if (!clientId || !secret) {
    console.error(
      "[plaid-link-token] Missing VITE_PLAID_CLIENT_ID / PLAID_SECRET env vars",
    );
    return jsonResponse(500, {
      error:
        "Plaid not configured. Set VITE_PLAID_CLIENT_ID, PLAID_SECRET, VITE_PLAID_ENVIRONMENT in Netlify env.",
    });
  }

  try {
    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveUser(userJwt);
    if (!profile?.userId) {
      return jsonResponse(403, {
        error: "No user_profiles row for this Supabase user",
      });
    }
    if (!profile.isAdmin) {
      return jsonResponse(403, {
        error: "Only org admins can connect bank accounts",
      });
    }

    const body = {
      client_id: clientId,
      secret,
      client_name: "Valiance Capital",
      user: { client_user_id: profile.userId },
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
      ...(webhook ? { webhook } : {}),
    };

    const res = await fetch(`${plaidHost(env)}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[plaid-link-token] Plaid error:", res.status, data);
      return jsonResponse(res.status, {
        error: "Failed to create Plaid Link token",
        detail: data?.error_message || data?.error_code || "unknown",
      });
    }

    return jsonResponse(200, {
      link_token: data.link_token,
      expiration: data.expiration,
      environment: env,
    });
  } catch (err) {
    console.error("[plaid-link-token] Unexpected:", err);
    return jsonResponse(500, { error: "Internal error", detail: err.message });
  }
};
