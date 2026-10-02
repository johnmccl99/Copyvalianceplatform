import { createClient } from "@supabase/supabase-js";
import {
  buildRealPropertyFilterContext,
  disabledRealPropertyFilterContext,
  applyRealPropertyFilter,
  occupancyRowHasActivity,
  leaseExpirationRowHasActivity,
  concessionRowHasActivity,
  workOrderRowHasActivity,
} from "./realPropertyFilter.js";
import {
  SCHEDULER_TRIGGER,
  MANUAL_TRIGGERS,
} from "./connectors/syncSchedule.js";
import { EMPTY } from "./numberFormat.js";
import {
  dateYear,
  isMonthKey,
  monthStartIso,
  monthEndIso,
} from "./dateFormat.js";
import { baselineRpcArgs } from "./budgetBaseline.js";
import {
  applyRentRollRangeFilters,
  normalizeAsOf,
  resolveRentRollRowsBetween,
} from "./entrataLeaseStatus.js";
import { rentRollPeriod } from "./rentRollPeriod.js";

const FALLBACK_SUPABASE_URL = "https://mxyrienplzkxuadnkwba.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXJpZW5wbHpreHVhZG5rd2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTQ5NDUsImV4cCI6MjA5MTQzMDk0NX0.83NSAZEXc4HjzRm66eBcT5kB0EYbCBtnn1NP1d6X4eA";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

if (
  !import.meta.env.VITE_SUPABASE_URL ||
  !import.meta.env.VITE_SUPABASE_ANON_KEY
) {
  console.warn(
    "[supabase] Using fallback anon credentials. For production hygiene, set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in Netlify env vars.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getCurrentAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

export async function startFormulaAudit(graphId, propertyId) {
  const token = await getCurrentAccessToken();
  const res = await fetch(
    "/.netlify/functions/underwriting-formula-audit-background",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ graph_id: graphId, property_id: propertyId }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function fetchFormulaAuditRun(runId) {
  const { data, error } = await supabase
    .from("property_underwriting_formula_audit_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function startScenarioSweep(
  propertyId,
  graphId,
  variationPct = 0.05,
) {
  const token = await getCurrentAccessToken();
  const res = await fetch(
    "/.netlify/functions/underwriting-scenario-sweep-background",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({
        property_id: propertyId,
        graph_id: graphId,
        variation_pct: variationPct,
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202)
    throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function continueScenarioSweep(sweepId) {
  const token = await getCurrentAccessToken();
  const res = await fetch(
    "/.netlify/functions/underwriting-scenario-sweep-background",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ sweep_id: sweepId }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202)
    throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const SCENARIO_SWEEP_STALE_MS = 75 * 1000;

export const RUNNING_JOB_RECENCY_MS = 60 * 60 * 1000;

export function runningJobRecencyCutoffIso() {
  return new Date(Date.now() - RUNNING_JOB_RECENCY_MS).toISOString();
}

export async function fetchLatestScenarioSweep(graphId) {
  const { data, error } = await supabase
    .from("property_underwriting_scenario_sweeps")
    .select("*")
    .eq("graph_id", graphId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchLatestFormulaAuditRun(graphId) {
  const { data, error } = await supabase
    .from("property_underwriting_formula_audit_runs")
    .select("*")
    .eq("graph_id", graphId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function abortFormulaAudit(runId) {
  const { data, error } = await supabase
    .from("property_underwriting_formula_audit_runs")
    .update({
      status: "cancelled",
      error_message: "Cancelled from UI by user",
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "running")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function clearStaleFormulaAudits(graphId, staleMinutes = 15) {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("property_underwriting_formula_audit_runs")
    .update({
      status: "error",
      error_message: `Auto-cleared: started before ${cutoff} and never finished (past Netlify cap so definitively dead).`,
      completed_at: new Date().toISOString(),
    })
    .eq("graph_id", graphId)
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");
  if (error) throw error;
  return data?.length || 0;
}

export async function fetchFormulaAuditFindings(
  runId,
  { status, limit = 200, offset = 0 } = {},
) {
  let q = supabase
    .from("property_underwriting_formula_audit_findings")
    .select("*")
    .eq("run_id", runId);
  if (status) q = q.eq("status", status);
  q = q
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function runUnderwritingRecompute(
  propertyId,
  graphId,
  dirtyCells,
) {
  const token = await getCurrentAccessToken();
  const kickoffAt = Date.now();
  const res = await fetch(
    "/.netlify/functions/underwriting-recompute-background",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({
        property_id: propertyId,
        graph_id: graphId,
        dirty_cells: dirtyCells,
      }),
    },
  );
  if (res.status >= 500) {
    throw new Error(`recompute kickoff failed: HTTP ${res.status}`);
  }
  const deadline = kickoffAt + 5000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const row = await fetchLatestRecomputeJob(graphId);
      if (row) {
        const rowStartMs = new Date(row.started_at).getTime();
        const isFresh = rowStartMs >= kickoffAt - 1000;
        const isRunning = row.status === "running";
        if (isFresh || isRunning) {
          return {
            job_id: row.id,
            status: row.status,
            alreadyRunning: isRunning && !isFresh,
          };
        }
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw lastErr || new Error("recompute job row did not appear within 5s");
}

export async function fetchLatestRecomputeJob(graphId) {
  const cutoff = runningJobRecencyCutoffIso();
  const { data, error } = await supabase
    .from("property_underwriting_recompute_jobs")
    .select("*")
    .eq("graph_id", graphId)
    .or(`status.neq.running,started_at.gte.${cutoff}`)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchRecomputeJob(jobId) {
  const { data, error } = await supabase
    .from("property_underwriting_recompute_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchModelResetPreview(graphId) {
  if (!graphId) throw new Error("graphId required");
  const { data, error } = await supabase.rpc("model_reset_preview", {
    p_graph_id: graphId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (
    row || {
      cells_with_baseline: 0,
      cells_without_baseline: 0,
      canonical_keys_with_baseline: 0,
      has_running_recompute: false,
      last_recompute_at: null,
    }
  );
}

export async function resetModelToBaseline(graphId) {
  if (!graphId) throw new Error("graphId required");
  const { data, error } = await supabase.rpc("reset_model_to_baseline", {
    p_graph_id: graphId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (
    row || {
      cells_reset: 0,
      cells_skipped_no_baseline: 0,
      canonical_values_synced: 0,
      executed_at: new Date().toISOString(),
    }
  );
}

export async function fetchDiscoveryRun(runId) {
  const { data, error } = await supabase
    .from("underwriting_discovery_runs")
    .select(
      "id,property_id,status,review_status,mapping,preview_values,workbook_summary,source_file_id,source_file_path,error_message,error_stage,started_at,completed_at,ai_model",
    )
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchLatestDiscoveryRunForProperty(propertyId) {
  const { data, error } = await supabase
    .from("underwriting_discovery_runs")
    .select(
      "id,property_id,status,review_status,mapping,preview_values,workbook_summary,source_file_id,source_file_path,error_message,error_stage,started_at,completed_at,ai_model",
    )
    .eq("property_id", propertyId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchActiveDiscoveryRuns(limit = 10) {
  const cutoff = runningJobRecencyCutoffIso();
  const { data, error } = await supabase
    .from("underwriting_discovery_runs")
    .select(
      "id,property_id,status,review_status,error_stage,error_message,started_at,property:properties(id,name)",
    )
    .or(
      `and(status.eq.running,started_at.gte.${cutoff}),and(status.eq.complete,review_status.eq.pending_review)`,
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function markDiscoveryRunSaved(runId) {
  const { error } = await supabase
    .from("underwriting_discovery_runs")
    .update({ review_status: "saved" })
    .eq("id", runId);
  if (error) throw error;
  return true;
}

export async function fetchCanonicalInputCells(graphId) {
  const { data, error } = await supabase
    .from("property_underwriting_model_nodes")
    .select(
      "id,sheet,cell,canonical_key,canonical_role,semantic_label,value_num,value_text",
    )
    .eq("graph_id", graphId)
    .not("canonical_key", "is", null)
    .eq("is_formula", false)
    .order("canonical_key", { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

export async function fetchParityReferenceForInput(
  graphId,
  canonicalInputKey,
  perturbationValue,
) {
  if (!graphId || !canonicalInputKey || perturbationValue === undefined)
    return [];
  const { data, error } = await supabase
    .from("property_underwriting_parity_reference")
    .select(
      "id,target_sheet,target_cell,target_canonical_key,excel_value,excel_value_type,validated_at,validation_notes",
    )
    .eq("graph_id", graphId)
    .eq("canonical_input_key", canonicalInputKey)
    .contains("perturbation_value", perturbationValue)
    .order("target_sheet", { ascending: true })
    .order("target_cell", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchModelNodesByCells(graphId, cellKeys) {
  if (!graphId || !Array.isArray(cellKeys) || cellKeys.length === 0) return [];
  const bySheet = new Map();
  for (const k of cellKeys) {
    if (!k?.sheet || !k?.cell) continue;
    if (!bySheet.has(k.sheet)) bySheet.set(k.sheet, []);
    bySheet.get(k.sheet).push(k.cell);
  }
  const queries = Array.from(bySheet.entries()).map(async ([sheet, cells]) => {
    const { data, error } = await supabase
      .from("property_underwriting_model_nodes")
      .select("sheet,cell,formula,value_num,value_text,value_date,is_formula")
      .eq("graph_id", graphId)
      .eq("sheet", sheet)
      .in("cell", cells);
    if (error) throw error;
    return data || [];
  });
  const chunks = await Promise.all(queries);
  return chunks.flat();
}

export async function insertParityReference({ propertyId, graphId, rows }) {
  if (!propertyId)
    throw new Error("insertParityReference: propertyId required");
  if (!graphId) throw new Error("insertParityReference: graphId required");
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("insertParityReference: rows must be a non-empty array");
  }
  const { data: prop, error: pErr } = await supabase
    .from("properties")
    .select("org_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!prop?.org_id)
    throw new Error("insertParityReference: property org_id not resolvable");
  const { data: userData } = await supabase.auth.getUser();
  const validatedBy = userData?.user?.id || null;
  const stamped = rows.map((r) => ({
    org_id: prop.org_id,
    property_id: propertyId,
    graph_id: graphId,
    canonical_input_key: r.canonical_input_key,
    input_sheet: r.input_sheet,
    input_cell: r.input_cell,
    perturbation_value: r.perturbation_value,
    target_sheet: r.target_sheet,
    target_cell: r.target_cell,
    target_canonical_key: r.target_canonical_key ?? null,
    excel_value: r.excel_value,
    excel_value_type: r.excel_value_type,
    validation_notes: r.validation_notes ?? null,
    validated_by: validatedBy,
  }));
  const { data, error } = await supabase
    .from("property_underwriting_parity_reference")
    .insert(stamped)
    .select("*");
  if (error) throw error;
  return data || [];
}

function formatStrategy(s) {
  const map = {
    value_add: "Value-Add",
    opportunistic: "Opportunistic",
    core_plus: "Core-Plus",
    core: "Core",
  };
  return map[s] || s;
}

function formatStatus(s) {
  const map = {
    investing: "Investing",
    harvesting: "Harvesting",
    closed: "Closed",
    fundraising: "Fundraising",
  };
  return map[s] || s;
}

function formatPropertyType(t) {
  const map = {
    office: "Office",
    industrial: "Industrial",
    multifamily: "Multifamily",
    retail: "Retail",
    mixed_use: "Mixed-Use",
    hospitality: "Hospitality",
    land: "Land",
  };
  return map[t] || t;
}

function formatDealStage(s) {
  const map = {
    screening: "Initial Review",
    loi: "LOI Submitted",
    due_diligence: "Under DD",
    ic_review: "IC Review",
    closed: "Closed",
    dead: "Dead",
  };
  return map[s] || s;
}

function formatLoanType(t) {
  const map = {
    cmbs: "CMBS",
    bank: "Bank",
    life_co: "Life Co",
    agency: "Agency",
    bridge: "Bridge",
    mezzanine: "Mezzanine",
  };
  return map[t] || t;
}

function formatWorkOrderStatus(s) {
  const map = {
    submitted: "Pending Approval",
    in_progress: "In Progress",
    completed: "Completed",
    on_hold: "On Hold",
  };
  return map[s] || s;
}

function formatPriority(p) {
  if (p == null) return p;
  const map = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    urgent: "Urgent",
  };
  return map[String(p).toLowerCase()] || p;
}

function formatComplianceStatus(s) {
  const map = {
    complete: "Completed",
    in_progress: "In Progress",
    upcoming: "Pending",
    overdue: "Overdue",
  };
  return map[s] || s;
}

function formatCapCallStatus(s) {
  const map = {
    funded: "Funded",
    issued: "Pending",
    draft: "Draft",
    partially_funded: "Partial",
  };
  return map[s] || s;
}

function formatQuarter(period) {
  if (!period) return "";
  const m = period.match(/(\d{4})-Q(\d)/);
  if (m) return `Q${m[2]} '${m[1].slice(2)}`;
  return period;
}

let _fundNameMapPromise = null;

async function getFundNameMap() {
  if (_fundNameMapPromise) return _fundNameMapPromise;
  _fundNameMapPromise = (async () => {
    try {
      const { data } = await supabase.from("funds").select("id, name");
      const map = {};
      (data || []).forEach((f) => {
        map[f.id] = f.name;
      });
      return map;
    } catch (e) {
      _fundNameMapPromise = null;
      console.warn("[Supabase] getFundNameMap failed:", e.message);
      return {};
    }
  })();
  return _fundNameMapPromise;
}

let _propNameMapPromise = null;

async function getPropertyNameMap() {
  if (_propNameMapPromise) return _propNameMapPromise;
  _propNameMapPromise = (async () => {
    try {
      const { data } = await supabase.from("properties").select("id, name");
      const map = {};
      (data || []).forEach((p) => {
        map[p.id] = p.name;
      });
      return map;
    } catch (e) {
      _propNameMapPromise = null;
      console.warn("[Supabase] getPropertyNameMap failed:", e.message);
      return {};
    }
  })();
  return _propNameMapPromise;
}

export async function fetchFunds() {
  const { data, error } = await supabase
    .from("funds")
    .select(
      "id, name, vintage, strategy, committed, deployed, irr, equity_multiple, dpi, tvpi, status",
    )
    .order("vintage", { ascending: false });
  if (error) {
    console.error("fetchFunds error:", error);
    return [];
  }
  return (data || []).map((f) => ({
    id: f.id,
    name: f.name,
    vintage: f.vintage,
    strategy: formatStrategy(f.strategy),
    aum: f.deployed || 0,
    committed: f.committed || 0,
    deployed: f.deployed || 0,
    irr: (f.irr || 0) * 100,
    em: f.equity_multiple || 0,
    dpi: f.dpi || 0,
    tvpi: f.tvpi || 0,
    status: formatStatus(f.status),
  }));
}

export async function fetchModuleVisibility(orgId) {
  if (!orgId) return new Set();
  const { data, error } = await supabase
    .from("module_visibility")
    .select("surface_key")
    .eq("org_id", orgId)
    .eq("visible", false);
  if (error) {
    console.error("fetchModuleVisibility error:", error);
    const err = new Error(
      error.message || "Could not read this workspace’s module visibility.",
    );
    err.name = "ModuleVisibilityReadError";
    err.code = error.code;
    err.details = error.details;
    err.cause = error;
    throw err;
  }
  if (!Array.isArray(data)) {
    console.error(
      "fetchModuleVisibility: non-array payload with no error",
      data,
    );
    const err = new Error("Module visibility read returned no result set.");
    err.name = "ModuleVisibilityReadError";
    throw err;
  }
  return new Set(data.map((row) => row.surface_key));
}

export async function setModuleVisibility(orgId, surfaceKey, visible) {
  const { error } = await supabase
    .from("module_visibility")
    .upsert(
      { org_id: orgId, surface_key: surfaceKey, visible },
      { onConflict: "org_id,surface_key" },
    );
  if (error) {
    console.error("setModuleVisibility error:", error);
    throw error;
  }
}

export async function fetchIsPlatformSuperAdmin() {
  try {
    const token = await getCurrentAccessToken();
    if (!token) return false;
    const base =
      import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon =
      import.meta.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(`${base}/rest/v1/rpc/is_platform_super_admin`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    return res.ok && (await res.json()) === true;
  } catch (e) {
    console.error("fetchIsPlatformSuperAdmin error:", e);
    return false;
  }
}

export async function fetchProperties() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, name, property_type, submarket, total_sf, unit_count, occupancy, noi, cap_rate, current_value, fund_id, mgmt_company, year_acquired, entrata_property_id, address_line1, city, state, zip, year_built, acquisition_date, acquisition_price",
    )
    .order("name");
  if (error) {
    console.error("fetchProperties error:", error);
    return [];
  }
  return (data || [])
    .map((p, i) => mapPropertyRow(p, fundMap, i))
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

export async function fetchEntrataRentRoll(propertyId, { asOf } = {}) {
  if (!propertyId) return [];
  const period = rentRollPeriod(asOf);

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop || !prop.entrata_property_id) return [];

  const { data, error } = await applyRentRollRangeFilters(
    supabase
      .from("entrata_leases")
      .select(
        "lease_id, unit_id, unit_number, status, " +
          "lease_start_date, lease_end_date, move_in_date, move_out_date, " +
          "rent, deposit, primary_customer_id, primary_customer_name, " +
          "primary_customer_email, is_mtm, last_seen_at, space_configuration",
      )
      .eq("property_id", prop.entrata_property_id),
    period.start,
    period.end,
  ).order("unit_number", { ascending: true });
  if (error) throw error;

  return resolveRentRollRowsBetween(data || [], period.start, period.end)
    .map(mapEntrataLeaseRow)
    .filter(Boolean);
}

export async function fetchEntrataRentRollChargeMatrix(
  propertyId,
  { asOf } = {},
) {
  if (!propertyId) return [];
  const on = normalizeAsOf(asOf);

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop || !prop.entrata_property_id) return [];

  const { data, error } = await supabase.rpc(
    "entrata_rent_roll_charge_matrix",
    {
      p_property_id: prop.entrata_property_id,
      p_as_of: rentRollPeriod(on).end,
    },
  );
  if (error) throw error;
  return data || [];
}

export async function fetchEntrataUnitRoster(propertyId) {
  if (!propertyId) return [];

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop || !prop.entrata_property_id) return [];

  const { data, error } = await supabase
    .from("entrata_units")
    .select("property_id, unit_id, unit_number, raw")
    .eq("property_id", prop.entrata_property_id);
  if (error) throw error;
  return data || [];
}

export async function fetchEntrataUnitAttributes(propertyId) {
  if (!propertyId) return [];

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop || !prop.entrata_property_id) return [];

  const { data, error } = await supabase
    .from("entrata_units")
    .select("property_id, unit_id, unit_number, unit_type_name, sqft, raw")
    .eq("property_id", prop.entrata_property_id);
  if (error) throw error;
  return data || [];
}

export async function fetchWorkbookSpaceSf(propertyId) {
  if (!propertyId) return [];

  const { data: mapRows, error: mapErr } = await supabase
    .from("budget_property_code_map")
    .select("property_code")
    .eq("property_id", propertyId);
  if (mapErr) throw mapErr;
  const codes = (mapRows || [])
    .map((r) => (r.property_code == null ? "" : String(r.property_code).trim()))
    .filter(Boolean);
  if (!codes.length) return [];

  const { data, error } = await supabase
    .schema("raw")
    .from("workbook_space_sf")
    .select("property_code, space_label, bedspace_sf, bedroom_sf, term_tag")
    .in("property_code", codes);
  if (error) throw error;
  return data || [];
}

export async function fetchEntrataLeaseSpaceIds(propertyId) {
  const out = new Map();
  if (!propertyId) return out;

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop || !prop.entrata_property_id) return out;

  const collect = (rows, read) => {
    for (const row of rows || []) {
      if (!row || row.lease_id == null) continue;
      const v = read(row);
      if (v == null || v === "") continue;
      const n = Number(v);
      if (Number.isFinite(n)) out.set(row.lease_id, n);
    }
  };

  const { data, error } = await supabase
    .from("entrata_leases")
    .select("lease_id, unit_space_id:raw->>unitSpaceId")
    .eq("property_id", prop.entrata_property_id);
  if (!error) {
    collect(data, (row) => row.unit_space_id);
    return out;
  }

  console.warn(
    "fetchEntrataLeaseSpaceIds: JSON-path select rejected; falling back to full raw payload",
    error,
  );
  const fallback = await supabase
    .from("entrata_leases")
    .select("lease_id, raw")
    .eq("property_id", prop.entrata_property_id);
  if (fallback.error) throw fallback.error;
  collect(fallback.data, (row) =>
    row.raw && typeof row.raw === "object" ? row.raw.unitSpaceId : null,
  );
  return out;
}

async function resolvePropertyEntrata(propertyId) {
  const { data: prop, error } = await supabase
    .from("properties")
    .select("id, org_id, entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw error;
  return prop || null;
}

const LEASE_ADJUSTMENT_COLUMNS =
  "id, org_id, property_id, adjustment_type, lease_id, payload, note, " +
  "is_active, signed_off_by, signed_off_at, " +
  "created_at, created_by, updated_at, updated_by";

export async function fetchLeaseAdjustments(propertyId) {
  if (!propertyId) return [];
  const prop = await resolvePropertyEntrata(propertyId);
  if (!prop || !prop.entrata_property_id) return [];
  const { data, error } = await supabase
    .from("lease_adjustments")
    .select(LEASE_ADJUSTMENT_COLUMNS)
    .eq("property_id", prop.entrata_property_id)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("fetchLeaseAdjustments error:", error);
    throw error;
  }
  return data || [];
}

export async function insertLeaseAdjustment(propertyId, fields = {}) {
  if (!propertyId)
    throw new Error("insertLeaseAdjustment: propertyId required");
  if (!fields.adjustment_type)
    throw new Error("insertLeaseAdjustment: adjustment_type required");
  const prop = await resolvePropertyEntrata(propertyId);
  if (!prop?.org_id)
    throw new Error("insertLeaseAdjustment: property org_id not resolvable");
  if (!prop?.entrata_property_id)
    throw new Error("insertLeaseAdjustment: property is not mapped to Entrata");
  const row = {
    org_id: prop.org_id,
    property_id: prop.entrata_property_id,
    adjustment_type: fields.adjustment_type,
    lease_id: fields.lease_id ?? null,
    payload: fields.payload ?? {},
    note: fields.note ?? null,
    is_active: fields.is_active ?? true,
    signed_off_by: fields.signed_off_by ?? null,
    signed_off_at: fields.signed_off_at ?? null,
  };
  const { data, error } = await supabase
    .from("lease_adjustments")
    .insert(row)
    .select(LEASE_ADJUSTMENT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateLeaseAdjustment(id, patch = {}) {
  if (!id) throw new Error("updateLeaseAdjustment: id required");
  const allowed = {};
  for (const k of [
    "adjustment_type",
    "lease_id",
    "payload",
    "note",
    "is_active",
    "signed_off_by",
    "signed_off_at",
  ]) {
    if (k in patch) allowed[k] = patch[k];
  }
  if (Object.keys(allowed).length === 0)
    throw new Error("updateLeaseAdjustment: no updatable fields");
  const { data, error } = await supabase
    .from("lease_adjustments")
    .update(allowed)
    .eq("id", id)
    .select(LEASE_ADJUSTMENT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteLeaseAdjustment(id) {
  if (!id) throw new Error("deleteLeaseAdjustment: id required");
  const { error } = await supabase
    .from("lease_adjustments")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function fetchEntrataConnectorLastSync() {
  const { data, error } = await supabase
    .from("connectors")
    .select("last_sync_at, last_sync_status")
    .eq("vendor", "entrata")
    .maybeSingle();
  if (error) {
    console.error("fetchEntrataConnectorLastSync error:", error);
    return null;
  }
  return data
    ? {
        last_sync_at: data.last_sync_at || null,
        last_sync_status: data.last_sync_status || null,
      }
    : null;
}

export const ENTRATA_CORE_FRESHNESS_TABLES = [
  "entrata_leases",
  "entrata_units",
  "entrata_properties",
];

export async function countEntrataLeasesAnyDate(propertyId) {
  if (!propertyId) return 0;
  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop || !prop.entrata_property_id) return 0;

  const { count, error } = await supabase
    .from("entrata_leases")
    .select("lease_id", { count: "exact", head: true })
    .eq("property_id", prop.entrata_property_id);
  if (error) throw error;
  return count || 0;
}

export async function fetchEntrataDataFreshness(
  tables = ENTRATA_CORE_FRESHNESS_TABLES,
) {
  const entries = await Promise.all(
    tables.map(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select("last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(`fetchEntrataDataFreshness ${table} error:`, error);
        return [table, null];
      }
      return [table, (data && data.last_seen_at) || null];
    }),
  );
  return computeEntrataDataFreshness(Object.fromEntries(entries));
}

export async function fetchEntrataPropertyDataFreshness(
  entrataPropertyId,
  tables = ENTRATA_CORE_FRESHNESS_TABLES,
) {
  if (!entrataPropertyId) return computeEntrataDataFreshness({});
  const entries = await Promise.all(
    tables.map(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select("last_seen_at")
        .eq("property_id", entrataPropertyId)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(
          `fetchEntrataPropertyDataFreshness ${table} error:`,
          error,
        );
        return [table, null];
      }
      return [table, (data && data.last_seen_at) || null];
    }),
  );
  return computeEntrataDataFreshness(Object.fromEntries(entries));
}

export async function fetchGlActualFreshness(propertyCode) {
  if (!propertyCode) return computeEntrataDataFreshness({});
  const { data, error } = await supabase
    .schema("raw")
    .from("entrata_gl_actual")
    .select("ingested_at")
    .eq("property_code", propertyCode)
    .order("ingested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("fetchGlActualFreshness error:", error);
    return computeEntrataDataFreshness({});
  }
  return computeEntrataDataFreshness({
    entrata_gl_actual: (data && data.ingested_at) || null,
  });
}

export function computeEntrataDataFreshness(perTable) {
  const safe = perTable || {};
  const values = Object.values(safe).filter(Boolean);
  const maxLastSeen = values.length
    ? values.reduce((a, b) => (a > b ? a : b))
    : null;
  return { maxLastSeen, perTable: safe };
}

let _rpFilterContextPromise = null;
export async function getRealPropertyFilterContext({ refresh = false } = {}) {
  if (!_rpFilterContextPromise || refresh) {
    _rpFilterContextPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from("property_legal_entity")
          .select("entrata_id, entity_classification");
        if (error) throw error;
        return buildRealPropertyFilterContext(data || []);
      } catch (err) {
        console.error(
          "[rp-filter] property_legal_entity unavailable — failing open (no entity filtering):",
          err,
        );
        return disabledRealPropertyFilterContext();
      }
    })();
  }
  return _rpFilterContextPromise;
}

export async function fetchEntrataPortfolioOccupancy() {
  const { data, error } = await supabase.rpc("entrata_portfolio_occupancy");
  if (error) throw error;
  const rows = (data || []).map((r) => ({
    propertyId: r.property_id,
    propertyName: r.property_name || null,
    totalUnits: Number(r.total_units) || 0,
    occupiedUnits: Number(r.occupied_units) || 0,
    leasedUnits: Number(r.leased_units) || 0,
    noticeUnits: Number(r.notice_units) || 0,
    inPlaceRent: Number(r.in_place_rent) || 0,
    marketRent: Number(r.market_rent) || 0,
  }));
  return applyRealPropertyFilter(rows, await getRealPropertyFilterContext(), {
    hasActivity: occupancyRowHasActivity,
  });
}

export function mapPortfolioNoiMonthlyRow(r) {
  if (!r || typeof r !== "object") return null;
  return {
    monthEnd: r.month_end ?? null,
    actualNoi: r.actual_noi == null ? null : Number(r.actual_noi),
    forecastNoi: r.forecast_noi == null ? null : Number(r.forecast_noi),
    actualPropertyCount: Number(r.actual_property_count) || 0,
    propertyCount: Number(r.property_count) || 0,
    refreshedAt: r.refreshed_at ?? null,
  };
}

export async function fetchPortfolioNoiMonthly() {
  const { data, error } = await supabase.rpc("get_portfolio_noi_monthly");
  if (error) throw error;
  return (data || []).map(mapPortfolioNoiMonthlyRow).filter(Boolean);
}

export function mapEntrataBankAccountRosterRow(r) {
  if (!r || typeof r !== "object") return null;
  return {
    propertyId: r.property_id == null ? null : Number(r.property_id),
    propertyName: r.property_name || null,
    bankAccountId: r.bank_account_id == null ? null : Number(r.bank_account_id),
    bankAccountName: r.bank_account_name || null,
    accountType: r.account_type || null,
    bankName: r.bank_name || null,
    isDisabled: r.is_disabled === true,
  };
}

export async function fetchEntrataBankAccountRoster() {
  const { data, error } = await supabase.rpc("entrata_bank_account_roster");
  if (error) throw error;
  return (data || [])
    .map(mapEntrataBankAccountRosterRow)
    .filter((r) => r != null);
}

export async function fetchEntrataLeaseExpiration() {
  const { data, error } = await supabase.rpc("entrata_lease_expiration");
  if (error) throw error;
  const rows = (data || []).map((r) => ({
    propertyId: r.property_id,
    propertyName: r.property_name || null,
    expiring30: Number(r.expiring_30) || 0,
    expiring60: Number(r.expiring_60) || 0,
    expiring90: Number(r.expiring_90) || 0,
    expiring180: Number(r.expiring_180) || 0,
    expiring365: Number(r.expiring_365) || 0,
    exposure30: Number(r.exposure_30) || 0,
    exposure60: Number(r.exposure_60) || 0,
    exposure90: Number(r.exposure_90) || 0,
    exposure180: Number(r.exposure_180) || 0,
    exposure365: Number(r.exposure_365) || 0,
    atRiskCount: Number(r.at_risk_count) || 0,
    atRiskExposure: Number(r.at_risk_exposure) || 0,
    expiringInPlaceRent: Number(r.expiring_in_place_rent) || 0,
    expiringMarketRent: Number(r.expiring_market_rent) || 0,
    mtmCount: Number(r.mtm_count) || 0,
  }));
  return applyRealPropertyFilter(rows, await getRealPropertyFilterContext(), {
    hasActivity: leaseExpirationRowHasActivity,
  });
}

export async function fetchEntrataLeaseConcessions() {
  const { data, error } = await supabase.rpc("entrata_lease_concessions");
  if (error) throw error;
  const rows = (data || []).map((r) => ({
    propertyId: r.property_id,
    propertyName: r.property_name || null,
    totalLeases: Number(r.total_leases) || 0,
    concessionLeaseCount: Number(r.concession_lease_count) || 0,
    concessionTotal: Number(r.concession_total) || 0,
    oneTimeConcessionTotal: Number(r.one_time_concession_total) || 0,
    recurringConcessionTotal: Number(r.recurring_concession_total) || 0,
    annualRentTotal: Number(r.annual_rent_total) || 0,
  }));
  return applyRealPropertyFilter(rows, await getRealPropertyFilterContext(), {
    hasActivity: concessionRowHasActivity,
  });
}

export async function fetchEntrataWorkOrderBacklog() {
  const { data, error } = await supabase.rpc("entrata_work_order_backlog");
  if (error) throw error;
  const rows = (data || []).map((r) => ({
    dimension: r.dimension || null,
    bucketLabel: r.bucket_label || null,
    propertyId: r.property_id == null ? null : Number(r.property_id),
    openCount: Number(r.open_count) || 0,
    totalCount: Number(r.total_count) || 0,
    avgDaysOpen: r.avg_days_open == null ? null : Number(r.avg_days_open),
    emergencyTotal: Number(r.emergency_total) || 0,
    emergencyResolved: Number(r.emergency_resolved) || 0,
    emergencyWithinSla: Number(r.emergency_within_sla) || 0,
    emergencyOpen: Number(r.emergency_open) || 0,
  }));
  return applyRealPropertyFilter(rows, await getRealPropertyFilterContext(), {
    hasActivity: workOrderRowHasActivity,
  });
}

export async function fetchCustomReportsForProperty(propertyId) {
  if (!propertyId) return [];
  const { data, error } = await supabase
    .from("property_custom_reports")
    .select("*")
    .eq("property_id", propertyId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("fetchCustomReportsForProperty error:", error);
    throw error;
  }
  return data || [];
}

export async function insertCustomReport({
  orgId,
  propertyId,
  name,
  description,
  endpointChain,
  displayConfig,
  createdBy,
}) {
  const row = {
    org_id: orgId,
    property_id: propertyId,
    name: (name || "").trim(),
    description: description || null,
    endpoint_chain: endpointChain,
    display_config: displayConfig || {},
    created_by: createdBy,
  };
  const { data, error } = await supabase
    .from("property_custom_reports")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    console.error("insertCustomReport error:", error);
    throw error;
  }
  return data;
}

export async function updateCustomReport(id, patch) {
  if (!id) throw new Error("updateCustomReport: id is required");
  const allowed = {};
  if (patch.name !== undefined) allowed.name = String(patch.name || "").trim();
  if (patch.description !== undefined)
    allowed.description = patch.description || null;
  if (patch.endpointChain !== undefined)
    allowed.endpoint_chain = patch.endpointChain;
  if (patch.displayConfig !== undefined)
    allowed.display_config = patch.displayConfig || {};
  const { data, error } = await supabase
    .from("property_custom_reports")
    .update(allowed)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("updateCustomReport error:", error);
    throw error;
  }
  return data;
}

export async function deleteCustomReport(id) {
  if (!id) throw new Error("deleteCustomReport: id is required");
  const { error } = await supabase
    .from("property_custom_reports")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("deleteCustomReport error:", error);
    throw error;
  }
  return true;
}

export async function fetchPipeline() {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "name, property_type, total_sf, asking_price, cap_rate, stage, submarket, city, state, projected_irr, projected_em",
    )
    .order("name");
  if (error) {
    console.error("fetchPipeline error:", error);
    return [];
  }
  return (data || []).map((d) => ({
    name: d.name,
    type: formatPropertyType(d.property_type),
    sf: d.total_sf || 0,
    askPrice: d.asking_price || 0,
    capRate: parseFloat(((d.cap_rate || 0) * 100).toFixed(1)),
    stage: formatDealStage(d.stage),
    market: d.submarket || `${d.city}, ${d.state}`,
    irr: parseFloat(((d.projected_irr || 0) * 100).toFixed(1)),
    em: d.projected_em || 0,
  }));
}

export async function fetchTenants() {
  const propMap = await getPropertyNameMap();
  const { data: leases, error: leaseErr } = await supabase
    .from("leases")
    .select("*, tenant:tenants(name, tenant_type)")
    .eq("status", "active");
  if (leaseErr) {
    console.error("fetchTenants error:", leaseErr);
    return [];
  }
  return (leases || []).map((l) => ({
    id: l.id,
    tenantId: l.tenant_id,
    name: l.tenant?.name || "",
    property: propMap[l.property_id] || "",
    sf: l.leased_sf || 0,
    rent: l.rent_per_sf || 0,
    leaseEnd: l.lease_end || "",
    type: formatPropertyType(l.tenant?.tenant_type || ""),
  }));
}

export async function fetchWorkOrders() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("work_orders")
    .select(
      "id, property_id, description, status, priority, estimated_cost, submitted_date",
    )
    .order("submitted_date", { ascending: false });
  if (error) {
    console.error("fetchWorkOrders error:", error);
    return [];
  }
  return (data || []).map((w, i) => ({
    id: w.id,
    displayId: `WO-${2401 + i}`,
    property: propMap[w.property_id] || "",
    desc: w.description || "",
    status: formatWorkOrderStatus(w.status),
    priority: formatPriority(w.priority),
    cost: w.estimated_cost || 0,
    date: w.submitted_date || "",
  }));
}

export async function fetchNoiTrend() {
  const { data, error } = await supabase
    .from("noi_actuals")
    .select("*")
    .order("period");
  if (error) {
    console.error("fetchNoiTrend error:", error);
    return [];
  }
  return (data || []).map((n) => ({
    quarter: formatQuarter(n.period),
    actual: parseFloat(((n.noi || 0) / 1000000).toFixed(1)),
    budget: parseFloat(((n.budget_noi || 0) / 1000000).toFixed(1)),
  }));
}

export async function fetchDistributions() {
  const { data, error } = await supabase
    .from("distributions")
    .select("*")
    .order("distribution_date");
  if (error) {
    console.error("fetchDistributions error:", error);
    return [];
  }
  return (data || []).map((d) => ({
    quarter: d.quarter || "",
    amount: d.gross_amount || 0,
    yield: parseFloat(((d.yield_pct || 0) * 100).toFixed(1)),
  }));
}

export async function fetchEmployees() {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("is_active", true)
    .order("last_name");
  if (error) {
    console.error("fetchEmployees error:", error);
    return [];
  }
  return (data || []).map((u) => ({
    name: `${u.first_name} ${u.last_name}`,
    title: u.title || "",
    dept: u.department || "",
  }));
}

function complianceCalendarRows() {
  return Promise.resolve(
    supabase
      .from("compliance_calendar")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("due_date"),
  );
}

export async function fetchCompliance(rowsPromise = null) {
  const { data, error } = await (rowsPromise || complianceCalendarRows());
  if (error) {
    console.error("fetchCompliance error:", error);
    return [];
  }
  return (data || []).map((c) => ({
    item: c.title || "",
    deadline: c.due_date || "",
    status: formatComplianceStatus(c.status),
    owner: c.assignee || "",
  }));
}

export async function fetchDebtSchedule() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("loans")
    .select(
      "id, property_id, lender_name, current_balance, interest_rate, maturity_date, ltv, dscr, covenant_ltv, covenant_dscr, loan_type",
    )
    .eq("status", "active")
    .order("maturity_date");
  if (error) {
    console.error("fetchDebtSchedule error:", error);
    return [];
  }
  return (data || []).map((l) => ({
    property: propMap[l.property_id] || "",
    lender: l.lender_name || "",
    balance: l.current_balance || 0,
    rate: parseFloat(((l.interest_rate || 0) * 100).toFixed(2)),
    maturity: l.maturity_date || "",
    ltv: Math.round((l.ltv || 0) * 100),
    dscr: l.dscr || 0,
    covenantLTV: Math.round((l.covenant_ltv || 0) * 100),
    covenantDSCR: l.covenant_dscr || 0,
    type: formatLoanType(l.loan_type),
  }));
}

export async function fetchFundPnl() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase.from("fund_financials").select("*");
  if (error) {
    console.error("fetchFundPnl error:", error);
    return [];
  }
  return (data || []).map((f) => ({
    fund: fundMap[f.fund_id] || "",
    revenue: f.revenue || 0,
    opex: f.operating_expenses || 0,
    noi: f.noi || 0,
    debtService: f.debt_service || 0,
    gAndA: f.g_and_a || 0,
    netIncome: f.net_income || 0,
  }));
}

export async function fetchCapitalCalls() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase
    .from("capital_calls")
    .select("*")
    .order("call_date");
  if (error) {
    console.error("fetchCapitalCalls error:", error);
    return [];
  }
  return (data || []).map((cc) => ({
    id: cc.id,
    displayId: `CC-${dateYear(cc.call_date) ?? ""}-${String(cc.call_number).padStart(2, "0")}`,
    fund: fundMap[cc.fund_id] || "",
    date: cc.call_date || "",
    amount: cc.total_amount || 0,
    purpose: cc.purpose || "",
    status: formatCapCallStatus(cc.status),
    pctCalled: Math.round((cc.pct_of_commitments || 0) * 100),
  }));
}

export async function fetchInvestors() {
  const { data, error } = await supabase
    .from("investors")
    .select(
      "id, name, legal_name, investor_type, city, state, relationship_since, tier, primary_contact_email, primary_contact_phone, bank_account_last4, ssn_last4, has_bank_info, has_ssn, has_dob, bank_name, legal_entity_type, ein_encrypted, bank_account_encrypted, bank_routing_encrypted, ssn_encrypted, dob_encrypted",
    )
    .order("name");
  if (error) {
    console.error("fetchInvestors error:", error);
    return [];
  }

  const typePrefix = {
    family_office: "LP",
    institutional: "LP",
    hnwi: "LP",
    co_invest: "JV",
    gp: "GP",
  };
  const typeDisplay = {
    family_office: "LP",
    institutional: "LP",
    hnwi: "LP",
    co_invest: "JV",
    gp: "GP",
  };
  let lpCount = 0,
    jvCount = 0,
    gpCount = 0;

  return (data || []).map((inv) => {
    const prefix = typePrefix[inv.investor_type] || "LP";
    let num;
    if (prefix === "LP") {
      lpCount++;
      num = String(lpCount).padStart(2, "0");
    } else if (prefix === "JV") {
      jvCount++;
      num = String(jvCount).padStart(2, "0");
    } else {
      gpCount++;
      num = String(gpCount).padStart(2, "0");
    }

    return {
      id: inv.id,
      displayId: `${prefix}${num}`,
      name: inv.name,
      entity: inv.legal_name || "",
      type: typeDisplay[inv.investor_type] || "LP",
      city: `${inv.city || ""}, ${inv.state || ""}`,
      since: inv.relationship_since
        ? (dateYear(inv.relationship_since) ?? "")
        : "",
      tier:
        (inv.tier || "").charAt(0).toUpperCase() + (inv.tier || "").slice(1),
      email: inv.primary_contact_email || "",
      phone: inv.primary_contact_phone || "",
      bankAccountLast4: inv.bank_account_last4 || null,
      ssnLast4: inv.ssn_last4 || null,
      hasBankInfo: !!inv.has_bank_info,
      hasSsn: !!inv.has_ssn,
      hasDob: !!inv.has_dob,
      hasEin: !!inv.ein_encrypted,
      bankName: inv.bank_name || "",
      legalEntityType: inv.legal_entity_type || "",
      bank_account_encrypted: inv.bank_account_encrypted,
      bank_routing_encrypted: inv.bank_routing_encrypted,
      ssn_encrypted: inv.ssn_encrypted,
      ein_encrypted: inv.ein_encrypted,
      dob_encrypted: inv.dob_encrypted,
    };
  });
}

export async function fetchChartOfAccounts() {
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("*")
    .order("account_code");
  if (error) {
    console.error("fetchChartOfAccounts error:", error);
    return [];
  }
  function deriveCategory(r) {
    const code = parseInt(r.account_code);
    if (r.account_type === "asset" && code < 1800) return "Current Assets";
    if (r.account_type === "asset") return "Fixed Assets";
    if (r.account_type === "liability" && code < 2600)
      return "Current Liabilities";
    if (r.account_type === "liability") return "Long-Term Liabilities";
    if (r.account_type === "equity") return "Partner Equity";
    if (r.account_type === "revenue" && code < 4300) return "Rental Revenue";
    if (r.account_type === "revenue") return "Other Revenue";
    if (r.account_type === "expense" && code >= 7100 && code < 7200)
      return "Financing Costs";
    if (r.account_type === "expense" && code >= 7200)
      return "Non-Cash Expenses";
    if (r.account_type === "expense") return "Operating Expenses";
    if (r.account_type === "income") return "Other Income";
    return r.account_type;
  }
  const typeMap = {
    asset: "Asset",
    liability: "Liability",
    equity: "Equity",
    revenue: "Revenue",
    expense: "Expense",
    income: "Income",
  };
  return (data || []).map((r) => ({
    code: r.account_code,
    name: r.account_name,
    type: typeMap[r.account_type] || r.account_type,
    category: deriveCategory(r),
    balance: r.balance || 0,
    isActive: r.is_active,
  }));
}

export async function fetchJournalEntries() {
  const propMap = await getPropertyNameMap();
  const fundMap = await getFundNameMap();
  const { data: entries, error } = await supabase
    .from("journal_entries")
    .select("*")
    .order("entry_date", { ascending: false });
  if (error) {
    console.error("fetchJournalEntries error:", error);
    return [];
  }
  const { data: lines } = await supabase
    .from("journal_entry_lines")
    .select("*");
  const lineMap = {};
  (lines || []).forEach((l) => {
    if (!lineMap[l.journal_entry_id]) lineMap[l.journal_entry_id] = [];
    lineMap[l.journal_entry_id].push({
      debit: l.debit || 0,
      credit: l.credit || 0,
      description: l.description || "",
    });
  });
  return (entries || []).map((e) => ({
    id: e.id,
    displayId: e.entry_number != null ? String(e.entry_number) : EMPTY,
    date: e.entry_date,
    property: propMap[e.property_id] || "",
    fund: fundMap[e.fund_id] || "",
    description: e.description || "",
    type: e.entry_type || "",
    status: e.status || "",
    entries: lineMap[e.id] || [],
  }));
}

export async function fetchInvoices() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, property_id, vendor_name, category, invoice_date, due_date, amount, tax_amount, total_amount, status",
    )
    .order("invoice_date", { ascending: false });
  if (error) {
    console.error("fetchInvoices error:", error);
    return [];
  }
  const statusMap = {
    draft: "draft",
    submitted: "pending",
    approved: "approved",
    paid: "paid",
    partially_paid: "partial",
    overdue: "overdue",
    void: "void",
    disputed: "disputed",
  };
  return (data || []).map((inv) => ({
    id: inv.id,
    displayId: inv.invoice_number || inv.id,
    property: propMap[inv.property_id] || "",
    vendor: inv.vendor_name || "",
    category: inv.category || "",
    invoiceDate: inv.invoice_date || "",
    dueDate: inv.due_date || "",
    paidDate: null,
    amount: inv.amount || 0,
    taxAmount: inv.tax_amount || 0,
    totalAmount: inv.total_amount || 0,
    status: statusMap[inv.status] || inv.status,
    approvalStatus: "",
    description: inv.category || "",
  }));
}

export async function fetchArAging() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("ar_aging")
    .select("*")
    .eq("org_id", ORG_ID);
  if (error) {
    console.error("fetchArAging error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    tenant: r.tenant_id || "",
    property: propMap[r.property_id] || "",
    totalDue: r.total_due || 0,
    current: r.current_amount || 0,
    days30: r.days_30 || 0,
    days60: r.days_60 || 0,
    days90Plus: r.days_90_plus || 0,
    lastPayment: r.last_payment_date || "",
  }));
}

export async function fetchApAging() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase.from("ap_aging").select("*");
  if (error) {
    console.error("fetchApAging error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    vendor: r.vendor_name || "",
    property: propMap[r.property_id] || "",
    totalDue: r.total_due || 0,
    current: r.current_amount || 0,
    days30: r.days_30 || 0,
    days60: r.days_60 || 0,
    days90Plus: r.days_90_plus || 0,
  }));
}

export async function fetchDepreciationSchedules() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("depreciation_schedules")
    .select("*")
    .order("property_id");
  if (error) {
    console.error("fetchDepreciationSchedules error:", error);
    return [];
  }
  const grouped = {};
  (data || []).forEach((r) => {
    const propName = propMap[r.property_id] || r.property_id;
    if (!grouped[propName]) grouped[propName] = [];
    grouped[propName].push({
      component: r.asset_description || "",
      basis: r.original_cost || 0,
      method:
        r.method === "straight_line"
          ? "Straight-Line"
          : r.method === "macrs"
            ? "MACRS"
            : r.method === "none"
              ? "N/A"
              : r.method,
      life: r.useful_life_years === 0 ? null : r.useful_life_years,
      yearlyDepreciation:
        r.useful_life_years > 0
          ? Math.round((r.original_cost || 0) / r.useful_life_years)
          : 0,
      accumulatedDepreciation: r.accumulated_depreciation || 0,
      nbv: r.net_book_value || 0,
    });
  });
  return Object.entries(grouped).map(([property, components]) => ({
    property,
    components,
    totalBasis: components.reduce((s, c) => s + c.basis, 0),
    totalDepreciation: components.reduce((s, c) => s + c.yearlyDepreciation, 0),
    totalAccumulated: components.reduce(
      (s, c) => s + c.accumulatedDepreciation,
      0,
    ),
    totalNBV: components.reduce((s, c) => s + c.nbv, 0),
  }));
}

export async function fetchLoanAmortization() {
  const propMap = await getPropertyNameMap();
  const { data: loans } = await supabase
    .from("loans")
    .select(
      "id, property_id, lender_name, original_balance, interest_rate, term_months",
    );
  const { data, error } = await supabase
    .from("loan_amortization")
    .select("*")
    .order("loan_id, payment_number");
  if (error) {
    console.error("fetchLoanAmortization error:", error);
    return [];
  }
  const loanInfo = {};
  (loans || []).forEach((l) => {
    loanInfo[l.id] = l;
  });
  const grouped = {};
  (data || []).forEach((r) => {
    if (!grouped[r.loan_id]) grouped[r.loan_id] = [];
    grouped[r.loan_id].push({
      month: r.payment_date || "",
      beginningBalance: r.beginning_balance || 0,
      payment: r.payment_amount || 0,
      principal: r.principal || 0,
      interest: r.interest || 0,
      endingBalance: r.ending_balance || 0,
    });
  });
  return Object.entries(grouped).map(([loanId, schedule]) => {
    const loan = loanInfo[loanId] || {};
    return {
      property: propMap[loan.property_id] || "",
      lender: loan.lender_name || "",
      originalBalance: loan.original_balance || 0,
      rate: loan.interest_rate || 0,
      schedule,
    };
  });
}

export async function fetchWaterfallTiers() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase
    .from("waterfall_tiers")
    .select("*")
    .order("fund_id, tier_order");
  if (error) {
    console.error("fetchWaterfallTiers error:", error);
    return [];
  }
  const grouped = {};
  (data || []).forEach((r) => {
    const fundName = fundMap[r.fund_id] || r.fund_id;
    if (!grouped[fundName]) grouped[fundName] = [];
    grouped[fundName].push({
      tierName: r.tier_name || "",
      tierOrder: r.tier_order || 0,
      hurdleRate: r.hurdle_rate || 0,
      carryRate: r.carry_rate || 0,
      catchUp: r.catch_up || false,
      description: r.description || "",
    });
  });
  return Object.entries(grouped).map(([fund, tiers]) => ({ fund, tiers }));
}

export async function fetchFeeCalculations() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase
    .from("fee_calculations")
    .select("*")
    .order("fund_id");
  if (error) {
    console.error("fetchFeeCalculations error:", error);
    return [];
  }
  return (data || []).map((f) => ({
    fund: fundMap[f.fund_id] || "",
    feeType: (f.fee_type || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    calculationBasis: f.calculation_basis || "",
    rate: f.rate || 0,
    period: f.period || "",
    amount: f.amount || 0,
    status: f.status || "",
  }));
}

export async function fetchOperatingBudgets() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("operating_budgets")
    .select("*")
    .order("property_id, category, line_item");
  if (error) {
    console.error("fetchOperatingBudgets error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    property: propMap[r.property_id] || "",
    fiscalYear: r.fiscal_year || 0,
    lineItem: r.line_item || "",
    category: r.category || "",
    budget: r.budget_amount || 0,
    actual: r.actual_amount || 0,
    priorYear: r.prior_year_actual || 0,
    variance: (r.budget_amount || 0) - (r.actual_amount || 0),
    variancePct: r.budget_amount
      ? ((r.budget_amount - (r.actual_amount || 0)) / r.budget_amount) * 100
      : 0,
  }));
}

export async function fetchCashFlowActuals() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase
    .from("cash_flow_actuals")
    .select("*")
    .order("period");
  if (error) {
    console.error("fetchCashFlowActuals error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    fund: fundMap[r.fund_id] || "",
    period: r.period || "",
    operatingCF: r.operating_cf || 0,
    investingCF: r.investing_cf || 0,
    financingCF: r.financing_cf || 0,
    netCF: r.net_cf || 0,
    beginningBalance: r.beginning_balance || 0,
    endingBalance: r.ending_balance || 0,
  }));
}

export async function fetchCapitalMarketsRates() {
  const { data, error } = await supabase
    .from("capital_markets_rates")
    .select("*")
    .order("as_of_date");
  if (error) {
    console.error("fetchCapitalMarketsRates error:", error);
    return [];
  }
  const byDate = {};
  (data || []).forEach((r) => {
    const key = r.as_of_date;
    if (!byDate[key]) byDate[key] = { date: r.as_of_date };
    const rt = r.rate_type;
    if (rt === "treasury_10y") byDate[key].treasury10Y = r.rate;
    else if (rt === "sofr") byDate[key].sofr = r.rate;
    else if (rt === "cmbs_5y") byDate[key].cmbs5Y = r.rate;
    else if (rt === "life_co_spread") byDate[key].lifeCoSpread = r.rate;
    else if (rt === "bank_spread") byDate[key].bankSpread = r.rate;
    else if (rt === "agency_spread") byDate[key].agencySpread = r.rate;
    else byDate[key][rt] = r.rate;
  });
  return Object.values(byDate);
}

export async function fetchCapRateTrends() {
  const { data, error } = await supabase
    .from("cap_rate_trends")
    .select("*")
    .order("period");
  if (error) {
    console.error("fetchCapRateTrends error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    propertyType: formatPropertyType(r.property_type),
    market: r.market || "",
    capRate: r.cap_rate ? parseFloat((r.cap_rate * 100).toFixed(2)) : 0,
    period: r.period || "",
    priorPeriodRate: r.prior_period_rate
      ? parseFloat((r.prior_period_rate * 100).toFixed(2))
      : 0,
    spreadToTreasury: r.spread_to_treasury || 0,
  }));
}

export async function fetchTransactionVolume() {
  const { data, error } = await supabase
    .from("transaction_volume")
    .select("*")
    .order("quarter");
  if (error) {
    console.error("fetchTransactionVolume error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    propertyType: formatPropertyType(r.property_type),
    quarter: r.quarter || "",
    volume: r.volume || 0,
    dealCount: r.deal_count || 0,
    avgDealSize: r.avg_deal_size || 0,
  }));
}

