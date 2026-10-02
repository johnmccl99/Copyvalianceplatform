import { applySecurity, jsonResponse } from "./_security.js";
import { entrataCall } from "./_connector-adapters.js";
import {
  filterForwardBudgetCells,
  buildPriorMonthCells,
  sliceFiscalYear,
  inferBudgetYearFromSlice,
  groupByGlAccount,
  attachEntrataGlAccountIds,
  buildEntrataBudgetEnvelope,
  summarizeEnvelope,
  FISCAL_YEAR_COUNT,
} from "../../src/lib/entrataBudgetWritebackShape.js";

const getSupabaseUrl = () =>
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const getAnonKey = () =>
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const getServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const ENTRATA_BASE_URLS = {
  us: "https://apis.entrata.com/ext/orgs",
  eu: "https://apis.entrata.global/ext/orgs",
};

const WRITE_ROLES = new Set(["admin", "gp"]);

async function pg(
  path,
  {
    bearer,
    method = "GET",
    body = null,
    prefer = null,
    schema = "public",
  } = {},
) {
  const headers = {
    apikey: getAnonKey(),
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (schema && schema !== "public") {
    if (method === "GET") headers["Accept-Profile"] = schema;
    else headers["Content-Profile"] = schema;
  }
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${getSupabaseUrl()}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return {
    ok: res.ok,
    status: res.status,
    body: json,
    raw: text,
    contentRange: res.headers.get("content-range"),
  };
}

function parseContentRangeTotal(contentRange) {
  if (typeof contentRange !== "string") return null;
  const slash = contentRange.lastIndexOf("/");
  if (slash < 0) return null;
  const total = contentRange.slice(slash + 1).trim();
  if (!total || total === "*") return null;
  const n = Number(total);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function canWriteBudget(profile) {
  if (!profile) return false;
  if (profile.isAdmin || profile.is_admin) return true;
  const role = (profile.role || "").toLowerCase();
  return WRITE_ROLES.has(role);
}

async function resolveCallerProfile(userJwt, authId) {
  const r = await pg(
    `/user_profiles?auth_id=eq.${encodeURIComponent(authId)}&select=id,org_id,role,email,is_admin&limit=1`,
    { bearer: userJwt },
  );
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    return { error: `Failed to load caller profile [${r.status}]` };
  }
  const p = r.body[0];
  return {
    authId,
    orgId: p.org_id,
    role: p.role,
    email: p.email,
    isAdmin: !!p.is_admin,
  };
}

async function resolveEntrataPropertyMapping({ orgId, propertyCode, bearer }) {
  const mapRes = await pg(
    `/budget_property_code_map?org_id=eq.${encodeURIComponent(orgId)}&property_code=eq.${encodeURIComponent(propertyCode)}&select=property_id`,
    { bearer },
  );
  if (!mapRes.ok || !Array.isArray(mapRes.body) || mapRes.body.length === 0) {
    return {
      error: `No budget_property_code_map row for property_code='${propertyCode}' in this org. Register the workbook on the Budget Workbook section first.`,
    };
  }
  const propertiesId = mapRes.body[0].property_id;
  if (!propertiesId) {
    return {
      error: `budget_property_code_map row for '${propertyCode}' has null property_id. Re-register the workbook to seed the mapping.`,
    };
  }

  const propRes = await pg(
    `/properties?id=eq.${encodeURIComponent(propertiesId)}&select=id,name`,
    { bearer },
  );
  if (
    !propRes.ok ||
    !Array.isArray(propRes.body) ||
    propRes.body.length === 0
  ) {
    return {
      error: `Could not resolve public.properties row for id=${propertiesId}. RLS or row missing.`,
    };
  }
  const propertyName = propRes.body[0].name;
  if (!propertyName) {
    return {
      error: `Property ${propertiesId} has a null name; the entrata_properties join requires a name to match.`,
    };
  }

  const entRes = await pg(
    `/entrata_properties?org_id=eq.${encodeURIComponent(orgId)}&name=eq.${encodeURIComponent(propertyName)}&select=id,property_id,entrata_account_id,name`,
    { bearer },
  );
  if (!entRes.ok) {
    return {
      error: `entrata_properties lookup failed [${entRes.status}]: ${(entRes.raw || "").slice(0, 200)}`,
    };
  }
  const candidates = Array.isArray(entRes.body) ? entRes.body : [];
  if (candidates.length === 0) {
    return {
      error: `No entrata_properties row matches name='${propertyName}' in this org. Run an Entrata properties sync first, or escalate to add a dedicated entrata_budget_property_map table.`,
    };
  }
  if (candidates.length > 1) {
    return {
      error: `Ambiguous entrata_properties match for name='${propertyName}' (${candidates.length} candidates). Cannot safely push budget — escalate to add a dedicated entrata_budget_property_map table.`,
      ambiguousCandidates: candidates.map((c) => ({
        id: c.id,
        property_id: c.property_id,
      })),
    };
  }
  const match = candidates[0];
  return {
    entrataPropertyId: match.property_id,
    entrataAccountId: match.entrata_account_id,
    propertiesId,
    propertyName,
  };
}

async function getEntrataContext({ orgId, entrataAccountId }) {
  const filter = entrataAccountId
    ? `id=eq.${encodeURIComponent(entrataAccountId)}`
    : `org_id=eq.${encodeURIComponent(orgId)}&status=eq.active`;
  const acctRes = await pg(
    `/org_entrata_accounts?${filter}&select=id,connector_id,subdomain,region,api_key_encrypted,status&limit=1`,
    { bearer: getServiceRoleKey() },
  );
  if (
    !acctRes.ok ||
    !Array.isArray(acctRes.body) ||
    acctRes.body.length === 0
  ) {
    return {
      error: `No Entrata account row for org=${orgId} [${acctRes.status}]`,
    };
  }
  const acct = acctRes.body[0];
  if (acct.status && acct.status !== "active") {
    return {
      error: `Entrata account status is '${acct.status}', not 'active'.`,
    };
  }
  if (!acct.api_key_encrypted) {
    return {
      error:
        "Entrata account is missing api_key_encrypted (re-connect required).",
    };
  }
  if (!acct.connector_id) {
    return {
      error:
        "Entrata account is missing connector_id (cannot insert connector_sync_runs row).",
    };
  }
  const decRes = await pg("/rpc/entrata_decrypt_api_key", {
    bearer: getServiceRoleKey(),
    method: "POST",
    body: { p_ciphertext: acct.api_key_encrypted },
  });
  if (!decRes.ok || typeof decRes.body !== "string" || !decRes.body.length) {
    return { error: "Entrata API key decrypt failed." };
  }
  const region = acct.region === "eu" ? "eu" : "us";
  return {
    accountId: acct.id,
    connectorId: acct.connector_id,
    subdomain: acct.subdomain,
    region,
    apiKey: decRes.body,
    baseUrl: ENTRATA_BASE_URLS[region],
  };
}

const GL_FALLBACK_CHUNK = 50;

async function fetchGlAccountPairs({ path, bearer, numberKey }) {
  const r = await pg(path, { bearer, prefer: "count=exact" });
  if (!r.ok) return { pairs: null, error: `[${r.status}]`, truncated: false };
  const rows = Array.isArray(r.body) ? r.body : [];
  const total = parseContentRangeTotal(r.contentRange);
  if (total != null && rows.length < total) {
    return {
      pairs: null,
      truncated: true,
      error: `truncated by a row ceiling (${rows.length} of ${total} rows)`,
    };
  }
  const pairs = [];
  for (const row of rows) {
    const num = row && row[numberKey];
    const id = row && row.gl_account_id;
    if (num != null && id != null) pairs.push([String(num), id]);
  }
  return { pairs, error: null, truncated: false };
}

async function loadGlAccountIdMap({ orgId, bearer, accountNumbers = [] }) {
  const org = encodeURIComponent(orgId);
  const map = Object.create(null);
  const ambiguous = new Set();
  const addPairs = (pairs) => {
    for (const [num, id] of pairs) {
      if (!(num in map)) map[num] = id;
      else if (String(map[num]) !== String(id)) ambiguous.add(num);
    }
  };

  const errors = [];
  const catalogue = await fetchGlAccountPairs({
    path:
      `/entrata_gl_tree_accounts?org_id=eq.${org}` +
      "&select=account_number,gl_account_id" +
      "&order=account_number.asc,gl_account_id.asc",
    bearer,
    numberKey: "account_number",
  });
  if (catalogue.error)
    errors.push(`chart-of-accounts read failed ${catalogue.error}`);
  else addPairs(catalogue.pairs);

  const missing = [];
  const seen = new Set();
  for (const raw of Array.isArray(accountNumbers) ? accountNumbers : []) {
    if (raw == null) continue;
    const num = String(raw);
    if (num === "" || seen.has(num)) continue;
    seen.add(num);
    if (!(num in map)) missing.push(num);
  }

  for (let i = 0; i < missing.length; i += GL_FALLBACK_CHUNK) {
    const chunk = missing.slice(i, i + GL_FALLBACK_CHUNK);
    const list = chunk
      .map((n) => `"${String(n).replace(/"/g, '""')}"`)
      .join(",");
    const fb = await fetchGlAccountPairs({
      path:
        `/entrata_gl_transactions?org_id=eq.${org}` +
        `&gl_account_number=in.(${encodeURIComponent(list)})` +
        "&select=gl_account_number,gl_account_id" +
        "&order=gl_account_number.asc,gl_account_id.asc",
      bearer,
      numberKey: "gl_account_number",
    });
    if (fb.error) {
      errors.push(`transaction-history fallback failed ${fb.error}`);
      break;
    }
    addPairs(fb.pairs);
  }

  if (ambiguous.size) {
    errors.push(
      `${ambiguous.size} account number(s) resolve to more than one Entrata id`,
    );
  }
  return { map, error: errors.length ? errors.join("; ") : null };
}

async function loadBudgetCoaMonthly({ propertyCode, bearer }) {
  const r = await pg("/rpc/get_budget_coa_monthly", {
    bearer,
    method: "POST",
    body: {
      p_property_code: propertyCode,
      p_forward_only: true,
      p_bypass_cache: true,
    },
  });
  if (!r.ok)
    return {
      rows: [],
      error: `get_budget_coa_monthly failed [${r.status}]: ${(r.raw || "").slice(0, 200)}`,
    };
  return { rows: Array.isArray(r.body) ? r.body : [], error: null };
}

async function loadBudgetItemizedMonthly({ propertyCode, bearer }) {
  const r = await pg("/rpc/get_budget_itemized_monthly", {
    bearer,
    method: "POST",
    body: { p_property_code: propertyCode },
  });
  if (!r.ok)
    return {
      rows: [],
      error: `get_budget_itemized_monthly failed [${r.status}]: ${(r.raw || "").slice(0, 200)}`,
    };
  return { rows: Array.isArray(r.body) ? r.body : [], error: null };
}

const BUDGET_REASON = {
  READ_FAILED: "BUDGET_READ_FAILED",
  NONE: "BUDGET_NONE",
  AMBIGUOUS: "BUDGET_AMBIGUOUS",
  NO_ID: "BUDGET_NO_ID",
};

const BUDGET_REASON_PLAIN = {
  [BUDGET_REASON.NONE]:
    "No Working budget exists in Entrata for this year, so nothing was written. " +
    "Create the Working budget in Entrata, then push again.",
  [BUDGET_REASON.AMBIGUOUS]:
    "More than one Working budget exists for this year, so nothing was written. " +
    "Leave a single Working budget in place, then push again.",
  [BUDGET_REASON.READ_FAILED]:
    "The budget list could not be read from Entrata, so nothing was written. " +
    "This is usually temporary — try the push again, and raise it if it keeps happening.",
  [BUDGET_REASON.NO_ID]:
    "Entrata returned a Working budget with no identifier, so nothing was written. " +
    "Raise this one — a retry will not fix it.",
};
function plainReason(reasonCode) {
  return (
    BUDGET_REASON_PLAIN[reasonCode] ||
    "No budget could be resolved in Entrata, so nothing was written."
  );
}
async function resolveBudgetId({ entrataPropertyId, budgetYear, ctx }) {
  const gb = await entrataCall({
    baseUrl: ctx.baseUrl,
    subdomain: ctx.subdomain,
    apiKey: ctx.apiKey,
    resource: "financial",
    methodName: "getBudgets",
    version: "r1",
    params: {
      propertyIds: String(entrataPropertyId),
      budgetYear: String(budgetYear),
    },
  });
  if (!gb.ok) {
    return {
      reasonCode: BUDGET_REASON.READ_FAILED,
      error:
        `Live getBudgets read failed [${gb.status}] resolving the Working budget for ` +
        `property_id=${entrataPropertyId}, year=${budgetYear}. A Working (status type 2) ` +
        `budget must already exist in Entrata before a writeback can update it.`,
    };
  }
  const root = gb.body && gb.body.response && gb.body.response.result;
  const propsRaw =
    root &&
    root.properties &&
    (root.properties.property || root.properties.Property);
  const propList = Array.isArray(propsRaw)
    ? propsRaw
    : propsRaw
      ? [propsRaw]
      : [];
  const budgets = [];
  for (const p of propList) {
    const wrap = p && (p.budgets || p.Budgets);
    const list = wrap && (wrap.budget || wrap.Budget);
    if (Array.isArray(list)) budgets.push(...list);
    else if (list) budgets.push(list);
  }
  const yr = String(budgetYear);
  const norm = (b, ...ks) => {
    for (const k of ks) {
      if (b && b[k] != null) return String(b[k]);
    }
    return "";
  };
  const yearMatches = budgets.filter(
    (b) => norm(b, "fiscalYear", "FiscalYear") === yr,
  );
  const isWorkingStatus = (b) =>
    norm(b, "budgetStatusTypeId", "BudgetStatusTypeId") === "2";
  const workingBudgets = yearMatches.filter(isWorkingStatus);
  const summarize = (b) => ({
    id: b.id ?? b.Id ?? b.budgetId ?? b.BudgetId ?? b.BudgetID ?? null,
    statusTypeId: norm(b, "budgetStatusTypeId", "BudgetStatusTypeId") || null,
    name: norm(b, "budgetName", "BudgetName") || null,
  });
  if (workingBudgets.length === 0) {
    return {
      reasonCode: BUDGET_REASON.NONE,
      error:
        `No Working (budgetStatusTypeId '2') budget exists in Entrata for ` +
        `property_id=${entrataPropertyId}, year=${budgetYear}. updateBudgets only persists ` +
        `to a Working budget; the Current/Operating budgets are not API-writable. ` +
        `Budgets seen for this year: ${JSON.stringify(yearMatches.map(summarize)).slice(0, 400)}. ` +
        `Identify/create the Working budget in Entrata first.`,
    };
  }
  if (workingBudgets.length > 1) {
    return {
      reasonCode: BUDGET_REASON.AMBIGUOUS,
      error:
        `Ambiguous: ${workingBudgets.length} Working (statusType-2) budgets match ` +
        `property_id=${entrataPropertyId}, year=${budgetYear}. Cannot safely pick a write ` +
        `target. Candidates: ${JSON.stringify(workingBudgets.map(summarize)).slice(0, 400)}.`,
    };
  }
  const pick = workingBudgets[0];
  const id =
    pick.id ?? pick.Id ?? pick.budgetId ?? pick.BudgetId ?? pick.BudgetID;
  if (id == null || id === "") {
    return {
      reasonCode: BUDGET_REASON.NO_ID,
      error:
        `Resolved the Working budget for property_id=${entrataPropertyId}, year=${budgetYear} ` +
        `but it has no usable id field: ${JSON.stringify(summarize(pick)).slice(0, 200)}`,
    };
  }
  return {
    budgetId: Number(id),
    source: "getBudgets",
    statusTypeId: "2",
    budgetName: norm(pick, "budgetName", "BudgetName") || null,
  };
}

async function insertSyncRun({ connectorId, orgId, payload }) {
  const r = await pg("/connector_sync_runs", {
    bearer: getServiceRoleKey(),
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        connector_id: connectorId,
        org_id: orgId,
        direction: "out",
        resource_type: "budget_writeback",
        status: "running",
        triggered_by: "manual",
        payload,
      },
    ],
  });
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    return {
      error: `connector_sync_runs insert failed [${r.status}]: ${(r.raw || "").slice(0, 200)}`,
    };
  }
  return { runId: r.body[0].id };
}

