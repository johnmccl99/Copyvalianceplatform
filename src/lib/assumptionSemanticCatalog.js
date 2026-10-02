export const SEMANTIC_CATALOG = [
  {
    category: null,
    account_number: null,
    field: "amount",
    semantic: "period_amount",
    route_rule: null,
    assumption_class: "AC-1",
    derivability: "T-A",
    description:
      "Budgeted dollar amount per period landing (frequency-strided).",
  },
  {
    category: null,
    account_number: null,
    field: "frequency",
    semantic: "stride",
    route_rule: null,
    assumption_class: "AC-2",
    derivability: "T-C",
    description:
      "Landing stride: Monthly/BiMonthly/Quarterly/Quadrimester/SemiAnnually/Annually.",
  },
  {
    category: null,
    account_number: null,
    field: "first_month",
    semantic: "window_start",
    route_rule: null,
    assumption_class: "AC-2",
    derivability: "T-C",
    description:
      "Effective-window start (calendar-anchor judgment: academic year, tax dates, turn cycle).",
  },
  {
    category: null,
    account_number: null,
    field: "last_month",
    semantic: "window_end",
    route_rule: null,
    assumption_class: "AC-2",
    derivability: "T-C",
    description: "Effective-window end; null = open-ended.",
  },
  {
    category: null,
    account_number: null,
    field: "growth",
    semantic: "growth_rate",
    route_rule: null,
    assumption_class: "AC-3",
    derivability: "T-C",
    description:
      "Annual escalator fraction (0.01/0.02/0.03...). Stated policy input - verified, never derived (D6a).",
  },
  {
    category: null,
    account_number: null,
    field: "adjustments",
    semantic: "numeric_factor",
    route_rule: null,
    assumption_class: "AC-10",
    derivability: "T-C",
    description:
      "Polysemous numeric factor - resolve per (category, account): rate, proration fraction, participation factor, or dollar amount.",
  },
  {
    category: null,
    account_number: null,
    field: "active_beds_pct",
    semantic: "occupancy_input",
    route_rule: null,
    assumption_class: "AC-4",
    derivability: "T-A",
    description:
      "Triple-valued occupancy input: 0/1 flag, fractional occupancy ratio, or integer per-property bed count - resolve by value shape (resolveActiveBedsSemantic).",
  },

  {
    category: "ManagementFee",
    account_number: null,
    field: "growth",
    semantic: "dollar_amount",
    route_rule: null,
    assumption_class: "AC-6",
    derivability: "T-C",
    description:
      "On ManagementFee the growth column holds a dollar amount (e.g. 325.49), NOT an escalator.",
  },
  {
    category: "Turnover",
    account_number: null,
    field: "adjustments",
    semantic: "participation_factor",
    route_rule: null,
    assumption_class: "AC-10",
    derivability: "T-C",
    description:
      "Flat participation factor (0.7 on 240 prod rows) applied to turn counts.",
  },
  {
    category: "MortgageReserves",
    account_number: null,
    field: "amount",
    semantic: "period_amount",
    route_rule: "R5",
    assumption_class: "AC-9",
    derivability: "T-C",
    description:
      "Debt service / reserve draws are contractual (UWPF schedule, loan docs) - verify-only, never derived.",
  },
  {
    category: "LongTermDebt",
    account_number: null,
    field: "amount",
    semantic: "period_amount",
    route_rule: "R5",
    assumption_class: "AC-9",
    derivability: "T-C",
    description: "Contractual amortization - verify-only, never derived.",
  },

  {
    category: "Turnover",
    account_number: "50201",
    field: "growth",
    semantic: "turn_count",
    route_rule: null,
    assumption_class: "AC-4",
    derivability: "T-C",
    description: "Bed/unit turn count, not an escalator.",
  },
  {
    category: "Turnover",
    account_number: "50202",
    field: "growth",
    semantic: "turn_count",
    route_rule: null,
    assumption_class: "AC-4",
    derivability: "T-C",
    description: "Bed/unit turn count, not an escalator.",
  },
  {
    category: "Turnover",
    account_number: "50203",
    field: "growth",
    semantic: "turn_count",
    route_rule: null,
    assumption_class: "AC-4",
    derivability: "T-C",
    description: "Bed/unit turn count, not an escalator.",
  },
  {
    category: "Turnover",
    account_number: "50204",
    field: "growth",
    semantic: "turn_count",
    route_rule: null,
    assumption_class: "AC-4",
    derivability: "T-C",
    description: "Bed/unit turn count, not an escalator.",
  },
  {
    category: "RentalIncome",
    account_number: "40001",
    field: "amount",
    semantic: "period_amount",
    route_rule: "R3",
    assumption_class: "AC-5",
    derivability: "T-A",
    description:
      "Gross Potential Rent - LM x 12 x (1+g); trailing averages lag the current rent roll.",
  },
  {
    category: "RentalIncome",
    account_number: "40009",
    field: "adjustments",
    semantic: "delinquency_rate",
    route_rule: null,
    assumption_class: "AC-10",
    derivability: "T-C",
    description: "Delinquency factor (fraction of revenue).",
  },
  {
    category: "ManagementFee",
    account_number: "50301",
    field: "amount",
    semantic: "period_amount",
    route_rule: "R5",
    assumption_class: "AC-6",
    derivability: "T-C",
    description:
      "PM fee: MIN(rate x window-TOI + adder, -MinFee) - contractual, verify-only.",
  },
  {
    category: "ManagementFee",
    account_number: "50301",
    field: "adjustments",
    semantic: "fee_rate",
    route_rule: null,
    assumption_class: "AC-6",
    derivability: "T-C",
    description: "Contractual management-fee rate (0.03-0.08).",
  },
  {
    category: "AssetServicing",
    account_number: "80001",
    field: "amount",
    semantic: "period_amount",
    route_rule: "R5",
    assumption_class: "AC-6",
    derivability: "T-C",
    description: "AM fee: greater-of contractual - verify-only.",
  },
  {
    category: "AssetServicing",
    account_number: "80001",
    field: "adjustments",
    semantic: "fee_rate",
    route_rule: null,
    assumption_class: "AC-6",
    derivability: "T-C",
    description: "Contractual asset-management-fee rate.",
  },
  {
    category: "InsuranceTax",
    account_number: "50902",
    field: "amount",
    semantic: "period_amount",
    route_rule: "R4-i",
    assumption_class: "AC-1",
    derivability: "T-A",
    description:
      "Property taxes: statutory accrual - latest assessed level x 12 (recency beats trailing means over true-ups).",
  },
  {
    category: "MortgageReserves",
    account_number: "60001",
    field: "amount",
    semantic: "period_amount",
    route_rule: "R5",
    assumption_class: "AC-9",
    derivability: "T-C",
    description:
      "Mortgage interest per the UWPF two-way lookup - contractual, verify-only.",
  },
  {
    category: "OtherIncome",
    account_number: "40111",
    field: "adjustments",
    semantic: "dollar_amount",
    route_rule: null,
    assumption_class: "AC-10",
    derivability: "T-C",
    description: "Holds a dollar amount (4x the annual), not a rate.",
  },
];

export function resolveSemantics(
  { category, account_number: accountNumber, field },
  catalog = SEMANTIC_CATALOG,
) {
  const f = String(field || "").trim();
  const cat =
    category === null || category === undefined
      ? null
      : String(category).trim();
  const acct =
    accountNumber === null || accountNumber === undefined
      ? null
      : String(accountNumber).trim();
  let best = null;
  let bestScore = -1;
  for (const row of catalog || []) {
    if (row.field !== f) continue;
    if (row.category !== null && row.category !== cat) continue;
    if (row.account_number !== null && row.account_number !== acct) continue;
    const score =
      (row.category !== null ? 1 : 0) + (row.account_number !== null ? 2 : 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

export function resolveActiveBedsSemantic(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0 || n === 1) return "flag";
  if (n > 0 && n < 1) return "occupancy_ratio";
  if (n > 1 && Number.isInteger(n)) return "bed_count";
  return "unclassified";
}
