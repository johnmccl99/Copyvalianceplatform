import { applySecurity, jsonResponse } from "./_security.js";
import * as XLSX from "xlsx";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const DROPBOX_TEMP_LINK_URL =
  "https://api.dropboxapi.com/2/files/get_temporary_link";
const DROPBOX_ACCOUNT_INFO_URL =
  "https://api.dropboxapi.com/2/users/get_current_account";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const DROPBOX_CLIENT_ID =
  process.env.VITE_DROPBOX_CLIENT_ID || "6cg2ou6edwamvng";
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET;

const CLAUDE_MODEL = "claude-opus-4-6";

const INTERESTING_SHEET_PATTERNS = [
  /assumption/i,
  /\binput/i,
  /summary/i,
  /return/i,
  /\bcash\s?flow/i,
  /\bcf\b/i,
  /\bnoi\b/i,
  /loan/i,
  /debt/i,
  /financ/i,
  /source.*use|sources/i,
  /\bunit\b/i,
  /\brent\b/i,
  /rent.?roll/i,
  /lease/i,
  /\bcim\b|memo|\bom\b/i,
  /closing|basis|deal/i,
  /investor|partnership|equity/i,
  /exit|disposition|terminal/i,
  /capex/i,
  /historic/i,
  /permit/i,
  /tax/i,
  /cost[ _]seg/i,
];

