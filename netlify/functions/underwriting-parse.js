import { applySecurity, jsonResponse } from "./_security.js";
import * as XLSX from "xlsx";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const DROPBOX_TEMP_LINK_URL =
  "https://api.dropboxapi.com/2/files/get_temporary_link";
const DROPBOX_ACCOUNT_INFO_URL =
  "https://api.dropboxapi.com/2/users/get_current_account";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_CLIENT_ID =
  process.env.VITE_DROPBOX_CLIENT_ID || "6cg2ou6edwamvng";
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET;

const PROMOTED_COLUMNS = {
  model_property_name: "text",
  model_street_address: "text",
  model_city_state: "text",
  model_county: "text",
  model_neighborhood: "text",
  senior_loan_lender: "text",
  year_built: "int",
  units_at_acquisition: "int",
  units_pro_forma: "int",
  beds_at_acquisition: "int",
  beds_pro_forma: "int",
  rentable_sf_at_acquisition: "int",
  rentable_sf_pro_forma: "int",
  gross_sf_at_acquisition: "int",
  gross_sf_pro_forma: "int",
  lot_size_sf: "int",
  purchase_price: "num",
  closing_costs: "num",
  capex_budget: "num",
  all_in_basis: "num",
  loan_proceeds: "num",
  equity_required: "num",
  follow_on_needed: "num",
  price_per_unit: "num",
  price_per_bed: "num",
  price_per_rsf: "num",
  price_per_gsf: "num",
  sale_price: "num",
  senior_loan_amount: "num",
  equity_multiple_levered: "num",
  equity_multiple_unlevered: "num",
  lp_equity_multiple: "num",
  gp_equity_multiple: "num",
  target_investor_em: "num",
  hold_period_years: "num",
  going_in_cap_rate_t12: "pct",
  going_in_cap_rate_y1: "pct",
  going_in_cap_rate_y2: "pct",
  going_in_cap_rate_y3: "pct",
  levered_irr: "pct",
  unlevered_irr: "pct",
  lp_irr: "pct",
  gp_irr: "pct",
  target_investor_irr: "pct",
  terminal_cap_rate: "pct",
  terminal_cap_rate_tax_adj: "pct",
  rent_growth_pct: "pct",
  expense_growth_pct: "pct",
  tax_escalation_pct: "pct",
  vacancy_pct: "pct",
  senior_loan_rate: "pct",
  senior_loan_ltv: "pct",
  purchase_date: "date",
  refinance_date: "date",
  sale_date: "date",
  senior_loan_maturity_date: "date",
};

function coerce(value, type) {
  if (value === null || value === undefined || value === "") return null;
  if (type === "int") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  if (type === "num") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "pct") {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n > 1.5 ? n / 100 : n;
  }
  if (type === "date") {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const n = Number(s);
    if (Number.isFinite(n) && n > 25569) {
      const ms = (n - 25569) * 86400 * 1000;
      return new Date(ms).toISOString().slice(0, 10);
    }
    return null;
  }
  if (type === "text") return String(value).trim().slice(0, 500) || null;
  return value;
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
  const role = String(p.role || "").toLowerCase();
  const adminRole = ["admin", "gp_admin", "gp-admin"].includes(role);
  return {
    userId: p.id,
    orgId: p.org_id,
    isAdmin: adminTrue || adminRole,
    role,
  };
}

