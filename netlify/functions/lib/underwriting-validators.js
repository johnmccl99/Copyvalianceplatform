const MONEY_FIELDS = new Set([
  "purchase_price",
  "closing_costs",
  "closing_costs_total",
  "capex_budget",
  "capex_budget_total",
  "all_in_basis",
  "loan_proceeds",
  "senior_loan_amount",
  "senior_loan_amount_total",
  "bridge_loan_amount",
  "mezz_loan_amount",
  "construction_loan_amount",
  "equity_required",
  "equity_required_total",
  "total_lp_equity",
  "total_gp_equity",
  "follow_on_needed",
  "sale_price",
  "disposition_proceeds_gross",
  "disposition_proceeds_net",
  "terminal_noi",
  "gpr_annual",
  "net_potential_rent_annual",
  "opex_total",
  "opex_admin_ga",
  "opex_business_tax",
  "opex_insurance",
  "opex_property_tax",
  "opex_utilities",
  "opex_util_pge",
  "opex_util_water_sewer",
  "opex_util_trash",
  "opex_util_internet",
  "opex_salaries",
  "opex_marketing",
  "opex_repairs_maintenance_all",
  "opex_landscaping",
  "opex_janitorial",
  "opex_management_fee",
  "capex_appliances",
  "capex_building_systems",
  "capex_common_area",
  "capex_contingency",
  "capex_interior_renovation",
  "capex_mechanical_electrical_plumbing",
  "capex_soft_costs",
  "capex_windows",
  "closing_cost_acquisition_fee",
  "closing_cost_appraisal",
  "closing_cost_due_diligence",
  "closing_cost_escrow",
  "closing_cost_financing_fees",
  "closing_cost_legal",
  "closing_cost_lender_legal",
  "closing_cost_recording",
  "closing_cost_swap",
  "closing_cost_title",
  "closing_cost_transfer_tax",
  "interest_reserve",
  "cost_seg_total_basis",
  "gp_promote_earned",
  "debt_service_annual",
  "total_debt_amount",
  "outstanding_equity_post_refi",
  "vacancy_loss_annual",
  "other_income_total",
  "other_income_laundry",
  "other_income_parking",
  "other_income_rubs",
  "property_tax_assessed_value",
  "replacement_reserve",
  "replacements_reserves_at_exit",
  "ti_lc_reserve",
]);

const RATE_FIELDS = new Set([
  "rent_growth_pct",
  "expense_growth_pct",
  "tax_escalation_pct",
  "vacancy_pct",
  "preferred_return_pct",
  "transfer_tax_pct",
  "broker_commission_pct",
  "disposition_fee_pct",
  "lease_up_fee",
  "min_am_fee",
  "cumulative_am_pm_fee_pct",
  "construction_management_fee_pct",
  "senior_loan_rate_all_in",
  "senior_loan_ltv",
  "senior_loan_ltc",
  "senior_loan_origination_fee_pct",
  "senior_loan_exit_fee_pct",
  "bridge_loan_rate_all_in",
  "bridge_loan_ltv",
  "bridge_loan_ltc",
  "bridge_loan_exit_fee_pct",
  "vc_acquisition_fee_pct",
  "tax_escalation_pct",
  "going_in_cap_rate_y1",
  "going_in_cap_rate_t12",
  "going_in_cap_rate_y2",
  "going_in_cap_rate_y3",
  "terminal_cap_rate",
  "terminal_cap_rate_tax_adj",
  "stabilized_yield_on_cost",
  "avg_yield",
  "avg_yield_w_o_sale",
  "avg_yield_on_unreturned_equity",
  "yield_origination",
  "yield_outstanding",
  "yield_os_equity_y1_post_refi",
  "loss_to_lease_pct",
  "levered_irr",
  "unlevered_irr",
  "lp_irr",
  "gp_irr",
  "target_investor_irr",
  "waterfall_tier_2_hurdle",
  "waterfall_tier_3_hurdle",
  "waterfall_tier_4_hurdle",
]);

const LENDER_NAME_FIELDS = new Set([
  "senior_loan_lender",
  "bridge_loan_lender",
  "construction_loan_lender",
  "mezz_loan_lender",
]);

const UNIT_COUNT_FIELDS = new Set([
  "units_at_acquisition",
  "units_pro_forma",
  "units_residential",
  "units_retail",
  "units_adu",
  "units_bmr",
  "units_rent_controlled",
  "units_rent_controlled_tier1",
  "units_rent_controlled_tier2",
  "units_rent_controlled_tier3",
  "units_under_renovation",
  "units_reno_complete_lt_12mo",
]);