async function patchSyncRun({ runId, patch }) {
  const r = await pg(
    `/connector_sync_runs?id=eq.${encodeURIComponent(runId)}`,
    {
      bearer: getServiceRoleKey(),
      method: "PATCH",
      prefer: "return=minimal",
      body: patch,
    },
  );
  if (!r.ok) {
    console.error(
      "[entrata-budget-writeback] sync-run PATCH failed",
      r.status,
      (r.raw || "").slice(0, 200),
    );
    return {
      ok: false,
      error: `sync-run PATCH failed [${r.status}]: ${(r.raw || "").slice(0, 200)}`,
    };
  }
  return { ok: true };
}

async function recordStageFailure({
  ctx,
  profile,
  mapping,
  propertyCode,
  fiscalYears,
  mode,
  stage,
  detail,
  plainMessage,
}) {
  if (!ctx || !ctx.connectorId || !profile || !profile.orgId) {
    console.error(
      "[entrata-budget-writeback] stage-failure record skipped, no connector/org",
      stage,
    );
    return null;
  }
  const years = Array.isArray(fiscalYears) ? fiscalYears : [];
  const payload = {
    property_code: propertyCode || profile.propertyCode || undefined,
    property_name: (mapping && mapping.propertyName) || undefined,
    fiscal_year: years.length === 1 ? years[0] : undefined,
    fiscal_years: years.length > 0 ? years : undefined,
    budget_id: null,
    mode,
    failed_stage: stage,
    detail,
  };
  const ins = await insertSyncRun({
    connectorId: ctx.connectorId,
    orgId: profile.orgId,
    payload,
  });
  if (ins.error) {
    console.error(
      "[entrata-budget-writeback] stage-failure sync-run insert failed",
      stage,
      ins.error,
    );
    return null;
  }
  await patchSyncRun({
    runId: ins.runId,
    patch: {
      completed_at: new Date().toISOString(),
      status: "error",
      rows_read: 0,
      rows_written: 0,
      error_message: plainMessage,
      payload,
    },
  });
  return ins.runId;
}

