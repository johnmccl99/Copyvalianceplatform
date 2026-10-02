import { computeReconciliationStatus } from "./reconciliation.js";

export const PACKET_SCHEMA_VERSION = "packet-v1";

export const COVERAGE_AVAILABLE = "available";
export const COVERAGE_UNAVAILABLE = "unavailable";
export const COVERAGE_NOT_APPLICABLE = "not_applicable";

const CAPITAL_PENDING_SOURCE = "distribution engine";
const CONSTRUCTION_PENDING_SOURCE =
  "no platform source (capex/construction tracker)";
const SNAPSHOT_HISTORY_SOURCE = "rent_roll_versions point-in-time snapshots";
const PRELEASE_SOURCE = "loadPreLeasingTracker (method-gated)";

function field(value, source, coverage) {
  return { value: value === undefined ? null : value, source, coverage };
}

function unavailableField(source) {
  return field(null, source, COVERAGE_UNAVAILABLE);
}

function round(x, dp) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  const f = 10 ** dp;
  return Math.round(Number(x) * f) / f;
}

export function buildUnitMixBlock(unitMix) {
  const warnings = [];
  const entrata = Array.isArray(unitMix?.entrata) ? unitMix.entrata : null;
  const model = Array.isArray(unitMix?.model) ? unitMix.model : null;

  let mix;
  if (entrata && entrata.length > 0) {
    mix = field(
      entrata.map((r) => ({ unit_type: r.unit_type, count: r.count })),
      "entrata_units grouped by unit_type_name (live, D1c primary)",
      COVERAGE_AVAILABLE,
    );
  } else if (model && model.length > 0) {
    mix = field(
      model.map((r) => ({
        unit_type: r.unit_type,
        count: r.count,
        beds_per_unit: r.beds_per_unit ?? null,
      })),
      "property_underwriting_unit_mix (model fallback, D1c)",
      COVERAGE_AVAILABLE,
    );
  } else {
    mix = unavailableField(
      "entrata_units (no active units) / property_underwriting_unit_mix (no rows)",
    );
  }

  if (entrata && entrata.length > 0 && model && model.length > 0) {
    const sum = (rows) => rows.reduce((a, r) => a + (Number(r.count) || 0), 0);
    const entrataTotal = sum(entrata);
    const modelTotal = sum(model);
    if (Math.abs(entrataTotal - modelTotal) > 1) {
      warnings.push(
        `Unit-mix divergence: Entrata-live total ${entrataTotal} units vs underwriting model ${modelTotal} — Entrata is canonical (D1c).`,
      );
    }
  }

  return { block: { mix }, warnings };
}

export function buildCapitalBlock() {
  return {
    total_equity_invested: unavailableField(CAPITAL_PENDING_SOURCE),
    capital_returned_to_date: unavailableField(CAPITAL_PENDING_SOURCE),
    pct_capital_returned: unavailableField(CAPITAL_PENDING_SOURCE),
    distribution_this_quarter: unavailableField(CAPITAL_PENDING_SOURCE),
  };
}

export function buildConstructionBlock(assetStage = "unknown") {
  if (assetStage === "stabilized") {
    return { block: null, warnings: [] };
  }
  const w =
    "Construction Status has no platform source (capex/construction tracker unscoped) — fields render as em-dash, never fabricated.";
  return {
    block: {
      target_completion_date: unavailableField(CONSTRUCTION_PENDING_SOURCE),
      total_capex_budget: unavailableField(CONSTRUCTION_PENDING_SOURCE),
      capex_spent_to_date: unavailableField(CONSTRUCTION_PENDING_SOURCE),
      pct_complete: unavailableField(CONSTRUCTION_PENDING_SOURCE),
    },
    warnings: [w],
  };
}

export function buildLeasingBlock(occupancyRow, occupiedBeds) {
  const warnings = [];
  const occSource = "entrata_portfolio_occupancy (live-current)";

  let current_occupancy;
  if (occupancyRow && Number(occupancyRow.totalUnits) > 0) {
    current_occupancy = field(
      round(occupancyRow.occupiedUnits / occupancyRow.totalUnits, 4),
      occSource,
      COVERAGE_AVAILABLE,
    );
  } else {
    current_occupancy = unavailableField(occSource);
    warnings.push(
      "Live occupancy unavailable for this property (no entrata_portfolio_occupancy row or zero active units).",
    );
  }

  let average_rent_per_bed;
  const beds = occupiedBeds == null ? null : Number(occupiedBeds);
  if (occupancyRow && beds != null && beds > 0) {
    average_rent_per_bed = field(
      round(occupancyRow.inPlaceRent / beds, 2),
      "in_place_rent / occupied beds (get_quarterly_packet)",
      COVERAGE_AVAILABLE,
    );
  } else {
    average_rent_per_bed = unavailableField(
      "in_place_rent / occupied beds — denominator unavailable",
    );
    if (occupancyRow) {
      warnings.push(
        "Average Rent per Bed unavailable: occupied-bed denominator is missing or zero.",
      );
    }
  }

  return {
    block: {
      current_occupancy,
      occupancy_vs_prior_year: unavailableField(SNAPSHOT_HISTORY_SOURCE),
      next_academic_term_prelease: unavailableField(PRELEASE_SOURCE),
      prelease_vs_prior_year: unavailableField(SNAPSHOT_HISTORY_SOURCE),
      average_rent_per_bed,
      avg_rent_vs_prior_quarter: unavailableField(SNAPSHOT_HISTORY_SOURCE),
      yoy_rent_growth: unavailableField(SNAPSHOT_HISTORY_SOURCE),
    },
    warnings,
  };
}