const LENDER_NAME_PATTERNS = [
  /\bbank\b/i,
  /\bcapital\b/i,
  /\b(llc|l\.l\.c\.|l p|lp|inc|inc\.|n\.a\.|na|fsb|federal\s*credit\s*union|fcu)\b/i,
  /\b(jpmorgan|wells\s*fargo|citi|bofa|chase|goldman|morgan\s*stanley)\b/i,
  /\bcompany\b/i,
  /\bfunding\b/i,
  /\bmortgage\b/i,
  /\bfinancial\b/i,
  /\b(holdings|partners|trust|equities)\b/i,
];

const TITLE_POLICY_BOILERPLATE = [
  /\b(alta|clta)\s*(owner'?s?|lender'?s?)?\s*(title|policy|endorsement)/i,
  /^lender\s*endorsements?$/i,
  /\btitle\s*polic(y|ies)\b/i,
  /\bowner'?s?\s*polic(y|ies)\b/i,
  /\b(stewart|chicago|first\s*american|fidelity\s*national|old\s*republic)\s*title/i,
  /^(pending|tbd|n\/a|see\s*notes?|various)$/i,
];

function ruleMoneyFieldsRejectRates(map) {
  const findings = [];
  for (const [key, entry] of Object.entries(map)) {
    if (!MONEY_FIELDS.has(key)) continue;
    const v = entry.value;
    if (typeof v !== "number") continue;
    if (v > 0 && v < 1) {
      findings.push({
        field: key,
        severity: "critical",
        reason: `money field but value=${v} looks like a rate/percentage (0 < v < 1). The matcher likely picked a percentage cell instead of a dollar cell.`,
        suggested_action:
          "NULL the value; analyst fills manually or rerun with stricter not_labels.",
      });
    }
  }
  return findings;
}

function ruleRateFieldsRejectDollars(map) {
  const findings = [];
  for (const [key, entry] of Object.entries(map)) {
    if (!RATE_FIELDS.has(key)) continue;
    const v = entry.value;
    if (typeof v !== "number") continue;
    if (v < 0 || v > 1.0) {
      findings.push({
        field: key,
        severity: "critical",
        reason: `rate field but value=${v} outside [0,1]. The matcher likely picked a dollar amount instead of a decimal rate.`,
        suggested_action: "NULL the value; analyst fills manually.",
      });
    }
  }
  return findings;
}

function rulePurchasePriceCollision(map) {
  const findings = [];
  const pp = map.purchase_price?.value;
  if (typeof pp !== "number" || pp <= 0) return findings;
  const allowedToEqual = new Set([
    "purchase_price",
    "property_tax_assessed_value",
  ]);
  for (const [key, entry] of Object.entries(map)) {
    if (!MONEY_FIELDS.has(key)) continue;
    if (allowedToEqual.has(key)) continue;
    if (entry.value === pp) {
      findings.push({
        field: key,
        severity: "critical",
        reason: `value=${pp} exactly equals purchase_price. Almost certainly a basis cell mis-mapped to this field.`,
        suggested_action:
          'NULL the value; matcher needs not_labels for "basis" / "assessment".',
      });
    }
  }
  return findings;
}

function ruleLenderNameShape(map) {
  const findings = [];
  for (const key of LENDER_NAME_FIELDS) {
    const entry = map[key];
    if (!entry || entry.value == null) continue;
    const text = String(entry.value).trim();
    if (!text) continue;

    for (const pattern of TITLE_POLICY_BOILERPLATE) {
      if (pattern.test(text)) {
        findings.push({
          field: key,
          severity: "critical",
          reason: `value="${text}" looks like title-insurance boilerplate, not a lender name. Matcher likely picked from a closing-cost or stmt sheet.`,
          suggested_action:
            "NULL the value; matcher needs not_sheets for closing/stmt/title/policy.",
        });
        break;
      }
    }

    const matchedShape = LENDER_NAME_PATTERNS.some((p) => p.test(text));
    const looksLikeProperNoun = /^([A-Z][a-z]+\s){1,5}[A-Z][a-z]+$/.test(text);
    const isShortAcronym = /^[A-Z]{2,5}$/.test(text);
    if (!matchedShape && !looksLikeProperNoun && !isShortAcronym) {
      findings.push({
        field: key,
        severity: "warning",
        reason: `value="${text}" doesn't match any lender-name pattern (bank/capital/llc/etc.) or look like a proper noun. May need analyst review.`,
        suggested_action: "Surface for analyst review; allow if confirmed.",
      });
    }
  }
  return findings;
}