async function writeAudit({
  userJwt,
  orgId,
  authId,
  userEmail,
  role,
  mode,
  outcome,
  propertyCode,
  fiscalYear,
  metadata,
}) {
  try {
    const r = await pg("/audit_log", {
      bearer: userJwt,
      method: "POST",
      prefer: "return=minimal",
      body: {
        org_id: orgId,
        user_id: authId,
        user_email: userEmail || null,
        action: `entrata.budget.writeback.${mode}`,
        resource_type: "entrata_budgets",
        resource_id: null,
        outcome,
        metadata: {
          actor_role: role || null,
          resource_ref: `${propertyCode}:${fiscalYear}`,
          ...(metadata || {}),
        },
      },
    });
    if (!r.ok) {
      console.error(
        "[entrata-budget-writeback] audit_log insert failed",
        r.status,
        (r.raw || "").slice(0, 200),
      );
    }
  } catch (e) {
    console.error(
      "[entrata-budget-writeback] audit_log insert threw",
      e?.message || e,
    );
  }
}

async function postEntrataUpdateBudgets({
  baseUrl,
  subdomain,
  apiKey,
  envelope,
}) {
  const url = `${baseUrl}/${encodeURIComponent(subdomain)}/v1/financial`;
  const headers = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    const rl = {
      minute:
        parseInt(r.headers.get("x-ratelimit-minute-remaining") || "") || null,
      hour: parseInt(r.headers.get("x-ratelimit-hour-remaining") || "") || null,
      day: parseInt(r.headers.get("x-ratelimit-day-remaining") || "") || null,
    };
    return { ok: r.ok, status: r.status, body: json, raw: text, rl };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      raw: `fetch failed: ${e?.message || String(e)}`,
      rl: { minute: null, hour: null, day: null },
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractBudgetResultNodes(entrataResponse) {
  const result =
    entrataResponse && (entrataResponse.result || entrataResponse.Result);
  const wrap = result && (result.budgets || result.Budgets);
  const list = wrap && (wrap.budget || wrap.Budget);
  if (Array.isArray(list)) return list.filter(Boolean);
  if (list) return [list];
  return [];
}

export function parseFiscalYears(body) {
  const rangeMsg = `fiscal_years must be integers in [0, ${FISCAL_YEAR_COUNT - 1}]`;
  let raw;
  if (body && Array.isArray(body.fiscal_years)) {
    raw = body.fiscal_years;
  } else if (body && body.fiscal_year != null) {
    raw = [body.fiscal_year];
  } else {
    return {
      error: "fiscal_years (number[]) or fiscal_year (number) is required",
    };
  }
  if (raw.length === 0)
    return { error: "fiscal_years must include at least one fiscal year" };

  const seen = new Set();
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number.parseInt(v, 10);
    if (!Number.isInteger(n) || n < 0 || n >= FISCAL_YEAR_COUNT) {
      return { error: rangeMsg };
    }
    seen.add(n);
  }
  return { fiscalYears: [...seen].sort((a, b) => a - b) };
}

