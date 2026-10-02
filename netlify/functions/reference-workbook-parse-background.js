import * as XLSX from "xlsx";
import { applySecurity, jsonResponse } from "./_security.js";
import { parseReferenceWorkbook } from "./_reference-workbook-parser.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const MS_APP_TENANT_ID = process.env.MS_APP_TENANT_ID || "";
const MS_APP_CLIENT_ID = process.env.MS_APP_CLIENT_ID || "";
const MS_APP_CLIENT_SECRET = process.env.MS_APP_CLIENT_SECRET || "";

const DROPBOX_CLIENT_ID = process.env.DROPBOX_CLIENT_ID || "";
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET || "";
const DROPBOX_TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const DROPBOX_ACCOUNT_INFO_URL =
  "https://api.dropboxapi.com/2/users/get_current_account";
const DROPBOX_TEMP_LINK_URL =
  "https://api.dropboxapi.com/2/files/get_temporary_link";

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

const INSERT_BATCH_SIZE = 500;

async function fetchWithTimeout(
  url,
  opts = {},
  timeoutMs = 60_000,
  label = "fetch",
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function sr(
  path,
  { method = "GET", body = null, prefer = null, schema = "public" } = {},
) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (schema && schema !== "public") {
    if (method === "GET") headers["Accept-Profile"] = schema;
    else headers["Content-Profile"] = schema;
  }
  if (prefer) headers.Prefer = prefer;

  const url = `${SUPABASE_URL}/rest/v1${path}`;
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      lastErr = e;
      if (attempt < RETRY_MAX_ATTEMPTS) {
        await new Promise((r) =>
          setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)),
        );
        continue;
      }
      throw e;
    }
    if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { ok: res.ok, status: res.status, body: json, raw: text };
    }
    const errText = await res.text().catch(() => "");
    if (attempt < RETRY_MAX_ATTEMPTS) {
      await new Promise((r) =>
        setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)),
      );
      continue;
    }
    return { ok: false, status: res.status, body: null, raw: errText };
  }
  if (lastErr) throw lastErr;
  return { ok: false, status: 0, body: null, raw: "exhausted retries" };
}

async function srInsertBatched(path, rows, opts = {}) {
  if (!rows.length) return;
  const batchSize = opts.batchSize || INSERT_BATCH_SIZE;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const r = await sr(path, {
      method: "POST",
      body: chunk,
      prefer: "return=minimal",
      schema: opts.schema || "public",
    });
    if (!r.ok) {
      throw new Error(
        `Batch insert to ${path} failed at offset ${i}: HTTP ${r.status} ${(r.raw || "").slice(0, 200)}`,
      );
    }
  }
}

function decodeJwtSub(jwt) {
  try {
    const [, payloadB64] = jwt.split(".");
    return (
      JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")).sub || null
    );
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
  const adminTrue =
    p.is_admin === true || p.is_admin === "t" || p.is_admin === 1;
  const adminRole = ["admin", "gp_admin", "gp-admin"].includes(
    String(p.role || "").toLowerCase(),
  );
  return { userId: p.id, orgId: p.org_id, isAdmin: adminTrue || adminRole };
}

let _msAppTokenCache = null;
let _msAppTokenExpiresAt = 0;

async function getMsAppToken() {
  if (!MS_APP_TENANT_ID || !MS_APP_CLIENT_ID || !MS_APP_CLIENT_SECRET) {
    return {
      error:
        "MS_APP_TENANT_ID / MS_APP_CLIENT_ID / MS_APP_CLIENT_SECRET not configured. Set in Netlify env + grant Files.Read.All application permission on the Azure AD app registration.",
    };
  }
  if (_msAppTokenCache && Date.now() < _msAppTokenExpiresAt - 60_000) {
    return { accessToken: _msAppTokenCache };
  }
  const body = new URLSearchParams({
    client_id: MS_APP_CLIENT_ID,
    client_secret: MS_APP_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  let res;
  try {
    res = await fetchWithTimeout(
      `https://login.microsoftonline.com/${encodeURIComponent(MS_APP_TENANT_ID)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      30_000,
      "azure ad app-token mint",
    );
  } catch (e) {
    return {
      error: `Azure AD token endpoint unreachable: ${e?.message || String(e)}`,
    };
  }
  if (!res.ok) {
    return { error: `Azure AD app-token mint failed (HTTP ${res.status})` };
  }
  const data = await res.json().catch(() => ({}));
  if (!data.access_token)
    return { error: "Azure AD response missing access_token" };
  _msAppTokenCache = data.access_token;
  _msAppTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return { accessToken: _msAppTokenCache };
}

async function getSharePointFileBytes({ driveId, itemId }) {
  if (!driveId || !itemId)
    return { error: "SharePoint envelope missing driveId or itemId" };
  const tok = await getMsAppToken();
  if (tok.error) return { error: tok.error };

  let metaRes;
  try {
    metaRes = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,webUrl,lastModifiedDateTime`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } },
      30_000,
      "graph sharepoint item meta",
    );
  } catch (e) {
    return {
      error: `SharePoint item metadata fetch timeout: ${e?.message || String(e)}`,
    };
  }
  if (metaRes.status === 404)
    return { error: "SharePoint item not found (404)." };
  if (metaRes.status === 403)
    return {
      error:
        "SharePoint item access denied (403). Confirm Files.Read.All application permission is granted + admin consent on the Azure AD app.",
    };
  if (!metaRes.ok)
    return {
      error: `SharePoint item metadata fetch failed (HTTP ${metaRes.status})`,
    };
  const meta = await metaRes.json().catch(() => ({}));
  if (!meta?.file)
    return {
      error: "SharePoint item is not a file (folders cannot be ingested).",
    };

  let contentRes;
  try {
    contentRes = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } },
      180_000,
      "graph sharepoint content",
    );
  } catch (e) {
    return {
      error: `SharePoint file download timeout: ${e?.message || String(e)}`,
    };
  }
  if (!contentRes.ok)
    return {
      error: `SharePoint file download failed: HTTP ${contentRes.status}`,
    };

  return {
    buf: Buffer.from(await contentRes.arrayBuffer()),
    meta: {
      name: meta.name,
      size: meta.size,
      webUrl: meta.webUrl,
      lastModifiedDateTime: meta.lastModifiedDateTime,
    },
  };
}