export async function fetchSubmarketData() {
  const { data, error } = await supabase
    .from("submarket_data")
    .select("*")
    .order("submarket");
  if (error) {
    console.error("fetchSubmarketData error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    submarket: r.submarket || "",
    propertyType: formatPropertyType(r.property_type),
    vacancyRate: r.vacancy_rate
      ? parseFloat((r.vacancy_rate * 100).toFixed(1))
      : 0,
    askingRent: r.asking_rent || 0,
    absorptionSF: r.absorption_sf || 0,
    inventorySF: r.inventory_sf || 0,
    underConstructionSF: r.under_construction_sf || 0,
  }));
}

export async function fetchMarketComps() {
  const { data, error } = await supabase
    .from("market_comps")
    .select("*")
    .order("sale_date", { ascending: false });
  if (error) {
    console.error("fetchMarketComps error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    id: r.id,
    name: r.property_name,
    type: formatPropertyType(r.property_type),
    submarket: r.submarket || "",
    sf: r.total_sf || r.sf || 0,
    saleDate: r.sold_date || r.sale_date || "",
    salePrice: r.sale_price || 0,
    capRate: r.cap_rate ? +(r.cap_rate * 100).toFixed(1) : null,
    pricePSF: r.price_per_sf || 0,
    buyer: r.buyer || "",
    seller: r.seller || "",
    source: r.source || "",
  }));
}

export async function fetchCompetitors() {
  const { data, error } = await supabase
    .from("competitors")
    .select("*")
    .order("aum", { ascending: false });
  if (error) {
    console.error("fetchCompetitors error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    name: r.name || "",
    market: r.market || "",
    strategy: formatStrategy(r.strategy),
    aum: r.aum || 0,
    recentAcquisitions: r.recent_acquisitions || 0,
    notes: r.notes || "",
  }));
}

export async function fetchEsgMetrics() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("esg_metrics")
    .select("*")
    .order("property_id, metric_type");
  if (error) {
    console.error("fetchEsgMetrics error:", error);
    return [];
  }
  const grouped = {};
  (data || []).forEach((r) => {
    const propName = propMap[r.property_id] || r.property_id;
    if (!grouped[propName]) grouped[propName] = { property: propName };
    grouped[propName][r.metric_type] = r.metric_value;
  });
  return Object.values(grouped);
}

export async function fetchCarbonReductionPlans() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("carbon_reduction_plans")
    .select("*")
    .order("property_id");
  if (error) {
    console.error("fetchCarbonReductionPlans error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    property: propMap[r.property_id] || "",
    targetYear: r.target_year || 0,
    baselineEmissions: r.baseline_emissions || 0,
    currentEmissions: r.current_emissions || 0,
    targetEmissions: r.target_emissions || 0,
    initiatives: r.initiatives || "",
    status: r.status || "",
    reductionPct: r.baseline_emissions
      ? Math.round((1 - r.current_emissions / r.baseline_emissions) * 100)
      : 0,
  }));
}

export async function fetchStressTestScenarios() {
  const { data, error } = await supabase
    .from("stress_test_scenarios")
    .select("*");
  if (error) {
    console.error("fetchStressTestScenarios error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    scenarioName: r.scenario_name || "",
    rateChangeBps: r.rate_change_bps || 0,
    vacancyImpactPct: r.vacancy_impact_pct || 0,
    noiImpactPct: r.noi_impact_pct || 0,
    valueImpactPct: r.value_impact_pct || 0,
    description: r.description || "",
  }));
}

export async function fetchRiskWatchlist() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase.from("risk_watchlist").select("*");
  if (error) {
    console.error("fetchRiskWatchlist error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    property: propMap[r.property_id] || "",
    riskCategory: r.risk_category || "",
    severity: r.severity || "",
    description: r.description || "",
    mitigation: r.mitigation || "",
    status: r.status || "",
  }));
}

export async function fetchAlerts() {
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchAlerts error:", error);
    return [];
  }
  return (data || []).map((r, i) => ({
    id: r.id,
    displayId: `ALT-${String(i + 1).padStart(3, "0")}`,
    type: r.alert_type || "",
    severity: r.severity || "",
    title: r.title || "",
    description: r.message || "",
    message: r.message || "",
    source: r.source || r.trigger_rule || "",
    isRead: r.is_read || false,
    date: r.created_at || "",
    created_at: r.created_at || "",
    status: r.status || (r.is_read ? "acknowledged" : "active"),
    property: r.property_id ? propMap[r.property_id] || "" : "",
    property_name: r.property_id ? propMap[r.property_id] || "" : "",
    assignee: r.owner || "",
    assigned_to: r.owner || "",
    owner: r.owner || "",
    alert_type: r.alert_type || "",
  }));
}

export async function fetchActionItems() {
  const { data, error } = await supabase
    .from("action_items")
    .select("*")
    .order("due_date");
  if (error) {
    console.error("fetchActionItems error:", error);
    return [];
  }
  return (data || []).map((r, i) => ({
    id: r.id,
    num: i + 1,
    text: r.title || "",
    description: r.description || "",
    priority: formatPriority(r.priority),
    dueDate: r.due_date || "",
    category: r.category || "",
    status:
      r.status === "open"
        ? "Open"
        : r.status === "in_progress"
          ? "In Progress"
          : r.status === "completed"
            ? "Completed"
            : r.status,
  }));
}

export async function fetchLegalEntities() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase
    .from("legal_entities")
    .select("*")
    .order("entity_name");
  if (error) {
    console.error("fetchLegalEntities error:", error);
    return [];
  }
  const rows = data || [];
  const nameById = Object.fromEntries(
    rows.map((r) => [r.id, r.entity_name || ""]),
  );
  return rows.map((r) => ({
    entity: r.entity_name || "",
    entityName: r.entity_name || "",
    legalName: r.legal_name || "",
    type: r.entity_type || "",
    entityType: r.entity_type || "",
    jurisdiction: r.jurisdiction || "",
    fund: fundMap[r.fund_id] || "",
    status: r.status || "",
    parent: r.parent_entity_id ? nameById[r.parent_entity_id] || null : null,
    parentId: r.parent_entity_id || null,
    entityCode: r.entity_code || "",
    entrataId: r.entrata_id || "",
    propertyCode: r.property_code || "",
    classification: r.entity_classification || "",
  }));
}

export async function fetchPropertyEntityLinks() {
  const [propMap, entityNameById] = await Promise.all([
    getPropertyNameMap(),
    (async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, entity_name");
      if (error) {
        console.error(
          "fetchPropertyEntityLinks entity-name lookup error:",
          error,
        );
        return {};
      }
      return Object.fromEntries(
        (data || []).map((r) => [r.id, r.entity_name || ""]),
      );
    })(),
  ]);
  const { data, error } = await supabase
    .from("property_legal_entity")
    .select(
      "id, legal_entity_id, property_id, property_code, entrata_id, entity_classification",
    )
    .order("property_code", { nullsFirst: false });
  if (error) {
    console.error("fetchPropertyEntityLinks error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    id: r.id,
    entityId: r.legal_entity_id,
    entity: entityNameById[r.legal_entity_id] || "",
    propertyId: r.property_id || null,
    property: r.property_id ? propMap[r.property_id] || null : null,
    propertyCode: r.property_code || "",
    entrataId: r.entrata_id || "",
    classification: r.entity_classification || "",
  }));
}

export async function runEntityMatrixProjection(orgId) {
  const { data, error } = await supabase.rpc("project_entity_matrix", {
    p_org_id: orgId,
  });
  if (error) {
    console.error("runEntityMatrixProjection error:", error);
    return null;
  }
  return data || null;
}

