export const BUDGET_MISSING_GLYPH = "—";
export const BUDGET_ABSENT_CELL = "";

export const BUDGET_CELL_DASH_THRESHOLD = 0.005;

export function budgetCellIsDash(value) {
  if (value == null || value === "") return true;
  const number = Number(value);
  if (!Number.isFinite(number)) return true;
  return Math.abs(number) < BUDGET_CELL_DASH_THRESHOLD;
}

export function formatSparseBudgetCell(value) {
  const number = Number(value == null ? 0 : value);
  if (!Number.isFinite(number)) return BUDGET_MISSING_GLYPH;
  if (Math.abs(number) < BUDGET_CELL_DASH_THRESHOLD)
    return BUDGET_MISSING_GLYPH;
  if (Math.abs(number) < 0.5) {
    return number.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
  }
  return Math.round(number).toLocaleString();
}

export function formatBudgetCell(value, { present = true } = {}) {
  if (present === false) return BUDGET_ABSENT_CELL;
  return formatSparseBudgetCell(value);
}

export function formatBudgetTotal(value) {
  const number = Number(value == null ? 0 : value);
  if (!Number.isFinite(number)) return BUDGET_MISSING_GLYPH;
  return Math.round(number).toLocaleString();
}
