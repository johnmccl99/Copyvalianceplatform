function num(x) {
  if (x == null || x === "" || typeof x === "string") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function require_(map, ...keys) {
  for (const k of keys) {
    if (num(map?.[k]) == null) return null;
  }
  return true;
}

export const COMPUTE_FUNCTIONS = {
  all_in_basis: {
    requiresFields: [
      "purchase_price",
      "closing_costs_total",
      "capex_budget_total",
    ],
    description:
      "all_in_basis = purchase_price + closing_costs_total + capex_budget_total",
    compute(m) {
      if (
        !require_(
          m,
          "purchase_price",
          "closing_costs_total",
          "capex_budget_total",
        )
      )
        return null;
      return (
        num(m.purchase_price) +
        num(m.closing_costs_total) +
        num(m.capex_budget_total)
      );
    },
  },

  equity_required: {
    requiresFields: ["all_in_basis"],
    description:
      "equity_required = all_in_basis − loan_proceeds (or senior_loan_amount)",
    compute(m) {
      const basis = num(m.all_in_basis);
      if (basis == null) return null;
      const loan = num(m.loan_proceeds) ?? num(m.senior_loan_amount);
      if (loan == null) return null;
      return basis - loan;
    },
  },

  equity_required_total: {
    requiresFields: ["all_in_basis"],
    description:
      "equity_required_total = all_in_basis − loan_proceeds (alias of equity_required)",
    compute(m) {
      return COMPUTE_FUNCTIONS.equity_required.compute(m);
    },
  },

  price_per_unit: {
    requiresFields: ["purchase_price", "units_at_acquisition"],
    description: "price_per_unit = purchase_price / units_at_acquisition",
    compute(m) {
      const p = num(m.purchase_price),
        u = num(m.units_at_acquisition);
      if (p == null || u == null || u === 0) return null;
      return p / u;
    },
  },

  price_per_rsf: {
    requiresFields: ["purchase_price", "rentable_sf_pro_forma"],
    description: "price_per_rsf = purchase_price / rentable_sf_pro_forma",
    compute(m) {
      const p = num(m.purchase_price),
        s = num(m.rentable_sf_pro_forma);
      if (p == null || s == null || s === 0) return null;
      return p / s;
    },
  },

  price_per_gsf: {
    requiresFields: ["purchase_price", "gross_sf_pro_forma"],
    description: "price_per_gsf = purchase_price / gross_sf_pro_forma",
    compute(m) {
      const p = num(m.purchase_price),
        s = num(m.gross_sf_pro_forma);
      if (p == null || s == null || s === 0) return null;
      return p / s;
    },
  },

  units_pro_forma: {
    requiresFields: ["units_at_acquisition", "units_adu"],
    description:
      "units_pro_forma ≈ units_at_acquisition + units_adu (typical value-add path)",
    compute(m) {
      const a = num(m.units_at_acquisition),
        u = num(m.units_adu);
      if (a == null) return null;
      return a + (u ?? 0);
    },
  },

  units_rent_controlled: {
    requiresFields: [],
    description: "units_rent_controlled = sum(tier1 + tier2 + tier3)",
    compute(m) {
      const t1 = num(m.units_rent_controlled_tier1);
      const t2 = num(m.units_rent_controlled_tier2);
      const t3 = num(m.units_rent_controlled_tier3);
      if (t1 == null && t2 == null && t3 == null) return null;
      return (t1 ?? 0) + (t2 ?? 0) + (t3 ?? 0);
    },
  },

  going_in_cap_rate_y1: {
    requiresFields: ["noi_year_1", "purchase_price"],
    description: "going_in_cap_rate_y1 = noi_year_1 / purchase_price",
    compute(m) {
      const n = num(m.noi_year_1),
        p = num(m.purchase_price);
      if (n == null || p == null || p === 0) return null;
      return n / p;
    },
  },

  stabilized_yield_on_cost: {
    requiresFields: ["noi_year_1", "all_in_basis"],
    description: "stabilized_yield_on_cost = noi_year_1 / all_in_basis",
    compute(m) {
      const n = num(m.noi_year_1),
        b = num(m.all_in_basis);
      if (n == null || b == null || b === 0) return null;
      return n / b;
    },
  },

  senior_loan_ltv: {
    requiresFields: ["senior_loan_amount", "purchase_price"],
    description: "senior_loan_ltv = senior_loan_amount / purchase_price",
    compute(m) {
      const l = num(m.senior_loan_amount),
        p = num(m.purchase_price);
      if (l == null || p == null || p === 0) return null;
      return l / p;
    },
  },

  senior_loan_ltc: {
    requiresFields: ["senior_loan_amount", "all_in_basis"],
    description:
      "senior_loan_ltc = senior_loan_committed (or senior_loan_amount) / all_in_basis  [committed LTC]",
    compute(m) {
      const l =
        num(m.senior_loan_committed_amount) ?? num(m.senior_loan_amount);
      const b = num(m.all_in_basis);
      if (l == null || b == null || b === 0) return null;
      return l / b;
    },
  },

  senior_loan_ltc_at_close: {
    canonicalKey: "senior_loan_ltc",
    requiresFields: ["senior_loan_initial_draw", "all_in_basis"],
    description:
      "fallback: senior_loan_ltc value matches LTC-at-close = senior_loan_initial_draw / all_in_basis",
    compute(m) {
      const l = num(m.senior_loan_initial_draw);
      const b = num(m.all_in_basis);
      if (l == null || b == null || b === 0) return null;
      return l / b;
    },
  },

  senior_loan_ltv_as_ltc: {
    canonicalKey: "senior_loan_ltv",
    requiresFields: ["senior_loan_amount", "all_in_basis"],
    description:
      'fallback: model labels "LTV" but value matches LTC = senior_loan_amount / all_in_basis',
    compute(m) {
      const l =
        num(m.senior_loan_committed_amount) ?? num(m.senior_loan_amount);
      const b = num(m.all_in_basis);
      if (l == null || b == null || b === 0) return null;
      return l / b;
    },
  },

  senior_loan_ltv_at_close: {
    canonicalKey: "senior_loan_ltv",
    requiresFields: ["senior_loan_initial_draw", "purchase_price"],
    description:
      "fallback: senior_loan_ltv value matches at-close LTV = senior_loan_initial_draw / purchase_price",
    compute(m) {
      const l = num(m.senior_loan_initial_draw);
      const p = num(m.purchase_price);
      if (l == null || p == null || p === 0) return null;
      return l / p;
    },
  },

  vacancy_pct: {
    requiresFields: ["occupancy_stabilized"],
    description: "vacancy_pct = 1 − occupancy_stabilized",
    compute(m) {
      const o = num(m.occupancy_stabilized);
      if (o == null) return null;
      return 1 - o;
    },
  },

  loss_to_lease_pct: {
    requiresFields: [
      "avg_rent_per_unit_market",
      "avg_rent_per_unit_acquisition",
    ],
    description:
      "loss_to_lease_pct = (avg_rent_market − avg_rent_acquisition) / avg_rent_market",
    compute(m) {
      const mkt = num(m.avg_rent_per_unit_market),
        acq = num(m.avg_rent_per_unit_acquisition);
      if (mkt == null || acq == null || mkt === 0) return null;
      return (mkt - acq) / mkt;
    },
  },

  other_income_year_1: {
    requiresFields: [],
    requiresTabular: ["monthly_noi"],
    description:
      "other_income_year_1 = Σ(monthly_noi income rows except rent/GPR lines) for periods 1-12  [aggregated when no single labeled total]",
    compute(_m, tabular) {
      return (
        COMPUTE_FUNCTIONS.other_income_year_1_from_noi?.compute(_m, tabular) ??
        null
      );
    },
  },

  other_income_year_1_from_noi: {
    canonicalKey: "other_income_year_1",
    requiresFields: [],
    requiresTabular: ["monthly_noi"],
    description:
      "other_income_year_1 = Σ(monthly_noi income rows except rent/GPR lines) for periods 1-12",
    compute(_m, tabular) {
      const rows = tabular?.monthly_noi;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const RENT_LINE_RE =
        /\b(rent|gpr|gross\s*potential|in[-\s]*place\s*rent|stabilized\s*rent|pro[-\s]?forma\s*rent|market\s*rent|effective\s*rent|tenant\s*rent)\b/i;
      let total = 0;
      let saw = 0;
      for (const r of rows) {
        const idx = num(r.period_index);
        if (idx == null || idx < 1 || idx > 12) continue;
        const cat = String(r.category || "").toLowerCase();
        if (cat !== "income" && !cat.startsWith("income") && cat !== "revenue")
          continue;
        const lineItem = String(r.line_item || "");
        if (RENT_LINE_RE.test(lineItem)) continue;
        const amt = num(r.amount);
        if (amt == null) continue;
        total += amt;
        saw += 1;
      }
      return saw > 0 ? total : null;
    },
  },

  gpr_annual: {
    requiresFields: [],
    requiresTabular: ["unit_mix"],
    description:
      "gpr_annual = Σ(unit_mix.unit_count × rent_pro_forma) × 12 + other_income_year_1  [stabilized rent roll + ancillary]",
    compute(m, tabular) {
      const rows = tabular?.unit_mix;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const hasStabilized = rows.some((r) => r.section === "stabilized");
      const useRows = hasStabilized
        ? rows.filter((r) => r.section === "stabilized")
        : rows.filter((r) => r.section === "existing" || !r.section);
      let total = 0;
      let saw = 0;
      for (const r of useRows) {
        const count = num(r.unit_count) ?? 1;
        const rent = num(r.rent_pro_forma) ?? num(r.rent_current);
        if (rent == null) continue;
        total += count * rent * 12;
        saw += 1;
      }
      if (saw === 0) return null;
      let otherInc = num(m?.other_income_year_1);
      if (otherInc == null || otherInc === 0) {
        const fn = COMPUTE_FUNCTIONS.other_income_year_1_from_noi;
        if (fn) {
          const aggregated = fn.compute(m, tabular);
          if (aggregated != null && aggregated > 0) otherInc = aggregated;
        }
      }
      if (otherInc != null && otherInc > 0) total += otherInc;
      return total;
    },
  },

  capex_budget_total_from_schedule: {
    canonicalKey: "capex_budget_total",
    requiresFields: [],
    requiresTabular: ["capex_schedule"],
    description: "capex_budget_total = Σ(capex_schedule.amount)",
    compute(_m, tabular) {
      const rows = tabular?.capex_schedule;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      let total = 0;
      for (const r of rows) {
        const a = num(r.amount);
        if (a != null) total += a;
      }
      return total > 0 ? total : null;
    },
  },

  debt_service_annual: {
    requiresFields: [],
    requiresTabular: ["debt_schedule"],
    description:
      "debt_service_annual = Σ(principal_payment + interest_payment) for first 12 months",
    compute(_m, tabular) {
      const rows = tabular?.debt_schedule;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const sorted = rows
        .slice()
        .sort((a, b) => (num(a.month_index) ?? 0) - (num(b.month_index) ?? 0));
      const yr1 = sorted.slice(0, 12);
      if (yr1.length < 12) return null;
      let total = 0;
      for (const r of yr1) {
        const p = num(r.principal_payment) ?? 0;
        const i = num(r.interest_payment) ?? 0;
        total += p + i;
      }
      return total;
    },
  },

  noi_year_1: {
    requiresFields: [],
    requiresTabular: ["monthly_noi"],
    description:
      "noi_year_1 = Σ(monthly_noi.amount) for first 12 months [income − expense]",
    compute(_m, tabular) {
      const rows = tabular?.monthly_noi;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      let income = 0,
        expense = 0;
      let any = false;
      for (const r of rows) {
        const idx = num(r.period_index);
        if (idx == null || idx < 1 || idx > 12) continue;
        const amt = num(r.amount);
        if (amt == null) continue;
        const cat = String(r.category || "").toLowerCase();
        if (
          cat === "income" ||
          cat.startsWith("income") ||
          cat === "revenue" ||
          cat === "gpr"
        ) {
          income += amt;
          any = true;
        } else if (
          cat === "expense" ||
          cat === "opex" ||
          cat === "operating_expense"
        ) {
          expense += amt;
          any = true;
        }
      }
      return any ? income - expense : null;
    },
  },
};

export function computeAllDerived(canonicalMap, tabular) {
  const out = {};
  for (const [key, fn] of Object.entries(COMPUTE_FUNCTIONS)) {
    const targetKey = fn.canonicalKey || key;
    const tag = fn.canonicalKey ? `${targetKey}::${key}` : targetKey;
    let result;
    try {
      result = fn.compute(canonicalMap || {}, tabular);
    } catch (e) {
      result = null;
    }
    out[tag] =
      typeof result === "number" && Number.isFinite(result) ? result : null;
  }
  return out;
}

const SOURCES_FIELDS = [
  {
    field: "senior_loan_initial_draw",
    label: "Senior loan — initial draw at close",
  },
  {
    field: "senior_loan_committed_amount",
    label: "Senior loan — committed (total)",
  },
  { field: "senior_loan_amount", label: "Senior loan" },
  { field: "loan_proceeds", label: "Loan proceeds" },
  { field: "bridge_loan_amount", label: "Bridge loan" },
  { field: "bridge_loan_proceeds_at_close", label: "Bridge proceeds at close" },
  { field: "equity_required", label: "Total equity required" },
  { field: "equity_required_total", label: "Equity required (total)" },
  { field: "follow_on_needed", label: "Follow-on equity" },
  {
    field: "interest_reserve_capitalized",
    label: "Capitalized interest reserve",
  },
];

const USES_FIELDS = [
  { field: "purchase_price", label: "Purchase price" },
  { field: "closing_costs_total", label: "Closing costs" },
  { field: "capex_budget_total", label: "CapEx budget total" },
  { field: "oid_or_loan_fees", label: "OID / loan fees" },
];

const CAPEX_SUBBUCKET_FIELDS = [
  { field: "capex_interior_renovation", label: "CapEx · interior renovation" },
  { field: "capex_common_area", label: "CapEx · common area" },
  { field: "capex_mechanical_electrical_plumbing", label: "CapEx · MEP" },
  { field: "capex_soft_costs", label: "CapEx · soft costs" },
  { field: "capex_contingency", label: "CapEx · contingency" },
];

export function sourcesUsesLedger(canonicalMap) {
  if (!canonicalMap) canonicalMap = {};
  const warnings = [];

  const loanCommitted = num(canonicalMap.senior_loan_committed_amount);
  const loanAmount = num(canonicalMap.senior_loan_amount);
  const loanInitial = num(canonicalMap.senior_loan_initial_draw);
  const loanProceeds = num(canonicalMap.loan_proceeds);
  let canonicalLoanField = null;
  if (loanCommitted != null && loanCommitted > 0)
    canonicalLoanField = "senior_loan_committed_amount";
  else if (loanAmount != null && loanAmount > 0)
    canonicalLoanField = "senior_loan_amount";
  else if (loanProceeds != null && loanProceeds > 0)
    canonicalLoanField = "loan_proceeds";
  else if (loanInitial != null && loanInitial > 0)
    canonicalLoanField = "senior_loan_initial_draw";

  const sources = [];
  for (const spec of SOURCES_FIELDS) {
    const v = num(canonicalMap[spec.field]);
    if (v == null) {
      sources.push({ ...spec, value: null });
      continue;
    }
    if (
      [
        "senior_loan_initial_draw",
        "senior_loan_committed_amount",
        "senior_loan_amount",
        "loan_proceeds",
      ].includes(spec.field)
    ) {
      if (spec.field === canonicalLoanField) {
        sources.push({ ...spec, value: v, counted: true });
      } else {
        sources.push({
          ...spec,
          value: v,
          counted: false,
          note: `not counted — using ${canonicalLoanField} as the canonical loan figure`,
        });
      }
      continue;
    }
    sources.push({ ...spec, value: v, counted: true });
  }
  if (
    loanCommitted != null &&
    loanInitial != null &&
    loanCommitted > 0 &&
    loanInitial > 0
  ) {
    const futureDraws = loanCommitted - loanInitial;
    if (futureDraws > loanInitial * 0.1) {
      warnings.push(
        `Senior loan: $${loanInitial.toLocaleString()} drawn at close, $${loanCommitted.toLocaleString()} committed — $${futureDraws.toLocaleString()} of future draws not in initial Sources`,
      );
    }
  }
  if (
    loanAmount != null &&
    loanProceeds != null &&
    loanAmount > 0 &&
    loanProceeds > 0
  ) {
    const drift =
      Math.abs(loanAmount - loanProceeds) / Math.max(loanAmount, loanProceeds);
    if (drift > 0.001) {
      warnings.push(
        `senior_loan_amount ($${loanAmount.toLocaleString()}) and loan_proceeds ($${loanProceeds.toLocaleString()}) differ — using ${canonicalLoanField} as the canonical loan figure but verify they're not duplicate extractions of the same cell`,
      );
    }
  }
  let countedEquity = false;
  for (const row of sources) {
    if (
      row.field === "equity_required" ||
      row.field === "equity_required_total"
    ) {
      if (row.value == null) continue;
      const a = num(canonicalMap.equity_required);
      const b = num(canonicalMap.equity_required_total);
      if (a != null && b != null) {
        if (Math.abs(a - b) <= Math.max(1, 0.001 * Math.max(a, b))) {
          if (!countedEquity && row.field === "equity_required") {
            countedEquity = true;
          } else if (!countedEquity && row.field === "equity_required_total") {
            countedEquity = true;
          } else {
            row.counted = false;
            row.note = "duplicate of equity_required — already counted";
          }
        } else {
          warnings.push(
            `equity_required (${a}) and equity_required_total (${b}) differ — counting both, may be duplicate`,
          );
        }
      }
    }
  }

  const uses = USES_FIELDS.map((spec) => ({
    ...spec,
    value: num(canonicalMap[spec.field]),
    counted: true,
  }));
  const capexSubBuckets = CAPEX_SUBBUCKET_FIELDS.map((spec) => ({
    ...spec,
    value: num(canonicalMap[spec.field]),
  }));

  const totalSources = sources
    .filter((r) => r.counted && r.value != null)
    .reduce((a, r) => a + r.value, 0);
  const totalUses = uses
    .filter((r) => r.counted && r.value != null)
    .reduce((a, r) => a + r.value, 0);
  const gap = totalSources - totalUses;
  const denom = Math.max(Math.abs(totalSources), Math.abs(totalUses));
  const gapPct = denom > 0 ? gap / denom : null;

  const subSum = capexSubBuckets
    .filter((r) => r.value != null)
    .reduce((a, r) => a + r.value, 0);
  const capexTotal = num(canonicalMap.capex_budget_total);
  if (capexTotal != null && subSum > 0) {
    const drift = Math.abs(subSum - capexTotal) / capexTotal;
    if (drift > 0.02) {
      warnings.push(
        `CapEx sub-buckets sum to ${subSum.toLocaleString()} but capex_budget_total = ${capexTotal.toLocaleString()} (${(drift * 100).toFixed(1)}% drift)`,
      );
    }
  }

  return {
    sources,
    uses,
    capexSubBuckets,
    totalSources,
    totalUses,
    gap,
    gapPct,
    warnings,
  };
}

export function getComputableFieldKeys() {
  return Object.entries(COMPUTE_FUNCTIONS).map(
    ([k, fn]) => fn.canonicalKey || k,
  );
}

export function getComputeFunction(fieldKey) {
  if (COMPUTE_FUNCTIONS[fieldKey])
    return { key: fieldKey, fn: COMPUTE_FUNCTIONS[fieldKey] };
  for (const [k, fn] of Object.entries(COMPUTE_FUNCTIONS)) {
    if (fn.canonicalKey === fieldKey) return { key: k, fn };
  }
  return null;
}
