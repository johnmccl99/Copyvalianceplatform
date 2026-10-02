import { applySecurity, jsonResponse } from "./_security.js";
import * as XLSX from "xlsx";
import * as tabular from "./lib/underwriting-tabular-extractors.js";
import {
  validateCanonicalMap,
  validateTabularUnitMix,
  correctTabularUnitMix,
} from "./lib/underwriting-validators.js";
import { runConfidenceScoring } from "./lib/underwriting-confidence.js";
import { runAudit } from "./lib/underwriting-audit-runner.js";

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

const RANGE_EXPANSION_CAP = 0;

const MAX_EDGES_PER_GRAPH = 800_000;

const MAX_NODES_PER_GRAPH = 500_000;

const NODE_INSERT_BATCH_SIZE = 4_000;
const EDGE_INSERT_BATCH_SIZE = 8_000;
const DEFAULT_INSERT_BATCH_SIZE = 500;
const INSERT_CONCURRENCY = 2;

const RETRYABLE_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

const PERCENT_IRR = { kind: "percent", min: -0.5, max: 1.5 };
const PERCENT_CAP = { kind: "percent", min: 0.005, max: 0.3 };
const PERCENT_CAP_XL = { kind: "percent", min: 0.005, max: 0.5 };
const PERCENT_RATE = { kind: "percent", min: 0, max: 0.3 };
const PERCENT_LTV = { kind: "percent", min: 0, max: 1.2 };
const PERCENT_GROWTH = { kind: "percent", min: -0.2, max: 0.3 };
const PERCENT_VACANCY = { kind: "percent", min: 0, max: 0.5 };
const PERCENT_SPLIT = { kind: "percent", min: 0, max: 1 };
const PERCENT_OCC = { kind: "percent", min: 0, max: 1.1 };
const PERCENT_FEE = { kind: "percent", min: 0, max: 0.1 };
const PERCENT_FEE_SM = { kind: "percent", min: 0, max: 0.05 };
const PERCENT_PREF = { kind: "percent", min: 0, max: 0.2 };
const PERCENT_T2 = { kind: "percent", min: 0, max: 0.35 };
const PERCENT_T3 = { kind: "percent", min: 0, max: 0.5 };
const PERCENT_T4 = { kind: "percent", min: 0, max: 0.8 };
const MULT_EM = { kind: "multiple", min: 0.5, max: 10 };
const MULT_EM_GP = { kind: "multiple", min: 0.5, max: 25 };
const MONEY_BIG = { kind: "money", min: 10_000, max: 10_000_000_000 };
const MONEY_LG = { kind: "money", min: 1_000, max: 5_000_000_000 };
const MONEY_MED = { kind: "money", min: 0, max: 500_000_000 };
const MONEY_MED2 = { kind: "money", min: 0, max: 2_000_000_000 };
const MONEY_SM = { kind: "money", min: 0, max: 50_000_000 };
const MONEY_LINE = { kind: "money", min: -10_000_000, max: 500_000_000 };
const MONEY_PROR = { kind: "money", min: -500_000_000, max: 500_000_000 };
const MONEY_NEG_ONLY = { kind: "money", min: -500_000_000, max: 0 };
const MONEY_OPEX = { kind: "money", min: 500, max: 100_000_000 };
const MONEY_OPEX_TAX = { kind: "money", min: 0, max: 200_000 };
const MONEY_OPEX_SM = { kind: "money", min: 0, max: 1_000_000 };
const MONEY_OPEX_H2O = { kind: "money", min: 500, max: 10_000_000 };
const MONEY_CAPEX_BUCKET = { kind: "money", min: 500, max: 100_000_000 };
const MONEY_PER_UNIT = { kind: "money", min: 10, max: 10_000_000 };
const MONEY_PER_BED = { kind: "money", min: 0, max: 100_000 };
const MONEY_RENT_INCR = { kind: "money", min: 0, max: 1000 };
const BPS = { kind: "number", min: 0, max: 1000 };
const COUNT_UNITS = { kind: "count", min: 0, max: 10_000 };
const COUNT_SF = { kind: "count", min: 0, max: 500_000_000 };
const COUNT_MONTHS = { kind: "number", min: 0, max: 600 };
const COUNT_YEARS = { kind: "number", min: 0, max: 60 };
const COUNT_WATER_G = { kind: "count", min: 0, max: 10_000_000_000 };
const COUNT_WATER_GD = { kind: "count", min: 0, max: 10_000_000 };
const COUNT_CLASS = { kind: "count", min: 1, max: 10 };
const COUNT_PERMITS = { kind: "count", min: 0, max: 500 };
const YEAR = { kind: "year", min: 1800, max: 2100 };
const NUM_LEASE_FEE = { kind: "number", min: 0.01, max: 10_000_000 };
const NUM_HOLD_YRS = { kind: "number", min: 0.25, max: 30 };

const VALUE_RANGES = {
  year_built: YEAR,
  lot_size_sf: COUNT_SF,
  rentable_sf_pro_forma: COUNT_SF,
  gross_sf_pro_forma: COUNT_SF,

  units_at_acquisition: COUNT_UNITS,
  units_pro_forma: COUNT_UNITS,
  units_residential: COUNT_UNITS,
  units_adu: COUNT_UNITS,
  units_retail: COUNT_UNITS,
  units_bmr: COUNT_UNITS,
  units_rent_controlled: COUNT_UNITS,
  units_rent_controlled_tier1: COUNT_UNITS,
  units_rent_controlled_tier2: COUNT_UNITS,
  units_rent_controlled_tier3: COUNT_UNITS,
  units_under_renovation: COUNT_UNITS,
  units_reno_complete_lt_12mo: COUNT_UNITS,

  avg_rent_per_unit_acquisition: MONEY_PER_UNIT,
  avg_rent_per_unit_pro_forma: MONEY_PER_UNIT,
  avg_rent_per_unit_market: MONEY_PER_UNIT,
  rent_per_sf_acquisition: MONEY_PER_UNIT,
  rent_per_sf_pro_forma: MONEY_PER_UNIT,
  rent_per_sf_market: MONEY_PER_UNIT,
  occupancy_at_acquisition: PERCENT_OCC,
  occupancy_stabilized: PERCENT_OCC,
  loss_to_lease_pct: { kind: "percent", min: 0.005, max: 0.5 },

  purchase_price: MONEY_BIG,
  terminal_cap_rate: PERCENT_CAP,
  terminal_cap_rate_tax_adj: PERCENT_CAP,
  closing_costs_total: MONEY_MED,
  capex_budget_total: { kind: "money", min: 50_000, max: 2_000_000_000 },
  other_income_year_1: { kind: "money", min: 0, max: 10_000_000 },
  interest_reserve_capitalized: { kind: "money", min: 0, max: 50_000_000 },
  oid_or_loan_fees: { kind: "money", min: 0, max: 50_000_000 },
  all_in_basis: MONEY_BIG,
  going_in_cap_rate_y1: PERCENT_CAP,
  going_in_cap_rate_t12: PERCENT_CAP,
  going_in_cap_rate_y2: PERCENT_CAP,
  going_in_cap_rate_y3: PERCENT_CAP,
  stabilized_yield_on_cost: PERCENT_CAP,
  avg_yield: PERCENT_CAP,
  avg_yield_w_o_sale: PERCENT_CAP,
  avg_yield_on_unreturned_equity: PERCENT_CAP,
  yield_origination: PERCENT_CAP,
  yield_outstanding: PERCENT_CAP,
  yield_os_equity_y1_post_refi: PERCENT_CAP_XL,

  target_investor_irr: PERCENT_IRR,
  target_investor_em: MULT_EM,
  levered_irr: PERCENT_IRR,
  unlevered_irr: PERCENT_IRR,
  equity_multiple_levered: MULT_EM,
  equity_multiple_unlevered: MULT_EM,
  lp_irr: PERCENT_IRR,
  lp_equity_multiple: MULT_EM,
  lp_avg_annual_cash_on_cash: { kind: "percent", min: -0.2, max: 0.5 },
  lp_peak_equity: MONEY_LG,
  gp_irr: PERCENT_IRR,
  gp_equity_multiple: MULT_EM_GP,
  gp_promote_earned: MONEY_LG,
  levered_cf_y1: MONEY_LINE,
  levered_cf_y2: MONEY_LINE,
  levered_cf_y3: MONEY_LINE,
  levered_cf_y4: MONEY_LINE,
  levered_cf_y5: MONEY_LINE,
  levered_cf_y6: MONEY_LINE,
  levered_cf_y7: MONEY_LINE,
  levered_cf_y8: MONEY_LINE,
  levered_cf_y9: MONEY_LINE,
  levered_cf_y10: MONEY_LINE,

  bridge_loan_amount: MONEY_LG,
  bridge_loan_proceeds_at_close: MONEY_LG,
  bridge_loan_rate_all_in: PERCENT_RATE,
  bridge_loan_spread_bps: BPS,
  bridge_loan_ltv: PERCENT_LTV,
  bridge_loan_ltc: PERCENT_LTV,
  bridge_loan_term_months: COUNT_MONTHS,
  bridge_loan_io_period_months: COUNT_MONTHS,
  bridge_loan_amort_years: COUNT_YEARS,
  bridge_loan_origination_fee_pct: PERCENT_FEE,
  bridge_loan_exit_fee_pct: PERCENT_FEE,
  bridge_loan_rate_cap_strike: PERCENT_RATE,
  bridge_loan_rate_cap_cost: MONEY_SM,
  bridge_loan_swap_rate: PERCENT_RATE,
  bridge_loan_swap_cost: MONEY_SM,
  bridge_loan_exit_fee_amount: MONEY_SM,

  senior_loan_amount: MONEY_LG,
  senior_loan_initial_draw: MONEY_LG,
  senior_loan_committed_amount: MONEY_LG,
  senior_loan_proceeds_at_close: MONEY_LG,
  senior_loan_rate_all_in: PERCENT_RATE,
  senior_loan_spread_bps: BPS,
  senior_loan_ltv: PERCENT_LTV,
  senior_loan_ltc: PERCENT_LTV,
  senior_loan_term_months: COUNT_MONTHS,
  senior_loan_io_period_months: COUNT_MONTHS,
  senior_loan_amort_years: COUNT_YEARS,
  senior_loan_origination_fee_pct: PERCENT_FEE,
  senior_loan_exit_fee_pct: PERCENT_FEE,
  senior_loan_rate_cap_strike: PERCENT_RATE,
  senior_loan_rate_cap_cost: MONEY_SM,
  senior_loan_swap_rate: PERCENT_RATE,
  senior_loan_swap_cost: MONEY_SM,

  mezz_loan_amount: MONEY_LG,
  mezz_loan_rate_current: PERCENT_RATE,
  mezz_loan_rate_accrued: PERCENT_RATE,
  mezz_loan_origination_fee_pct: PERCENT_FEE,

  construction_loan_amount: MONEY_LG,
  construction_loan_ltc: PERCENT_LTV,
  construction_loan_rate: PERCENT_RATE,
  construction_period_months: COUNT_MONTHS,

  pref_equity_amount: MONEY_LG,
  pref_equity_rate: PERCENT_RATE,
  pref_equity_term_months: COUNT_MONTHS,

  total_debt_amount: MONEY_LG,
  total_debt_proceeds_at_close: MONEY_LG,
  debt_payoff_amount: MONEY_LG,

  equity_required_total: MONEY_LG,
  total_lp_equity: MONEY_LG,
  total_gp_equity: MONEY_LG,
  total_coinvest_equity: MONEY_LG,
  lp_equity_at_close: MONEY_LG,
  follow_on_needed_amount: MONEY_LG,

  preferred_return_pct: PERCENT_PREF,
  preferred_return_investor_a_pct: PERCENT_PREF,
  preferred_return_investor_b_pct: PERCENT_PREF,
  preferred_return_sponsor_pct: PERCENT_PREF,
  waterfall_tier_1_split_lp: PERCENT_SPLIT,
  waterfall_tier_1_split_gp: PERCENT_SPLIT,
  waterfall_tier_2_hurdle: PERCENT_T2,
  waterfall_tier_2_split_lp: PERCENT_SPLIT,
  waterfall_tier_2_split_gp: PERCENT_SPLIT,
  waterfall_tier_3_hurdle: PERCENT_T3,
  waterfall_tier_3_split_lp: PERCENT_SPLIT,
  waterfall_tier_3_split_gp: PERCENT_SPLIT,
  waterfall_tier_4_hurdle: PERCENT_T4,
  waterfall_tier_4_split_lp: PERCENT_SPLIT,
  waterfall_tier_4_split_gp: PERCENT_SPLIT,
  catchup_provision_tier_1_pct: PERCENT_SPLIT,
  catchup_provision_tier_2_pct: PERCENT_SPLIT,
  catchup_provision_tier_3_pct: PERCENT_SPLIT,
  catchup_provision_tier_4_pct: PERCENT_SPLIT,
  waterfall_investor_class_count: COUNT_CLASS,

  hold_period_years: NUM_HOLD_YRS,

  sale_price: MONEY_BIG,
  disposition_fee_pct: PERCENT_FEE,
  broker_commission_pct: PERCENT_FEE,
  transfer_tax_pct: PERCENT_FEE,
  selling_costs_pct: PERCENT_FEE,
  selling_costs_amount: MONEY_MED,
  terminal_noi: MONEY_MED,
  terminal_noi_tax_adj: MONEY_MED,
  disposition_proceeds_gross: MONEY_BIG,
  disposition_proceeds_net: MONEY_BIG,
  refi_proceeds: MONEY_LG,
  refi_new_loan_amount: MONEY_LG,
  refi_cashout_amount: { kind: "money", min: 0, max: 2_000_000_000 },
  outstanding_equity_post_refi: { kind: "money", min: 0, max: 2_000_000_000 },
  replacements_reserves_at_exit: MONEY_MED,

  rent_growth_pct: PERCENT_GROWTH,
  rent_growth_dollar: MONEY_RENT_INCR,
  expense_growth_pct: PERCENT_GROWTH,
  tax_escalation_pct: PERCENT_CAP,
  vacancy_pct: PERCENT_VACANCY,
  other_income_pct: { kind: "percent", min: 0, max: 0.3 },
  management_fee_pct: PERCENT_FEE,
  am_fee_pct: PERCENT_FEE_SM,
  cumulative_am_pm_fee_pct: PERCENT_FEE,
  per_bed_pm_fee: MONEY_PER_BED,
  lease_up_fee: NUM_LEASE_FEE,
  min_am_fee: NUM_LEASE_FEE,
  acquisition_fee_pct: PERCENT_FEE_SM,
  vc_acquisition_fee_pct: PERCENT_FEE_SM,
  construction_management_fee_pct: PERCENT_FEE,
  replacement_reserve_per_unit: MONEY_PER_UNIT,
  renewal_probability_pct: PERCENT_SPLIT,
  loss_to_lease_assumption_pct: PERCENT_VACANCY,
  vacancy_initial_pct: { kind: "percent", min: 0, max: 1.0 },
  vacancy_stabilized_pct: { kind: "percent", min: 0, max: 1.0 },
  lease_up_fee_pct: { kind: "percent", min: 0, max: 1.0 },

  other_income_application_fees: MONEY_MED,
  other_income_late_nsf_fees: MONEY_MED,
  other_income_pet_rent: MONEY_MED,
  other_income_termination_fees: MONEY_MED,
  other_income_rubs: MONEY_MED,
  other_income_parking: MONEY_MED,
  other_income_laundry: MONEY_MED,
  other_income_forfeited_deposits: MONEY_MED,
  other_income_misc: MONEY_MED,

  opex_property_tax: MONEY_OPEX,
  opex_pm_fee_dollar: MONEY_OPEX,
  opex_insurance: MONEY_OPEX,
  opex_admin_berk_tax: MONEY_OPEX,
  opex_business_tax: MONEY_OPEX_TAX,
  opex_utilities: MONEY_OPEX,
  opex_util_pge: MONEY_OPEX,
  opex_util_water_sewer: MONEY_OPEX,
  opex_util_trash: MONEY_OPEX,
  opex_util_internet: MONEY_OPEX,
  opex_fire_alarm: MONEY_OPEX,
  opex_security_alarm: MONEY_OPEX,
  opex_salaries: MONEY_OPEX,
  opex_landscaping: MONEY_OPEX,
  opex_pest_control: MONEY_OPEX,
  opex_elevator: MONEY_OPEX,
  opex_janitorial: MONEY_OPEX,
  opex_management_fee: MONEY_OPEX,
  opex_repairs_maintenance: MONEY_OPEX,
  opex_repairs_maintenance_residential: MONEY_OPEX,
  opex_repairs_maintenance_retail: MONEY_OPEX,
  opex_repairs_maintenance_all: MONEY_OPEX,
  opex_turnover: MONEY_OPEX,
  opex_admin_ga: MONEY_OPEX,
  opex_marketing: MONEY_OPEX,
  opex_replacements_reserves_monthly: MONEY_OPEX_SM,
  opex_rhsp_registration: MONEY_OPEX,
  opex_rent_board_fee: MONEY_OPEX,

  water_total_bill_annual: MONEY_OPEX_H2O,
  water_gallons_annual: COUNT_WATER_G,
  water_gallons_per_day: COUNT_WATER_GD,

  gpr_annual: MONEY_MED,
  vacancy_loss_annual: MONEY_NEG_ONLY,
  net_potential_rent_annual: MONEY_MED,
  other_income_total: MONEY_MED,
  egi_annual: { kind: "money", min: 10_000, max: 500_000_000 },
  opex_total: MONEY_MED,
  noi_t12: MONEY_LINE,
  noi_y1: MONEY_LINE,
  noi_stabilized: MONEY_LINE,
  noi_peak: MONEY_LINE,
  noi_y2: MONEY_LINE,
  noi_y3: MONEY_LINE,
  noi_y4: MONEY_LINE,
  noi_y5: MONEY_LINE,
  noi_y6: MONEY_LINE,
  noi_y7: MONEY_LINE,
  noi_y8: MONEY_LINE,
  noi_y9: MONEY_LINE,
  noi_y10: MONEY_LINE,
  debt_service_annual: { kind: "money", min: 10_000, max: 500_000_000 },

  closing_cost_title: MONEY_MED,
  closing_cost_escrow: MONEY_MED,
  closing_cost_recording: MONEY_MED,
  closing_cost_transfer_tax: MONEY_MED,
  closing_cost_prorations: MONEY_PROR,
  closing_cost_legal: MONEY_MED,
  closing_cost_lender_legal: MONEY_MED,
  closing_cost_due_diligence: MONEY_MED,
  closing_cost_financing_fees: MONEY_MED,
  closing_cost_survey: MONEY_MED,
  closing_cost_environmental: MONEY_MED,
  closing_cost_appraisal: MONEY_MED,
  closing_cost_acquisition_fee: MONEY_MED,
  closing_cost_rate_cap: MONEY_MED,
  closing_cost_swap: MONEY_MED,
  closing_cost_zoning: MONEY_SM,
  closing_cost_insurance_binder: MONEY_SM,
  closing_cost_other: MONEY_MED,

  capex_interior_renovation: MONEY_CAPEX_BUCKET,
  capex_exterior_renovation: MONEY_CAPEX_BUCKET,
  capex_common_area: { kind: "money", min: 1_000, max: 50_000_000 },
  capex_mechanical_electrical_plumbing: MONEY_CAPEX_BUCKET,
  capex_building_systems: MONEY_CAPEX_BUCKET,
  capex_soft_costs: MONEY_CAPEX_BUCKET,
  capex_contingency: MONEY_CAPEX_BUCKET,
  capex_appliances: MONEY_CAPEX_BUCKET,
  capex_kitchen: MONEY_CAPEX_BUCKET,
  capex_bath: MONEY_CAPEX_BUCKET,
  capex_flooring: MONEY_CAPEX_BUCKET,
  capex_windows: MONEY_CAPEX_BUCKET,
  capex_landscape_hardscape: MONEY_CAPEX_BUCKET,
  capex_elevator: MONEY_CAPEX_BUCKET,
  capex_life_safety: MONEY_CAPEX_BUCKET,
  capex_per_unit: MONEY_PER_UNIT,

  valuation_as_is: MONEY_BIG,
  valuation_stabilized: MONEY_BIG,
  valuation_current_appraised: MONEY_BIG,
  valuation_ltsv: PERCENT_LTV,

  cost_seg_total_basis: MONEY_BIG,
  cost_seg_land_allocation_pct: PERCENT_SPLIT,
  cost_seg_building_allocation_pct: PERCENT_SPLIT,
  cost_seg_y1_accelerated_depreciation: MONEY_MED,
  cost_seg_total_accelerated_depreciation: MONEY_BIG,
  cost_seg_tax_benefit_y1: MONEY_MED,
  property_tax_assessed_value: MONEY_BIG,
  property_tax_rate_pct: PERCENT_FEE,

  permit_count_last_10yr: COUNT_PERMITS,
  rent_control_max_increase_pct: PERCENT_PREF,

  operating_reserve_at_close: MONEY_MED,
  debt_service_reserve: MONEY_MED,
  ti_lc_reserve: MONEY_MED,
  capex_reserve: MONEY_MED,
  replacement_reserve: MONEY_MED,
  interest_reserve: MONEY_MED,

  hedge_term_months: COUNT_MONTHS,
  hedge_notional_amount: MONEY_LG,
};

const DATE_KEYS = new Set([
  "acquisition_date",
  "bridge_loan_maturity_date",
  "senior_loan_maturity_date",
  "mezz_loan_maturity_date",
  "lp_return_of_capital_date",
  "stabilization_date_target",
  "sale_date",
  "refi_date",
  "valuation_appraisal_date",
  "milestone_acquisition_close",
  "milestone_construction_start",
  "milestone_construction_complete",
  "milestone_stabilization_target",
  "milestone_lease_up_complete",
  "milestone_refi_planned",
  "milestone_refi_actual",
  "milestone_sale_target",
  "cost_seg_study_date",
  "rent_control_last_increase_date",
  "last_major_permit_date",
]);

const TEXT_KEYS = new Set([
  "model_property_name",
  "model_street_address",
  "model_city",
  "model_state",
  "model_zip",
  "model_county",
  "model_neighborhood",
  "model_submarket",
  "bridge_loan_lender",
  "senior_loan_lender",
  "mezz_loan_lender",
  "construction_loan_lender",
  "pref_equity_provider",
  "bridge_loan_index",
  "senior_loan_index",
  "bridge_loan_extension_options",
  "senior_loan_extension_options",
  "bridge_loan_prepay_terms",
  "senior_loan_prepay_terms",
  "promote_description",
  "strategy_description",
  "exit_strategy",
  "renovation_scope_description",
  "valuation_appraiser",
  "cost_seg_study_provider",
  "rent_control_jurisdiction",
  "zoning_designation",
  "rhsp_registration_status",
  "hedge_instrument_type",
]);

const BOOL_KEYS = new Set(["follow_on_flag"]);

function validateCanonicalValue(key, node) {
  if (TEXT_KEYS.has(key)) {
    if (typeof node.value_text !== "string" || !node.value_text.trim()) {
      return { ok: false, reason: "expected a non-empty text value" };
    }
    return { ok: true };
  }
  if (BOOL_KEYS.has(key)) {
    if (
      typeof node.value_num === "number" &&
      (node.value_num === 0 || node.value_num === 1)
    )
      return { ok: true };
    if (
      typeof node.value_text === "string" &&
      /^(yes|no|true|false|y|n|0|1)$/i.test(node.value_text.trim())
    )
      return { ok: true };
    return { ok: false, reason: "expected a boolean (yes/no/true/false/0/1)" };
  }
  if (DATE_KEYS.has(key)) {
    if (node.value_date) return { ok: true };
    if (
      typeof node.value_num === "number" &&
      node.value_num > 20_000 &&
      node.value_num < 80_000
    )
      return { ok: true };
    return { ok: false, reason: "expected a date value" };
  }
  const spec = VALUE_RANGES[key];
  if (!spec) return { ok: true };
  const v = node.value_num;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return { ok: false, reason: "value is not a finite number" };
  }
  if (v < spec.min || v > spec.max) {
    return {
      ok: false,
      reason: `value ${v} outside expected ${spec.kind} range [${spec.min}, ${spec.max}]`,
    };
  }
  return { ok: true };
}

const REFERENCE_KEYS = new Set([
  "loss_to_lease_pct",
  "closing_costs_total",
  "capex_budget_total",
  "all_in_basis",
  "going_in_cap_rate_y1",
  "going_in_cap_rate_t12",
  "going_in_cap_rate_y2",
  "going_in_cap_rate_y3",
  "stabilized_yield_on_cost",
  "avg_yield",
  "avg_yield_w_o_sale",
  "avg_yield_on_unreturned_equity",
  "yield_origination",
  "yield_outstanding",
  "yield_os_equity_y1_post_refi",
  "levered_irr",
  "unlevered_irr",
  "equity_multiple_levered",
  "equity_multiple_unlevered",
  "lp_irr",
  "lp_equity_multiple",
  "lp_avg_annual_cash_on_cash",
  "lp_peak_equity",
  "lp_return_of_capital_date",
  "gp_irr",
  "gp_equity_multiple",
  "gp_promote_earned",
  "total_debt_amount",
  "total_debt_proceeds_at_close",
  "debt_payoff_amount",
  "equity_required_total",
  "sale_price",
  "selling_costs_amount",
  "terminal_noi",
  "terminal_noi_tax_adj",
  "disposition_proceeds_gross",
  "disposition_proceeds_net",
  "refi_proceeds",
  "refi_cashout_amount",
  "outstanding_equity_post_refi",
  "gpr_annual",
  "vacancy_loss_annual",
  "net_potential_rent_annual",
  "other_income_total",
  "egi_annual",
  "opex_total",
  "noi_t12",
  "noi_y1",
  "noi_stabilized",
  "noi_peak",
  "noi_y2",
  "noi_y3",
  "noi_y4",
  "noi_y5",
  "noi_y6",
  "noi_y7",
  "noi_y8",
  "noi_y9",
  "noi_y10",
  "levered_cf_y1",
  "levered_cf_y2",
  "levered_cf_y3",
  "levered_cf_y4",
  "levered_cf_y5",
  "levered_cf_y6",
  "levered_cf_y7",
  "levered_cf_y8",
  "levered_cf_y9",
  "levered_cf_y10",
  "debt_service_annual",
  "capex_per_unit",
  "valuation_ltsv",
  "cost_seg_y1_accelerated_depreciation",
  "cost_seg_total_accelerated_depreciation",
  "cost_seg_tax_benefit_y1",
]);