export async function fetchDocuments() {
  const fundMap = await getFundNameMap();
  const propMap = await getPropertyNameMap();
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, file_name, category, fund_id, property_id, file_type, subcategory, status, access_level, version, storage_path, description, source_type, source_ref, external_url",
    )
    .order("file_name");
  if (error) {
    console.error("fetchDocuments error:", error);
    return [];
  }
  return (data || []).map((r, i) => ({
    id: r.id,
    displayId: `DOC${String(i + 1).padStart(3, "0")}`,
    name: r.file_name || "",
    category: (r.category || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    fund: fundMap[r.fund_id] || null,
    property: propMap[r.property_id] || null,
    type: r.file_type || "",
    subcategory: r.subcategory || "",
    status:
      r.status === "final"
        ? "Final"
        : r.status === "draft"
          ? "Draft"
          : r.status,
    access:
      r.access_level === "lp_gp"
        ? "LP + GP"
        : r.access_level === "gp_only"
          ? "GP Only"
          : r.access_level,
    version: r.version || 1,
    storagePath: r.storage_path || "",
    description: r.description || "",
    source_type: r.source_type || "supabase_storage",
    source_ref: r.source_ref || r.storage_path || "",
    external_url: r.external_url || null,
    _raw: {
      source_type: r.source_type,
      source_ref: r.source_ref,
      storage_path: r.storage_path,
      external_url: r.external_url,
    },
  }));
}

export async function fetchDocumentRequests() {
  const fundMap = await getFundNameMap();
  const { data, error } = await supabase
    .from("document_requests")
    .select("*")
    .eq("org_id", ORG_ID);
  if (error) {
    console.error("fetchDocumentRequests error:", error);
    return [];
  }
  return (data || []).map((r) => ({
    investor: r.investor_id || "",
    documentType: r.document_type || "",
    fund: fundMap[r.fund_id] || "",
    status: r.status || "",
    requestDate: r.request_date || "",
    dueDate: r.due_date || "",
  }));
}

export async function fetchAuditLog() {
  return [];
}

export async function fetchDealScorecards() {
  try {
    const { data, error } = await supabase
      .from("deal_scorecards")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("score_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      dealName: r.deal_name,
      location: r.location_score,
      basisScore: r.basis_score,
      tenancyScore: r.tenancy_score,
      capRateSpreadScore: r.cap_rate_spread_score,
      marketScore: r.market_score,
      sponsorScore: r.sponsor_score,
      totalScore: r.total_score,
      maxScore: r.max_score,
      recommendation: r.recommendation,
      analyst: r.analyst,
      date: r.score_date,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDealScorecards failed:", e.message);
    return [];
  }
}

export async function fetchDealCommunications() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("deal_communications")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("comm_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      deal: r.deal_name,
      date: r.comm_date,
      type: r.comm_type,
      direction: r.direction,
      from: r.from_party,
      subject: r.subject,
      snippet: r.snippet,
      flag: r.flag,
      insight: r.insight,
      priority: r.priority,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDealCommunications failed:", e.message);
    return [];
  }
}

export async function fetchDispositionPipeline() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("disposition_pipeline")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("target_close", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      name: propMap[r.property_id] || r.property_id,
      type: r.property_type,
      sf: r.sf,
      basis: r.basis,
      estValue: r.est_value,
      gain: r.gain,
      gainPct: r.gain_pct,
      targetClose: r.target_close,
      fund: fundMap[r.fund_id] || r.fund_id,
      broker: r.broker,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDispositionPipeline failed:", e.message);
    return [];
  }
}

export async function fetchDisposedProperties() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("disposed_properties")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("sale_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      name: r.property_name,
      type: r.property_type,
      sf: r.sf,
      basis: r.basis,
      salePrice: r.sale_price,
      irr: r.irr,
      em: r.em,
      saleDate: r.sale_date,
      fund: fundMap[r.fund_id] || r.fund_id,
      hold: r.hold_years,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDisposedProperties failed:", e.message);
    return [];
  }
}

export async function fetchDispositionTracker() {
  try {
    const { data, error } = await supabase
      .from("disposition_tracker")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("property_name", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      propertyName: r.property_name,
      phase: r.phase,
      casSent: r.cas_sent,
      casExecuted: r.cas_executed,
      toursScheduled: r.tours_scheduled,
      toursCompleted: r.tours_completed,
      bidsReceived: r.bids_received,
      guidancePrice: r.guidance_price,
      timeline: r.timeline,
      bidders: r.bidders,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDispositionTracker failed:", e.message);
    return [];
  }
}

export async function fetchFundraisingPipeline() {
  try {
    const { data, error } = await supabase
      .from("fundraising_pipeline")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("investor_name", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      investor: r.investor_name,
      type: r.investor_type,
      targetCommit: r.target_commit,
      status: r.status,
      probability: r.probability,
      lastContact: r.last_contact,
      assignedTo: r.assigned_to,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchFundraisingPipeline failed:", e.message);
    return [];
  }
}

export async function fetchBusinessPlans() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("business_plans")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("property_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      fund: fundMap[r.fund_id] || r.fund_id,
      acquisitionDate: r.acquisition_date,
      holdPeriod: r.hold_period,
      noiUw: r.noi_uw,
      noiActual: r.noi_actual,
      noiVariance: r.noi_variance,
      occupancyUw: r.occupancy_uw,
      occupancyActual: r.occupancy_actual,
      occupancyVariance: r.occupancy_variance,
      rentGrowthUw: r.rent_growth_uw,
      rentGrowthActual: r.rent_growth_actual,
      rentGrowthVariance: r.rent_growth_variance,
      capexUw: r.capex_uw,
      capexActual: r.capex_actual,
      capexVariance: r.capex_variance,
      irrUw: r.irr_uw,
      irrProjected: r.irr_projected,
      irrVariance: r.irr_variance,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchBusinessPlans failed:", e.message);
    return [];
  }
}

export async function fetchPropertyValuations() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("property_valuations")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("property_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      fund: fundMap[r.fund_id] || r.fund_id,
      methodology: r.methodology,
      currentValue: r.current_value,
      priorValue: r.prior_value,
      change: r.value_change,
      capRate: r.cap_rate,
      discountRate: r.discount_rate,
      terminalCap: r.terminal_cap,
      quarterlyValues: [],
    }));
  } catch (e) {
    console.warn("[Supabase] fetchPropertyValuations failed:", e.message);
    return [];
  }
}

export async function fetchPropertyValuationHistory() {
  try {
    const { data, error } = await supabase
      .from("property_valuation_history")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("quarter", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      valuationId: r.valuation_id,
      quarter: r.quarter,
      value: r.value,
      capRate: r.cap_rate,
      notes: r.notes,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchPropertyValuationHistory failed:", e.message);
    return [];
  }
}

export async function fetchHoldSellRefi() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("hold_sell_refi")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("property_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      holdIrr: r.hold_irr,
      holdEm: r.hold_em,
      holdCashFlow5yr: r.hold_cash_flow_5yr,
      sellIrr: r.sell_irr,
      sellEm: r.sell_em,
      sellPrice: r.sell_price,
      refiIrr: r.refi_irr,
      refiEm: r.refi_em,
      refiCapitalReturned: r.refi_capital_returned,
      refiNewLoanAmt: r.refi_new_loan_amt,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchHoldSellRefi failed:", e.message);
    return [];
  }
}

export async function fetchFundLifecycle() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("fund_lifecycle")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("fund_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      fund: fundMap[r.fund_id] || r.fund_id,
      vintage: r.vintage,
      stage: r.stage,
      totalCommitment: r.total_commitment,
      calledCapital: r.called_capital,
      pctCalled: r.pct_called,
      distributedCapital: r.distributed_capital,
      remainingCapacity: r.remaining_capacity,
      investmentPeriodEnd: r.investment_period_end,
      fundTermEnd: r.fund_term_end,
      extensions: r.extensions,
      recyclingCapacity: r.recycling_capacity,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchFundLifecycle failed:", e.message);
    return [];
  }
}

export async function fetchCoInvestments() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("co_investments")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("deal_name", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      dealName: r.deal_name,
      property: propMap[r.property_id] || r.property_id,
      fund: fundMap[r.fund_id] || r.fund_id,
      coInvestors: r.co_investors,
      totalEquity: r.total_equity,
      coInvestEquity: r.co_invest_equity,
      fundEquity: r.fund_equity,
      closeDate: r.close_date,
      status: r.status,
      irr: r.irr,
      em: r.em,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchCoInvestments failed:", e.message);
    return [];
  }
}

export async function fetchCapitalEvents() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("capital_events")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("event_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      date: r.event_date,
      fund: fundMap[r.fund_id] || r.fund_id,
      property: propMap[r.property_id] || r.property_id,
      type: r.event_type,
      amount: r.amount,
      details: r.description || r.details,
      impact: r.impact,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchCapitalEvents failed:", e.message);
    return [];
  }
}

export async function fetchLpCapitalAccounts() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("lp_capital_accounts")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("investor_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      investorId: r.investor_id,
      fund: fundMap[r.fund_id] || r.fund_id,
      committed: r.committed,
      called: r.called,
      distributed: r.distributed,
      nav: r.nav,
      unfunded: r.unfunded,
      dpi: r.dpi,
      tvpi: r.tvpi,
      irr: r.irr,
      k1Status: r.k1_status,
      k1Date: r.k1_date,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchLpCapitalAccounts failed:", e.message);
    return [];
  }
}

export async function fetchDistributionHistory() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("distribution_history")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("quarter", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      quarter: r.quarter,
      fund: fundMap[r.fund_id] || r.fund_id,
      type: r.dist_type,
      amount: r.amount,
      perUnit: r.per_unit,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDistributionHistory failed:", e.message);
    return [];
  }
}

export async function fetchInvestorInvestments() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("investor_investments")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("investor_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      investorId: r.investor_id,
      fund: fundMap[r.fund_id] || r.fund_id,
      property: propMap[r.property_id] || r.property_id,
      committed: r.committed,
      funded: r.funded,
      contrib: r.contributions,
      dist: r.distributions,
      ownership: r.ownership_pct,
      unrealizedValue: r.unrealized_value,
      irr: r.irr,
      em: r.em,
      k1TaxLoss: r.k1_tax_loss,
      k1TaxIncome: r.k1_tax_income,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchInvestorInvestments failed:", e.message);
    return [];
  }
}

export async function fetchLpMessages() {
  try {
    const { data, error } = await supabase
      .from("lp_messages")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("msg_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      from: r.from_name,
      to: r.to_name,
      subject: r.subject,
      preview: r.preview,
      date: r.msg_date,
      read: r.is_read,
      thread: r.thread_id,
      priority: r.priority,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchLpMessages failed:", e.message);
    return [];
  }
}

export async function fetchQuarterlyDistributionsDetail() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("quarterly_distributions_detail")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("quarter", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      quarter: r.quarter,
      fund: fundMap[r.fund_id] || r.fund_id,
      property: propMap[r.property_id] || r.property_id,
      type: r.dist_type,
      gross: r.gross,
      prefReturn: r.pref_return,
      catchUp: r.catch_up,
      promote: r.promote,
      gpShare: r.gp_share,
      lpShare: r.lp_share,
    }));
  } catch (e) {
    console.warn(
      "[Supabase] fetchQuarterlyDistributionsDetail failed:",
      e.message,
    );
    return [];
  }
}

export async function fetchProjectedDistributions() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("projected_distributions")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("quarter", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      quarter: r.quarter,
      fund: fundMap[r.fund_id] || r.fund_id,
      property: propMap[r.property_id] || r.property_id,
      type: r.dist_type,
      gross: r.gross,
      gpShare: r.gp_share,
      lpShare: r.lp_share,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchProjectedDistributions failed:", e.message);
    return [];
  }
}

export async function fetchVendors() {
  try {
    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("company", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      company: r.company,
      trade: r.trade,
      contactName: r.contact_name,
      phone: r.phone,
      email: r.email,
      insuranceExpiry: r.insurance_expiry,
      contractEnd: r.contract_end,
      rating: r.rating,
      totalSpend: r.total_spend,
      propertiesServiced: r.properties_serviced,
      status: r.status,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchVendors failed:", e.message);
    return [];
  }
}

export async function fetchUtilityData() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("utility_data")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("property_id", { ascending: true })
      .order("month", { ascending: true });
    if (error) throw error;
    const grouped = {};
    (data || []).forEach((r) => {
      const propName = propMap[r.property_id] || r.property_id;
      if (!grouped[propName])
        grouped[propName] = {
          property: propName,
          monthlyData: [],
          annualBudget: 0,
          ytdActual: 0,
          variance: 0,
        };
      grouped[propName].monthlyData.push({
        month: r.month,
        electricity: r.electricity,
        gas: r.gas,
        water: r.water,
        total: r.total,
        costPerSF: r.cost_per_sf,
      });
      grouped[propName].ytdActual += r.total || 0;
    });
    Object.values(grouped).forEach((g) => {
      g.annualBudget = Math.round(g.ytdActual * 2);
      g.variance = 0;
    });
    return Object.values(grouped);
  } catch (e) {
    console.warn("[Supabase] fetchUtilityData failed:", e.message);
    return [];
  }
}

export async function fetchInsurancePolicies() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("insurance_policies")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("property_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      policyType: r.policy_type,
      carrier: r.carrier,
      policyNumber: r.policy_number,
      premium: r.premium,
      coverage: r.coverage,
      deductible: r.deductible,
      effectiveDate: r.effective_date,
      expiryDate: r.expiry_date,
      status: r.status,
      claims: r.claims,
      claimAmount: r.claim_amount,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchInsurancePolicies failed:", e.message);
    return [];
  }
}

export async function fetchLeaseRenewals() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("lease_renewals")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("lease_end", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      tenant: r.tenant_name,
      property: propMap[r.property_id] || r.property_id,
      sf: r.sf,
      currentRent: r.current_rent,
      marketRent: r.market_rent,
      leaseEnd: r.lease_end,
      renewalProbability: r.renewal_probability,
      askingRent: r.asking_rent,
      concessionPackage: r.concession_package,
      status: r.status,
      estimatedRevenue: r.estimated_revenue,
      weightedRevenue: r.weighted_revenue,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchLeaseRenewals failed:", e.message);
    return [];
  }
}

export async function fetchDevProjects() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("dev_projects")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      name: r.name,
      status: r.status,
      fund: fundMap[r.fund_id] || r.fund_id,
      address: r.address,
      type: r.project_type,
      totalBudget: r.total_budget,
      spent: r.spent,
      remaining: r.remaining,
      pctComplete: r.pct_complete,
      timeline: r.timeline,
      milestones: r.milestones,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDevProjects failed:", e.message);
    return [];
  }
}

export async function fetchConstructionDraws() {
  try {
    const { data, error } = await supabase
      .from("construction_draws")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("project_name", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      project: r.project_name,
      totalBudget: r.total_budget,
      loanCommitment: r.loan_commitment,
      draws: r.draws ?? [],
      retainageBalance: r.retainage_balance,
      completionPct: r.completion_pct,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchConstructionDraws failed:", e.message);
    return [];
  }
}

export async function fetchCapitalCallWorkflow() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("capital_call_workflow")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("call_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      fund: fundMap[r.fund_id] || r.fund_id,
      callNumber: r.call_number,
      callDate: r.call_date,
      dueDate: r.due_date,
      totalAmount: r.total_amount,
      purpose: r.purpose,
      status: r.status,
      lpResponses: r.lp_responses,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchCapitalCallWorkflow failed:", e.message);
    return [];
  }
}

export async function fetchMonthlyFinancials() {
  try {
    const [fundMap, propMap] = await Promise.all([
      getFundNameMap(),
      getPropertyNameMap(),
    ]);
    const { data, error } = await supabase
      .from("monthly_financials")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("month", { ascending: true });
    if (error) throw error;
    const grouped = {};
    (data || []).forEach((r) => {
      const key = r.property_id;
      if (!grouped[key]) {
        grouped[key] = {
          property: propMap[r.property_id] || r.property_id,
          fund: fundMap[r.fund_id] || r.fund_id,
          type: r.property_type || "",
          months: [],
        };
      }
      grouped[key].months.push({
        month: r.month,
        actuals: r.actuals || {},
        budget: r.budget || {},
        forecast: r.forecast || {},
      });
    });
    return Object.values(grouped);
  } catch (e) {
    console.warn("[Supabase] fetchMonthlyFinancials failed:", e.message);
    return [];
  }
}

export async function fetchTaxData() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("tax_data")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("fund_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      fund: fundMap[r.fund_id] || r.fund_id,
      entityType: r.entity_type,
      ein: r.ein,
      taxYear: r.tax_year,
      k1Status: r.k1_status,
      k1DistributionDate: r.k1_distribution_date,
      depreciation: r.depreciation,
      taxableIncome: r.taxable_income,
      exchange1031: r.exchange_1031,
      stateFilings: r.state_filings,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchTaxData failed:", e.message);
    return [];
  }
}

export async function fetchEnergyCompliance() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("energy_compliance")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("property_id", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      jurisdiction: r.jurisdiction,
      regulation: r.regulation,
      currentScore: r.current_score,
      threshold: r.threshold,
      complianceStatus: r.compliance_status,
      dueDate: r.due_date,
      penalty: r.penalty,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchEnergyCompliance failed:", e.message);
    return [];
  }
}

export async function fetchRegulatoryCalendar() {
  try {
    const { data, error } = await supabase
      .from("regulatory_calendar")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("deadline", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      item: r.item,
      deadline: r.deadline,
      status: r.status,
      owner: r.owner,
      category: r.category,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchRegulatoryCalendar failed:", e.message);
    return [];
  }
}

export async function fetchTenantCrm() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("tenant_crm")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("tenant_name", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      tenant: r.tenant_name,
      property: propMap[r.property_id] || r.property_id,
      sf: r.sf,
      rent: r.rent,
      leaseEnd: r.lease_end,
      tenantType: r.tenant_type,
      creditRating: r.credit_rating,
      renewalProbability: r.renewal_probability,
      contactName: r.contact_name,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      lastContact: r.last_contact,
      communicationHistory: r.communication_history,
      notes: r.notes,
      escalationRate: r.escalation_rate,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchTenantCrm failed:", e.message);
    return [];
  }
}

export async function fetchDebtMaturities() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("debt_maturities")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("maturity_date", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      lender: r.lender,
      loanAmount: r.loan_amount,
      rate: r.rate,
      maturityDate: r.maturity_date,
      monthsToMaturity: r.months_to_maturity,
      refiOption: r.refi_option,
      estimatedRefiRate: r.estimated_refi_rate,
      refiSavings: r.refi_savings,
      ltv: r.ltv,
      dscr: r.dscr,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDebtMaturities failed:", e.message);
    return [];
  }
}

export async function fetchCashAccounts() {
  try {
    const { data, error } = await supabase
      .from("cash_accounts")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("account_name", { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => ({
      accountName: r.account_name,
      entity: r.entity,
      bank: r.bank,
      accountType: r.account_type,
      balance: r.balance,
      lastUpdated: r.last_updated,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchCashAccounts failed:", e.message);
    return [];
  }
}

export async function fetchConnectors() {
  try {
    const { data, error } = await supabase
      .from("connectors")
      .select(
        "id, vendor, display_name, status, config, auth_ref, last_sync_at, last_sync_status, last_sync_rows, last_error_message, created_at, updated_at",
      )
      .order("vendor");
    if (error) throw error;

    let dropboxAcctStatus = null;
    let dropboxLastError = null;
    try {
      const { data: acctRows } = await supabase
        .from("org_dropbox_accounts")
        .select("status,last_error_message")
        .order("connected_at", { ascending: false })
        .limit(1);
      if (Array.isArray(acctRows) && acctRows.length > 0) {
        dropboxAcctStatus = acctRows[0].status || null;
        dropboxLastError = acctRows[0].last_error_message || null;
      }
    } catch (e) {}

    return (data || []).map((r) => {
      let effectiveStatus = r.status;
      let effectiveErr = r.last_error_message;
      if (
        r.vendor === "dropbox" &&
        dropboxAcctStatus &&
        dropboxAcctStatus !== "active"
      ) {
        effectiveStatus = dropboxAcctStatus;
        effectiveErr = dropboxLastError || r.last_error_message;
      }
      return {
        id: r.id,
        vendor: r.vendor,
        displayName: r.display_name,
        status: effectiveStatus,
        config: r.config || {},
        authRef: r.auth_ref,
        lastSyncAt: r.last_sync_at,
        lastSyncStatus: r.last_sync_status,
        lastSyncRows: r.last_sync_rows,
        lastErrorMessage: effectiveErr,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  } catch (e) {
    console.warn("[Supabase] fetchConnectors failed:", e.message);
    return [];
  }
}

export async function upsertConnector({
  id,
  vendor,
  displayName,
  status,
  config,
  authRef,
}) {
  if (!vendor) return { data: null, error: { message: "vendor required" } };
  const row = {
    org_id: ORG_ID,
    vendor,
    display_name: displayName ?? "",
    status: status ?? "disconnected",
    config: config ?? {},
    auth_ref: authRef ?? null,
  };
  if (id) row.id = id;
  const { data, error } = await supabase
    .from("connectors")
    .upsert(row, { onConflict: "org_id,vendor" })
    .select("id")
    .maybeSingle();
  return { data, error };
}

export async function fetchConnectorSyncRuns({
  connectorId = null,
  limit = 50,
} = {}) {
  let q = supabase
    .from("connector_sync_runs")
    .select(
      "id, connector_id, started_at, completed_at, direction, resource_type, rows_read, rows_written, status, error_message, triggered_by",
    )
    .order("started_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (connectorId) q = q.eq("connector_id", connectorId);
  const { data, error } = await q;
  if (error) {
    console.warn("[Supabase] fetchConnectorSyncRuns failed:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    id: r.id,
    connectorId: r.connector_id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    direction: r.direction,
    resourceType: r.resource_type,
    rowsRead: r.rows_read,
    rowsWritten: r.rows_written,
    status: r.status,
    errorMessage: r.error_message,
    triggeredBy: r.triggered_by,
  }));
}

export async function fetchConnectorTriggerSummary(connectorIds = []) {
  const ids = Array.from(new Set((connectorIds || []).filter(Boolean)));
  if (!ids.length) return { data: {}, error: null };
  const cols =
    "id, connector_id, started_at, completed_at, status, resource_type, triggered_by, error_message";
  const newest = (rows) => {
    const r = Array.isArray(rows) && rows.length ? rows[0] : null;
    return r
      ? {
          startedAt: r.started_at,
          status: r.status,
          resourceType: r.resource_type,
          triggeredBy: r.triggered_by,
          errorMessage: r.error_message,
        }
      : null;
  };
  try {
    const entries = await Promise.all(
      ids.map(async (id) => {
        const [autoRes, manualRes] = await Promise.all([
          supabase
            .from("connector_sync_runs")
            .select(cols)
            .eq("connector_id", id)
            .eq("triggered_by", SCHEDULER_TRIGGER)
            .order("started_at", { ascending: false })
            .limit(1),
          supabase
            .from("connector_sync_runs")
            .select(cols)
            .eq("connector_id", id)
            .in("triggered_by", MANUAL_TRIGGERS)
            .order("started_at", { ascending: false })
            .limit(1),
        ]);
        if (autoRes.error) throw autoRes.error;
        if (manualRes.error) throw manualRes.error;
        return [
          id,
          { automatic: newest(autoRes.data), manual: newest(manualRes.data) },
        ];
      }),
    );
    return { data: Object.fromEntries(entries), error: null };
  } catch (e) {
    const code = e?.code ? `[${e.code}] ` : "";
    const msg = e?.message || e?.details || e?.hint || String(e) || "unknown";
    console.warn(
      "[Supabase] fetchConnectorTriggerSummary failed:",
      `${code}${msg}`,
    );
    return { data: null, error: `${code}${msg}` };
  }
}

export async function fetchSyncProgress(connectorId, { limit = 12 } = {}) {
  if (!connectorId) return [];
  const cutoff = runningJobRecencyCutoffIso();
  const { data, error } = await supabase
    .from("connector_sync_runs")
    .select(
      "id, resource_type, status, rows_read, rows_written, started_at, completed_at, payload, error_message, triggered_by",
    )
    .eq("connector_id", connectorId)
    .gte("started_at", cutoff)
    .order("started_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) {
    console.warn("[Supabase] fetchSyncProgress failed:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    id: r.id,
    resourceType: r.resource_type,
    status: r.status,
    rowsRead: r.rows_read || 0,
    rowsWritten: r.rows_written || 0,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    triggeredBy: r.triggered_by,
    diag: (r.payload && r.payload.diag) || {},
    errorMessage: r.error_message,
  }));
}

export async function requestConnectorSync({
  connectorId,
  resourceType = null,
}) {
  try {
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    const res = await fetch("/.netlify/functions/connector-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        connectorId,
        resourceType,
        triggeredBy: "manual",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
      return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, ...body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function __slugifyDealName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function fetchDealDdItems() {
  try {
    const { data, error } = await supabase
      .from("deal_dd_items")
      .select(
        "id, deal_id, category, task, status, assignee, due_date, completed_date, documents, notes, deals:deal_id(name)",
      )
      .order("category")
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const byDeal = {};
    for (const r of rows) {
      const dealName = r.deals?.name || "unknown";
      const slug = __slugifyDealName(dealName);
      if (!byDeal[slug]) byDeal[slug] = [];
      byDeal[slug].push({
        id: r.id,
        category: r.category,
        task: r.task,
        status: r.status,
        assignee: r.assignee,
        dueDate: r.due_date,
        completedDate: r.completed_date,
        documents: Number(r.documents) || 0,
        notes: r.notes || "",
      });
    }
    return byDeal;
  } catch (e) {
    console.warn("[Supabase] fetchDealDdItems failed:", e.message);
    return {};
  }
}

const LOSS_REASON_LABELS = {
  pricing_too_aggressive: "Pricing Too Aggressive",
  failed_dd: "Failed DD",
  outbid_by_competitor: "Outbid by Competitor",
  market_or_timing: "Market / Timing",
  seller_pulled_deal: "Seller Pulled Deal",
  ic_declined: "IC Declined",
  other: "Other",
};

export async function fetchPipelineLossReasons() {
  try {
    const { data, error } = await supabase
      .from("deals_loss_analysis")
      .select("loss_reason, count, pct")
      .order("count", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      reason: LOSS_REASON_LABELS[r.loss_reason] || r.loss_reason,
      count: r.count,
      pct: Number(r.pct) || 0,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchPipelineLossReasons failed:", e.message);
    return [];
  }
}

export async function fetchFirmFinancials() {
  try {
    const { data, error } = await supabase
      .from("firm_financials")
      .select("period_month, period_label, revenue, expenses")
      .order("period_month", { ascending: true });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return { revenue: [], expenses: [] };
    return {
      revenue: rows.map((r) => ({
        month: r.period_label || r.period_month,
        ...(r.revenue || {}),
      })),
      expenses: rows.map((r) => ({
        month: r.period_label || r.period_month,
        ...(r.expenses || {}),
      })),
    };
  } catch (e) {
    console.warn("[Supabase] fetchFirmFinancials failed:", e.message);
    return { revenue: [], expenses: [] };
  }
}

export async function fetchTreasury(accountsPromise = null) {
  try {
    const [accounts, { data: funds, error: fundsErr }] = await Promise.all([
      accountsPromise || fetchCashAccounts(),
      supabase.from("funds").select("committed, deployed"),
    ]);
    if (fundsErr) throw fundsErr;
    const operating = (accounts || []).filter(
      (a) =>
        (a.accountType || "").toLowerCase().includes("operating") ||
        (a.accountType || "").toLowerCase().includes("checking"),
    );
    const reserves = (accounts || []).filter(
      (a) =>
        (a.accountType || "").toLowerCase().includes("reserve") ||
        (a.accountType || "").toLowerCase().includes("escrow"),
    );
    const cashOnHand = operating.reduce(
      (s, a) => s + (Number(a.balance) || 0),
      0,
    );
    const reserveAccounts = reserves.reduce(
      (s, a) => s + (Number(a.balance) || 0),
      0,
    );
    const undrawnCapital = (funds || []).reduce(
      (s, f) =>
        s + Math.max(0, (Number(f.committed) || 0) - (Number(f.deployed) || 0)),
      0,
    );
    const anyData = (accounts?.length || 0) > 0 || (funds?.length || 0) > 0;
    if (!anyData) return null;
    return {
      cashOnHand,
      reserveAccounts,
      undrawnCapital,
      creditFacility: {
        total: null,
        drawn: null,
        available: null,
        rate: null,
        maturity: "—",
      },
    };
  } catch (e) {
    console.warn("[Supabase] fetchTreasury failed:", e.message);
    return null;
  }
}

export async function fetchFeatureFlags() {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("features_enabled")
      .maybeSingle();
    if (error) throw error;
    const flags = data?.features_enabled;
    return flags && typeof flags === "object" ? flags : {};
  } catch (e) {
    console.warn("[Supabase] fetchFeatureFlags failed:", e.message);
    return {};
  }
}

export async function setFeatureFlag({ orgId, flagName, enabled }) {
  if (!orgId || !flagName)
    return { ok: false, error: "orgId + flagName required" };
  try {
    const { data, error } = await supabase.rpc("set_feature_flag", {
      p_org_id: orgId,
      p_flag_name: flagName,
      p_enabled: !!enabled,
    });
    if (error) throw error;
    return { ok: !!data, error: null };
  } catch (e) {
    return { ok: false, error: e.message || "set_feature_flag failed" };
  }
}

export async function fetchPlatformSettings() {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("settings, updated_at, updated_by")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      settings: data.settings || {},
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
    };
  } catch (e) {
    console.warn("[Supabase] fetchPlatformSettings failed:", e.message);
    return null;
  }
}

export async function savePlatformSettings({ settings, orgId, updatedBy }) {
  if (!orgId) return { ok: false, error: "orgId required" };
  try {
    const { error } = await supabase.from("platform_settings").upsert(
      {
        org_id: orgId,
        settings: settings || {},
        updated_by: updatedBy || null,
      },
      { onConflict: "org_id" },
    );
    if (error) throw error;

    const mirror = {};
    if (
      typeof settings?.sessionTimeout === "number" &&
      settings.sessionTimeout >= 5 &&
      settings.sessionTimeout <= 1440
    ) {
      mirror.idle_timeout_min = Math.round(settings.sessionTimeout);
    }
    if (typeof settings?.mfaRequired === "boolean") {
      mirror.mfa_required = settings.mfaRequired;
    }
    if (
      typeof settings?.passwordMinLength === "number" &&
      settings.passwordMinLength >= 8 &&
      settings.passwordMinLength <= 128
    ) {
      mirror.password_min_length = Math.round(settings.passwordMinLength);
    }
    if (Object.keys(mirror).length) {
      const { error: mirrorErr } = await supabase
        .from("session_policies")
        .upsert(
          {
            org_id: orgId,
            ...mirror,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy || null,
          },
          { onConflict: "org_id" },
        );
      if (mirrorErr) {
        console.warn(
          "[savePlatformSettings] session_policies mirror failed:",
          mirrorErr.message,
        );
      }
    }
    return { ok: true, error: null };
  } catch (e) {
    console.warn("[Supabase] savePlatformSettings failed:", e.message);
    return { ok: false, error: e.message || "Save failed" };
  }
}

export async function saveVarianceAlertConfig({ config, note }) {
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (!trimmed)
    return {
      ok: false,
      config: null,
      updatedAt: null,
      error: "A note is required to change the variance alert configuration.",
    };
  try {
    const { data, error } = await supabase.rpc("save_variance_alert_config", {
      p_config: config || {},
      p_note: trimmed,
    });
    if (error) throw error;
    return {
      ok: true,
      config: data?.config ?? null,
      updatedAt: data?.updated_at ?? null,
      error: null,
    };
  } catch (e) {
    console.warn("[Supabase] saveVarianceAlertConfig failed:", e.message);
    return {
      ok: false,
      config: null,
      updatedAt: null,
      error: e.message || "Save failed",
    };
  }
}

export async function fetchVarianceAlertConfigVersions({
  limit: lim = 50,
} = {}) {
  try {
    const { data, error } = await supabase
      .from("variance_alert_config_versions")
      .select(
        "id, change_kind, config, prev_config, note, changed_by, changed_at",
      )
      .order("changed_at", { ascending: false })
      .limit(lim);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(
      "[Supabase] fetchVarianceAlertConfigVersions failed:",
      e.message,
    );
    return [];
  }
}

const USER_STATE_BUCKETS = new Set([
  "tasks",
  "goals",
  "notes",
  "favorites",
  "dashboard_prefs",
]);

export async function fetchUserState() {
  try {
    const { data, error } = await supabase
      .from("user_state")
      .select("tasks, goals, notes, favorites, dashboard_prefs, updated_at")
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.warn("[Supabase] fetchUserState failed:", e.message);
    return null;
  }
}

export async function saveUserStateBucket({ bucket, value, userId, orgId }) {
  if (!USER_STATE_BUCKETS.has(bucket)) {
    return { ok: false, error: `unknown bucket: ${bucket}` };
  }
  if (!userId || !orgId) return { ok: false, error: "userId + orgId required" };
  try {
    const payload = { user_id: userId, org_id: orgId, [bucket]: value };
    const { error } = await supabase
      .from("user_state")
      .upsert(payload, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true, error: null };
  } catch (e) {
    console.warn(
      `[Supabase] saveUserStateBucket(${bucket}) failed:`,
      e.message,
    );
    return { ok: false, error: e.message || "Save failed" };
  }
}

export async function fetchBovTracker() {
  try {
    const { data, error } = await supabase
      .from("bov_tracker")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("bov_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      property: r.property_name,
      broker: r.broker_name,
      firm: r.broker_company,
      askPrice: r.asking_price,
      guidanceType: r.status || "marketed",
      receivedDate: r.bov_date,
      status: r.status,
      market: r.submarket,
      propertyType: r.property_type,
      sf: r.total_sf || 0,
      notes: r.notes,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchBovTracker failed:", e.message);
    return [];
  }
}

export async function fetchInvestorComms() {
  try {
    const { data, error } = await supabase
      .from("investor_communications")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("comm_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      investorId: r.investor_id,
      date: r.comm_date,
      type: r.comm_type,
      direction: r.direction,
      subject: r.subject,
      snippet: r.body_snippet,
      flag: r.flag,
      insight: r.ai_insight,
      priority: r.priority,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchInvestorComms failed:", e.message);
    return [];
  }
}

export async function fetchCapexProjects() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("capex_projects")
      .select(
        "id, property_id, project_name, category, budget, spent, pct_complete, contractor, start_date, target_completion, change_order_count, change_order_amount, status",
      )
      .eq("org_id", ORG_ID)
      .order("start_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      property: propMap[r.property_id] || r.property_id,
      projectName: r.project_name,
      category: r.category,
      budget: r.budget,
      spent: r.spent,
      pctComplete: r.pct_complete ? +(r.pct_complete * 100).toFixed(0) : 0,
      contractor: r.contractor,
      startDate: r.start_date,
      targetCompletion: r.target_completion,
      changeOrders: r.change_order_count,
      changeOrderAmount: r.change_order_amount,
      status: r.status,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchCapexProjects failed:", e.message);
    return [];
  }
}

export async function fetchTiTracker() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("ti_tracker")
      .select("*")
      .eq("org_id", ORG_ID)
      .order("start_date", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      tenant: r.description || r.tenant_id,
      property: propMap[r.property_id] || r.property_id,
      tiAllowance: r.ti_allowance,
      tiSpent: r.actual_cost,
      remainingAllowance: (r.ti_allowance || 0) - (r.actual_cost || 0),
      buildoutStatus: r.status,
      rentCommencementDate: r.start_date,
      estimatedCompletion: r.completion_date,
      contractor: r.contractor,
      pctComplete: r.pct_complete
        ? +(r.pct_complete * 100).toFixed(0)
        : r.status === "completed"
          ? 100
          : 0,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchTiTracker failed:", e.message);
    return [];
  }
}

async function fetchDealPipelineCrm() {
  try {
    const { data, error } = await supabase
      .from("deal_pipeline_crm")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      market: r.market,
      type: r.type,
      sf: r.sf,
      units: r.units,
      askingPrice: r.asking_price,
      targetReturn: r.target_return,
      capRate: r.cap_rate,
      stage: r.stage,
      daysInStage: r.days_in_stage,
      assignedTo: r.assigned_to,
      source: r.source,
      lastActivity: r.last_activity,
      nextAction: r.next_action,
      priority: r.priority,
      notes: r.notes,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDealPipelineCrm failed:", e.message);
    return [];
  }
}

async function fetchDebtPortfolio() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("debt_portfolio")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      property: propMap[r.property_id] || r.property_id,
      lender: r.lender,
      loanType: r.loan_type,
      originalAmount: r.original_amount,
      currentBalance: r.current_balance,
      rate: r.rate,
      rateType: r.rate_type,
      spread: r.spread,
      maturityDate: r.maturity_date,
      originationDate: r.origination_date,
      amortization: r.amortization,
      ltv: r.ltv,
      dscr: r.dscr,
      covenants: r.covenants || {},
      covenantStatus: r.covenant_status,
      interestReserve: r.interest_reserve,
      paymentFrequency: r.payment_frequency,
      nextPayment: r.next_payment,
      prepaymentPenalty: r.prepayment_penalty,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDebtPortfolio failed:", e.message);
    return [];
  }
}

async function fetchInvestorCrm() {
  try {
    const { data, error } = await supabase
      .from("investor_crm")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      totalCommitted: r.total_committed,
      totalInvested: r.total_invested,
      fundsInvested: r.funds_invested || [],
      contactName: r.contact_name,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      lastMeeting: r.last_meeting,
      nextMeeting: r.next_meeting,
      relationshipOwner: r.relationship_owner,
      notes: r.notes,
      nps: r.nps,
      reupProbability: r.reup_probability,
      status: r.status,
      touchpoints: r.touchpoints,
      lastTouchpoint: r.last_touchpoint,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchInvestorCrm failed:", e.message);
    return [];
  }
}

async function fetchFundFinancials() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("fund_financials")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      fund: fundMap[r.fund_id] || r.fund_id,
      vintage: r.vintage,
      asOfDate: r.as_of_date,
      balanceSheet: r.balance_sheet || {},
      incomeStatement: r.income_statement || {},
      cashFlow: r.cash_flow || {},
    }));
  } catch (e) {
    console.warn("[Supabase] fetchFundFinancials failed:", e.message);
    return [];
  }
}