function ruleUnitCountConsistency(map) {
  const findings = [];
  for (const key of UNIT_COUNT_FIELDS) {
    const v = map[key]?.value;
    if (typeof v !== "number") continue;
    if (!Number.isInteger(v) && Math.round(v) !== v) {
      if (Math.abs(v - Math.round(v)) > 0.01) {
        findings.push({
          field: key,
          severity: "warning",
          reason: `unit-count field but value=${v} is not an integer.`,
          suggested_action:
            "Verify; round if matcher picked a fractional cell.",
        });
      }
    }
    if (v < 0 || v > 1000) {
      findings.push({
        field: key,
        severity: "critical",
        reason: `unit-count field but value=${v} outside [0, 1000]. Almost certainly a non-count cell mis-mapped.`,
        suggested_action: "NULL the value.",
      });
    }
  }

  const rcTotal = map.units_rent_controlled?.value;
  const proForma = map.units_pro_forma?.value;
  if (
    typeof rcTotal === "number" &&
    typeof proForma === "number" &&
    rcTotal > proForma
  ) {
    findings.push({
      field: "units_rent_controlled",
      severity: "critical",
      reason: `units_rent_controlled=${rcTotal} but units_pro_forma=${proForma}. RC count cannot exceed total.`,
      suggested_action:
        "NULL units_rent_controlled; verify against tier1+tier2+tier3 sum.",
    });
  }

  const res = map.units_residential?.value;
  const retail = map.units_retail?.value;
  if (
    typeof res === "number" &&
    typeof retail === "number" &&
    typeof proForma === "number"
  ) {
    const sum = res + retail;
    if (sum > proForma + 5) {
      findings.push({
        field: "units_residential",
        severity: "warning",
        reason: `units_residential(${res}) + units_retail(${retail}) = ${sum} exceeds units_pro_forma(${proForma}) + ADU slack. One of these is likely wrong.`,
        suggested_action: "Surface for analyst review.",
      });
    }
  }

  const t1 = map.units_rent_controlled_tier1?.value;
  const t2 = map.units_rent_controlled_tier2?.value;
  const t3 = map.units_rent_controlled_tier3?.value;
  if (
    typeof t1 === "number" &&
    typeof t2 === "number" &&
    typeof t3 === "number"
  ) {
    const tierSum = t1 + t2 + t3;
    if (typeof rcTotal === "number" && Math.abs(tierSum - rcTotal) > 0.5) {
      findings.push({
        field: "units_rent_controlled",
        severity: "warning",
        reason: `tier1+tier2+tier3 = ${tierSum} but units_rent_controlled = ${rcTotal}. Inconsistent.`,
        suggested_action: "Surface for analyst review; one source is wrong.",
      });
    }
  }

  return findings;
}

function ruleEquityMultipleRange(map) {
  const findings = [];
  const emFields = [
    "lp_equity_multiple",
    "gp_equity_multiple",
    "equity_multiple_levered",
    "equity_multiple_unlevered",
    "target_investor_em",
  ];
  for (const key of emFields) {
    const v = map[key]?.value;
    if (typeof v !== "number") continue;
    if (v <= 0 || v >= 20) {
      findings.push({
        field: key,
        severity: "critical",
        reason: `equity multiple but value=${v} is implausible (expected 0 < v < 20).`,
        suggested_action: "NULL the value.",
      });
    }
  }
  return findings;
}

function ruleUnitMixRowSum(unitMixRows, map) {
  const findings = [];
  if (!Array.isArray(unitMixRows) || unitMixRows.length === 0) return findings;

  const proForma = map.units_pro_forma?.value;
  const atAcq = map.units_at_acquisition?.value;

  const bySection = new Map();
  for (const row of unitMixRows) {
    const sec = row.section || "unknown";
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(row);
  }

  for (const [section, rows] of bySection) {
    const sumCount = rows.reduce((s, r) => s + (Number(r.unit_count) || 0), 0);
    let expected = null;
    let expectedField = null;
    if (section === "stabilized") {
      expected = proForma;
      expectedField = "units_pro_forma";
    } else if (section === "existing") {
      expected = atAcq;
      expectedField = "units_at_acquisition";
    }

    if (expected != null && Math.abs(sumCount - expected) > 0.5) {
      findings.push({
        field: "unit_mix",
        severity: "warning",
        reason: `unit_mix section="${section}" rows sum to ${sumCount} but expected ${expected} (${expectedField}). Rows: ${rows.length}.`,
        suggested_action:
          "Surface for analyst review. Do NOT auto-truncate — sums may differ legitimately (e.g. ADU added in renovation).",
        meta: {
          section,
          row_count: rows.length,
          sum_count: sumCount,
          expected,
          expected_field: expectedField,
        },
      });
    }
  }

  return findings;
}