async function refreshAccessTokenInline(acctId) {
  if (!DROPBOX_CLIENT_SECRET) return { error: "DROPBOX_CLIENT_SECRET not set" };
  const rowRes = await sr(
    `/org_dropbox_accounts?id=eq.${encodeURIComponent(acctId)}&select=id,org_id,refresh_token_encrypted`,
  );
  if (!rowRes.ok || !rowRes.body?.length) {
    return { error: `Dropbox account row not found: ${acctId}` };
  }
  const row = rowRes.body[0];
  if (!row.refresh_token_encrypted) {
    return { error: "No refresh token stored — reconnect Dropbox" };
  }
  const decRes = await sr("/rpc/dropbox_decrypt_refresh_token", {
    method: "POST",
    body: { p_ciphertext: row.refresh_token_encrypted },
  });
  if (!decRes.ok || !decRes.body) {
    return {
      error: `Refresh token decrypt failed: HTTP ${decRes.status} ${(decRes.raw || "").slice(0, 200)}`,
    };
  }
  const basicAuth = Buffer.from(
    `${DROPBOX_CLIENT_ID}:${DROPBOX_CLIENT_SECRET}`,
  ).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decRes.body,
  });
  const tRes = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const tText = await tRes.text();
  let tBody = null;
  try {
    tBody = tText ? JSON.parse(tText) : null;
  } catch {}
  if (!tRes.ok || !tBody?.access_token) {
    if (tRes.status === 400 || tRes.status === 401) {
      await sr(`/org_dropbox_accounts?id=eq.${acctId}`, {
        method: "PATCH",
        body: {
          status: "needs_reauth",
          last_error_code: "refresh_failed",
          last_error_message: (tText || "").slice(0, 500),
          last_error_at: new Date().toISOString(),
        },
        prefer: "return=minimal",
      });
    }
    const detail =
      tBody?.error_description || tBody?.error || tText.slice(0, 200);
    return {
      error: `Dropbox token exchange failed (HTTP ${tRes.status}): ${detail}`,
    };
  }
  const expiresAt = new Date(
    Date.now() + (Number(tBody.expires_in) || 14400) * 1000,
  ).toISOString();
  const encRes = await sr("/rpc/dropbox_encrypt_access_token", {
    method: "POST",
    body: { p_plaintext: tBody.access_token },
  });
  if (encRes.ok) {
    await sr(`/org_dropbox_accounts?id=eq.${acctId}`, {
      method: "PATCH",
      body: {
        access_token_encrypted: encRes.body,
        access_token_expires_at: expiresAt,
        last_error_code: null,
        last_error_message: null,
        last_error_at: null,
      },
      prefer: "return=minimal",
    });
  }
  return { accessToken: tBody.access_token };
}

async function getDropboxFileBytes({ fileRow }) {
  const acctRes = await sr(
    `/org_dropbox_accounts?id=eq.${fileRow.dropbox_account_id}&select=id,access_token_expires_at,status`,
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
    const infoRes = await fetch(DROPBOX_ACCOUNT_INFO_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "null",
    });
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
  const linkRes = await fetch(DROPBOX_TEMP_LINK_URL, {
    method: "POST",
    headers: tmpHeaders,
    body: JSON.stringify({ path: fileRow.dropbox_file_id }),
  });
  const linkBody = await linkRes.json().catch(() => ({}));
  if (!linkRes.ok || !linkBody.link) {
    return {
      error: `get_temporary_link failed: ${linkBody.error_summary || "unknown"}`,
    };
  }
  const fileRes = await fetch(linkBody.link);
  if (!fileRes.ok)
    return { error: `File download failed: HTTP ${fileRes.status}` };
  return { buf: Buffer.from(await fileRes.arrayBuffer()) };
}

