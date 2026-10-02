export const MONEY_MODE_ENTRATA = "entrata";
export const MONEY_MODE_OVERRIDE = "override";
export const MONEY_MODE_FORMULA = "formula";

export const MONEY_FORMULA_VALUE = "utility_formula";

export function isUtilityFormulaValue(value) {
  return typeof value === "string" && value.trim() === MONEY_FORMULA_VALUE;
}

export const MONEY_MODES = [
  {
    value: MONEY_MODE_ENTRATA,
    label: "Keep Entrata's figure",
    help: "This adjustment says nothing about this field. The roll reads Entrata.",
  },
  {
    value: MONEY_MODE_OVERRIDE,
    label: "Override to…",
    help: "Entrata's figure is wrong. The roll reads the amount you type — 0 for a figure that is genuinely nil.",
  },
  {
    value: MONEY_MODE_FORMULA,
    label: "Use utility formula",
    help:
      "The greater of the fee Entrata bills and the property's market utility " +
      "rate, taken back out of rent so the row total does not move. Utility " +
      "flat fee only.",
  },
];

export function moneyModeOf(value) {
  if (value == null || value === "") return MONEY_MODE_ENTRATA;
  if (isUtilityFormulaValue(value)) return MONEY_MODE_FORMULA;
  const n = Number(value);
  if (!Number.isFinite(n)) return MONEY_MODE_ENTRATA;
  return MONEY_MODE_OVERRIDE;
}

export function moneyValueForMode(mode, amount) {
  if (mode === MONEY_MODE_FORMULA) return MONEY_FORMULA_VALUE;
  if (mode !== MONEY_MODE_OVERRIDE) return "";
  return amount == null ? "" : amount;
}

export function moneyOverrideNeedsAmount(mode, amount) {
  if (mode !== MONEY_MODE_OVERRIDE) return false;
  if (amount == null || String(amount).trim() === "") return true;
  return !Number.isFinite(Number(amount));
}

export function formatMoneyForCaption(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function moneyModeLabel(mode, { entrataValue, formulaValue } = {}) {
  const meta = MONEY_MODES.find((m) => m.value === mode);
  const base = meta ? meta.label : String(mode);
  if (mode === MONEY_MODE_ENTRATA && entrataValue !== undefined) {
    return `${base} — ${formatMoneyForCaption(entrataValue)}`;
  }
  if (mode === MONEY_MODE_FORMULA && formulaValue !== undefined) {
    return `${base} — ${formatMoneyForCaption(formulaValue)}`;
  }
  return base;
}