export function buildFinancialT3Block(financialT3) {
  const t3 = financialT3 || {};
  const metric = (m) => {
    const src = m?.source || "get_budget_variance quarter rollup";
    if (!m || m.coverage !== COVERAGE_AVAILABLE) return unavailableField(src);
    return field(
      {
        actual: m.actual ?? null,
        budget: m.budget ?? null,
        variance_pct: m.variance_pct ?? null,
      },
      src,
      COVERAGE_AVAILABLE,
    );
  };
  return {
    gross_potential_rent: metric(t3.gross_potential_rent),
    net_operating_income: metric(t3.net_operating_income),
    opex_ratio: metric(t3.opex_ratio),
    net_operating_cf_post_debt: metric(t3.net_operating_cf_post_debt),
    debt_service: t3.debt_service
      ? field(
          t3.debt_service.value ?? null,
          t3.debt_service.source,
          t3.debt_service.coverage,
        )
      : unavailableField("property_underwriting_debt_schedule"),
  };
}

export function collectBlockCoverages(blocks) {
  const out = [];
  for (const block of Object.values(blocks || {})) {
    if (!block || typeof block !== "object") continue;
    for (const f of Object.values(block)) {
      if (f && typeof f === "object" && typeof f.coverage === "string") {
        out.push(f.coverage);
      }
    }
  }
  return out;
}

export function packetFilename(packet) {
  const code = String(packet?.property_code || "property").replace(
    /[^\w-]+/g,
    "_",
  );
  const label = String(packet?.period?.label || "quarter").replace(
    /[^\w-]+/g,
    "_",
  );
  return `quarterly_packet_${code}_${label}.json`;
}

export function buildQuarterlyPacket({
  serverSlice,
  occupancyRow = null,
  rentRollAsof = null,
  assetStage = "unknown",
} = {}) {
  if (!serverSlice || typeof serverSlice !== "object") {
    throw new Error(
      "buildQuarterlyPacket: serverSlice (get_quarterly_packet result) is required",
    );
  }

  const warnings = [...(serverSlice.warnings || [])];

  const unitMix = buildUnitMixBlock(serverSlice.unit_mix);
  warnings.push(...unitMix.warnings);

  const construction = buildConstructionBlock(assetStage);
  warnings.push(...construction.warnings);

  const leasing = buildLeasingBlock(
    occupancyRow,
    serverSlice.leasing_support?.occupied_beds ?? null,
  );
  warnings.push(...leasing.warnings);

  const blocks = {
    important_dates: serverSlice.important_dates || {},
    property_details: serverSlice.property_details || {},
    unit_mix: unitMix.block,
    capital: buildCapitalBlock(),
    ...(construction.block ? { construction_status: construction.block } : {}),
    leasing: leasing.block,
    financial_performance_t3: buildFinancialT3Block(serverSlice.financial_t3),
  };

  const sealedAt = serverSlice.snapshot?.sealed_at || null;
  const status = computeReconciliationStatus({
    monthStates: serverSlice.months || [],
    sealedAt,
    quarterStart: serverSlice.period?.quarter_start || null,
    blockCoverages: collectBlockCoverages(blocks),
  });

  return {
    schema_version: PACKET_SCHEMA_VERSION,
    org_id: serverSlice.org_id ?? null,
    property_id: serverSlice.bridge?.entrata_property_id ?? null,
    property_code: serverSlice.property_code ?? null,
    property_name: serverSlice.bridge?.property_name ?? null,
    period: serverSlice.period || null,
    generated_at: serverSlice.generated_at || null,
    reconciliation: {
      status,
      warnings,
      sources_asof: {
        gl: serverSlice.sources_asof?.gl ?? null,
        budget_snapshot: sealedAt,
        rent_roll: rentRollAsof,
      },
    },
    blocks,
  };
}