async function fetchUnderContract() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("under_contract")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      name: r.name,
      type: r.type,
      sf: r.sf,
      price: r.price,
      capRate: r.cap_rate,
      irr: r.irr,
      em: r.em,
      closeDate: r.close_date,
      fund: fundMap[r.fund_id] || r.fund_id,
      status: r.status,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchUnderContract failed:", e.message);
    return [];
  }
}

async function fetchComplianceCalendar(rowsPromise = null) {
  try {
    const { data, error } = await (rowsPromise || complianceCalendarRows());
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description,
      dueDate: r.due_date,
      fund: r.fund,
      status: r.status,
      assignee: r.assignee,
      priority: r.priority,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchComplianceCalendar failed:", e.message);
    return [];
  }
}

async function fetchCapitalStacks() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("capital_stacks")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      totalValue: r.total_value,
      layers: r.layers || [],
      metrics: r.metrics || {},
    }));
  } catch (e) {
    console.warn("[Supabase] fetchCapitalStacks failed:", e.message);
    return [];
  }
}

async function fetchTenantHealth() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("tenant_health")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      tenant: r.tenant,
      property: propMap[r.property_id] || r.property_id,
      sf: r.sf,
      rent: r.rent,
      creditScore: r.credit_score,
      paymentHistory: r.payment_history,
      leaseExpiry: r.lease_expiry,
      renewal: r.renewal,
      healthScore: r.health_score,
      trend: r.trend,
      sector: r.sector,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchTenantHealth failed:", e.message);
    return [];
  }
}

async function fetchDispositionCandidates() {
  try {
    const propMap = await getPropertyNameMap();
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("disposition_candidates")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      property: propMap[r.property_id] || r.property_id,
      fund: fundMap[r.fund_id] || r.fund_id,
      strategy: r.strategy,
      acquired: r.acquired,
      holdPeriod: r.hold_period,
      basis: r.basis,
      currentValue: r.current_value,
      gain: r.gain,
      irr: r.irr,
      moic: r.moic,
      capRate: r.cap_rate,
      exitOptions: r.exit_options || [],
      recommendation: r.recommendation,
      agent: r.agent,
      rationale: r.rationale,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDispositionCandidates failed:", e.message);
    return [];
  }
}

async function fetchDealRooms() {
  try {
    const { data, error } = await supabase
      .from("deal_rooms")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      dealName: r.deal_name,
      status: r.status,
      phase: r.phase,
      created: r.created,
      lastActivity: r.last_activity,
      participants: r.participants || [],
      documents: r.documents || [],
      ddItems: r.dd_items || {},
      timeline: r.timeline || [],
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDealRooms failed:", e.message);
    return [];
  }
}

async function fetchDebtPartners() {
  try {
    const { data, error } = await supabase
      .from("debt_partners")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      lender: r.lender,
      type: r.type,
      relationship: r.relationship,
      activeLoans: r.active_loans,
      totalExposure: r.total_exposure,
      avgSpread: r.avg_spread,
      covenantStatus: r.covenant_status,
      nextMaturity: r.next_maturity,
      contactName: r.contact_name,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchDebtPartners failed:", e.message);
    return [];
  }
}

async function fetchFundraising() {
  try {
    const fundMap = await getFundNameMap();
    const { data, error } = await supabase
      .from("fundraising")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      fund: fundMap[r.fund_id] || r.fund_id,
      target: r.target,
      committed: r.committed,
      status: r.status,
      firstClose: r.first_close,
      finalClose: r.final_close,
      strategy: r.strategy,
      vintageYear: r.vintage_year,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchFundraising failed:", e.message);
    return [];
  }
}

async function fetchLpPipeline() {
  try {
    const { data, error } = await supabase
      .from("lp_pipeline")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      name: r.name,
      type: r.type,
      status: r.status,
      targetCommit: r.target_commit,
      lastContact: r.last_contact,
      nextStep: r.next_step,
      probability: r.probability,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchLpPipeline failed:", e.message);
    return [];
  }
}

async function fetchRecentComps() {
  try {
    const { data, error } = await supabase
      .from("recent_comps")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      property: r.property,
      type: r.type,
      market: r.market,
      sf: r.sf,
      price: r.price,
      pricePSF: r.price_psf,
      capRate: r.cap_rate,
      date: r.date,
      buyer: r.buyer,
      seller: r.seller,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchRecentComps failed:", e.message);
    return [];
  }
}

async function fetchPipelineVelocity() {
  try {
    const { data, error } = await supabase
      .from("pipeline_velocity")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      month: r.month,
      sourced: r.sourced,
      screened: r.screened,
      loi: r.loi,
      closed: r.closed,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchPipelineVelocity failed:", e.message);
    return [];
  }
}

async function fetchGlobalActivity() {
  try {
    const { data, error } = await supabase
      .from("global_activity")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r, i) => ({
      id: r.id || i + 1,
      time: r.time,
      date: r.date,
      type: r.type,
      icon: r.icon,
      color: r.color,
      title: r.title,
      detail: r.detail,
      user: r.user,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchGlobalActivity failed:", e.message);
    return [];
  }
}

async function fetchActivityFeed() {
  try {
    const { data, error } = await supabase
      .from("activity_feed")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      time: r.time,
      actor: r.actor,
      avatar: r.avatar,
      action: r.action,
      category: r.category,
      entity: r.entity,
      color: r.color,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchActivityFeed failed:", e.message);
    return [];
  }
}

async function fetchAuditLogEntries() {
  try {
    const { data, error } = await supabase
      .from("audit_log_entries")
      .select("timestamp, module, action, user, detail, status")
      .eq("org_id", ORG_ID)
      .order("timestamp", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data || []).map((r) => ({
      timestamp: r.timestamp,
      module: r.module,
      action: r.action,
      user: r.user,
      detail: r.detail,
      status: r.status,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchAuditLogEntries failed:", e.message);
    return [];
  }
}

async function fetchPendingApprovals() {
  try {
    const { data, error } = await supabase
      .from("pending_approvals")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      description: r.description,
      workflow: r.workflow,
      submittedBy: r.submitted_by,
      submitDate: r.submit_date,
      currentApprover: r.current_approver,
      priority: r.priority,
      daysWaiting: r.days_waiting,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchPendingApprovals failed:", e.message);
    return [];
  }
}

async function fetchWorkflowMetrics() {
  try {
    const { data, error } = await supabase
      .from("workflow_metrics")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      month: r.month,
      completed: r.completed,
      capitalization: r.capitalization,
      invoicing: r.invoicing,
      leasing: r.leasing,
      reporting: r.reporting,
      movement: r.movement,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchWorkflowMetrics failed:", e.message);
    return [];
  }
}

async function fetchIcRecentPackages() {
  try {
    const propMap = await getPropertyNameMap();
    const { data, error } = await supabase
      .from("ic_recent_packages")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      template: r.template,
      property: propMap[r.property_id] || r.property_id,
      date: r.date,
      status: r.status,
      votes: r.votes,
      preparedBy: r.prepared_by,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchIcRecentPackages failed:", e.message);
    return [];
  }
}

async function fetchRecentDocuments() {
  try {
    const { data, error } = await supabase
      .from("recent_documents")
      .select("*")
      .eq("org_id", ORG_ID);
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      template: r.template,
      generatedBy: r.generated_by,
      date: r.date,
      fund: r.fund,
      property: r.property,
      status: r.status,
    }));
  } catch (e) {
    console.warn("[Supabase] fetchRecentDocuments failed:", e.message);
    return [];
  }
}

export async function loadAllData() {
  console.log("[Supabase] Loading data from database...");
  const start = Date.now();

  const cashAccountsPromise = fetchCashAccounts();
  const complianceRowsPromise = complianceCalendarRows();

  const [
    funds,
    properties,
    pipeline,
    tenants,
    workOrders,
    noiTrend,
    distributions,
    employees,
    compliance,
    debtSchedule,
    fundPnl,
    capitalCalls,
    investors,
    chartOfAccounts,
    journalEntries,
    invoices,
    arAging,
    apAging,
    depreciationSchedules,
    loanAmortization,
    waterfallTiers,
    feeCalculations,
    operatingBudgets,
    cashFlowActuals,
    capitalMarketsRates,
    capRateTrends,
    transactionVolume,
    submarketData,
    marketComps,
    competitors,
    esgMetrics,
    carbonReductionPlans,
    stressTestScenarios,
    riskWatchlist,
    alerts,
    actionItems,
    legalEntities,
    documents,
    documentRequests,
    auditLog,
    dealScorecards,
    dealCommunications,
    dispositionPipeline,
    disposedProperties,
    dispositionTracker,
    fundraisingPipeline,
    businessPlans,
    propertyValuations,
    propertyValuationHistory,
    holdSellRefi,
    fundLifecycle,
    coInvestments,
    capitalEvents,
    bovTracker,
    investorComms,
    capexProjects,
    tiTracker,
    lpCapitalAccounts,
    distributionHistory,
    investorInvestments,
    lpMessages,
    quarterlyDistributionsDetail,
    projectedDistributions,
    vendors,
    utilityData,
    insurancePolicies,
    leaseRenewals,
    devProjects,
    constructionDraws,
    capitalCallWorkflow,
    monthlyFinancials,
    taxData,
    energyCompliance,
    regulatoryCalendar,
    tenantCrm,
    debtMaturities,
    cashAccounts,
    dealPipelineCrm,
    debtPortfolio,
    investorCrm,
    fundFinancials,
    underContract,
    complianceCalendar,
    capitalStacks,
    tenantHealth,
    dispositionCandidates,
    dealRooms,
    debtPartners,
    fundraising,
    lpPipeline,
    recentComps,
    pipelineVelocity,
    globalActivity,
    activityFeed,
    auditLogEntries,
    pendingApprovals,
    workflowMetrics,
    icRecentPackages,
    recentDocuments,
    firmFinancials,
    treasury,
    pipelineLossReasons,
    dealDdItems,
  ] = await Promise.all([
    fetchFunds(),
    fetchProperties(),
    fetchPipeline(),
    fetchTenants(),
    fetchWorkOrders(),
    fetchNoiTrend(),
    fetchDistributions(),
    fetchEmployees(),
    fetchCompliance(complianceRowsPromise),
    fetchDebtSchedule(),
    fetchFundPnl(),
    fetchCapitalCalls(),
    fetchInvestors(),
    fetchChartOfAccounts(),
    fetchJournalEntries(),
    fetchInvoices(),
    fetchArAging(),
    fetchApAging(),
    fetchDepreciationSchedules(),
    fetchLoanAmortization(),
    fetchWaterfallTiers(),
    fetchFeeCalculations(),
    fetchOperatingBudgets(),
    fetchCashFlowActuals(),
    fetchCapitalMarketsRates(),
    fetchCapRateTrends(),
    fetchTransactionVolume(),
    fetchSubmarketData(),
    fetchMarketComps(),
    fetchCompetitors(),
    fetchEsgMetrics(),
    fetchCarbonReductionPlans(),
    fetchStressTestScenarios(),
    fetchRiskWatchlist(),
    fetchAlerts(),
    fetchActionItems(),
    fetchLegalEntities(),
    fetchDocuments(),
    fetchDocumentRequests(),
    fetchAuditLog(),
    fetchDealScorecards(),
    fetchDealCommunications(),
    fetchDispositionPipeline(),
    fetchDisposedProperties(),
    fetchDispositionTracker(),
    fetchFundraisingPipeline(),
    fetchBusinessPlans(),
    fetchPropertyValuations(),
    fetchPropertyValuationHistory(),
    fetchHoldSellRefi(),
    fetchFundLifecycle(),
    fetchCoInvestments(),
    fetchCapitalEvents(),
    fetchBovTracker(),
    fetchInvestorComms(),
    fetchCapexProjects(),
    fetchTiTracker(),
    fetchLpCapitalAccounts(),
    fetchDistributionHistory(),
    fetchInvestorInvestments(),
    fetchLpMessages(),
    fetchQuarterlyDistributionsDetail(),
    fetchProjectedDistributions(),
    fetchVendors(),
    fetchUtilityData(),
    fetchInsurancePolicies(),
    fetchLeaseRenewals(),
    fetchDevProjects(),
    fetchConstructionDraws(),
    fetchCapitalCallWorkflow(),
    fetchMonthlyFinancials(),
    fetchTaxData(),
    fetchEnergyCompliance(),
    fetchRegulatoryCalendar(),
    fetchTenantCrm(),
    fetchDebtMaturities(),
    cashAccountsPromise,
    fetchDealPipelineCrm(),
    fetchDebtPortfolio(),
    fetchInvestorCrm(),
    fetchFundFinancials(),
    fetchUnderContract(),
    fetchComplianceCalendar(complianceRowsPromise),
    fetchCapitalStacks(),
    fetchTenantHealth(),
    fetchDispositionCandidates(),
    fetchDealRooms(),
    fetchDebtPartners(),
    fetchFundraising(),
    fetchLpPipeline(),
    fetchRecentComps(),
    fetchPipelineVelocity(),
    fetchGlobalActivity(),
    fetchActivityFeed(),
    fetchAuditLogEntries(),
    fetchPendingApprovals(),
    fetchWorkflowMetrics(),
    fetchIcRecentPackages(),
    fetchRecentDocuments(),
    fetchFirmFinancials(),
    fetchTreasury(cashAccountsPromise),
    fetchPipelineLossReasons(),
    fetchDealDdItems(),
  ]);

  const elapsed = Date.now() - start;
  const total =
    funds.length +
    properties.length +
    pipeline.length +
    tenants.length +
    investors.length +
    chartOfAccounts.length +
    invoices.length +
    alerts.length +
    actionItems.length +
    documents.length +
    operatingBudgets.length +
    marketComps.length +
    dealScorecards.length +
    businessPlans.length +
    lpCapitalAccounts.length +
    vendors.length +
    capitalCallWorkflow.length;
  console.log(
    `[Supabase] Loaded all data in ${elapsed}ms — ${total} total rows across 75 tables`,
  );

  return {
    funds,
    properties,
    pipeline,
    tenants,
    workOrders,
    noiTrend,
    distributions,
    employees,
    compliance,
    debtSchedule,
    fundPnl,
    capitalCalls,
    investors,
    chartOfAccounts,
    journalEntries,
    invoices,
    arAging,
    apAging,
    depreciationSchedules,
    loanAmortization,
    waterfallTiers,
    feeCalculations,
    operatingBudgets,
    cashFlowActuals,
    capitalMarketsRates,
    capRateTrends,
    transactionVolume,
    submarketData,
    marketComps,
    competitors,
    esgMetrics,
    carbonReductionPlans,
    stressTestScenarios,
    riskWatchlist,
    alerts,
    actionItems,
    legalEntities,
    documents,
    documentRequests,
    auditLog,
    dealScorecards,
    dealCommunications,
    dispositionPipeline,
    disposedProperties,
    dispositionTracker,
    fundraisingPipeline,
    businessPlans,
    propertyValuations,
    propertyValuationHistory,
    holdSellRefi,
    fundLifecycle,
    coInvestments,
    capitalEvents,
    bovTracker,
    investorComms,
    capexProjects,
    tiTracker,
    lpCapitalAccounts,
    distributionHistory,
    investorInvestments,
    lpMessages,
    quarterlyDistributionsDetail,
    projectedDistributions,
    vendors,
    utilityData,
    insurancePolicies,
    leaseRenewals,
    devProjects,
    constructionDraws,
    capitalCallWorkflow,
    monthlyFinancials,
    taxData,
    energyCompliance,
    regulatoryCalendar,
    tenantCrm,
    debtMaturities,
    cashAccounts,
    dealPipelineCrm,
    debtPortfolio,
    investorCrm,
    fundFinancials,
    underContract,
    complianceCalendar,
    capitalStacks,
    tenantHealth,
    dispositionCandidates,
    dealRooms,
    debtPartners,
    fundraising,
    lpPipeline,
    recentComps,
    pipelineVelocity,
    globalActivity,
    activityFeed,
    auditLogEntries,
    pendingApprovals,
    workflowMetrics,
    icRecentPackages,
    recentDocuments,
    firmFinancials,
    treasury,
    pipelineLossReasons,
    dealDdItems,
  };
}

export let ORG_ID = "11111111-1111-1111-1111-111111111111";

export function setCurrentOrgId(id) {
  if (!id) return;
  ORG_ID = id;
}

export function getCurrentOrgId() {
  return ORG_ID;
}

let _currentOrgName = null;
export function getCurrentOrgName() {
  return _currentOrgName;
}

export async function fetchCurrentOrg() {
  if (!ORG_ID) return { data: null, error: new Error("ORG_ID not set yet") };
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, name, legal_name, logo_url, primary_color, accent_color, plan_tier, features_enabled, city, state",
    )
    .eq("id", ORG_ID)
    .maybeSingle();
  if (data && (data.legal_name || data.name)) {
    _currentOrgName = data.legal_name || data.name;
  }
  return { data, error };
}

export async function fetchMeetings({ from, to, status, limit = 200 } = {}) {
  let q = supabase
    .from("meetings")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("starts_at", { ascending: false })
    .limit(limit);
  if (from) q = q.gte("starts_at", from);
  if (to) q = q.lte("starts_at", to);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) {
    console.error("[Supabase] fetchMeetings error:", error);
    return { meetings: [], error };
  }
  return { meetings: data || [], error: null };
}

export async function createMeeting(meeting) {
  const row = {
    org_id: ORG_ID,
    title: meeting.title,
    description: meeting.description || null,
    meeting_type: meeting.meetingType || meeting.meeting_type || null,
    template_id: meeting.templateId || meeting.template_id || null,
    starts_at: meeting.startsAt || meeting.starts_at,
    ends_at: meeting.endsAt || meeting.ends_at || null,
    location: meeting.location || null,
    is_virtual: meeting.isVirtual ?? meeting.is_virtual ?? true,
    organizer_email: meeting.organizerEmail || meeting.organizer_email || null,
    attendees: meeting.attendees || null,
    agenda: meeting.agenda || null,
    notes: meeting.notes || null,
    action_items: meeting.actionItems || meeting.action_items || 0,
    status: meeting.status || "scheduled",
    property_id: meeting.propertyId || meeting.property_id || null,
    fund_id: meeting.fundId || meeting.fund_id || null,
    deal_id: meeting.dealId || meeting.deal_id || null,
  };
  const { data, error } = await supabase
    .from("meetings")
    .insert(row)
    .select()
    .single();
  if (error) {
    console.error("[Supabase] createMeeting error:", error);
    return { meeting: null, error };
  }
  return { meeting: data, error: null };
}

export async function updateMeeting(id, patch) {
  const { data, error } = await supabase
    .from("meetings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", ORG_ID)
    .select()
    .single();
  if (error) return { meeting: null, error };
  return { meeting: data, error: null };
}

export async function deleteMeeting(id) {
  const { error } = await supabase
    .from("meetings")
    .delete()
    .eq("id", id)
    .eq("org_id", ORG_ID);
  return { error };
}

async function insertRow(table, row) {
  const payload = { org_id: ORG_ID, ...row };
  const { data, error } = await supabase.from(table).insert(payload).select();
  if (error) console.error(`[Supabase] insert ${table} error:`, error);
  return { data: data?.[0] || null, error };
}

async function updateRow(table, id, updates) {
  const { data, error } = await supabase
    .from(table)
    .update(updates)
    .eq("id", id)
    .select();
  if (error) console.error(`[Supabase] update ${table} error:`, error);
  return { data: data?.[0] || null, error };
}

async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) console.error(`[Supabase] delete ${table} error:`, error);
  return { error };
}

export const sanitizeEmptyToNull = (v) =>
  v === "" || v === undefined ? null : v;

export function mapPropertyRow(p, fundMap = {}, idx = 0) {
  return {
    id: p.id,
    num: idx + 1,
    name: p.name,
    type: formatPropertyType(p.property_type),
    submarket: p.submarket || "",
    sf: p.total_sf || 0,
    units: p.unit_count || null,
    occupancy: p.occupancy == null ? null : Math.round(p.occupancy * 100),
    noi: p.noi ?? null,
    capRate:
      p.cap_rate == null ? null : parseFloat((p.cap_rate * 100).toFixed(1)),
    value: p.current_value ?? null,
    fund: (fundMap[p.fund_id] || "")
      .replace("Valiance CRE ", "")
      .replace("Valiance ", ""),
    mgmt: p.mgmt_company || "Internal",
    yearAcquired: p.year_acquired || 0,
    entrataPropertyId: p.entrata_property_id || null,
    propertyType: p.property_type || "office",
    address: p.address_line1 || "",
    city: p.city || "",
    state: p.state || "",
    zip: p.zip || "",
    totalSf: p.total_sf || 0,
    yearBuilt: p.year_built || 0,
    fundId: p.fund_id ?? null,
    acquisitionDate: p.acquisition_date ?? null,
    acquisitionPrice: p.acquisition_price ?? null,
    currentValue: p.current_value ?? null,
  };
}

export function buildPropertyInsertRow(property) {
  return {
    name: property.name,
    property_type: property.propertyType,
    address_line1: property.address,
    city: property.city,
    state: property.state,
    zip: property.zip,
    total_sf: sanitizeEmptyToNull(property.totalSf),
    year_built: sanitizeEmptyToNull(property.yearBuilt),
    year_acquired:
      property.yearAcquired ||
      (property.acquisitionDate
        ? new Date(property.acquisitionDate).getFullYear()
        : null),
    fund_id: sanitizeEmptyToNull(property.fundId),
    acquisition_date: sanitizeEmptyToNull(property.acquisitionDate),
    acquisition_price: sanitizeEmptyToNull(property.acquisitionPrice),
    current_value: sanitizeEmptyToNull(property.currentValue),
    occupancy:
      sanitizeEmptyToNull(property.occupancy) == null
        ? null
        : property.occupancy / 100,
    noi: sanitizeEmptyToNull(property.noi),
    cap_rate:
      sanitizeEmptyToNull(property.capRate) == null
        ? null
        : property.capRate / 100,
    status: property.status || "active",
    entrata_property_id: normalizeEntrataPropertyId(property.entrataPropertyId),
  };
}

export async function createProperty(property) {
  return insertRow("properties", buildPropertyInsertRow(property));
}

export function normalizeEntrataPropertyId(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function mapEntrataLeaseRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    lease_id: row.lease_id,
    unit_id: row.unit_id,
    unit_number: row.unit_number || "",
    status: row.status || "",
    lease_start: row.lease_start_date || null,
    lease_end: row.lease_end_date || null,
    move_in: row.move_in_date || null,
    move_out: row.move_out_date || null,
    rent: row.rent === null || row.rent === undefined ? null : Number(row.rent),
    deposit:
      row.deposit === null || row.deposit === undefined
        ? null
        : Number(row.deposit),
    tenant_id: row.primary_customer_id || null,
    tenant_name: row.primary_customer_name || "",
    tenant_email: row.primary_customer_email || "",
    is_mtm: !!row.is_mtm,
    last_seen_at: row.last_seen_at || null,
    space_configuration: row.space_configuration || null,
  };
}

export function buildPropertyUpdatePayload(updates) {
  const mapped = {};
  if (updates.name !== undefined) mapped.name = updates.name;
  if (updates.propertyType !== undefined)
    mapped.property_type = updates.propertyType;
  if (updates.address !== undefined) mapped.address_line1 = updates.address;
  if (updates.city !== undefined) mapped.city = updates.city;
  if (updates.state !== undefined) mapped.state = updates.state;
  if (updates.zip !== undefined) mapped.zip = updates.zip;
  if (updates.totalSf !== undefined)
    mapped.total_sf = sanitizeEmptyToNull(updates.totalSf);
  if (updates.yearBuilt !== undefined)
    mapped.year_built = sanitizeEmptyToNull(updates.yearBuilt);
  if (updates.fundId !== undefined)
    mapped.fund_id = sanitizeEmptyToNull(updates.fundId);
  if (updates.acquisitionDate !== undefined)
    mapped.acquisition_date = sanitizeEmptyToNull(updates.acquisitionDate);
  if (updates.acquisitionPrice !== undefined)
    mapped.acquisition_price = sanitizeEmptyToNull(updates.acquisitionPrice);
  if (updates.currentValue !== undefined)
    mapped.current_value = sanitizeEmptyToNull(updates.currentValue);
  if (updates.occupancy !== undefined) {
    const v = sanitizeEmptyToNull(updates.occupancy);
    mapped.occupancy = v === null ? null : v / 100;
  }
  if (updates.noi !== undefined) mapped.noi = sanitizeEmptyToNull(updates.noi);
  if (updates.capRate !== undefined) {
    const v = sanitizeEmptyToNull(updates.capRate);
    mapped.cap_rate = v === null ? null : v / 100;
  }
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.entrataPropertyId !== undefined)
    mapped.entrata_property_id = normalizeEntrataPropertyId(
      updates.entrataPropertyId,
    );
  return mapped;
}

