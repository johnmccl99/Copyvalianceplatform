import { supabase } from "./supabaseClient.js";

const ENDPOINT = "/.netlify/functions/entrata-budget-writeback";

async function getBearer() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || "";
  } catch {
    return "";
  }
}

export async function postEntrataBudgetWriteback({
  propertyCode,
  fiscalYears,
  mode = "dry_run",
  includePriorMonths = false,
} = {}) {
  if (!propertyCode || typeof propertyCode !== "string") {
    return { error: "propertyCode is required." };
  }
  if (
    !Array.isArray(fiscalYears) ||
    fiscalYears.length === 0 ||
    !fiscalYears.every((n) => Number.isFinite(n))
  ) {
    return { error: "fiscalYears must be a non-empty array of numbers." };
  }
  const bearer = await getBearer();
  if (!bearer) return { error: "Not signed in." };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        property_code: propertyCode,
        fiscal_years: fiscalYears,
        mode,
        include_prior_months: includePriorMonths === true,
      }),
    });
  } catch (e) {
    return { error: `Network error: ${e?.message || String(e)}` };
  }

  let json = null;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    return {
      error: `Server returned non-JSON response (status ${res.status}).`,
    };
  }

  if (!res.ok && !(json && Array.isArray(json.results))) {
    return {
      error: (json && json.error) || `Server returned status ${res.status}.`,
      ambiguousCandidates: json && json.ambiguousCandidates,
    };
  }

  const rawResults = json && Array.isArray(json.results) ? json.results : [];
  return {
    mode: json && json.mode,
    overall:
      (json && json.overall) || (rawResults.length ? undefined : "all_error"),
    includePriorMonths: !!(json && json.include_prior_months),
    priorMonthCells: (json && Number(json.prior_month_cells)) || 0,
    priorMonthsWarning: (json && json.prior_months_warning) || null,
    results: rawResults.map((r) => ({
      fiscalYear: r && r.fiscal_year,
      budgetYear: r && r.budget_year,
      budgetId: r && r.budget_id,
      budgetName: (r && r.budget_name) || null,
      status: r && r.status,
      entrataStatus: r && r.entrata_status != null ? r.entrata_status : null,
      entrataApplied: r && r.entrata_applied != null ? r.entrata_applied : null,
      entrataBudgetResults:
        r && Array.isArray(r.entrata_budget_results)
          ? r.entrata_budget_results
          : null,
      syncRunId: r && r.sync_run_id,
      error: r && r.error,
      reasonCode: (r && r.reason_code) || null,
      summary: r && r.summary,
      accountsDroppedUnresolved: (r && r.accounts_dropped_unresolved) || [],
    })),
  };
}

export async function resolveEntrataBudgetTargets({
  propertyCode,
  fiscalYears,
} = {}) {
  if (!propertyCode || typeof propertyCode !== "string") {
    return { error: "propertyCode is required." };
  }
  if (
    !Array.isArray(fiscalYears) ||
    fiscalYears.length === 0 ||
    !fiscalYears.every((n) => Number.isFinite(n))
  ) {
    return { error: "fiscalYears must be a non-empty array of numbers." };
  }
  const bearer = await getBearer();
  if (!bearer) return { error: "Not signed in." };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        property_code: propertyCode,
        fiscal_years: fiscalYears,
        mode: "resolve",
      }),
    });
  } catch (e) {
    return { error: `Network error: ${e?.message || String(e)}` };
  }

  let json = null;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    return {
      error: `Server returned non-JSON response (status ${res.status}).`,
    };
  }
  if (!res.ok || !(json && Array.isArray(json.resolved))) {
    return {
      error: (json && json.error) || `Server returned status ${res.status}.`,
    };
  }
  return {
    resolved: json.resolved.map((r) => ({
      fiscalYear: r && r.fiscal_year,
      budgetYear: r && r.budget_year,
      budgetId: (r && r.budget_id) || null,
      budgetName: (r && r.budget_name) || null,
      budgetStatusTypeId: (r && r.budget_status_type_id) || null,
      error: (r && r.error) || null,
      reasonCode: (r && r.reason_code) || null,
    })),
  };
}
