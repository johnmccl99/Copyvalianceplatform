export const UW_SUMMARY_COLUMNS = Object.freeze([
  "purchase_price",
  "all_in_basis",
  "levered_irr",
  "unlevered_irr",
  "equity_multiple_levered",
  "equity_multiple_unlevered",
  "going_in_cap_rate_y1",
  "terminal_cap_rate",
  "terminal_cap_rate_tax_adj",
  "raw",
  "parsed_at",
  "source_file_path",
]);

export const UW_SUMMARY_SELECT = UW_SUMMARY_COLUMNS.join(",");

export const EMPTY_KPI = "—";

const numericOrNull = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
};

export function readUwNumber(sources, key) {
  const { canonicalValues, summary } = sources || {};
  const candidates = [
    canonicalValues?.[key],
    summary?.[key],
    summary?.raw?.extracted_extras?.[key],
  ];
  for (const c of candidates) {
    const n = numericOrNull(c);
    if (n !== null) return n;
  }
  return null;
}

export const EXIT_CAP_LABEL_AFTER_TAX = "Exit Cap (after tax)";
export const EXIT_CAP_LABEL_PRE_TAX = "Exit Cap (pre-tax)";

export function exitCapMetric(read) {
  const taxAdj = read("terminal_cap_rate_tax_adj");
  if (taxAdj !== null && taxAdj !== undefined) {
    return {
      label: EXIT_CAP_LABEL_AFTER_TAX,
      value: taxAdj,
      key: "terminal_cap_rate_tax_adj",
    };
  }
  const preTax = read("terminal_cap_rate");
  return {
    label: EXIT_CAP_LABEL_PRE_TAX,
    value: preTax ?? null,
    key: "terminal_cap_rate",
  };
}
