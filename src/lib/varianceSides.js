export const SEALED_BUDGET = "sealed_budget";
export const LIVE_ACTUALS = "live_actuals";
export const UNDERWRITING_MODEL = "underwriting_model";

export const ACTUALS_SIDE = Object.freeze({
  kind: LIVE_ACTUALS,
  label: "Live GL actuals",
  shortLabel: "Live GL actual",
});

export const UNDERWRITING_SIDE = Object.freeze({
  kind: UNDERWRITING_MODEL,
  label: "Underwriting model",
  shortLabel: "Underwritten",
});

function integerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function sealedBudgetSide(baselineRow) {
  if (!baselineRow) return null;
  const budgetStatusTypeId = integerOrNull(
    baselineRow.budgetStatusTypeId ?? baselineRow.budget_status_type_id,
  );
  const fiscalYear = integerOrNull(
    baselineRow.fiscalYear ?? baselineRow.fiscal_year,
  );
  const typeLabel =
    baselineRow.budgetTypeLabel ||
    baselineRow.budget_type_label ||
    "Sealed budget snapshot";
  if (budgetStatusTypeId === null || fiscalYear === null || !typeLabel)
    return null;
  const shortLabel = `${typeLabel} FY${fiscalYear}`;
  return {
    kind: SEALED_BUDGET,
    budgetStatusTypeId,
    fiscalYear,
    label: shortLabel,
    shortLabel,
    monthEndMin: baselineRow.monthEndMin ?? baselineRow.month_end_min ?? null,
    monthEndMax: baselineRow.monthEndMax ?? baselineRow.month_end_max ?? null,
  };
}

export function pairingKind(baselineSide, compareSide) {
  if (
    baselineSide?.kind === UNDERWRITING_MODEL ||
    compareSide?.kind === UNDERWRITING_MODEL
  ) {
    return baselineSide?.kind === LIVE_ACTUALS ||
      compareSide?.kind === LIVE_ACTUALS
      ? "actuals_vs_underwriting"
      : "budget_vs_underwriting";
  }
  return baselineSide?.kind === LIVE_ACTUALS ||
    compareSide?.kind === LIVE_ACTUALS
    ? "actuals_vs_budget"
    : "budget_vs_budget";
}

export function involvesUnderwriting(pairing) {
  return typeof pairing === "string"
    ? pairing === "actuals_vs_underwriting" ||
        pairing === "budget_vs_underwriting"
    : involvesUnderwriting(pairingKind(pairing?.baseline, pairing?.compare));
}

export function uwPairingOtherSide(baselineSide, compareSide) {
  if (!involvesUnderwriting(pairingKind(baselineSide, compareSide)))
    return null;
  const other =
    baselineSide?.kind === UNDERWRITING_MODEL ? compareSide : baselineSide;
  if (!other) return null;
  if (other.kind === LIVE_ACTUALS) {
    return {
      kind: "actuals",
      budgetStatusTypeId: null,
      fiscalYear: null,
      side: other,
    };
  }
  if (other.kind !== SEALED_BUDGET) return null;
  const type = Number(other.budgetStatusTypeId);
  const year = Number(other.fiscalYear);
  if (!Number.isInteger(type) || !Number.isInteger(year)) return null;
  return {
    kind: "budget",
    budgetStatusTypeId: type,
    fiscalYear: year,
    side: other,
  };
}

export function involvesLiveActuals(pairing) {
  return pairing === "actuals_vs_budget";
}

export function favourabilityApplies(pairing) {
  const kind =
    typeof pairing === "string"
      ? pairing
      : pairingKind(pairing?.baseline, pairing?.compare);
  return kind === "actuals_vs_budget" || kind === "actuals_vs_underwriting";
}

export function realizedFlagApplies(pairing) {
  return involvesLiveActuals(pairing);
}

export function isSameSide(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === LIVE_ACTUALS || a.kind === UNDERWRITING_MODEL) return true;
  return (
    a.budgetStatusTypeId === b.budgetStatusTypeId &&
    a.fiscalYear === b.fiscalYear
  );
}

export function adaptPairingRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    budget_amount: row.baseline_amount,
    actual_amount: row.compare_amount,
  }));
}

export function sideColumnToken(side) {
  if (!side) return "Side";
  if (side.kind === LIVE_ACTUALS) return "Act";
  if (side.kind === UNDERWRITING_MODEL) return "UW";
  const withoutYear = String(side.label || "")
    .replace(/\s+FY\d{4}\s*$/, "")
    .trim();
  const initials = withoutYear
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join("");
  const year = Number(side.fiscalYear);
  return Number.isInteger(year)
    ? `${initials || "Plan"} FY${String(year).slice(-2)}`
    : initials || "Plan";
}
