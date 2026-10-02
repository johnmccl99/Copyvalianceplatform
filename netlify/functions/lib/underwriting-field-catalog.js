export const FIELD_CATALOG = {
  model_property_name: {
    category: "IDENTITY",
    definition: "Property name as labeled in the underwriting model.",
    units: "text",
  },
  model_street_address: {
    category: "IDENTITY",
    definition: "Property street address.",
    units: "text",
  },
  model_city: {
    category: "IDENTITY",
    definition: "City where the property is located.",
    units: "text",
  },
  model_state: {
    category: "IDENTITY",
    definition: "US state (2-letter or full name).",
    units: "text",
  },
  model_zip: {
    category: "IDENTITY",
    definition: "Postal code.",
    units: "text",
  },
  model_county: {
    category: "IDENTITY",
    definition: "County name.",
    units: "text",
  },
  model_neighborhood: {
    category: "IDENTITY",
    definition: "Neighborhood / district name.",
    units: "text",
  },
  model_submarket: {
    category: "IDENTITY",
    definition: 'Real-estate submarket designation (e.g. "Berkeley South").',
    units: "text",
  },
  year_built: {
    category: "IDENTITY",
    definition: "Year the building was originally constructed.",
    units: "count",
    expectedRange: { min: 1850, max: 2030 },
  },
  lot_size_sf: {
    category: "IDENTITY",
    definition: "Land parcel size in square feet.",
    units: "sf",
    expectedRange: { min: 1_000, max: 5_000_000 },
  },
  rentable_sf_pro_forma: {
    category: "IDENTITY",
    definition:
      "Total rentable square footage of the building post-stabilization (RSF).",
    units: "sf",
    expectedRange: { min: 1_000, max: 1_500_000 },
  },
  gross_sf_pro_forma: {
    category: "IDENTITY",
    definition:
      "Total gross building square footage including common area (GSF). GSF >= RSF.",
    units: "sf",
    expectedRange: { min: 1_000, max: 1_500_000 },
  },

  units_at_acquisition: {
    category: "UNITS",
    definition:
      "Number of residential units in the building at the time of acquisition (before any renovation).",
    units: "count",
    expectedRange: { min: 1, max: 5_000 },
  },
  units_pro_forma: {
    category: "UNITS",
    definition:
      "Total units post-stabilization (typically equals units_at_acquisition + units_adu added during reno).",
    units: "count",
    expectedRange: { min: 1, max: 5_000 },
    formula: "units_pro_forma ≈ units_at_acquisition + units_adu",
  },
  units_residential: {
    category: "UNITS",
    definition: "Number of residential (non-retail) units.",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
  },
  units_adu: {
    category: "UNITS",
    definition:
      "Number of Accessory Dwelling Units (ADUs), typically added during renovation.",
    units: "count",
    expectedRange: { min: 0, max: 100 },
  },
  units_retail: {
    category: "UNITS",
    definition: "Number of retail / commercial ground-floor units.",
    units: "count",
    expectedRange: { min: 0, max: 100 },
  },
  units_bmr: {
    category: "UNITS",
    definition:
      "Number of below-market-rate (affordable) units governed by deed restriction.",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
  },
  units_rent_controlled: {
    category: "UNITS",
    definition: "Total units subject to rent control (sum across tiers).",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
    formula:
      "units_rent_controlled = units_rent_controlled_tier1 + tier2 + tier3",
  },
  units_rent_controlled_tier1: {
    category: "UNITS",
    definition: "Rent-controlled tier 1 (typically the strictest controls).",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
  },
  units_rent_controlled_tier2: {
    category: "UNITS",
    definition: "Rent-controlled tier 2.",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
  },
  units_rent_controlled_tier3: {
    category: "UNITS",
    definition: "Rent-controlled tier 3.",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
  },
  units_under_renovation: {
    category: "UNITS",
    definition:
      "Number of units currently offline for renovation as of the model date.",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
  },
  units_reno_complete_lt_12mo: {
    category: "UNITS",
    definition:
      "Units whose renovation completed within the last 12 months (recently delivered).",
    units: "count",
    expectedRange: { min: 0, max: 5_000 },
  },

  avg_rent_per_unit_acquisition: {
    category: "RENT",
    definition: "Average in-place rent per unit at acquisition ($/month/unit).",
    units: "dollars",
    expectedRange: { min: 200, max: 30_000 },
    shouldNotDependOn: ["debt_service_annual", "capex_budget_total"],
  },
  avg_rent_per_unit_pro_forma: {
    category: "RENT",
    definition:
      "Average proforma (post-stabilization, post-renovation) rent per unit ($/month/unit).",
    units: "dollars",
    expectedRange: { min: 200, max: 30_000 },
    shouldNotDependOn: ["debt_service_annual", "capex_budget_total"],
  },
  avg_rent_per_unit_market: {
    category: "RENT",
    definition:
      "Average comp-market rent per unit ($/month/unit), for comparison vs. proforma.",
    units: "dollars",
    expectedRange: { min: 200, max: 30_000 },
  },
  rent_per_sf_acquisition: {
    category: "RENT",
    definition:
      "In-place rent per rentable square foot at acquisition ($/SF/month or annualized).",
    units: "dollars",
    expectedRange: { min: 0.5, max: 25 },
  },
  rent_per_sf_pro_forma: {
    category: "RENT",
    definition: "Proforma rent per rentable square foot.",
    units: "dollars",
    expectedRange: { min: 0.5, max: 25 },
  },
  rent_per_sf_market: {
    category: "RENT",
    definition: "Market comp rent per rentable square foot.",
    units: "dollars",
    expectedRange: { min: 0.5, max: 25 },
  },
  occupancy_at_acquisition: {
    category: "RENT",
    definition: "Physical/economic occupancy at acquisition (fraction).",
    units: "rate",
    expectedRange: { min: 0, max: 1 },
  },
  occupancy_stabilized: {
    category: "RENT",
    definition: "Targeted post-stabilization occupancy (fraction).",
    units: "rate",
    expectedRange: { min: 0, max: 1 },
  },
  loss_to_lease_pct: {
    category: "RENT",
    definition:
      "Loss-to-lease as a fraction of market rent (0.05 = 5% below market).",
    units: "rate",
    expectedRange: { min: -0.5, max: 0.5 },
  },

  gpr_annual: {
    category: "INCOME",
    definition:
      "Gross Potential Rent annualized (Year 1 typical). 100% occupancy at proforma rents.",
    units: "dollars",
    expectedRange: { min: 50_000, max: 100_000_000 },
    shouldNotDependOn: [
      "debt_service_annual",
      "capex_budget_total",
      "closing_costs_total",
    ],
  },
  noi_year_1: {
    category: "INCOME",
    definition:
      "Net Operating Income for Year 1 of the hold. NOI = EGI − OpEx.",
    units: "dollars",
    expectedRange: { min: 10_000, max: 100_000_000 },
    dependsOn: ["gpr_annual"],
    shouldNotDependOn: [
      "debt_service_annual",
      "capex_budget_total",
      "closing_costs_total",
    ],
    formula: "noi = effective_gross_income - operating_expenses_total",
  },

  other_income_year_1: {
    category: "INCOME",
    definition:
      "Year-1 ancillary income outside of base unit rents — laundry, parking, RUBS, pet fees, retail, late fees, application/admin fees.",
    units: "dollars",
    expectedRange: { min: 0, max: 10_000_000 },
    shouldNotDependOn: [
      "debt_service_annual",
      "capex_budget_total",
      "closing_costs_total",
    ],
  },

  purchase_price: {
    category: "BASIS",
    definition:
      "Contract purchase price for the property. Excludes closing costs and capex.",
    units: "dollars",
    expectedRange: { min: 100_000, max: 5_000_000_000 },
  },
  closing_costs_total: {
    category: "BASIS",
    definition:
      "Total closing/transaction costs at acquisition (title, transfer tax, legal, broker, etc.).",
    units: "dollars",
    expectedRange: { min: 1_000, max: 100_000_000 },
  },
  capex_budget_total: {
    category: "BASIS",
    definition:
      "Total capital expenditure budget for renovation/repositioning.",
    units: "dollars",
    expectedRange: { min: 0, max: 500_000_000 },
  },
  capex_interior_renovation: {
    category: "BASIS",
    definition:
      "Capex sub-bucket: interior renovation work (units, finishes, fixtures).",
    units: "dollars",
    expectedRange: { min: 0, max: 500_000_000 },
  },
  capex_common_area: {
    category: "BASIS",
    definition:
      "Capex sub-bucket: common area improvements (lobby, hallways, amenities).",
    units: "dollars",
    expectedRange: { min: 0, max: 50_000_000 },
  },
  capex_mechanical_electrical_plumbing: {
    category: "BASIS",
    definition:
      "Capex sub-bucket: MEP — mechanical, electrical, plumbing systems.",
    units: "dollars",
    expectedRange: { min: 0, max: 50_000_000 },
  },
  capex_soft_costs: {
    category: "BASIS",
    definition:
      "Capex sub-bucket: design, architecture, permits, contingency soft costs.",
    units: "dollars",
    expectedRange: { min: 0, max: 50_000_000 },
  },
  capex_contingency: {
    category: "BASIS",
    definition: "Capex sub-bucket: contingency reserve for cost overruns.",
    units: "dollars",
    expectedRange: { min: 0, max: 50_000_000 },
  },
  all_in_basis: {
    category: "BASIS",
    definition:
      "Total project cost: purchase price + closing costs + capex budget. Denominator for yield-on-cost.",
    units: "dollars",
    expectedRange: { min: 100_000, max: 5_000_000_000 },
    dependsOn: ["purchase_price", "closing_costs_total", "capex_budget_total"],
    formula:
      "all_in_basis = purchase_price + closing_costs_total + capex_budget_total",
  },
  loan_proceeds: {
    category: "BASIS",
    definition:
      "Total senior loan proceeds drawn at close (or peak draw if construction loan).",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
    aliases: ["senior_loan_amount"],
  },
  equity_required: {
    category: "BASIS",
    definition:
      "Total equity required = all_in_basis − loan_proceeds. The check the LPs and GP write at close.",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
    dependsOn: ["all_in_basis", "loan_proceeds"],
    formula: "equity_required = all_in_basis - loan_proceeds",
  },
  follow_on_needed: {
    category: "BASIS",
    definition:
      "Additional equity capital calls expected during the hold (capex draws, interest reserves).",
    units: "dollars",
    expectedRange: { min: 0, max: 1_000_000_000 },
  },
  price_per_unit: {
    category: "BASIS",
    definition:
      "Purchase price per unit. price_per_unit = purchase_price / units_at_acquisition.",
    units: "dollars",
    expectedRange: { min: 5_000, max: 5_000_000 },
    dependsOn: ["purchase_price", "units_at_acquisition"],
    formula: "price_per_unit = purchase_price / units_at_acquisition",
  },
  price_per_bed: {
    category: "BASIS",
    definition:
      "Purchase price per bedroom (purchase_price / total bedrooms across mix).",
    units: "dollars",
    expectedRange: { min: 5_000, max: 2_000_000 },
  },
  price_per_rsf: {
    category: "BASIS",
    definition: "Purchase price per rentable square foot.",
    units: "dollars",
    expectedRange: { min: 50, max: 5_000 },
    dependsOn: ["purchase_price", "rentable_sf_pro_forma"],
    formula: "price_per_rsf = purchase_price / rentable_sf_pro_forma",
  },
  price_per_gsf: {
    category: "BASIS",
    definition: "Purchase price per gross square foot.",
    units: "dollars",
    expectedRange: { min: 50, max: 5_000 },
    dependsOn: ["purchase_price", "gross_sf_pro_forma"],
  },

  going_in_cap_rate_t12: {
    category: "YIELDS",
    definition: "Cap rate using trailing-12-months NOI / purchase price.",
    units: "rate",
    expectedRange: { min: 0.001, max: 0.2 },
  },
  going_in_cap_rate_y1: {
    category: "YIELDS",
    definition:
      "Year-1 cap rate: NOI Year 1 / purchase price (or all-in basis).",
    units: "rate",
    expectedRange: { min: 0.001, max: 0.2 },
  },
  going_in_cap_rate_y2: {
    category: "YIELDS",
    definition: "Year-2 cap rate.",
    units: "rate",
    expectedRange: { min: 0.001, max: 0.2 },
  },
  going_in_cap_rate_y3: {
    category: "YIELDS",
    definition: "Year-3 cap rate.",
    units: "rate",
    expectedRange: { min: 0.001, max: 0.2 },
  },
  stabilized_yield_on_cost: {
    category: "YIELDS",
    definition:
      "Yield on cost at stabilization: stabilized NOI / all-in basis.",
    units: "rate",
    expectedRange: { min: 0.01, max: 0.3 },
    dependsOn: ["noi_year_1", "all_in_basis"],
    formula: "yield_on_cost = stabilized_noi / all_in_basis",
  },
  avg_yield: {
    category: "YIELDS",
    definition:
      "Average annualized yield across the hold (cash-on-cash before sale).",
    units: "rate",
    expectedRange: { min: 0, max: 0.3 },
  },
  avg_yield_w_o_sale: {
    category: "YIELDS",
    definition:
      "Average yield excluding sale/disposition proceeds (operating cash yield only).",
    units: "rate",
    expectedRange: { min: 0, max: 0.3 },
  },
  avg_yield_on_unreturned_equity: {
    category: "YIELDS",
    definition:
      "Average yield calculated on UNRETURNED equity (after refi/distributions).",
    units: "rate",
    expectedRange: { min: 0, max: 0.5 },
  },
  yield_origination: {
    category: "YIELDS",
    definition: "Yield at loan origination (NOI / loan amount).",
    units: "rate",
    expectedRange: { min: 0, max: 0.3 },
  },
  yield_outstanding: {
    category: "YIELDS",
    definition: "Yield on outstanding loan balance.",
    units: "rate",
    expectedRange: { min: 0, max: 0.3 },
  },
  yield_os_equity_y1_post_refi: {
    category: "YIELDS",
    definition: "Year-1 yield on outstanding equity post-refinance.",
    units: "rate",
    expectedRange: { min: 0, max: 0.5 },
  },

  levered_irr: {
    category: "RETURNS",
    definition: "Deal-level levered IRR (after debt service).",
    units: "rate",
    expectedRange: { min: -0.5, max: 1.0 },
  },
  unlevered_irr: {
    category: "RETURNS",
    definition:
      "Deal-level unlevered IRR (assumes all-cash purchase, no debt).",
    units: "rate",
    expectedRange: { min: -0.5, max: 0.5 },
  },
  equity_multiple_levered: {
    category: "RETURNS",
    definition:
      "Levered equity multiple: total distributions / equity invested.",
    units: "rate",
    expectedRange: { min: 0, max: 10 },
  },
  equity_multiple_unlevered: {
    category: "RETURNS",
    definition: "Unlevered equity multiple.",
    units: "rate",
    expectedRange: { min: 0, max: 10 },
  },
  lp_irr: {
    category: "RETURNS",
    definition: "Limited Partner (investor) net IRR, after promote/waterfall.",
    units: "rate",
    expectedRange: { min: -0.5, max: 1.0 },
  },
  lp_equity_multiple: {
    category: "RETURNS",
    definition: "LP net equity multiple.",
    units: "rate",
    expectedRange: { min: 0, max: 10 },
  },
  lp_avg_annual_cash_on_cash: {
    category: "RETURNS",
    definition: "LP average annual cash-on-cash return across the hold.",
    units: "rate",
    expectedRange: { min: -0.5, max: 0.5 },
  },
  lp_peak_equity: {
    category: "RETURNS",
    definition:
      "Peak LP equity outstanding (max capital deployed before distributions).",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
  },
  lp_return_of_capital_date: {
    category: "RETURNS",
    definition: "Date LP capital is fully returned (refi or sale).",
    units: "date",
  },
  gp_irr: {
    category: "RETURNS",
    definition: "General Partner (sponsor) IRR including promote.",
    units: "rate",
    expectedRange: { min: -0.5, max: 5.0 },
  },
  gp_equity_multiple: {
    category: "RETURNS",
    definition: "GP equity multiple.",
    units: "rate",
    expectedRange: { min: 0, max: 50 },
  },
  gp_promote_earned: {
    category: "RETURNS",
    definition:
      "Total promote/carried interest earned by the GP across the hold.",
    units: "dollars",
    expectedRange: { min: 0, max: 1_000_000_000 },
  },
  target_investor_irr: {
    category: "RETURNS",
    definition: "Underwritten/targeted IRR for the investor (LP) at the close.",
    units: "rate",
    expectedRange: { min: 0, max: 0.5 },
  },
  target_investor_em: {
    category: "RETURNS",
    definition: "Underwritten/targeted equity multiple for the investor.",
    units: "rate",
    expectedRange: { min: 0.5, max: 10 },
  },

  acquisition_date: {
    category: "DATES",
    definition:
      "Acquisition / closing date (when the deal closes and ownership transfers).",
    units: "date",
    aliases: ["purchase_date"],
  },
  refinance_date: {
    category: "DATES",
    definition:
      "Targeted refinance date (when bridge loan is refinanced into perm or partial returns of capital).",
    units: "date",
  },
  sale_date: {
    category: "DATES",
    definition: "Targeted disposition / sale date.",
    units: "date",
  },
  hold_period_years: {
    category: "DATES",
    definition: "Hold period in years (acquisition to sale).",
    units: "years",
    expectedRange: { min: 0.5, max: 30 },
    dependsOn: ["acquisition_date", "sale_date"],
  },

  rent_growth_pct: {
    category: "GROWTH",
    definition: "Annual rent growth assumption (fraction).",
    units: "rate",
    expectedRange: { min: -0.1, max: 0.2 },
  },
  expense_growth_pct: {
    category: "GROWTH",
    definition: "Annual operating expense growth assumption.",
    units: "rate",
    expectedRange: { min: -0.05, max: 0.2 },
  },
  tax_escalation_pct: {
    category: "GROWTH",
    definition: "Annual property tax escalation assumption.",
    units: "rate",
    expectedRange: { min: -0.05, max: 0.3 },
  },
  vacancy_pct: {
    category: "GROWTH",
    definition: "Stabilized vacancy assumption (1 - occupancy).",
    units: "rate",
    expectedRange: { min: 0, max: 0.5 },
  },

  senior_loan_amount: {
    category: "DEBT",
    definition:
      "Senior debt principal at origination. For value-add bridges this is typically the TOTAL committed amount including future capex draws (not the initial Day-1 funding). Use senior_loan_initial_draw to disambiguate.",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
  },

  senior_loan_initial_draw: {
    category: "DEBT",
    definition:
      "Senior loan amount funded at the close of the deal (Day-1 funding). Excludes future capex / interest-reserve draws. Typically used for at-close LTC computation.",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
    aliases: ["senior_loan_proceeds_at_close", "initial_loan_draw"],
  },

  senior_loan_committed_amount: {
    category: "DEBT",
    definition:
      "Total senior loan commitment (initial draw + all future tranches). Used for LTC at full funding (committed LTC).",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
    aliases: ["senior_loan_total", "senior_loan_total_commitment"],
  },
  senior_loan_rate: {
    category: "DEBT",
    definition: "Senior loan all-in interest rate (fraction).",
    units: "rate",
    expectedRange: { min: 0, max: 0.25 },
  },
  senior_loan_ltv: {
    category: "DEBT",
    definition:
      "Senior loan loan-to-value (loan / value at origination, typically purchase price or appraised value).",
    units: "rate",
    expectedRange: { min: 0, max: 1 },
    dependsOn: ["senior_loan_amount", "purchase_price"],
    formula: "ltv = senior_loan_amount / purchase_price",
  },

  senior_loan_ltc: {
    category: "DEBT",
    definition:
      "Senior loan loan-to-cost (loan / total project cost). Common for value-add and bridge loans where the loan funds purchase + capex.",
    units: "rate",
    expectedRange: { min: 0, max: 1 },
    dependsOn: ["senior_loan_amount", "all_in_basis"],
    formula: "ltc = senior_loan_amount / all_in_basis",
  },
  senior_loan_maturity_date: {
    category: "DEBT",
    definition: "Senior loan maturity date.",
    units: "date",
  },
  senior_loan_lender: {
    category: "DEBT",
    definition: "Senior loan lender entity name.",
    units: "text",
  },
  bridge_loan_amount: {
    category: "DEBT",
    definition: "Bridge loan principal (if applicable).",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
  },
  bridge_loan_proceeds_at_close: {
    category: "DEBT",
    definition: "Bridge loan initial draw at close (vs. future capex draws).",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
  },
  bridge_loan_rate_all_in: {
    category: "DEBT",
    definition: "Bridge loan all-in interest rate.",
    units: "rate",
    expectedRange: { min: 0, max: 0.25 },
  },
  bridge_loan_spread_bps: {
    category: "DEBT",
    definition: "Bridge loan spread over the index (in basis points).",
    units: "count",
    expectedRange: { min: 0, max: 1500 },
  },
  debt_service_annual: {
    category: "DEBT",
    definition:
      "Annual debt service (interest + principal) on the senior loan.",
    units: "dollars",
    expectedRange: { min: 0, max: 500_000_000 },
    shouldNotDependOn: ["gpr_annual", "capex_budget_total"],
  },

  interest_reserve_capitalized: {
    category: "DEBT",
    definition:
      "Capitalized interest reserve held back at close — funds interest payments through stabilization. Counts as a Source (it's loan-funded) but not as initial loan proceeds.",
    units: "dollars",
    expectedRange: { min: 0, max: 50_000_000 },
    aliases: ["interest_reserve", "capitalized_interest", "cap_int_reserve"],
  },

  oid_or_loan_fees: {
    category: "DEBT",
    definition:
      "Original issue discount (OID) and loan origination fees — typically 0.5–2% of loan amount, deducted from initial proceeds OR included in basis as a use.",
    units: "dollars",
    expectedRange: { min: 0, max: 50_000_000 },
    aliases: ["loan_fees", "origination_fees", "oid"],
  },

  sale_price: {
    category: "DISPOSITION",
    definition: "Modeled disposition / sale price at exit.",
    units: "dollars",
    expectedRange: { min: 100_000, max: 10_000_000_000 },
  },
  terminal_cap_rate: {
    category: "DISPOSITION",
    definition:
      "Exit/terminal cap rate (used to compute sale price from exit-year NOI).",
    units: "rate",
    expectedRange: { min: 0.01, max: 0.2 },
  },
  terminal_cap_rate_tax_adj: {
    category: "DISPOSITION",
    definition:
      "Tax-adjusted terminal cap rate (incorporating prop-tax reset at sale).",
    units: "rate",
    expectedRange: { min: 0.01, max: 0.2 },
  },
  disposition_proceeds_gross: {
    category: "DISPOSITION",
    definition:
      "Gross proceeds at disposition (before closing costs and debt payoff).",
    units: "dollars",
    expectedRange: { min: 0, max: 10_000_000_000 },
  },
  disposition_proceeds_net: {
    category: "DISPOSITION",
    definition:
      "Net proceeds at disposition (after closing costs and debt payoff).",
    units: "dollars",
    expectedRange: { min: 0, max: 10_000_000_000 },
  },

  equity_required_total: {
    category: "PARTNERSHIP",
    definition:
      "Total equity (LP + GP + co-invest) required to close the deal. Same as equity_required.",
    units: "dollars",
    expectedRange: { min: 0, max: 5_000_000_000 },
    aliases: ["equity_required"],
  },
};