function ruleOpexTotalFloor(map) {
  const findings = [];
  const opex = map.opex_total?.value;
  const units = map.units_pro_forma?.value ?? map.units_at_acquisition?.value;
  if (typeof opex !== "number" || typeof units !== "number") return findings;
  if (units < 3) return findings;
  const perUnit = opex / units;
  const FLOOR_PER_UNIT = 5_000;
  if (perUnit < FLOOR_PER_UNIT) {
    findings.push({
      field: "opex_total",
      severity: "critical",
      reason: `opex_total=${opex.toFixed(2)} → ${perUnit.toFixed(0)}/unit/yr (units=${units}). Below $${FLOOR_PER_UNIT.toLocaleString()}/unit floor — matcher likely picked a single OPEX line-item instead of the total.`,
      suggested_action:
        'NULL the value. Matcher should require label tokens like "total operating expense" or look for a sum row, not a single sub-line.',
    });
  }
  return findings;
}

function ruleStreetAddressShape(map) {
  const findings = [];
  const addrEntry = map.model_street_address;
  if (!addrEntry || addrEntry.value == null) return findings;
  const addr = String(addrEntry.value).trim();
  if (!addr) return findings;

  const propertyName = String(map.model_property_name?.value ?? "").trim();
  if (propertyName && addr.toLowerCase() === propertyName.toLowerCase()) {
    findings.push({
      field: "model_street_address",
      severity: "warning",
      reason: `model_street_address="${addr}" is identical to model_property_name. Matcher picked the property's name as its address instead of a real street.`,
      suggested_action: "NULL the value or surface for analyst entry.",
    });
    return findings;
  }

  const hasLeadingDigit = /^\s*\d+/.test(addr);
  const STREET_SUFFIX_RE =
    /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pl|place|ter|terrace|hwy|highway|pkwy|parkway|cir|circle|trl|trail|aly|alley|sq|square|loop)\b\.?/i;
  const hasSuffix = STREET_SUFFIX_RE.test(addr);

  if (!hasLeadingDigit && !hasSuffix) {
    findings.push({
      field: "model_street_address",
      severity: "warning",
      reason: `model_street_address="${addr}" doesn't look like a street address (no leading number, no street-suffix token like St/Ave/Blvd/Way).`,
      suggested_action:
        "Surface for analyst review; matcher likely picked a label or property-name cell.",
    });
  }
  return findings;
}

function ruleOtherIncomeTotalConsistency(map) {
  const findings = [];
  const total = map.other_income_total?.value;
  if (typeof total !== "number" || total === 0) return findings;
  const COMPONENTS = [
    "other_income_laundry",
    "other_income_parking",
    "other_income_rubs",
    "other_income_pet_rent",
    "other_income_late_nsf_fees",
    "other_income_application_fees",
    "other_income_termination_fees",
    "other_income_forfeited_deposits",
    "other_income_misc",
  ];
  let sumComponents = 0;
  let nPopulated = 0;
  for (const key of COMPONENTS) {
    const v = map[key]?.value;
    if (typeof v === "number" && v > 0) {
      sumComponents += v;
      nPopulated += 1;
    }
  }
  if (nPopulated < 2) return findings;
  if (sumComponents > total * 1.2) {
    findings.push({
      field: "other_income_total",
      severity: "warning",
      reason: `other_income_total=${total.toFixed(2)} but Σ(${nPopulated} populated components)=${sumComponents.toFixed(2)}. Total likely picked at a different scale (e.g. monthly when components are annual, or vice versa). Common when matcher lands on a Year-1 NOI Build subtotal cell.`,
      suggested_action:
        'Surface for analyst review; matcher may need to prefer "annual" or "year 1" labeled cells over monthly summary subtotals.',
      meta: { total, sum_components: sumComponents, n_populated: nPopulated },
    });
  }
  return findings;
}

function ruleDateFieldRange(map) {
  const findings = [];
  for (const [key, entry] of Object.entries(map)) {
    const v = entry.value;
    if (typeof v !== "string") continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
    const d = new Date(v);
    if (isNaN(d.getTime())) {
      findings.push({
        field: key,
        severity: "warning",
        reason: `value="${v}" parses as date but is invalid.`,
        suggested_action: "Surface for review.",
      });
      continue;
    }
    const year = d.getUTCFullYear();
    if (year < 1990 || year > 2100) {
      findings.push({
        field: key,
        severity: "warning",
        reason: `date value year=${year} outside plausible range [1990, 2100].`,
        suggested_action: "Surface for review.",
      });
    }
  }
  return findings;
}

