import { applySecurity, jsonResponse } from "./_security.js";

const DEFAULT_ALLOWED_REDIRECTS = [
  "https://credashboardproperty.netlify.app/auth/dropbox/callback",
  "http://localhost:5173/auth/dropbox/callback",
];

const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_ACCOUNT_URL =
  "https://api.dropboxapi.com/2/users/get_current_account";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

function isAllowedRedirect(uri) {
  const allowed = (process.env.ALLOWED_DROPBOX_REDIRECT_URIS || "")
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
  if (!sub) {
    console.warn("[dropbox-token-exchange] JWT missing sub");
    return null;
  }
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
  const text = await r.text();
  let rows = null;
  try {
    rows = JSON.parse(text);
  } catch {}
  if (!Array.isArray(rows) || !rows.length) {
    console.warn(
      "[dropbox-token-exchange] resolveAdminProfile: empty result",
      r.status,
      text.slice(0, 200),
    );
    return null;
  }
  const p = rows[0];
  const flag = p.is_admin;
  const truthyAdmin =
    flag === true || flag === "t" || flag === "true" || flag === 1;
  const adminRole = ["admin", "gp_admin", "gp-admin"].includes(
    String(p.role || "").toLowerCase(),
  );
  const isAdmin = truthyAdmin || adminRole;
  console.log("[dropbox-token-exchange] admin-check:", {
    id: p.id?.slice(0, 8),
    role: p.role,
    is_admin: p.is_admin,
    isAdmin,
    rowCount: rows.length,
  });
  return {
    userId: p.id,
    orgId: p.org_id,
    isAdmin,
    _raw: {
      is_admin_val: p.is_admin,
      is_admin_type: typeof p.is_admin,
      role: p.role,
      rowCount: rows.length,
    },
  };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 20 },
  });
  if (gate.error) return gate.error;

  try {
    const clientId = process.env.VITE_DROPBOX_CLIENT_ID || "6cg2ou6edwamvng";
    const clientSecret = process.env.DROPBOX_CLIENT_SECRET;
    if (!clientSecret) {
      console.error("[dropbox-token-exchange] DROPBOX_CLIENT_SECRET not set");
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const { code, code_verifier, redirect_uri } = JSON.parse(
      event.body || "{}",
    );
    if (!code || !code_verifier || !redirect_uri) {
      return jsonResponse(400, {
        error: "code, code_verifier, redirect_uri required",
      });
    }
    if (!isAllowedRedirect(redirect_uri)) {
      return jsonResponse(400, { error: "Invalid redirect URI" });
    }

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (!profile.isAdmin) {
      return jsonResponse(403, {
        error: "Admin required",
        diagnostic: {
          resolvedProfileId: profile.userId?.slice(0, 8),
          resolvedOrgId: profile.orgId?.slice(0, 8),
          rawSnapshot: profile._raw || null,
        },
      });
    }

    const params = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri,
      code_verifier,
    });
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const tokenRes = await fetch(DROPBOX_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      console.error(
        "[dropbox-token-exchange] token exchange failed:",
        tokenRes.status,
        tokenBody,
      );
      return jsonResponse(tokenRes.status, {
        error: "Dropbox token exchange failed",
        details: tokenBody.error_description || tokenBody.error || "unknown",
      });
    }

    const {
      access_token,
      refresh_token,
      expires_in,
      scope,
      token_type,
      account_id,
      team_id,
    } = tokenBody;
    if (!access_token)
      return jsonResponse(502, { error: "Dropbox returned no access_token" });
    const expiresAt = new Date(
      Date.now() + (Number(expires_in) || 14400) * 1000,
    ).toISOString();

    const meRes = await fetch(DROPBOX_ACCOUNT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: "null",
    });
    const me = await meRes.json().catch(() => ({}));
    const dropboxAccountId = me.account_id || account_id;
    const email = me.email || "unknown@dropbox.local";
    const displayName = me.name?.display_name || null;
    const teamMemberId = me.team_member_id || null;
    const homeNamespaceId = me.root_info?.home_namespace_id || null;
    const rootInfoTag = me.root_info?.[".tag"] || null;
    const isTeamMember = !!(teamMemberId || team_id || rootInfoTag === "team");
    const accountType = isTeamMember
      ? teamMemberId
        ? "business_team"
        : "business"
      : "personal";

    const encRefresh = refresh_token
      ? await sr("/rpc/dropbox_encrypt_refresh_token", {
          method: "POST",
          body: { p_plaintext: refresh_token },
        })
      : { ok: true, body: null };
    if (!encRefresh.ok) {
      console.error(
        "[dropbox-token-exchange] refresh encrypt failed:",
        encRefresh.raw,
      );
      return jsonResponse(500, { error: "Token encryption failed" });
    }
    const encAccess = await sr("/rpc/dropbox_encrypt_access_token", {
      method: "POST",
      body: { p_plaintext: access_token },
    });
    if (!encAccess.ok) {
      console.error(
        "[dropbox-token-exchange] access encrypt failed:",
        encAccess.raw,
      );
      return jsonResponse(500, { error: "Token encryption failed" });
    }

    const scopesArr = (scope || "").split(/[\s,]+/).filter(Boolean);
    const acctRow = {
      org_id: profile.orgId,
      dropbox_account_id: dropboxAccountId,
      team_member_id: teamMemberId,
      account_type: accountType,
      email,
      display_name: displayName,
      home_namespace_id: homeNamespaceId,
      access_token_encrypted: encAccess.body,
      access_token_expires_at: expiresAt,
      scopes: scopesArr,
      status: "active",
      connected_by: profile.userId,
      connected_at: new Date().toISOString(),
    };
    if (encRefresh.body) {
      acctRow.refresh_token_encrypted = encRefresh.body;
    }
    const upsert = await sr(
      `/org_dropbox_accounts?on_conflict=org_id,dropbox_account_id`,
      {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: [acctRow],
      },
    );
    if (!upsert.ok) {
      console.error(
        "[dropbox-token-exchange] upsert failed:",
        upsert.status,
        upsert.raw,
      );
      return jsonResponse(upsert.status, {
        error: "Failed to persist Dropbox account",
      });
    }
    const account = Array.isArray(upsert.body) ? upsert.body[0] : upsert.body;

    return jsonResponse(200, {
      ok: true,
      user_profile_id: profile.userId,
      account: {
        id: account?.id,
        email,
        display_name: displayName,
        account_type: accountType,
      },
    });
  } catch (e) {
    console.error("[dropbox-token-exchange] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