function canonicalRole(key) {
  return REFERENCE_KEYS.has(key) ? "reference" : "input";
}

const CANONICAL_KEYS = [
  "model_property_name",
  "model_street_address",
  "model_city",
  "model_state",
  "model_zip",
  "model_county",
  "model_neighborhood",
  "model_submarket",
  "year_built",
  "lot_size_sf",
  "rentable_sf_pro_forma",
  "gross_sf_pro_forma",
  "acquisition_date",

  "units_at_acquisition",
  "units_pro_forma",
  "units_residential",
  "units_adu",
  "units_retail",
  "units_bmr",
  "units_rent_controlled",
  "units_rent_controlled_tier1",
  "units_rent_controlled_tier2",
  "units_rent_controlled_tier3",
  "units_under_renovation",
  "units_reno_complete_lt_12mo",
  "avg_rent_per_unit_acquisition",
  "avg_rent_per_unit_pro_forma",
  "avg_rent_per_unit_market",
  "rent_per_sf_acquisition",
  "rent_per_sf_pro_forma",
  "rent_per_sf_market",
  "occupancy_at_acquisition",
  "occupancy_stabilized",
  "loss_to_lease_pct",
  "other_income_year_1",

  "purchase_price",
  "terminal_cap_rate",
  "terminal_cap_rate_tax_adj",
  "closing_costs_total",
  "capex_budget_total",
  "all_in_basis",
  "going_in_cap_rate_y1",
  "going_in_cap_rate_t12",
  "going_in_cap_rate_y2",
  "going_in_cap_rate_y3",
  "stabilized_yield_on_cost",
  "avg_yield",
  "avg_yield_w_o_sale",
  "avg_yield_on_unreturned_equity",
  "yield_origination",
  "yield_outstanding",
  "yield_os_equity_y1_post_refi",

  "target_investor_irr",
  "target_investor_em",
  "levered_irr",
  "unlevered_irr",
  "equity_multiple_levered",
  "equity_multiple_unlevered",
  "lp_irr",
  "lp_equity_multiple",
  "lp_avg_annual_cash_on_cash",
  "lp_peak_equity",
  "lp_return_of_capital_date",
  "gp_irr",
  "gp_equity_multiple",
  "gp_promote_earned",
  "levered_cf_y1",
  "levered_cf_y2",
  "levered_cf_y3",
  "levered_cf_y4",
  "levered_cf_y5",
  "levered_cf_y6",
  "levered_cf_y7",
  "levered_cf_y8",
  "levered_cf_y9",
  "levered_cf_y10",

  "bridge_loan_amount",
  "bridge_loan_proceeds_at_close",
  "bridge_loan_rate_all_in",
  "bridge_loan_spread_bps",
  "bridge_loan_index",
  "bridge_loan_ltv",
  "bridge_loan_ltc",
  "bridge_loan_maturity_date",
  "bridge_loan_term_months",
  "bridge_loan_io_period_months",
  "bridge_loan_amort_years",
  "bridge_loan_lender",
  "bridge_loan_origination_fee_pct",
  "bridge_loan_exit_fee_pct",
  "bridge_loan_extension_options",
  "bridge_loan_rate_cap_strike",
  "bridge_loan_rate_cap_cost",
  "bridge_loan_swap_rate",
  "bridge_loan_swap_cost",
  "bridge_loan_prepay_terms",
  "bridge_loan_exit_fee_amount",

  "senior_loan_amount",
  "senior_loan_proceeds_at_close",
  "senior_loan_initial_draw",
  "senior_loan_committed_amount",
  "senior_loan_rate_all_in",
  "senior_loan_spread_bps",
  "senior_loan_index",
  "senior_loan_ltv",
  "senior_loan_ltc",
  "senior_loan_maturity_date",
  "senior_loan_term_months",
  "senior_loan_io_period_months",
  "senior_loan_amort_years",
  "senior_loan_lender",
  "interest_reserve_capitalized",
  "oid_or_loan_fees",
  "senior_loan_origination_fee_pct",
  "senior_loan_exit_fee_pct",
  "senior_loan_extension_options",
  "senior_loan_prepay_terms",
  "senior_loan_rate_cap_strike",
  "senior_loan_rate_cap_cost",
  "senior_loan_swap_rate",
  "senior_loan_swap_cost",

  "mezz_loan_amount",
  "mezz_loan_rate_current",
  "mezz_loan_rate_accrued",
  "mezz_loan_maturity_date",
  "mezz_loan_lender",
  "mezz_loan_origination_fee_pct",

  "construction_loan_amount",
  "construction_loan_ltc",
  "construction_loan_rate",
  "construction_period_months",
  "construction_loan_lender",

  "pref_equity_amount",
  "pref_equity_rate",
  "pref_equity_term_months",
  "pref_equity_provider",

  "total_debt_amount",
  "total_debt_proceeds_at_close",
  "debt_payoff_amount",

  "equity_required_total",
  "total_lp_equity",
  "total_gp_equity",
  "total_coinvest_equity",
  "lp_equity_at_close",
  "follow_on_flag",
  "follow_on_needed_amount",

  "preferred_return_pct",
  "preferred_return_investor_a_pct",
  "preferred_return_investor_b_pct",
  "preferred_return_sponsor_pct",
  "waterfall_tier_1_split_lp",
  "waterfall_tier_1_split_gp",
  "waterfall_tier_2_hurdle",
  "waterfall_tier_2_split_lp",
  "waterfall_tier_2_split_gp",
  "waterfall_tier_3_hurdle",
  "waterfall_tier_3_split_lp",
  "waterfall_tier_3_split_gp",
  "waterfall_tier_4_hurdle",
  "waterfall_tier_4_split_lp",
  "waterfall_tier_4_split_gp",
  "catchup_provision_tier_1_pct",
  "catchup_provision_tier_2_pct",
  "catchup_provision_tier_3_pct",
  "catchup_provision_tier_4_pct",
  "promote_description",
  "waterfall_investor_class_count",

  "strategy_description",
  "exit_strategy",
  "hold_period_years",
  "renovation_scope_description",
  "stabilization_date_target",

  "sale_date",
  "sale_price",
  "disposition_fee_pct",
  "broker_commission_pct",
  "transfer_tax_pct",
  "selling_costs_pct",
  "selling_costs_amount",
  "terminal_noi",
  "terminal_noi_tax_adj",
  "disposition_proceeds_gross",
  "disposition_proceeds_net",
  "refi_date",
  "refi_proceeds",
  "refi_new_loan_amount",
  "refi_cashout_amount",
  "outstanding_equity_post_refi",
  "replacements_reserves_at_exit",

  "rent_growth_pct",
  "rent_growth_dollar",
  "expense_growth_pct",
  "tax_escalation_pct",
  "vacancy_pct",
  "other_income_pct",
  "management_fee_pct",
  "am_fee_pct",
  "cumulative_am_pm_fee_pct",
  "per_bed_pm_fee",
  "lease_up_fee",
  "min_am_fee",
  "acquisition_fee_pct",
  "vc_acquisition_fee_pct",
  "construction_management_fee_pct",
  "replacement_reserve_per_unit",
  "renewal_probability_pct",
  "loss_to_lease_assumption_pct",
  "vacancy_initial_pct",
  "vacancy_stabilized_pct",
  "lease_up_fee_pct",

  "other_income_application_fees",
  "other_income_late_nsf_fees",
  "other_income_pet_rent",
  "other_income_termination_fees",
  "other_income_rubs",
  "other_income_parking",
  "other_income_laundry",
  "other_income_forfeited_deposits",
  "other_income_misc",
  "opex_property_tax",
  "opex_pm_fee_dollar",
  "opex_insurance",
  "opex_admin_berk_tax",
  "opex_business_tax",
  "opex_utilities",
  "opex_util_pge",
  "opex_util_water_sewer",
  "opex_util_trash",
  "opex_util_internet",
  "opex_fire_alarm",
  "opex_security_alarm",
  "opex_salaries",
  "opex_landscaping",
  "opex_pest_control",
  "opex_elevator",
  "opex_janitorial",
  "opex_management_fee",
  "opex_repairs_maintenance",
  "opex_repairs_maintenance_residential",
  "opex_repairs_maintenance_retail",
  "opex_repairs_maintenance_all",
  "opex_turnover",
  "opex_admin_ga",
  "opex_marketing",
  "opex_replacements_reserves_monthly",
  "opex_rhsp_registration",
  "opex_rent_board_fee",
  "water_total_bill_annual",
  "water_gallons_annual",
  "water_gallons_per_day",
  "gpr_annual",
  "vacancy_loss_annual",
  "net_potential_rent_annual",
  "other_income_total",
  "egi_annual",
  "opex_total",
  "noi_t12",
  "noi_y1",
  "noi_stabilized",
  "noi_peak",
  "noi_y2",
  "noi_y3",
  "noi_y4",
  "noi_y5",
  "noi_y6",
  "noi_y7",
  "noi_y8",
  "noi_y9",
  "noi_y10",
  "debt_service_annual",

  "closing_cost_title",
  "closing_cost_escrow",
  "closing_cost_recording",
  "closing_cost_transfer_tax",
  "closing_cost_prorations",
  "closing_cost_legal",
  "closing_cost_lender_legal",
  "closing_cost_due_diligence",
  "closing_cost_financing_fees",
  "closing_cost_survey",
  "closing_cost_environmental",
  "closing_cost_appraisal",
  "closing_cost_acquisition_fee",
  "closing_cost_rate_cap",
  "closing_cost_swap",
  "closing_cost_zoning",
  "closing_cost_insurance_binder",
  "closing_cost_other",

  "capex_interior_renovation",
  "capex_exterior_renovation",
  "capex_common_area",
  "capex_mechanical_electrical_plumbing",
  "capex_building_systems",
  "capex_soft_costs",
  "capex_contingency",
  "capex_appliances",
  "capex_kitchen",
  "capex_bath",
  "capex_flooring",
  "capex_windows",
  "capex_landscape_hardscape",
  "capex_elevator",
  "capex_life_safety",
  "capex_per_unit",

  "valuation_as_is",
  "valuation_stabilized",
  "valuation_current_appraised",
  "valuation_ltsv",
  "valuation_appraisal_date",
  "valuation_appraiser",

  "milestone_acquisition_close",
  "milestone_construction_start",
  "milestone_construction_complete",
  "milestone_stabilization_target",
  "milestone_lease_up_complete",
  "milestone_refi_planned",
  "milestone_refi_actual",
  "milestone_sale_target",

  "cost_seg_total_basis",
  "cost_seg_land_allocation_pct",
  "cost_seg_building_allocation_pct",
  "cost_seg_study_date",
  "cost_seg_study_provider",
  "cost_seg_y1_accelerated_depreciation",
  "cost_seg_total_accelerated_depreciation",
  "cost_seg_tax_benefit_y1",
  "property_tax_assessed_value",
  "property_tax_rate_pct",

  "rent_control_jurisdiction",
  "rent_control_last_increase_date",
  "rent_control_max_increase_pct",
  "zoning_designation",
  "permit_count_last_10yr",
  "last_major_permit_date",
  "rhsp_registration_status",

  "operating_reserve_at_close",
  "debt_service_reserve",
  "ti_lc_reserve",
  "capex_reserve",
  "replacement_reserve",
  "interest_reserve",

  "hedge_instrument_type",
  "hedge_term_months",
  "hedge_notional_amount",
];

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
  let lastRes = null;
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
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(
          `[sr] network error on ${method} ${path} attempt ${attempt}/${RETRY_MAX_ATTEMPTS}: ${e?.message}; retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
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
    lastRes = res;
    const errText = await res.text().catch(() => "");
    if (attempt < RETRY_MAX_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[sr] retryable ${res.status} on ${method} ${path} attempt ${attempt}/${RETRY_MAX_ATTEMPTS}; retrying in ${delay}ms; body: ${errText.slice(0, 200)}`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return { ok: false, status: res.status, body: null, raw: errText };
  }
  if (lastErr) throw lastErr;
  return {
    ok: false,
    status: lastRes?.status || 0,
    body: null,
    raw: "exhausted retries",
  };
}

async function srInsertBatched(
  path,
  rows,
  {
    prefer = "return=minimal",
    batchSize = DEFAULT_INSERT_BATCH_SIZE,
    concurrency = 1,
  } = {},
) {
  if (rows.length === 0) return;
  if (concurrency === 1) {
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const r = await sr(path, { method: "POST", body: chunk, prefer });
      if (!r.ok) {
        throw new Error(
          `Batch insert to ${path} failed at offset ${i}: HTTP ${r.status} ${(r.raw || "").slice(0, 200)}`,
        );
      }
    }
    return;
  }
  let cursor = 0;
  let failed = null;
  const total = rows.length;
  const runWorker = async () => {
    while (true) {
      if (failed) return;
      const offset = cursor;
      if (offset >= total) return;
      cursor = offset + batchSize;
      const chunk = rows.slice(offset, offset + batchSize);
      try {
        const r = await sr(path, { method: "POST", body: chunk, prefer });
        if (!r.ok) {
          failed = new Error(
            `Batch insert to ${path} failed at offset ${offset}: HTTP ${r.status} ${(r.raw || "").slice(0, 200)}`,
          );
          return;
        }
      } catch (e) {
        failed = e;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, runWorker));
  if (failed) throw failed;
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
      error: `Dropbox token refresh timeout: ${e?.message || String(e)}`,
    };
  }
  const tText = await tRes.text();
  let tBody = null;
  try {
    tBody = tText ? JSON.parse(tText) : null;
  } catch {}
  if (!tRes.ok || !tBody?.access_token) {
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

async function fetchWithTimeout(
  url,
  opts = {},
  timeoutMs = 60_000,
  label = "fetch",
) {
  const ctl = new AbortController();
  const t = setTimeout(
    () => ctl.abort(new Error(`${label} timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

const MS_APP_TENANT_ID = process.env.MS_APP_TENANT_ID || "";
const MS_APP_CLIENT_ID = process.env.MS_APP_CLIENT_ID || "";
const MS_APP_CLIENT_SECRET = process.env.MS_APP_CLIENT_SECRET || "";

let _msAppTokenCache = null;
let _msAppTokenExpiresAt = 0;

async function getMsAppToken() {
  if (!MS_APP_TENANT_ID || !MS_APP_CLIENT_ID || !MS_APP_CLIENT_SECRET) {
    return {
      error:
        "MS_APP_TENANT_ID / MS_APP_CLIENT_ID / MS_APP_CLIENT_SECRET not configured in Netlify env. Set these + grant Files.Read.All application permission on the Azure AD app registration.",
    };
  }
  if (_msAppTokenCache && Date.now() < _msAppTokenExpiresAt - 60_000) {
    return { accessToken: _msAppTokenCache };
  }
  const body = new URLSearchParams({
    client_id: MS_APP_CLIENT_ID,
    client_secret: MS_APP_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  let res;
  try {
    res = await fetchWithTimeout(
      `https://login.microsoftonline.com/${encodeURIComponent(MS_APP_TENANT_ID)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      30_000,
      "azure ad app-token mint",
    );
  } catch (e) {
    return {
      error: `Azure AD token endpoint unreachable: ${e?.message || String(e)}`,
    };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(
      "[underwriting-ingest] MS app-token failed:",
      res.status,
      txt.slice(0, 300),
    );
    return { error: `Azure AD app-token mint failed (HTTP ${res.status})` };
  }
  const data = await res.json().catch(() => ({}));
  if (!data.access_token)
    return { error: "Azure AD response missing access_token" };
  _msAppTokenCache = data.access_token;
  _msAppTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return { accessToken: _msAppTokenCache };
}

async function getSharePointFileBytes({ driveId, itemId }) {
  if (!driveId || !itemId)
    return { error: "SharePoint envelope missing driveId or itemId" };

  const tok = await getMsAppToken();
  if (tok.error) return { error: tok.error };

  let metaRes;
  try {
    metaRes = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,webUrl,lastModifiedDateTime`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } },
      30_000,
      "graph sharepoint item meta",
    );
  } catch (e) {
    return {
      error: `SharePoint item metadata fetch timeout: ${e?.message || String(e)}`,
    };
  }
  if (metaRes.status === 404)
    return { error: "SharePoint item not found (404)." };
  if (metaRes.status === 403)
    return {
      error:
        "SharePoint item access denied (403). Confirm Files.Read.All application permission is granted + admin consent.",
    };
  if (!metaRes.ok)
    return {
      error: `SharePoint item metadata fetch failed (HTTP ${metaRes.status})`,
    };
  const meta = await metaRes.json().catch(() => ({}));
  if (!meta?.file)
    return {
      error: "SharePoint item is not a file (folders cannot be ingested).",
    };

  let contentRes;
  try {
    contentRes = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } },
      180_000,
      "graph sharepoint content",
    );
  } catch (e) {
    return {
      error: `SharePoint file download timeout: ${e?.message || String(e)}`,
    };
  }
  if (!contentRes.ok)
    return {
      error: `SharePoint file download failed: HTTP ${contentRes.status}`,
    };

  return {
    buf: Buffer.from(await contentRes.arrayBuffer()),
    meta: {
      name: meta.name,
      size: meta.size,
      webUrl: meta.webUrl,
      lastModifiedDateTime: meta.lastModifiedDateTime,
    },
  };
}

async function getDropboxFileBytes({ fileRow }) {
  const acctRes = await sr(
    `/org_dropbox_accounts?id=eq.${fileRow.dropbox_account_id}&select=id,status,team_member_id`,
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
  let linkRes;
  try {
    linkRes = await fetchWithTimeout(
      DROPBOX_TEMP_LINK_URL,
      {
        method: "POST",
        headers: tmpHeaders,
        body: JSON.stringify({ path: fileRow.dropbox_file_id }),
      },
      60_000,
      "dropbox get_temporary_link",
    );
  } catch (e) {
    return { error: `get_temporary_link timeout: ${e?.message || String(e)}` };
  }
  const linkBody = await linkRes.json().catch(() => ({}));
  if (!linkRes.ok || !linkBody.link) {
    return {
      error: `get_temporary_link failed (HTTP ${linkRes.status}): ${linkBody.error_summary || "unknown"}`,
    };
  }
  let fileRes;
  try {
    fileRes = await fetchWithTimeout(
      linkBody.link,
      {},
      120_000,
      "dropbox file download",
    );
  } catch (e) {
    return { error: `File download timeout: ${e?.message || String(e)}` };
  }
  if (!fileRes.ok)
    return { error: `File download failed: HTTP ${fileRes.status}` };
  return { buf: Buffer.from(await fileRes.arrayBuffer()) };
}

function extractNamedRanges(workbook) {
  const out = {};
  const names = workbook?.Workbook?.Names;
  if (!Array.isArray(names) || names.length === 0) return out;

  const NAMED_RANGE_RE = new RegExp(
    "^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.\\s\\-]*))!" +
      "(\\$?[A-Za-z]{1,3}\\$?\\d{1,7})" +
      "(?::(\\$?[A-Za-z]{1,3}\\$?\\d{1,7}))?$",
  );

  for (const entry of names) {
    if (
      !entry ||
      typeof entry.Name !== "string" ||
      typeof entry.Ref !== "string"
    )
      continue;
    if (entry.Name.startsWith("_xlnm.")) continue;
    const m = NAMED_RANGE_RE.exec(entry.Ref);
    if (!m) continue;
    const qSheet = m[1] ? m[1].replace(/''/g, "'") : null;
    const uSheet = m[2] || null;
    const sheet = qSheet || uSheet;
    if (!sheet) continue;
    const start = normalizeCellAddr(m[3]);
    const end = m[4] ? normalizeCellAddr(m[4]) : null;
    if (end && end !== start) {
      out[entry.Name] = { sheet, start, end, isRange: true };
    } else {
      out[entry.Name] = { sheet, cell: start, isRange: false };
    }
  }
  return out;
}

const EXCEL_MAX_COL = "XFD";
const EXCEL_MAX_ROW = 1048576;

const REF_RE = new RegExp(
  "(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!" +
    "(\\$?[A-Za-z]{1,3}\\$?\\d{1,7})" +
    "(?::(\\$?[A-Za-z]{1,3}\\$?\\d{1,7}))?" +
    "|" +
    "(?<![A-Za-z0-9_.'!\\[])" +
    "(\\$?[A-Za-z]{1,3}\\$?\\d{1,7})" +
    "(?::(\\$?[A-Za-z]{1,3}\\$?\\d{1,7}))?",
  "g",
);

const WHOLE_ROW_RE = new RegExp(
  "(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!" +
    "\\$?(\\d{1,7}):\\$?(\\d{1,7})" +
    "|" +
    "(?<![A-Za-z0-9_.'!\\[])" +
    "\\$?(\\d{1,7}):\\$?(\\d{1,7})" +
    "(?![A-Za-z0-9_.])",
  "g",
);

const WHOLE_COL_RE = new RegExp(
  "(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!" +
    "\\$?([A-Za-z]{1,3}):\\$?([A-Za-z]{1,3})" +
    "(?![A-Za-z0-9_])" +
    "|" +
    "(?<![A-Za-z0-9_.'!\\[])" +
    "\\$?([A-Za-z]{1,3}):\\$?([A-Za-z]{1,3})" +
    "(?![A-Za-z0-9_])",
  "g",
);

function stripStringLiterals(formula) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (inStr) {
      if (ch === '"') {
        if (formula[i + 1] === '"') {
          i += 1;
          continue;
        }
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    out += ch;
  }
  return out;
}

function normalizeCellAddr(addr) {
  return addr.replace(/\$/g, "").toUpperCase();
}

function expandRange(startAddr, endAddr) {
  const startR = XLSX.utils.decode_cell(startAddr);
  const endR = XLSX.utils.decode_cell(endAddr);
  const r0 = Math.min(startR.r, endR.r),
    r1 = Math.max(startR.r, endR.r);
  const c0 = Math.min(startR.c, endR.c),
    c1 = Math.max(startR.c, endR.c);
  const total = (r1 - r0 + 1) * (c1 - c0 + 1);
  if (total > RANGE_EXPANSION_CAP)
    return { range: true, count: total, first: startAddr, last: endAddr };
  const out = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      out.push(XLSX.utils.encode_cell({ r, c }));
    }
  }
  return { range: false, cells: out };
}

function parseFormulaRefs(formula, currentSheetName, namedRanges = null) {
  const normalized = formula.replace(/\[\d+\](?=['$A-Za-z_])/g, "");
  const stripped = stripStringLiterals(normalized);
  const refs = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(stripped)) !== null) {
    const qSheet = m[1],
      uSheet = m[2],
      firstQ = m[3],
      lastQ = m[4];
    const firstB = m[5],
      lastB = m[6];
    const sheet = qSheet
      ? qSheet.replace(/''/g, "'")
      : uSheet || currentSheetName;
    const first = firstQ || firstB;
    const last = lastQ || lastB;
    if (!first) continue;
    const startAddr = normalizeCellAddr(first);
    if (!last) {
      refs.push({ sheet, cell: startAddr, range: false });
    } else {
      const endAddr = normalizeCellAddr(last);
      const exp = expandRange(startAddr, endAddr);
      if (exp.range) {
        refs.push({
          sheet,
          cell: exp.first,
          endCell: exp.last,
          range: true,
          count: exp.count,
        });
      } else {
        for (const c of exp.cells) refs.push({ sheet, cell: c, range: false });
      }
    }
  }

  WHOLE_ROW_RE.lastIndex = 0;
  while ((m = WHOLE_ROW_RE.exec(stripped)) !== null) {
    const qSheet = m[1],
      uSheet = m[2];
    const r0Q = m[3],
      r1Q = m[4];
    const r0B = m[5],
      r1B = m[6];
    const sheet = qSheet
      ? qSheet.replace(/''/g, "'")
      : uSheet || currentSheetName;
    const r0Raw = r0Q || r0B;
    const r1Raw = r1Q || r1B;
    if (!r0Raw || !r1Raw) continue;
    const r0 = parseInt(r0Raw, 10);
    const r1 = parseInt(r1Raw, 10);
    if (!r0 || !r1 || r0 > EXCEL_MAX_ROW || r1 > EXCEL_MAX_ROW) continue;
    const startAddr = `A${Math.min(r0, r1)}`;
    const endAddr = `${EXCEL_MAX_COL}${Math.max(r0, r1)}`;
    const count = (Math.abs(r1 - r0) + 1) * 16384;
    refs.push({ sheet, cell: startAddr, endCell: endAddr, range: true, count });
  }

  WHOLE_COL_RE.lastIndex = 0;
  while ((m = WHOLE_COL_RE.exec(stripped)) !== null) {
    const qSheet = m[1],
      uSheet = m[2];
    const c0Q = m[3],
      c1Q = m[4];
    const c0B = m[5],
      c1B = m[6];
    const sheet = qSheet
      ? qSheet.replace(/''/g, "'")
      : uSheet || currentSheetName;
    const c0Raw = c0Q || c0B;
    const c1Raw = c1Q || c1B;
    if (!c0Raw || !c1Raw) continue;
    const c0 = c0Raw.toUpperCase();
    const c1 = c1Raw.toUpperCase();
    let c0Num, c1Num;
    try {
      c0Num = XLSX.utils.decode_col(c0);
      c1Num = XLSX.utils.decode_col(c1);
    } catch {
      continue;
    }
    if (c0Num == null || c1Num == null || c0Num < 0 || c1Num < 0) continue;
    const lo = Math.min(c0Num, c1Num),
      hi = Math.max(c0Num, c1Num);
    const startCol = XLSX.utils.encode_col(lo);
    const endCol = XLSX.utils.encode_col(hi);
    const startAddr = `${startCol}1`;
    const endAddr = `${endCol}${EXCEL_MAX_ROW}`;
    const count = (hi - lo + 1) * EXCEL_MAX_ROW;
    refs.push({ sheet, cell: startAddr, endCell: endAddr, range: true, count });
  }

  if (namedRanges && Object.keys(namedRanges).length > 0) {
    const sortedNames = Object.keys(namedRanges).sort(
      (a, b) => b.length - a.length,
    );
    for (const name of sortedNames) {
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?<![A-Za-z0-9_.])${safe}(?![A-Za-z0-9_.])`, "gi");
      if (!re.test(stripped)) continue;
      const target = namedRanges[name];
      if (target.isRange) {
        const exp = expandRange(target.start, target.end);
        if (exp.range) {
          refs.push({
            sheet: target.sheet,
            cell: exp.first,
            endCell: exp.last,
            range: true,
            count: exp.count,
          });
        } else {
          for (const c of exp.cells)
            refs.push({ sheet: target.sheet, cell: c, range: false });
        }
      } else {
        refs.push({ sheet: target.sheet, cell: target.cell, range: false });
      }
    }
  }
  return refs;
}