const ALL_RULES = [
  ruleMoneyFieldsRejectRates,
  ruleRateFieldsRejectDollars,
  rulePurchasePriceCollision,
  ruleLenderNameShape,
  ruleUnitCountConsistency,
  ruleEquityMultipleRange,
  ruleOpexTotalFloor,
  ruleStreetAddressShape,
  ruleOtherIncomeTotalConsistency,
  ruleDateFieldRange,
];

export function validateCanonicalMap(canonicalMap) {
  const findings = [];
  for (const rule of ALL_RULES) {
    findings.push(...rule(canonicalMap));
  }

  const rejectedByField = new Map();
  const warningsByField = new Map();
  for (const f of findings) {
    if (f.severity === "critical") {
      if (!rejectedByField.has(f.field)) {
        rejectedByField.set(f.field, f);
      } else {
        warningsByField.set(`${f.field}:${rule_index(findings, f)}`, f);
      }
    } else {
      warningsByField.set(`${f.field}:${rule_index(findings, f)}`, f);
    }
  }

  const accepted = {};
  const rejected = {};
  for (const [key, entry] of Object.entries(canonicalMap)) {
    const finding = rejectedByField.get(key);
    if (finding) {
      rejected[key] = finding;
    } else {
      accepted[key] = entry;
    }
  }

  return {
    accepted,
    rejected,
    warnings: Array.from(warningsByField.values()),
  };
}

function rule_index(findings, f) {
  return findings.indexOf(f);
}

export function validateTabularUnitMix(unitMixRows, canonicalMap) {
  return ruleUnitMixRowSum(unitMixRows, canonicalMap);
}

export function correctTabularUnitMix(unitMixRows, _canonicalMap) {
  if (!Array.isArray(unitMixRows) || unitMixRows.length === 0) {
    return { rows: unitMixRows || [], removed: [] };
  }
  const removed = [];

  const dedupKey = (r) =>
    `${r.section || "unknown"}::${String(r.unit_type || "")
      .trim()
      .toLowerCase()}`;
  const groupCounts = new Map();
  const groupMaxCount = new Map();
  for (const row of unitMixRows) {
    const k = dedupKey(row);
    groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
    const c = Number(row.unit_count) || 0;
    groupMaxCount.set(k, Math.max(groupMaxCount.get(k) || 0, c));
  }
  const hasDuplicateGroup = Array.from(groupCounts.values()).some((c) => c > 1);
  const allDuplicatesAreUnitOne = Array.from(groupCounts.entries())
    .filter(([, c]) => c > 1)
    .every(([k]) => (groupMaxCount.get(k) || 0) <= 1);
  const isPerUnitDetail = hasDuplicateGroup && allDuplicatesAreUnitOne;

  let rows;
  if (isPerUnitDetail) {
    rows = unitMixRows.slice();
  } else {
    const byKey = new Map();
    for (const row of unitMixRows) {
      const k = dedupKey(row);
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, row);
        continue;
      }
      const newCount = Number(row.unit_count) || 0;
      const oldCount = Number(existing.unit_count) || 0;
      if (newCount > oldCount) {
        byKey.set(k, row);
        removed.push({
          row: existing,
          reason: `dedupe: same (section, unit_type), higher-count row replaced this one`,
        });
      } else {
        removed.push({
          row,
          reason: `dedupe: same (section, unit_type), kept higher-count row`,
        });
      }
    }
    rows = Array.from(byKey.values());
  }

  rows = rows.filter((r) => {
    const t = String(r.unit_type || "").trim();
    if (!t || t === "-" || t === "—" || /^N\/A$/i.test(t)) {
      removed.push({ row: r, reason: "unit_type is blank/dash/N/A" });
      return false;
    }
    return true;
  });

  return { rows, removed };
}

export const _internal = {
  ruleMoneyFieldsRejectRates,
  ruleRateFieldsRejectDollars,
  rulePurchasePriceCollision,
  ruleLenderNameShape,
  ruleUnitCountConsistency,
  ruleEquityMultipleRange,
  ruleDateFieldRange,
  ruleUnitMixRowSum,
  MONEY_FIELDS,
  RATE_FIELDS,
  LENDER_NAME_FIELDS,
  UNIT_COUNT_FIELDS,
  TITLE_POLICY_BOILERPLATE,
};