export const CROSS_CHECKS = [
  {
    id: "all_in_basis_sum",
    description:
      "all_in_basis = purchase_price + closing_costs_total + capex_budget_total",
    fields: [
      "all_in_basis",
      "purchase_price",
      "closing_costs_total",
      "capex_budget_total",
    ],
    check: (v) => ({
      lhs: v.all_in_basis,
      rhs:
        (v.purchase_price || 0) +
        (v.closing_costs_total || 0) +
        (v.capex_budget_total || 0),
    }),
    tolerance: 0.005,
    severity: "critical",
  },
  {
    id: "sources_uses_balance",
    description:
      "loan_proceeds + equity_required ≈ all_in_basis (sources = uses)",
    fields: ["loan_proceeds", "equity_required", "all_in_basis"],
    check: (v) => ({
      lhs:
        (v.loan_proceeds || v.senior_loan_amount || 0) +
        (v.equity_required || v.equity_required_total || 0),
      rhs: v.all_in_basis,
    }),
    tolerance: 0.02,
    severity: "critical",
  },
  {
    id: "price_per_unit_consistency",
    description: "price_per_unit × units_at_acquisition ≈ purchase_price",
    fields: ["price_per_unit", "units_at_acquisition", "purchase_price"],
    check: (v) => ({
      lhs: (v.price_per_unit || 0) * (v.units_at_acquisition || 0),
      rhs: v.purchase_price,
    }),
    tolerance: 0.01,
    severity: "warning",
  },
  {
    id: "price_per_rsf_consistency",
    description: "price_per_rsf × rentable_sf_pro_forma ≈ purchase_price",
    fields: ["price_per_rsf", "rentable_sf_pro_forma", "purchase_price"],
    check: (v) => ({
      lhs: (v.price_per_rsf || 0) * (v.rentable_sf_pro_forma || 0),
      rhs: v.purchase_price,
    }),
    tolerance: 0.02,
    severity: "warning",
  },
  {
    id: "going_in_cap_rate_y1_implies_noi",
    description: "going_in_cap_rate_y1 × purchase_price ≈ noi_year_1",
    fields: ["going_in_cap_rate_y1", "purchase_price", "noi_year_1"],
    check: (v) => ({
      lhs: (v.going_in_cap_rate_y1 || 0) * (v.purchase_price || 0),
      rhs: v.noi_year_1,
    }),
    tolerance: 0.05,
    severity: "warning",
  },
  {
    id: "yield_on_cost_implies_noi",
    description: "stabilized_yield_on_cost × all_in_basis ≈ noi_year_1",
    fields: ["stabilized_yield_on_cost", "all_in_basis", "noi_year_1"],
    check: (v) => ({
      lhs: (v.stabilized_yield_on_cost || 0) * (v.all_in_basis || 0),
      rhs: v.noi_year_1,
    }),
    tolerance: 0.05,
    severity: "warning",
  },
  {
    id: "units_pro_forma_includes_adu",
    description:
      "units_pro_forma ≈ units_at_acquisition + units_adu (renovation typically adds ADUs only)",
    fields: ["units_pro_forma", "units_at_acquisition", "units_adu"],
    check: (v) => ({
      lhs: v.units_pro_forma,
      rhs: (v.units_at_acquisition || 0) + (v.units_adu || 0),
    }),
    tolerance: 0,
    toleranceAbs: 1,
    severity: "warning",
  },
  {
    id: "rent_controlled_tier_sum",
    description: "units_rent_controlled = sum of tier1 + tier2 + tier3",
    fields: [
      "units_rent_controlled",
      "units_rent_controlled_tier1",
      "units_rent_controlled_tier2",
      "units_rent_controlled_tier3",
    ],
    check: (v) => ({
      lhs: v.units_rent_controlled,
      rhs:
        (v.units_rent_controlled_tier1 || 0) +
        (v.units_rent_controlled_tier2 || 0) +
        (v.units_rent_controlled_tier3 || 0),
    }),
    tolerance: 0,
    toleranceAbs: 0,
    severity: "warning",
  },
  {
    id: "senior_ltv_consistency",
    description: "senior_loan_amount / purchase_price ≈ senior_loan_ltv",
    fields: ["senior_loan_amount", "purchase_price", "senior_loan_ltv"],
    check: (v) => {
      if (!v.purchase_price) return { lhs: null, rhs: null };
      return {
        lhs: (v.senior_loan_amount || 0) / v.purchase_price,
        rhs: v.senior_loan_ltv,
      };
    },
    tolerance: 0.02,
    severity: "warning",
  },
  {
    id: "gross_vs_rentable_sf",
    description:
      "gross_sf_pro_forma >= rentable_sf_pro_forma (gross includes common area)",
    fields: ["gross_sf_pro_forma", "rentable_sf_pro_forma"],
    check: (v) => ({
      lhs: v.gross_sf_pro_forma,
      rhs: v.rentable_sf_pro_forma,
      mode: "gte",
    }),
    severity: "warning",
  },
  {
    id: "sale_price_implies_terminal_cap",
    description:
      "terminal_cap_rate × disposition_proceeds_gross ≈ exit-year NOI (heuristic)",
    fields: ["terminal_cap_rate", "disposition_proceeds_gross"],
    check: (v) => {
      if (!v.terminal_cap_rate || !v.disposition_proceeds_gross)
        return { lhs: null, rhs: null };
      const impliedNoi = v.terminal_cap_rate * v.disposition_proceeds_gross;
      return {
        lhs: impliedNoi,
        rhs: 0.5 * v.disposition_proceeds_gross,
        mode: "lte",
      };
    },
    severity: "warning",
  },
];

export const CATEGORIES = [
  "IDENTITY",
  "UNITS",
  "RENT",
  "INCOME",
  "BASIS",
  "YIELDS",
  "RETURNS",
  "DATES",
  "GROWTH",
  "DEBT",
  "DISPOSITION",
  "PARTNERSHIP",
];

export function getFieldMeta(key) {
  return FIELD_CATALOG[key] || null;
}

export function getFieldsByCategory(category) {
  return Object.entries(FIELD_CATALOG)
    .filter(([, meta]) => meta.category === category)
    .map(([key, meta]) => ({ key, ...meta }));
}

export function getAllFieldKeys() {
  return Object.keys(FIELD_CATALOG);
}

export function getCrossChecksForField(fieldKey) {
  return CROSS_CHECKS.filter((c) => c.fields.includes(fieldKey));
}