async function refreshAccessTokenInline(acctId) {
  if (!DROPBOX_CLIENT_SECRET) return { error: "DROPBOX_CLIENT_SECRET not set" };
  const rowRes = await sr(
    `/org_dropbox_accounts?id=eq.${encodeURIComponent(acctId)}&select=id,org_id,refresh_token_encrypted`,
  );
  if (!rowRes.ok || !rowRes.body?.length)
    return { error: `Dropbox account row not found: ${acctId}` };
  const row = rowRes.body[0];
  if (!row.refresh_token_encrypted)
    return { error: "No refresh token stored — reconnect Dropbox" };

  const decRes = await sr("/rpc/dropbox_decrypt_refresh_token", {
    method: "POST",
    body: { p_ciphertext: row.refresh_token_encrypted },
  });
  if (!decRes.ok || !decRes.body)
    return { error: `Refresh token decrypt failed: HTTP ${decRes.status}` };

  const basicAuth = Buffer.from(
    `${DROPBOX_CLIENT_ID}:${DROPBOX_CLIENT_SECRET}`,
  ).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decRes.body,
  });
  let tRes;
  try {
    tRes = await fetchWithTimeout(
      DROPBOX_TOKEN_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
      30_000,
      "dropbox token refresh",
    );
  } catch (e) {
    return {
      error: `Dropbox token endpoint unreachable: ${e?.message || String(e)}`,
    };
  }
  const tText = await tRes.text();
  let tBody = null;
  try {
    tBody = tText ? JSON.parse(tText) : null;
  } catch {}
  if (!tRes.ok || !tBody?.access_token) {
    return { error: `Dropbox token refresh failed (HTTP ${tRes.status})` };
  }
  return { accessToken: tBody.access_token };
}