export async function updateProperty(id, updates) {
  const mapped = buildPropertyUpdatePayload(updates);
  mapped.updated_at = new Date().toISOString();
  return updateRow("properties", id, mapped);
}

export async function deleteProperty(id) {
  return deleteRow("properties", id);
}

export async function createTenant(tenant) {
  const { data: tenantRow, error: tenantErr } = await insertRow("tenants", {
    name: tenant.name,
    property_id: tenant.propertyId || null,
    tenant_type: tenant.industry || "commercial",
    contact_name: tenant.contactName || null,
    contact_email: tenant.contactEmail || null,
    credit_rating: tenant.creditRating || null,
    is_active: true,
  });
  if (tenantErr) return { data: null, error: tenantErr };
  if (tenant.propertyId && tenantRow?.id) {
    const today = new Date().toISOString().split("T")[0];
    const defaultEnd = new Date(
      new Date().setFullYear(new Date().getFullYear() + 5),
    )
      .toISOString()
      .split("T")[0];
    const leasedSf = Number(tenant.sf) || 0;
    const rentPerSf = Number(tenant.rentPerSf) || 0;
    const baseRentAnnual =
      rentPerSf > 0 && leasedSf > 0 ? rentPerSf * leasedSf : null;
    const { error: leaseErr } = await insertRow("leases", {
      tenant_id: tenantRow.id,
      property_id: tenant.propertyId,
      suite_unit: tenant.suite || null,
      leased_sf: leasedSf,
      lease_start: tenant.leaseStart || today,
      lease_end: tenant.leaseEnd || defaultEnd,
      rent_per_sf: rentPerSf || null,
      base_rent_annual: baseRentAnnual,
      base_rent_monthly: baseRentAnnual
        ? Math.round((baseRentAnnual / 12) * 100) / 100
        : null,
      lease_type: tenant.leaseType || "nnn",
      escalation_rate: tenant.escalation || null,
      status: "active",
    });
    if (leaseErr)
      console.error("[Supabase] insert lease for tenant error:", leaseErr);
  }
  return { data: tenantRow, error: null };
}

export async function updateTenant(id, updates) {
  const mapped = {};
  if (updates.name !== undefined) mapped.name = updates.name;
  if (updates.industry !== undefined) mapped.tenant_type = updates.industry;
  if (updates.status !== undefined)
    mapped.is_active = updates.status === "active";
  if (updates.creditRating !== undefined)
    mapped.credit_rating = updates.creditRating;
  if (updates.contactName !== undefined)
    mapped.contact_name = updates.contactName;
  if (updates.contactEmail !== undefined)
    mapped.contact_email = updates.contactEmail;
  mapped.updated_at = new Date().toISOString();
  return updateRow("tenants", id, mapped);
}

export async function deleteTenant(id) {
  return deleteRow("tenants", id);
}

export async function createWorkOrder(wo) {
  const isUuid = (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const desc = wo.title
    ? `${wo.title} — ${wo.description || ""}`.trim()
    : wo.description;
  const noteParts = [];
  if (wo.assignedTo && !isUuid(wo.assignedTo))
    noteParts.push(`Assigned to: ${wo.assignedTo}`);
  if (wo.requestedBy) noteParts.push(`Requested by: ${wo.requestedBy}`);
  return insertRow("work_orders", {
    property_id: wo.propertyId || null,
    description: desc,
    priority: wo.priority || "medium",
    status: wo.status || "submitted",
    category: wo.category,
    assigned_to: wo.assignedTo && isUuid(wo.assignedTo) ? wo.assignedTo : null,
    submitted_by:
      wo.requestedBy && isUuid(wo.requestedBy) ? wo.requestedBy : null,
    target_date: wo.dueDate || null,
    estimated_cost: wo.estimatedCost,
    submitted_date: new Date().toISOString().slice(0, 10),
    notes: noteParts.length ? noteParts.join("; ") : null,
  });
}

export async function updateWorkOrder(id, updates) {
  const mapped = {};
  if (updates.title !== undefined || updates.description !== undefined) {
    const parts = [updates.title, updates.description].filter(Boolean);
    if (parts.length) mapped.description = parts.join(" — ");
  }
  if (updates.priority !== undefined) mapped.priority = updates.priority;
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.category !== undefined) mapped.category = updates.category;
  if (updates.assignedTo !== undefined) {
    const isUuid = (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    mapped.assigned_to =
      updates.assignedTo && isUuid(updates.assignedTo)
        ? updates.assignedTo
        : null;
  }
  if (updates.dueDate !== undefined) mapped.target_date = updates.dueDate;
  if (updates.estimatedCost !== undefined)
    mapped.estimated_cost = updates.estimatedCost;
  if (updates.actualCost !== undefined) mapped.actual_cost = updates.actualCost;
  if (updates.completedDate !== undefined)
    mapped.completed_date = updates.completedDate;
  mapped.updated_at = new Date().toISOString();
  return updateRow("work_orders", id, mapped);
}

export async function deleteWorkOrder(id) {
  return deleteRow("work_orders", id);
}

export async function createInvestor(investor) {
  const piiFields = await _encryptInvestorPii(investor);
  return insertRow("investors", {
    name: investor.name,
    investor_type: investor.type,
    total_committed: investor.commitment,
    total_funded: investor.funded,
    primary_contact_name: investor.contactName,
    primary_contact_email: investor.contactEmail,
    relationship_since: investor.vintage ? `${investor.vintage}-01-01` : null,
    is_active: true,
    legal_entity_type: investor.legalEntityType || null,
    bank_name: investor.bankName || null,
    ...piiFields,
  });
}

export async function updateInvestor(id, updates) {
  const mapped = {};
  if (updates.name !== undefined) mapped.name = updates.name;
  if (updates.type !== undefined) mapped.investor_type = updates.type;
  if (updates.commitment !== undefined)
    mapped.total_committed = updates.commitment;
  if (updates.funded !== undefined) mapped.total_funded = updates.funded;
  if (updates.contactName !== undefined)
    mapped.primary_contact_name = updates.contactName;
  if (updates.contactEmail !== undefined)
    mapped.primary_contact_email = updates.contactEmail;
  if (updates.legalEntityType !== undefined)
    mapped.legal_entity_type = updates.legalEntityType;
  if (updates.bankName !== undefined) mapped.bank_name = updates.bankName;
  const piiFields = await _encryptInvestorPii(updates);
  Object.assign(mapped, piiFields);
  mapped.updated_at = new Date().toISOString();
  return updateRow("investors", id, mapped);
}

async function _encryptInvestorPii(data) {
  const result = {};
  if (data.bankAccount !== undefined) {
    if (data.bankAccount) {
      const { data: cipher } = await encryptPii(data.bankAccount);
      result.bank_account_encrypted = cipher;
      result.bank_account_last4 = data.bankAccount.slice(-4);
      result.has_bank_info = true;
    } else {
      result.bank_account_encrypted = null;
      result.bank_account_last4 = null;
      result.has_bank_info = !!data.bankRouting;
    }
  }
  if (data.bankRouting !== undefined) {
    if (data.bankRouting) {
      const { data: cipher } = await encryptPii(data.bankRouting);
      result.bank_routing_encrypted = cipher;
      if (!result.has_bank_info) result.has_bank_info = true;
    } else {
      result.bank_routing_encrypted = null;
    }
  }
  if (data.ssn !== undefined) {
    if (data.ssn) {
      const { data: cipher } = await encryptPii(data.ssn);
      result.ssn_encrypted = cipher;
      result.ssn_last4 = data.ssn.replace(/\D/g, "").slice(-4);
      result.has_ssn = true;
    } else {
      result.ssn_encrypted = null;
      result.ssn_last4 = null;
      result.has_ssn = false;
    }
  }
  if (data.ein !== undefined) {
    if (data.ein) {
      const { data: cipher } = await encryptPii(data.ein);
      result.ein_encrypted = cipher;
    } else {
      result.ein_encrypted = null;
    }
  }
  if (data.dob !== undefined) {
    if (data.dob) {
      const { data: cipher } = await encryptPii(data.dob);
      result.dob_encrypted = cipher;
      result.has_dob = true;
    } else {
      result.dob_encrypted = null;
      result.has_dob = false;
    }
  }
  return result;
}

export async function decryptInvestorPii(investor) {
  const fields = [
    { key: "bankAccount", encrypted: investor?.bank_account_encrypted },
    { key: "bankRouting", encrypted: investor?.bank_routing_encrypted },
    { key: "ssn", encrypted: investor?.ssn_encrypted },
    { key: "ein", encrypted: investor?.ein_encrypted },
    { key: "dob", encrypted: investor?.dob_encrypted },
  ];
  const results = await Promise.all(
    fields.map(async (f) => {
      if (!f.encrypted) return { key: f.key, value: null };
      const { data } = await decryptPii(f.encrypted);
      return { key: f.key, value: data };
    }),
  );
  return results.reduce((acc, r) => {
    acc[r.key] = r.value;
    return acc;
  }, {});
}

export async function deleteInvestor(id) {
  return deleteRow("investors", id);
}

export async function createCapitalCall(call) {
  return insertRow("capital_calls", {
    fund_id: call.fundId,
    call_number: call.callNumber,
    call_date: call.callDate || null,
    due_date: call.dueDate || null,
    total_amount: call.amount,
    purpose: call.purpose,
    status: call.status || "draft",
  });
}

export async function updateCapitalCall(id, updates) {
  const mapped = {};
  if (updates.callDate !== undefined) mapped.call_date = updates.callDate;
  if (updates.dueDate !== undefined) mapped.due_date = updates.dueDate;
  if (updates.amount !== undefined) mapped.total_amount = updates.amount;
  if (updates.purpose !== undefined) mapped.purpose = updates.purpose;
  if (updates.status !== undefined) mapped.status = updates.status;
  mapped.updated_at = new Date().toISOString();
  return updateRow("capital_calls", id, mapped);
}

export async function createDeal(deal) {
  return insertRow("deals", {
    name: deal.name,
    property_type: deal.propertyType,
    asking_price: deal.dealSize,
    stage: deal.stage || "screening",
    submarket: deal.location,
    broker_name: deal.broker || null,
    cap_rate:
      sanitizeEmptyToNull(deal.capRate) == null ? null : deal.capRate / 100,
    projected_irr:
      sanitizeEmptyToNull(deal.targetIrr) == null ? null : deal.targetIrr / 100,
    total_sf: deal.sf,
    fund_id: deal.fundId || null,
    notes: deal.notes,
  });
}

export async function updateDeal(id, updates) {
  const mapped = {};
  if (updates.name !== undefined) mapped.name = updates.name;
  if (updates.propertyType !== undefined)
    mapped.property_type = updates.propertyType;
  if (updates.dealSize !== undefined) mapped.asking_price = updates.dealSize;
  if (updates.stage !== undefined) mapped.stage = updates.stage;
  if (updates.location !== undefined) mapped.submarket = updates.location;
  if (updates.broker !== undefined) mapped.broker_name = updates.broker;
  if (updates.capRate !== undefined)
    mapped.cap_rate =
      sanitizeEmptyToNull(updates.capRate) == null
        ? null
        : updates.capRate / 100;
  if (updates.targetIrr !== undefined)
    mapped.projected_irr =
      sanitizeEmptyToNull(updates.targetIrr) == null
        ? null
        : updates.targetIrr / 100;
  if (updates.sf !== undefined) mapped.total_sf = updates.sf;
  if (updates.notes !== undefined) mapped.notes = updates.notes;
  mapped.updated_at = new Date().toISOString();
  return updateRow("deals", id, mapped);
}

export async function deleteDeal(id) {
  return deleteRow("deals", id);
}

export async function createInvoice(invoice) {
  return insertRow("invoices", {
    property_id: invoice.propertyId || null,
    vendor_name: invoice.vendorName,
    invoice_number: invoice.invoiceNumber,
    invoice_date: invoice.invoiceDate || null,
    due_date: invoice.dueDate || null,
    amount: invoice.amount,
    total_amount: invoice.amount,
    category: invoice.category,
    status:
      invoice.status === "pending"
        ? "submitted"
        : invoice.status || "submitted",
    description: invoice.description,
  });
}

export async function updateInvoice(id, updates) {
  const mapped = {};
  if (updates.vendorName !== undefined) mapped.vendor_name = updates.vendorName;
  if (updates.invoiceDate !== undefined)
    mapped.invoice_date = updates.invoiceDate;
  if (updates.dueDate !== undefined) mapped.due_date = updates.dueDate;
  if (updates.amount !== undefined) mapped.amount = updates.amount;
  if (updates.category !== undefined) mapped.category = updates.category;
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.description !== undefined)
    mapped.description = updates.description;
  mapped.updated_at = new Date().toISOString();
  return updateRow("invoices", id, mapped);
}

export async function createJournalEntry(entry) {
  return insertRow("journal_entries", {
    entry_date: entry.entryDate || null,
    description: entry.description,
    entry_type: entry.entryType || "manual",
    source: entry.reference || null,
    property_id: entry.propertyId || null,
    fund_id: entry.fundId || null,
    status: entry.status || "draft",
  });
}

export async function updateJournalEntry(id, updates) {
  const mapped = {};
  if (updates.entryDate !== undefined) mapped.entry_date = updates.entryDate;
  if (updates.description !== undefined)
    mapped.description = updates.description;
  if (updates.entryType !== undefined) mapped.entry_type = updates.entryType;
  if (updates.reference !== undefined) mapped.source = updates.reference;
  if (updates.status !== undefined) mapped.status = updates.status;
  mapped.updated_at = new Date().toISOString();
  return updateRow("journal_entries", id, mapped);
}

export async function createVendor(vendor) {
  return insertRow("vendors", {
    company: vendor.name,
    trade: vendor.category,
    contact_name: vendor.contactName,
    email: vendor.contactEmail,
    phone: vendor.contactPhone,
    contract_end: vendor.contractEnd || null,
    total_spend: vendor.annualValue,
    properties_serviced: vendor.propertyId ? 1 : 0,
    status: vendor.status || "active",
    rating: vendor.rating,
  });
}

export async function updateVendor(id, updates) {
  const mapped = {};
  if (updates.name !== undefined) mapped.company = updates.name;
  if (updates.category !== undefined) mapped.trade = updates.category;
  if (updates.contactName !== undefined)
    mapped.contact_name = updates.contactName;
  if (updates.contactEmail !== undefined) mapped.email = updates.contactEmail;
  if (updates.contactPhone !== undefined) mapped.phone = updates.contactPhone;
  if (updates.contractEnd !== undefined)
    mapped.contract_end = updates.contractEnd;
  if (updates.annualValue !== undefined)
    mapped.total_spend = updates.annualValue;
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.rating !== undefined) mapped.rating = updates.rating;
  mapped.updated_at = new Date().toISOString();
  return updateRow("vendors", id, mapped);
}

export async function createLeaseRenewal(renewal) {
  return insertRow("lease_renewals", {
    property_id: renewal.propertyId || null,
    tenant_name: renewal.tenantName,
    sf: renewal.currentSf,
    current_rent: renewal.currentRent,
    lease_end: renewal.expiryDate || null,
    renewal_probability: renewal.renewalProbability,
    asking_rent: renewal.proposedRent,
    concession_package: renewal.proposedTerm,
    status: renewal.status || "pending",
  });
}

export async function updateLeaseRenewal(id, updates) {
  const mapped = {};
  if (updates.renewalProbability !== undefined)
    mapped.renewal_probability = updates.renewalProbability;
  if (updates.proposedRent !== undefined)
    mapped.asking_rent = updates.proposedRent;
  if (updates.proposedTerm !== undefined)
    mapped.concession_package = updates.proposedTerm;
  if (updates.status !== undefined) mapped.status = updates.status;
  mapped.updated_at = new Date().toISOString();
  return updateRow("lease_renewals", id, mapped);
}

export async function createOperatingBudget(budget) {
  return insertRow("operating_budgets", {
    property_id: budget.propertyId || null,
    fund_id: budget.fundId || null,
    line_item: budget.lineItem,
    category: budget.category,
    budget_amount: budget.budgetAmount,
    actual_amount: budget.actualAmount || 0,
    fiscal_year: budget.period || new Date().getFullYear(),
  });
}

export async function updateOperatingBudget(id, updates) {
  const mapped = {};
  if (updates.budgetAmount !== undefined)
    mapped.budget_amount = updates.budgetAmount;
  if (updates.actualAmount !== undefined)
    mapped.actual_amount = updates.actualAmount;
  mapped.updated_at = new Date().toISOString();
  return updateRow("operating_budgets", id, mapped);
}

export async function createDistribution(dist) {
  return insertRow("distributions", {
    fund_id: dist.fundId,
    quarter: dist.quarter,
    gross_amount: dist.amount,
    distribution_type: dist.type,
    record_date: dist.recordDate || null,
    distribution_date: dist.paymentDate || null,
    status: dist.status || "draft",
  });
}

export async function updateDistribution(id, updates) {
  const mapped = {};
  if (updates.amount !== undefined) mapped.gross_amount = updates.amount;
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.paymentDate !== undefined)
    mapped.distribution_date = updates.paymentDate;
  mapped.updated_at = new Date().toISOString();
  return updateRow("distributions", id, mapped);
}

export async function createActionItem(item) {
  return insertRow("action_items", {
    title: item.title,
    description: item.description,
    assigned_to: item.assignee,
    priority: item.priority || "medium",
    status: item.status || "open",
    due_date: item.dueDate || null,
    category: item.category,
    property_id: item.propertyId || null,
    fund_id: item.fundId || null,
  });
}

export async function updateActionItem(id, updates) {
  const mapped = {};
  if (updates.title !== undefined) mapped.title = updates.title;
  if (updates.description !== undefined)
    mapped.description = updates.description;
  if (updates.assignee !== undefined) mapped.assigned_to = updates.assignee;
  if (updates.priority !== undefined) mapped.priority = updates.priority;
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.dueDate !== undefined) mapped.due_date = updates.dueDate;
  mapped.updated_at = new Date().toISOString();
  return updateRow("action_items", id, mapped);
}

export async function createAlert(alert) {
  return insertRow("alerts", {
    title: alert.title,
    message: alert.message,
    severity: alert.severity || "info",
    alert_type: alert.category,
    property_id: alert.propertyId || null,
    fund_id: alert.fundId || null,
    status: alert.status || "active",
  });
}

export async function updateAlert(id, updates) {
  const mapped = {};
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.severity !== undefined) mapped.severity = updates.severity;
  mapped.updated_at = new Date().toISOString();
  return updateRow("alerts", id, mapped);
}

export async function createInsurancePolicy(policy) {
  return insertRow("insurance_policies", {
    property_id: policy.propertyId || null,
    policy_type: policy.policyType,
    carrier: policy.carrier,
    policy_number: policy.policyNumber,
    premium: policy.premium,
    coverage: policy.coverageAmount,
    deductible: policy.deductible,
    effective_date: policy.effectiveDate || null,
    expiry_date: policy.expiryDate || null,
    status: policy.status || "active",
  });
}

export async function updateInsurancePolicy(id, updates) {
  const mapped = {};
  if (updates.premium !== undefined) mapped.premium = updates.premium;
  if (updates.coverageAmount !== undefined)
    mapped.coverage = updates.coverageAmount;
  if (updates.deductible !== undefined) mapped.deductible = updates.deductible;
  if (updates.expiryDate !== undefined) mapped.expiry_date = updates.expiryDate;
  if (updates.status !== undefined) mapped.status = updates.status;
  mapped.updated_at = new Date().toISOString();
  return updateRow("insurance_policies", id, mapped);
}

export async function createCapexProject(project) {
  return insertRow("capex_projects", {
    property_id: project.propertyId || null,
    project_name: project.projectName,
    category: project.category || null,
    budget: project.budget,
    spent: project.spent || 0,
    status: project.status || "planning",
    start_date: project.startDate || null,
    target_completion: project.completionDate || null,
    description: project.description || null,
    contractor: project.contractor || null,
  });
}

export async function updateCapexProject(id, updates) {
  const mapped = {};
  if (updates.projectName !== undefined)
    mapped.project_name = updates.projectName;
  if (updates.budget !== undefined) mapped.budget = updates.budget;
  if (updates.spent !== undefined) mapped.spent = updates.spent;
  if (updates.status !== undefined) mapped.status = updates.status;
  if (updates.completionDate !== undefined)
    mapped.target_completion = updates.completionDate;
  if (updates.description !== undefined)
    mapped.description = updates.description;
  mapped.updated_at = new Date().toISOString();
  return updateRow("capex_projects", id, mapped);
}

export async function reloadAllData() {
  _fundNameMapPromise = null;
  _propNameMapPromise = null;
  return loadAllData();
}

export async function checkInvitedEmail(email) {
  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select("id, email, is_active, auth_id")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (profileErr || !profile) {
    return {
      invited: false,
      hasAccount: false,
      isActive: false,
      error: {
        message:
          "This email has not been invited to the platform. Contact your administrator.",
      },
    };
  }
  if (!profile.is_active) {
    return {
      invited: true,
      hasAccount: false,
      isActive: false,
      error: {
        message:
          "This account has been deactivated. Contact your administrator.",
      },
    };
  }
  return {
    invited: true,
    hasAccount: !!profile.auth_id,
    isActive: true,
    error: null,
  };
}

export async function checkLoginAllowed(email) {
  const emailClean = (email || "").toLowerCase().trim();
  if (!emailClean) return { allowed: true };
  try {
    const { data, error } = await supabase.rpc("check_login_allowed", {
      p_email: emailClean,
    });
    if (error || !data) return { allowed: true };
    return {
      allowed: !!data.allowed,
      lockedUntil: data.locked_until || null,
      unlockInSeconds: data.unlock_in_seconds || null,
      attemptsRemaining:
        typeof data.attempts_remaining === "number"
          ? data.attempts_remaining
          : null,
      reason: data.reason || null,
    };
  } catch {
    return { allowed: true };
  }
}

let pendingLoginReload = false;
export function armPendingLoginReload() {
  pendingLoginReload = true;
}
export function consumePendingLoginReload() {
  const pending = pendingLoginReload;
  pendingLoginReload = false;
  return pending;
}

export async function signInWithPassword(email, password) {
  const emailClean = email.toLowerCase().trim();

  const check = await checkInvitedEmail(emailClean);
  if (check.error) return { data: null, error: check.error };

  const gate = await checkLoginAllowed(emailClean);
  if (!gate.allowed) {
    preauthAuditLog({
      action: AUDIT.auth.SIGN_IN_FAILURE,
      outcome: "denied",
      email: emailClean,
      targetType: "user",
      metadata: {
        email: emailClean,
        reason: "account_locked",
        unlock_in_seconds: gate.unlockInSeconds,
      },
      errorMessage:
        "Account temporarily locked due to repeated failed sign-in attempts",
    }).catch(() => {});
    return {
      data: null,
      error: {
        message:
          "Account temporarily locked due to repeated failed sign-in attempts.",
        code: "account_locked",
      },
      locked: true,
      lockedUntil: gate.lockedUntil,
      unlockInSeconds: gate.unlockInSeconds,
    };
  }

  armPendingLoginReload();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailClean,
    password,
  });
  if (error) {
    pendingLoginReload = false;
    let lockStatus = null;
    try {
      const { data: lockData } = await supabase.rpc("record_login_failure", {
        p_email: emailClean,
      });
      lockStatus = lockData || null;
    } catch {}
    preauthAuditLog({
      action: AUDIT.auth.SIGN_IN_FAILURE,
      outcome: "failure",
      email: emailClean,
      targetType: "user",
      metadata: {
        email: emailClean,
        attempts_remaining: lockStatus?.attempts_remaining ?? null,
        now_locked: lockStatus?.allowed === false,
      },
      errorMessage: error.message,
    }).catch(() => {});
    return {
      data: null,
      error,
      requiresMfa: false,
      attemptsRemaining: lockStatus?.attempts_remaining ?? null,
      locked: lockStatus?.allowed === false,
      lockedUntil: lockStatus?.locked_until || null,
      unlockInSeconds: lockStatus?.unlock_in_seconds || null,
    };
  }

  try {
    await supabase.rpc("record_login_success", { p_email: emailClean });
  } catch {}

  let requiresMfa = false;
  let mfaFactorId = null;
  try {
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (
      aalData &&
      aalData.currentLevel === "aal1" &&
      aalData.nextLevel === "aal2"
    ) {
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verified = (factorsData?.totp || []).find(
        (f) => f.status === "verified",
      );
      if (verified) {
        requiresMfa = true;
        mfaFactorId = verified.id;
      }
    }
  } catch (e) {}

  auditLog({
    action: AUDIT.auth.SIGN_IN_SUCCESS,
    outcome: "success",
    targetType: "user",
    targetId: data?.user?.id || null,
    metadata: { email: emailClean, mfa_pending: requiresMfa },
  }).catch(() => {});

  return { data, error: null, requiresMfa, mfaFactorId };
}

export async function setupAccount(email, password) {
  const emailClean = email.toLowerCase().trim();

  const check = await checkInvitedEmail(emailClean);
  if (check.error) return { data: null, error: check.error };
  if (check.hasAccount) {
    return {
      data: null,
      error: { message: "This email already has an account. Please sign in." },
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email: emailClean,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  return { data, error };
}

export async function resetPassword(email) {
  const emailClean = email.toLowerCase().trim();
  const check = await checkInvitedEmail(emailClean);
  if (check.error) return { data: null, error: check.error };
  if (!check.hasAccount) {
    return {
      data: null,
      error: {
        message:
          "No account found for this email. Please set up your account first.",
      },
    };
  }
  const { data, error } = await supabase.auth.resetPasswordForEmail(
    emailClean,
    {
      redirectTo: `${window.location.origin}/auth/set-password`,
    },
  );
  preauthAuditLog({
    action: AUDIT.auth.PASSWORD_RESET,
    outcome: error ? "failure" : "success",
    email: emailClean,
    metadata: { email: emailClean },
    errorMessage: error?.message,
  }).catch(() => {});
  return { data, error };
}

export async function updatePassword({ currentPassword, newPassword }) {
  if (!newPassword || newPassword.length < 12) {
    return {
      data: null,
      error: { message: "New password must be at least 12 characters." },
    };
  }
  try {
    const { data: sessionData } = await supabase.auth.getUser();
    const email = sessionData?.user?.email;
    const userId = sessionData?.user?.id;
    if (!email) {
      return {
        data: null,
        error: { message: "No active session. Please sign in again." },
      };
    }
    if (currentPassword) {
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (verifyErr) {
        auditLog({
          action: AUDIT.auth.PASSWORD_CHANGED,
          outcome: "failure",
          targetType: "user",
          targetId: userId,
          errorMessage: "current password incorrect",
        }).catch(() => {});
        return {
          data: null,
          error: { message: "Current password is incorrect." },
        };
      }
    }
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    auditLog({
      action: AUDIT.auth.PASSWORD_CHANGED,
      outcome: error ? "failure" : "success",
      targetType: "user",
      targetId: userId,
      errorMessage: error?.message,
    }).catch(() => {});
    return { data, error };
  } catch (err) {
    return {
      data: null,
      error: { message: err?.message || "Unexpected error updating password." },
    };
  }
}

export async function signOut() {
  await auditLog({
    action: AUDIT.auth.SIGN_OUT,
    outcome: "success",
    targetType: "user",
  });
  try {
    sessionStorage.removeItem("vb.stepup.last_verified_at");
  } catch {}
  const { error } = await supabase.auth.signOut();
  return { error };
}

export const NEWS_CATEGORIES = Object.freeze([
  { id: "capital_markets", label: "Capital Markets" },
  { id: "deals_transactions", label: "Deals & Transactions" },
  { id: "pe_industry", label: "PE Industry" },
  { id: "cre_sectors", label: "CRE Sectors" },
  { id: "regulatory_policy", label: "Regulatory & Policy" },
  { id: "esg_net_zero", label: "ESG & Net Zero" },
  { id: "macro_economy", label: "Macro & Economy" },
  { id: "proptech", label: "PropTech" },
]);

export async function fetchNewsItems(opts = {}) {
  const { category, limit = 50, since } = opts;
  let q = supabase
    .from("news_items")
    .select(
      "id, title, link, summary, author, published_at, image_url, category, source_label, feed_id, created_at",
    )
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (category) q = q.eq("category", category);
  if (since) q = q.gte("published_at", since);
  const { data, error } = await q;
  if (error) return { items: [], error };
  return { items: data || [], error: null };
}

export async function fetchNewsFeeds() {
  const { data, error } = await supabase
    .from("news_feeds")
    .select(
      "id, org_id, name, url, category, source_label, icon_url, is_enabled, is_subscription, last_fetched_at, last_fetch_status, last_item_count",
    )
    .order("name");
  if (error) return { feeds: [], error };
  return { feeds: data || [], error: null };
}

export async function upsertNewsFeed({
  id,
  name,
  url,
  category,
  source_label,
  auth_token,
  is_subscription,
  is_enabled,
}) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user)
    return { data: null, error: { message: "Not authenticated" } };
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  if (!profile?.org_id)
    return { data: null, error: { message: "No org found" } };

  let authTokenEncrypted = undefined;
  if (auth_token !== undefined) {
    if (auth_token) {
      const { data: cipher, error: encErr } = await encryptPii(auth_token);
      if (encErr) return { data: null, error: encErr };
      authTokenEncrypted = cipher;
    } else {
      authTokenEncrypted = null;
    }
  }

  const row = {
    id: id || undefined,
    org_id: profile.org_id,
    name,
    url,
    category,
    source_label: source_label || null,
    auth_token: null,
    ...(authTokenEncrypted !== undefined
      ? { auth_token_encrypted: authTokenEncrypted }
      : {}),
    is_subscription: !!is_subscription,
    is_enabled: is_enabled !== false,
  };
  const { data, error } = await supabase
    .from("news_feeds")
    .upsert(row)
    .select()
    .single();
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "news_feed",
    targetId: data?.id || id || null,
    metadata: {
      feed_name: name,
      category,
      auth_token_rotated: authTokenEncrypted !== undefined,
    },
    errorMessage: error?.message,
  }).catch(() => {});
  return { data, error };
}

export async function setNewsFeedEnabled(id, enabled) {
  const { data, error } = await supabase
    .from("news_feeds")
    .update({ is_enabled: !!enabled })
    .eq("id", id)
    .select()
    .single();
  return { data, error };
}

export async function deleteNewsFeed(id) {
  const { error } = await supabase.from("news_feeds").delete().eq("id", id);
  return { error };
}

export async function refreshNews() {
  const token = await getCurrentAccessToken();
  try {
    const res = await fetch("/.netlify/functions/fetch-news", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err?.message || "Refresh failed" };
  }
}

