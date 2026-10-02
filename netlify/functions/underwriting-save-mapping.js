import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

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
  if (type === "text") {
    return String(value).trim().slice(0, 500) || null;
  }
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

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 20 },
  });
  if (gate.error) return gate.error;

  try {
    const { property_id, source_file_id, mapping, preview_values } = JSON.parse(
      event.body || "{}",
    );
    if (!property_id)
      return jsonResponse(400, { error: "property_id required" });
    if (!source_file_id)
      return jsonResponse(400, { error: "source_file_id required" });
    if (!mapping || typeof mapping !== "object") {
      return jsonResponse(400, { error: "mapping (object) required" });
    }
    if (!preview_values || typeof preview_values !== "object") {
      return jsonResponse(400, { error: "preview_values (object) required" });
    }

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (profile.role !== "gp" && !profile.isAdmin) {
      return jsonResponse(403, { error: "GP or admin role required" });
    }

    const propRes = await sr(
      `/properties?id=eq.${property_id}&org_id=eq.${profile.orgId}&select=id,name&limit=1`,
    );
    if (!propRes.ok || !propRes.body?.length) {
      return jsonResponse(404, { error: "Property not found in your org" });
    }

    const fileRes = await sr(
      `/dropbox_files?dropbox_file_id=eq.${encodeURIComponent(source_file_id)}` +
        `&org_id=eq.${profile.orgId}&select=dropbox_file_id,path_display,rev,server_modified,name&limit=1`,
    );
    if (!fileRes.ok || !fileRes.body?.length) {
      return jsonResponse(404, { error: "Source file not found in your org" });
    }
    const fileRow = fileRes.body[0];

    await sr(
      `/property_underwriting_mappings?property_id=eq.${property_id}&is_active=eq.true`,
      { method: "PATCH", body: { is_active: false }, prefer: "return=minimal" },
    );

    const mapRow = {
      property_id,
      org_id: profile.orgId,
      model_identity: source_file_id,
      model_path: fileRow.path_display,
      model_file_rev: fileRow.rev,
      model_name: fileRow.name,
      mapping,
      discovered_by: "ai",
      verified_by: profile.userId,
      verified_at: new Date().toISOString(),
      is_active: true,
    };
    const insMapping = await sr(`/property_underwriting_mappings`, {
      method: "POST",
      body: [mapRow],
      prefer: "return=representation,resolution=merge-duplicates",
    });
    if (!insMapping.ok) {
      return jsonResponse(500, {
        error: "Failed to save mapping",
        detail: (insMapping.raw || "").slice(0, 300),
      });
    }
    const mappingRow = Array.isArray(insMapping.body)
      ? insMapping.body[0]
      : insMapping.body;

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
    for (const [field, value] of Object.entries(preview_values)) {
      if (PROMOTED_COLUMNS[field]) {
        uwRow[field] = coerce(value, PROMOTED_COLUMNS[field]);
      } else {
        rawExtras[field] = value;
      }
    }
    uwRow.raw = {
      mapping_id: mappingRow?.id || null,
      extracted_extras: rawExtras,
      preview_values_full: preview_values,
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
        error: "Failed to upsert underwriting row",
        detail: (upsertRes.raw || "").slice(0, 300),
      });
    }

    return jsonResponse(200, {
      ok: true,
      mapping_id: mappingRow?.id || null,
      property_id,
      source_file_id: fileRow.dropbox_file_id,
      verified_at: mapRow.verified_at,
    });
  } catch (e) {
    console.error("[underwriting-save-mapping] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