const TARGET_SCHEMA = [
  {
    key: "model_property_name",
    type: "string",
    desc: 'Property name used in the model (e.g. "12 Panoramic")',
  },
  {
    key: "model_street_address",
    type: "string",
    desc: "Street address from the model",
  },
  {
    key: "model_city_state",
    type: "string",
    desc: 'City + state (e.g. "Berkeley, CA")',
  },
  { key: "model_county", type: "string", desc: "County name" },
  {
    key: "model_neighborhood",
    type: "string",
    desc: "Neighborhood / submarket",
  },
  {
    key: "year_built",
    type: "integer",
    desc: "Year the building was constructed",
  },
  {
    key: "units_at_acquisition",
    type: "integer",
    desc: "Total units at time of acquisition",
  },
  {
    key: "units_pro_forma",
    type: "integer",
    desc: "Total units in pro-forma (after renovation/ADU add)",
  },
  {
    key: "beds_at_acquisition",
    type: "integer",
    desc: "Total beds at acquisition",
  },
  { key: "beds_pro_forma", type: "integer", desc: "Total beds in pro-forma" },
  {
    key: "rentable_sf_at_acquisition",
    type: "integer",
    desc: "Rentable SF at acquisition",
  },
  {
    key: "rentable_sf_pro_forma",
    type: "integer",
    desc: "Rentable SF in pro-forma",
  },
  {
    key: "gross_sf_at_acquisition",
    type: "integer",
    desc: "Gross SF at acquisition",
  },
  { key: "gross_sf_pro_forma", type: "integer", desc: "Gross SF in pro-forma" },
  { key: "lot_size_sf", type: "integer", desc: "Lot size in square feet" },
  { key: "purchase_price", type: "number", desc: "Total purchase price" },
  {
    key: "closing_costs",
    type: "number",
    desc: "Total closing costs (the summed line, not per-unit)",
  },
  {
    key: "capex_budget",
    type: "number",
    desc: "Total CapEx budget (renovation + other)",
  },
  {
    key: "all_in_basis",
    type: "number",
    desc: "All-in basis = purchase + closing + capex",
  },
  { key: "loan_proceeds", type: "number", desc: "Total senior loan proceeds" },
  { key: "equity_required", type: "number", desc: "Total equity required" },
  {
    key: "follow_on_needed",
    type: "number",
    desc: "Follow-on equity needed beyond initial raise",
  },
  {
    key: "price_per_unit",
    type: "number",
    desc: "Purchase price per unit (pro-forma)",
  },
  {
    key: "price_per_bed",
    type: "number",
    desc: "Purchase price per bed (pro-forma)",
  },
  {
    key: "price_per_rsf",
    type: "number",
    desc: "Purchase price per rentable SF",
  },
  { key: "price_per_gsf", type: "number", desc: "Purchase price per gross SF" },
  {
    key: "going_in_cap_rate_t12",
    type: "percent",
    desc: "Going-in cap rate on trailing 12 months NOI",
  },
  {
    key: "going_in_cap_rate_y1",
    type: "percent",
    desc: "Year-1 projected cap rate",
  },
  {
    key: "going_in_cap_rate_y2",
    type: "percent",
    desc: "Year-2 projected cap rate",
  },
  {
    key: "going_in_cap_rate_y3",
    type: "percent",
    desc: "Year-3 projected cap rate",
  },
  {
    key: "levered_irr",
    type: "percent",
    desc: "Levered IRR on the whole deal",
  },
  {
    key: "unlevered_irr",
    type: "percent",
    desc: "Unlevered IRR on the whole deal",
  },
  {
    key: "equity_multiple_levered",
    type: "number",
    desc: "Levered equity multiple (e.g. 1.76 for 1.76x)",
  },
  {
    key: "equity_multiple_unlevered",
    type: "number",
    desc: "Unlevered equity multiple",
  },
  {
    key: "lp_irr",
    type: "percent",
    desc: "LP / investor IRR after GP promote",
  },
  {
    key: "lp_equity_multiple",
    type: "number",
    desc: "LP / investor equity multiple",
  },
  { key: "gp_irr", type: "percent", desc: "GP / sponsor IRR after waterfall" },
  {
    key: "gp_equity_multiple",
    type: "number",
    desc: "GP / sponsor equity multiple",
  },
  {
    key: "target_investor_irr",
    type: "percent",
    desc: 'Targeted investor IRR ("Target" / "Underwritten")',
  },
  {
    key: "target_investor_em",
    type: "number",
    desc: "Targeted investor equity multiple",
  },
  {
    key: "purchase_date",
    type: "date",
    desc: "Initial closing / acquisition date",
  },
  {
    key: "refinance_date",
    type: "date",
    desc: "Planned refinance date (null if no refi)",
  },
  { key: "sale_date", type: "date", desc: "Projected sale / disposition date" },
  { key: "hold_period_years", type: "number", desc: "Hold period in years" },
  { key: "sale_price", type: "number", desc: "Projected sale price at exit" },
  {
    key: "terminal_cap_rate",
    type: "percent",
    desc: "Terminal / exit cap rate assumption",
  },
  {
    key: "terminal_cap_rate_tax_adj",
    type: "percent",
    desc: "Terminal cap rate after tax adjustment",
  },
  {
    key: "rent_growth_pct",
    type: "percent",
    desc: "Annual rent growth assumption (year 2+)",
  },
  {
    key: "expense_growth_pct",
    type: "percent",
    desc: "Annual operating expense growth",
  },
  {
    key: "tax_escalation_pct",
    type: "percent",
    desc: "Annual property tax escalation",
  },
  { key: "vacancy_pct", type: "percent", desc: "Vacancy assumption" },
  {
    key: "senior_loan_amount",
    type: "number",
    desc: "Senior loan principal amount",
  },
  {
    key: "senior_loan_rate",
    type: "percent",
    desc: "Senior loan interest rate",
  },
  {
    key: "senior_loan_ltv",
    type: "percent",
    desc: "Senior loan LTV (loan / all-in basis)",
  },
  {
    key: "senior_loan_maturity_date",
    type: "date",
    desc: "Senior loan maturity date",
  },
  {
    key: "senior_loan_lender",
    type: "string",
    desc: "Senior loan lender name",
  },
];

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
    `/org_dropbox_accounts?id=eq.${fileRow.dropbox_account_id}&select=id,access_token_expires_at,status,team_member_id`,
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
      error: `get_temporary_link failed (HTTP ${linkRes.status}): ${linkBody.error_summary || "unknown"}`,
    };
  }

  const fileRes = await fetch(linkBody.link);
  if (!fileRes.ok)
    return { error: `File download failed: HTTP ${fileRes.status}` };
  return { buf: Buffer.from(await fileRes.arrayBuffer()) };
}

function summarizeWorkbook(
  workbook,
  { maxRowsPerSheet = 80, maxColsPerSheet = 18 } = {},
) {
  const out = { sheets: [], skipped_sheets: [] };
  for (const name of workbook.SheetNames) {
    const isInteresting = INTERESTING_SHEET_PATTERNS.some((re) =>
      re.test(name),
    );
    const ws = workbook.Sheets[name];
    const ref = ws["!ref"] || "A1:A1";

    if (!isInteresting) {
      out.skipped_sheets.push({ name, dim: ref });
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const rows = [];
    const rowCap = Math.min(range.e.r, range.s.r + maxRowsPerSheet - 1);
    const colCap = Math.min(range.e.c, range.s.c + maxColsPerSheet - 1);
    for (let r = range.s.r; r <= rowCap; r++) {
      const row = [];
      let anyNonEmpty = false;
      for (let c = range.s.c; c <= colCap; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        let v = null;
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
          v = cell.v;
          if (v instanceof Date) {
            v = v.toISOString().slice(0, 10);
          } else if (typeof v !== "number") {
            const s = String(v);
            v = s.length > 80 ? s.slice(0, 77) + "…" : s;
          }
          anyNonEmpty = true;
        }
        row.push(v);
      }
      if (anyNonEmpty) rows.push({ r: r + 1, cells: row });
    }
    out.sheets.push({
      name,
      dim: ref,
      cols_shown: colCap - range.s.c + 1,
      rows_shown: rows.length,
      rows,
    });
  }
  return out;
}