export async function mfaListFactors() {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return { totp: [], error };
    return { totp: data?.totp || [], error: null };
  } catch (err) {
    return {
      totp: [],
      error: { message: err?.message || "Failed to list factors" },
    };
  }
}

export async function mfaEnrollTotp(friendlyName = "Authenticator") {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName,
    });
    if (error) {
      auditLog({
        action: AUDIT.auth.MFA_ENABLED,
        outcome: "failure",
        metadata: { phase: "enroll_start" },
        errorMessage: error.message,
      }).catch(() => {});
      return { data: null, error };
    }
    return {
      data: {
        factorId: data.id,
        secret: data.totp?.secret,
        qrCode: data.totp?.qr_code,
        uri: data.totp?.uri,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err?.message || "Enrollment failed" },
    };
  }
}

export async function mfaVerifyCode({
  factorId,
  code,
  purpose = "challenge",
} = {}) {
  if (!factorId || !code) {
    return { data: null, error: { message: "factorId and code are required" } };
  }
  try {
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge(
      { factorId },
    );
    if (chErr) return { data: null, error: chErr };
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (error) {
      auditLog({
        action:
          purpose === "enroll"
            ? AUDIT.auth.MFA_ENABLED
            : AUDIT.auth.SIGN_IN_FAILURE,
        outcome: "failure",
        metadata: { phase: "mfa_verify", purpose },
        errorMessage: error.message,
      }).catch(() => {});
      return { data: null, error };
    }
    auditLog({
      action:
        purpose === "enroll"
          ? AUDIT.auth.MFA_ENABLED
          : AUDIT.auth.SIGN_IN_SUCCESS,
      outcome: "success",
      metadata: { phase: "mfa_verify", purpose, factorId },
    }).catch(() => {});
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err?.message || "Verification failed" },
    };
  }
}

export async function mfaUnenroll(factorId) {
  if (!factorId) return { error: { message: "factorId required" } };
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    auditLog({
      action: AUDIT.auth.MFA_DISABLED,
      outcome: error ? "failure" : "success",
      metadata: { factorId },
      errorMessage: error?.message,
    }).catch(() => {});
    return { error };
  } catch (err) {
    return { error: { message: err?.message || "Unenroll failed" } };
  }
}

const STEPUP_KEY = "vb.stepup.last_verified_at";
const STEPUP_GRACE_MS = 15 * 60 * 1000;

export function markStepUpVerified() {
  try {
    sessionStorage.setItem(STEPUP_KEY, String(Date.now()));
  } catch {}
}

export function clearStepUpGrace() {
  try {
    sessionStorage.removeItem(STEPUP_KEY);
  } catch {}
}

export function isStepUpFresh() {
  try {
    const raw = sessionStorage.getItem(STEPUP_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < STEPUP_GRACE_MS;
  } catch {
    return false;
  }
}

export async function stepUpRequired() {
  const { totp } = await mfaListFactors();
  const verifiedFactor = (totp || []).find((f) => f.status === "verified");
  if (!verifiedFactor) return { required: false, reason: "no_factor" };
  if (isStepUpFresh()) return { required: false, reason: "grace_window" };
  return { required: true, reason: "stale", factorId: verifiedFactor.id };
}

export async function verifyStepUp({ factorId, code, actionLabel } = {}) {
  if (!factorId || !code) {
    return { ok: false, error: { message: "factorId and code are required" } };
  }
  const { data, error } = await mfaVerifyCode({
    factorId,
    code,
    purpose: "stepup",
  });
  if (error) {
    auditLog({
      action: AUDIT.auth.SIGN_IN_FAILURE,
      outcome: "failure",
      metadata: { phase: "stepup", actionLabel, factorId },
      errorMessage: error.message,
    }).catch(() => {});
    return { ok: false, error };
  }
  markStepUpVerified();
  auditLog({
    action: AUDIT.auth.SIGN_IN_SUCCESS,
    outcome: "success",
    metadata: { phase: "stepup", actionLabel, factorId },
  }).catch(() => {});
  return { ok: true, data };
}

export async function adminNeedsEnrollment() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { needs: false };
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("is_admin")
      .eq("auth_id", user.id)
      .maybeSingle();

    let mfaRequiredForAll = false;
    try {
      const { data: policy } = await supabase
        .from("session_policies")
        .select("mfa_required")
        .maybeSingle();
      if (policy?.mfa_required === true) mfaRequiredForAll = true;
    } catch {}

    const mustEnroll = profile?.is_admin || mfaRequiredForAll;
    if (!mustEnroll) return { needs: false };

    const { totp } = await mfaListFactors();
    const hasVerified = (totp || []).some((f) => f.status === "verified");
    return {
      needs: !hasVerified,
      isAdmin: !!profile?.is_admin,
      reason: profile?.is_admin ? "admin" : "org_policy",
    };
  } catch {
    return { needs: false };
  }
}

export async function mfaGetAssuranceLevel() {
  try {
    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return { currentLevel: "aal1", nextLevel: "aal1", error };
    return {
      currentLevel: data.currentLevel || "aal1",
      nextLevel: data.nextLevel || "aal1",
      currentAuthenticationMethods: data.currentAuthenticationMethods || [],
      error: null,
    };
  } catch (err) {
    return {
      currentLevel: "aal1",
      nextLevel: "aal1",
      error: { message: err?.message },
    };
  }
}

export async function encryptPii(plaintext) {
  if (plaintext == null || plaintext === "") return { data: null, error: null };
  try {
    const { data, error } = await supabase.rpc("encrypt_pii_rpc", {
      plaintext,
    });
    if (error) return { data: null, error };
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err?.message || "encrypt_pii_rpc failed" },
    };
  }
}

export async function decryptPii(ciphertext) {
  if (ciphertext == null) return { data: null, error: null };
  let payload = ciphertext;
  if (ciphertext instanceof Uint8Array || ciphertext instanceof ArrayBuffer) {
    const bytes =
      ciphertext instanceof Uint8Array
        ? ciphertext
        : new Uint8Array(ciphertext);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    payload = "\\x" + hex;
  }
  try {
    const { data, error } = await supabase.rpc("decrypt_pii_rpc", {
      ciphertext: payload,
    });
    if (error) return { data: null, error };
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err?.message || "decrypt_pii_rpc failed" },
    };
  }
}

export async function decryptPiiBatch(ciphertexts = []) {
  return Promise.all(
    (ciphertexts || []).map(async (c) => {
      const { data, error } = await decryptPii(c);
      return { value: data, error };
    }),
  );
}

export async function fetchAccessReview() {
  try {
    const { data, error } = await supabase.rpc("get_org_access_review");
    if (error) return { rows: [], error };
    return { rows: data || [], error: null };
  } catch (err) {
    return {
      rows: [],
      error: { message: err?.message || "access review failed" },
    };
  }
}

export const SECURITY_VENDOR_CRITICALITY = Object.freeze([
  { id: "low", label: "Low", color: "#64748b" },
  { id: "medium", label: "Medium", color: "#eab308" },
  { id: "high", label: "High", color: "#f97316" },
  { id: "critical", label: "Critical", color: "#dc2626" },
]);

export const SECURITY_VENDOR_DATA_CLASSIFICATION = Object.freeze([
  { id: "none", label: "None" },
  { id: "internal", label: "Internal" },
  { id: "confidential", label: "Confidential" },
  { id: "restricted", label: "Restricted" },
]);

export const SECURITY_VENDOR_STATUS = Object.freeze([
  { id: "active", label: "Active", color: "#16a34a" },
  { id: "evaluating", label: "Evaluating", color: "#0ea5e9" },
  { id: "offboarding", label: "Offboarding", color: "#f97316" },
  { id: "terminated", label: "Terminated", color: "#64748b" },
]);

export async function fetchSecurityVendors({ status } = {}) {
  let q = supabase
    .from("security_vendors")
    .select("*")
    .order("criticality", { ascending: false })
    .order("name");
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  return { vendors: data || [], error };
}

export async function upsertSecurityVendor(payload) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user)
    return { data: null, error: { message: "Not authenticated" } };
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  if (!profile?.org_id)
    return { data: null, error: { message: "No org found" } };

  const row = {
    ...(payload.id ? { id: payload.id } : {}),
    org_id: profile.org_id,
    name: payload.name?.trim() || null,
    website: payload.website || null,
    category: payload.category || null,
    services_provided: payload.services_provided || null,
    our_owner: payload.our_owner || null,
    criticality: payload.criticality || "medium",
    data_classification: payload.data_classification || "internal",
    data_shared_description: payload.data_shared_description || null,
    is_subprocessor: !!payload.is_subprocessor,
    soc2_report_available: !!payload.soc2_report_available,
    soc2_report_url: payload.soc2_report_url || null,
    certifications: Array.isArray(payload.certifications)
      ? payload.certifications.filter(Boolean)
      : [],
    dpa_on_file: !!payload.dpa_on_file,
    bas_required: !!payload.bas_required,
    status: payload.status || "active",
    onboarded_at: payload.onboarded_at || null,
    contract_renewal_at: payload.contract_renewal_at || null,
    last_reviewed_at: payload.last_reviewed_at || null,
    next_review_at: payload.next_review_at || null,
    security_contact_email: payload.security_contact_email || null,
    notes: payload.notes || null,
    ...(payload.id ? {} : { created_by: userData.user.id }),
  };
  if (!row.name)
    return { data: null, error: { message: "Vendor name is required" } };

  const { data, error } = await supabase
    .from("security_vendors")
    .upsert(row)
    .select()
    .single();

  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "security_vendor",
    targetId: data?.id || payload.id || null,
    metadata: {
      vendor_name: row.name,
      is_new: !payload.id,
      criticality: row.criticality,
      is_subprocessor: row.is_subprocessor,
    },
    errorMessage: error?.message,
  }).catch(() => {});

  return { data, error };
}

export const RETENTION_DISPOSITIONS = Object.freeze([
  { id: "delete", label: "Delete", color: "#dc2626" },
  { id: "anonymize", label: "Anonymize", color: "#f97316" },
  { id: "archive", label: "Archive", color: "#0ea5e9" },
  { id: "retain_indefinitely", label: "Retain indefinitely", color: "#166534" },
]);

export const DSR_KINDS = Object.freeze([
  { id: "export", label: "Export" },
  { id: "erase", label: "Erase" },
  { id: "access", label: "Access" },
  { id: "rectify", label: "Rectify" },
]);

export async function fetchRetentionPolicies() {
  const { data, error } = await supabase
    .from("data_retention_policies")
    .select("*")
    .order("resource_type");
  return { policies: data || [], error };
}

export async function upsertRetentionPolicy(payload) {
  const row = {
    ...(payload.id ? { id: payload.id } : {}),
    resource_type: payload.resource_type?.trim() || null,
    table_name: payload.table_name?.trim() || null,
    retention_days:
      payload.retention_days === "" ? null : (payload.retention_days ?? null),
    disposition: payload.disposition || "delete",
    legal_basis: payload.legal_basis || null,
    description: payload.description || null,
    enabled: payload.enabled !== false,
    updated_at: new Date().toISOString(),
  };
  if (!row.resource_type || !row.table_name) {
    return {
      data: null,
      error: { message: "resource_type and table_name are required" },
    };
  }
  const { data, error } = await supabase
    .from("data_retention_policies")
    .upsert(row, { onConflict: "table_name" })
    .select()
    .single();
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "data_retention_policy",
    targetId: data?.id || null,
    metadata: {
      table_name: row.table_name,
      disposition: row.disposition,
      retention_days: row.retention_days,
    },
    errorMessage: error?.message,
  }).catch(() => {});
  return { data, error };
}

export async function adminExportUser(email) {
  const emailClean = (email || "").toLowerCase().trim();
  if (!emailClean)
    return { bundle: null, dsrId: null, error: { message: "Email required" } };
  try {
    const { data, error } = await supabase.rpc("admin_export_user", {
      p_email: emailClean,
    });
    if (error) {
      auditLog({
        action: AUDIT.data.EXPORT_GENERATED,
        outcome: "failure",
        targetType: "user_profile",
        metadata: { subject_email: emailClean, kind: "dsr_export" },
        errorMessage: error.message,
      }).catch(() => {});
      return { bundle: null, dsrId: null, error };
    }
    auditLog({
      action: AUDIT.data.EXPORT_GENERATED,
      outcome: "success",
      targetType: "user_profile",
      metadata: {
        subject_email: emailClean,
        kind: "dsr_export",
        dsr_id: data?.dsr_id || null,
      },
    }).catch(() => {});
    return {
      bundle: data?.bundle || null,
      dsrId: data?.dsr_id || null,
      error: null,
    };
  } catch (err) {
    return {
      bundle: null,
      dsrId: null,
      error: { message: err?.message || "Export failed" },
    };
  }
}

export async function adminEraseUser(email) {
  const emailClean = (email || "").toLowerCase().trim();
  if (!emailClean)
    return { result: null, error: { message: "Email required" } };
  try {
    const { data, error } = await supabase.rpc("admin_erase_user", {
      p_email: emailClean,
    });
    auditLog({
      action: AUDIT.user.DEACTIVATED,
      outcome: error ? "failure" : "success",
      targetType: "user_profile",
      metadata: {
        subject_email: emailClean,
        kind: "dsr_erase",
        dsr_id: data?.dsr_id || null,
        audit_rows_anonymized: data?.audit_rows_anonymized ?? null,
        profile_rows_anonymized: data?.profile_rows_anonymized ?? null,
      },
      errorMessage: error?.message,
    }).catch(() => {});
    if (error) return { result: null, error };
    return { result: data, error: null };
  } catch (err) {
    return { result: null, error: { message: err?.message || "Erase failed" } };
  }
}

export async function fetchDsrHistory({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from("data_subject_requests")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(limit);
  return { rows: data || [], error };
}

export async function adminUnlockAccount(email) {
  const emailClean = (email || "").toLowerCase().trim();
  if (!emailClean) return { error: { message: "Email required" } };
  try {
    const { error } = await supabase.rpc("admin_unlock_account", {
      p_email: emailClean,
    });
    auditLog({
      action: AUDIT.admin.SETTINGS_CHANGED,
      outcome: error ? "failure" : "success",
      targetType: "login_security",
      metadata: { event: "admin_unlock", email: emailClean },
      errorMessage: error?.message,
    }).catch(() => {});
    return { error: error || null };
  } catch (err) {
    return { error: { message: err?.message || "Unlock failed" } };
  }
}

export async function fetchLockedAccounts() {
  return { rows: [], error: null };
}

export async function runVendorAiReview(vendorId) {
  if (!vendorId)
    return { draft: null, error: { message: "vendorId required" } };
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return { draft: null, error: { message: "Not authenticated" } };
    const base = import.meta.env?.VITE_FUNCTIONS_BASE || "";
    const url = `${base}/.netlify/functions/vendor-review`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ vendorId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      auditLog({
        action: AUDIT.admin.SETTINGS_CHANGED,
        outcome: "failure",
        targetType: "security_vendor",
        targetId: vendorId,
        metadata: { event: "ai_review_requested", http_status: res.status },
        errorMessage: body?.error || `HTTP ${res.status}`,
      }).catch(() => {});
      return {
        draft: null,
        error: { message: body?.error || `AI review failed (${res.status})` },
      };
    }
    auditLog({
      action: AUDIT.admin.SETTINGS_CHANGED,
      outcome: "success",
      targetType: "security_vendor",
      targetId: vendorId,
      metadata: {
        event: "ai_review_generated",
        risk_level: body?.draft?.risk_level,
        confidence: body?.draft?.confidence,
        findings_count: (body?.draft?.findings || []).length,
      },
    }).catch(() => {});
    return { draft: body.draft, error: null };
  } catch (err) {
    return {
      draft: null,
      error: { message: err?.message || "AI review failed" },
    };
  }
}

export async function clearVendorAiDraft(
  vendorId,
  { disposition = "discarded" } = {},
) {
  const { error } = await supabase
    .from("security_vendors")
    .update({ ai_review_draft: null, ai_review_generated_at: null })
    .eq("id", vendorId);
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "security_vendor",
    targetId: vendorId,
    metadata: { event: "ai_review_" + disposition },
    errorMessage: error?.message,
  }).catch(() => {});
  return { error };
}

export async function markSecurityVendorReviewed(
  vendorId,
  { nextReviewDays = 365 } = {},
) {
  const today = new Date().toISOString().slice(0, 10);
  const next = new Date();
  next.setDate(next.getDate() + nextReviewDays);
  const nextStr = next.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("security_vendors")
    .update({ last_reviewed_at: today, next_review_at: nextStr })
    .eq("id", vendorId)
    .select()
    .single();
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "security_vendor",
    targetId: vendorId,
    metadata: { event: "reviewed", next_review_at: nextStr },
    errorMessage: error?.message,
  }).catch(() => {});
  return { data, error };
}

export async function deleteSecurityVendor(vendorId) {
  const { error } = await supabase
    .from("security_vendors")
    .delete()
    .eq("id", vendorId);
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "security_vendor",
    targetId: vendorId,
    metadata: { event: "deleted" },
    errorMessage: error?.message,
  }).catch(() => {});
  return { error };
}

export async function fetchSecurityProgramTasks(opts = {}) {
  let q = supabase
    .from("security_program_tasks")
    .select("*")
    .order("next_due_at", { ascending: true });
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.cadence) q = q.eq("cadence", opts.cadence);
  const today = new Date().toISOString().slice(0, 10);
  if (opts.overdueOnly) {
    q = q.lt("next_due_at", today);
  } else if (typeof opts.dueWithinDays === "number") {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + opts.dueWithinDays);
    q = q.lte("next_due_at", horizon.toISOString().slice(0, 10));
  }
  const { data, error } = await q;
  return { tasks: data || [], error };
}

export async function completeSecurityProgramTask(
  taskId,
  { outcome = "passed", evidenceUrl = null, notes = null, metadata = {} } = {},
) {
  const { data, error } = await supabase.rpc("complete_security_program_task", {
    p_task_id: taskId,
    p_outcome: outcome,
    p_evidence_url: evidenceUrl,
    p_notes: notes,
    p_metadata: metadata,
  });
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "security_program_task",
    targetId: taskId,
    metadata: { event: "completed", outcome, has_evidence_url: !!evidenceUrl },
    errorMessage: error?.message,
  }).catch(() => {});
  if (error) return { error };
  const row = Array.isArray(data) ? data[0] : data;
  return {
    runId: row?.run_id || null,
    taskId: row?.task_id || taskId,
    nextDueAt: row?.next_due_at || null,
    error: null,
  };
}

export async function fetchSecurityProgramRuns(taskId, { limit = 20 } = {}) {
  const { data, error } = await supabase
    .from("security_program_runs")
    .select("*")
    .eq("task_id", taskId)
    .order("completed_at", { ascending: false })
    .limit(limit);
  return { runs: data || [], error };
}

export async function fetchSecurityRlsDriftFindings(opts = {}) {
  let q = supabase
    .from("security_rls_drift_findings")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(opts.limit || 100);
  if (opts.resolved === true) q = q.not("resolved_at", "is", null);
  else if (opts.resolved === false) q = q.is("resolved_at", null);
  if (opts.severity) q = q.eq("severity", opts.severity);
  const { data, error } = await q;
  return { findings: data || [], error };
}

export async function resolveSecurityRlsDriftFinding(
  findingId,
  { notes } = {},
) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("security_rls_drift_findings")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userData?.user?.id || null,
      resolution_notes: notes || null,
    })
    .eq("id", findingId);
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "security_rls_drift_finding",
    targetId: findingId,
    metadata: { event: "resolved" },
    errorMessage: error?.message,
  }).catch(() => {});
  return { error };
}

export async function fetchSecurityDigests({ limit = 12 } = {}) {
  const { data, error } = await supabase
    .from("security_digests")
    .select("*")
    .order("period_end", { ascending: false })
    .limit(limit);
  return { digests: data || [], error };
}

export async function fetchSecurityRisks({ status = "active" } = {}) {
  let q = supabase
    .from("security_risks")
    .select("*")
    .order("residual_score", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  return { risks: data || [], error };
}

export async function upsertSecurityRisk(payload) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user)
    return { data: null, error: { message: "Not authenticated" } };
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  if (!profile?.org_id)
    return { data: null, error: { message: "No org found" } };

  const row = {
    ...(payload.id ? { id: payload.id } : {}),
    org_id: profile.org_id,
    risk_code: payload.risk_code,
    title: payload.title?.trim() || null,
    description: payload.description || null,
    category: payload.category || "operational",
    inherent_likelihood: payload.inherent_likelihood,
    inherent_impact: payload.inherent_impact,
    mitigation: payload.mitigation || null,
    residual_likelihood: payload.residual_likelihood,
    residual_impact: payload.residual_impact,
    owner_role: payload.owner_role || "security_lead",
    review_due_at: payload.review_due_at || null,
    status: payload.status || "active",
    notes: payload.notes || null,
  };
  if (!row.title || !row.risk_code)
    return { data: null, error: { message: "risk_code and title required" } };
  const { data, error } = await supabase
    .from("security_risks")
    .upsert(row)
    .select()
    .single();
  auditLog({
    action: AUDIT.admin.SETTINGS_CHANGED,
    outcome: error ? "failure" : "success",
    targetType: "security_risk",
    targetId: data?.id || payload.id || null,
    metadata: {
      event: payload.id ? "updated" : "created",
      risk_code: row.risk_code,
    },
    errorMessage: error?.message,
  }).catch(() => {});
  return { data, error };
}

export async function startVendorOffboarding(vendorId, reason) {
  if (!vendorId || !reason || reason.trim().length < 5) {
    return {
      data: null,
      error: { message: "vendor_id and reason (≥5 chars) required" },
    };
  }
  const { data, error } = await supabase.rpc("start_vendor_offboarding", {
    p_vendor_id: vendorId,
    p_reason: reason.trim(),
  });
  return { data: Array.isArray(data) ? data[0] : data, error };
}

export async function completeVendorOffboarding({
  vendorId,
  credentialsRevoked,
  dataDeletionRequested = false,
  dataDeletionConfirmed = false,
  notes = "",
}) {
  if (!vendorId)
    return { data: null, error: { message: "vendor_id required" } };
  if (credentialsRevoked !== true) {
    return {
      data: null,
      error: {
        message: "credentials_revoked must be true to complete offboarding",
      },
    };
  }
  const { data, error } = await supabase.rpc("complete_vendor_offboarding", {
    p_vendor_id: vendorId,
    p_credentials_revoked: credentialsRevoked,
    p_data_deletion_requested: !!dataDeletionRequested,
    p_data_deletion_confirmed: !!dataDeletionConfirmed,
    p_notes: notes || "",
  });
  return { data: Array.isArray(data) ? data[0] : data, error };
}

export async function fetchSecurityAnomalies({
  status = null,
  limit = 100,
} = {}) {
  let q = supabase
    .from("security_anomalies")
    .select(
      "id, detector, severity, subject_type, subject_id, title, description, evidence, alert_count, last_seen_at, status, resolution_notes, resolved_by, resolved_at, email_sent_at, created_at, updated_at",
    )
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  return { anomalies: data || [], error };
}

export async function triageSecurityAnomaly({ anomalyId, status, notes = "" }) {
  if (!anomalyId || !status)
    return { ok: false, error: { message: "anomaly_id and status required" } };
  const valid = ["acknowledged", "resolved", "false_positive", "suppressed"];
  if (!valid.includes(status))
    return {
      ok: false,
      error: { message: `status must be one of ${valid.join(", ")}` },
    };
  const { data, error } = await supabase.rpc("security_anomaly_triage", {
    p_anomaly_id: anomalyId,
    p_status: status,
    p_notes: notes,
  });
  return { ok: !error && data === true, error };
}

export async function verifyAuditLogChain({ limit = 10000 } = {}) {
  const { data, error } = await supabase.rpc("audit_log_verify_chain", {
    p_org_id: null,
    p_limit: limit,
  });
  return { result: Array.isArray(data) ? data[0] : data, error };
}

export async function markAuditLogIncident({ auditLogId, incidentRef }) {
  if (!auditLogId || !incidentRef)
    return {
      ok: false,
      error: { message: "auditLogId and incidentRef required" },
    };
  const { data, error } = await supabase.rpc("audit_log_mark_incident", {
    p_audit_log_id: auditLogId,
    p_incident_ref: incidentRef,
  });
  return { ok: !error && data === true, error };
}

export const AUDIT = Object.freeze({
  auth: {
    SIGN_IN_SUCCESS: "auth.sign_in.success",
    SIGN_IN_FAILURE: "auth.sign_in.failure",
    SIGN_OUT: "auth.sign_out",
    PASSWORD_RESET: "auth.password.reset_requested",
    PASSWORD_CHANGED: "auth.password.changed",
    MFA_ENABLED: "auth.mfa.enabled",
    MFA_DISABLED: "auth.mfa.disabled",
    IDLE_LOGOUT: "auth.session.idle_logout",
    SESSION_STARTED: "auth.session.started",
    SESSION_ENDED: "auth.session.ended",
    SESSION_FORCE_LOGOUT: "auth.session.force_logout",
  },
  user: {
    INVITED: "user.invited",
    ROLE_CHANGED: "user.role_changed",
    DEACTIVATED: "user.deactivated",
    REACTIVATED: "user.reactivated",
    TEMP_PASSWORD_ISSUED: "user.temp_password_issued",
    EMAIL_CONFIRMED: "user.email_confirmed",
  },
  agent: {
    PERSONA_CREATED: "agent.persona.created",
    PERSONA_UPDATED: "agent.persona.updated",
    PERSONA_DELETED: "agent.persona.deleted",
    PROMPT_INJECTION: "agent.chat.prompt_injection_detected",
  },
  data: {
    EXPORT_GENERATED: "data.export.generated",
    EXPORT_DOWNLOADED: "data.export.downloaded",
    EXPORT_BLOCKED: "data.export.blocked",
    EXPORT_POLICY_UPDATED: "data.export.policy_updated",
    EXPORT_REQUESTED: "data.export.requested",
    EXPORT_APPROVED: "data.export.approved",
    EXPORT_DENIED: "data.export.denied",
    BULK_DELETE: "data.bulk_delete",
    ACCESS_DENIED: "data.access.denied",
  },
  integration: {
    MS_GRAPH_CONNECTED: "integration.ms_graph.connected",
    MS_GRAPH_DISCONNECTED: "integration.ms_graph.disconnected",
  },
  admin: {
    SETTINGS_CHANGED: "admin.settings.changed",
    ORG_CONFIGURED: "admin.org.configured",
  },
});

export function auditResourceType(action, targetType) {
  if (targetType) return targetType;
  const a = String(action || "");
  if (a.startsWith("auth.")) return "user";
  return a.split(".")[0] || "system";
}

export async function auditLog({
  action,
  outcome = "success",
  targetType = null,
  targetId = null,
  before = null,
  after = null,
  metadata = null,
  errorMessage = null,
} = {}) {
  if (!action) {
    console.warn("[audit] auditLog called without action; skipping");
    return;
  }
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user || null;

    let user_email = user?.email || null;
    let user_role = null;
    let org_id = null;
    if (user) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("email, role, org_id")
        .eq("auth_id", user.id)
        .maybeSingle();
      if (profile) {
        user_email = profile.email || user_email;
        user_role = profile.role || null;
        org_id = profile.org_id || null;
      }
    }

    const capJson = (obj) => {
      if (obj == null) return null;
      const s = JSON.stringify(obj);
      if (s.length > 4000)
        return { _truncated: true, preview: s.slice(0, 3900) };
      return obj;
    };

    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isAuthEvent = String(action).startsWith("auth.");
    const effectiveTargetId =
      targetId == null && isAuthEvent ? user?.id || null : targetId;
    const targetStr =
      effectiveTargetId == null ? null : String(effectiveTargetId);
    const resourceIdUuid =
      targetStr && uuidLike.test(targetStr) ? targetStr : null;
    const resourceNameText = targetStr ? targetStr.slice(0, 200) : null;

    let changes = null;
    if (before || after)
      changes = capJson({ before: before || null, after: after || null });

    const metadataWithRole = user_role
      ? { ...(capJson(metadata) || {}), profile_role: user_role }
      : capJson(metadata);

    const row = {
      user_id: user?.id || null,
      user_email,
      org_id,
      action,
      outcome,
      resource_type: auditResourceType(action, targetType),
      resource_id: resourceIdUuid,
      resource_name: resourceNameText,
      changes,
      metadata: metadataWithRole,
      error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
      user_agent:
        typeof navigator !== "undefined"
          ? navigator.userAgent?.slice(0, 500)
          : null,
    };

    const { error } = await supabase.from("audit_log").insert(row);
    if (error)
      console.warn("[audit] insert failed:", error.message, {
        action,
        outcome,
      });
  } catch (err) {
    console.warn(
      "[audit] unexpected error, not failing caller:",
      err?.message || err,
    );
  }
}

async function preauthAuditLog({
  action,
  outcome = "failure",
  email,
  targetType = null,
  metadata = null,
  errorMessage = null,
} = {}) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
      return auditLog({ action, outcome, targetType, metadata, errorMessage });
    }
    const { error } = await supabase.rpc("log_preauth_auth_event", {
      p_action: action,
      p_identifier: email || null,
      p_outcome: outcome,
      p_metadata: metadata,
      p_error_message: errorMessage
        ? String(errorMessage).slice(0, 1000)
        : null,
      p_user_agent:
        typeof navigator !== "undefined"
          ? (navigator.userAgent || "").slice(0, 500)
          : null,
    });
    if (error)
      console.warn("[audit] pre-auth rpc failed:", error.message, {
        action,
        outcome,
      });
  } catch (err) {
    console.warn(
      "[audit] unexpected error, not failing caller:",
      err?.message || err,
    );
  }
}

export async function fetchSecurityAuditLog(opts = {}) {
  const { limit = 200, action, outcome, actorId, since } = opts;
  let q = supabase
    .from("audit_log")
    .select(
      "id, timestamp, user_id, user_email, user_role, action, outcome, resource_type, resource_id, resource_name, changes, metadata, error_message, ip_address, user_agent",
    )
    .order("timestamp", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 1000));
  if (action) q = q.eq("action", action);
  if (outcome) q = q.eq("outcome", outcome);
  if (actorId) q = q.eq("user_id", actorId);
  if (since) q = q.gte("timestamp", since);
  const { data, error } = await q;
  if (error) return { entries: [], error };
  const entries = (data || []).map((r) => ({
    id: r.id,
    created_at: r.timestamp,
    actor_id: r.user_id,
    actor_email: r.user_email,
    actor_role: r.user_role || (r.metadata && r.metadata.profile_role) || null,
    action: r.action,
    outcome: r.outcome,
    target_type: r.resource_type,
    target_id: r.resource_name || r.resource_id,
    changes: r.changes,
    metadata: r.metadata,
    error_message: r.error_message,
    ip_address: r.ip_address,
    user_agent: r.user_agent,
  }));
  return { entries, error: null };
}

