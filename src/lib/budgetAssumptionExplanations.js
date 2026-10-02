import { supabase } from "./supabaseClient.js";

export async function fetchAssumptionExplanations(propertyCode, opts = {}) {
  const {
    fiscalYear = null,
    accountNumber = null,
    includeHistory = false,
    budgetStatusTypeId = null,
  } = opts;
  const bst = Number(budgetStatusTypeId);
  const { data, error } = await supabase.rpc(
    "get_budget_assumption_explanations",
    {
      p_property_code: propertyCode,
      p_fiscal_year: fiscalYear,
      p_account_number: accountNumber,
      p_include_history: includeHistory,
      ...(Number.isInteger(bst) && bst > 0
        ? { p_budget_status_type_id: bst }
        : {}),
    },
  );
  return {
    data: data || [],
    error: error ? error.message || String(error) : null,
  };
}

export async function recordAssumptionExplanations(records) {
  const { data, error } = await supabase.rpc(
    "record_budget_assumption_explanations",
    {
      p_records: records,
    },
  );
  return { data, error: error ? error.message || String(error) : null };
}

export async function fetchAssumptionEngineConfig() {
  const { data, error } = await supabase.rpc(
    "get_budget_assumption_engine_config",
  );
  return {
    data: data || null,
    error: error ? error.message || String(error) : null,
  };
}

export async function fetchAssumptionSemantics() {
  const { data, error } = await supabase
    .from("budget_assumption_semantics")
    .select("*");
  return {
    data: data || [],
    error: error ? error.message || String(error) : null,
  };
}

export async function fetchAssumptionGlSeries(propertyCode, accountNumber) {
  const { data, error } = await supabase
    .from("stg_budget_gl_actual")
    .select("month_end, amount")
    .eq("property_code", propertyCode)
    .eq("account_number", accountNumber)
    .order("month_end", { ascending: true });
  if (error) return { data: [], error: error.message || String(error) };
  const byMonth = new Map();
  for (const r of data || []) {
    const m = r.month_end;
    byMonth.set(m, (byMonth.get(m) || 0) + Number(r.amount || 0));
  }
  const series = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, amount]) => ({ month, amount }));
  return { data: series, error: null };
}

export function groupExplanationsByAccount(rows) {
  const byAccount = new Map();
  for (const r of rows || []) {
    const key = `${r.category}|${r.account_number}`;
    if (!byAccount.has(key)) {
      byAccount.set(key, {
        category: r.category,
        account_number: r.account_number,
        records: [],
      });
    }
    byAccount.get(key).records.push(r);
  }
  const groups = [...byAccount.values()];
  for (const g of groups) {
    g.records.sort((a, b) =>
      a.itemized_field === b.itemized_field
        ? String(b.created_at).localeCompare(String(a.created_at))
        : String(a.itemized_field).localeCompare(String(b.itemized_field)),
    );
  }
  groups.sort((a, b) =>
    a.category === b.category
      ? String(a.account_number).localeCompare(String(b.account_number))
      : String(a.category).localeCompare(String(b.category)),
  );
  return groups;
}

export const RULE_LABELS = Object.freeze({
  "R0-scope-gate": "R0 · scope gate",
  "R1-stable-run-rate": "R1 · stable run-rate",
  "R2-seasonal-level": "R2 · seasonal level",
  "R3-revenue-lm12": "R3 · revenue LM x 12",
  "R4-lumpy-salvage": "R4 · lumpy salvage",
  "R5-contract-verify": "R5 · contract verify",
  "R6-growth-verify": "R6 · growth verify",
  "R7-manual": "R7 · manual",
});

export const KIND_LABELS = Object.freeze({
  suggestion: "suggestion",
  verification: "verification",
  manual_note: "manual routing",
  override: "analyst note",
  acceptance: "accepted",
});

export function fiscalYearLabelForMonth(month) {
  if (!month) return null;
  const s = String(month);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12)
    return null;
  const start = m >= 8 ? y : y - 1;
  return `${start}-${start + 1}`;
}

export function explanationForLine(rows, line) {
  const lineFiscalYear = fiscalYearLabelForMonth(line && line.first_month);
  const acct = String((line && line.account_number) || "").trim();
  const cat = String((line && line.category) || "").trim();
  if (!acct)
    return { record: null, scope: "no_account", lineFiscalYear, alsoCount: 0 };

  const matches = (rows || []).filter(
    (r) =>
      String(r.account_number || "").trim() === acct &&
      (!cat || String(r.category || "").trim() === cat),
  );
  if (matches.length === 0) {
    return { record: null, scope: "none", lineFiscalYear, alsoCount: 0 };
  }

  const rank = (r) => [
    r.fiscal_year === lineFiscalYear ? 0 : 1,
    r.itemized_field === "amount" ? 0 : 1,
  ];
  const sorted = [...matches].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
  const record = sorted[0];
  return {
    record,
    scope:
      record.fiscal_year === lineFiscalYear
        ? "line_fiscal_year"
        : "other_fiscal_year",
    lineFiscalYear,
    alsoCount: matches.length - 1,
  };
}