function buildPrompt(workbookSummary) {
  const schemaText = TARGET_SCHEMA.map(
    (f) => `  - ${f.key} (${f.type}): ${f.desc}`,
  ).join("\n");
  const totalSheets =
    workbookSummary.sheets.length +
    (workbookSummary.skipped_sheets?.length || 0);
  const skippedList = (workbookSummary.skipped_sheets || [])
    .map((s) => `  - "${s.name}" (${s.dim})`)
    .join("\n");
  return `You are analyzing a commercial-real-estate underwriting model (Excel workbook). Your job is to map a list of target fields to specific cells in this workbook.

The workbook has ${totalSheets} sheets total. I'm showing cell contents for the ${workbookSummary.sheets.length} sheets most likely to contain deal-economics data; the remaining sheets are listed by name only (raw data / reference tables — probably not useful). If you think a needed field is in a listed-but-not-shown sheet, return null for that field and note the sheet name in the label.

For each shown sheet you get: name, dimensions, and up to 80 non-empty rows of the first 18 columns.

**Sheets with contents shown:** ${workbookSummary.sheets.map((s) => `"${s.name}"`).join(", ")}

**Sheets listed by name only:**
${skippedList || "  (none)"}

**Target fields to map:**

${schemaText}

**Output format.** Return JSON only (no markdown, no explanation). Keys are field names from the list above. For each field, the value is either:
  - null if the field is not present
  - { "sheet": "<sheet_name>", "cell": "<A1_address>", "label": "<nearby label text>", "confidence": <0.0-1.0> }

**Rules**
- For fields ending in "_at_acquisition" vs "_pro_forma": pick the column that specifically represents that state. Models typically have both as adjacent columns.
- For fields without an explicit state suffix, prefer the pro-forma / underwritten column.
- Numeric cells only for number/percent/date fields — don't map to a label cell by mistake.
- Percents: the cell must contain a decimal (0.05), NOT a percentage string ("5%"). If the only match is a string, return null.
- Dates: the cell must contain a real Excel date. If it's a string return null.
- For multi-row sections with a "Total" or summed row (Total Closing Costs, Total CapEx), map to the summed row, not a component.
- For IRR / EM, disambiguate between Leveraged / Unleveraged / LP (Investor) / GP (Sponsor) / Target per the field's description. Labels near these cells are the best signal.
- All-in basis = purchase + closing + capex. Look for the labelled SUM row.
- Confidence: 0.9+ when the label is exact/close; 0.6-0.8 if you inferred; below 0.5 consider returning null.

**Workbook:**

${JSON.stringify(workbookSummary, null, 1).slice(0, 400_000)}
`;
}

function extractMappingFromClaudeResponse(text) {
  let t = String(text || "").trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }
  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    return {
      error: "Claude response did not contain a JSON object",
      raw: text,
    };
  }
  try {
    return { mapping: JSON.parse(t.slice(firstBrace, lastBrace + 1)) };
  } catch (e) {
    return { error: `Claude JSON parse failed: ${e.message}`, raw: text };
  }
}