const SUSPICIOUS_RULES = [
  {
    id: "brute_force",
    label: "Brute-Force Attempt",
    severity: "critical",
    test(entries) {
      const failures = entries.filter(
        (e) => e.action === "auth.sign_in.failure",
      );
      const byActor = {};
      failures.forEach((e) => {
        const k = e.actor_email || e.actor_id || "unknown";
        (byActor[k] = byActor[k] || []).push(e);
      });
      const alerts = [];
      Object.entries(byActor).forEach(([actor, rows]) => {
        rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        for (let i = 0; i < rows.length; i++) {
          const windowEnd =
            new Date(rows[i].created_at).getTime() + 30 * 60 * 1000;
          const inWindow = rows.filter((r) => {
            const t = new Date(r.created_at).getTime();
            return (
              t >= new Date(rows[i].created_at).getTime() && t <= windowEnd
            );
          });
          if (inWindow.length >= 5) {
            alerts.push({
              actor,
              description: `${inWindow.length} failed sign-ins within 30 minutes`,
              evidence: inWindow,
              firstSeen: inWindow[0].created_at,
              lastSeen: inWindow[inWindow.length - 1].created_at,
            });
            break;
          }
        }
      });
      return alerts;
    },
  },
  {
    id: "privilege_escalation",
    label: "Privilege Escalation",
    severity: "high",
    test(entries) {
      return entries
        .filter(
          (e) =>
            e.action === "user.role_changed" &&
            e.changes?.after?.role === "admin",
        )
        .map((e) => ({
          actor: e.actor_email || "unknown",
          description: `Role changed to admin for ${e.target_id || "unknown user"}`,
          evidence: [e],
          firstSeen: e.created_at,
          lastSeen: e.created_at,
        }));
    },
  },
  {
    id: "access_denied_spike",
    label: "Repeated Access Denied",
    severity: "high",
    test(entries) {
      const denied = entries.filter((e) => e.outcome === "denied");
      const byActor = {};
      denied.forEach((e) => {
        const k = e.actor_email || e.actor_id || "unknown";
        const day = (e.created_at || "").slice(0, 10);
        const key = `${k}|${day}`;
        (byActor[key] = byActor[key] || { actor: k, day, rows: [] }).rows.push(
          e,
        );
      });
      return Object.values(byActor)
        .filter((g) => g.rows.length >= 3)
        .map((g) => ({
          actor: g.actor,
          description: `${g.rows.length} access-denied events on ${g.day}`,
          evidence: g.rows,
          firstSeen: g.rows[0].created_at,
          lastSeen: g.rows[g.rows.length - 1].created_at,
        }));
    },
  },
  {
    id: "off_hours",
    label: "Off-Hours Activity",
    severity: "medium",
    test(entries) {
      const offHours = entries.filter((e) => {
        const h = new Date(e.created_at).getHours();
        return h >= 0 && h < 5;
      });
      const byActor = {};
      offHours.forEach((e) => {
        const k = e.actor_email || e.actor_id || "unknown";
        (byActor[k] = byActor[k] || []).push(e);
      });
      return Object.entries(byActor)
        .filter(([, rows]) => rows.length >= 3)
        .map(([actor, rows]) => ({
          actor,
          description: `${rows.length} actions between 12 AM–5 AM`,
          evidence: rows.slice(0, 10),
          firstSeen: rows[0].created_at,
          lastSeen: rows[rows.length - 1].created_at,
        }));
    },
  },
  {
    id: "bulk_export",
    label: "Unusual Data Export",
    severity: "high",
    test(entries) {
      const exports = entries.filter(
        (e) =>
          e.action === "data.export.generated" ||
          e.action === "data.export.downloaded",
      );
      const byActorDay = {};
      exports.forEach((e) => {
        const k = `${e.actor_email || "unknown"}|${(e.created_at || "").slice(0, 10)}`;
        (byActorDay[k] = byActorDay[k] || {
          actor: e.actor_email || "unknown",
          rows: [],
        }).rows.push(e);
      });
      return Object.values(byActorDay)
        .filter((g) => g.rows.length >= 2)
        .map((g) => ({
          actor: g.actor,
          description: `${g.rows.length} data exports in a single day`,
          evidence: g.rows,
          firstSeen: g.rows[0].created_at,
          lastSeen: g.rows[g.rows.length - 1].created_at,
        }));
    },
  },
  {
    id: "prompt_injection",
    label: "Prompt Injection Detected",
    severity: "critical",
    test(entries) {
      return entries
        .filter((e) => e.action === "agent.chat.prompt_injection_detected")
        .map((e) => ({
          actor: e.actor_email || "unknown",
          description: "AI agent detected a prompt injection attempt",
          evidence: [e],
          firstSeen: e.created_at,
          lastSeen: e.created_at,
        }));
    },
  },
  {
    id: "mfa_disabled",
    label: "MFA Disabled",
    severity: "high",
    test(entries) {
      return entries
        .filter((e) => e.action === "auth.mfa.disabled")
        .map((e) => ({
          actor: e.actor_email || "unknown",
          description: "Multi-factor authentication was disabled",
          evidence: [e],
          firstSeen: e.created_at,
          lastSeen: e.created_at,
        }));
    },
  },
  {
    id: "deactivate_reactivate",
    label: "Deactivate/Reactivate Churn",
    severity: "medium",
    test(entries) {
      const deactivations = entries.filter(
        (e) => e.action === "user.deactivated",
      );
      const reactivations = entries.filter(
        (e) => e.action === "user.reactivated",
      );
      const alerts = [];
      deactivations.forEach((d) => {
        const reAct = reactivations.find(
          (r) =>
            r.target_id === d.target_id &&
            new Date(r.created_at) > new Date(d.created_at) &&
            new Date(r.created_at) - new Date(d.created_at) <
              48 * 60 * 60 * 1000,
        );
        if (reAct) {
          alerts.push({
            actor: d.actor_email || "unknown",
            description: `User ${d.target_id} deactivated then reactivated within 48h`,
            evidence: [d, reAct],
            firstSeen: d.created_at,
            lastSeen: reAct.created_at,
          });
        }
      });
      return alerts;
    },
  },
];

export async function fetchSuspiciousActivityAnalysis(opts = {}) {
  const { days = 30 } = opts;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { entries, error } = await fetchSecurityAuditLog({
    limit: 1000,
    since,
  });
  if (error) return { alerts: [], stats: {}, error };

  const allAlerts = [];
  for (const rule of SUSPICIOUS_RULES) {
    try {
      const hits = rule.test(entries);
      hits.forEach((h) =>
        allAlerts.push({
          ...h,
          ruleId: rule.id,
          ruleLabel: rule.label,
          severity: rule.severity,
        }),
      );
    } catch (_) {}
  }

  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allAlerts.sort(
    (a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9),
  );

  const stats = {
    totalEntries: entries.length,
    totalAlerts: allAlerts.length,
    critical: allAlerts.filter((a) => a.severity === "critical").length,
    high: allAlerts.filter((a) => a.severity === "high").length,
    medium: allAlerts.filter((a) => a.severity === "medium").length,
    failedLogins: entries.filter((e) => e.action === "auth.sign_in.failure")
      .length,
    deniedAccess: entries.filter((e) => e.outcome === "denied").length,
    uniqueActors: [
      ...new Set(entries.map((e) => e.actor_email).filter(Boolean)),
    ].length,
    timespan: days,
  };

  return { alerts: allAlerts, stats, error: null };
}

export async function getSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  return { session, error };
}

export async function getUserProfile(authId) {
  if (!authId) return { profile: null, error: null };
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("auth_id", authId)
    .maybeSingle();
  if (data) {
    supabase
      .from("user_profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(
        () => {},
        (e) =>
          console.warn(
            "[auth] last_login_at write failed (non-blocking):",
            e?.message || e,
          ),
      );
  }
  return { profile: data, error };
}

export async function getUserProfileByEmail(email) {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();
  return { profile: data, error };
}

export function onAuthStateChange(callback) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => subscription.unsubscribe();
}

export async function inviteUser(email, displayName, role = "gp") {
  let token = null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    token = sessionData?.session?.access_token || null;
  } catch (_) {
    token = null;
  }
  if (!token) {
    return {
      data: null,
      error: { message: "Not signed in" },
      actionLink: null,
    };
  }

  let res;
  try {
    res = await fetch("/.netlify/functions/admin-invite-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: email?.toLowerCase().trim(),
        display_name: displayName,
        role,
      }),
    });
  } catch (e) {
    return {
      data: null,
      error: { message: e?.message || "Network error" },
      actionLink: null,
    };
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    payload = null;
  }

  if (!res.ok) {
    const msg = payload?.error || `Invite failed (HTTP ${res.status})`;
    return { data: null, error: { message: msg }, actionLink: null };
  }

  return {
    data: payload?.data ?? null,
    error: null,
    actionLink: payload?.actionLink ?? null,
  };
}

export async function issueTempPassword(userProfileId) {
  let token = null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    token = sessionData?.session?.access_token || null;
  } catch (_) {
    token = null;
  }
  if (!token) {
    return { data: null, error: { message: "Not signed in" }, warning: null };
  }

  let res;
  try {
    res = await fetch("/.netlify/functions/admin-issue-temp-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_id: userProfileId }),
    });
  } catch (e) {
    return {
      data: null,
      error: { message: e?.message || "Network error" },
      warning: null,
    };
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    payload = null;
  }

  if (!res.ok) {
    const msg =
      payload?.error ||
      `Could not issue a temporary password (HTTP ${res.status})`;
    return { data: null, error: { message: msg }, warning: null };
  }

  return {
    data: payload?.data ?? null,
    error: null,
    warning: payload?.warning ?? null,
  };
}

const ASSIGNABLE_ROLES = ["gp"];
export async function updateUserRole(profileId, newRole) {
  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    return { data: null, error: { message: "Invalid role." } };
  }
  const { data, error } = await supabase
    .from("user_profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .select()
    .single();
  return { data, error };
}

export async function deactivateUser(profileId) {
  const { data, error } = await supabase
    .from("user_profiles")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .select()
    .single();
  return { data, error };
}

