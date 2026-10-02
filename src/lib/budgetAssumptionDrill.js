import { getCurrentAccessToken } from "./supabaseClient.js";
import {
  fetchAssumptionExplanations,
  explanationForLine,
  fiscalYearLabelForMonth,
} from "./budgetAssumptionExplanations.js";
import { SEALED_BUDGET } from "./varianceSides.js";

export const ASSUMPTION_ANALYSIS_ENDPOINT =
  "/.netlify/functions/budget-assumption-analysis";
export const ASSUMPTION_ANALYSIS_TIMEOUT_MS = 25_000;
export const ASSUMPTION_ANALYSIS_WARM_TTL_MS = 4 * 60_000;

export const ASSUMPTION_READ_ROLES = Object.freeze([
  "admin",
  "gp",
  "gp_admin",
  "am",
]);

export function canReadBudgetAssumptions({ role, isAdmin } = {}) {
  return (
    isAdmin === true ||
    ASSUMPTION_READ_ROLES.includes(String(role || "").toLowerCase())
  );
}

export function assumptionFiscalYearLabel(baselineSide) {
  if (!baselineSide || baselineSide.kind !== SEALED_BUDGET) return null;
  const fromMonth = fiscalYearLabelForMonth(baselineSide.monthEndMin);
  if (fromMonth) return fromMonth;
  const fy = Number(baselineSide.fiscalYear);
  return Number.isInteger(fy) ? `${fy}-${fy + 1}` : null;
}

export const ANALYSIS_MODE_BUDGET = "budget";
export const ANALYSIS_MODE_VARIANCE = "variance";
export const ANALYSIS_MODE_GROUP = "group";