async function runFiscalYearWriteback({
  fiscalYear,
  mode,
  forward,
  glMap,
  glMapError,
  mapping,
  ctx,
  profile,
  userJwt,
}) {
  const slice = sliceFiscalYear(forward, fiscalYear);
  const budgetYear = inferBudgetYearFromSlice(slice, fiscalYear);

  const budgetIdRes = await resolveBudgetId({
    entrataPropertyId: mapping.entrataPropertyId,
    budgetYear,
    ctx,
  });
  if (budgetIdRes.error) {
    const failReason = budgetIdRes.reasonCode || null;
    const failPayload = {
      property_code: profile.propertyCode || mapping.propertyCode || undefined,
      property_name: mapping.propertyName,
      fiscal_year: fiscalYear,
      budget_year: budgetYear,
      budget_id: null,
      mode,
      reason_code: failReason,
      failed_stage: "resolve_budget",
      detail: budgetIdRes.error,
    };
    let failRunId = null;
    const failIns = await insertSyncRun({
      connectorId: ctx.connectorId,
      orgId: profile.orgId,
      payload: failPayload,
    });
    if (failIns.error) {
      console.error(
        "[entrata-budget-writeback] resolution-failure sync-run insert failed",
        failIns.error,
      );
    } else {
      failRunId = failIns.runId;
      await patchSyncRun({
        runId: failRunId,
        patch: {
          completed_at: new Date().toISOString(),
          status: "error",
          rows_read: 0,
          rows_written: 0,
          error_message: plainReason(failReason),
          payload: failPayload,
        },
      });
    }
    return {
      fiscal_year: fiscalYear,
      budget_year: budgetYear,
      budget_id: null,
      budget_name: null,
      status: "error",
      sync_run_id: failRunId,
      error: budgetIdRes.error,
      reason_code: budgetIdRes.reasonCode || null,
      summary: null,
    };
  }
  const budgetId = budgetIdRes.budgetId;
  const budgetIdSource = budgetIdRes.source;
  const budgetStatusTypeId = budgetIdRes.statusTypeId || null;
  const budgetName = budgetIdRes.budgetName || null;

  const groupsRaw = groupByGlAccount(slice, fiscalYear);
  const groupsAll = attachEntrataGlAccountIds(groupsRaw, glMap);
  const groups = groupsAll.filter((g) => g.glAccountId != null);
  const accountsDroppedUnresolved = groupsAll
    .filter((g) => g.glAccountId == null)
    .map((g) => ({
      glAccountNumber: g.glAccountNumber,
      glAccountName: g.glAccountName,
      totalAmount: g.totalAmount,
    }));
  const accountsDroppedUnresolvedNumbers = accountsDroppedUnresolved.map(
    (a) => a.glAccountNumber,
  );

  const droppedCount = accountsDroppedUnresolved.length;
  const completenessNote =
    droppedCount === 0
      ? null
      : `Incomplete: ${droppedCount} account${droppedCount === 1 ? "" : "s"} ` +
        `could not be matched to an Entrata GL account, so ${droppedCount === 1 ? "its" : "their"} ` +
        "figures were not sent and Entrata still holds whatever it held before. " +
        `Account${droppedCount === 1 ? "" : "s"} not sent: ` +
        `${accountsDroppedUnresolvedNumbers.slice(0, 20).join(", ")}` +
        `${droppedCount > 20 ? `, and ${droppedCount - 20} more` : ""}.` +
        (glMapError
          ? " The GL account lookup also reported a problem, so this list may be incomplete."
          : "");
  const qualification =
    completenessNote ||
    (glMapError
      ? `The GL account lookup reported a problem: ${glMapError}`
      : null);
  const envelope = buildEntrataBudgetEnvelope({
    entrataPropertyId: mapping.entrataPropertyId,
    budgetId,
    groups,
  });
  const budgetMonthCount =
    envelope.method.params.budgets.budget[0].glAccounts.glAccount.length;
  const summary = summarizeEnvelope(envelope, groups);
  const accountsMissingNumbers = accountsDroppedUnresolvedNumbers;
  const sliceRowCount = slice.length;

  const syncRunPayload = {
    property_code: profile.propertyCode || mapping.propertyCode || undefined,
    property_name: mapping.propertyName,
    fiscal_year: fiscalYear,
    budget_year: budgetYear,
    budget_id: budgetId,
    budget_id_source: budgetIdSource,
    budget_status_type_id: budgetStatusTypeId,
    budget_name: budgetName,
    mode,
    summary,
    accounts_missing_entrata_id: accountsMissingNumbers,
    accounts_dropped_unresolved: accountsDroppedUnresolved,
    gl_map_load_error: glMapError || null,
    completeness_note: qualification,
  };
  const runIns = await insertSyncRun({
    connectorId: ctx.connectorId,
    orgId: profile.orgId,
    payload: syncRunPayload,
  });
  if (runIns.error) {
    return {
      fiscal_year: fiscalYear,
      budget_year: budgetYear,
      budget_id: budgetId,
      budget_name: budgetName,
      status: "error",
      sync_run_id: null,
      error: runIns.error,
      summary,
      ...(mode === "live"
        ? { accounts_dropped_unresolved: accountsDroppedUnresolvedNumbers }
        : {}),
    };
  }
  const runId = runIns.runId;

  if (mode === "dry_run") {
    const dryPatch = await patchSyncRun({
      runId,
      patch: {
        completed_at: new Date().toISOString(),
        status: "success",
        rows_read: sliceRowCount,
        rows_written: 0,
        error_message: qualification,
      },
    });
    await writeAudit({
      userJwt,
      orgId: profile.orgId,
      authId: profile.authId,
      userEmail: profile.email,
      role: profile.role,
      mode: "dry_run",
      outcome: "success",
      propertyCode: profile.propertyCode,
      fiscalYear,
      metadata: {
        sync_run_id: runId,
        summary,
        accounts_missing_entrata_id: accountsMissingNumbers.length,
        bookkeeping_warning: dryPatch.ok ? null : dryPatch.error,
      },
    });
    return {
      fiscal_year: fiscalYear,
      budget_year: budgetYear,
      budget_id: budgetId,
      budget_name: budgetName,
      status: "success",
      sync_run_id: runId,
      error: qualification,
      summary,
    };
  }

  if (budgetMonthCount === 0) {
    const refusalMsg =
      "No forward-budget cells to push for this fiscal year (none present, or none resolved to an Entrata gl account).";
    await patchSyncRun({
      runId,
      patch: {
        completed_at: new Date().toISOString(),
        status: "error",
        error_message:
          "Envelope had zero budgetMonth lines (no resolved gl accounts with forward-budget cells for this FY). Nothing to push.",
      },
    });
    return {
      fiscal_year: fiscalYear,
      budget_year: budgetYear,
      budget_id: budgetId,
      budget_name: budgetName,
      status: "error",
      sync_run_id: runId,
      error: refusalMsg,
      summary,
      accounts_dropped_unresolved: accountsDroppedUnresolvedNumbers,
    };
  }

  const post = await postEntrataUpdateBudgets({
    baseUrl: ctx.baseUrl,
    subdomain: ctx.subdomain,
    apiKey: ctx.apiKey,
    envelope,
  });

  const nodeId = (n) =>
    (n && (n.id ?? n.Id ?? n.budgetId ?? n.BudgetId)) ?? null;
  const entrataResponse = (post.body && post.body.response) || null;
  const entrataError =
    entrataResponse && entrataResponse.error ? entrataResponse.error : null;
  const budgetResultNodes = extractBudgetResultNodes(entrataResponse);
  const hasBudgetNodes = budgetResultNodes.length > 0;
  const failedBudgetNodes = budgetResultNodes.filter(
    (n) =>
      String((n && (n.status ?? n.Status)) || "").toLowerCase() !== "success",
  );
  const allBudgetsSucceeded = hasBudgetNodes && failedBudgetNodes.length === 0;
  const applied = post.ok && !entrataError && allBudgetsSucceeded;
  const liveStatus = applied ? "success" : "error";
  const rowsWritten = applied ? budgetMonthCount : 0;
  const describeNode = (n) =>
    `#${nodeId(n) ?? "-"} ${(n && (n.status ?? n.Status)) ?? "-"}: ${(n && (n.message ?? n.Message)) ?? ""}`;
  const errorMessage = applied
    ? qualification
    : entrataError
      ? `Entrata updateBudgets error [${entrataError.code ?? "-"}]: ${(entrataError.message ?? JSON.stringify(entrataError)).slice(0, 300)}`
      : !post.ok
        ? `Entrata POST returned ${post.status}: ${(post.raw || "").slice(0, 500)}`
        : failedBudgetNodes.length
          ? `Entrata updateBudgets reported per-budget failure (HTTP ${post.status}, response.error:null): ${failedBudgetNodes.map(describeNode).join("; ").slice(0, 400)}`
          : !hasBudgetNodes
            ? `Entrata updateBudgets returned HTTP ${post.status} with no budgets.budget[].status nodes to confirm the write applied — treating as NOT applied (fail-closed for a money write). Raw: ${(post.raw || "").slice(0, 300)}`
            : `Entrata updateBudgets returned an unexpected non-applied state (HTTP ${post.status}). Raw: ${(post.raw || "").slice(0, 300)}`;

  const entrataBudgetResults = budgetResultNodes.map((n) => ({
    id: (n && (n.id ?? n.Id ?? n.budgetId ?? n.BudgetId)) ?? null,
    status: (n && (n.status ?? n.Status)) ?? null,
    message: (n && (n.message ?? n.Message)) ?? null,
  }));

  const livePatch = await patchSyncRun({
    runId,
    patch: {
      completed_at: new Date().toISOString(),
      status: liveStatus,
      rows_read: sliceRowCount,
      rows_written: rowsWritten,
      error_message: errorMessage,
      payload: {
        ...syncRunPayload,
        entrata_status: post.status,
        entrata_applied: applied,
        entrata_budget_results: entrataBudgetResults,
        entrata_response_excerpt: entrataResponse
          ? JSON.stringify(entrataResponse).slice(0, 4000)
          : null,
        rl: post.rl,
      },
    },
  });

  await writeAudit({
    userJwt,
    orgId: profile.orgId,
    authId: profile.authId,
    userEmail: profile.email,
    role: profile.role,
    mode: "live",
    outcome: applied ? "success" : "failure",
    propertyCode: profile.propertyCode,
    fiscalYear,
    metadata: {
      sync_run_id: runId,
      summary,
      entrata_status: post.status,
      entrata_applied: applied,
      entrata_budget_results: entrataBudgetResults,
      entrata_response: entrataResponse
        ? JSON.stringify(entrataResponse).slice(0, 1500)
        : null,
      rl: post.rl,
      accounts_missing_entrata_id: accountsMissingNumbers.length,
      accounts_dropped_unresolved: accountsDroppedUnresolved.length,
      bookkeeping_warning: livePatch.ok ? null : livePatch.error,
    },
  });

  return {
    fiscal_year: fiscalYear,
    budget_year: budgetYear,
    budget_id: budgetId,
    budget_name: budgetName,
    status: liveStatus,
    sync_run_id: runId,
    entrata_status: post.status,
    entrata_applied: applied,
    entrata_budget_results: entrataBudgetResults,
    error: errorMessage,
    summary,
    accounts_dropped_unresolved: accountsDroppedUnresolvedNumbers,
  };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
    maxBodyBytes: 100_000,
  });
  if (gate.error) return gate.error;
  const { user, body } = gate;

  const propertyCode =
    body && typeof body.property_code === "string"
      ? body.property_code.trim()
      : "";
  const isResolveOnly = !!(body && body.mode === "resolve");
  const mode = body && (body.mode === "live" ? "live" : "dry_run");

  if (!propertyCode)
    return jsonResponse(400, { error: "property_code is required" });
  const fyParsed = parseFiscalYears(body);
  if (fyParsed.error) return jsonResponse(400, { error: fyParsed.error });
  const fiscalYears = fyParsed.fiscalYears;

  const userJwt = (
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ""
  ).replace(/^Bearer\s+/i, "");
  const profile = await resolveCallerProfile(userJwt, user.id);
  if (profile.error) return jsonResponse(403, { error: profile.error });
  if (!canWriteBudget(profile))
    return jsonResponse(403, {
      error: "Insufficient role for budget writeback (need admin, am, or gp).",
    });
  profile.propertyCode = propertyCode;

  const mapping = await resolveEntrataPropertyMapping({
    orgId: profile.orgId,
    propertyCode,
    bearer: userJwt,
  });
  if (mapping.error) {
    return jsonResponse(422, {
      error: mapping.error,
      ambiguousCandidates: mapping.ambiguousCandidates || undefined,
    });
  }
  mapping.propertyCode = propertyCode;

  const ctx = await getEntrataContext({
    orgId: profile.orgId,
    entrataAccountId: mapping.entrataAccountId,
  });
  if (ctx.error) return jsonResponse(502, { error: ctx.error });

  if (isResolveOnly) {
    const resolved = [];
    for (const fiscalYear of fiscalYears) {
      const budgetYear = inferBudgetYearFromSlice([], fiscalYear);
      const r = await resolveBudgetId({
        entrataPropertyId: mapping.entrataPropertyId,
        budgetYear,
        ctx,
      });
      resolved.push({
        fiscal_year: fiscalYear,
        budget_year: budgetYear,
        budget_id: r.error ? null : r.budgetId,
        budget_name: r.error ? null : r.budgetName || null,
        budget_status_type_id: r.error ? null : r.statusTypeId || null,
        error: r.error || null,
        reason_code: r.reasonCode || null,
      });
    }
    return jsonResponse(200, { mode: "resolve", resolved });
  }

  const coaRes = await loadBudgetCoaMonthly({ propertyCode, bearer: userJwt });
  if (coaRes.error) {
    await recordStageFailure({
      ctx,
      profile,
      mapping,
      propertyCode,
      fiscalYears,
      mode,
      stage: "load_coa",
      detail: coaRes.error,
      plainMessage:
        "This property's budget could not be read, so nothing was written. " +
        "This is usually temporary — try the push again, and raise it if it keeps happening.",
    });
    return jsonResponse(502, { error: coaRes.error });
  }
  const forward = filterForwardBudgetCells(coaRes.rows);

  const includePriorMonths = !!(body && body.include_prior_months === true);
  let priorCells = [];
  let priorMonthsError = null;
  if (includePriorMonths) {
    const itemizedRes = await loadBudgetItemizedMonthly({
      propertyCode,
      bearer: userJwt,
    });
    if (itemizedRes.error) {
      await recordStageFailure({
        ctx,
        profile,
        mapping,
        propertyCode,
        fiscalYears,
        mode,
        stage: "load_itemized",
        detail: itemizedRes.error,
        plainMessage:
          "The prior-month figures could not be read, so nothing was written. " +
          "Push again without prior months included, or raise this if it keeps happening.",
      });
      return jsonResponse(502, { error: itemizedRes.error });
    }
    priorCells = buildPriorMonthCells(itemizedRes.rows, forward);
    if (priorCells.length === 0) {
      priorMonthsError =
        "include_prior_months was requested but no realized itemized-budget cells were found for this property.";
    }
  }
  const priorCellsInScope = includePriorMonths
    ? fiscalYears.reduce(
        (n, fy) => n + sliceFiscalYear(priorCells, fy).length,
        0,
      )
    : 0;
  if (
    !priorMonthsError &&
    includePriorMonths &&
    priorCellsInScope === 0 &&
    priorCells.length > 0
  ) {
    priorMonthsError =
      "Prior months were requested, but none of this property's " +
      "realized months fall inside the fiscal year being pushed, so none were included.";
  }
  const cells = includePriorMonths ? forward.concat(priorCells) : forward;

  const glMapRes = await loadGlAccountIdMap({
    orgId: profile.orgId,
    bearer: userJwt,
    accountNumbers: cells.map((c) => c && c.account_number),
  });

  const results = [];
  for (const fy of fiscalYears) {
    const row = await runFiscalYearWriteback({
      fiscalYear: fy,
      mode,
      forward: cells,
      glMap: glMapRes.map,
      glMapError: glMapRes.error,
      mapping,
      ctx,
      profile,
      userJwt,
    });
    results.push(row);
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const overall =
    successCount === results.length
      ? "all_success"
      : successCount === 0
        ? "all_error"
        : "partial";

  const httpStatus = overall === "all_error" ? 502 : 200;
  return jsonResponse(httpStatus, {
    mode,
    overall,
    results,
    include_prior_months: includePriorMonths,
    prior_month_cells: priorCellsInScope,
    prior_months_warning: priorMonthsError || undefined,
  });
};