export async function listOrgUsers() {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

export function downloadCSV(filename, headers, rows) {
  const escape = (val) => {
    const s = val == null ? "" : String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function generateHTMLReport({ title, subtitle, sections, companyName }) {
  const company = companyName || _currentOrgName || "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none; } @page { margin: 0.75in; } }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 40px; }
  .header { text-align: center; border-bottom: 3px solid #c9a84c; padding-bottom: 20px; margin-bottom: 30px; }
  .header h1 { font-size: 28px; margin: 0; color: #0a1628; } .header h2 { font-size: 16px; color: #666; margin: 6px 0 0; font-weight: 400; }
  .header .company { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #c9a84c; margin-bottom: 8px; }
  .confidential { text-align: center; font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 24px; }
  .section { margin-bottom: 28px; } .section h3 { font-size: 18px; color: #0a1628; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; margin-bottom: 14px; }
  .section p { font-size: 13px; color: #444; } .section .metric { display: inline-block; min-width: 180px; margin: 6px 12px 6px 0; }
  .metric-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .metric-value { font-size: 20px; font-weight: 700; color: #0a1628; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
  th { background: #f5f3ee; color: #0a1628; font-weight: 600; text-align: left; padding: 10px 12px; border-bottom: 2px solid #c9a84c; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; color: #333; }
  tr:nth-child(even) td { background: #fafaf8; }
  .footer { text-align: center; font-size: 10px; color: #999; border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 40px; }
  .print-btn { position: fixed; top: 20px; right: 20px; padding: 10px 24px; background: #0a1628; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; }
</style></head><body>
<button class="no-print print-btn" onclick="window.print()">Save as PDF / Print</button>
<div class="header"><div class="company">${company}</div><h1>${title}</h1><h2>${subtitle || ""}</h2></div>
<div class="confidential">Confidential & Proprietary</div>
${sections
  .map((s) => {
    if (s.type === "metrics") {
      return `<div class="section"><h3>${s.title}</h3><div>${s.items.map((m) => `<div class="metric"><div class="metric-label">${m.label}</div><div class="metric-value">${m.value}</div></div>`).join("")}</div></div>`;
    }
    if (s.type === "table") {
      return `<div class="section"><h3>${s.title}</h3><table><thead><tr>${s.headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    if (s.type === "text") {
      return `<div class="section"><h3>${s.title}</h3><p>${s.content}</p></div>`;
    }
    return "";
  })
  .join("\n")}
<div class="footer">Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} — ${company} — This document is confidential and intended solely for the named recipient(s).</div>
</body></html>`;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

async function __claimIdempotency(idempotencyKey) {
  try {
    const { data, error } = await supabase
      .from("workflow_action_log")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .limit(1);
    if (error) throw error;
    return !(Array.isArray(data) && data.length);
  } catch (e) {
    console.warn("[Workflow] idempotency check failed:", e.message);
    return true;
  }
}

async function __logWorkflowAction({
  ruleId = null,
  ruleName = null,
  actionType,
  idempotencyKey,
  targetTable = null,
  targetId = null,
  payload = {},
  result = "success",
  errorMessage = null,
}) {
  try {
    await supabase.from("workflow_action_log").insert({
      org_id: ORG_ID,
      rule_id: ruleId,
      rule_name: ruleName,
      action_type: actionType,
      idempotency_key: idempotencyKey,
      target_table: targetTable,
      target_id: targetId,
      payload,
      result,
      error_message: errorMessage,
    });
  } catch (e) {
    console.warn("[Workflow] action log write failed:", e.message);
  }
}

const VALID_NOTIFICATION_TYPES = new Set([
  "alert",
  "action_item",
  "approval",
  "system",
  "integration",
  "report",
  "deadline",
]);
export async function fireNotification({
  userId = null,
  title,
  body = "",
  severity = "info",
  category = "general",
  link = null,
  source = "manual",
  sourceRef = null,
  idempotencyKey = null,
  ruleId = null,
  ruleName = null,
  notificationType = "alert",
}) {
  if (!title)
    return { notificationId: null, skipped: false, error: "title required" };
  const dbType = VALID_NOTIFICATION_TYPES.has(notificationType)
    ? notificationType
    : "system";
  const row = {
    org_id: ORG_ID,
    user_id: userId,
    notification_type: dbType,
    title,
    message: body,
    severity,
    action_url: link,
    resource_type: sourceRef ? "rule" : null,
    source,
    source_ref: sourceRef,
    idempotency_key: idempotencyKey,
  };
  const { data, error } = await supabase
    .from("notifications")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) {
    const isDup =
      String(error.code || "").includes("23505") ||
      /duplicate/i.test(error.message || "");
    if (isDup) {
      await __logWorkflowAction({
        ruleId,
        ruleName,
        actionType: "notification_sent",
        idempotencyKey: idempotencyKey || `notif:${Date.now()}`,
        targetTable: "notifications",
        payload: row,
        result: "skipped_duplicate",
      });
      return { notificationId: null, skipped: true };
    }
    await __logWorkflowAction({
      ruleId,
      ruleName,
      actionType: "notification_sent",
      idempotencyKey: idempotencyKey || `notif:${Date.now()}`,
      targetTable: "notifications",
      payload: row,
      result: "error",
      errorMessage: error.message,
    });
    return { notificationId: null, skipped: false, error };
  }
  await __logWorkflowAction({
    ruleId,
    ruleName,
    actionType: "notification_sent",
    idempotencyKey: idempotencyKey || `notif:${data?.id}`,
    targetTable: "notifications",
    targetId: data?.id,
    payload: row,
  });
  return { notificationId: data?.id || null, skipped: false };
}

export async function fireEscalateAlert({
  alertId,
  newSeverity = "critical",
  newStatus = "active",
  reason = "Auto-escalated by workflow rule",
  idempotencyKey,
  ruleId = null,
  ruleName = null,
}) {
  if (!alertId || !idempotencyKey) {
    return { skipped: false, error: "alertId and idempotencyKey required" };
  }
  const firstClaim = await __claimIdempotency(idempotencyKey);
  if (!firstClaim) {
    return { skipped: true };
  }
  const { error } = await supabase
    .from("alerts")
    .update({ severity: newSeverity, status: newStatus })
    .eq("id", alertId)
    .eq("org_id", ORG_ID);
  if (error) {
    await __logWorkflowAction({
      ruleId,
      ruleName,
      actionType: "alert_escalated",
      idempotencyKey,
      targetTable: "alerts",
      targetId: alertId,
      payload: { newSeverity, newStatus, reason },
      result: "error",
      errorMessage: error.message,
    });
    return { skipped: false, error };
  }
  await __logWorkflowAction({
    ruleId,
    ruleName,
    actionType: "alert_escalated",
    idempotencyKey,
    targetTable: "alerts",
    targetId: alertId,
    payload: { newSeverity, newStatus, reason },
  });
  return { skipped: false };
}

export async function fetchNotifications({
  limit = 50,
  unreadOnly = false,
} = {}) {
  let q = supabase
    .from("notifications")
    .select(
      "id, title, message, severity, notification_type, action_url, action_label, resource_type, resource_id, source, source_ref, is_read, read_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (unreadOnly) q = q.eq("is_read", false);
  const { data, error } = await q;
  if (error) {
    console.warn("[Supabase] fetchNotifications failed:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    id: r.id,
    title: r.title,
    body: r.message,
    severity: r.severity,
    category: r.notification_type,
    link: r.action_url,
    actionLabel: r.action_label,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    source: r.source,
    sourceRef: r.source_ref,
    isRead: !!r.is_read,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

export async function markNotificationRead(notificationId) {
  if (!notificationId) return { error: "notificationId required" };
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) return { error };
  return { error: null };
}

export async function evaluateAutomationRules(rules, portfolioData) {
  const triggered = [];
  const skipped = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const rule of rules) {
    const ruleId = String(rule.id || rule.name || rule.trigger || "rule");
    const ruleName = rule.name || rule.trigger || ruleId;
    const baseIdempKey = `rule:${ruleId}:${today}`;
    try {
      let shouldTrigger = false;
      let details = "";

      switch (rule.trigger) {
        case "occupancy_below": {
          const threshold = rule.threshold || 85;
          const lowOcc = (portfolioData.properties || []).filter(
            (p) => p.occupancy < threshold,
          );
          if (lowOcc.length > 0) {
            shouldTrigger = true;
            details = `${lowOcc.length} properties below ${threshold}% occupancy: ${lowOcc.map((p) => p.name).join(", ")}`;
          }
          break;
        }
        case "lease_expiry_soon": {
          const months = rule.months || 6;
          const cutoff = new Date();
          cutoff.setMonth(cutoff.getMonth() + months);
          const expiring = (portfolioData.tenants || []).filter((t) => {
            const end = t.leaseEnd || t.lease_end;
            return end && new Date(end) <= cutoff;
          });
          if (expiring.length > 0) {
            shouldTrigger = true;
            details = `${expiring.length} leases expiring within ${months} months`;
          }
          break;
        }
        case "budget_variance": {
          const threshold = rule.threshold || 10;
          const overBudget = (portfolioData.operatingBudgets || []).filter(
            (b) => {
              const variance =
                b.actual && b.budget
                  ? ((b.actual - b.budget) / b.budget) * 100
                  : 0;
              return variance > threshold;
            },
          );
          if (overBudget.length > 0) {
            shouldTrigger = true;
            details = `${overBudget.length} line items exceed ${threshold}% budget variance`;
          }
          break;
        }
        case "work_order_overdue": {
          const overdue = (portfolioData.workOrders || []).filter((wo) => {
            const isOpen = wo.status !== "Completed" && wo.status !== "Closed";
            const dueDate = wo.due_date || wo.date;
            return isOpen && dueDate && new Date(dueDate) < new Date();
          });
          if (overdue.length > 0) {
            shouldTrigger = true;
            details = `${overdue.length} overdue work orders`;
          }
          break;
        }
        case "distribution_pending": {
          const pending = (portfolioData.distributions || []).filter(
            (d) => d.status === "Pending" || d.status === "Scheduled",
          );
          if (pending.length > 0) {
            shouldTrigger = true;
            details = `${pending.length} distributions pending processing`;
          }
          break;
        }
        default:
          break;
      }

      if (!shouldTrigger) {
        skipped.push({ rule: ruleName, reason: "Condition not met" });
        continue;
      }

      const alreadyFired = !(await __claimIdempotency(`${baseIdempKey}:alert`));
      if (alreadyFired) {
        await __logWorkflowAction({
          ruleId,
          ruleName,
          actionType: "noop",
          idempotencyKey: `${baseIdempKey}:noop:${Date.now()}`,
          payload: { details, reason: "already fired today" },
          result: "skipped_duplicate",
        });
        skipped.push({ rule: ruleName, reason: "Already fired today" });
        continue;
      }

      const severity = rule.severity || "warning";
      const alertRow = {
        title: ruleName,
        description: details,
        severity,
        category: rule.category || "operations",
        status: "active",
        org_id: ORG_ID,
      };
      const { data: alertInsert, error: alertErr } = await supabase
        .from("alerts")
        .insert(alertRow)
        .select("id")
        .maybeSingle();
      await __logWorkflowAction({
        ruleId,
        ruleName,
        actionType: "alert_created",
        idempotencyKey: `${baseIdempKey}:alert`,
        targetTable: "alerts",
        targetId: alertInsert?.id || null,
        payload: alertRow,
        result: alertErr ? "error" : "success",
        errorMessage: alertErr?.message || null,
      });

      await fireNotification({
        userId: null,
        title: ruleName,
        body: details,
        severity,
        category: rule.category || "operations",
        source: "workflow_rule",
        sourceRef: alertInsert?.id || ruleId,
        idempotencyKey: `${baseIdempKey}:notify`,
        ruleId,
        ruleName,
      });

      if (rule.autoEscalate && alertInsert?.id) {
        await fireEscalateAlert({
          alertId: alertInsert.id,
          newSeverity: "critical",
          reason: "Rule-driven auto-escalation",
          idempotencyKey: `${baseIdempKey}:escalate`,
          ruleId,
          ruleName,
        });
      }

      triggered.push({
        rule: ruleName,
        details,
        alertId: alertInsert?.id || null,
        dbError: alertErr?.message || null,
      });
    } catch (err) {
      skipped.push({ rule: ruleName, reason: err.message });
    }
  }

  return { triggered, skipped };
}

export function subscribeToTable(table, callback) {
  const channel = supabase
    .channel(`realtime-${table}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `org_id=eq.${ORG_ID}` },
      (payload) => {
        callback({
          event: payload.eventType,
          new: payload.new,
          old: payload.old,
          table,
        });
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToAll(tables, callback) {
  const channel = supabase.channel("realtime-all");
  tables.forEach((table) => {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `org_id=eq.${ORG_ID}` },
      (payload) => {
        callback({
          event: payload.eventType,
          new: payload.new,
          old: payload.old,
          table,
        });
      },
    );
  });
  channel.subscribe((status, err) => {
    console.log("[Realtime] Channel status:", status, err || "");
  });
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function getInvestorCapitalAccount(investorId) {
  const { data, error } = await supabase
    .from("investors")
    .select("*")
    .eq("id", investorId)
    .eq("org_id", ORG_ID)
    .single();
  return { data, error };
}

export async function getInvestorDistributions(investorId) {
  const { data, error } = await supabase
    .from("distributions")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("distribution_date", { ascending: false });
  const filtered = investorId
    ? (data || []).filter((d) => d.investor_id === investorId || !d.investor_id)
    : data || [];
  return { data: filtered, error };
}

export async function getFundPerformanceSummary() {
  const { data: funds, error: fErr } = await supabase
    .from("funds")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("vintage", { ascending: false });
  const { data: props, error: pErr } = await supabase
    .from("properties")
    .select(
      "name, occupancy, noi, current_value, total_sf, property_type, fund_id",
    )
    .eq("org_id", ORG_ID);
  return {
    funds: funds || [],
    properties: props || [],
    error: fErr || pErr,
  };
}

export function calculatePropertyRiskScore(property) {
  const occ = property.occupancy ?? 0;
  const occScore =
    occ >= 95
      ? 25
      : occ >= 90
        ? 22
        : occ >= 85
          ? 18
          : occ >= 75
            ? 12
            : occ >= 60
              ? 6
              : 0;

  const noi = property.noi ?? 0;
  const noiPerSf = property.sf ? noi / property.sf : 0;
  const noiScore =
    noiPerSf > 25
      ? 25
      : noiPerSf > 18
        ? 22
        : noiPerSf > 12
          ? 18
          : noiPerSf > 6
            ? 12
            : 5;

  const mv = property.value || property.market_value || 0;
  const impliedCap = mv > 0 && noi > 0 ? (noi / mv) * 100 : 7;
  const mktScore =
    impliedCap >= 4 && impliedCap <= 6.5
      ? 25
      : impliedCap > 6.5 && impliedCap <= 8
        ? 20
        : impliedCap > 8 && impliedCap <= 10
          ? 15
          : 8;

  const typeScores = {
    Industrial: 15,
    Multifamily: 14,
    "Mixed-Use": 12,
    Office: 10,
    Retail: 8,
    Hospitality: 5,
  };
  const ptScore = typeScores[property.type || property.property_type] ?? 10;

  const tcScore = occ >= 90 ? 10 : occ >= 80 ? 7 : occ >= 70 ? 5 : 3;

  const components = {
    occupancy: { score: occScore, max: 25 },
    noiPerformance: { score: noiScore, max: 25 },
    marketStability: { score: mktScore, max: 25 },
    propertyType: { score: ptScore, max: 15 },
    tenantConcentration: { score: tcScore, max: 10 },
  };

  const total = Object.values(components).reduce((s, v) => s + v.score, 0);
  const grade =
    total >= 85
      ? "A"
      : total >= 70
        ? "B"
        : total >= 55
          ? "C"
          : total >= 40
            ? "D"
            : "F";

  return { total, grade, components, maxScore: 100 };
}

export function calculatePortfolioRisk(properties) {
  if (!properties?.length)
    return { avgScore: 0, distribution: {}, highRisk: [], grade: "N/A" };

  const scored = properties.map((p) => ({
    ...p,
    risk: calculatePropertyRiskScore(p),
  }));
  const avgScore = scored.reduce((s, p) => s + p.risk.total, 0) / scored.length;
  const distribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  scored.forEach((p) => {
    distribution[p.risk.grade] = (distribution[p.risk.grade] || 0) + 1;
  });
  const highRisk = scored
    .filter((p) => p.risk.total < 55)
    .sort((a, b) => a.risk.total - b.risk.total);
  const grade =
    avgScore >= 85
      ? "A"
      : avgScore >= 70
        ? "B"
        : avgScore >= 55
          ? "C"
          : avgScore >= 40
            ? "D"
            : "F";

  return {
    avgScore: Math.round(avgScore),
    distribution,
    highRisk,
    grade,
    scored,
  };
}

export function generateMarketSignals(properties, marketData = {}) {
  const signals = [];

  const avgOcc = properties.length
    ? properties.reduce((s, p) => s + (p.occupancy || 0), 0) / properties.length
    : 0;
  if (avgOcc < 85) {
    signals.push({
      type: "warning",
      category: "Occupancy",
      message: `Portfolio avg occupancy at ${avgOcc.toFixed(1)}% — below 85% threshold`,
      action: "Review leasing strategy and tenant retention programs",
    });
  } else if (avgOcc > 95) {
    signals.push({
      type: "opportunity",
      category: "Occupancy",
      message: `Portfolio avg occupancy at ${avgOcc.toFixed(1)}% — consider rent increases`,
      action: "Analyze market rents for repositioning upside",
    });
  }

  const totalNOI = properties.reduce((s, p) => s + (p.noi || 0), 0);
  if (totalNOI > 0) {
    const topProp = [...properties].sort(
      (a, b) => (b.noi || 0) - (a.noi || 0),
    )[0];
    const topPct = topProp ? ((topProp.noi || 0) / totalNOI) * 100 : 0;
    if (topPct > 30) {
      signals.push({
        type: "risk",
        category: "Concentration",
        message: `${topProp.name} represents ${topPct.toFixed(0)}% of portfolio NOI`,
        action: "Consider diversification through acquisitions or dispositions",
      });
    }
  }

  const types = {};
  properties.forEach((p) => {
    const pt = p.type || p.property_type || "Unknown";
    types[pt] = (types[pt] || 0) + 1;
  });
  const typeEntries = Object.entries(types).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length === 1) {
    signals.push({
      type: "risk",
      category: "Diversification",
      message: `Portfolio is 100% ${typeEntries[0][0]} — single sector concentration`,
      action: "Explore cross-sector investment opportunities",
    });
  }

  const capRates = marketData.capRateTrends || [];
  if (capRates.length >= 2) {
    const recent = capRates[capRates.length - 1];
    const prev = capRates[capRates.length - 2];
    if (recent.cap_rate > prev.cap_rate) {
      signals.push({
        type: "warning",
        category: "Market",
        message: "Cap rates trending upward — potential valuation headwinds",
        action: "Review hold/sell analysis and stress test underwriting",
      });
    }
  }

  if (avgOcc >= 90 && avgOcc <= 95) {
    signals.push({
      type: "positive",
      category: "Portfolio Health",
      message: `Strong portfolio occupancy at ${avgOcc.toFixed(1)}%`,
      action: "Maintain current leasing and retention strategy",
    });
  }

  return signals;
}

function deriveDeviceLabel(ua) {
  if (!ua) return "Unknown device";
  let browser = "Unknown";
  let os = "Unknown";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Macintosh|Mac OS/i.test(ua)) os = "macOS";
  else if (/iPhone|iPad/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Linux/i.test(ua)) os = "Linux";
  return `${browser} · ${os}`;
}

export async function startSession(userProfile) {
  if (!userProfile)
    return { data: null, error: { message: "No user profile" } };
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const { data, error } = await supabase
    .from("user_sessions")
    .insert({
      org_id: userProfile.org_id || ORG_ID,
      user_id: userProfile.id,
      auth_id: userProfile.auth_id,
      user_email: userProfile.email,
      status: "active",
      user_agent: ua,
      device_label: deriveDeviceLabel(ua),
      started_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    })
    .select()
    .single();
  return { data, error };
}

export async function endSession(sessionId, reason = "user_sign_out") {
  if (!sessionId) return { error: null };
  const { error } = await supabase
    .from("user_sessions")
    .update({
      status: reason === "idle_timeout" ? "expired" : "signed_out",
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("id", sessionId);
  return { error };
}

export async function touchSession(sessionId) {
  if (!sessionId) return { error: null };
  const { error } = await supabase
    .from("user_sessions")
    .update({ last_active: new Date().toISOString() })
    .eq("id", sessionId);
  return { error };
}

export async function startUserSession(userProfile) {
  try {
    const { data, error } = await startSession(userProfile);
    if (error) {
      console.warn(
        "[session] start failed, not failing caller:",
        error.message,
      );
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.warn(
      "[session] start threw, not failing caller:",
      err?.message || err,
    );
    return null;
  }
}

export async function touchUserSession(sessionId) {
  if (!sessionId) return;
  try {
    const { error } = await touchSession(sessionId);
    if (error)
      console.warn(
        "[session] heartbeat failed, not failing caller:",
        error.message,
      );
  } catch (err) {
    console.warn(
      "[session] heartbeat threw, not failing caller:",
      err?.message || err,
    );
  }
}

export async function endUserSession(sessionId, reason = "user_sign_out") {
  if (!sessionId) return;
  try {
    const { error } = await endSession(sessionId, reason);
    if (error)
      console.warn("[session] end failed, not failing caller:", error.message);
  } catch (err) {
    console.warn(
      "[session] end threw, not failing caller:",
      err?.message || err,
    );
  }
}

export async function fetchTimeInAppByDay(opts = {}) {
  const { since, until, limit = 5000 } = opts;
  const toDay = (v) =>
    typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;
  let q = supabase
    .from("user_session_time_by_day")
    .select("user_email, day, minutes, sessions, estimated")
    .order("day", { ascending: false })
    .order("user_email", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 10000));
  const sinceDay = toDay(since);
  const untilDay = toDay(until);
  if (sinceDay) q = q.gte("day", sinceDay);
  if (untilDay) q = q.lte("day", untilDay);
  const { data, error } = await q;
  if (error) return { rows: [], error };
  const rows = (data || []).map((r) => ({
    user_email: r.user_email,
    day: typeof r.day === "string" ? r.day.slice(0, 10) : r.day,
    minutes: Number(r.minutes) || 0,
    sessions: Number(r.sessions) || 0,
    estimated: !!r.estimated,
  }));
  return { rows, error: null };
}

export async function fetchOrgSessions({
  includeEnded = true,
  limit = 200,
} = {}) {
  let query = supabase
    .from("user_sessions")
    .select("*")
    .order("last_active", { ascending: false })
    .limit(limit);
  if (!includeEnded) {
    query = query.eq("status", "active");
  }
  const { data, error } = await query;
  return { sessions: data || [], error };
}

export async function forceLogoutSession(sessionId) {
  const { data, error } = await supabase
    .from("user_sessions")
    .update({
      status: "force_logged_out",
      ended_at: new Date().toISOString(),
      end_reason: "force_logout",
    })
    .eq("id", sessionId)
    .select()
    .single();
  return { data, error };
}

export async function forceLogoutUser(userId) {
  const { data, error } = await supabase
    .from("user_sessions")
    .update({
      status: "force_logged_out",
      ended_at: new Date().toISOString(),
      end_reason: "force_logout",
    })
    .eq("user_id", userId)
    .eq("status", "active")
    .select();
  return { count: data?.length || 0, error };
}

export async function fetchSessionPolicy() {
  const { data, error } = await supabase
    .from("session_policies")
    .select("*")
    .single();
  return { policy: data, error };
}

export async function updateSessionPolicy(updates) {
  const { data, error } = await supabase
    .from("session_policies")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("org_id", ORG_ID)
    .select()
    .single();
  return { data, error };
}

export function validateCIDR(input) {
  if (!input || typeof input !== "string") return { valid: false };
  const trimmed = input.trim();
  const ipOnly = /^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed);
  const cidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(trimmed);
  if (!ipOnly && !cidr) return { valid: false };
  const parts = trimmed.split("/");
  const octets = parts[0].split(".").map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return { valid: false };
  const prefix = cidr ? parseInt(parts[1], 10) : 32;
  if (prefix < 0 || prefix > 32) return { valid: false };
  return { valid: true, normalized: `${parts[0]}/${prefix}` };
}

export function ipMatchesCIDR(ip, cidrStr) {
  if (!ip || !cidrStr) return false;
  const ipToNum = (str) =>
    str.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>>
    0;
  const parts = cidrStr.split("/");
  const rangeIp = ipToNum(parts[0]);
  const prefix = parseInt(parts[1] || "32", 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToNum(ip) & mask) === (rangeIp & mask);
}

export async function fetchIPAllowlist() {
  const { data, error } = await supabase
    .from("ip_allowlist")
    .select("*")
    .order("created_at", { ascending: true });
  return { rules: data || [], error };
}

export async function createIPRule({ cidr, label, description }) {
  const { data, error } = await supabase
    .from("ip_allowlist")
    .insert({
      org_id: ORG_ID,
      cidr,
      label: label || "",
      description: description || "",
      is_active: true,
    })
    .select()
    .single();
  return { data, error };
}

export async function updateIPRule(ruleId, updates) {
  const { data, error } = await supabase
    .from("ip_allowlist")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", ruleId)
    .select()
    .single();
  return { data, error };
}

export async function deleteIPRule(ruleId) {
  const { error } = await supabase
    .from("ip_allowlist")
    .delete()
    .eq("id", ruleId);
  return { error };
}

export async function fetchIPAccessPolicy() {
  const { data, error } = await supabase
    .from("ip_access_policy")
    .select("*")
    .single();
  return { policy: data, error };
}

export async function updateIPAccessPolicy(updates) {
  const { data, error } = await supabase
    .from("ip_access_policy")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("org_id", ORG_ID)
    .select()
    .single();
  return { data, error };
}

export async function fetchIPAccessLog({ limit: lim = 100 } = {}) {
  const { data, error } = await supabase
    .from("ip_access_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(lim);
  return { entries: data || [], error };
}

export async function logIPAccess({
  userEmail,
  ipAddress,
  userAgent,
  action,
  matchedRule,
  country,
  city,
  reason,
}) {
  const { error } = await supabase.from("ip_access_log").insert({
    org_id: ORG_ID,
    user_email: userEmail,
    ip_address: ipAddress,
    user_agent: userAgent,
    action: action || "flagged",
    matched_rule: matchedRule || null,
    country: country || null,
    city: city || null,
    reason: reason || null,
  });
  return { error };
}

export async function fetchExportPolicies() {
  const { data, error } = await supabase
    .from("export_policies")
    .select("*")
    .order("dataset_label", { ascending: true });
  return { policies: data || [], error };
}

export async function createExportPolicy(fields) {
  const { data, error } = await supabase
    .from("export_policies")
    .insert({ org_id: ORG_ID, ...fields })
    .select()
    .single();
  return { data, error };
}

export async function updateExportPolicy(policyId, updates) {
  const { data, error } = await supabase
    .from("export_policies")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", policyId)
    .select()
    .single();
  return { data, error };
}

export async function deleteExportPolicy(policyId) {
  const { error } = await supabase
    .from("export_policies")
    .delete()
    .eq("id", policyId);
  return { error };
}

export async function fetchExportRequests({
  status: st,
  limit: lim = 50,
} = {}) {
  let q = supabase
    .from("export_requests")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(lim);
  if (st) q = q.eq("status", st);
  const { data, error } = await q;
  return { requests: data || [], error };
}

export async function submitExportRequest({
  datasetKey,
  format,
  rowCount,
  reason,
  metadata,
}) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, email")
    .eq("auth_id", (await supabase.auth.getUser()).data.user?.id)
    .single();
  if (!profile) return { error: { message: "User profile not found" } };
  const { data, error } = await supabase
    .from("export_requests")
    .insert({
      org_id: ORG_ID,
      requested_by: profile.id,
      requester_email: profile.email,
      dataset_key: datasetKey,
      format: format || "csv",
      row_count: rowCount || null,
      reason: reason || "",
      metadata: metadata || {},
    })
    .select()
    .single();
  return { data, error };
}

export async function reviewExportRequest(requestId, decision, note) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, email")
    .eq("auth_id", (await supabase.auth.getUser()).data.user?.id)
    .single();
  const { data, error } = await supabase
    .from("export_requests")
    .update({
      status: decision,
      reviewed_by: profile?.id,
      reviewer_email: profile?.email,
      review_note: note || "",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .select()
    .single();
  return { data, error };
}

export async function fetchExportAuditLog({ limit: lim = 100 } = {}) {
  const { data, error } = await supabase
    .from("export_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(lim);
  return { entries: data || [], error };
}

export async function logExportEvent({
  datasetKey,
  format,
  rowCount,
  fileSizeBytes,
  ipAddress,
  userAgent,
  action,
  blockReason,
  requestId,
  durationMs,
}) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, email")
    .eq("auth_id", (await supabase.auth.getUser()).data.user?.id)
    .single();
  if (!profile) return { error: { message: "User profile not found" } };
  const { error } = await supabase.from("export_audit_log").insert({
    org_id: ORG_ID,
    user_id: profile.id,
    user_email: profile.email,
    dataset_key: datasetKey,
    format: format || "csv",
    row_count: rowCount || null,
    file_size_bytes: fileSizeBytes || null,
    ip_address: ipAddress || null,
    user_agent: userAgent || navigator.userAgent || null,
    action: action || "completed",
    block_reason: blockReason || null,
    request_id: requestId || null,
    duration_ms: durationMs || null,
  });
  return { error };
}

export async function fetchDropboxListing(parentPath = "") {
  const normalized =
    !parentPath || parentPath === "/"
      ? ""
      : parentPath.replace(/\/+$/, "").toLowerCase();

  const { data, error } = await supabase
    .from("dropbox_files")
    .select(
      "id,dropbox_file_id,path_display,path_lower,name,kind,size_bytes,server_modified,client_modified,is_downloadable,rev",
    )
    .eq("parent_path_lower", normalized)
    .order("name", { ascending: true })
    .limit(5000);
  if (error) {
    console.error("fetchDropboxListing error:", error);
    return [];
  }

  const items = (data || []).slice();
  items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "", undefined, {
      sensitivity: "base",
    });
  });
  return items;
}

export async function searchDropboxFiles(query, limit = 200) {
  const q = (query || "").trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("dropbox_files")
    .select(
      "id,dropbox_file_id,path_display,path_lower,name,kind,size_bytes,server_modified,is_downloadable,rev",
    )
    .or(`name.ilike.%${q}%,path_display.ilike.%${q}%`)
    .order("kind", { ascending: true })
    .order("path_display", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("searchDropboxFiles error:", error);
    return [];
  }
  return data || [];
}

export async function fetchDropboxSummary() {
  const [summaryRes, acctRes] = await Promise.all([
    supabase.rpc("get_dropbox_storage_summary"),
    supabase
      .from("org_dropbox_accounts")
      .select("email,display_name,last_synced_at,status,sync_cursor_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (summaryRes.error)
    console.error("fetchDropboxSummary summary:", summaryRes.error);
  if (acctRes.error) console.error("fetchDropboxSummary acct:", acctRes.error);

  const row =
    (Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data) ||
    null;

  return {
    fileCount: Number(row?.file_count) || 0,
    folderCount: Number(row?.folder_count) || 0,
    totalBytes: Number(row?.total_bytes) || 0,
    sizedFileCount: Number(row?.sized_file_count) || 0,
    account: acctRes.data || null,
    error: summaryRes.error || null,
  };
}

export async function drainDropbox(connectorId) {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch("/.netlify/functions/dropbox-drain-background", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connector_id: connectorId }),
  });
  if (res.status === 202) return { ok: true, accepted: true };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function getDropboxTempLink(dropboxFileId) {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch("/.netlify/functions/dropbox-download-link", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dropbox_file_id: dropboxFileId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.link;
}

export async function loadLatestBudgetParityRun() {
  const { data, error } = await supabase
    .from("budget_parity_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadBudgetParityCellDiffs(
  runId,
  { limit = 100, offset = 0 } = {},
) {
  const { data, error } = await supabase
    .from("budget_parity_cell_diffs")
    .select("*")
    .eq("run_id", runId)
    .order("status", { ascending: true })
    .order("property_code", { ascending: true })
    .order("account_number", { ascending: true })
    .order("month_index", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data || [];
}

export async function fetchBudgetPropertyCodes() {
  const { data, error } = await supabase
    .schema("raw")
    .from("budget_workbook_file_registry")
    .select("property_code");
  if (error) {
    console.error("fetchBudgetPropertyCodes error:", error);
    return { data: [], error };
  }
  const set = new Set();
  for (const r of data || []) {
    const code = (
      r.property_code == null ? "" : String(r.property_code)
    ).trim();
    if (code) set.add(code);
  }
  return { data: [...set].sort(), error: null };
}

export async function fetchOrgPropertyCount() {
  const { count, error } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.error("fetchOrgPropertyCount error:", error);
    return { data: null, error };
  }
  return { data: Number.isFinite(count) ? count : null, error: null };
}

export async function fetchPropertyCodeByName(propertyName) {
  if (!propertyName) return { data: null, error: null };
  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id")
    .eq("name", propertyName)
    .maybeSingle();
  if (propErr) {
    console.error("fetchPropertyCodeByName step 1 error:", propErr);
    return { data: null, error: propErr };
  }
  if (!prop?.id) return { data: null, error: null };
  const { data: mapping, error: mapErr } = await supabase
    .from("budget_property_code_map")
    .select("property_code")
    .eq("property_id", prop.id)
    .maybeSingle();
  if (mapErr) {
    console.error("fetchPropertyCodeByName step 2 error:", mapErr);
    return { data: null, error: mapErr };
  }
  return { data: mapping?.property_code || null, error: null };
}

export async function fetchBudgetWorkbookSubstrate(propertyCode) {
  if (!propertyCode) return { data: { files: [] }, error: null };
  const { data: rows, error } = await supabase
    .schema("raw")
    .from("budget_workbook_file_registry")
    .select(
      "id, display_name, source_path, workbook_version, last_parsed_at, last_parse_status, last_parse_error",
    )
    .eq("property_code", propertyCode)
    .order("last_parsed_at", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("fetchBudgetWorkbookSubstrate error:", error);
    return { data: { files: [] }, error };
  }
  const files = [];
  for (const r of rows || []) {
    const { count, error: countErr } = await supabase
      .schema("raw")
      .from("itemized")
      .select("id", { count: "exact", head: true })
      .eq("property_code", propertyCode)
      .eq("source_file_id", r.id);
    if (countErr) {
      console.error("fetchBudgetWorkbookSubstrate line-count error:", countErr);
      return { data: { files: [] }, error: countErr };
    }
    files.push({
      id: r.id,
      displayName: r.display_name || null,
      sourcePath: r.source_path || null,
      workbookVersion: r.workbook_version || null,
      lastParsedAt: r.last_parsed_at || null,
      lastParseStatus: r.last_parse_status || null,
      lastParseError: r.last_parse_error || null,
      lineCount: Number.isFinite(count) ? count : 0,
    });
  }
  return { data: { files }, error: null };
}

export async function fetchItemizedLines({ propertyCode, category } = {}) {
  if (!propertyCode || !category) return { data: [], error: null };
  const { data, error } = await supabase
    .schema("raw")
    .from("itemized")
    .select(
      "id, property_code, category, line_description, data_source, reference, frequency, first_month, amount, last_month, adjustments, function_2, growth, active_beds_pct, category_label, account_number, noi_build_bucket, increase_frequency, increase_interval_months, origin, source_file_id, source_row_index, created_at, updated_at, created_by, updated_by, ingested_at",
    )
    .eq("property_code", propertyCode)
    .eq("category", category)
    .order("source_row_index", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("fetchItemizedLines error:", error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

export async function fetchItemizedLinesByAccount({
  propertyCode,
  accountNumber,
} = {}) {
  const acct = accountNumber == null ? "" : String(accountNumber).trim();
  if (!propertyCode || !acct) return { data: [], error: null };
  const { data, error } = await supabase
    .schema("raw")
    .from("itemized")
    .select(
      "id, property_code, category, line_description, data_source, reference, frequency, first_month, amount, last_month, adjustments, function_2, growth, active_beds_pct, category_label, account_number, noi_build_bucket, increase_frequency, increase_interval_months, origin, source_file_id, source_row_index, created_at, updated_at, created_by, updated_by, ingested_at",
    )
    .eq("property_code", propertyCode)
    .eq("account_number", acct)
    .order("source_row_index", { ascending: true, nullsFirst: false })
    .order("first_month", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("fetchItemizedLinesByAccount error:", error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

export async function fetchItemizedLineHistory(itemizedId) {
  if (!itemizedId) return { data: [], error: null };
  const { data, error } = await supabase
    .schema("raw")
    .from("itemized_versions")
    .select(
      "id, itemized_id, change_kind, changed_by, changed_at, row_snapshot, prev_snapshot, note",
    )
    .eq("itemized_id", itemizedId)
    .order("changed_at", { ascending: false });
  if (error) {
    console.error("fetchItemizedLineHistory error:", error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

export const ITEMIZED_ACCOUNT_VERSIONS_LIMIT = 2000;
export async function fetchItemizedAccountVersions({
  propertyCode,
  accountNumber,
} = {}) {
  const acct = accountNumber == null ? "" : String(accountNumber).trim();
  if (!propertyCode || !acct) return { versions: [], authors: {}, error: null };
  const { data, error } = await supabase
    .schema("raw")
    .from("itemized_versions")
    .select(
      "id, itemized_id, change_kind, changed_by, changed_at, row_snapshot, prev_snapshot, note",
    )
    .eq("property_code", propertyCode)
    .eq("row_snapshot->>account_number", acct)
    .not("changed_by", "is", null)
    .order("changed_at", { ascending: false })
    .limit(ITEMIZED_ACCOUNT_VERSIONS_LIMIT);
  if (error) {
    console.error("fetchItemizedAccountVersions error:", error);
    return { versions: [], authors: {}, error };
  }
  const versions = Array.isArray(data) ? data : [];
  const actorIds = new Set();
  for (const v of versions)
    if (v && v.changed_by) actorIds.add(String(v.changed_by));
  const authors = {};
  if (actorIds.size > 0) {
    const { data: people, error: perr } = await supabase
      .from("user_profiles")
      .select("auth_id, display_name")
      .in("auth_id", [...actorIds]);
    if (perr) {
      console.error(
        'fetchItemizedAccountVersions: author lookup failed; marks show "Unidentified user"',
        perr,
      );
    } else {
      for (const u of Array.isArray(people) ? people : []) {
        const name = (u && u.display_name ? String(u.display_name) : "").trim();
        if (u && u.auth_id && name) authors[String(u.auth_id)] = name;
      }
    }
  }
  return { versions, authors, error: null };
}

export async function restoreItemizedVersion(versionId) {
  if (!versionId)
    return { data: null, error: { message: "A version id is required." } };
  const { data, error } = await supabase.rpc("restore_itemized_version", {
    p_version_id: versionId,
  });
  if (error) {
    console.error("restoreItemizedVersion error:", error);
    return { data: null, error };
  }
  return { data, error: null };
}

export async function fetchPropertyCoaAccounts(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase
    .schema("raw")
    .from("account_groups")
    .select("account_number, account_name")
    .eq("property_code", propertyCode);
  if (error) {
    console.error("fetchPropertyCoaAccounts error:", error);
    return { data: [], error };
  }
  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    const num = (
      r.account_number == null ? "" : String(r.account_number)
    ).trim();
    if (!num || seen.has(num)) continue;
    seen.add(num);
    out.push({ account_number: num, account_name: r.account_name || "" });
  }
  return { data: out, error: null };
}

const ITEMIZED_INSERT_CHUNK = 300;

async function callItemizedCrud(payload) {
  const token = await getCurrentAccessToken();
  if (!token) return { data: null, error: { message: "Not authenticated" } };
  let res;
  try {
    res = await fetch("/.netlify/functions/budget-itemized-crud", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return {
      data: null,
      error: {
        message: e?.message || "Network error reaching the editor service",
      },
    };
  }
  let body = {};
  try {
    body = await res.json();
  } catch {}
  if (!res.ok || body?.ok !== true) {
    return {
      data: null,
      error: { message: body?.error || `Request failed (HTTP ${res.status})` },
    };
  }
  return { data: body, error: null };
}

export async function insertItemizedLines({
  propertyCode,
  category,
  rows,
  note,
} = {}) {
  const all = Array.isArray(rows) ? rows : [];
  if (all.length === 0) return { data: [], error: null };
  const inserted = [];
  for (let i = 0; i < all.length; i += ITEMIZED_INSERT_CHUNK) {
    const chunk = all.slice(i, i + ITEMIZED_INSERT_CHUNK);
    const { data, error } = await callItemizedCrud({
      op: "insert",
      property_code: propertyCode,
      category,
      rows: chunk,
      ...(note === undefined ? {} : { note }),
    });
    if (error) {
      return {
        data: inserted,
        error: {
          ...error,
          insertedCount: inserted.length,
          totalCount: all.length,
        },
      };
    }
    inserted.push(...((data && data.rows) || []));
  }
  return { data: inserted, error: null };
}

export async function updateItemizedLine(id, patch) {
  const { data, error } = await callItemizedCrud({ op: "update", id, patch });
  if (error) return { data: null, error };
  return { data: (data && data.rows && data.rows[0]) || null, error: null };
}

export async function updateItemizedLinesBulk(ids, patch, note) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (list.length === 0) {
    return { data: null, error: { message: "No lines selected" } };
  }
  const { data, error } = await callItemizedCrud({
    op: "update_many",
    ids: list,
    patch,
    ...(note === undefined ? {} : { note }),
  });
  if (error) return { data: null, error };
  return {
    data: {
      requested: data?.requested ?? list.length,
      updated: data?.updated ?? 0,
      rows: Array.isArray(data?.rows) ? data.rows : [],
    },
    error: null,
  };
}

export async function applyItemizedNumericBulk(field, changes, note) {
  const list = Array.isArray(changes) ? changes.filter((c) => c && c.id) : [];
  if (list.length === 0) {
    return { data: null, error: { message: "No lines to apply" } };
  }
  const { data, error } = await callItemizedCrud({
    op: "apply_numeric_bulk",
    field,
    changes: list,
    ...(note === undefined ? {} : { note }),
  });
  if (error) return { data: null, error };
  return {
    data: {
      requested: data?.requested ?? list.length,
      updated: data?.updated ?? 0,
      unchanged: data?.unchanged ?? 0,
      skipped: data?.skipped ?? 0,
      missing: data?.missing ?? 0,
    },
    error: null,
  };
}

export async function deleteItemizedLine(id, note) {
  const { data, error } = await callItemizedCrud({
    op: "delete",
    id,
    ...(note === undefined ? {} : { note }),
  });
  if (error) return { data: null, error };
  return { data: { id }, error: null };
}

function isStatementTimeout(error) {
  if (!error) return false;
  return (
    String(error.code || "").includes("57014") ||
    /statement timeout|canceling statement/i.test(error.message || "")
  );
}

export async function fetchBudgetCoaMonthly(propertyCode, options = {}) {
  if (!propertyCode) return { data: [], error: null };
  const params = { p_property_code: propertyCode };
  if (options.forwardOnly) params.p_forward_only = true;
  if (options.bypassCache) params.p_bypass_cache = true;
  let res = await supabase.rpc("get_budget_coa_monthly", params);
  if (res.error && isStatementTimeout(res.error)) {
    await new Promise((r) => setTimeout(r, 500));
    res = await supabase.rpc("get_budget_coa_monthly", params);
  }
  const { data, error } = res;
  if (error) {
    console.error("fetchBudgetCoaMonthly error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

let noiExcludedAccountsPromise = null;
export async function fetchNoiExcludedAccounts() {
  if (!noiExcludedAccountsPromise) {
    noiExcludedAccountsPromise = supabase
      .from("noi_excluded_account")
      .select("account_number, reason, decided_by, decided_on")
      .then(({ data, error }) => {
        if (error) {
          console.error("fetchNoiExcludedAccounts error:", error);
          noiExcludedAccountsPromise = null;
          return { data: [], error };
        }
        return { data: Array.isArray(data) ? data : [], error: null };
      });
  }
  return noiExcludedAccountsPromise;
}

export async function fetchBudgetItemizedMonthly(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const params = { p_property_code: propertyCode };
  let res = await supabase.rpc("get_budget_itemized_monthly", params);
  if (res.error && isStatementTimeout(res.error)) {
    await new Promise((r) => setTimeout(r, 500));
    res = await supabase.rpc("get_budget_itemized_monthly", params);
  }
  const { data, error } = res;
  if (error) {
    console.error("fetchBudgetItemizedMonthly error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetNoiBuild(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_budget_noi_build", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchBudgetNoiBuild error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetProformaDebtService(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc(
    "get_budget_proforma_debt_service",
    {
      p_property_code: propertyCode,
    },
  );
  if (error) {
    console.error("fetchBudgetProformaDebtService error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchActualLoanPrincipalActivity(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc(
    "get_actual_loan_principal_activity",
    {
      p_property_code: propertyCode,
    },
  );
  if (error) {
    console.error("fetchActualLoanPrincipalActivity error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetProformaDebtMetrics(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc(
    "get_budget_proforma_debt_metrics",
    {
      p_property_code: propertyCode,
    },
  );
  if (error) {
    console.error("fetchBudgetProformaDebtMetrics error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetRunningBalances(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_budget_running_balances", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchBudgetRunningBalances error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchPortfolioBudgetCoaMonthly() {
  const { data, error } = await supabase.rpc(
    "get_portfolio_budget_coa_monthly",
  );
  if (error) {
    console.error("fetchPortfolioBudgetCoaMonthly error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchPortfolioBudgetNoiBuild() {
  const { data, error } = await supabase.rpc("get_portfolio_budget_noi_build");
  if (error) {
    console.error("fetchPortfolioBudgetNoiBuild error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchPortfolioBudgetRunningBalances() {
  const { data, error } = await supabase.rpc(
    "get_portfolio_budget_running_balances",
  );
  if (error) {
    console.error("fetchPortfolioBudgetRunningBalances error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetBaselines(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_budget_baselines", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchBudgetBaselines error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetVariance(propertyCode, baseline = null) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_budget_variance", {
    p_property_code: propertyCode,
    ...baselineRpcArgs(baseline),
  });
  if (error) {
    console.error("fetchBudgetVariance error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetVariancePairing(
  propertyCode,
  baselineSide,
  compareSide,
) {
  const baselineType = Number(baselineSide?.budgetStatusTypeId);
  const baselineYear = Number(baselineSide?.fiscalYear);
  const compareType = Number(compareSide?.budgetStatusTypeId);
  const compareYear = Number(compareSide?.fiscalYear);
  if (
    !propertyCode ||
    baselineSide?.kind !== "sealed_budget" ||
    compareSide?.kind !== "sealed_budget" ||
    !Number.isInteger(baselineType) ||
    !Number.isInteger(baselineYear) ||
    !Number.isInteger(compareType) ||
    !Number.isInteger(compareYear)
  ) {
    return { data: [], error: null };
  }
  const { data, error } = await supabase.rpc(
    "get_budget_variance_between_baselines",
    {
      p_property_code: propertyCode,
      p_baseline_status_type_id: baselineType,
      p_baseline_fiscal_year: baselineYear,
      p_compare_status_type_id: compareType,
      p_compare_fiscal_year: compareYear,
    },
  );
  if (error) {
    console.error("fetchBudgetVariancePairing error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchUwLineVariance(propertyCode, other) {
  const kind = other?.kind;
  if (!propertyCode || (kind !== "actuals" && kind !== "budget")) {
    return { data: [], error: null };
  }
  const type = Number(other?.budgetStatusTypeId);
  const year = Number(other?.fiscalYear);
  if (
    kind === "budget" &&
    !(Number.isInteger(type) && Number.isInteger(year))
  ) {
    return { data: [], error: null };
  }
  const { data, error } = await supabase.rpc("get_uw_line_variance", {
    p_property_code: propertyCode,
    p_other_side: kind,
    p_budget_status_type_id: kind === "budget" ? type : null,
    p_fiscal_year: kind === "budget" ? year : null,
  });
  if (error) {
    console.error("fetchUwLineVariance error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchUwLineReconciliation(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_uw_line_reconciliation", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchUwLineReconciliation error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBudgetNoiVariance(propertyCode, baseline = null) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_budget_noi_variance", {
    p_property_code: propertyCode,
    ...baselineRpcArgs(baseline),
  });
  if (error) {
    console.error("fetchBudgetNoiVariance error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchNoiBuildTemplate() {
  const [lines, categories] = await Promise.all([
    supabase
      .from("noi_line_template")
      .select(
        "line_id, display_order, line_label, parent_group_label, line_type, noi_category, aggregation_categories, placeholder_tooltip, indent_level",
      )
      .order("display_order", { ascending: true }),
    supabase
      .from("noi_build_categories")
      .select("bucket_name, section, display_order"),
  ]);
  const error = lines.error || categories.error;
  if (error) {
    console.error("fetchNoiBuildTemplate error:", error);
    return { data: null, error };
  }
  return {
    data: {
      lines: Array.isArray(lines.data) ? lines.data : [],
      categories: Array.isArray(categories.data) ? categories.data : [],
    },
    error: null,
  };
}

export async function fetchBudgetActualsThrough(propertyCode) {
  if (!propertyCode) return { data: null, error: null };
  const { data, error } = await supabase
    .from("stg_budget_gl_actual")
    .select("month_end")
    .eq("property_code", propertyCode)
    .order("month_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("fetchBudgetActualsThrough error:", error);
    return { data: null, error };
  }
  return { data: data?.month_end || null, error: null };
}

export async function fetchVarianceAlertLastEvaluated() {
  try {
    const { data, error } = await supabase
      .from("variance_alert_state")
      .select("last_evaluated_at")
      .order("last_evaluated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.last_evaluated_at || null;
  } catch (e) {
    console.warn(
      "[Supabase] fetchVarianceAlertLastEvaluated failed:",
      e.message,
    );
    return null;
  }
}

export async function fetchAccountGlDetail(
  propertyCode,
  accountNumber,
  monthEnd,
) {
  if (!propertyCode || !accountNumber || !monthEnd)
    return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_account_gl_detail", {
    p_property_code: propertyCode,
    p_account_number: accountNumber,
    p_month_end: monthEnd,
  });
  if (error) {
    console.error("fetchAccountGlDetail error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchInprogressMonthEstimate(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_inprogress_month_estimate", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchInprogressMonthEstimate error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchEntrataBudgetWritebackHistory(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase
    .from("connector_sync_runs")
    .select(
      "id, started_at, completed_at, direction, resource_type, rows_read, rows_written, status, error_message, triggered_by, payload",
    )
    .eq("resource_type", "budget_writeback")
    .eq("direction", "out")
    .filter("payload->>property_code", "eq", String(propertyCode))
    .order("started_at", { ascending: false })
    .limit(25);
  if (error) {
    console.error("fetchEntrataBudgetWritebackHistory error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchNoiLineCalcChain(
  propertyCode,
  lineId,
  period = null,
  baseline = null,
) {
  if (!propertyCode || lineId == null) return { data: [], error: null };
  const windowed = isMonthKey(period?.start) && isMonthKey(period?.end);
  const { data, error } = await supabase.rpc("get_noi_line_calc_chain", {
    p_property_code: propertyCode,
    p_line_id: lineId,
    ...baselineRpcArgs(baseline),
    ...(windowed
      ? {
          p_period_start: monthStartIso(period.start),
          p_period_end: monthEndIso(period.end),
        }
      : {}),
  });
  if (error) {
    console.error("fetchNoiLineCalcChain error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchPyVariance(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_py_variance", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchPyVariance error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchPyNoiVariance(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_py_noi_variance", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchPyNoiVariance error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchUwVariance(propertyCode) {
  if (!propertyCode) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_uw_variance", {
    p_property_code: propertyCode,
  });
  if (error) {
    console.error("fetchUwVariance error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}
