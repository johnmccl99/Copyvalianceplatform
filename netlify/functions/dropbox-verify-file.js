import { applySecurity, jsonResponse } from "./_security.js";
import { dbxApi } from "./_connector-adapters.js";

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

async function resolvePathRootNs(accessToken) {
  try {
    const acctInfo = await dbxApi(
      "/users/get_current_account",
      accessToken,
      null,
    );
    if (acctInfo.ok && acctInfo.body?.root_info) {
      const rootNs = acctInfo.body.root_info.root_namespace_id;
      const homeNs = acctInfo.body.root_info.home_namespace_id;
      if (rootNs && homeNs && String(rootNs) !== String(homeNs)) {
        return rootNs;
      }
    }
  } catch {}
  return null;
}

export function compareMetadata(cached, live) {
  const mismatched = [];
  if ((cached.content_hash || null) !== (live.content_hash || null))
    mismatched.push("content_hash");
  const cachedSm = cached.server_modified
    ? Date.parse(cached.server_modified)
    : null;
  const liveSm = live.server_modified ? Date.parse(live.server_modified) : null;
  if (cachedSm !== liveSm) mismatched.push("server_modified");
  if ((cached.size_bytes ?? null) !== (live.size_bytes ?? null))
    mismatched.push("size_bytes");
  if ((cached.rev || null) !== (live.rev || null)) mismatched.push("rev");
  return { fresh: mismatched.length === 0, mismatched_fields: mismatched };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 10 },
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
        `&org_id=eq.${profile.orgId}` +
        `&select=id,dropbox_account_id,name,path_display,kind,content_hash,server_modified,size_bytes,rev,last_seen_at` +
        `&limit=1`,
    );
    if (!fileRes.ok || !Array.isArray(fileRes.body) || !fileRes.body.length) {
      return jsonResponse(404, { error: "File not found" });
    }
    const fileRow = fileRes.body[0];
    if (fileRow.kind !== "file") {
      return jsonResponse(400, {
        error: "Not a file (folders have no content_hash to verify)",
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

    const pathRootNs = await resolvePathRootNs(accessToken);

    let meta = await dbxApi(
      "/files/get_metadata",
      accessToken,
      {
        path: dropbox_file_id,
        include_media_info: false,
        include_deleted: false,
        include_has_explicit_shared_members: false,
      },
      pathRootNs,
    );

    if (!meta.ok && pathRootNs) {
      meta = await dbxApi(
        "/files/get_metadata",
        accessToken,
        {
          path: dropbox_file_id,
          include_media_info: false,
          include_deleted: false,
          include_has_explicit_shared_members: false,
        },
        null,
      );
    }

    if (!meta.ok) {
      const errTag = meta.body?.error?.[".tag"] || null;
      const pathErrTag = meta.body?.error?.path?.[".tag"] || null;
      if (
        meta.status === 409 &&
        errTag === "path" &&
        pathErrTag === "not_found"
      ) {
        return jsonResponse(200, {
          fresh: false,
          deleted: true,
          name: fileRow.name,
          path_display: fileRow.path_display,
          cached_before_verify: {
            content_hash: fileRow.content_hash,
            server_modified: fileRow.server_modified,
            size_bytes: fileRow.size_bytes,
            rev: fileRow.rev,
            last_seen_at: fileRow.last_seen_at,
          },
        });
      }
      return jsonResponse(meta.status || 502, {
        error: "Dropbox get_metadata failed",
        details: meta.body?.error_summary || meta.body?.error || "unknown",
        path_root_tried: pathRootNs ? "root_then_home" : "home_only",
      });
    }

    const live = {
      content_hash: meta.body.content_hash || null,
      server_modified: meta.body.server_modified || null,
      client_modified: meta.body.client_modified || null,
      size_bytes: meta.body.size ?? null,
      rev: meta.body.rev || null,
    };
    const cached_before_verify = {
      content_hash: fileRow.content_hash,
      server_modified: fileRow.server_modified,
      size_bytes: fileRow.size_bytes,
      rev: fileRow.rev,
      last_seen_at: fileRow.last_seen_at,
    };
    const cmp = compareMetadata(cached_before_verify, live);

    const nowIso = new Date().toISOString();
    const patchBody = { last_seen_at: nowIso };
    let cache_updated = false;
    if (!cmp.fresh) {
      patchBody.content_hash = live.content_hash;
      patchBody.server_modified = live.server_modified;
      patchBody.client_modified = live.client_modified;
      patchBody.size_bytes = live.size_bytes;
      patchBody.rev = live.rev;
      cache_updated = true;
    }
    await sr(`/dropbox_files?id=eq.${encodeURIComponent(fileRow.id)}`, {
      method: "PATCH",
      body: patchBody,
      prefer: "return=minimal",
    });

    return jsonResponse(200, {
      fresh: cmp.fresh,
      mismatched_fields: cmp.mismatched_fields,
      name: fileRow.name,
      path_display: fileRow.path_display,
      live: {
        content_hash: live.content_hash,
        server_modified: live.server_modified,
        size_bytes: live.size_bytes,
        rev: live.rev,
      },
      cached_before_verify,
      cache_updated,
    });
  } catch (e) {
    console.error("[dropbox-verify-file] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