export function summarizeExplanations(rows) {
  const s = {
    total: 0,
    by_confidence: { high: 0, medium: 0, low: 0, manual: 0 },
    by_kind: {},
    manual_review: 0,
    flagged_checks: 0,
  };
  for (const r of rows || []) {
    s.total += 1;
    if (s.by_confidence[r.confidence] !== undefined)
      s.by_confidence[r.confidence] += 1;
    s.by_kind[r.record_kind] = (s.by_kind[r.record_kind] || 0) + 1;
    if (r.confidence === "manual") s.manual_review += 1;
    const checks = (r.explanation && r.explanation.checks) || {};
    if (
      (checks.growth && checks.growth.flag) ||
      (checks.contract_rate && checks.contract_rate.flag)
    ) {
      s.flagged_checks += 1;
    }
  }
  return s;
}

export function suggestionAcceptability(record, itemizedRows) {
  if (!record || record.record_kind !== "suggestion") {
    return { ok: false, reason: "Only engine suggestions can be applied." };
  }
  if (record.itemized_field !== "amount") {
    return {
      ok: false,
      reason: "Only amount suggestions are direct-applyable in v1.",
    };
  }
  if (record.derived_value === null || record.derived_value === undefined) {
    return {
      ok: false,
      reason:
        "This record carries no derived value (verification or manual routing).",
    };
  }
  const rows = (itemizedRows || []).filter(
    (r) =>
      r.category === record.category &&
      String(r.account_number) === String(record.account_number),
  );
  if (rows.length === 0) {
    return {
      ok: false,
      reason:
        "No itemized lines exist for this account on the property — nothing to apply to.",
    };
  }
  const nonMonthly = rows.filter((r) => r.frequency !== "Monthly");
  if (nonMonthly.length > 0) {
    return {
      ok: false,
      reason: `The derived value is a monthly amount but ${nonMonthly.length} of ${rows.length} matched line(s) are not Monthly-strided — apply via Portfolio Assumptions where the field and value are explicit.`,
    };
  }
  return { ok: true, reason: null, matched_lines: rows.length };
}

export function buildAcceptChangeSet(record) {
  const value = Number(record.derived_value);
  return {
    name: `Accept ${record.rule_id} suggestion — ${record.category} ${record.account_number} (${record.property_code}, FY ${record.fiscal_year})`,
    changes: [
      {
        target: "itemized",
        category: record.category,
        match: { account_number: String(record.account_number) },
        field: "amount",
        new_value: Math.round(value * 100) / 100,
      },
    ],
  };
}

export function buildAcceptanceRecord(
  record,
  { applyId, approvalToken, rowsUpdated },
) {
  return {
    itemized_id: record.itemized_id || null,
    property_code: record.property_code,
    category: record.category,
    account_number: record.account_number,
    itemized_field: record.itemized_field,
    field_semantic: record.field_semantic || null,
    fiscal_year: record.fiscal_year,
    budget_status_type_id: record.budget_status_type_id ?? null,
    record_kind: "acceptance",
    rule_id: record.rule_id,
    assumption_class: record.assumption_class || null,
    derivability: record.derivability || null,
    workbook_source: record.workbook_source || null,
    confidence: record.confidence,
    derived_value: record.derived_value,
    explanation: {
      accepted_suggestion_id: record.id,
      apply_id: applyId || null,
      approval_token: approvalToken || null,
      rows_updated: rowsUpdated ?? null,
      applied_via: "assumption_propagation",
    },
    narrative: `Suggestion accepted and applied through the assumption-propagation flow (dry-run, token-gated apply). Derived value ${record.derived_value} from ${record.rule_id}; source suggestion ${record.id}.`,
  };
}

export function buildOverrideRecord(subject, rationale, latestRecord = null) {
  const clean = String(rationale || "").trim();
  return {
    itemized_id: (latestRecord && latestRecord.itemized_id) || null,
    property_code: subject.property_code,
    category: subject.category,
    account_number: subject.account_number,
    itemized_field: subject.itemized_field || "amount",
    field_semantic: (latestRecord && latestRecord.field_semantic) || null,
    fiscal_year: subject.fiscal_year,
    budget_status_type_id:
      subject.budget_status_type_id ??
      (latestRecord && latestRecord.budget_status_type_id) ??
      null,
    record_kind: "override",
    rule_id: (latestRecord && latestRecord.rule_id) || "R7-manual",
    assumption_class: (latestRecord && latestRecord.assumption_class) || null,
    derivability: "T-C",
    workbook_source: (latestRecord && latestRecord.workbook_source) || null,
    confidence: "manual",
    derived_value: null,
    explanation: {
      overrides_record_id: (latestRecord && latestRecord.id) || null,
      analyst_rationale: clean,
    },
    narrative: `Analyst note: ${clean}`,
  };
}