function monthsForAccountField(rows, accountNumbers, field) {
  const accounts =
    accountNumbers instanceof Set
      ? new Set(
          [...accountNumbers]
            .map((account) => String(account ?? "").trim())
            .filter(Boolean),
        )
      : new Set([String(accountNumbers ?? "").trim()].filter(Boolean));
  if (!accounts.size) return [];
  const byMonth = new Map();
  for (const r of rows || []) {
    if (!accounts.has(String(r.account_number ?? "").trim())) continue;
    const month = String(r.month_end || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (r[field] === null || r[field] === undefined) continue;
    const amount = Number(r[field]);
    if (!Number.isFinite(amount)) continue;
    byMonth.set(month, (byMonth.get(month) || 0) + amount);
  }
  return [...byMonth.entries()]
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

export function budgetMonthsForAccount(rows, accountNumber) {
  return monthsForAccountField(rows, accountNumber, "budget_amount");
}

export function actualMonthsForAccount(rows, accountNumber) {
  return monthsForAccountField(rows, accountNumber, "actual_amount");
}

export function budgetMonthsForAccounts(rows, accountNumbers) {
  return monthsForAccountField(
    rows,
    new Set(accountNumbers || []),
    "budget_amount",
  );
}

export function actualMonthsForAccounts(rows, accountNumbers) {
  return monthsForAccountField(
    rows,
    new Set(accountNumbers || []),
    "actual_amount",
  );
}

export function fiscalYearBudgetMonths(rows, accountNumber, fiscalYear) {
  const months = budgetMonthsForAccount(rows, accountNumber);
  if (!fiscalYear) return months;
  return months.filter(
    ({ month }) => fiscalYearLabelForMonth(month) === fiscalYear,
  );
}

export const RECORD_SCOPE_BASELINE = "baseline";
export const RECORD_SCOPE_UNSCOPED = "unscoped";
export const RECORD_SCOPE_ANY = "any";

export function recordBaselineScope(record, budgetStatusTypeId) {
  if (!record) return null;
  const wanted = Number(budgetStatusTypeId);
  if (!Number.isInteger(wanted) || wanted <= 0) return RECORD_SCOPE_ANY;
  const stamped = record.budget_status_type_id;
  if (stamped === null || stamped === undefined) return RECORD_SCOPE_UNSCOPED;
  return Number(stamped) === wanted
    ? RECORD_SCOPE_BASELINE
    : RECORD_SCOPE_UNSCOPED;
}

export async function loadStoredAssumption(
  { propertyCode, accountNumber, fiscalYear, budgetStatusTypeId = null },
  deps = {},
) {
  const fetchImpl =
    deps.fetchAssumptionExplanations || fetchAssumptionExplanations;
  const { data, error } = await fetchImpl(propertyCode, {
    fiscalYear,
    accountNumber,
    budgetStatusTypeId,
  });
  if (error) return { record: null, scope: null, error };
  const wanted = Number(budgetStatusTypeId);
  const scoped = Number.isInteger(wanted) && wanted > 0;
  const own = scoped
    ? (data || []).filter((r) => Number(r.budget_status_type_id) === wanted)
    : [];
  const pool = own.length > 0 ? own : data || [];
  const firstMonth = fiscalYear ? `${fiscalYear.slice(0, 4)}-08-01` : null;
  const { record } = explanationForLine(pool, {
    account_number: accountNumber,
    first_month: firstMonth,
  });
  return {
    record,
    scope: recordBaselineScope(record, budgetStatusTypeId),
    error: null,
  };
}

let warmState = { at: 0, promise: null };

export function resetAnalysisWarmState() {
  warmState = { at: 0, promise: null };
}

export function warmBudgetAssumptionAnalysis(deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now ? deps.now() : Date.now();
  const ttl = deps.ttlMs ?? ASSUMPTION_ANALYSIS_WARM_TTL_MS;
  if (warmState.promise && now - warmState.at < ttl) return warmState.promise;
  const promise = Promise.resolve()
    .then(() =>
      fetchImpl(ASSUMPTION_ANALYSIS_ENDPOINT, {
        method: "OPTIONS",
        keepalive: true,
      }),
    )
    .then(() => true)
    .catch(() => false);
  warmState = { at: now, promise };
  return promise;
}

export const analysisRetryStats = {
  requests: 0,
  retried: 0,
  retrySucceeded: 0,
  failed: 0,
};
if (typeof window !== "undefined")
  window.__budgetAssumptionAnalysisStats = analysisRetryStats;

export async function requestBudgetAssumptionAnalysis(packet, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const getToken = deps.getToken || getCurrentAccessToken;
  const timeoutMs = deps.timeoutMs ?? ASSUMPTION_ANALYSIS_TIMEOUT_MS;
  const token = await getToken();
  if (!token)
    return { data: null, error: "Sign in again to request an analysis." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetchImpl(ASSUMPTION_ANALYSIS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(packet),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    if (!res.ok) {
      console.error(
        "[budget-assumption-analysis] non-200:",
        res.status,
        "after",
        elapsedMs,
        "ms",
      );
      return {
        data: null,
        error: analysisErrorMessage(res.status),
        retryable: isRetryableAnalysisStatus(res.status),
        elapsedMs,
      };
    }
    const json = await res.json();
    if (!json || !json.analysis)
      return {
        data: null,
        error: "The analysis came back empty.",
        retryable: true,
        elapsedMs,
      };
    return { data: json, error: null, elapsedMs };
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    const timedOut = e && e.name === "AbortError";
    console.error(
      "[budget-assumption-analysis] request failed:",
      timedOut ? "timeout" : e?.message,
      "after",
      elapsedMs,
      "ms",
    );
    return {
      data: null,
      error: timedOut
        ? "The analysis took too long and was stopped."
        : "The analysis could not be reached.",
      retryable: true,
      elapsedMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isRetryableAnalysisStatus(status) {
  return Number.isInteger(status) && status >= 500;
}

export async function requestBudgetAssumptionAnalysisWithRetry(
  packet,
  deps = {},
) {
  const {
    onRetry,
    request = requestBudgetAssumptionAnalysis,
    stats = analysisRetryStats,
    ...rest
  } = deps;
  stats.requests += 1;
  const first = await request(packet, rest);
  if (!first.error || !first.retryable) {
    if (first.error) stats.failed += 1;
    return first;
  }
  stats.retried += 1;
  console.warn(
    "[budget-assumption-analysis] silent retry after",
    first.elapsedMs ?? "?",
    "ms:",
    first.error,
    `(retried ${stats.retried}/${stats.requests})`,
  );
  if (typeof onRetry === "function") onRetry(first);
  const second = await request(packet, rest);
  if (second.error) stats.failed += 1;
  else stats.retrySucceeded += 1;
  return { ...second, retried: true };
}

export function analysisErrorMessage(status) {
  if (status === 401) return "Sign in again to request an analysis.";
  if (status === 403) return "Your role cannot request a budget analysis.";
  if (status === 429)
    return "Too many analyses requested — try again in a minute.";
  if (status === 504) return "The analysis took too long and was stopped.";
  return "The analysis service is unavailable right now.";
}

export function resolveAssumptionPresentation({
  loading,
  analysis,
  analysisError,
  record,
  recordError,
}) {
  if (analysis || record) return "content";
  if (loading) return "loading";
  if (analysisError || recordError) return "error";
  return "none";
}