function applyMappingWithDriftCheck(workbook, mapping) {
  const values = {};
  let driftCount = 0;
  let checkedCount = 0;
  const drift = [];

  for (const [field, spec] of Object.entries(mapping || {})) {
    if (!spec || !spec.sheet || !spec.cell) {
      values[field] = null;
      continue;
    }
    const ws = workbook.Sheets[spec.sheet];
    if (!ws) {
      values[field] = null;
      drift.push({ field, reason: "sheet_missing" });
      driftCount += 1;
      checkedCount += 1;
      continue;
    }
    const cell = ws[spec.cell];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === "") {
      values[field] = null;
      continue;
    }
    let v = cell.v;
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    values[field] = v;

    if (spec.label && spec.cell.length >= 2) {
      checkedCount += 1;
      const match = spec.cell.match(/^([A-Z]+)(\d+)$/);
      if (match) {
        const col = match[1];
        const row = parseInt(match[2], 10);
        let found = false;
        const storedLabel = String(spec.label).trim().toLowerCase();
        for (let offset = 1; offset <= 4 && !found; offset++) {
          const prevCol = String.fromCharCode(col.charCodeAt(0) - offset);
          if (prevCol < "A") break;
          const addr = `${prevCol}${row}`;
          const labelCell = ws[addr];
          if (labelCell && typeof labelCell.v === "string") {
            if (
              labelCell.v.trim().toLowerCase().includes(storedLabel) ||
              storedLabel.includes(labelCell.v.trim().toLowerCase())
            ) {
              found = true;
            }
          }
        }
        if (!found) {
          drift.push({
            field,
            reason: "label_not_nearby",
            expected: spec.label,
          });
          driftCount += 1;
        }
      }
    }
  }

  const driftRatio = checkedCount > 0 ? driftCount / checkedCount : 0;
  return { values, driftRatio, driftCount, checkedCount, drift };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 20 },
  });
  if (gate.error) return gate.error;

  try {
    const { property_id, source_file_id: overrideFileId } = JSON.parse(
      event.body || "{}",
    );
    if (!property_id)
      return jsonResponse(400, { error: "property_id required" });

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (profile.role !== "gp" && !profile.isAdmin) {
      return jsonResponse(403, { error: "GP or admin role required" });
    }

    const mapRes = await sr(
      `/property_underwriting_mappings?property_id=eq.${property_id}` +
        `&is_active=eq.true&org_id=eq.${profile.orgId}` +
        `&select=id,mapping,model_identity,model_path,model_file_rev&limit=1`,
    );
    if (!mapRes.ok || !mapRes.body?.length) {
      return jsonResponse(404, {
        error: "No active mapping for this property. Run discovery first.",
      });
    }
    const mappingRow = mapRes.body[0];
    const useFileId = overrideFileId || mappingRow.model_identity;

    const fileRes = await sr(
      `/dropbox_files?dropbox_file_id=eq.${encodeURIComponent(useFileId)}` +
        `&org_id=eq.${profile.orgId}&select=dropbox_account_id,dropbox_file_id,path_display,rev,server_modified,name&limit=1`,
    );
    if (!fileRes.ok || !fileRes.body?.length) {
      return jsonResponse(404, {
        error: "Source file not found in Dropbox index",
      });
    }
    const fileRow = fileRes.body[0];

    const bytesRes = await getDropboxFileBytes({ fileRow });
    if (bytesRes.error) return jsonResponse(502, { error: bytesRes.error });
    const workbook = XLSX.read(bytesRes.buf, {
      type: "buffer",
      cellDates: true,
    });

    const { values, driftRatio, driftCount, checkedCount, drift } =
      applyMappingWithDriftCheck(workbook, mappingRow.mapping);

    const DRIFT_THRESHOLD = 0.3;
    if (driftRatio >= DRIFT_THRESHOLD) {
      return jsonResponse(409, {
        status: "drift",
        message: `${driftCount}/${checkedCount} mapped labels no longer match their cells. The model's layout has shifted — re-run Discovery to rebuild the mapping.`,
        drift_ratio: driftRatio,
        drift_samples: drift.slice(0, 10),
      });
    }

    const uwRow = {
      property_id,
      org_id: profile.orgId,
      source_file_id: fileRow.dropbox_file_id,
      source_file_rev: fileRow.rev,
      source_file_path: fileRow.path_display,
      source_file_modified_at: fileRow.server_modified,
      parsed_at: new Date().toISOString(),
    };
    const rawExtras = {};
    for (const [field, value] of Object.entries(values)) {
      if (PROMOTED_COLUMNS[field]) {
        uwRow[field] = coerce(value, PROMOTED_COLUMNS[field]);
      } else {
        rawExtras[field] = value;
      }
    }
    uwRow.raw = {
      mapping_id: mappingRow.id,
      extracted_extras: rawExtras,
      drift_count: driftCount,
      drift_checked: checkedCount,
      drift_warnings: drift.slice(0, 20),
    };

    const upsertRes = await sr(
      `/property_underwriting?on_conflict=property_id`,
      {
        method: "POST",
        body: [uwRow],
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
    if (!upsertRes.ok) {
      return jsonResponse(500, {
        error: "Failed to upsert",
        detail: (upsertRes.raw || "").slice(0, 300),
      });
    }

    return jsonResponse(200, {
      ok: true,
      status: driftCount > 0 ? "parsed_with_drift" : "parsed",
      property_id,
      source_file_id: fileRow.dropbox_file_id,
      fields_populated: Object.values(values).filter((v) => v !== null).length,
      drift_count: driftCount,
      drift_checked: checkedCount,
      drift_warnings: drift,
    });
  } catch (e) {
    console.error("[underwriting-parse] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