function applyMapping(workbook, mapping) {
  const preview = {};
  for (const [field, spec] of Object.entries(mapping || {})) {
    if (!spec || !spec.sheet || !spec.cell) {
      preview[field] = null;
      continue;
    }
    const ws = workbook.Sheets[spec.sheet];
    if (!ws) {
      preview[field] = null;
      continue;
    }
    const cell = ws[spec.cell];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === "") {
      preview[field] = null;
      continue;
    }
    let v = cell.v;
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    preview[field] = v;
  }
  return preview;
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 10 },
  });
  if (gate.error) return gate.error;

  let runId = null;
  const finalize = async (patch) => {
    if (!runId) return;
    await sr(`/underwriting_discovery_runs?id=eq.${runId}`, {
      method: "PATCH",
      body: { completed_at: new Date().toISOString(), ...patch },
      prefer: "return=minimal",
    });
  };

  try {
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse(500, { error: "ANTHROPIC_API_KEY not set" });
    }

    const { run_id, property_id, source_file_id } = JSON.parse(
      event.body || "{}",
    );
    if (!run_id)
      return jsonResponse(400, {
        error: "run_id (client-generated UUID) required",
      });
    if (!property_id)
      return jsonResponse(400, { error: "property_id required" });
    if (!source_file_id)
      return jsonResponse(400, { error: "source_file_id required" });
    runId = run_id;

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (!profile.isAdmin) return jsonResponse(403, { error: "Admin required" });

    const propRes = await sr(
      `/properties?id=eq.${property_id}&org_id=eq.${profile.orgId}&select=id,name&limit=1`,
    );
    if (!propRes.ok || !propRes.body?.length) {
      return jsonResponse(404, { error: "Property not found in your org" });
    }
    const fileRes = await sr(
      `/dropbox_files?dropbox_file_id=eq.${encodeURIComponent(source_file_id)}` +
        `&org_id=eq.${profile.orgId}&select=dropbox_account_id,name,path_display,kind,dropbox_file_id,rev,server_modified&limit=1`,
    );
    if (!fileRes.ok || !fileRes.body?.length) {
      return jsonResponse(404, { error: "Dropbox file not found in your org" });
    }
    const fileRow = fileRes.body[0];
    if (fileRow.kind !== "file") {
      return jsonResponse(400, {
        error: "source_file_id must be a file, not a folder",
      });
    }

    const insRes = await sr("/underwriting_discovery_runs", {
      method: "POST",
      prefer: "return=minimal",
      body: [
        {
          id: runId,
          org_id: profile.orgId,
          property_id,
          source_file_id: fileRow.dropbox_file_id,
          source_file_path: fileRow.path_display,
          source_file_rev: fileRow.rev,
          status: "running",
          ai_model: CLAUDE_MODEL,
          triggered_by: profile.userId,
        },
      ],
    });
    if (!insRes.ok) {
      return jsonResponse(500, {
        error: `Failed to create run row: ${(insRes.raw || "").slice(0, 200)}`,
      });
    }

    let bytesRes;
    try {
      bytesRes = await getDropboxFileBytes({ fileRow });
    } catch (e) {
      await finalize({
        status: "error",
        error_stage: "fetch_file",
        error_message: e?.message || String(e),
      });
      return jsonResponse(500, { error: e?.message });
    }
    if (bytesRes.error) {
      await finalize({
        status: "error",
        error_stage: "fetch_file",
        error_message: bytesRes.error,
      });
      return jsonResponse(502, { error: bytesRes.error });
    }

    let summary, workbook;
    try {
      workbook = XLSX.read(bytesRes.buf, { type: "buffer", cellDates: true });
      summary = summarizeWorkbook(workbook);
    } catch (e) {
      await finalize({
        status: "error",
        error_stage: "parse_xlsx",
        error_message: e?.message || String(e),
      });
      return jsonResponse(500, { error: e?.message });
    }

    const prompt = buildPrompt(summary);
    let anthBody;
    try {
      const anthRes = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      anthBody = await anthRes.json().catch(() => ({}));
      if (!anthRes.ok) {
        await finalize({
          status: "error",
          error_stage: "call_claude",
          error_message: `Anthropic HTTP ${anthRes.status}: ${(anthBody?.error?.message || "").slice(0, 400)}`,
        });
        return jsonResponse(502, {
          error: "Claude API failed",
          detail: anthBody,
        });
      }
    } catch (e) {
      await finalize({
        status: "error",
        error_stage: "call_claude",
        error_message: e?.message || String(e),
      });
      return jsonResponse(500, { error: e?.message });
    }

    const text = (anthBody.content || [])
      .map((c) => c.text || "")
      .join("")
      .trim();
    const parsed = extractMappingFromClaudeResponse(text);
    if (parsed.error) {
      await finalize({
        status: "error",
        error_stage: "parse_response",
        error_message: parsed.error,
      });
      return jsonResponse(502, { error: parsed.error });
    }
    const preview = applyMapping(workbook, parsed.mapping);

    await finalize({
      status: "complete",
      mapping: parsed.mapping,
      preview_values: preview,
      workbook_summary: {
        sheet_count:
          summary.sheets.length + (summary.skipped_sheets?.length || 0),
        shown_sheets: summary.sheets.map((s) => ({
          name: s.name,
          dim: s.dim,
          rows_shown: s.rows_shown,
        })),
        skipped_sheets: summary.skipped_sheets || [],
      },
      prompt_chars: prompt.length,
      response_chars: text.length,
    });

    return jsonResponse(200, { ok: true, run_id: runId });
  } catch (e) {
    console.error("[underwriting-discover-background] exception:", e);
    await finalize({
      status: "error",
      error_stage: "unknown",
      error_message: e?.message || String(e),
    });
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
