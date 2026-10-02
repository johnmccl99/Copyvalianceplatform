import { applySecurity, jsonResponse } from "./_security.js";

const DROPBOX_TEMP_LINK_URL =
  "https://api.dropboxapi.com/2/files/get_temporary_link";
const DROPBOX_ACCOUNT_INFO_URL =
  "https://api.dropboxapi.com/2/users/get_current_account";

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
    `${SUPABASE_URL}/rest/v1/user_profiles?auth_id=eq.${encodeURIComponent(sub)}&select=id,org_id&limit=1`,
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
  return { userId: rows[0].id, orgId: rows[0].org_id };
}

async function getAccessToken(acct, userJwt, siteUrl) {
  const expiresAt = acct.access_token_expires_at
    ? new Date(acct.access_token_expires_at)
    : null;
  const needsRefresh =
    !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (needsRefresh) {
    const refRes = await fetch(
      `${siteUrl}/.netlify/functions/dropbox-refresh-token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dropbox_account_id: acct.id }),
      },
    );
    const ref = await refRes.json().catch(() => ({}));
    if (!refRes.ok || !ref.access_token) return null;
    return ref.access_token;
  }
  const rowRes = await sr(
    `/org_dropbox_accounts?id=eq.${acct.id}&select=access_token_encrypted`,
  );
  if (!rowRes.ok || !rowRes.body?.[0]?.access_token_encrypted) return null;
  const dec = await sr("/rpc/dropbox_decrypt_access_token", {
    method: "POST",
    body: { p_ciphertext: rowRes.body[0].access_token_encrypted },
  });
  if (!dec.ok) return null;
  return dec.body;
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 60 },
  });
  if (gate.error) return gate.error;

  try {
    const { dropbox_file_id } = JSON.parse(event.body || "{}");
    if (!dropbox_file_id)
      return jsonResponse(400, { error: "dropbox_file_id required" });

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });

    const fileRes = await sr(
      `/dropbox_files?dropbox_file_id=eq.${encodeURIComponent(dropbox_file_id)}` +
        `&org_id=eq.${profile.orgId}&select=dropbox_account_id,name,path_display,kind,is_downloadable&limit=1`,
    );
    if (!fileRes.ok || !Array.isArray(fileRes.body) || !fileRes.body.length) {
      return jsonResponse(404, { error: "File not found" });
    }
    const fileRow = fileRes.body[0];
    if (fileRow.kind !== "file") {
      return jsonResponse(400, {
        error: "Not a file (folders cannot be downloaded)",
      });
    }
    if (fileRow.is_downloadable === false) {
      return jsonResponse(403, {
        error:
          "File is not downloadable per Dropbox (e.g. Google Doc stored in Dropbox)",
      });
    }

    const acctRes = await sr(
      `/org_dropbox_accounts?id=eq.${fileRow.dropbox_account_id}` +
        `&select=id,access_token_expires_at,status,team_member_id`,
    );
    if (!acctRes.ok || !Array.isArray(acctRes.body) || !acctRes.body.length) {
      return jsonResponse(404, { error: "Dropbox account not found" });
    }
    const acct = acctRes.body[0];
    if (acct.status !== "active") {
      return jsonResponse(409, {
        error: `Dropbox connection ${acct.status}; reconnect required`,
      });
    }

    const siteUrl =
      process.env.URL || "https://credashboardproperty.netlify.app";
    const accessToken = await getAccessToken(acct, userJwt, siteUrl);
    if (!accessToken)
      return jsonResponse(500, {
        error: "Could not acquire Dropbox access token",
      });

    const baseHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    let pathRootNs = null;
    try {
      const acctInfoRes = await fetch(DROPBOX_ACCOUNT_INFO_URL, {
        method: "POST",
        headers: baseHeaders,
        body: "null",
      });
      if (acctInfoRes.ok) {
        const info = await acctInfoRes.json().catch(() => ({}));
        const rootNs = info?.root_info?.root_namespace_id;
        const homeNs = info?.root_info?.home_namespace_id;
        if (rootNs && homeNs && String(rootNs) !== String(homeNs)) {
          pathRootNs = rootNs;
        }
      }
    } catch {}

    const linkHeaders = { ...baseHeaders };
    if (pathRootNs) {
      linkHeaders["Dropbox-API-Path-Root"] = JSON.stringify({
        ".tag": "root",
        root: String(pathRootNs),
      });
    }

    let linkRes = await fetch(DROPBOX_TEMP_LINK_URL, {
      method: "POST",
      headers: linkHeaders,
      body: JSON.stringify({ path: dropbox_file_id }),
    });
    let linkBody = await linkRes.json().catch(() => ({}));

    if (!linkRes.ok && pathRootNs) {
      linkRes = await fetch(DROPBOX_TEMP_LINK_URL, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ path: dropbox_file_id }),
      });
      linkBody = await linkRes.json().catch(() => ({}));
    }

    if (!linkRes.ok || !linkBody.link) {
      return jsonResponse(linkRes.status || 502, {
        error: "Dropbox get_temporary_link failed",
        details: linkBody.error_summary || linkBody.error || "unknown",
        path_root_tried: pathRootNs ? "root_then_home" : "home_only",
      });
    }

    return jsonResponse(200, {
      link: linkBody.link,
      name: fileRow.name,
      path_display: fileRow.path_display,
    });
  } catch (e) {
    console.error("[dropbox-download-link] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
