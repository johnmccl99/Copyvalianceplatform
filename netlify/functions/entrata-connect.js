import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const ENTRATA_BASE = {
  us: "https://apis.entrata.com/ext/orgs",
  eu: "https://apis.entrata.global/ext/orgs",
};

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

function entrataRpcBody(methodName, params = {}) {
  return {
    auth: { type: "apikey" },
    requestId: Math.floor(Math.random() * 1_000_000),
    method: { name: methodName, version: "r1", params },
  };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 10 },
  });
  if (gate.error) return gate.error;

  try {
    const { subdomain, api_key, region } = JSON.parse(event.body || "{}");
    if (!subdomain || !/^[a-z0-9][a-z0-9-]{0,60}$/i.test(String(subdomain))) {
      return jsonResponse(400, {
        error: "Valid subdomain required (letters, digits, hyphens)",
      });
    }
    if (!api_key || typeof api_key !== "string" || api_key.length < 8) {
      return jsonResponse(400, { error: "api_key required" });
    }
    const regionKey = region === "eu" ? "eu" : "us";
    const baseUrl = ENTRATA_BASE[regionKey];

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (!profile.isAdmin) return jsonResponse(403, { error: "Admin required" });

    const statusRes = await fetch(
      `${baseUrl}/${encodeURIComponent(subdomain)}/v1/status`,
      {
        method: "POST",
        headers: {
          "X-Api-Key": api_key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(entrataRpcBody("getStatus")),
      },
    );
    const statusText = await statusRes.text();
    let statusBody = null;
    try {
      statusBody = JSON.parse(statusText);
    } catch {}

    if (!statusRes.ok) {
      console.warn(
        "[entrata-connect] getStatus failed:",
        statusRes.status,
        statusText.slice(0, 400),
      );
      return jsonResponse(statusRes.status, {
        error: "Entrata rejected the credentials",
        details:
          statusBody?.response?.error?.message ||
          statusBody?.error ||
          statusText.slice(0, 300),
      });
    }

    let displayName = null;
    try {
      const cliRes = await fetch(
        `${baseUrl}/${encodeURIComponent(subdomain)}/v1/appinfo`,
        {
          method: "POST",
          headers: {
            "X-Api-Key": api_key,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(entrataRpcBody("getAccessibleClients")),
        },
      );
      if (cliRes.ok) {
        const cli = await cliRes.json().catch(() => null);
        const clients =
          cli?.response?.result?.clients?.client ||
          cli?.response?.result?.clients ||
          [];
        const first = Array.isArray(clients) ? clients[0] : clients;
        displayName = first?.name || first?.companyName || null;
      }
    } catch {}

    const encRes = await sr("/rpc/entrata_encrypt_api_key", {
      method: "POST",
      body: { p_plaintext: api_key },
    });
    if (!encRes.ok) {
      console.error("[entrata-connect] api_key encrypt failed:", encRes.raw);
      return jsonResponse(500, { error: "Credential encryption failed" });
    }

    const upsert = await sr(
      `/org_entrata_accounts?on_conflict=org_id,subdomain`,
      {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: [
          {
            org_id: profile.orgId,
            subdomain,
            region: regionKey,
            display_name: displayName,
            api_key_encrypted: encRes.body,
            status: "active",
            connected_by: profile.userId,
            connected_at: new Date().toISOString(),
            last_error_code: null,
            last_error_message: null,
            last_error_at: null,
          },
        ],
      },
    );
    if (!upsert.ok) {
      console.error(
        "[entrata-connect] upsert failed:",
        upsert.status,
        upsert.raw,
      );
      return jsonResponse(upsert.status, {
        error: "Failed to persist Entrata account",
      });
    }
    const account = Array.isArray(upsert.body) ? upsert.body[0] : upsert.body;

    const connRow = await sr(`/connectors?on_conflict=org_id,vendor`, {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [
        {
          org_id: profile.orgId,
          vendor: "entrata",
          display_name: displayName || `Entrata (${subdomain})`,
          status: "connected",
        },
      ],
    });
    if (!connRow.ok || !Array.isArray(connRow.body) || !connRow.body[0]?.id) {
      console.error(
        "[entrata-connect] connectors upsert failed:",
        connRow.status,
        connRow.raw,
      );
      return jsonResponse(500, {
        error: "Stored credentials, but could not register the connector",
        details: (connRow.raw || "").slice(0, 300),
      });
    }
    await sr(`/org_entrata_accounts?id=eq.${account?.id}`, {
      method: "PATCH",
      body: { connector_id: connRow.body[0].id },
      prefer: "return=minimal",
    });

    return jsonResponse(200, {
      ok: true,
      account: {
        id: account?.id,
        subdomain,
        region: regionKey,
        display_name: displayName,
      },
    });
  } catch (e) {
    console.error("[entrata-connect] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
