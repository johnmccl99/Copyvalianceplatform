import * as XLSX from "xlsx";
import { applySecurity, jsonResponse } from "./_security.js";

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

const GEOMETRY_BUCKET = "documents";
const GEOMETRY_PREFIX = "noi-geometry";
const GEOMETRY_ROW_SCAN = 180;
const NOI_SHEET_RE = /^monthly\s*noi$|^noi\s*build|^noi\b/i;

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
    if (e?.name === "AbortError")
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function sr(path, { method = "GET", body = null, prefer = null } = {}) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
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

async function putStorageJson(path, obj) {
  const res = await fetchWithTimeout(
    `${SUPABASE_URL}/storage/v1/object/${GEOMETRY_BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "x-upsert": "true",
      },
      body: JSON.stringify(obj),
    },
    60_000,
    "storage upload",
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `storage upload ${path} failed HTTP ${res.status} ${t.slice(0, 200)}`,
    );
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
  if (!tRes.ok || !tBody?.access_token)
    return { error: `Dropbox token refresh failed (HTTP ${tRes.status})` };
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

  const baseHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const linkHeaders = { ...baseHeaders };
  if (pathRootNs)
    linkHeaders["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "root",
      root: String(pathRootNs),
    });

  let linkRes;
  try {
    linkRes = await fetchWithTimeout(
      DROPBOX_TEMP_LINK_URL,
      {
        method: "POST",
        headers: linkHeaders,
        body: JSON.stringify({ path: envelope.dropbox_file_id }),
      },
      60_000,
      "dropbox get_temporary_link",
    );
  } catch (e) {
    return { error: `get_temporary_link timeout: ${e?.message || String(e)}` };
  }
  let linkBody = await linkRes.json().catch(() => ({}));
  if (!linkRes.ok && pathRootNs) {
    try {
      linkRes = await fetchWithTimeout(
        DROPBOX_TEMP_LINK_URL,
        {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({ path: envelope.dropbox_file_id }),
        },
        60_000,
        "dropbox get_temporary_link (home retry)",
      );
      linkBody = await linkRes.json().catch(() => ({}));
    } catch (e) {
      return {
        error: `get_temporary_link home-retry timeout: ${e?.message || String(e)}`,
      };
    }
  }
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

async function loadGraphEnvelope(graphId, orgId) {
  const gRes = await sr(
    `/property_underwriting_model_graphs?id=eq.${encodeURIComponent(graphId)}&org_id=eq.${encodeURIComponent(orgId)}` +
      `&select=id,property_id,source_file_id,source_file_path&limit=1`,
  );
  if (!gRes.ok || !gRes.body?.length)
    return { error: "graph not found in your org" };
  const g = gRes.body[0];
  if (!g.source_file_id) return { error: "graph has no source_file_id" };

  let propertyName = null;
  const pRes = await sr(
    `/properties?id=eq.${g.property_id}&select=name&limit=1`,
  );
  if (pRes.ok && pRes.body?.length) propertyName = pRes.body[0].name;

  const fRes = await sr(
    `/dropbox_files?dropbox_file_id=eq.${encodeURIComponent(g.source_file_id)}&org_id=eq.${encodeURIComponent(orgId)}` +
      `&select=dropbox_account_id,kind,is_downloadable&limit=1`,
  );
  if (!fRes.ok || !fRes.body?.length) {
    return {
      error: `source_file_id not in dropbox_files for this org (stale index?): ${g.source_file_id}`,
    };
  }
  const f = fRes.body[0];
  if (f.kind !== "file") return { error: "source is not a file" };
  if (f.is_downloadable === false)
    return { error: "source file is not downloadable per Dropbox" };

  return {
    graph: g,
    propertyName,
    envelope: {
      dropbox_account_id: f.dropbox_account_id,
      dropbox_file_id: g.source_file_id,
    },
  };
}

function cv(cell) {
  if (!cell) return { num: null, text: null, date: null };
  const v = cell.v;
  if (v === undefined || v === null || v === "")
    return { num: null, text: null, date: null };
  if (v instanceof Date)
    return { num: null, text: null, date: v.toISOString().slice(0, 10) };
  if (typeof v === "number")
    return Number.isFinite(v)
      ? { num: v, text: null, date: null }
      : { num: null, text: null, date: null };
  const s = String(v).trim();
  if (!s) return { num: null, text: null, date: null };
  if (/^-?\s*\$?\s*-?\d[\d,]*\.?\d*\s*%?$/.test(s)) {
    const n = Number(s.replace(/[$,\s]/g, "").replace(/%$/, ""));
    if (Number.isFinite(n))
      return { num: s.endsWith("%") ? n / 100 : n, text: s, date: null };
  }
  return { num: null, text: s.slice(0, 120), date: null };
}

function isPeriodText(t) {
  return (
    !!t &&
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*['-]?\s*\d{2,4}|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|^m\d+$/i.test(
      t,
    )
  );
}

function dumpSheetGeometry(ws, sheetName) {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const lastRow = Math.min(range.e.r, GEOMETRY_ROW_SCAN);

  let headerRow = -1;
  let headerCols = [];
  const upper = Math.min(range.e.r, range.s.r + 15);
  for (let r = range.s.r; r <= upper; r++) {
    const cols = [];
    for (let c = range.s.c + 1; c <= range.e.c; c++) {
      const v = cv(ws[XLSX.utils.encode_cell({ r, c })]);
      if (v.date) cols.push(c);
      else if (v.text && isPeriodText(v.text)) cols.push(c);
    }
    if (cols.length >= 6 && headerRow < 0) {
      headerRow = r;
      headerCols = cols;
    }
  }
  const firstPeriodCol = headerCols.length ? headerCols[0] : range.s.c + 8;

  const LABEL_C0 = 0;
  const LABEL_C1 = Math.min(7, range.e.c);

  const census = {};
  for (let c = LABEL_C0; c <= LABEL_C1; c++) {
    let txt = 0;
    for (let r = range.s.r; r <= lastRow; r++) {
      const v = cv(ws[XLSX.utils.encode_cell({ r, c })]);
      if (v.text != null) txt += 1;
    }
    census[XLSX.utils.encode_col(c)] = txt;
  }

  const periodColsToDump = headerCols.slice(0, 2);
  const grid = [];
  for (let r = range.s.r; r <= lastRow; r++) {
    const row = { r };
    for (let c = LABEL_C0; c <= LABEL_C1; c++) {
      const v = cv(ws[XLSX.utils.encode_cell({ r, c })]);
      const out =
        v.text != null
          ? v.text
          : v.date != null
            ? `D:${v.date}`
            : v.num != null
              ? v.num
              : null;
      if (out != null) row[XLSX.utils.encode_col(c)] = out;
    }
    for (const c of periodColsToDump) {
      const v = cv(ws[XLSX.utils.encode_cell({ r, c })]);
      const out =
        v.num != null
          ? v.num
          : v.date != null
            ? `D:${v.date}`
            : v.text != null
              ? v.text
              : null;
      if (out != null) row[`p_${XLSX.utils.encode_col(c)}`] = out;
    }
    const keys = Object.keys(row);
    if (keys.length > 1) grid.push(row);
  }

  return {
    sheet: sheetName,
    ref: ws["!ref"] || null,
    range: { s_r: range.s.r, s_c: range.s.c, e_r: range.e.r, e_c: range.e.c },
    detected_period_header: {
      row: headerRow,
      n_cols: headerCols.length,
      first_period_col:
        headerRow >= 0 ? XLSX.utils.encode_col(firstPeriodCol) : null,
    },
    label_col_census: census,
    grid,
  };
}

function dumpWorkbookGeometry(workbook, allSheetNames) {
  const noiSheets = allSheetNames.filter((n) => NOI_SHEET_RE.test(n));
  const sheets = [];
  for (const name of noiSheets) {
    const ws = workbook.Sheets[name];
    if (!ws) {
      sheets.push({ sheet: name, error: "sheet not parsed" });
      continue;
    }
    try {
      sheets.push(dumpSheetGeometry(ws, name));
    } catch (e) {
      sheets.push({ sheet: name, error: e?.message || String(e) });
    }
  }
  return {
    sheet_names: allSheetNames,
    sheet_count: allSheetNames.length,
    noi_matching_sheets: noiSheets,
    monthly_noi_geometry: sheets,
  };
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
    console.error("[reextract-monthly-noi] admin-check failed", {
      hasProfile: !!profile,
      orgId: profile?.orgId || null,
    });
    return jsonResponse(403, { error: "Admin required" });
  }

  const body = gate.body || {};
  const mode = body.mode;
  const graphIds = Array.isArray(body.graph_ids)
    ? body.graph_ids.filter((x) => typeof x === "string")
    : [];

  if (mode === "reextract") {
    return jsonResponse(501, {
      error: "reextract mode is not enabled in this build",
    });
  }
  if (mode !== "geometry") {
    return jsonResponse(400, { error: "mode must be 'geometry'" });
  }
  if (!graphIds.length) {
    return jsonResponse(400, {
      error: "graph_ids (non-empty array of UUIDs) required",
    });
  }
  if (graphIds.length > 25) {
    return jsonResponse(400, { error: "graph_ids capped at 25 per call" });
  }

  const startedAt = new Date().toISOString();
  const batchTag = `${GEOMETRY_PREFIX}/run-${startedAt.replace(/[:.]/g, "-")}`;

  await runGeometry(profile.orgId, graphIds, batchTag, startedAt);

  return jsonResponse(202, {
    ok: true,
    status: "done",
    mode,
    storage_prefix: batchTag,
    manifest: `${batchTag}/_manifest.json`,
  });
};

async function runGeometry(orgId, graphIds, batchTag, startedAt) {
  try {
    await putStorageJson(`${batchTag}/_started.json`, {
      started_at: startedAt,
      org_id: orgId,
      graph_ids: graphIds,
    });
  } catch (e) {
    console.error(
      "[reextract-monthly-noi] start-marker write failed:",
      e?.message || e,
    );
  }

  const manifest = {
    mode: "geometry",
    org_id: orgId,
    started_at: startedAt,
    graph_ids: graphIds,
    results: [],
  };
  for (const graphId of graphIds) {
    const entry = { graph_id: graphId };
    try {
      const env = await loadGraphEnvelope(graphId, orgId);
      if (env.error) throw new Error(env.error);
      entry.property_name = env.propertyName;
      entry.source_file_id = env.envelope.dropbox_file_id;

      const dl = await getDropboxFileBytes({ envelope: env.envelope });
      if (dl.error) throw new Error(dl.error);
      entry.file_name = dl.meta?.name;
      entry.file_size = dl.meta?.size;

      const allSheetNames =
        XLSX.read(dl.buf, { type: "buffer", bookSheets: true }).SheetNames ||
        [];
      const noiNames = allSheetNames.filter((n) => NOI_SHEET_RE.test(n));
      const workbook = XLSX.read(dl.buf, {
        type: "buffer",
        cellDates: true,
        cellFormula: false,
        sheets: noiNames,
      });
      const geom = dumpWorkbookGeometry(workbook, allSheetNames);

      const outPath = `${batchTag}/${graphId}.json`;
      await putStorageJson(outPath, {
        graph_id: graphId,
        property_name: env.propertyName,
        source_file_id: env.envelope.dropbox_file_id,
        file: dl.meta,
        geometry: geom,
      });
      entry.ok = true;
      entry.storage_path = outPath;
      entry.noi_sheets = geom.noi_matching_sheets;
      console.log(
        `[reextract-monthly-noi] geometry ok ${graphId} (${env.propertyName}) -> ${outPath}`,
      );
    } catch (e) {
      entry.ok = false;
      entry.error = e?.message || String(e);
      console.error(
        `[reextract-monthly-noi] geometry FAILED ${graphId}:`,
        entry.error,
      );
      try {
        await putStorageJson(`${batchTag}/${graphId}.error.json`, {
          graph_id: graphId,
          error: entry.error,
        });
      } catch {}
    }
    manifest.results.push(entry);
  }
  manifest.completed_at = new Date().toISOString();
  try {
    await putStorageJson(`${batchTag}/_manifest.json`, manifest);
    console.log(
      `[reextract-monthly-noi] geometry manifest -> ${batchTag}/_manifest.json (${manifest.results.filter((r) => r.ok).length}/${graphIds.length} ok)`,
    );
  } catch (e) {
    console.error(
      "[reextract-monthly-noi] manifest write failed:",
      e?.message || e,
    );
  }
}