async function getDropboxFileBytes({ envelope }) {
  if (!envelope?.dropbox_account_id)
    return { error: "Dropbox envelope missing dropbox_account_id" };
  if (!envelope?.dropbox_file_id)
    return { error: "Dropbox envelope missing dropbox_file_id" };

  const acctRes = await sr(
    `/org_dropbox_accounts?id=eq.${envelope.dropbox_account_id}&select=id,status,team_member_id`,
  );
  if (!acctRes.ok || !acctRes.body?.length)
    return { error: "Dropbox account not found" };
  const acct = acctRes.body[0];
  if (acct.status !== "active")
    return { error: `Dropbox account status: ${acct.status}` };

  const refresh = await refreshAccessTokenInline(acct.id);
  if (refresh.error) return { error: refresh.error };
  const accessToken = refresh.accessToken;

  let pathRootNs = null;
  try {
    const infoRes = await fetchWithTimeout(
      DROPBOX_ACCOUNT_INFO_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: "null",
      },
      30_000,
      "dropbox account_info",
    );
    if (infoRes.ok) {
      const info = await infoRes.json().catch(() => ({}));
      const rn = info?.root_info?.root_namespace_id;
      const hn = info?.root_info?.home_namespace_id;
      if (rn && hn && String(rn) !== String(hn)) pathRootNs = rn;
    }
  } catch {}

  const tmpHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (pathRootNs) {
    tmpHeaders["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "root",
      root: String(pathRootNs),
    });
  }
  let linkRes;
  try {
    linkRes = await fetchWithTimeout(
      DROPBOX_TEMP_LINK_URL,
      {
        method: "POST",
        headers: tmpHeaders,
        body: JSON.stringify({ path: envelope.dropbox_file_id }),
      },
      60_000,
      "dropbox get_temporary_link",
    );
  } catch (e) {
    return { error: `get_temporary_link timeout: ${e?.message || String(e)}` };
  }
  const linkBody = await linkRes.json().catch(() => ({}));
  if (!linkRes.ok || !linkBody.link) {
    return {
      error: `get_temporary_link failed (HTTP ${linkRes.status}): ${linkBody?.error_summary || "unknown"}`,
    };
  }
  let fileRes;
  try {
    fileRes = await fetchWithTimeout(
      linkBody.link,
      {},
      180_000,
      "dropbox file download",
    );
  } catch (e) {
    return { error: `File download timeout: ${e?.message || String(e)}` };
  }
  if (!fileRes.ok)
    return { error: `File download failed: HTTP ${fileRes.status}` };
  return {
    buf: Buffer.from(await fileRes.arrayBuffer()),
    meta: {
      name: linkBody.metadata?.name,
      size: linkBody.metadata?.size,
      path_display: linkBody.metadata?.path_display,
    },
  };
}

async function deleteRawRowsForSource(sourceFileId, table) {
  const r = await sr(`/${table}?source_file_id=eq.${sourceFileId}`, {
    method: "DELETE",
    schema: "raw",
    prefer: "return=minimal",
  });
  if (!r.ok) {
    throw new Error(
      `Failed to clear raw.${table} for source_file_id ${sourceFileId}: HTTP ${r.status} ${(r.raw || "").slice(0, 200)}`,
    );
  }
}

async function patchParseRun(runId, patch) {
  return sr(`/reference_workbook_parse_runs?id=eq.${runId}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
    schema: "raw",
  });
}

async function patchRegistry(fileId, patch) {
  return sr(`/reference_workbook_file_registry?id=eq.${fileId}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
    schema: "raw",
  });
}