const METADATA_SHEET_RE =
  /assumption|input|cover|property|deal|terms|financ|loan|debt|basis|cost|acquisition|summary|return|underwrit|investor|partner|waterfall|source|uses|closing|historic|rent\s*roll|\brr\b|noi\s*build|budget|powerquer|\bactuals?\b|\btrailing\b/i;

function buildGraph(workbook) {
  const sheetsOut = [];
  const namedRanges = extractNamedRanges(workbook);
  const edgesMap = new Map();
  const nodesMap = new Map();
  const labelMap = new Map();

  function addEdge(e) {
    const k = `${e.from_sheet}\x00${e.from_cell}\x00${e.to_sheet}\x00${e.to_cell}\x00${e.is_range ? "1" : "0"}`;
    if (edgesMap.has(k)) {
      return;
    }
    edgesMap.set(k, e);
  }

  const sheetNames = workbook.SheetNames;

  function getCellValue(ws, addr) {
    const c = ws[addr];
    if (!c) return null;
    return c.v;
  }

  function getLabelHint(ws, addr) {
    const { r, c } = XLSX.utils.decode_cell(addr);
    const candidates = [];
    for (const off of [1, 2, 3]) {
      if (c - off >= 0) {
        const left = XLSX.utils.encode_cell({ r, c: c - off });
        const v = getCellValue(ws, left);
        if (v != null && typeof v === "string" && v.trim()) {
          candidates.push(v.trim());
          break;
        }
      }
    }
    if (!candidates.length) {
      for (const off of [1, 2]) {
        if (r - off >= 0) {
          const above = XLSX.utils.encode_cell({ r: r - off, c });
          const v = getCellValue(ws, above);
          if (v != null && typeof v === "string" && v.trim()) {
            candidates.push(v.trim());
            break;
          }
        }
      }
    }
    return candidates[0] ? candidates[0].slice(0, 160) : null;
  }

  for (let sIdx = 0; sIdx < sheetNames.length; sIdx++) {
    const name = sheetNames[sIdx];
    const ws = workbook.Sheets[name];
    const ref = ws["!ref"] || "A1:A1";
    const range = XLSX.utils.decode_range(ref);
    const isMetadataSheet = METADATA_SHEET_RE.test(name);
    let cellCount = 0;
    let formulaCount = 0;

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        if (cell.v === undefined && !cell.f) continue;
        cellCount += 1;

        if (
          isMetadataSheet &&
          !cell.f &&
          cell.v !== undefined &&
          cell.v !== null &&
          cell.v !== ""
        ) {
          const key = `${name}\x00${addr}`;
          if (!nodesMap.has(key)) {
            const node = { sheet: name, cell: addr, is_formula: false };
            const v = cell.v;
            if (v instanceof Date)
              node.value_date = v.toISOString().slice(0, 10);
            else if (typeof v === "number") node.value_num = v;
            else if (v !== null) node.value_text = String(v).slice(0, 2000);
            nodesMap.set(key, node);
          }
        }

        if (cell.f) {
          formulaCount += 1;
          const key = `${name}\x00${addr}`;
          let v = cell.v;
          const node = {
            sheet: name,
            cell: addr,
            formula: cell.f,
            is_formula: true,
          };
          if (v instanceof Date) node.value_date = v.toISOString().slice(0, 10);
          else if (typeof v === "number") node.value_num = v;
          else if (v != null) node.value_text = String(v).slice(0, 2000);
          nodesMap.set(key, node);

          const refs = parseFormulaRefs(cell.f, name, namedRanges);
          for (const dep of refs) {
            const depSheet = workbook.Sheets[dep.sheet];
            if (!depSheet) continue;
            if (dep.range) {
              addEdge({
                from_sheet: name,
                from_cell: addr,
                to_sheet: dep.sheet,
                to_cell: dep.cell,
                to_end_cell: dep.endCell || dep.cell,
                is_range: true,
                range_count: dep.count,
              });
              const endKey = `${dep.sheet}\x00${dep.cell}`;
              if (!nodesMap.has(endKey)) {
                const vv = getCellValue(depSheet, dep.cell);
                if (vv !== null && vv !== undefined && vv !== "") {
                  const nn = {
                    sheet: dep.sheet,
                    cell: dep.cell,
                    is_formula: false,
                  };
                  if (vv instanceof Date)
                    nn.value_date = vv.toISOString().slice(0, 10);
                  else if (typeof vv === "number") nn.value_num = vv;
                  else nn.value_text = String(vv).slice(0, 2000);
                  nodesMap.set(endKey, nn);
                }
              }
            } else {
              addEdge({
                from_sheet: name,
                from_cell: addr,
                to_sheet: dep.sheet,
                to_cell: dep.cell,
                is_range: false,
                range_count: null,
              });
              const depKey = `${dep.sheet}\x00${dep.cell}`;
              if (!nodesMap.has(depKey)) {
                const vv = getCellValue(depSheet, dep.cell);
                if (vv !== null && vv !== undefined && vv !== "") {
                  const nn = {
                    sheet: dep.sheet,
                    cell: dep.cell,
                    is_formula: false,
                  };
                  if (vv instanceof Date)
                    nn.value_date = vv.toISOString().slice(0, 10);
                  else if (typeof vv === "number") nn.value_num = vv;
                  else nn.value_text = String(vv).slice(0, 2000);
                  nodesMap.set(depKey, nn);
                }
              }
            }
          }
        }
      }
    }

    sheetsOut.push({
      name,
      ordinal: sIdx,
      dim: ref,
      cell_count: cellCount,
      formula_count: formulaCount,
    });
  }

  for (const [key, node] of nodesMap.entries()) {
    const ws = workbook.Sheets[node.sheet];
    if (!ws) continue;
    const hint = getLabelHint(ws, node.cell);
    if (hint) node.label_hint = hint;
  }

  return {
    sheets: sheetsOut,
    nodes: Array.from(nodesMap.values()),
    edges: Array.from(edgesMap.values()),
    namedRanges,
  };
}

function pickOutputCandidates(graph, maxCount = 150) {
  const summarySheetRe = /summary|return|deal|underwrit|investor|partner/i;
  const inputSheetRe =
    /assumption|input|cover|property|deal|terms|financ|loan|debt|basis|cost|acquisition/i;
  const labelRe =
    /\b(irr|em|equity multiple|multiple|price|basis|cap\s*rate|ltv|loan|npv|yield|promote|gp|lp|purchase|closing|capex|cost|unit|bed|sf|sq.?ft|year built|hold|exit|sale|terminal|rent|vacancy|growth|escalat|amort|rate|spread|ltv|lender|lp|gp|partner|contribution|distribution|name|address|city|state|county|neighborhood|submarket|zip)\b/i;

  const inDeg = new Map();
  for (const e of graph.edges) {
    const k = `${e.to_sheet}\x00${e.to_cell}`;
    inDeg.set(k, (inDeg.get(k) || 0) + 1);
  }
  const outDeg = new Map();
  for (const e of graph.edges) {
    const k = `${e.from_sheet}\x00${e.from_cell}`;
    outDeg.set(k, (outDeg.get(k) || 0) + 1);
  }

  const scored = [];
  for (const n of graph.nodes) {
    let score = 0;
    const sheetSummary = summarySheetRe.test(n.sheet);
    const sheetInput = inputSheetRe.test(n.sheet);
    if (sheetSummary) score += 5;
    else if (sheetInput) score += 3;
    if (n.label_hint && labelRe.test(n.label_hint)) score += 4;
    const k = `${n.sheet}\x00${n.cell}`;
    score += Math.min((inDeg.get(k) || 0) * 0.1, 3);
    score += Math.min((outDeg.get(k) || 0) * 0.05, 2);
    if (n.is_formula) score += 1;

    if (typeof n.value_num === "number") {
      const v = Math.abs(n.value_num);
      if (v > 0.005 && v < 0.6) score += 0.5;
      else if (v > 100_000 && v < 5_000_000_000) score += 0.5;
      else if (v >= 1.05 && v <= 5) score += 0.3;
    } else if (
      n.value_text &&
      n.value_text.length > 1 &&
      n.value_text.length < 80
    ) {
      if (sheetInput) score += 0.3;
    }

    if (score > 1) scored.push({ score, node: n });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map((s) => s.node);
}

function sheetLabelsSample(workbook, sheetName, maxLabels = 15) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  const ref = ws["!ref"] || "A1:A1";
  const range = XLSX.utils.decode_range(ref);
  const labels = [];
  const colMax = Math.min(range.e.c, range.s.c + 2);
  for (let r = range.s.r; r <= range.e.r && labels.length < maxLabels; r++) {
    for (let c = range.s.c; c <= colMax; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell || cell.v == null) continue;
      if (
        typeof cell.v === "string" &&
        cell.v.trim().length > 2 &&
        cell.v.length < 80
      ) {
        labels.push(cell.v.trim());
        break;
      }
    }
  }
  return labels;
}

