const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;

export const REFRESH_SKEW_MS = 5 * 60 * 1000;

const PG_TIMEOUT_MS = 30_000;

async function defaultPg({
  bearer,
  path,
  method = "GET",
  body = null,
  prefer = null,
}) {
  const headers = {
    apikey: bearer,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, PG_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { ok: res.ok, status: res.status, body: json, raw: text };
  } catch (e) {
    const isAbort =
      e?.name === "AbortError" || /abort/i.test(String(e?.message || ""));
    return {
      ok: false,
      status: 0,
      body: null,
      raw: isAbort
        ? `aborted: pg ${method} exceeded ${PG_TIMEOUT_MS}ms`
        : `fetch error: ${e?.message || String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function fail({
  cls,
  http = null,
  detail,
  needsReauth = false,
  orgId = null,
  acctId,
}) {
  console.error(
    `[dropbox-token] refresh failed acct=${acctId} class=${cls} http=${http === null ? "none" : http}`,
  );
  return {
    ok: false,
    class: cls,
    http,
    detail,
    needs_reauth: needsReauth,
    org_id: orgId,
  };
}

export async function getDropboxAccessToken({
  acctId,
  pgFn = defaultPg,
  nowMs = Date.now(),
  path = "manual",
  forceRefresh = false,
} = {}) {
  if (!acctId) {
    return fail({
      cls: "bad_request",
      detail: "acctId required",
      acctId: "none",
    });
  }

  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SERVICE_ROLE_KEY) {
    return fail({
      cls: "no_service_role",
      detail: "SUPABASE_SERVICE_ROLE_KEY not set",
      acctId,
    });
  }
  const pgSr = (opts) => pgFn({ ...opts, bearer: SERVICE_ROLE_KEY });

  const rowRes = await pgSr({
    path:
      `/org_dropbox_accounts?id=eq.${encodeURIComponent(acctId)}` +
      "&select=id,org_id,status,access_token_encrypted,access_token_expires_at,refresh_token_encrypted" +
      "&limit=1",
  });
  if (!rowRes.ok || !Array.isArray(rowRes.body) || !rowRes.body.length) {
    return fail({
      cls: "account_not_found",
      http: rowRes.status ?? null,
      detail: "Dropbox account not found",
      acctId,
    });
  }
  const row = rowRes.body[0];
  const orgId = row.org_id;

  if (
    !forceRefresh &&
    row.access_token_encrypted &&
    row.access_token_expires_at
  ) {
    const expMs = new Date(row.access_token_expires_at).getTime();
    if (Number.isFinite(expMs) && expMs - nowMs > REFRESH_SKEW_MS) {
      const dec = await pgSr({
        path: "/rpc/dropbox_decrypt_access_token",
        method: "POST",
        body: { p_ciphertext: row.access_token_encrypted },
      });
      if (dec.ok && typeof dec.body === "string" && dec.body.length) {
        return {
          ok: true,
          class: "cached",
          access_token: dec.body,
          expires_at: row.access_token_expires_at,
          rotated: false,
          cached: true,
          org_id: orgId,
        };
      }
    }
  }

  if (!row.refresh_token_encrypted) {
    await markNeedsReauth({
      pgSr,
      acctId,
      orgId,
      code: "no_refresh_token",
      message: "No refresh token stored — reconnect Dropbox",
      nowMs,
    });
    return fail({
      cls: "no_refresh_token",
      detail: "No refresh token stored — reconnect Dropbox",
      needsReauth: true,
      orgId,
      acctId,
    });
  }

  const decRes = await pgSr({
    path: "/rpc/dropbox_decrypt_refresh_token",
    method: "POST",
    body: { p_ciphertext: row.refresh_token_encrypted },
  });
  if (!decRes.ok || typeof decRes.body !== "string" || !decRes.body.length) {
    return fail({
      cls: "decrypt_failed",
      http: decRes.status ?? null,
      detail: "Refresh token decrypt failed",
      orgId,
      acctId,
    });
  }

  const clientId = process.env.VITE_DROPBOX_CLIENT_ID || "6cg2ou6edwamvng";
  const clientSecret = process.env.DROPBOX_CLIENT_SECRET;
  if (!clientSecret) {
    return fail({
      cls: "config_missing",
      detail: "DROPBOX_CLIENT_SECRET not set",
      orgId,
      acctId,
    });
  }
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decRes.body,
  });

  let tRes;
  try {
    tRes = await fetch(DROPBOX_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch (e) {
    return fail({
      cls: "network_error",
      detail: e?.message || "fetch failed",
      orgId,
      acctId,
    });
  }

  const tBody = await tRes.json().catch(() => ({}));

  if (!tRes.ok) {
    const isInvalidGrant = tBody && tBody.error === "invalid_grant";
    const detail = String(
      tBody?.error_description || tBody?.error || `HTTP ${tRes.status}`,
    ).slice(0, 300);
    if (isInvalidGrant) {
      await markNeedsReauth({
        pgSr,
        acctId,
        orgId,
        code: "invalid_grant",
        message: `Dropbox refresh rejected: ${detail}`,
        nowMs,
      });
      return fail({
        cls: "invalid_grant",
        http: tRes.status,
        detail,
        needsReauth: true,
        orgId,
        acctId,
      });
    }
    return fail({
      cls: "refresh_rejected",
      http: tRes.status,
      detail,
      orgId,
      acctId,
    });
  }

  const { access_token, expires_in, refresh_token } = tBody || {};
  if (!access_token) {
    return fail({
      cls: "no_access_token",
      http: tRes.status,
      detail: "Dropbox returned no access_token",
      orgId,
      acctId,
    });
  }
  const expiresAt = new Date(
    nowMs + (Number(expires_in) || 14400) * 1000,
  ).toISOString();

  const rotated = !!refresh_token;
  let rotatedCiphertext = null;
  if (rotated) {
    const encRefresh = await pgSr({
      path: "/rpc/dropbox_encrypt_refresh_token",
      method: "POST",
      body: { p_plaintext: refresh_token },
    });
    if (encRefresh.ok && encRefresh.body) {
      rotatedCiphertext = encRefresh.body;
    } else {
      console.error(
        "[dropbox-token] rotated refresh_token encrypt failed; preserving existing stored token",
      );
    }
  }

  const encAccess = await pgSr({
    path: "/rpc/dropbox_encrypt_access_token",
    method: "POST",
    body: { p_plaintext: access_token },
  });
  if (!encAccess.ok || !encAccess.body) {
    if (rotatedCiphertext) {
      await pgSr({
        path: `/org_dropbox_accounts?id=eq.${encodeURIComponent(acctId)}`,
        method: "PATCH",
        body: { refresh_token_encrypted: rotatedCiphertext },
        prefer: "return=minimal",
      });
    }
    return fail({
      cls: "access_token_encrypt_failed",
      http: encAccess.status ?? null,
      detail: "Access token encrypt failed",
      orgId,
      acctId,
    });
  }

  const patchBody = {
    access_token_encrypted: encAccess.body,
    access_token_expires_at: expiresAt,
    status: "active",
    last_error_code: null,
    last_error_message: null,
    last_error_at: null,
    ...(rotatedCiphertext
      ? { refresh_token_encrypted: rotatedCiphertext }
      : {}),
  };

  await pgSr({
    path: `/org_dropbox_accounts?id=eq.${encodeURIComponent(acctId)}`,
    method: "PATCH",
    body: patchBody,
    prefer: "return=minimal",
  });

  if (orgId) {
    await pgSr({
      path: `/connectors?org_id=eq.${encodeURIComponent(orgId)}&vendor=eq.dropbox&status=eq.needs_reauth`,
      method: "PATCH",
      body: { status: "connected", last_error_message: null },
      prefer: "return=minimal",
    });
  }

  console.log(
    `[dropbox-token] refresh ok acct=${acctId} rotated=${rotated} path=${path}`,
  );

  return {
    ok: true,
    class: "ok",
    access_token,
    expires_at: expiresAt,
    rotated,
    cached: false,
    org_id: orgId,
  };
}

async function markNeedsReauth({ pgSr, acctId, orgId, code, message, nowMs }) {
  const at = new Date(nowMs).toISOString();
  await pgSr({
    path: `/org_dropbox_accounts?id=eq.${encodeURIComponent(acctId)}`,
    method: "PATCH",
    body: {
      status: "needs_reauth",
      last_error_code: code,
      last_error_message: String(message).slice(0, 500),
      last_error_at: at,
    },
    prefer: "return=minimal",
  });
  if (!orgId) return;
  await pgSr({
    path: `/connectors?org_id=eq.${encodeURIComponent(orgId)}&vendor=eq.dropbox`,
    method: "PATCH",
    body: {
      status: "needs_reauth",
      last_error_message: String(message).slice(0, 500),
    },
    prefer: "return=minimal",
  });
}