export async function finalizeParseRun({
  runId,
  fileId,
  status,
  errorMessage,
  completedAt,
}) {
  const completedAtIso = completedAt || new Date().toISOString();
  const truncatedMessage =
    typeof errorMessage === "string" && errorMessage.length > 0
      ? errorMessage.slice(0, 2000)
      : null;
  let runOk = false;
  let registryOk = false;
  try {
    const runPatch = { status, completed_at: completedAtIso };
    if (truncatedMessage !== null) runPatch.error_message = truncatedMessage;
    const runRes = await patchParseRun(runId, runPatch);
    runOk = !!(runRes && runRes.ok);
  } catch (e) {
    console.error(
      "[reference-workbook-parse] finalize parse_runs threw",
      runId,
      e?.message || e,
    );
  }
  try {
    const registryPatch = {
      last_parse_status: status,
      last_parse_error: truncatedMessage,
      updated_at: completedAtIso,
    };
    if (status === "success") registryPatch.last_parsed_at = completedAtIso;
    const regRes = await patchRegistry(fileId, registryPatch);
    registryOk = !!(regRes && regRes.ok);
  } catch (e) {
    console.error(
      "[reference-workbook-parse] finalize registry threw",
      fileId,
      e?.message || e,
    );
  }
  return runOk && registryOk;
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  const profile = await resolveAdminProfile(userJwt);
  if (!profile?.isAdmin) {
    console.error("[reference-workbook-parse] admin-check failed", {
      hasProfile: !!profile,
      orgId: profile?.orgId || null,
    });
    return jsonResponse(403, { error: "Admin required" });
  }

  const body = gate.body || {};
  const fileRegistryId = body.file_registry_id;
  if (!fileRegistryId || typeof fileRegistryId !== "string") {
    return jsonResponse(400, { error: "file_registry_id (UUID) required" });
  }

  const regRes = await sr(
    `/reference_workbook_file_registry?id=eq.${encodeURIComponent(fileRegistryId)}&org_id=eq.${encodeURIComponent(profile.orgId)}&select=*&limit=1`,
    { schema: "raw" },
  );
  if (!regRes.ok || !regRes.body?.length) {
    console.error("[reference-workbook-parse] registry row lookup failed", {
      fileRegistryId,
      orgId: profile.orgId,
      httpStatus: regRes.status,
      ok: regRes.ok,
    });
    return jsonResponse(404, {
      error: "File registry row not found (or not in your org)",
    });
  }
  const registry = regRes.body[0];

  const runInsert = await sr("/reference_workbook_parse_runs", {
    method: "POST",
    body: [
      {
        org_id: profile.orgId,
        file_id: fileRegistryId,
        triggered_by: profile.userId,
        status: "running",
      },
    ],
    prefer: "return=representation",
    schema: "raw",
  });
  if (!runInsert.ok || !runInsert.body?.length) {
    console.error("[reference-workbook-parse] parse_runs INSERT failed", {
      fileRegistryId,
      httpStatus: runInsert.status,
      body: (runInsert.raw || "").slice(0, 300),
    });
    return jsonResponse(500, {
      error: `Failed to create parse_runs row: HTTP ${runInsert.status}`,
    });
  }
  const runId = runInsert.body[0].id;

  await patchRegistry(fileRegistryId, {
    last_parse_status: "running",
    last_parse_error: null,
    last_parse_run_id: runId,
    updated_at: new Date().toISOString(),
  });

  const runParse = async () => {
    let runCompleted = false;
    const deadlineTimer = setTimeout(
      async () => {
        if (runCompleted) return;
        console.error(
          "[reference-workbook-parse] deadline-race fired at 14min",
          fileRegistryId,
        );
        const ok = await finalizeParseRun({
          runId,
          fileId: fileRegistryId,
          status: "error",
          errorMessage:
            "Parse exceeded 14-min deadline-race before Netlify 15-min SIGKILL " +
            "(deadline guard fired; typically large " +
            "reference workbook + batched INSERT volume).",
        });
        if (ok) runCompleted = true;
      },
      14 * 60 * 1000,
    );

    try {
      const envelope = registry.source_envelope || {};
      const workbookKind = registry.workbook_kind;

      let download;
      if (envelope.provider === "sharepoint") {
        download = await getSharePointFileBytes({
          driveId: envelope.driveId,
          itemId: envelope.itemId,
        });
      } else if (envelope.provider === "dropbox") {
        download = await getDropboxFileBytes({ envelope });
      } else {
        throw new Error(
          `Unsupported source_envelope.provider: ${envelope.provider || "(missing)"}`,
        );
      }
      if (download.error) throw new Error(download.error);

      const workbook = XLSX.read(download.buf, {
        type: "buffer",
        cellDates: true,
        cellFormula: false,
      });
      const parsed = parseReferenceWorkbook(workbook, workbookKind);

      if (!parsed.rows.length) {
        throw new Error(
          `Parse produced 0 rows for workbook_kind=${workbookKind} (target raw.${parsed.table}). ` +
            `Refusing to clear existing rows for source_file_id ${fileRegistryId} — the source sheet ` +
            `shape has almost certainly changed. Prior rows left intact; fix the workbook and re-parse.`,
        );
      }

      await deleteRawRowsForSource(fileRegistryId, parsed.table);

      const ingestedAt = new Date().toISOString();
      const orgScope = {
        org_id: profile.orgId,
        source_file_id: fileRegistryId,
        ingested_at: ingestedAt,
      };
      const rows = parsed.rows.map((r) => ({ ...orgScope, ...r }));

      if (rows.length) {
        await srInsertBatched(`/${parsed.table}`, rows, { schema: "raw" });
      }

      const completedAt = new Date().toISOString();
      const runRes = await patchParseRun(runId, {
        status: "success",
        rows_extracted: {
          ...parsed.summary,
          workbook_kind: workbookKind,
          table: parsed.table,
        },
        completed_at: completedAt,
      });
      const regRes = await patchRegistry(fileRegistryId, {
        last_parsed_at: completedAt,
        last_parse_status: "success",
        last_parse_error: null,
        updated_at: completedAt,
      });
      if (runRes?.ok && regRes?.ok) runCompleted = true;

      console.log(
        `[reference-workbook-parse] ok ${fileRegistryId}: ${parsed.table}=${rows.length} (kind=${workbookKind})`,
      );
    } catch (err) {
      const message = err?.message || String(err);
      console.error(
        "[reference-workbook-parse] error",
        fileRegistryId,
        message,
      );
      const ok = await finalizeParseRun({
        runId,
        fileId: fileRegistryId,
        status: "error",
        errorMessage: message,
      });
      if (ok) runCompleted = true;
    } finally {
      clearTimeout(deadlineTimer);
      if (!runCompleted) {
        await finalizeParseRun({
          runId,
          fileId: fileRegistryId,
          status: "error",
          errorMessage:
            "Parse completed without a success/error completion-write — " +
            "last-ditch finally fallback. Investigate function logs.",
        });
      }
    }
  };

  await runParse();

  return jsonResponse(202, {
    ok: true,
    status: "done",
    parse_run_id: runId,
    file_registry_id: fileRegistryId,
  });
};