const KEY_MATCHERS = {
  model_property_name: {
    labels: /property\s*name|deal\s*name|project\s*name|asset\s*name|\bname\b/i,
    prefer_sheets: /assumption|input|cover|summary|cim/i,
  },
  model_street_address: {
    labels:
      /\b(street|address|site\s*address|street\s*address|property\s*address)\b/i,
    prefer_sheets: /assumption|input|cover|cim/i,
  },
  model_city: {
    labels: /\bcity\b/i,
    prefer_sheets: /assumption|input|cover/i,
    not_labels:
      /transfer|\btax\b|\bstate\b|\bname\b|address|property|county|fee|deposit/i,
  },
  model_state: {
    labels: /\bstate\b|state\s*\/\s*region/i,
    prefer_sheets: /assumption|input|cover/i,
    not_labels:
      /statement|status|property|\bname\b|\bcity\b|transfer|\btax\b|financial|balance/i,
  },
  model_zip: {
    labels: /\bzip\b|postal\s*code/i,
    prefer_sheets: /assumption|input|cover/i,
  },
  model_county: {
    labels: /\bcounty\b/i,
    prefer_sheets: /assumption|input|cover/i,
  },
  model_neighborhood: {
    labels: /neighborhood|district/i,
    prefer_sheets: /assumption|input|market|cover/i,
    not_labels: /parcel|\bapn\b|\byoc\b|block|lot\s*\d|assessor/i,
  },
  model_submarket: {
    labels: /submarket|sub[\s-]?market/i,
    prefer_sheets: /assumption|input|market|cover/i,
  },

  year_built: {
    labels: /year\s*built|vintage|construct(ion)?\s*year|built\s*in/i,
    prefer_sheets: /assumption|input|cover|property/i,
  },
  lot_size_sf: {
    labels: /lot\s*size|site\s*size|land\s*area|parcel/i,
    prefer_sheets: /assumption|input|property/i,
  },
  rentable_sf_pro_forma: {
    labels: /rentable\s*sf|rsf|net\s*rentable|total\s*sf/i,
    prefer_sheets: /assumption|input|property|unit/i,
  },
  gross_sf_pro_forma: {
    labels: /gross\s*sf|gsf|gross\s*building/i,
    prefer_sheets: /assumption|input|property|unit/i,
  },
  acquisition_date: {
    labels:
      /(acquisition|purchase|closing|close)\s*date|date\s*of\s*(acquisition|purchase|closing)/i,
    prefer_sheets: /assumption|input|financ|cover|closing/i,
    not_sheets: /market\s*projection|market\s*historical|fred|rate\s*curve/i,
  },

  units_at_acquisition: {
    labels:
      /units?.*at\s*acq|units?.*acquisition|acq(uisition)?.*units?|existing\s*units?|current\s*units?|at\s*acquisition/i,
    prefer_sheets: /assumption|input|property|unit/i,
  },
  units_pro_forma: {
    labels:
      /units?.*(pro[\s-]?forma|pf)|(pro[\s-]?forma|pf).*units?|total\s*units?|stabilized\s*units?/i,
    prefer_sheets: /assumption|input|property|unit/i,
    not_labels: /at\s*acq|acquisition|existing|current/i,
  },
  units_residential: {
    labels:
      /units?\s*[-–]\s*res|residential\s*units?|\bres\s*units\b|units?.*\bres\b/i,
    prefer_sheets: /assumption|input|unit|property/i,
    not_labels: /retail|rtl|commercial/i,
  },
  units_adu: {
    labels: /\badu\b|accessory\s*dwelling/i,
    prefer_sheets: /assumption|input|unit/i,
  },
  units_retail: {
    labels:
      /units?\s*[-–]\s*(retail|rtl)|retail\s*units?|\brtl\s*units?\b|commercial\s*units?/i,
    prefer_sheets: /assumption|input|unit/i,
  },
  units_bmr: {
    labels: /\bbmr\b|below[\s-]?market[\s-]?rate|affordable\s*units?/i,
    prefer_sheets: /assumption|input|unit/i,
  },
  units_rent_controlled: {
    labels:
      /(units?|total).*rent[\s-]?control|rent[\s-]?control.*units?|\brc\s*units?\b/i,
    prefer_sheets: /assumption|input|unit/i,
    not_labels:
      /\brc\s*[123]\b|tier|\$|\brent\b|amount|monthly|annual|gross|total\s*\$|psf|per\s*sf/i,
    not_sheets:
      /capex|cost[\s_]?seg|closing\s*(costs?|stmt)|debt|loan|financing|partnership/i,
  },
  units_rent_controlled_tier1: {
    labels:
      /\brc\s*1\b|rent[\s-]?control.*tier\s*1|tier\s*1.*rent[\s-]?control/i,
    prefer_sheets: /assumption|input|unit/i,
  },
  units_rent_controlled_tier2: {
    labels:
      /\brc\s*2\b|rent[\s-]?control.*tier\s*2|tier\s*2.*rent[\s-]?control/i,
    prefer_sheets: /assumption|input|unit/i,
  },
  units_rent_controlled_tier3: {
    labels:
      /\brc\s*3\b|rent[\s-]?control.*tier\s*3|tier\s*3.*rent[\s-]?control/i,
    prefer_sheets: /assumption|input|unit/i,
  },
  units_under_renovation: {
    labels: /under\s*reno|units?\s*under\s*reno|in[\s-]?reno/i,
    prefer_sheets: /unit|rent|capex|assumption/i,
  },
  units_reno_complete_lt_12mo: {
    labels: /reno\s*complete.*12\s*mo|<\s*12\s*month.*reno|reno.*post/i,
    prefer_sheets: /unit|rent|capex|assumption/i,
  },

  avg_rent_per_unit_acquisition: {
    labels:
      /(avg\s*|average\s*)?current\s*rent|rent\s*at\s*acq|in[\s-]?place\s*rent/i,
    prefer_sheets: /unit|rent|assumption/i,
    not_labels: /pro[\s-]?forma|market/i,
    not_sheets: /schedule|amortization|ltl|debt|loan|financial\b|cash\s*flow/i,
  },
  avg_rent_per_unit_pro_forma: {
    labels: /pro[\s-]?forma\s*rent|stabilized\s*rent|underwritten\s*rent/i,
    prefer_sheets: /unit|rent|assumption/i,
    not_labels: /market/i,
    not_sheets: /schedule|amortization|ltl|debt|loan|financial\b|cash\s*flow/i,
  },
  avg_rent_per_unit_market: {
    labels: /market\s*rent|comp\s*rent/i,
    prefer_sheets: /unit|rent|comp|market/i,
    not_sheets: /schedule|amortization|ltl|debt|loan|financial\b|cash\s*flow/i,
  },
  rent_per_sf_acquisition: {
    labels: /rent.*\/\s*sf.*acq|current\s*rent.*sf|in[\s-]?place\s*rent.*sf/i,
    prefer_sheets: /unit|rent|assumption/i,
  },
  rent_per_sf_pro_forma: {
    labels:
      /rent.*\/\s*sf.*pf|pro[\s-]?forma\s*rent.*sf|stabilized\s*rent.*sf/i,
    prefer_sheets: /unit|rent|assumption/i,
  },
  rent_per_sf_market: {
    labels: /market\s*rent.*sf/i,
    prefer_sheets: /unit|rent|comp|market/i,
  },
  occupancy_at_acquisition: {
    labels: /occupancy.*acq|at\s*acq.*occupancy|current\s*occupancy/i,
    prefer_sheets: /unit|rent|assumption/i,
  },
  occupancy_stabilized: {
    labels: /stabilized\s*occupancy|target\s*occupancy|occupancy.*stabiliz/i,
    prefer_sheets: /unit|rent|assumption/i,
  },
  loss_to_lease_pct: {
    labels: /loss[\s-]?to[\s-]?lease|\bltl\b/i,
    prefer_sheets: /unit|rent|summary/i,
    not_labels: /assumption|\bassume\b/i,
  },

  purchase_price: {
    labels: /purchase\s*price|acquisition\s*price|contract\s*price|\bpp\b/i,
    prefer_sheets: /assumption|input|basis|source|use|cost|summary/i,
  },
  terminal_cap_rate: {
    labels: /terminal\s*cap|exit\s*cap|reversion\s*cap|disposition\s*cap/i,
    prefer_sheets: /assumption|summary|return|exit/i,
    not_labels: /tax.*adj|display|secondary|header|projection/i,
  },
  terminal_cap_rate_tax_adj: {
    labels: /terminal\s*cap.*tax|exit\s*cap.*tax|tax[\s-]?adj.*cap/i,
    prefer_sheets: /assumption|summary|return|exit/i,
  },
  closing_costs_total: {
    labels: /(total\s*)?closing\s*costs?|total\s*transaction\s*costs?/i,
    prefer_sheets: /basis|source|use|cost|closing|summary|assumption/i,
  },
  capex_budget_total: {
    labels:
      /(total\s*)?capex\s*(budget|total)?|capital\s*budget|renovation\s*budget|total\s*capital|total\s*capex/i,
    prefer_sheets: /basis|source|use|capex|cost|summary|assumption/i,
  },
  other_income_year_1: {
    labels:
      /^(other|ancillary|misc|miscellaneous)\s*(y\s*1|year\s*1|annual|total)?\s*(income|revenue|fees)$|^(total|annual)\s*(other|ancillary|misc)\s*(income|revenue)$|total\s*(other|ancillary)\s*income|other\s*revenue|ancillary\s*revenue|^Y1\s*Other\s*Income$|^non[\s-]?rental\s*income$/i,
    prefer_sheets: /noi|income|operations|operating|assumption|cash\s*flow|cf/i,
    not_labels:
      /^laundry$|^parking$|^pet\b|^rubs$|^application|^late\s*fee|interest\s*income/i,
    not_sheets: /loan|debt|amortization|refi|partnership|waterfall/i,
  },
  all_in_basis: {
    labels:
      /all[\s-]?in\s*basis|total\s*basis|total\s*(project\s*)?cost|total\s*investment/i,
    prefer_sheets: /basis|source|use|summary|cost|assumption/i,
  },
  going_in_cap_rate_y1: {
    labels:
      /(going[\s-]?in|year\s*1|yr\s*1|y1).*cap|cap.*(year\s*1|yr\s*1|y1)|cap\s*rate.*y1|pp.*all[\s-]?in.*y1/i,
    prefer_sheets: /summary|return|basis|assumption/i,
    not_labels:
      /t[-_\s]?12|year\s*[23]|yr\s*[23]|y[23]|sizing|display|secondary/i,
  },
  going_in_cap_rate_t12: {
    labels:
      /t[-_\s]?12.*cap|cap.*t[-_\s]?12|trailing.*cap|pp.*all[\s-]?in.*t12/i,
    prefer_sheets: /summary|return|basis|assumption/i,
  },
  going_in_cap_rate_y2: {
    labels: /(year\s*2|yr\s*2|y2).*cap|cap.*y2/i,
    prefer_sheets: /summary|return|basis|assumption/i,
  },
  going_in_cap_rate_y3: {
    labels: /(year\s*3|yr\s*3|y3).*cap|cap.*y3/i,
    prefer_sheets: /summary|return|basis|assumption/i,
  },
  stabilized_yield_on_cost: {
    labels: /stabilized\s*(yield|yoc)|yield\s*on\s*cost|yoc/i,
    prefer_sheets: /summary|return|assumption/i,
  },
  avg_yield: {
    labels: /avg\s*yield|average\s*yield/i,
    prefer_sheets: /summary|return|assumption/i,
    not_labels: /w\/?o\s*sale|unreturned|without/i,
  },
  avg_yield_w_o_sale: {
    labels: /avg.*yield.*(w\/?o|without)\s*sale|average\s*yield.*w\/?o\s*sale/i,
    prefer_sheets: /summary|return|assumption/i,
  },
  avg_yield_on_unreturned_equity: {
    labels: /avg.*yield.*unreturned|yield.*unreturned\s*equity/i,
    prefer_sheets: /summary|return|assumption/i,
  },
  yield_origination: {
    labels: /yield\s*\(?\s*orig|origination\s*yield|yield\s*at\s*orig/i,
    prefer_sheets: /summary|return|assumption/i,
  },
  yield_outstanding: {
    labels: /yield\s*\(?\s*o\/s|outstanding\s*yield|yield\s*on\s*outstanding/i,
    prefer_sheets: /summary|return|assumption/i,
  },
  yield_os_equity_y1_post_refi: {
    labels:
      /yield.*o\/s\s*equity.*y1|yield.*outstanding\s*equity.*y1|y1.*post\s*refi.*yield/i,
    prefer_sheets: /refi|summary|return/i,
  },

  levered_irr: {
    labels:
      /lev(er)?(ed|aged)?\s*irr|irr\s*\(?\s*lev(er)?(ed|aged)?|deal\s*level\s*irr/i,
    prefer_sheets: /summary|return/i,
    not_labels: /\bun[\s-]?lev|\blp\b|\bgp\b|investor|sponsor/i,
  },
  unlevered_irr: {
    labels: /unlev(er)?(ed|aged)?\s*irr|irr\s*\(?\s*unlev(er)?(ed|aged)?/i,
    prefer_sheets: /summary|return/i,
  },
  equity_multiple_levered: {
    labels:
      /lev(er)?(ed|aged)?\s*(em|equity\s*multiple|multiple)|(em|equity\s*multiple|multiple)\s*\(?\s*lev(er)?(ed|aged)?/i,
    prefer_sheets: /summary|return/i,
    not_labels:
      /\bun[\s-]?lev|\blp\b|\bgp\b|investor|sponsor|teaser|marketing|summary[\s-]?card/i,
  },
  equity_multiple_unlevered: {
    labels:
      /unlev(er)?(ed|aged)?\s*(em|equity\s*multiple|multiple)|(em|equity\s*multiple|multiple)\s*\(?\s*unlev(er)?(ed|aged)?/i,
    prefer_sheets: /summary|return/i,
  },
  lp_irr: {
    labels: /\blp\b.*irr|investor.*irr|limited.*irr|irr.*\blp\b|irr.*investor/i,
    prefer_sheets: /summary|return|partner|investor|waterfall/i,
    not_labels: /\bgp\b|general|sponsor|promote/i,
  },
  lp_equity_multiple: {
    labels:
      /\blp\b.*(em|equity\s*multiple|multiple)|investor.*(em|equity\s*multiple|multiple)|(em|equity\s*multiple|multiple).*\blp\b/i,
    prefer_sheets: /summary|return|partner|investor|waterfall/i,
    not_labels: /\bgp\b|general|sponsor|promote/i,
  },
  lp_avg_annual_cash_on_cash: {
    labels:
      /lp.*cash[\s-]?on[\s-]?cash|cash[\s-]?on[\s-]?cash.*lp|lp.*avg\s*annual|investor.*cash\s*yield/i,
    prefer_sheets: /partner|waterfall|investor|return|summary/i,
    not_labels: /\bgp\b|sponsor/i,
  },
  lp_peak_equity: {
    labels:
      /peak\s*equity|max(imum)?\s*equity\s*outstanding|peak\s*lp\s*equity/i,
    prefer_sheets: /partner|waterfall|investor/i,
  },
  lp_return_of_capital_date: {
    labels: /return\s*of\s*capital|roc\s*date|capital\s*returned/i,
    prefer_sheets: /partner|waterfall/i,
  },
  gp_irr: {
    labels: /\bgp\b.*irr|general.*irr|sponsor.*irr|promote.*irr|irr.*\bgp\b/i,
    prefer_sheets: /summary|return|partner|waterfall|sponsor/i,
    not_labels: /\blp\b|investor|limited/i,
  },
  gp_equity_multiple: {
    labels:
      /\bgp\b.*(em|equity\s*multiple|multiple)|general.*(em|equity\s*multiple|multiple)|sponsor.*(em|equity\s*multiple|multiple)/i,
    prefer_sheets: /summary|return|partner|waterfall|sponsor/i,
    not_labels: /\blp\b|investor|limited/i,
  },
  gp_promote_earned: {
    labels: /promote\s*earned|gp\s*promote|total\s*promote|carried\s*interest/i,
    prefer_sheets: /partner|waterfall|sponsor/i,
  },
  target_investor_irr: {
    labels:
      /target(ed)?\s*(investor\s*)?irr|underwritten\s*irr|underwritten\s*investor|target.*net.*irr/i,
    prefer_sheets: /summary|return|investor|assumption/i,
    not_labels: /pref|hurdle/i,
  },
  target_investor_em: {
    labels:
      /target(ed)?\s*(investor\s*)?(em|equity\s*multiple|multiple)|underwritten\s*(em|multiple)/i,
    prefer_sheets: /summary|return|investor|assumption/i,
  },

  bridge_loan_amount: {
    labels:
      /bridge.*loan.*(amount|principal|total)|bridge.*principal|bridge.*size/i,
    prefer_sheets: /loan|debt|financ|partner|assumption|term/i,
  },
  bridge_loan_proceeds_at_close: {
    labels:
      /bridge.*(draw|proceeds?|initial).*close|bridge.*proceeds?|initial\s*bridge\s*draw|bridge\s*draw\s*at\s*close/i,
    prefer_sheets: /loan|debt|financ|partner|assumption/i,
  },
  bridge_loan_rate_all_in: {
    labels:
      /bridge.*(all[\s-]?in\s*)?rate|bridge.*coupon|bridge.*interest\s*rate/i,
    prefer_sheets: /loan|debt|financ|term|assumption/i,
  },
  bridge_loan_spread_bps: {
    labels: /bridge.*spread|bridge.*margin|bridge.*bps/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  bridge_loan_index: {
    labels: /bridge.*(index|sofr|lib|treasury|base\s*rate)/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  bridge_loan_ltv: {
    labels: /bridge.*ltv|bridge.*loan[\s-]?to[\s-]?value/i,
    prefer_sheets: /loan|debt|financ|term|assumption/i,
  },
  bridge_loan_ltc: {
    labels: /bridge.*ltc|bridge.*loan[\s-]?to[\s-]?cost/i,
    prefer_sheets: /loan|debt|financ|term|assumption/i,
  },
  bridge_loan_maturity_date: {
    labels: /bridge.*maturity/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  bridge_loan_term_months: {
    labels: /bridge.*term|bridge.*months|bridge.*tenor/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  bridge_loan_io_period_months: {
    labels: /bridge.*\b(io|interest[\s-]?only)\b/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels:
      /equity|contribution|redemption|distribution|balance|draw|payoff|capital/i,
  },
  bridge_loan_amort_years: {
    labels: /bridge.*amort/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  bridge_loan_lender: {
    labels: /bridge.*lender|bridge.*bank/i,
    prefer_sheets: /loan|debt|financ|term|summary/i,
  },
  bridge_loan_origination_fee_pct: {
    labels: /bridge.*(origination\s*fee|orig\s*fee|upfront\s*fee|points)/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  bridge_loan_exit_fee_pct: {
    labels: /bridge.*exit\s*fee/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /\$|amount/i,
  },
  bridge_loan_exit_fee_amount: {
    labels: /bridge.*exit\s*fee\s*\$|bridge.*exit\s*fee\s*amount/i,
    prefer_sheets: /loan|debt|financ|term|refi/i,
  },
  bridge_loan_extension_options: {
    labels: /bridge.*extension/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  bridge_loan_rate_cap_strike: {
    labels: /bridge.*(rate\s*cap|cap\s*strike)/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /cost|premium|\$/i,
  },
  bridge_loan_rate_cap_cost: {
    labels: /bridge.*rate\s*cap.*(cost|premium|\$)/i,
    prefer_sheets: /loan|debt|financ|term|closing/i,
  },
  bridge_loan_swap_rate: {
    labels: /bridge.*swap/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /cost|break|\$/i,
  },
  bridge_loan_swap_cost: {
    labels: /bridge.*swap.*(cost|break|\$)/i,
    prefer_sheets: /loan|debt|financ|term|closing/i,
  },
  bridge_loan_prepay_terms: {
    labels: /bridge.*(prepay|prepayment|yield\s*maintenance|defeasance)/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },

  senior_loan_amount: {
    labels:
      /(senior|permanent|perm)\s*loan\s*(amount|principal|total)?|loan\s*amount|loan\s*principal|mortgage\s*amount|loan\s*proceeds?/i,
    prefer_sheets: /loan|debt|financ|term|assumption|source/i,
    not_labels:
      /bridge|mezz|construction|pref|initial|at\s*close|day[\s-]?1|first\s*draw/i,
  },
  senior_loan_initial_draw: {
    labels:
      /(senior\s*)?loan.*(initial|at\s*close|day[\s-]?1|first\s*draw|opening\s*draw|origination\s*draw|proceeds?\s*at\s*close|funding\s*at\s*close)|initial\s*(draw|funding|proceeds?)|day[\s-]?1.*loan|loan.*day[\s-]?1/i,
    prefer_sheets: /loan|debt|financ|term|source|use|assumption/i,
    not_labels: /bridge|mezz|capex|future|construction|^total|committed/i,
  },
  senior_loan_committed_amount: {
    labels:
      /(senior\s*)?loan.*(commit(ment|ted)?|total\s*loan\s*(amount|size)?|max(imum)?\s*loan|loan\s*max|future\s*tranches|fully\s*funded)|total\s*senior\s*loan|loan\s*total\s*commitment|loan\s*max\s*draw/i,
    prefer_sheets: /loan|debt|financ|term|source|use|assumption/i,
    not_labels: /bridge|mezz|construction|initial|at\s*close|day[\s-]?1/i,
  },
  interest_reserve_capitalized: {
    labels:
      /(capital(iz)?ed?|cap)\s*(interest|int(\.)?)\s*(reserve)?|interest\s*reserve|^\s*int\s*reserve\s*$|reserve.*(interest|int)|carry\s*reserve|holdback.*interest/i,
    prefer_sheets: /loan|debt|financ|source|use|reserve|assumption|term/i,
    not_labels:
      /property\s*tax|repair|replacement\s*reserve|operating\s*reserve|insurance/i,
  },
  oid_or_loan_fees: {
    labels:
      /\boid\b|original\s*issue\s*discount|loan\s*(origination|orig)\s*(fee|points?|cost)|origination\s*(fee|points?)|loan\s*fee|debt\s*fee|loan\s*points?|^\s*points?\s*$/i,
    prefer_sheets: /loan|debt|financ|source|use|term|closing/i,
    not_labels: /broker|legal|inspection|title|^closing\s*cost/i,
  },
  senior_loan_proceeds_at_close: {
    labels: /senior.*proceeds?|perm.*proceeds?|permanent.*proceeds?/i,
    prefer_sheets: /loan|debt|financ|source|assumption/i,
    not_labels: /bridge|mezz/i,
  },
  senior_loan_rate_all_in: {
    labels:
      /(senior|permanent|perm)\s*(loan\s*)?(all[\s-]?in\s*)?rate|(senior|permanent|perm)\s*(coupon|interest\s*rate)|interest\s*rate\s*\(all[\s-]?in\)|\bcoupon\b/i,
    prefer_sheets: /loan|debt|financ|term|assumption/i,
    not_labels: /bridge|mezz|construction|pref/i,
  },
  senior_loan_spread_bps: {
    labels:
      /(senior|permanent|perm)\s*spread|\bspread\b\s*over|\bmargin\b\s*over/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz/i,
  },
  senior_loan_index: {
    labels: /(index|sofr|lib|treasury|base\s*rate)/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz|construction/i,
  },
  senior_loan_ltv: {
    labels: /\bltv\b|loan[\s-]?to[\s-]?value/i,
    prefer_sheets: /loan|debt|financ|term|assumption/i,
    not_labels: /bridge|mezz|construction|stabilized/i,
  },
  senior_loan_ltc: {
    labels: /\bltc\b|loan[\s-]?to[\s-]?cost/i,
    prefer_sheets: /loan|debt|financ|term|assumption/i,
    not_labels: /bridge|mezz|construction/i,
  },
  senior_loan_maturity_date: {
    labels: /(maturity\s*date|loan\s*maturity)/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz/i,
  },
  senior_loan_term_months: {
    labels: /(senior|loan|perm)\s*term|loan\s*tenor/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz|construction/i,
  },
  senior_loan_io_period_months: {
    labels: /(io|interest[\s-]?only)\s*period|io\s*months/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz|construction/i,
  },
  senior_loan_amort_years: {
    labels:
      /amort(ization)?\s*(years?|period|term)|amortizing\s*(years?|period|term)/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels:
      /bridge|mezz|construction|yield|basis|\brate\b|fee|exit|origination|cost/i,
  },
  senior_loan_lender: {
    labels: /lender|bank\s*name|loan\s*from/i,
    prefer_sheets: /loan|debt|financ|term|summary/i,
    not_labels:
      /bridge|mezz|construction|pref|title|policy|endorsement|alta|clta/i,
    not_sheets: /closing|stmt|statement|title|policy|insurance/i,
  },
  senior_loan_origination_fee_pct: {
    labels: /(origination\s*fee|orig\s*fee|upfront\s*fee|points)/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz|construction/i,
  },
  senior_loan_exit_fee_pct: {
    labels: /exit\s*fee/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz|construction/i,
  },
  senior_loan_extension_options: {
    labels: /extension\s*(option|terms?)/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge/i,
  },
  senior_loan_prepay_terms: {
    labels: /prepay(ment)?|yield\s*maintenance|defeasance/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge/i,
  },
  senior_loan_rate_cap_strike: {
    labels: /(senior|perm).*(rate\s*cap|cap\s*strike)|rate\s*cap\s*strike/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz|cost|premium|\$/i,
  },
  senior_loan_rate_cap_cost: {
    labels:
      /(senior|perm).*rate\s*cap.*(cost|premium|\$)|rate\s*cap\s*(cost|premium)/i,
    prefer_sheets: /loan|debt|financ|term|closing/i,
    not_labels: /bridge|mezz/i,
  },
  senior_loan_swap_rate: {
    labels: /(senior|perm).*swap|swap\s*rate/i,
    prefer_sheets: /loan|debt|financ|term/i,
    not_labels: /bridge|mezz|cost|break|\$/i,
  },
  senior_loan_swap_cost: {
    labels: /(senior|perm).*swap.*(cost|break|\$)|swap\s*(cost|break)/i,
    prefer_sheets: /loan|debt|financ|term|closing/i,
    not_labels: /bridge|mezz/i,
  },

  mezz_loan_amount: {
    labels: /mezz(anine)?\s*(loan\s*)?(amount|principal)?/i,
    prefer_sheets: /loan|debt|financ|term|partner/i,
  },
  mezz_loan_rate_current: {
    labels: /mezz.*(current\s*rate|pay\s*rate|current\s*pay)/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  mezz_loan_rate_accrued: {
    labels: /mezz.*(accrued|accrual|pik)/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  mezz_loan_maturity_date: {
    labels: /mezz.*maturity/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  mezz_loan_lender: {
    labels: /mezz.*(lender|provider)/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  mezz_loan_origination_fee_pct: {
    labels: /mezz.*orig.*fee/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },

  construction_loan_amount: {
    labels: /construction\s*(loan\s*)?(amount|principal|proceeds)/i,
    prefer_sheets: /loan|debt|financ|term|summary/i,
    not_labels: /cost|capex|sum|spend|total\s*construction|hard\s*cost/i,
    not_sheets: /capex|closing|stmt|statement/i,
  },
  construction_loan_ltc: {
    labels: /construction.*ltc/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  construction_loan_rate: {
    labels: /construction.*rate/i,
    prefer_sheets: /loan|debt|financ|term/i,
  },
  construction_period_months: {
    labels: /construction\s*(period|months|tenor)/i,
    prefer_sheets: /loan|debt|financ|term|capex/i,
  },
  construction_loan_lender: {
    labels: /construction.*(lender|bank)/i,
    prefer_sheets: /loan|debt|financ|term|summary/i,
    not_labels: /title|policy|endorsement|alta|clta|reference/i,
    not_sheets: /closing|stmt|statement|title|policy|insurance/i,
  },

  pref_equity_amount: {
    labels: /pref(erred)?\s*equity\s*(amount|principal)?|pref\s*amount/i,
    prefer_sheets: /partner|equity|source/i,
  },
  pref_equity_rate: {
    labels: /pref(erred)?\s*equity\s*(rate|yield|return)|pref\s*rate/i,
    prefer_sheets: /partner|equity|source/i,
    not_labels: /return\s*due|preferred\s*return|waterfall\s*pref/i,
  },
  pref_equity_term_months: {
    labels: /pref(erred)?\s*equity\s*term/i,
    prefer_sheets: /partner|equity|source/i,
  },
  pref_equity_provider: {
    labels: /pref(erred)?\s*equity\s*(provider|partner)/i,
    prefer_sheets: /partner|equity/i,
  },

  total_debt_amount: {
    labels: /total\s*debt|total\s*loan|aggregate\s*debt/i,
    prefer_sheets: /loan|debt|financ|source|summary/i,
  },
  total_debt_proceeds_at_close: {
    labels: /total\s*(debt|loan)\s*proceeds?|cash\s*in\s*at\s*close/i,
    prefer_sheets: /loan|debt|financ|source/i,
  },
  debt_payoff_amount: {
    labels: /loan\s*payoff|debt\s*payoff|payoff\s*at\s*(sale|exit)/i,
    prefer_sheets: /return|summary|exit|assumption/i,
  },

  equity_required_total: {
    labels:
      /(total\s*)?equity\s*(required|investment)|initial\s*equity|total\s*(lp\s*\+\s*gp|partnership)\s*equity/i,
    prefer_sheets: /^assumption|^returns?\s*summary$|^partner/i,
    not_labels:
      /\blp\s*only\b|\bgp\s*only\b|coinvest|common\s*equity\s*(contribution|distribution)|total\s*common\s*equity|per\s*unit|vc\s*structure|average|cash\s*flow|yield|follow[\s-]*on/i,
    not_formula_regex: /\/\s*TOTALUnits/i,
  },
  total_lp_equity: {
    labels: /total\s*lp|lp\s*equity\s*(total|contribution)|lp\s*contribution/i,
    prefer_sheets: /partner|equity|source/i,
    not_labels: /\bgp\b|coinvest|pref/i,
  },
  total_gp_equity: {
    labels:
      /total\s*gp|gp\s*equity\s*(total|contribution)|gp\s*contribution|sponsor\s*contribution/i,
    prefer_sheets: /partner|equity|source/i,
    not_labels: /\blp\b|coinvest/i,
  },
  total_coinvest_equity: {
    labels: /co[\s-]?invest(ment)?|side\s*car/i,
    prefer_sheets: /partner|equity|source/i,
  },
  lp_equity_at_close: {
    labels:
      /lp\s*equity\s*(at\s*)?clos(e|ing)|lp\s*(capital|contribution)\s*(at\s*)?clos(e|ing)|lp\s*equity\s*funded\s*at\s*clos(e|ing)/i,
    prefer_sheets: /partner|equity|source/i,
    not_labels:
      /\bgp\b|sponsor|coinvest|pref|follow[\s-]?on|total\s*lp|lp\s*equity\s*total/i,
  },
  follow_on_flag: {
    labels: /follow[\s-]?on\s*(needed|required|\()/i,
    prefer_sheets: /partner|source|assumption/i,
  },
  follow_on_needed_amount: {
    labels:
      /follow[\s-]?on\s*(amount|\$)|additional\s*equity\s*(amount|\$)|capital\s*call\s*(amount|\$)/i,
    prefer_sheets: /partner|source|assumption/i,
  },

  preferred_return_pct: {
    labels: /pref(erred)?\s*return|\bpref\s*\(|pref\s*rate|hurdle\s*rate/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /pref\s*equity|tier\s*[234]|investor\s*[ab]|sponsor/i,
  },
  preferred_return_investor_a_pct: {
    labels: /pref.*investor\s*a|investor\s*a.*pref|pref\s*a/i,
    prefer_sheets: /partner|waterfall/i,
  },
  preferred_return_investor_b_pct: {
    labels: /pref.*investor\s*b|investor\s*b.*pref|pref\s*b/i,
    prefer_sheets: /partner|waterfall/i,
  },
  preferred_return_sponsor_pct: {
    labels: /pref.*sponsor|sponsor.*pref/i,
    prefer_sheets: /partner|waterfall/i,
  },
  waterfall_tier_1_split_lp: {
    labels: /tier\s*1.*lp|lp.*tier\s*1|after\s*pref.*lp/i,
    prefer_sheets: /partner|waterfall/i,
  },
  waterfall_tier_1_split_gp: {
    labels: /tier\s*1.*gp|gp.*tier\s*1|after\s*pref.*gp|promote\s*tier\s*1/i,
    prefer_sheets: /partner|waterfall/i,
  },
  waterfall_tier_2_hurdle: {
    labels: /tier\s*2.*hurdle|hurdle\s*2|second\s*hurdle/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\bsplit\b|\blp\b|\bgp\b|promote|catch[\s-]?up/i,
  },
  waterfall_tier_2_split_lp: {
    labels: /tier\s*2.*lp|lp.*tier\s*2|hurdle\s*2.*lp|lp.*hurdle\s*2/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\bgp\b|general|sponsor/i,
  },
  waterfall_tier_2_split_gp: {
    labels:
      /tier\s*2.*gp|gp.*tier\s*2|promote\s*tier\s*2|hurdle\s*2.*gp\s*split|hurdle\s*2.*split/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\blp\b|investor|limited/i,
  },
  waterfall_tier_3_hurdle: {
    labels: /tier\s*3.*hurdle|hurdle\s*3|third\s*hurdle/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\bsplit\b|\blp\b|\bgp\b|promote|catch[\s-]?up/i,
  },
  waterfall_tier_3_split_lp: {
    labels: /tier\s*3.*lp|lp.*tier\s*3|hurdle\s*3.*lp|lp.*hurdle\s*3/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\bgp\b|general|sponsor/i,
  },
  waterfall_tier_3_split_gp: {
    labels:
      /tier\s*3.*gp|gp.*tier\s*3|promote\s*tier\s*3|hurdle\s*3.*gp\s*split|hurdle\s*3.*split/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\blp\b|investor|limited/i,
  },
  waterfall_tier_4_hurdle: {
    labels: /tier\s*4.*hurdle|hurdle\s*4|fourth\s*hurdle/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\bsplit\b|\blp\b|\bgp\b|promote|catch[\s-]?up/i,
  },
  waterfall_tier_4_split_lp: {
    labels: /tier\s*4.*lp|lp.*tier\s*4|hurdle\s*4.*lp/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\bgp\b|general|sponsor/i,
  },
  waterfall_tier_4_split_gp: {
    labels: /tier\s*4.*gp|gp.*tier\s*4|promote\s*tier\s*4|hurdle\s*4.*split/i,
    prefer_sheets: /partner|waterfall/i,
    not_labels: /\blp\b|investor|limited/i,
  },
  catchup_provision_tier_1_pct: {
    labels:
      /catch[\s-]?up.*tier\s*1|tier\s*1.*catch[\s-]?up|catch[\s-]?up\s*provision\s*1/i,
    prefer_sheets: /partner|waterfall/i,
  },
  catchup_provision_tier_2_pct: {
    labels: /catch[\s-]?up.*tier\s*2|tier\s*2.*catch[\s-]?up/i,
    prefer_sheets: /partner|waterfall/i,
  },
  catchup_provision_tier_3_pct: {
    labels: /catch[\s-]?up.*tier\s*3|tier\s*3.*catch[\s-]?up/i,
    prefer_sheets: /partner|waterfall/i,
  },
  catchup_provision_tier_4_pct: {
    labels: /catch[\s-]?up.*tier\s*4|tier\s*4.*catch[\s-]?up/i,
    prefer_sheets: /partner|waterfall/i,
  },
  promote_description: {
    labels:
      /promote\s*(structure|description|summary)|waterfall\s*(structure|description)/i,
    prefer_sheets: /partner|waterfall/i,
  },
  waterfall_investor_class_count: {
    labels:
      /(total\s*)?investor\s*classes?|number\s*of\s*(investor\s*)?classes/i,
    prefer_sheets: /partner|waterfall|summary/i,
  },

  strategy_description: {
    labels: /strategy|business\s*plan|investment\s*thesis|deal\s*type/i,
    prefer_sheets: /assumption|cover|cim|summary|input/i,
  },
  exit_strategy: {
    labels: /exit\s*strategy|disposition\s*strategy|exit\s*plan/i,
    prefer_sheets: /assumption|cover|cim|exit|summary/i,
  },
  hold_period_years: {
    labels: /hold\s*period.*year|hold.*\(\s*years?\s*\)|\bhold\b.*yr/i,
    prefer_sheets: /summary|return|assumption/i,
    not_labels: /month/i,
  },
  renovation_scope_description: {
    labels: /renovation\s*(scope|description)|scope\s*of\s*work|reno\s*plan/i,
    prefer_sheets: /assumption|cover|capex|cim/i,
  },
  stabilization_date_target: {
    labels: /stabiliz(ation|ed)\s*(date|target)|lease[\s-]?up\s*complete/i,
    prefer_sheets: /assumption|cover|summary/i,
  },

  sale_date: {
    labels: /sale\s*date|disposition\s*date|exit\s*date/i,
    prefer_sheets: /assumption|input|return|summary|exit/i,
  },
  sale_price: {
    labels:
      /sale\s*price|disposition\s*price|exit\s*price|sale\s*proceeds|reversion\s*value/i,
    prefer_sheets: /summary|return|exit|disposition/i,
  },
  disposition_fee_pct: {
    labels: /disposition\s*fee(\s*\(?\s*%)?/i,
    prefer_sheets: /assumption|partner|exit/i,
  },
  broker_commission_pct: {
    labels: /broker\s*(commission|fee)|sales?\s*commission/i,
    prefer_sheets: /assumption|exit|summary/i,
  },
  transfer_tax_pct: {
    labels: /transfer\s*tax(\s*\(?\s*%)?/i,
    prefer_sheets: /assumption|closing|exit/i,
    not_labels: /\$|amount/i,
  },
  selling_costs_pct: {
    labels: /selling\s*costs?\s*(\(?\s*%|pct)|disposition\s*costs?\s*%/i,
    prefer_sheets: /assumption|exit|summary/i,
  },
  selling_costs_amount: {
    labels: /selling\s*costs?\s*(\$|amount)|disposition\s*costs?\s*\$/i,
    prefer_sheets: /exit|summary|return/i,
  },
  terminal_noi: {
    labels: /terminal\s*noi|exit\s*noi|reversion\s*noi/i,
    prefer_sheets: /exit|return|summary/i,
    not_labels: /tax.*adj/i,
  },
  terminal_noi_tax_adj: {
    labels: /terminal\s*noi.*tax|tax[\s-]?adj.*terminal\s*noi/i,
    prefer_sheets: /exit|return|summary/i,
  },
  disposition_proceeds_gross: {
    labels:
      /gross\s*proceeds|disposition\s*proceeds.*pre\s*debt|sale\s*proceeds.*gross/i,
    prefer_sheets: /exit|return|summary/i,
  },
  disposition_proceeds_net: {
    labels:
      /est\.?\s*net\s*proceeds|net\s*proceeds.*sale|disposition\s*proceeds.*net/i,
    prefer_sheets: /exit|return|summary/i,
  },
  refi_date: {
    labels: /refi(nance)?\s*date/i,
    prefer_sheets: /refi|financ|summary|assumption/i,
  },
  refi_proceeds: {
    labels: /refi(nance)?\s*proceeds\b|proceeds\s*(from\s*)?refi(nance)?/i,
    prefer_sheets: /refi|financ|summary|assumption/i,
    not_labels: /outstanding|remaining|balance|cashout/i,
  },
  refi_new_loan_amount: {
    labels: /refi(nance)?.*(loan|principal|amount)|new\s*loan.*refi/i,
    prefer_sheets: /refi|financ|loan|debt/i,
  },
  refi_cashout_amount: {
    labels: /(post\s*)?refi.*cashout|cashout.*refi|refi.*distribution/i,
    prefer_sheets: /refi|partner|return/i,
  },
  outstanding_equity_post_refi: {
    labels:
      /outstanding\s*equity.*post\s*refi|remaining\s*(lp\s*)?equity.*refi|remaining\s*bridge\s*equity/i,
    prefer_sheets: /refi|partner|summary/i,
  },
  replacements_reserves_at_exit: {
    labels: /(replacements?|reserves?).*(at\s*)?exit/i,
    prefer_sheets: /assumption|return|exit/i,
  },

  rent_growth_pct: {
    labels:
      /rent\s*growth\s*(\(?\s*%|rate)?|rental\s*growth|revenue\s*growth.*%/i,
    prefer_sheets: /assumption|input/i,
    not_labels: /\$/i,
  },
  rent_growth_dollar: {
    labels: /rent\s*growth\s*\(?\s*\$/i,
    prefer_sheets: /assumption|input/i,
  },
  expense_growth_pct: {
    labels: /expense\s*growth|opex\s*growth|operating.*growth/i,
    prefer_sheets: /assumption|input/i,
  },
  tax_escalation_pct: {
    labels: /(re\s*)?tax\s*(escalat|growth|increase)/i,
    prefer_sheets: /assumption|input/i,
  },
  vacancy_pct: {
    labels: /vacancy|vacant|economic\s*loss/i,
    prefer_sheets: /assumption|input/i,
    not_labels: /loss/i,
  },
  other_income_pct: {
    labels: /other\s*income.*%|other\s*income.*gpr/i,
    prefer_sheets: /assumption|input/i,
  },
  management_fee_pct: {
    labels: /(property\s*)?management\s*fee.*%|\bpm\s*fee\b/i,
    prefer_sheets: /assumption|input/i,
    not_labels:
      /cumulative|\bam\s*\/?\s*pm\b|\bam\s*(and|\&|\+)\s*pm\b|minimum/i,
  },
  am_fee_pct: {
    labels: /asset\s*management\s*fee|\bam\s*fee\b(?!.*min)/i,
    prefer_sheets: /assumption|input|partner/i,
  },
  cumulative_am_pm_fee_pct: {
    labels: /cumulative\s*am\s*(\&|\+|\/)\s*pm|combined\s*am.*pm\s*fee/i,
    prefer_sheets: /assumption|partner/i,
  },
  per_bed_pm_fee: {
    labels:
      /per\s*bed\s*pm|pm\s*fee\s*(per|\/)\s*bed|property\s*management.*\/\s*bed/i,
    prefer_sheets: /assumption|partner/i,
  },
  lease_up_fee: {
    labels: /lease[\s-]?up\s*fee/i,
    prefer_sheets: /assumption|input/i,
  },
  min_am_fee: {
    labels: /min(imum)?\s*am\s*fee|min\s*asset\s*management/i,
    prefer_sheets: /assumption|input|partner/i,
  },
  acquisition_fee_pct: {
    labels:
      /acquisition\s*fee\s*\(?\s*%|acq\s*fee\s*\(?\s*%|sponsor\s*fee\s*\(?\s*%/i,
    prefer_sheets: /assumption|partner|basis/i,
    not_labels: /amount|\$/i,
  },
  vc_acquisition_fee_pct: {
    labels: /vc\s*acquisition\s*fee|valiance.*acquisition\s*fee/i,
    prefer_sheets: /assumption|partner/i,
  },
  construction_management_fee_pct: {
    labels: /construction\s*management\s*fee|cm\s*fee/i,
    prefer_sheets: /assumption|capex|partner/i,
  },
  replacement_reserve_per_unit: {
    labels: /replacement\s*reserve.*unit|reserves?.*per\s*unit/i,
    prefer_sheets: /assumption|input/i,
  },
  renewal_probability_pct: {
    labels: /renewal\s*probability|renewal\s*rate|tenant\s*renewal/i,
    prefer_sheets: /assumption|input/i,
  },
  loss_to_lease_assumption_pct: {
    labels: /loss[\s-]?to[\s-]?lease\s*(assumption|\()/i,
    prefer_sheets: /assumption|input/i,
  },
  vacancy_initial_pct: {
    labels:
      /vacancy.*initial|initial.*vacancy|vacancy\s*\(of\s*gpr\)\s*\(?initial\)?/i,
    prefer_sheets: /assumption|input/i,
    not_labels: /stabilized|trended|year\s*[2-9]|year\s*10/i,
  },
  vacancy_stabilized_pct: {
    labels: /vacancy.*stabiliz|stabiliz.*vacancy/i,
    prefer_sheets: /assumption|input/i,
    not_labels: /initial|trended|year\s*[2-9]|year\s*10/i,
  },
  lease_up_fee_pct: {
    labels:
      /lease[\s-]?up\s*fee.*%|lease[\s-]?up.*pct|lease[\s-]?up\s*fee.*rate/i,
    prefer_sheets: /assumption|input/i,
    not_labels: /sizing|display|projection|estimate|secondary/i,
  },

  other_income_application_fees: {
    labels: /application\s*fees?/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_late_nsf_fees: {
    labels: /late\s*fees?|nsf\s*fees?|late\s*\/\s*nsf/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_pet_rent: {
    labels: /pet\s*(rent|fees?)/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_termination_fees: {
    labels: /termination\s*fees?|early\s*termination/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_rubs: {
    labels:
      /\brubs?\b|ratio\s*utility\s*bill[\s-]?back|utility\s*bill[\s-]?back|oinc.*rubs/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_parking: {
    labels: /parking\s*(income|rent)/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_laundry: {
    labels: /laundry(\s*income)?/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_forfeited_deposits: {
    labels: /forfeited\s*deposits?|forteited\s*deposits?/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_misc: {
    labels: /other\s*income.*misc|oinc.*misc|misc.*other\s*income/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },

  opex_property_tax: {
    labels: /property\s*tax(es)?|real\s*estate\s*tax|re\s*tax/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
    not_labels: /growth|escalat|assessment/i,
  },
  opex_pm_fee_dollar: {
    labels:
      /(property\s*)?management\s*fee\s*\$|pm\s*fee\s*\$|pm\s*fee\s*amount/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
    not_labels: /%/i,
  },
  opex_insurance: {
    labels: /insurance/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
    not_labels: /growth/i,
  },
  opex_admin_berk_tax: {
    labels:
      /admin\s*\/\s*berk\s*tax|business\s*license|berkeley\s*business\s*tax/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_business_tax: {
    labels:
      /business\s*tax\s*(expense|amount|annual|\$)?|city\s*business\s*tax\s*(expense|amount|annual|\$)?/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
    not_labels:
      /property|real\s*estate|berk|basis|assessment|valuation|assessed|purchase\s*price|\brate\b|\bpercent|%|fraction/i,
  },
  opex_utilities: {
    labels: /utilit(y|ies)/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_util_pge: {
    labels: /\bpg\&?e\b|pacific\s*gas.*electric|electric\s*&?\s*gas/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_util_water_sewer: {
    labels: /water\s*(\&|and)\s*sewer|water\s*\/\s*sewer/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_util_trash: {
    labels: /trash\s*(\&|and)\s*recycling|garbage|waste/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_util_internet: {
    labels: /internet|wi[\s-]?fi|cable/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_fire_alarm: {
    labels: /fire\s*alarm/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_security_alarm: {
    labels: /security\s*(\&|and)?\s*alarm|security\s*monitoring/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
    not_labels: /fire/i,
  },
  opex_salaries: {
    labels: /salaries|payroll|wages/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_landscaping: {
    labels: /landscaping|lawn\s*care|grounds/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_pest_control: {
    labels: /pest\s*control|exterminat/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_elevator: {
    labels: /elevator(\s*maint(enance)?)?/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_janitorial: {
    labels: /janitorial|cleaning/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_management_fee: {
    labels: /(property\s*)?management\s*fee|\bpm\s*fee\b/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
    not_labels: /%/i,
  },
  opex_repairs_maintenance: {
    labels: /repairs?\s*(\&|and)\s*maint|\br\s*&?\s*m\b|maintenance/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  opex_repairs_maintenance_residential: {
    labels: /repairs?\s*(\&|and)\s*maint|\br\s*&?\s*m\b|maintenance/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
    not_labels: /\brtl\s*only\b|\bretail\s*only\b|\ball\b/i,
  },
  opex_repairs_maintenance_retail: {
    labels: /repairs?\s*(\&|and)\s*maint|\br\s*&?\s*m\b|maintenance/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
    not_labels: /\bres\s*only\b|\ball\b/i,
  },
  opex_repairs_maintenance_all: {
    labels: /repairs?\s*(\&|and)\s*maint|\br\s*&?\s*m\b|maintenance/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
    not_labels: /\bres\s*only\b|\brtl\s*only\b|\bretail\s*only\b/i,
  },
  opex_turnover: {
    labels: /turnover(\s*(costs?|expenses?|fees?))?/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_admin_ga: {
    labels: /admin(istrative)?|\bg\s*&?\s*a\b|general\s*(\&|and)\s*admin/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
    not_labels: /berk|business/i,
  },
  opex_marketing: {
    labels: /marketing|advertising|promotion/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  opex_replacements_reserves_monthly: {
    labels: /replacements?\s*\/\s*reserves?.*monthly|monthly\s*reserves?/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_rhsp_registration: {
    labels: /\brhsp\b|rent\s*stabilization.*registration|rent\s*stab.*fee/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },
  opex_rent_board_fee: {
    labels: /rent\s*board\s*fee|rent\s*stabilization\s*fee/i,
    prefer_sheets: /noi|financial|budget|historicals|assumption/i,
  },

  water_total_bill_annual: {
    labels: /water.*total\s*bill/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  water_gallons_annual: {
    labels: /water.*(total\s*)?gallons/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  water_gallons_per_day: {
    labels: /gallons\s*per\s*day|gpd/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },

  gpr_annual: {
    labels: /gross\s*potential\s*rent|\bgpr\b/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  vacancy_loss_annual: {
    labels: /(less:?\s*)?vacancy(\s*loss)?|vacancy\s*\&\s*credit/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  net_potential_rent_annual: {
    labels: /net\s*potential\s*rent|\bnpr\b|net\s*collected\s*rent/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  other_income_total: {
    labels: /(total\s*)?other\s*income|total\s*oinc/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  egi_annual: {
    labels: /effective\s*gross\s*(income|revenue)|\begi\b/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  opex_total: {
    labels: /total\s*(operating\s*)?expenses?|total\s*opex/i,
    prefer_sheets: /noi|financial|budget|historicals/i,
  },
  noi_t12: {
    labels: /noi.*t[-\s_]?12|t[-\s_]?12.*noi|trailing.*noi/i,
    prefer_sheets: /noi|financial|budget|historicals|summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y1: {
    labels: /noi.*(year\s*1|yr\s*1|y1)|(year\s*1|yr\s*1|y1).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y2: {
    labels: /noi.*(year\s*2|yr\s*2|y2)|(year\s*2|yr\s*2|y2).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y3: {
    labels: /noi.*(year\s*3|yr\s*3|y3)|(year\s*3|yr\s*3|y3).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y4: {
    labels: /noi.*(year\s*4|yr\s*4|y4)|(year\s*4|yr\s*4|y4).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y5: {
    labels: /noi.*(year\s*5|yr\s*5|y5)|(year\s*5|yr\s*5|y5).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y6: {
    labels: /noi.*(year\s*6|yr\s*6|y6)|(year\s*6|yr\s*6|y6).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y7: {
    labels: /noi.*(year\s*7|yr\s*7|y7)|(year\s*7|yr\s*7|y7).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y8: {
    labels: /noi.*(year\s*8|yr\s*8|y8)|(year\s*8|yr\s*8|y8).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y9: {
    labels: /noi.*(year\s*9|yr\s*9|y9)|(year\s*9|yr\s*9|y9).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_y10: {
    labels: /noi.*(year\s*10|yr\s*10|y10)|(year\s*10|yr\s*10|y10).*noi/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y1: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*1|yr\s*1|y1)|(year\s*1|yr\s*1|y1).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y2: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*2|yr\s*2|y2)|(year\s*2|yr\s*2|y2).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y3: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*3|yr\s*3|y3)|(year\s*3|yr\s*3|y3).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y4: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*4|yr\s*4|y4)|(year\s*4|yr\s*4|y4).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y5: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*5|yr\s*5|y5)|(year\s*5|yr\s*5|y5).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y6: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*6|yr\s*6|y6)|(year\s*6|yr\s*6|y6).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y7: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*7|yr\s*7|y7)|(year\s*7|yr\s*7|y7).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y8: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*8|yr\s*8|y8)|(year\s*8|yr\s*8|y8).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y9: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*9|yr\s*9|y9)|(year\s*9|yr\s*9|y9).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  levered_cf_y10: {
    labels:
      /levered.*(cash\s*flow|cf).*(year\s*10|yr\s*10|y10)|(year\s*10|yr\s*10|y10).*levered.*(cash\s*flow|cf)/i,
    prefer_sheets: /returns\s*summary/i,
    not_labels: /unlev|sizing|display|secondary|header|projection|estimate/i,
  },
  noi_stabilized: {
    labels: /stabiliz(ed|ation)\s*noi|noi.*stabiliz/i,
    prefer_sheets: /noi|financial|summary|budget/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  noi_peak: {
    labels: /peak\s*noi|noi\s*\(?\s*peak/i,
    prefer_sheets: /noi|financial|summary/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
  },
  debt_service_annual: {
    labels: /debt\s*service|annual\s*debt\s*service|\bds\b/i,
    prefer_sheets: /loan|debt|financial|noi|summary|assumption/i,
  },

  closing_cost_title: {
    labels: /title(\s*insurance)?/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_escrow: {
    labels: /escrow(\s*fees?)?/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_recording: {
    labels: /recording\s*(fees?)?/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_transfer_tax: {
    labels: /transfer\s*tax\s*(\$|amount)?|county\s*transfer|city\s*transfer/i,
    prefer_sheets: /closing|cost|basis/i,
    not_labels: /%|pct|rate/i,
  },
  closing_cost_prorations: {
    labels: /proration(s)?/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_legal: {
    labels: /legal(?!.*lender)|(acquisition|acq)\s*legal|counsel/i,
    prefer_sheets: /closing|cost|basis/i,
    not_labels: /lender/i,
  },
  closing_cost_lender_legal: {
    labels: /lender\s*legal|lender('?s)?\s*counsel/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_due_diligence: {
    labels: /due\s*diligence|\bdd\b|inspection/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_financing_fees: {
    labels: /financing\s*fees?|loan\s*fees?|origination\s*fees?|points/i,
    prefer_sheets: /closing|cost|basis/i,
    not_labels: /bridge.*orig|senior.*orig/i,
  },
  closing_cost_survey: {
    labels: /survey/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_environmental: {
    labels: /environmental|phase\s*i|phase\s*ii|esa/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_appraisal: {
    labels: /appraisal/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_acquisition_fee: {
    labels: /acquisition\s*fee|acq\s*fee|sponsor\s*fee/i,
    prefer_sheets: /closing|cost|basis|partner/i,
    not_labels: /\(\s*%\s*\)|percent|rate/i,
  },
  closing_cost_rate_cap: {
    labels: /rate\s*cap(?!\s*strike)/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_swap: {
    labels: /\bswap\b|\binterest\s*rate\s*swap\b/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_zoning: {
    labels: /zoning\s*(study|report|opinion)/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_insurance_binder: {
    labels: /insurance\s*binder|insurance\s*premium\s*at\s*close/i,
    prefer_sheets: /closing|cost|basis/i,
  },
  closing_cost_other: {
    labels: /other\s*closing|misc.*closing|other\s*costs?/i,
    prefer_sheets: /closing|cost|basis/i,
  },

  capex_interior_renovation: {
    labels: /interior\s*(reno|renovation)|unit\s*interior/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_exterior_renovation: {
    labels: /exterior\s*(reno|renovation)|building\s*exterior/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_common_area: {
    labels: /common\s*area/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_mechanical_electrical_plumbing: {
    labels: /\bmep\b|mechanical.*electrical.*plumbing|plumbing|hvac/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_building_systems: {
    labels: /building\s*systems?|roof|life\s*safety/i,
    prefer_sheets: /capex|cost|basis/i,
    not_labels: /fire\s*sprinkler|alarm/i,
  },
  capex_soft_costs: {
    labels: /soft\s*costs?|architect|\bgc\s*fee\b|permits?|engineering/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_contingency: {
    labels: /contingency/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_appliances: {
    labels: /appliance(s)?|range|refrigerator|dishwasher/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_kitchen: {
    labels: /kitchen\s*(reno|upgrade|cabinet|countertop)?/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_bath: {
    labels: /bath(room)?\s*(reno|upgrade|tile|fixture)?/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_flooring: {
    labels: /flooring|carpet|lvt|tile/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_windows: {
    labels: /windows?|glazing/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_landscape_hardscape: {
    labels: /landscape\s*\/\s*hardscape|hardscaping|site\s*work/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_elevator: {
    labels: /elevator\s*(modernization|reno|replace)/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_life_safety: {
    labels: /life\s*safety|fire\s*sprinkler|alarm\s*system/i,
    prefer_sheets: /capex|cost|basis/i,
  },
  capex_per_unit: {
    labels: /capex\s*\/\s*unit|capex\s*per\s*unit/i,
    prefer_sheets: /capex|cost|basis/i,
  },

  valuation_as_is: {
    labels: /as[\s-]?is\s*(value|valuation|appraisal)/i,
    prefer_sheets: /valuation|appraisal|summary/i,
  },
  valuation_stabilized: {
    labels: /stabiliz(ed|ation)\s*(value|valuation)|projected\s*value/i,
    prefer_sheets: /valuation|appraisal|summary|return/i,
  },
  valuation_current_appraised: {
    labels: /current\s*(value|valuation|appraisal)|appraised\s*value/i,
    prefer_sheets: /valuation|appraisal|summary/i,
  },
  valuation_ltsv: {
    labels: /\bltsv\b|loan[\s-]?to[\s-]?stabilized[\s-]?value/i,
    prefer_sheets: /loan|debt|valuation/i,
  },
  valuation_appraisal_date: {
    labels: /appraisal\s*date|date\s*of\s*appraisal/i,
    prefer_sheets: /valuation|appraisal/i,
  },
  valuation_appraiser: {
    labels: /appraiser(\s*name)?|appraisal\s*firm/i,
    prefer_sheets: /valuation|appraisal/i,
  },

  milestone_acquisition_close: {
    labels: /(acquisition|purchase|closing)\s*(close|date)/i,
    prefer_sheets: /assumption|schedule/i,
  },
  milestone_construction_start: {
    labels: /construction\s*start|\bgc\s*start\b|reno\s*start/i,
    prefer_sheets: /assumption|capex|schedule/i,
  },
  milestone_construction_complete: {
    labels: /construction\s*complete|reno\s*complete/i,
    prefer_sheets: /assumption|capex|schedule/i,
  },
  milestone_stabilization_target: {
    labels: /stabiliz(ation|ed)\s*(date|target)/i,
    prefer_sheets: /assumption|schedule/i,
  },
  milestone_lease_up_complete: {
    labels: /lease[\s-]?up\s*complete/i,
    prefer_sheets: /assumption|schedule/i,
  },
  milestone_refi_planned: {
    labels: /refi(nance)?\s*planned|planned\s*refi/i,
    prefer_sheets: /refi|financ|schedule|assumption/i,
  },
  milestone_refi_actual: {
    labels: /refi(nance)?\s*actual|actual\s*refi/i,
    prefer_sheets: /refi|financ|schedule/i,
  },
  milestone_sale_target: {
    labels:
      /sale\s*(target|date)|disposition\s*(target|date)|exit\s*(target|date)/i,
    prefer_sheets: /assumption|exit|return|schedule/i,
  },

  cost_seg_total_basis: {
    labels:
      /(cost\s*seg.*basis|total\s*basis.*cost\s*seg|depreciable\s*basis)/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  cost_seg_land_allocation_pct: {
    labels: /land\s*allocation|land\s*%/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  cost_seg_building_allocation_pct: {
    labels: /building\s*allocation|building\s*%/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  cost_seg_study_date: {
    labels: /cost\s*seg.*date|study\s*date/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  cost_seg_study_provider: {
    labels: /cost\s*seg.*(provider|firm|consultant)/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  cost_seg_y1_accelerated_depreciation: {
    labels:
      /(y1|year\s*1).*accelerated|accelerated.*(y1|year\s*1)|\b1st\s*year\s*depreciation/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  cost_seg_total_accelerated_depreciation: {
    labels: /total\s*accelerated|cumulative\s*accelerated/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  cost_seg_tax_benefit_y1: {
    labels: /tax\s*benefit\s*(y1|year\s*1)|y1\s*tax\s*benefit/i,
    prefer_sheets: /cost\s*seg|tax/i,
  },
  property_tax_assessed_value: {
    labels: /(property\s*tax\s*)?assessment|assessed\s*value/i,
    prefer_sheets: /tax|assumption/i,
  },
  property_tax_rate_pct: {
    labels: /property\s*tax\s*rate|effective\s*tax\s*rate/i,
    prefer_sheets: /tax|assumption/i,
  },

  rent_control_jurisdiction: {
    labels: /rent\s*(control|board).*(jurisdiction|name)|rent\s*board/i,
    prefer_sheets: /assumption|permit|unit/i,
  },
  rent_control_last_increase_date: {
    labels: /rent\s*(control|board).*(last\s*increase|increase\s*date)/i,
    prefer_sheets: /assumption|permit|unit/i,
  },
  rent_control_max_increase_pct: {
    labels:
      /(max|maximum)\s*(allowed\s*)?(rent\s*)?increase|aga\s*cap|annual\s*general\s*adjustment/i,
    prefer_sheets: /assumption|permit|unit/i,
  },
  zoning_designation: {
    labels: /zoning(\s*designation|\s*code|\s*district)?|\bzone\b/i,
    prefer_sheets: /assumption|permit|cover/i,
    not_labels: /alta|endorsement|policy|reference|title|insurance|survey/i,
  },
  permit_count_last_10yr: {
    labels: /permit\s*count|total\s*permits|permits\s*issued/i,
    prefer_sheets: /permit|history/i,
  },
  last_major_permit_date: {
    labels: /last\s*(major\s*)?permit|most\s*recent\s*permit/i,
    prefer_sheets: /permit|history/i,
  },
  rhsp_registration_status: {
    labels:
      /\brhsp\b\s*(status|registered)?|rent\s*stabilization\s*(status|registered)/i,
    prefer_sheets: /assumption|permit/i,
  },

  operating_reserve_at_close: {
    labels: /operating\s*reserve|\bop\s*reserve\b|working\s*capital\s*reserve/i,
    prefer_sheets: /source|use|closing|basis|assumption/i,
  },
  debt_service_reserve: {
    labels: /debt\s*service\s*reserve|\bdsr\b/i,
    prefer_sheets: /source|use|loan|debt|closing/i,
  },
  ti_lc_reserve: {
    labels:
      /ti\s*\/\s*lc|ti\s*reserve|lc\s*reserve|tenant\s*improvement|leasing\s*commission/i,
    prefer_sheets: /source|use|closing|assumption/i,
  },
  capex_reserve: {
    labels: /capex\s*reserve|capital\s*reserve/i,
    prefer_sheets: /source|use|closing|capex|assumption/i,
  },
  replacement_reserve: {
    labels: /replacement\s*reserve(?!\s*\/\s*unit)/i,
    prefer_sheets: /source|use|closing|assumption/i,
    not_labels: /per\s*unit|\/\s*unit/i,
  },
  interest_reserve: {
    labels: /interest\s*reserve/i,
    prefer_sheets: /source|use|loan|debt|closing/i,
  },

  hedge_instrument_type: {
    labels: /hedge\s*(instrument|type)|swap|rate\s*cap/i,
    prefer_sheets: /loan|debt|term/i,
  },
  hedge_term_months: {
    labels: /hedge\s*(term|period)|swap\s*term|rate\s*cap\s*term/i,
    prefer_sheets: /loan|debt|term/i,
  },
  hedge_notional_amount: {
    labels: /hedge\s*notional|swap\s*notional|rate\s*cap\s*notional/i,
    prefer_sheets: /loan|debt|term/i,
  },
};

const HEADER_TEXT_RE =
  /^(lender\s*name|property\s*name|deal\s*name|address|street\s*address|city|state|zip|county|neighborhood|submarket|market|year\s*built|units?|beds?|sf|rsf|gsf|lot\s*size|purchase\s*price|closing\s*costs?|capex|basis|all[\s-]?in\s*basis|loan\s*amount|loan\s*proceeds?|equity|equity\s*required|irr|em|equity\s*multiple|multiple|cap\s*rate|terminal\s*cap|hold\s*period|rent\s*growth|vacancy|rate|ltv|ltc|maturity|purchase\s*date|sale\s*date|notes?|interest\s*rate(\s*\(\s*%\s*\))?|all[\s-]?in\s*rate|all[\s-]?in|spread(\s*\(.*\))?|index|rate\s*floor|rate\s*ceiling|cap\s*strike|amortization|amort|i[\s\/-]?o\s*period|loan\s*type|loan\s*term|term|maturity\s*date|principal|origination|exit\s*fee)$/i;

const META_TEXT_RE =
  /^(last\s*updated?|updated?|tbd|tba|n\s*\/\s*a|na|none|--+|—+|see\s*(notes?|above|below|tab|sheet|attached)|click\s*here|enter\s*here|placeholder|example|sample|template|input\s*here|fill\s*in|to\s*be\s*determined|to\s*be\s*added|null|n[\/.]a)$/i;

function isLikelyHeader(node) {
  if (typeof node.value_text !== "string") return false;
  const t = node.value_text.trim();
  if (!t || t.length > 80) return false;
  return HEADER_TEXT_RE.test(t);
}

function isLikelyMetaText(node) {
  if (typeof node.value_text !== "string") return false;
  const t = node.value_text.trim();
  if (!t || t.length > 80) return false;
  return META_TEXT_RE.test(t);
}

const EXCLUDED_SHEET_RE = /^claude\b|\bclaude\s*\(|^cim\s*uw$|\(cim\s*uw\)$/i;

const SCENARIO_SHEET_RE =
  /refi\s*analysis|refi[\s-]scenario|recap[\s-]scenario|disposition[\s-]scenario/i;

const NON_CANONICAL_NOISE_PATTERNS = [
  /^total\s*\/\s*wtd\s*avg$/i,
  /^rental\s*income\s*and\s*unit\s*mix\s*summary$/i,
  /^unit\s*config$/i,
  /^stabilized\s*expense\s*detail(\s*yr\s*1)?$/i,
  /^sponsor\s*accounting$/i,
  /^interest\s*rate\s*hedge\s*comparison$/i,
  /^yield\s*summary$/i,
  /^rent\s*registtry$/i,
  /^rent\s*registry$/i,
  /^ownership\s*assumptions$/i,
  /^acquisitions?\s*assumptions$/i,
  /^pro\s*forma\s*assumptions$/i,
  /^disposition\s*assumptions$/i,
  /^growth\s*rates\s*\(?\s*annual\s*\)?$/i,
  /^operating\s*assumptions$/i,
  /^property\s*tax\s*assumptions$/i,
  /^miscellaneous\s*assumptions$/i,
  /^renewal\s*probability$/i,
  /^unit\s*breakdown\s*[-–]\s*(existing|stabilized)$/i,
];

const ANNOTATION_PATTERNS = [
  /^note\s*\d+\/\d+\/\d+/i,
  /^as\s*of\s+\w+\s+\d+/i,
  /^\w+\s+\d+\s+t\d+$/i,
  /^revised\b/i,
  /^previous\b/i,
  /^delta\b/i,
  /^key:/i,
  /^update\s*made/i,
  /^updated?$/i,
  /^status:/i,
  /^\*+\s*footnote\b/i,
];

const PARTNERSHIP_FLOW_PATTERNS = [
  /^residual\s*cf\s*after\s*hurdle\s*\d+/i,
  /^ending\s*capital\s*after\s*catchup\s*distribution/i,
  /^hurdle\s*\d+\s*distributions?\s*\(/i,
  /^cash\s*flow\s*from\s*operations\s*\(net\s*cash\)/i,
  /^cash\s*flow\s*from\s*financing/i,
  /^total\s*cash\s*flow\s*from\s*operations/i,
  /^cash\s*available\s*for\s*distributions/i,
  /^ending\s*balance/i,
  /^beginning\s*balance/i,
  /^catchup\s+investor\s*[ab]/i,
  /^preferred\s*due\s*to\s*investor\s*[ab]/i,
  /^investor\s*[ab]\s*capital\s*balance/i,
];

function isNoiseLabel(label) {
  if (!label) return false;
  for (const re of NON_CANONICAL_NOISE_PATTERNS)
    if (re.test(label)) return true;
  for (const re of ANNOTATION_PATTERNS) if (re.test(label)) return true;
  for (const re of PARTNERSHIP_FLOW_PATTERNS) if (re.test(label)) return true;
  return false;
}

const PRIOR_VERSION_SHEET_RE =
  /\(\s*prior\s*q\s*\)|\(\s*cim\s*uw\s*\)|\(\s*lender\s*\)|\bv2\b|\(\s*v2\s*\)|\bold\b|\bprior\b/i;

const SCOPE_RES_RE = /\(\s*res(\s*only)?\s*\)/i;
const SCOPE_RTL_RE = /\(\s*rtl\s*only\s*\)|\(\s*retail\s*only\s*\)/i;

function scopeQualifierScore(key, label) {
  if (!label) {
    if (key.endsWith("_all")) return 1;
    if (key.endsWith("_residential") || key.endsWith("_retail")) return -2;
    return 0;
  }
  const hasRes = SCOPE_RES_RE.test(label);
  const hasRtl = SCOPE_RTL_RE.test(label);
  if (key.endsWith("_residential")) return hasRes ? 4 : -2;
  if (key.endsWith("_retail")) return hasRtl ? 4 : -2;
  if (key.endsWith("_all")) return hasRes || hasRtl ? -2 : 1;
  return 0;
}

const SCOPE_QUALIFIER_KEYS = new Set([
  "opex_repairs_maintenance_residential",
  "opex_repairs_maintenance_retail",
  "opex_repairs_maintenance_all",
]);

const PERIOD_SUM_FORMULA_RE = /^\+([A-Z]+)[0-9]+\+\1[0-9]+$/;

const PERIOD_COLUMN_LOCATORS = {
  noi_y1: {
    sheet_re: /^assumptions?$/i,
    row_label_re: /net\s*operating\s*income/i,
    anchor_col: "J",
  },
};

function locatePeriodColumnCells(graph, key) {
  const cfg = PERIOD_COLUMN_LOCATORS[key];
  if (!cfg) return null;
  const anchorColIdx = XLSX.utils.decode_col(cfg.anchor_col);

  const anchors = [];
  for (const n of graph.nodes) {
    if (EXCLUDED_SHEET_RE.test(n.sheet)) continue;
    if (!cfg.sheet_re.test(n.sheet)) continue;
    if (!n.value_text || !cfg.row_label_re.test(n.value_text)) continue;
    const { r, c } = XLSX.utils.decode_cell(n.cell);
    if (c !== anchorColIdx) continue;
    if (!anchors.some((a) => a.sheet === n.sheet && a.row === r)) {
      anchors.push({ sheet: n.sheet, row: r });
    }
  }
  if (anchors.length === 0) return null;

  const located = new Set();
  for (const anchor of anchors) {
    const cellByCol = new Map();
    for (const n of graph.nodes) {
      if (n.sheet !== anchor.sheet || !n.is_formula || !n.formula) continue;
      const { r, c } = XLSX.utils.decode_cell(n.cell);
      if (r !== anchor.row) continue;
      if (!PERIOD_SUM_FORMULA_RE.test(String(n.formula).toUpperCase()))
        continue;
      cellByCol.set(c, n);
    }
    for (const c of [...cellByCol.keys()].sort((a, b) => a - b)) {
      if (cellByCol.has(c + 4) && cellByCol.has(c + 8)) {
        located.add(cellByCol.get(c));
        break;
      }
    }
  }
  return located.size > 0 ? located : null;
}

function _buildReturnsYearLocator(rowLabelRe, ordinal) {
  return {
    sheet_re: /^returns\s*summary$/i,
    row_label_re: rowLabelRe,
    row_label_col: "C",
    anchor_col: "G",
    ordinal,
  };
}
const _NOI_ROW_RE = /^\s*net\s*operating\s*income\s*$/i;
const _LEVCF_ROW_RE =
  /^(net\s*cash\s*flow|net\s*operating\s*cash\s*flow\s*\(post[\s-]?debt\s*service\))$/i;
const YEAR_ROW_COLUMN_LOCATORS = {
  noi_y1: _buildReturnsYearLocator(_NOI_ROW_RE, 1),
  noi_y2: _buildReturnsYearLocator(_NOI_ROW_RE, 2),
  noi_y3: _buildReturnsYearLocator(_NOI_ROW_RE, 3),
  noi_y4: _buildReturnsYearLocator(_NOI_ROW_RE, 4),
  noi_y5: _buildReturnsYearLocator(_NOI_ROW_RE, 5),
  noi_y6: _buildReturnsYearLocator(_NOI_ROW_RE, 6),
  noi_y7: _buildReturnsYearLocator(_NOI_ROW_RE, 7),
  noi_y8: _buildReturnsYearLocator(_NOI_ROW_RE, 8),
  noi_y9: _buildReturnsYearLocator(_NOI_ROW_RE, 9),
  noi_y10: _buildReturnsYearLocator(_NOI_ROW_RE, 10),
  levered_cf_y1: _buildReturnsYearLocator(_LEVCF_ROW_RE, 1),
  levered_cf_y2: _buildReturnsYearLocator(_LEVCF_ROW_RE, 2),
  levered_cf_y3: _buildReturnsYearLocator(_LEVCF_ROW_RE, 3),
  levered_cf_y4: _buildReturnsYearLocator(_LEVCF_ROW_RE, 4),
  levered_cf_y5: _buildReturnsYearLocator(_LEVCF_ROW_RE, 5),
  levered_cf_y6: _buildReturnsYearLocator(_LEVCF_ROW_RE, 6),
  levered_cf_y7: _buildReturnsYearLocator(_LEVCF_ROW_RE, 7),
  levered_cf_y8: _buildReturnsYearLocator(_LEVCF_ROW_RE, 8),
  levered_cf_y9: _buildReturnsYearLocator(_LEVCF_ROW_RE, 9),
  levered_cf_y10: _buildReturnsYearLocator(_LEVCF_ROW_RE, 10),
  vacancy_initial_pct: {
    sheet_re: /^assumptions?$/i,
    row_label_re: /^vacancy\s*\(of\s*gpr\)$/i,
    row_label_col: "C",
    anchor_col: "D",
    ordinal: 1,
  },
  vacancy_stabilized_pct: {
    sheet_re: /^assumptions?$/i,
    row_label_re: /^vacancy\s*\(of\s*gpr\)$/i,
    row_label_col: "C",
    anchor_col: "E",
    ordinal: 1,
  },
  lease_up_fee_pct: {
    sheet_re: /^assumptions?$/i,
    row_label_re: /^lease\s*up\s*fee$/i,
    row_label_col: "C",
    anchor_col: "D",
    ordinal: 1,
  },
};

function locateYearRowColumnCells(graph, key) {
  const cfg = YEAR_ROW_COLUMN_LOCATORS[key];
  if (!cfg) return null;
  const labelColIdx = XLSX.utils.decode_col(cfg.row_label_col);
  const anchorColIdx = XLSX.utils.decode_col(cfg.anchor_col);
  const targetColIdx = anchorColIdx + (cfg.ordinal - 1);

  const anchorRows = new Set();
  for (const n of graph.nodes) {
    if (EXCLUDED_SHEET_RE.test(n.sheet)) continue;
    if (!cfg.sheet_re.test(n.sheet)) continue;
    if (!n.value_text || !cfg.row_label_re.test(n.value_text)) continue;
    const { r, c } = XLSX.utils.decode_cell(n.cell);
    if (c !== labelColIdx) continue;
    anchorRows.add(`${n.sheet}::${r}`);
  }
  if (anchorRows.size === 0) return null;

  const located = new Set();
  for (const n of graph.nodes) {
    if (EXCLUDED_SHEET_RE.test(n.sheet)) continue;
    if (!cfg.sheet_re.test(n.sheet)) continue;
    const { r, c } = XLSX.utils.decode_cell(n.cell);
    if (c !== targetColIdx) continue;
    if (!anchorRows.has(`${n.sheet}::${r}`)) continue;
    located.add(n);
  }
  return located.size > 0 ? located : null;
}

const SELF_LABEL_ANCHOR_LOCATORS = {
  equity_multiple_levered: {
    self_label_re: /^\s*equity\s*multiple\s*$/i,
    labels_re:
      /lev(er)?(ed|aged)?\s*(em|equity\s*multiple|multiple)|(em|equity\s*multiple|multiple)\s*\(?\s*lev(er)?(ed|aged)?/i,
    prefer_sheets_re: /summary|return/i,
  },
  going_in_cap_rate_y1: {
    self_label_re: /^\s*cap\s*rate\s*$/i,
    labels_re:
      /(going[\s-]?in|year\s*1|yr\s*1|y1).*cap|cap.*(year\s*1|yr\s*1|y1)|cap\s*rate.*y1|pp.*all[\s-]?in.*y1/i,
    prefer_sheets_re: /summary|return|basis|assumption/i,
  },
};

function locateSelfLabelAnchorCells(graph, key) {
  const cfg = SELF_LABEL_ANCHOR_LOCATORS[key];
  if (!cfg) return null;

  const anchorSheets = new Set();
  for (const n of graph.nodes) {
    if (EXCLUDED_SHEET_RE.test(n.sheet)) continue;
    if (!cfg.prefer_sheets_re.test(n.sheet)) continue;
    if (anchorSheets.has(n.sheet)) continue;
    if (n.label_hint && cfg.labels_re.test(n.label_hint)) {
      anchorSheets.add(n.sheet);
      continue;
    }
    if (n.value_text && cfg.labels_re.test(n.value_text)) {
      anchorSheets.add(n.sheet);
    }
  }
  if (anchorSheets.size === 0) return null;

  const located = new Set();
  for (const n of graph.nodes) {
    if (EXCLUDED_SHEET_RE.test(n.sheet)) continue;
    if (!cfg.prefer_sheets_re.test(n.sheet)) continue;
    if (!anchorSheets.has(n.sheet)) continue;
    if (!n.label_hint || !cfg.self_label_re.test(n.label_hint)) continue;
    located.add(n);
  }
  return located.size > 0 ? located : null;
}

const FORMULA_REGEX_LOCATORS = {
  terminal_cap_rate: {
    formula_re: /Sale_Price/i,
    prefer_sheets_re: /assumption|summary|return|exit/i,
  },
};

function locateFormulaRegexCells(graph, key) {
  const cfg = FORMULA_REGEX_LOCATORS[key];
  if (!cfg) return null;
  const located = new Set();
  for (const n of graph.nodes) {
    if (EXCLUDED_SHEET_RE.test(n.sheet)) continue;
    if (!cfg.prefer_sheets_re.test(n.sheet)) continue;
    if (!n.is_formula || !n.formula) continue;
    if (!cfg.formula_re.test(String(n.formula))) continue;
    located.add(n);
  }
  return located.size > 0 ? located : null;
}

function scoreCandidateForIngest(node, key, matchedNonStrict) {
  const matcher = KEY_MATCHERS[key] || {};
  const spec = VALUE_RANGES[key];
  const kind = spec && spec.kind;
  const isRef = REFERENCE_KEYS.has(key);
  if (EXCLUDED_SHEET_RE.test(node.sheet || "")) {
    return { hardRejected: "excluded_sheet" };
  }
  if (node.label_hint && isNoiseLabel(node.label_hint)) {
    return { hardRejected: "noise_label" };
  }
  if (isRef && node.is_formula !== true) {
    return { hardRejected: "reference_role_not_formula" };
  }
  if (typeof node.value_num !== "number" || !Number.isFinite(node.value_num)) {
    return { hardRejected: "value_num_missing" };
  }
  const label = node.label_hint || "";
  if (matcher.labels && !matchedNonStrict) {
    if (!matcher.labels.test(label)) {
      return { hardRejected: "label_not_match" };
    }
  }
  if (matcher.not_labels && matcher.not_labels.test(label)) {
    return { hardRejected: "not_labels_match" };
  }
  if (matcher.not_formula_regex && node.is_formula === true && node.formula) {
    if (matcher.not_formula_regex.test(String(node.formula))) {
      return { hardRejected: "not_formula_regex_match" };
    }
  }
  let score = 0;
  if (matcher.labels) score += 5;
  if (matcher.prefer_sheets && matcher.prefer_sheets.test(node.sheet || ""))
    score += 3;
  if (node.is_formula) score += 1;
  if (PRIOR_VERSION_SHEET_RE.test(node.sheet || "")) score -= 4;
  if (kind === "percent" && Math.abs(node.value_num) < 0.5) score += 0.5;
  if (kind === "money" && node.value_num > 100_000) score += 0.5;
  return { score };
}

function compareForTieBreakIngest(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aFormula = a.node.is_formula === true ? 1 : 0;
  const bFormula = b.node.is_formula === true ? 1 : 0;
  if (bFormula !== aFormula) return bFormula - aFormula;
  const aCell = String(a.node.cell || "");
  const bCell = String(b.node.cell || "");
  if (aCell.length !== bCell.length) return aCell.length - bCell.length;
  if (aCell < bCell) return -1;
  if (aCell > bCell) return 1;
  const aId = String(a.node.id || "");
  const bId = String(b.node.id || "");
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

function pickBestForIngest(nodes, key) {
  const scored = [];
  for (const n of nodes) {
    const r = scoreCandidateForIngest(n, key, true);
    if (r.hardRejected) continue;
    scored.push({ score: r.score, node: n });
  }
  if (scored.length === 0) return null;
  scored.sort(compareForTieBreakIngest);
  return scored[0].node;
}

function candidatesForKey(graph, key, limit = 6) {
  const matcher = KEY_MATCHERS[key] || {};
  const spec = VALUE_RANGES[key];
  const isDateKey = DATE_KEYS.has(key);
  const isTextKey = TEXT_KEYS.has(key);
  const isBoolKey = BOOL_KEYS.has(key);
  const isScopedKey = SCOPE_QUALIFIER_KEYS.has(key);
  const isReferenceKey = REFERENCE_KEYS.has(key);

  const scored = [];
  const periodCells = locatePeriodColumnCells(graph, key);
  const selfLabelCells = locateSelfLabelAnchorCells(graph, key);
  const formulaRegCells = locateFormulaRegexCells(graph, key);
  const yearRowCells = locateYearRowColumnCells(graph, key);
  for (const n of graph.nodes) {
    if (EXCLUDED_SHEET_RE.test(n.sheet)) continue;

    if (matcher.not_sheets && matcher.not_sheets.test(n.sheet)) continue;

    if (n.label_hint && isNoiseLabel(n.label_hint)) continue;

    if (isReferenceKey && !n.is_formula) continue;

    if (
      isReferenceKey &&
      spec &&
      spec.kind !== "text" &&
      spec.kind !== "date" &&
      spec.kind !== "bool"
    ) {
      if (typeof n.value_num !== "number" && typeof n.value_text === "string") {
        continue;
      }
    }

    if (isDateKey) {
      if (
        !n.value_date &&
        !(
          typeof n.value_num === "number" &&
          n.value_num > 20_000 &&
          n.value_num < 80_000
        )
      )
        continue;
    } else if (isTextKey) {
      if (!n.value_text) continue;
      if (isLikelyHeader(n)) continue;
      if (isLikelyMetaText(n)) continue;
    } else if (isBoolKey) {
      const hasBool =
        (typeof n.value_num === "number" &&
          (n.value_num === 0 || n.value_num === 1)) ||
        (typeof n.value_text === "string" &&
          /^(yes|no|true|false|y|n)$/i.test(n.value_text.trim()));
      if (!hasBool) continue;
    } else {
      if (typeof n.value_num !== "number" || !Number.isFinite(n.value_num))
        continue;
      if (spec && (n.value_num < spec.min || n.value_num > spec.max)) continue;
    }
    let score = 0;
    const label = n.label_hint || "";
    const isPeriodCell = periodCells !== null && periodCells.has(n);
    const isSelfLabelCell = selfLabelCells !== null && selfLabelCells.has(n);
    const isFormulaRegCell = formulaRegCells !== null && formulaRegCells.has(n);
    const isYearRowCell = yearRowCells !== null && yearRowCells.has(n);
    const matchedNonStrict =
      isPeriodCell || isSelfLabelCell || isFormulaRegCell || isYearRowCell;
    if (matcher.labels) {
      if (!matchedNonStrict && !matcher.labels.test(label)) continue;
      if (matcher.not_labels && matcher.not_labels.test(label)) continue;
      score += 5;
    }
    if (matcher.prefer_sheets && matcher.prefer_sheets.test(n.sheet))
      score += 3;
    if (n.is_formula) score += 1;
    if (PRIOR_VERSION_SHEET_RE.test(n.sheet)) score -= 4;
    if (SCENARIO_SHEET_RE.test(n.sheet)) {
      if (
        /^refi_|^outstanding_equity_post_refi$|^yield_os_equity_y1_post_refi$/.test(
          key,
        )
      ) {
        score += 2;
      }
    }
    if (isScopedKey) {
      const s = scopeQualifierScore(key, label);
      if (s <= -2) continue;
      score += s;
    }
    if (!isTextKey && !isDateKey && typeof n.value_num === "number") {
      if (spec?.kind === "percent" && Math.abs(n.value_num) < 0.5) score += 0.5;
      if (spec?.kind === "money" && n.value_num > 100_000) score += 0.5;
    }
    scored.push({ score, node: n });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.node);
}

const SEMANTIC_GROUPS = [
  {
    name: "identity_performance_returns",
    label:
      "2.A Identity + 2.B Unit counts + 2.C Performance + 2.D Returns targets",
    keys: [
      "model_property_name",
      "model_street_address",
      "model_city",
      "model_state",
      "model_zip",
      "model_county",
      "model_neighborhood",
      "model_submarket",
      "year_built",
      "lot_size_sf",
      "rentable_sf_pro_forma",
      "gross_sf_pro_forma",
      "acquisition_date",
      "units_at_acquisition",
      "units_pro_forma",
      "units_residential",
      "units_adu",
      "units_retail",
      "units_bmr",
      "units_rent_controlled",
      "units_rent_controlled_tier1",
      "units_rent_controlled_tier2",
      "units_rent_controlled_tier3",
      "units_under_renovation",
      "units_reno_complete_lt_12mo",
      "avg_rent_per_unit_acquisition",
      "avg_rent_per_unit_pro_forma",
      "avg_rent_per_unit_market",
      "rent_per_sf_acquisition",
      "rent_per_sf_pro_forma",
      "rent_per_sf_market",
      "occupancy_at_acquisition",
      "occupancy_stabilized",
      "purchase_price",
      "terminal_cap_rate",
      "terminal_cap_rate_tax_adj",
      "target_investor_irr",
      "target_investor_em",
    ],
  },
  {
    name: "debt_equity_waterfall",
    label: "2.E Debt + 2.F Equity + 2.G Waterfall + 2.R Reserves + 2.S Hedging",
    keys: [
      "bridge_loan_amount",
      "bridge_loan_proceeds_at_close",
      "bridge_loan_rate_all_in",
      "bridge_loan_spread_bps",
      "bridge_loan_index",
      "bridge_loan_ltv",
      "bridge_loan_ltc",
      "bridge_loan_maturity_date",
      "bridge_loan_term_months",
      "bridge_loan_io_period_months",
      "bridge_loan_amort_years",
      "bridge_loan_lender",
      "bridge_loan_origination_fee_pct",
      "bridge_loan_exit_fee_pct",
      "bridge_loan_extension_options",
      "bridge_loan_rate_cap_strike",
      "bridge_loan_rate_cap_cost",
      "bridge_loan_swap_rate",
      "bridge_loan_swap_cost",
      "bridge_loan_prepay_terms",
      "bridge_loan_exit_fee_amount",
      "senior_loan_amount",
      "senior_loan_proceeds_at_close",
      "senior_loan_rate_all_in",
      "senior_loan_spread_bps",
      "senior_loan_index",
      "senior_loan_ltv",
      "senior_loan_ltc",
      "senior_loan_maturity_date",
      "senior_loan_term_months",
      "senior_loan_io_period_months",
      "senior_loan_amort_years",
      "senior_loan_lender",
      "senior_loan_origination_fee_pct",
      "senior_loan_exit_fee_pct",
      "senior_loan_extension_options",
      "senior_loan_prepay_terms",
      "senior_loan_rate_cap_strike",
      "senior_loan_rate_cap_cost",
      "senior_loan_swap_rate",
      "senior_loan_swap_cost",
      "mezz_loan_amount",
      "mezz_loan_rate_current",
      "mezz_loan_rate_accrued",
      "mezz_loan_maturity_date",
      "mezz_loan_lender",
      "mezz_loan_origination_fee_pct",
      "construction_loan_amount",
      "construction_loan_ltc",
      "construction_loan_rate",
      "construction_period_months",
      "construction_loan_lender",
      "pref_equity_amount",
      "pref_equity_rate",
      "pref_equity_term_months",
      "pref_equity_provider",
      "total_lp_equity",
      "total_gp_equity",
      "total_coinvest_equity",
      "follow_on_flag",
      "follow_on_needed_amount",
      "preferred_return_pct",
      "preferred_return_investor_a_pct",
      "preferred_return_investor_b_pct",
      "preferred_return_sponsor_pct",
      "waterfall_tier_1_split_lp",
      "waterfall_tier_1_split_gp",
      "waterfall_tier_2_hurdle",
      "waterfall_tier_2_split_lp",
      "waterfall_tier_2_split_gp",
      "waterfall_tier_3_hurdle",
      "waterfall_tier_3_split_lp",
      "waterfall_tier_3_split_gp",
      "waterfall_tier_4_hurdle",
      "waterfall_tier_4_split_lp",
      "waterfall_tier_4_split_gp",
      "catchup_provision_tier_1_pct",
      "catchup_provision_tier_2_pct",
      "catchup_provision_tier_3_pct",
      "catchup_provision_tier_4_pct",
      "promote_description",
      "waterfall_investor_class_count",
      "operating_reserve_at_close",
      "debt_service_reserve",
      "ti_lc_reserve",
      "capex_reserve",
      "replacement_reserve",
      "interest_reserve",
      "hedge_instrument_type",
      "hedge_term_months",
      "hedge_notional_amount",
    ],
  },
  {
    name: "business_plan_exit_operating",
    label:
      "2.H Business plan + 2.I Exit/Refi + 2.J Operating + 2.N Valuation inputs",
    keys: [
      "strategy_description",
      "exit_strategy",
      "hold_period_years",
      "renovation_scope_description",
      "stabilization_date_target",
      "sale_date",
      "disposition_fee_pct",
      "broker_commission_pct",
      "transfer_tax_pct",
      "selling_costs_pct",
      "refi_date",
      "refi_new_loan_amount",
      "replacements_reserves_at_exit",
      "rent_growth_pct",
      "rent_growth_dollar",
      "expense_growth_pct",
      "tax_escalation_pct",
      "vacancy_pct",
      "other_income_pct",
      "management_fee_pct",
      "am_fee_pct",
      "cumulative_am_pm_fee_pct",
      "per_bed_pm_fee",
      "lease_up_fee",
      "min_am_fee",
      "acquisition_fee_pct",
      "vc_acquisition_fee_pct",
      "construction_management_fee_pct",
      "replacement_reserve_per_unit",
      "renewal_probability_pct",
      "loss_to_lease_assumption_pct",
      "vacancy_initial_pct",
      "vacancy_stabilized_pct",
      "lease_up_fee_pct",
      "valuation_as_is",
      "valuation_stabilized",
      "valuation_current_appraised",
      "valuation_appraisal_date",
      "valuation_appraiser",
    ],
  },
  {
    name: "pnl_costs_detail_references",
    label:
      "2.K P&L + 2.L Closing + 2.M CapEx + 2.O Timeline + 2.P CostSeg + 2.Q Permit + all references",
    keys: [
      "loss_to_lease_pct",
      "closing_costs_total",
      "capex_budget_total",
      "all_in_basis",
      "going_in_cap_rate_y1",
      "going_in_cap_rate_t12",
      "going_in_cap_rate_y2",
      "going_in_cap_rate_y3",
      "stabilized_yield_on_cost",
      "avg_yield",
      "avg_yield_w_o_sale",
      "avg_yield_on_unreturned_equity",
      "yield_origination",
      "yield_outstanding",
      "yield_os_equity_y1_post_refi",
      "levered_irr",
      "unlevered_irr",
      "equity_multiple_levered",
      "equity_multiple_unlevered",
      "lp_irr",
      "lp_equity_multiple",
      "lp_avg_annual_cash_on_cash",
      "lp_peak_equity",
      "lp_return_of_capital_date",
      "gp_irr",
      "gp_equity_multiple",
      "gp_promote_earned",
      "levered_cf_y1",
      "levered_cf_y2",
      "levered_cf_y3",
      "levered_cf_y4",
      "levered_cf_y5",
      "levered_cf_y6",
      "levered_cf_y7",
      "levered_cf_y8",
      "levered_cf_y9",
      "levered_cf_y10",
      "total_debt_amount",
      "total_debt_proceeds_at_close",
      "debt_payoff_amount",
      "equity_required_total",
      "sale_price",
      "selling_costs_amount",
      "terminal_noi",
      "terminal_noi_tax_adj",
      "disposition_proceeds_gross",
      "disposition_proceeds_net",
      "refi_proceeds",
      "refi_cashout_amount",
      "outstanding_equity_post_refi",
      "other_income_application_fees",
      "other_income_late_nsf_fees",
      "other_income_pet_rent",
      "other_income_termination_fees",
      "other_income_rubs",
      "other_income_parking",
      "other_income_laundry",
      "other_income_forfeited_deposits",
      "other_income_misc",
      "opex_property_tax",
      "opex_pm_fee_dollar",
      "opex_insurance",
      "opex_admin_berk_tax",
      "opex_business_tax",
      "opex_utilities",
      "opex_util_pge",
      "opex_util_water_sewer",
      "opex_util_trash",
      "opex_util_internet",
      "opex_fire_alarm",
      "opex_security_alarm",
      "opex_salaries",
      "opex_landscaping",
      "opex_pest_control",
      "opex_elevator",
      "opex_janitorial",
      "opex_management_fee",
      "opex_repairs_maintenance",
      "opex_repairs_maintenance_residential",
      "opex_repairs_maintenance_retail",
      "opex_repairs_maintenance_all",
      "opex_turnover",
      "opex_admin_ga",
      "opex_marketing",
      "opex_replacements_reserves_monthly",
      "opex_rhsp_registration",
      "opex_rent_board_fee",
      "water_total_bill_annual",
      "water_gallons_annual",
      "water_gallons_per_day",
      "gpr_annual",
      "vacancy_loss_annual",
      "net_potential_rent_annual",
      "other_income_total",
      "egi_annual",
      "opex_total",
      "noi_t12",
      "noi_y1",
      "noi_stabilized",
      "noi_peak",
      "noi_y2",
      "noi_y3",
      "noi_y4",
      "noi_y5",
      "noi_y6",
      "noi_y7",
      "noi_y8",
      "noi_y9",
      "noi_y10",
      "debt_service_annual",
      "closing_cost_title",
      "closing_cost_escrow",
      "closing_cost_recording",
      "closing_cost_transfer_tax",
      "closing_cost_prorations",
      "closing_cost_legal",
      "closing_cost_lender_legal",
      "closing_cost_due_diligence",
      "closing_cost_financing_fees",
      "closing_cost_survey",
      "closing_cost_environmental",
      "closing_cost_appraisal",
      "closing_cost_acquisition_fee",
      "closing_cost_rate_cap",
      "closing_cost_swap",
      "closing_cost_zoning",
      "closing_cost_insurance_binder",
      "closing_cost_other",
      "capex_interior_renovation",
      "capex_exterior_renovation",
      "capex_common_area",
      "capex_mechanical_electrical_plumbing",
      "capex_building_systems",
      "capex_soft_costs",
      "capex_contingency",
      "capex_appliances",
      "capex_kitchen",
      "capex_bath",
      "capex_flooring",
      "capex_windows",
      "capex_landscape_hardscape",
      "capex_elevator",
      "capex_life_safety",
      "capex_per_unit",
      "valuation_ltsv",
      "milestone_acquisition_close",
      "milestone_construction_start",
      "milestone_construction_complete",
      "milestone_stabilization_target",
      "milestone_lease_up_complete",
      "milestone_refi_planned",
      "milestone_refi_actual",
      "milestone_sale_target",
      "cost_seg_total_basis",
      "cost_seg_land_allocation_pct",
      "cost_seg_building_allocation_pct",
      "cost_seg_study_date",
      "cost_seg_study_provider",
      "cost_seg_y1_accelerated_depreciation",
      "cost_seg_total_accelerated_depreciation",
      "cost_seg_tax_benefit_y1",
      "property_tax_assessed_value",
      "property_tax_rate_pct",
      "rent_control_jurisdiction",
      "rent_control_last_increase_date",
      "rent_control_max_increase_pct",
      "zoning_designation",
      "permit_count_last_10yr",
      "last_major_permit_date",
      "rhsp_registration_status",
    ],
  },
];

(function validateSemanticGroups() {
  const canonicalSet = new Set(CANONICAL_KEYS);
  const groupedSet = new Set();
  for (const g of SEMANTIC_GROUPS) {
    for (const k of g.keys) {
      if (!canonicalSet.has(k)) {
        console.warn(
          `[underwriting-ingest] group ${g.name} references unknown key: ${k}`,
        );
      }
      if (groupedSet.has(k)) {
        console.warn(
          `[underwriting-ingest] key ${k} appears in multiple groups`,
        );
      }
      groupedSet.add(k);
    }
  }
  for (const k of CANONICAL_KEYS) {
    if (!groupedSet.has(k)) {
      console.warn(
        `[underwriting-ingest] canonical key ${k} is not in any semantic group`,
      );
    }
  }
})();

function isSemanticPassComplete(groupDiagnostics) {
  const list = Array.isArray(groupDiagnostics) ? groupDiagnostics : [];
  const failed = list.filter(
    (d) => d && (d.stop_reason !== "end_turn" || d.error || d.parse_error),
  );
  return {
    ok: failed.length === 0,
    failedGroups: failed.map((d) => (d && d.group) || "unknown"),
  };
}

function buildSemanticPrompt(graph, workbook, opts = {}) {
  const groupKeys =
    Array.isArray(opts.groupKeys) && opts.groupKeys.length
      ? opts.groupKeys
      : CANONICAL_KEYS;
  const groupName = opts.groupName || "all";
  const groupLabel = opts.groupLabel || "all canonical keys";

  const sheetBlock = graph.sheets
    .map((s) => {
      const labels = sheetLabelsSample(workbook, s.name);
      return `  ${JSON.stringify(s.name)} (${s.dim}, ${s.cell_count} cells, ${s.formula_count} formulas)\n    labels: ${JSON.stringify(labels)}`;
    })
    .join("\n");

  const perKeyBlocks = [];
  let emittedKeyCount = 0;
  let skippedKeyCount = 0;
  for (const key of groupKeys) {
    const candidates = candidatesForKey(graph, key, 4);
    if (!candidates.length) {
      skippedKeyCount += 1;
      continue;
    }
    emittedKeyCount += 1;
    const lines = candidates
      .map((n) => {
        const val =
          n.value_num != null
            ? n.value_num
            : n.value_text != null
              ? n.value_text
              : n.value_date != null
                ? n.value_date
                : null;
        return `    - {sheet: ${JSON.stringify(n.sheet)}, cell: "${n.cell}", value: ${JSON.stringify(val)}, label: ${JSON.stringify(n.label_hint || null)}${n.formula ? `, formula: ${JSON.stringify(n.formula.slice(0, 100))}` : ""}}`;
      })
      .join("\n");
    perKeyBlocks.push(`${key}:\n${lines}`);
  }
  const candidateBlock = perKeyBlocks.join("\n\n");

  return {
    prompt: `You are analyzing a commercial-real-estate underwriting model (Excel workbook). The cell-level dependency graph has already been built deterministically from the formulas. Your job is semantic labeling: classify each sheet's role, identify external-data sources, and for each canonical output key below, PICK THE BEST matching cell from its pre-filtered candidate list.

**This is batch \`${groupName}\` covering: ${groupLabel}.**
Other canonicals will be processed in separate batches; you are ONLY responsible for keys explicitly listed below.

**Sheets (${graph.sheets.length} total):**
${sheetBlock}

**Per-canonical-key candidates (already filtered for value plausibility + label match). Keys the workbook cannot answer have been pre-filtered out.**

${candidateBlock || "(No keys in this group had any plausible candidates — return outputs={}.)"}

---

Return JSON only (no markdown, no explanation). Shape:

{
  "sheets": {
    "<exact sheet name>": {
      "role": "input" | "build" | "summary" | "external_source" | "reference" | "scenario:refi" | "scenario:recap" | "scenario:disposition" | "other",
      "confidence": 0.0-1.0,
      "external_source": "entrata" | "chatham" | "document:loan_quote" | "document:term_sheet" | null,
      "notes": "<1-2 sentence description of what this sheet does>"
    },
    ...
  },
  "outputs": {
    "<canonical_key from the list above>": {
      "sheet": "<sheet name>",
      "cell": "<A1 address>",
      "confidence": 0.0-1.0,
      "semantic_label": "<human-readable description>",
      "reasoning": "<why this cell, optionally citing formula lineage>"
    },
    ...
  }
}

**Approach:** For each canonical key, the candidates above have been pre-filtered by value plausibility and label match. Pick the single best cell per key from its candidate list, or return null/omit if none fit. Try to match every key — our models always contain purchase price, basis, IRRs, EMs, loan terms, dates, property address, etc.

Rules:
- Every sheet must get a role. If you can't tell, use "other" with low confidence.
- **Only use canonical_keys from the list of per-key sections above.** Do not invent new keys. Do not emit keys not in this batch.
- **Only use sheet/cell addresses that appear in a candidate list.** Do not guess or hallucinate addresses; a mapping is invalid unless it exactly matches a candidate entry.
- **\`scenario:*\` sheets** — "Refi Analysis", "Recap Scenario", "Disposition Scenario" and similar are first-class SCENARIO sheets, not generic "build" sheets. Classify them with role \`scenario:refi\` / \`scenario:recap\` / \`scenario:disposition\`. These sheets ARE valid sources for their corresponding scenario's input canonicals (e.g. refi_new_loan_amount, refi_date lives on Refi Analysis).
- external_source=null unless the sheet's role is "external_source" or its formulas obviously pull from one of the listed external systems:
    * Sheets named "NOI Build" or similar that aggregate rent-roll / P&L numbers are typically external_source:entrata (power-query-backed).
    * Sheets containing financing-rate tables, term SOFR curves, etc. are typically external_source:chatham.

**Canonical-key semantic reminders (for picking the best among candidates):**
- \`lp_irr\` vs \`gp_irr\` vs \`levered_irr\`: THREE DIFFERENT CELLS. \`levered_irr\` is the deal-level leveraged return before the promote split; \`lp_irr\` is the LP's return AFTER the waterfall; \`gp_irr\` is the GP's return AFTER the waterfall. Disambiguate via formula lineage and sheet location — not just label.
- \`equity_required\` = TOTAL equity (LP + GP). A "Total LP" cell is LP-only and should NOT be mapped to equity_required. If no TOTAL-equity cell exists in the candidates, return null.
- \`target_investor_irr\` = UNDERWRITTEN/TARGETED investor return. NOT the 8% preferred-return hurdle (the pref is a waterfall tier, not a target).
- \`senior_loan_amount\` = TOTAL loan principal. NOT a single draw event like "Bridge Loan Draw".
- \`hold_period_years\`: in YEARS, not months. Candidate filter has already excluded month-count cells (values > 30); pick only if the cell genuinely represents years.
- Text fields (property name, address, city, lender): header-like cells (e.g. value_text = "Lender Name") have already been filtered out. Pick cells whose value is the actual content.
- \`opex_repairs_maintenance_residential\` / \`_retail\` / \`_all\`: paired-scope variants. The candidate filter has already matched the correct scope based on "(Res Only)" / "(Rtl Only)" parenthetical qualifiers in the label.
`,
    emittedKeyCount,
    skippedKeyCount,
  };
}

function findBalancedJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractJsonFromResponse(text) {
  let t = String(text || "").trim();
  if (t.startsWith("```"))
    t = t
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  const slice = findBalancedJson(t);
  if (!slice)
    return {
      error: "No balanced JSON object found in response",
      raw: text.slice(0, 400),
    };
  try {
    return { json: JSON.parse(slice) };
  } catch (e) {
    const posMatch = /position (\d+)/.exec(e.message || "");
    let window = slice.slice(0, 300);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      window = slice.slice(
        Math.max(0, pos - 120),
        Math.min(slice.length, pos + 120),
      );
      window = `…${window}…`;
    }
    return {
      error: `JSON parse failed: ${e.message} | context: ${window}`,
      raw: slice.slice(0, 400),
    };
  }
}

export const _internal = {
  parseFormulaRefs,
  stripStringLiterals,
  normalizeCellAddr,
  expandRange,
  extractNamedRanges,
  candidatesForKey,
  REFERENCE_KEYS,
  KEY_MATCHERS,
  locatePeriodColumnCells,
  PERIOD_COLUMN_LOCATORS,
  locateYearRowColumnCells,
  YEAR_ROW_COLUMN_LOCATORS,
  locateSelfLabelAnchorCells,
  SELF_LABEL_ANCHOR_LOCATORS,
  locateFormulaRegexCells,
  FORMULA_REGEX_LOCATORS,
  scoreCandidateForIngest,
  compareForTieBreakIngest,
  pickBestForIngest,
  getMsAppToken,
  getSharePointFileBytes,
  MAX_EDGES_PER_GRAPH,
  MAX_NODES_PER_GRAPH,
  isSemanticPassComplete,
};

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
  const fnStartMs = Date.now();
  let lastStageMs = fnStartMs;
  const setStage = (stageName) => {
    const now = Date.now();
    const total = ((now - fnStartMs) / 1000).toFixed(1);
    const sinceLast = ((now - lastStageMs) / 1000).toFixed(1);
    console.log(
      `[underwriting-ingest] STAGE=${stageName} total=${total}s since_last=${sinceLast}s`,
    );
    lastStageMs = now;
    if (!runId) return;
    sr(`/underwriting_discovery_runs?id=eq.${runId}`, {
      method: "PATCH",
      body: { error_stage: `running:${stageName}` },
      prefer: "return=minimal",
    }).catch((e) =>
      console.warn(
        "[underwriting-ingest] setStage failed:",
        stageName,
        e?.message,
      ),
    );
  };

  try {
    if (!ANTHROPIC_API_KEY)
      return jsonResponse(500, { error: "ANTHROPIC_API_KEY not set" });

    const requestBody = JSON.parse(event.body || "{}");
    const { run_id, property_id, source_file_id, source_envelope } =
      requestBody;
    if (!run_id) return jsonResponse(400, { error: "run_id required" });
    if (!property_id)
      return jsonResponse(400, { error: "property_id required" });
    if (!source_envelope && !source_file_id) {
      return jsonResponse(400, {
        error: "source_envelope or source_file_id required",
      });
    }
    runId = run_id;

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
    if (!propRes.ok || !propRes.body?.length)
      return jsonResponse(404, { error: "Property not found in your org" });

    let fileRow;
    let runRowSeed;
    let sharePointEnvelope = null;
    if (source_envelope && source_envelope.provider === "sharepoint") {
      const { driveId, itemId, name, webUrl } = source_envelope;
      if (!driveId || !itemId)
        return jsonResponse(400, {
          error: "SharePoint envelope missing driveId or itemId",
        });
      sharePointEnvelope = source_envelope;
      runRowSeed = {
        source_file_id: `sharepoint:${driveId}:${itemId}`,
        source_file_path: webUrl || name || `sharepoint://${driveId}/${itemId}`,
        source_file_rev: null,
      };
      fileRow = {
        kind: "file",
        name: name || "sharepoint-item.xlsx",
        path_display: webUrl || "",
        dropbox_file_id: null,
      };
    } else {
      const sourceFileId = source_envelope?.dropbox_file_id || source_file_id;
      if (!sourceFileId)
        return jsonResponse(400, { error: "Dropbox source_file_id required" });
      const fileRes = await sr(
        `/dropbox_files?dropbox_file_id=eq.${encodeURIComponent(sourceFileId)}` +
          `&org_id=eq.${profile.orgId}&select=dropbox_account_id,name,path_display,kind,dropbox_file_id,rev,server_modified&limit=1`,
      );
      if (!fileRes.ok || !fileRes.body?.length)
        return jsonResponse(404, {
          error: "Dropbox file not found in your org",
        });
      fileRow = fileRes.body[0];
      if (fileRow.kind !== "file")
        return jsonResponse(400, { error: "source_file_id must be a file" });
      runRowSeed = {
        source_file_id: fileRow.dropbox_file_id,
        source_file_path: fileRow.path_display,
        source_file_rev: fileRow.rev,
      };
    }

    await sr("/underwriting_discovery_runs", {
      method: "POST",
      prefer: "return=minimal,resolution=merge-duplicates",
      body: [
        {
          id: runId,
          org_id: profile.orgId,
          property_id,
          ...runRowSeed,
          status: "running",
          ai_model: CLAUDE_MODEL,
          triggered_by: profile.userId,
        },
      ],
    });

    setStage("fetch_xlsx");
    const bytesRes = sharePointEnvelope
      ? await getSharePointFileBytes({
          driveId: sharePointEnvelope.driveId,
          itemId: sharePointEnvelope.itemId,
        })
      : await getDropboxFileBytes({ fileRow });
    if (bytesRes.error) {
      await finalize({
        status: "error",
        error_stage: "fetch_file",
        error_message: bytesRes.error,
      });
      return jsonResponse(502, { error: bytesRes.error });
    }

    setStage("parse_xlsx");
    let workbook;
    try {
      workbook = XLSX.read(bytesRes.buf, {
        type: "buffer",
        cellDates: true,
        cellFormula: true,
      });
    } catch (e) {
      await finalize({
        status: "error",
        error_stage: "parse_xlsx",
        error_message: e.message,
      });
      return jsonResponse(500, { error: e.message });
    }

    setStage("build_graph");
    let graph;
    try {
      graph = buildGraph(workbook);
    } catch (e) {
      await finalize({
        status: "error",
        error_stage: "parse_xlsx",
        error_message: `Graph build failed: ${e.message}`,
      });
      return jsonResponse(500, { error: e.message });
    }
    if (graph.nodes.length > MAX_NODES_PER_GRAPH) {
      await finalize({
        status: "error",
        error_stage: "parse_xlsx",
        error_message: `Graph too large: ${graph.nodes.length} nodes (cap ${MAX_NODES_PER_GRAPH})`,
      });
      return jsonResponse(500, { error: "Graph too large" });
    }
    if (graph.edges.length > MAX_EDGES_PER_GRAPH) {
      await finalize({
        status: "error",
        error_stage: "parse_xlsx",
        error_message: `Graph too large: ${graph.edges.length} edges (cap ${MAX_EDGES_PER_GRAPH})`,
      });
      return jsonResponse(500, { error: "Graph too large" });
    }

    setStage("semantic_ai");
    const mergedOutputs = {};
    let mergedSheets = null;
    let totalPromptChars = 0;
    let totalResponseChars = 0;
    const groupDiagnostics = [];

    const groupPrompts = SEMANTIC_GROUPS.map((group) => {
      const { prompt, emittedKeyCount, skippedKeyCount } = buildSemanticPrompt(
        graph,
        workbook,
        {
          groupKeys: group.keys,
          groupName: group.name,
          groupLabel: group.label,
        },
      );
      totalPromptChars += prompt.length;
      return { group, prompt, emittedKeyCount, skippedKeyCount };
    });

    const callOneGroup = async ({ group, prompt }) => {
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
            max_tokens: 32000,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const anthBody = await anthRes.json().catch(() => ({}));
        if (!anthRes.ok) {
          return {
            group,
            error: `HTTP ${anthRes.status}: ${(anthBody?.error?.message || "").slice(0, 400)}`,
          };
        }
        const text = (anthBody.content || [])
          .map((c) => c.text || "")
          .join("")
          .trim();
        const stopReason = anthBody.stop_reason || "unknown";
        return { group, text, stopReason };
      } catch (e) {
        return { group, error: e.message || String(e) };
      }
    };
    const t0 = Date.now();
    const groupResults = await Promise.all(groupPrompts.map(callOneGroup));
    console.log(
      "[underwriting-ingest] semantic_ai: 4 parallel Anthropic calls returned in",
      ((Date.now() - t0) / 1000).toFixed(1),
      "s",
    );

    for (let gi = 0; gi < groupResults.length; gi++) {
      const res = groupResults[gi];
      const { group } = res;
      const { emittedKeyCount, skippedKeyCount } = groupPrompts[gi];

      if (res.error) {
        if (gi === 0) {
          await finalize({
            status: "error",
            error_stage: "call_claude",
            error_message: `Anthropic call failed on group ${group.name}: ${res.error}`,
          });
          return jsonResponse(502, {
            error: "Claude API failed",
            detail: res.error,
          });
        }
        groupDiagnostics.push({
          group: group.name,
          error: res.error,
          emitted: emittedKeyCount,
          skipped: skippedKeyCount,
        });
        continue;
      }

      const groupText = res.text;
      const groupStopReason = res.stopReason;
      totalResponseChars += groupText.length;

      const parsed = extractJsonFromResponse(groupText);
      if (parsed.error) {
        const head = groupText.slice(0, 300);
        const tail = groupText.length > 600 ? groupText.slice(-300) : "";
        const diag = `stop_reason=${groupStopReason} response_chars=${groupText.length} | head: ${head}${tail ? ` | tail: ${tail}` : ""}`;
        if (gi === 0) {
          await finalize({
            status: "error",
            error_stage: "parse_response",
            error_message: `${parsed.error} | ${diag}`,
            response_chars: totalResponseChars,
          });
          return jsonResponse(502, { error: parsed.error });
        }
        groupDiagnostics.push({
          group: group.name,
          parse_error: parsed.error,
          stop_reason: groupStopReason,
          emitted: emittedKeyCount,
          skipped: skippedKeyCount,
        });
        continue;
      }

      const groupSemantic = parsed.json || {};
      for (const [k, v] of Object.entries(groupSemantic.outputs || {})) {
        if (!(k in mergedOutputs)) mergedOutputs[k] = v;
      }
      if (mergedSheets == null) {
        mergedSheets = groupSemantic.sheets || {};
      } else {
        for (const [k, v] of Object.entries(groupSemantic.sheets || {})) {
          if (!(k in mergedSheets)) mergedSheets[k] = v;
        }
      }

      groupDiagnostics.push({
        group: group.name,
        emitted_keys: emittedKeyCount,
        skipped_keys: skippedKeyCount,
        outputs_returned: Object.keys(groupSemantic.outputs || {}).length,
        stop_reason: groupStopReason,
        response_chars: groupText.length,
      });
    }

    const semantic = {
      sheets: mergedSheets || {},
      outputs: mergedOutputs,
    };
    const text = `[merged across ${SEMANTIC_GROUPS.length} groups]`;

    setStage("persist_graph");
    const graphId = crypto.randomUUID();
    const ingested_at = new Date().toISOString();

    const outputsBySheetCell = new Map();
    const droppedOutputs = [];
    const canonicalSet = new Set(CANONICAL_KEYS);

    semantic.outputs = semantic.outputs || {};
    for (const pcKey of Object.keys(PERIOD_COLUMN_LOCATORS)) {
      const located = locatePeriodColumnCells(graph, pcKey);
      if (!located || located.size !== 1) continue;
      const [cellNode] = located;
      semantic.outputs[pcKey] = {
        sheet: cellNode.sheet,
        cell: cellNode.cell,
        semantic_label: "Net Operating Income (Year 1)",
        confidence: 1,
      };
      console.log(
        `[underwriting-ingest] period_column resolution: ${pcKey} -> ${cellNode.sheet}!${cellNode.cell}`,
      );
    }

    const retagLocatorKeys = new Set([
      ...Object.keys(SELF_LABEL_ANCHOR_LOCATORS),
      ...Object.keys(FORMULA_REGEX_LOCATORS),
    ]);
    for (const key of retagLocatorKeys) {
      const existing = semantic.outputs[key];
      if (existing && existing.sheet && existing.cell) {
        const existingCell = String(existing.cell).toUpperCase();
        const existingNode = graph.nodes.find(
          (n) => n.sheet === existing.sheet && n.cell === existingCell,
        );
        if (existingNode && validateCanonicalValue(key, existingNode).ok)
          continue;
      }
      const locatorCells = new Set();
      const sla = locateSelfLabelAnchorCells(graph, key);
      if (sla) for (const n of sla) locatorCells.add(n);
      const fra = locateFormulaRegexCells(graph, key);
      if (fra) for (const n of fra) locatorCells.add(n);
      if (locatorCells.size === 0) continue;
      const winner = pickBestForIngest([...locatorCells], key);
      if (!winner) continue;
      semantic.outputs[key] = {
        sheet: winner.sheet,
        cell: winner.cell,
        semantic_label: key,
        confidence: 1,
      };
      console.log(
        `[underwriting-ingest] retag-locator resolution: ${key} -> ${winner.sheet}!${winner.cell}`,
      );
    }

    for (const [canonicalKey, spec] of Object.entries(semantic.outputs || {})) {
      if (!spec || !spec.sheet || !spec.cell) continue;
      if (!canonicalSet.has(canonicalKey)) {
        droppedOutputs.push({
          canonical_key: canonicalKey,
          sheet: spec.sheet,
          cell: spec.cell,
          reason: "not a recognized canonical key",
        });
        continue;
      }
      const cellUpper = spec.cell.toUpperCase();
      const targetKey = `${spec.sheet}\x00${cellUpper}`;
      const node = graph.nodes.find(
        (n) => n.sheet === spec.sheet && n.cell === cellUpper,
      );
      if (!node) {
        droppedOutputs.push({
          canonical_key: canonicalKey,
          sheet: spec.sheet,
          cell: cellUpper,
          reason: "cell not in graph",
        });
        continue;
      }
      let check = validateCanonicalValue(canonicalKey, node);
      let chosenNode = node;
      let chosenSheet = spec.sheet;
      let chosenCell = cellUpper;
      let fallbackUsed = null;

      if (!check.ok) {
        let candidates = [];
        try {
          candidates = candidatesForKey(graph, canonicalKey, 8);
        } catch (e) {
          candidates = [];
        }
        for (const cand of candidates) {
          if (
            cand.sheet === spec.sheet &&
            cand.cell.toUpperCase() === cellUpper
          )
            continue;
          const candNode = graph.nodes.find(
            (n) => n.sheet === cand.sheet && n.cell === cand.cell.toUpperCase(),
          );
          if (!candNode) continue;
          const candCheck = validateCanonicalValue(canonicalKey, candNode);
          if (candCheck.ok) {
            chosenNode = candNode;
            chosenSheet = cand.sheet;
            chosenCell = cand.cell.toUpperCase();
            fallbackUsed = {
              from: {
                sheet: spec.sheet,
                cell: cellUpper,
                reason: check.reason,
              },
              to: { sheet: chosenSheet, cell: chosenCell, score: cand.score },
            };
            check = candCheck;
            break;
          }
        }
        if (!check.ok) {
          droppedOutputs.push({
            canonical_key: canonicalKey,
            sheet: spec.sheet,
            cell: cellUpper,
            reason: check.reason,
            candidates_tried: candidates.length,
          });
          continue;
        }
        console.log(
          `[underwriting-ingest] candidate-fallback: ${canonicalKey} ${spec.sheet}!${cellUpper} (${fallbackUsed.from.reason}) → ${chosenSheet}!${chosenCell}`,
        );
      }

      const targetKey2 = `${chosenSheet}\x00${chosenCell}`;
      outputsBySheetCell.set(targetKey2, {
        canonical_key: canonicalKey,
        semantic_label: spec.semantic_label || null,
        semantic_confidence:
          typeof spec.confidence === "number"
            ? Math.max(0, Math.min(1, spec.confidence))
            : null,
        _node_value:
          chosenNode.value_num != null
            ? chosenNode.value_num
            : chosenNode.value_text != null
              ? chosenNode.value_text
              : chosenNode.value_date != null
                ? chosenNode.value_date
                : null,
        _sheet: chosenSheet,
        _cell: chosenCell,
        _fallback: fallbackUsed || null,
      });
    }

    setStage("validate");
    const canonicalMapForValidation = {};
    for (const entry of outputsBySheetCell.values()) {
      canonicalMapForValidation[entry.canonical_key] = {
        value: entry._node_value,
        sheet: entry._sheet,
        cell: entry._cell,
      };
    }
    let validationFindings = { rejected: {}, warnings: [], error: null };
    try {
      const validationResult = validateCanonicalMap(canonicalMapForValidation);
      validationFindings = {
        rejected: validationResult.rejected,
        warnings: validationResult.warnings,
      };
      for (const rejectedKey of Object.keys(validationResult.rejected)) {
        for (const [tk, entry] of outputsBySheetCell.entries()) {
          if (entry.canonical_key === rejectedKey) {
            outputsBySheetCell.delete(tk);
            droppedOutputs.push({
              canonical_key: rejectedKey,
              sheet: entry._sheet,
              cell: entry._cell,
              reason: `cross-field validation: ${validationResult.rejected[rejectedKey].reason}`,
            });
            break;
          }
        }
      }
      console.log(
        "[underwriting-ingest] cross-field validation:",
        Object.keys(validationResult.rejected).length,
        "critical rejections,",
        validationResult.warnings.length,
        "warnings",
      );
    } catch (e) {
      console.error(
        "[underwriting-ingest] cross-field validation FAILED:",
        e?.message,
        e?.stack,
      );
      validationFindings.error = `validator threw: ${e?.message || String(e)}`;
    }

    let confidenceReport = { perField: {}, banner: {}, error: null };
    try {
      const cleanedMap = {};
      for (const entry of outputsBySheetCell.values()) {
        cleanedMap[entry.canonical_key] = {
          value: entry._node_value,
          sheet: entry._sheet,
          cell: entry._cell,
        };
      }
      const scoring = runConfidenceScoring(graph, cleanedMap);
      confidenceReport = {
        perField: scoring.perField,
        banner: scoring.banner,
        crossChecks: {
          findings: scoring.crossChecks.findings,
          summary: scoring.crossChecks.summary,
        },
        trace: {
          findings: scoring.trace.findings,
          summary: scoring.trace.summary,
        },
        error: null,
      };
      console.log(
        "[underwriting-ingest] confidence scoring:",
        scoring.banner.highConfidenceFieldCount,
        "high,",
        scoring.banner.mediumConfidenceFieldCount,
        "medium,",
        scoring.banner.lowConfidenceFieldCount,
        "low,",
        scoring.banner.criticalCount,
        "critical cross-check failures",
      );
    } catch (e) {
      console.error(
        "[underwriting-ingest] confidence scoring FAILED:",
        e?.message,
        e?.stack,
      );
      confidenceReport.error = `confidence scoring threw: ${e?.message || String(e)}`;
    }

    const sheetRoleByName = {};
    for (const [name, spec] of Object.entries(semantic.sheets || {})) {
      sheetRoleByName[name] = spec;
    }

    const headRes = await sr("/property_underwriting_model_graphs", {
      method: "POST",
      prefer: "return=minimal",
      body: [
        {
          id: graphId,
          org_id: profile.orgId,
          property_id,
          source_file_id: runRowSeed.source_file_id,
          source_file_path: runRowSeed.source_file_path,
          source_file_rev: runRowSeed.source_file_rev,
          discovery_run_id: runId,
          ai_model: CLAUDE_MODEL,
          prompt_chars: totalPromptChars,
          response_chars: totalResponseChars,
          sheet_count: graph.sheets.length,
          node_count: graph.nodes.length,
          edge_count: graph.edges.length,
          formula_count: graph.sheets.reduce((a, s) => a + s.formula_count, 0),
          is_active: false,
          ingested_at,
          named_ranges: graph.namedRanges || {},
        },
      ],
    });
    if (!headRes.ok) {
      await finalize({
        status: "error",
        error_stage: "parse_response",
        error_message: `Header insert failed: HTTP ${headRes.status} ${(headRes.raw || "").slice(0, 200)}`,
      });
      return jsonResponse(500, { error: "Graph header insert failed" });
    }

    const sheetRows = graph.sheets.map((s) => {
      const r = sheetRoleByName[s.name] || {};
      return {
        graph_id: graphId,
        org_id: profile.orgId,
        name: s.name,
        ordinal: s.ordinal,
        dim: s.dim,
        cell_count: s.cell_count,
        formula_count: s.formula_count,
        role: r.role || null,
        role_confidence:
          typeof r.confidence === "number"
            ? Math.max(0, Math.min(1, r.confidence))
            : null,
        external_source: r.external_source || null,
        role_notes: r.notes ? String(r.notes).slice(0, 600) : null,
      };
    });
    await srInsertBatched("/property_underwriting_model_sheets", sheetRows, {
      batchSize: DEFAULT_INSERT_BATCH_SIZE,
    });

    const externalBySheet = {};
    for (const s of sheetRows) externalBySheet[s.name] = s.external_source;

    const nodeRows = graph.nodes.map((n) => {
      const key = `${n.sheet}\x00${n.cell}`;
      const sem = outputsBySheetCell.get(key);
      let source_type = null;
      if (n.is_formula) source_type = "computed";
      else if (externalBySheet[n.sheet])
        source_type = `external_feed:${externalBySheet[n.sheet].split(":")[0]}`;
      else source_type = "manual_assumption";
      return {
        graph_id: graphId,
        org_id: profile.orgId,
        sheet: n.sheet,
        cell: n.cell,
        formula: n.formula ? n.formula.slice(0, 4000) : null,
        value_num: n.value_num ?? null,
        value_text: n.value_text ?? null,
        value_date: n.value_date ?? null,
        is_formula: !!n.is_formula,
        node_kind: n.is_formula
          ? "formula"
          : externalBySheet[n.sheet]
            ? "leaf_external"
            : "leaf_constant",
        semantic_label: sem?.semantic_label || null,
        canonical_key: sem?.canonical_key || null,
        canonical_role: sem?.canonical_key
          ? canonicalRole(sem.canonical_key)
          : null,
        source_type,
        semantic_confidence: sem?.semantic_confidence ?? null,
        label_hint: n.label_hint || null,
      };
    });
    await srInsertBatched("/property_underwriting_model_nodes", nodeRows, {
      batchSize: NODE_INSERT_BATCH_SIZE,
      concurrency: INSERT_CONCURRENCY,
    });

    const baselineRows = nodeRows.map((n) => ({
      graph_id: n.graph_id,
      org_id: n.org_id,
      sheet: n.sheet,
      cell: n.cell,
      is_formula: n.is_formula,
      value_num: n.value_num,
      value_text: n.value_text,
      value_date: n.value_date,
      formula: n.formula,
    }));
    await srInsertBatched(
      "/property_underwriting_model_node_baselines?on_conflict=graph_id,sheet,cell",
      baselineRows,
      {
        batchSize: NODE_INSERT_BATCH_SIZE,
        concurrency: INSERT_CONCURRENCY,
        prefer: "return=minimal,resolution=ignore-duplicates",
      },
    );

    const decodeOrNull = (addr) => {
      if (!addr) return null;
      try {
        return XLSX.utils.decode_cell(String(addr).replace(/\$/g, ""));
      } catch {
        return null;
      }
    };
    const edgeRows = graph.edges.map((e) => {
      let to_col_start = null,
        to_col_end = null,
        to_row_start = null,
        to_row_end = null;
      if (e.is_range && e.to_end_cell) {
        const a = decodeOrNull(e.to_cell);
        const b = decodeOrNull(e.to_end_cell);
        if (a && b) {
          to_col_start = a.c + 1;
          to_col_end = b.c + 1;
          to_row_start = a.r + 1;
          to_row_end = b.r + 1;
        }
      }
      return {
        graph_id: graphId,
        org_id: profile.orgId,
        from_sheet: e.from_sheet,
        from_cell: e.from_cell,
        to_sheet: e.to_sheet,
        to_cell: e.to_cell,
        to_end_cell: e.to_end_cell ?? null,
        is_range: !!e.is_range,
        range_count: e.range_count ?? null,
        to_col_start,
        to_col_end,
        to_row_start,
        to_row_end,
      };
    });
    await srInsertBatched("/property_underwriting_model_edges", edgeRows, {
      batchSize: EDGE_INSERT_BATCH_SIZE,
      concurrency: INSERT_CONCURRENCY,
    });

    try {
      const r = await sr(`/rpc/backfill_property_canonical_values`, {
        method: "POST",
        body: { p_graph_id: graphId },
      });
      if (!r.ok) {
        console.warn(
          "[ingest:canonical-backfill] HTTP",
          r.status,
          r.raw?.slice(0, 200),
        );
      }
    } catch (e) {
      console.warn("[ingest:canonical-backfill] threw:", e?.message);
    }

    try {
      const countRes = await sr(`/rpc/count_range_edges`, {
        method: "POST",
        body: { p_graph_id: graphId },
      });
      const rangeCount =
        countRes.ok && typeof countRes.body === "number" ? countRes.body : 0;

      console.log(
        `[ingest:expand] ${rangeCount} range edges for graph ${graphId}; materializing expansion...`,
      );

      let totalWideRows = 0;
      let totalPairs = 0;
      try {
        const pairsRes = await sr(
          `/rest/v1/property_underwriting_model_edges` +
            `?graph_id=eq.${graphId}` +
            `&is_range=eq.true` +
            `&or=(to_col_end.eq.16384,to_row_end.eq.1048576)` +
            `&select=to_sheet,from_sheet`,
          { method: "GET" },
        );
        const pairs =
          pairsRes.ok && Array.isArray(pairsRes.body)
            ? Array.from(
                new Set(
                  pairsRes.body
                    .map((r) =>
                      r.to_sheet && r.from_sheet
                        ? `${r.to_sheet}\t${r.from_sheet}`
                        : null,
                    )
                    .filter(Boolean),
                ),
              ).map((s) => {
                const [toSheet, fromSheet] = s.split("\t");
                return { toSheet, fromSheet };
              })
            : [];
        console.log(
          `[ingest:expand] ${pairs.length} (to_sheet, from_sheet) pairs with wide-arm edges; processing per-pair...`,
        );

        for (const { toSheet, fromSheet } of pairs) {
          const r = await sr(`/rpc/expand_whole_row_col_via_nodes_for_sheet`, {
            method: "POST",
            body: {
              p_graph_id: graphId,
              p_to_sheet: toSheet,
              p_from_sheet: fromSheet,
            },
          });
          if (r.ok) {
            const inserted = Number(r.body ?? 0);
            totalWideRows += inserted;
            totalPairs += 1;
            if (inserted > 0) {
              console.log(
                `[ingest:expand-wide] ${toSheet} / ${fromSheet}: ${inserted} rows`,
              );
            }
            continue;
          }

          console.warn(
            "[ingest:expand-wide]",
            toSheet,
            "/",
            fromSheet,
            "one-shot HTTP",
            r.status,
            (r.raw || "").slice(0, 200),
            "— falling back to per-from-row chunking",
          );
          const rowsR = await sr(`/rpc/wide_arm_from_rows_for_pair`, {
            method: "POST",
            body: {
              p_graph_id: graphId,
              p_to_sheet: toSheet,
              p_from_sheet: fromSheet,
            },
          });
          if (!rowsR.ok) {
            console.warn(
              "[ingest:expand-wide]",
              toSheet,
              "/",
              fromSheet,
              "distinct-rows lookup HTTP",
              rowsR.status,
              (rowsR.raw || "").slice(0, 200),
            );
            continue;
          }
          const fromRows = Array.isArray(rowsR.body)
            ? rowsR.body
                .map((row) => {
                  if (typeof row === "number") return row;
                  if (row && typeof row === "object") {
                    if (row.from_row_n != null) return Number(row.from_row_n);
                    if (row.wide_arm_from_rows_for_pair != null)
                      return Number(row.wide_arm_from_rows_for_pair);
                  }
                  return Number(row);
                })
                .filter((v) => Number.isFinite(v))
            : [];
          if (fromRows.length === 0) {
            console.warn(
              "[ingest:expand-wide]",
              toSheet,
              "/",
              fromSheet,
              "no distinct from-rows discovered for fallback",
            );
            continue;
          }
          let pairSubInserted = 0;
          let pairSubChunks = 0;
          for (const fromRow of fromRows) {
            const cr = await sr(
              `/rpc/expand_whole_row_col_via_nodes_for_sheet`,
              {
                method: "POST",
                body: {
                  p_graph_id: graphId,
                  p_to_sheet: toSheet,
                  p_from_sheet: fromSheet,
                  p_from_row_n: fromRow,
                },
              },
            );
            if (!cr.ok) {
              console.warn(
                "[ingest:expand-wide]",
                toSheet,
                "/",
                fromSheet,
                "from_row=",
                fromRow,
                "HTTP",
                cr.status,
                (cr.raw || "").slice(0, 200),
              );
              continue;
            }
            pairSubInserted += Number(cr.body ?? 0);
            pairSubChunks += 1;
          }
          totalWideRows += pairSubInserted;
          if (pairSubChunks > 0) totalPairs += 1;
          console.log(
            `[ingest:expand-wide] ${toSheet} / ${fromSheet}: ${pairSubInserted} rows across ${pairSubChunks}/${fromRows.length} from-row chunks (fallback)`,
          );
        }
        console.log(
          `[ingest:expand-wide] done: ${totalWideRows} rows across ${totalPairs}/${pairs.length} pairs`,
        );
      } catch (e) {
        console.warn("[ingest:expand-wide] threw:", e?.message);
      }

      let safety = 10;
      let totalBoundedRows = 0;
      let totalChunks = 0;
      while (safety-- > 0) {
        const r = await sr(`/rpc/rebuild_edges_expanded_bounded_loop`, {
          method: "POST",
          body: { p_graph_id: graphId, p_max_seconds: 60, p_batch_size: 1500 },
        });
        if (!r.ok) {
          console.warn(
            "[ingest:expand-bounded] HTTP",
            r.status,
            (r.raw || "").slice(0, 200),
          );
          break;
        }
        const row = Array.isArray(r.body) ? r.body[0] : null;
        const chunkRows = Number(row?.out_total_rows ?? 0);
        const chunkRuns = Number(row?.out_chunks_run ?? 0);
        const remaining = Number(row?.out_source_remaining ?? 0);
        totalBoundedRows += chunkRows;
        totalChunks += chunkRuns;
        console.log(
          `[ingest:expand-bounded] chunks=${chunkRuns} rows=${chunkRows} remaining=${remaining}`,
        );
        if (remaining <= 0) break;
      }
      console.log(
        `[ingest:expand] done: ${totalWideRows} wide + ${totalBoundedRows} bounded across ${totalChunks} bounded-chunks`,
      );

      try {
        const bf = await sr(`/rpc/backfill_edges_expanded_from_bounds`, {
          method: "POST",
          body: { p_graph_id: graphId },
        });
        if (!bf.ok) {
          console.warn(
            "[ingest:expand-bounds] HTTP",
            bf.status,
            (bf.raw || "").slice(0, 200),
          );
        } else {
          console.log(`[ingest:expand-bounds] backfilled ${bf.body ?? 0} rows`);
        }
      } catch (e) {
        console.warn("[ingest:expand-bounds] threw:", e?.message);
      }
    } catch (e) {
      console.warn("[ingest:expand] threw:", e?.message);
    }

    const preview = {};
    const mapping = {};
    for (const n of nodeRows) {
      if (!n.canonical_key) continue;
      const val = n.value_num ?? n.value_text ?? n.value_date ?? null;
      preview[n.canonical_key] = val;
      mapping[n.canonical_key] = {
        sheet: n.sheet,
        cell: n.cell,
        label: n.semantic_label,
        confidence: n.semantic_confidence,
        role: n.canonical_role,
      };
    }

    const { ok: semanticPassComplete, failedGroups: semanticPassFailedGroups } =
      isSemanticPassComplete(groupDiagnostics);
    if (semanticPassComplete) {
      try {
        await sr(
          `/property_underwriting_model_graphs?property_id=eq.${property_id}&is_active=eq.true&id=neq.${graphId}`,
          {
            method: "PATCH",
            body: { is_active: false, deactivated_at: ingested_at },
            prefer: "return=minimal",
          },
        );
        const activateRes = await sr(
          `/property_underwriting_model_graphs?id=eq.${graphId}`,
          {
            method: "PATCH",
            body: { is_active: true },
            prefer: "return=minimal",
          },
        );
        if (!activateRes.ok) {
          console.warn(
            `[underwriting-ingest] active-swap: activate PATCH failed status=${activateRes.status} — property has no active graph; rerun ingest or manually flip is_active`,
          );
        } else {
          console.log(
            `[underwriting-ingest] active-swap: ${graphId} now active for property ${property_id}`,
          );

          try {
            const replaceRes = await sr(
              `/rpc/backfill_property_canonical_values`,
              {
                method: "POST",
                body: { p_graph_id: graphId, p_replace: true },
              },
            );
            if (!replaceRes.ok) {
              console.warn(
                "[underwriting-ingest] canonical clear-and-replace HTTP",
                replaceRes.status,
                replaceRes.raw?.slice(0, 200),
              );
            } else {
              console.log(
                `[underwriting-ingest] canonical clear-and-replace: ${graphId} -> ${replaceRes.body ?? "?"} keys`,
              );
            }
          } catch (e) {
            console.warn(
              "[underwriting-ingest] canonical clear-and-replace threw:",
              e?.message,
            );
          }
        }
      } catch (e) {
        console.warn(`[underwriting-ingest] active-swap threw:`, e?.message);
      }
    } else {
      const names = semanticPassFailedGroups.join(", ");
      console.warn(
        `[underwriting-ingest] active-swap BLOCKED: ${semanticPassFailedGroups.length}/4 ` +
          `semantic groups failed (${names}); leaving graph ${graphId} is_active=false ` +
          `for property ${property_id}. Prior active graph (if any) is untouched. ` +
          `Inspect underwriting_discovery_runs.workbook_summary.semantic_groups for per-group diagnostics; ` +
          `once root cause is resolved, set is_active=true and rerun the canonical clear and backfill.`,
      );
    }

    setStage("tabular");
    const tabular_summary = {
      extractors: {},
      total_rows_inserted: 0,
      total_warnings: 0,
      errors: [],
    };
    let tabularResults = null;
    try {
      const tabularCtx = tabular.extractorContext({
        graphId,
        orgId: profile.orgId,
        propertyId: property_id,
        sourceFileId: runRowSeed.source_file_id,
      });
      tabularResults = await tabular.runAllTabularExtractions(
        graph,
        workbook,
        tabularCtx,
      );
      tabular_summary.total_warnings = tabularResults.totalWarnings;

      const unitMixResult = tabularResults.results.find(
        (r) => r.table === "property_underwriting_unit_mix",
      );
      let unitMixCorrection = null;
      try {
        if (unitMixResult && unitMixResult.rows.length > 0) {
          const originalCount = unitMixResult.rows.length;
          const correction = correctTabularUnitMix(
            unitMixResult.rows,
            canonicalMapForValidation,
          );
          const findings = validateTabularUnitMix(
            correction.rows,
            canonicalMapForValidation,
          );
          unitMixResult.rows = correction.rows;
          unitMixCorrection = {
            original_count: originalCount,
            final_count: correction.rows.length,
            removed: correction.removed.map((r) => ({
              unit_type: r.row.unit_type,
              section: r.row.section,
              unit_count: r.row.unit_count,
              reason: r.reason,
            })),
            remaining_findings: findings,
          };
          console.log(
            "[underwriting-ingest] unit_mix correction:",
            originalCount,
            "→",
            correction.rows.length,
            `(${correction.removed.length} removed, ${findings.length} unresolved findings)`,
          );
        }
      } catch (e) {
        console.error(
          "[underwriting-ingest] unit_mix correction FAILED:",
          e?.message,
          e?.stack,
        );
        unitMixCorrection = {
          error: `corrector threw: ${e?.message || String(e)}`,
        };
      }
      tabular_summary.unit_mix_correction = unitMixCorrection;

      for (const result of tabularResults.results) {
        let writeOutcome = { inserted: 0, errors: [] };
        if (result.rows.length) {
          writeOutcome = await tabular.writeTabularRows(
            result.table,
            result.rows,
            { srInsertBatched },
          );
        }
        tabular_summary.extractors[result.table] = {
          extractor: result.extractor,
          rows_extracted: result.rows.length,
          rows_inserted: writeOutcome.inserted,
          write_errors: writeOutcome.errors,
          warnings: result.warnings.slice(0, 10),
          diag: result.diag,
        };
        tabular_summary.total_rows_inserted += writeOutcome.inserted;
        if (writeOutcome.errors.length) {
          tabular_summary.errors.push(
            ...writeOutcome.errors.map((e) => `${result.table}: ${e}`),
          );
        }
      }
    } catch (e) {
      console.error(
        "[underwriting-ingest-model-background] tabular phase threw:",
        e?.message || e,
      );
      tabular_summary.errors.push(`catastrophic: ${e?.message || String(e)}`);
    }

    setStage("audit_testing");
    let auditReport = {
      findings: [],
      summary: {},
      sourcesUsesLedger: null,
      error: null,
    };
    try {
      const tabularForAudit = {};
      const findRows = (table) => {
        if (!tabularResults?.results) return [];
        const r = tabularResults.results.find((x) => x.table === table);
        return r?.rows || [];
      };
      tabularForAudit.unit_mix = findRows("property_underwriting_unit_mix");
      tabularForAudit.capex_schedule = findRows(
        "property_underwriting_capex_schedule",
      );
      tabularForAudit.debt_schedule = findRows(
        "property_underwriting_debt_schedule",
      );
      tabularForAudit.monthly_noi = findRows(
        "property_underwriting_monthly_noi",
      );

      const auditMap = {};
      for (const entry of outputsBySheetCell.values()) {
        auditMap[entry.canonical_key] = {
          value: entry._node_value,
          sheet: entry._sheet,
          cell: entry._cell,
        };
      }
      const audit = runAudit(auditMap, tabularForAudit);
      auditReport = {
        findings: audit.findings,
        summary: audit.summary,
        sourcesUsesLedger: audit.sourcesUsesLedger,
        error: null,
      };
      console.log(
        "[underwriting-ingest] audit testing:",
        audit.summary.verified,
        "verified,",
        audit.summary.mismatched,
        "mismatched (",
        audit.summary.criticalMismatches.length,
        "critical),",
        audit.summary.skipped,
        "skipped — sources/uses gap:",
        audit.sourcesUsesLedger?.gap?.toLocaleString?.() ?? "?",
      );
    } catch (e) {
      console.error(
        "[underwriting-ingest] audit testing FAILED:",
        e?.message,
        e?.stack,
      );
      auditReport.error = `audit threw: ${e?.message || String(e)}`;
    }

    const formulaAudit = null;

    const partialSemanticPass = !semanticPassComplete;
    const partialSemanticPassMessage = partialSemanticPass
      ? `pre-activation guard: ${semanticPassFailedGroups.length}/4 semantic groups failed (${semanticPassFailedGroups.join(", ")}); graph left is_active=false`
      : null;
    await finalize({
      status: partialSemanticPass ? "error" : "complete",
      error_stage: partialSemanticPass ? "partial_semantic_ai" : null,
      error_message: partialSemanticPassMessage,
      mapping,
      preview_values: preview,
      workbook_summary: {
        sheet_count: graph.sheets.length,
        shown_sheets: graph.sheets.map((s) => ({
          name: s.name,
          dim: s.dim,
          rows_shown: 0,
        })),
        skipped_sheets: [],
        graph_id: graphId,
        node_count: graph.nodes.length,
        edge_count: graph.edges.length,
        formula_count: graph.sheets.reduce((a, s) => a + s.formula_count, 0),
        dropped_outputs: droppedOutputs,
        semantic_groups: groupDiagnostics,
        tabular_summary,
        validation_findings: validationFindings,
        confidence_report: confidenceReport,
        audit_report: auditReport,
        formula_audit: formulaAudit,
      },
      prompt_chars: totalPromptChars,
      response_chars: totalResponseChars,
    });

    return jsonResponse(200, { ok: true, run_id: runId, graph_id: graphId });
  } catch (e) {
    console.error("[underwriting-ingest-model-background] exception:", e);
    await finalize({
      status: "error",
      error_stage: "unknown",
      error_message: e?.message || String(e),
    });
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
