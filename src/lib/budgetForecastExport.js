import { formatMonthLabel } from "./budgetOutputSurfaces.js";

export const FORECAST_EXPORT_TITLE = "Budget & Forecast";

const MODE_LABEL = {
  is: "Income Statement",
  bs: "Balance Sheet",
  combined: "Income Statement and Balance Sheet, one sheet",
};

export function forecastModeLabel(mode) {
  return MODE_LABEL[mode] || MODE_LABEL.combined;
}

export function buildForecastExportColumns(axis = []) {
  return [
    { key: "account", label: "Account", type: "text" },
    { key: "name", label: "Name", type: "text" },
    ...axis.map((m) => ({
      key: `m${m.month_index}`,
      label: formatMonthLabel(m.month_end) || String(m.month_index),
      type: "money",
    })),
    { key: "total", label: "Total", type: "money", isTotal: true },
  ];
}

function figure(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function forecastAccountRow({
  accountNumber,
  accountName,
  monthly = [],
  total,
  absentByMonth = null,
  depth = 0,
  axisLength = monthly.length,
}) {
  const cells = [String(accountNumber ?? ""), accountName || ""];
  for (let i = 0; i < axisLength; i += 1) {
    cells.push(absentByMonth && absentByMonth[i] ? null : figure(monthly[i]));
  }
  cells.push(figure(total));
  return { kind: "account", depth, cells };
}

export function forecastSubtotalRow({
  label,
  monthly = [],
  total,
  depth = 0,
  isGrandTotal = false,
  axisLength = monthly.length,
}) {
  const cells = ["", label || ""];
  for (let i = 0; i < axisLength; i += 1) cells.push(figure(monthly[i]));
  cells.push(figure(total) ?? 0);
  return { kind: isGrandTotal ? "total" : "subtotal", depth, cells };
}

export function forecastHeaderRow(label, depth = 0) {
  return { kind: "header", label: label || "", depth };
}

export function forecastRangeLabel(axis = []) {
  if (!axis.length) return "";
  const first = formatMonthLabel(axis[0].month_end);
  const last = formatMonthLabel(axis[axis.length - 1].month_end);
  return first === last ? first : `${first} \u2013 ${last}`;
}

export function buildForecastExportNotes({
  mode,
  hideZero,
  hiddenCount = 0,
  shownCount = 0,
  axis = [],
  rangeNarrowed = false,
  statementUnavailable = false,
} = {}) {
  const notes = [];
  notes.push(`Statement: ${forecastModeLabel(mode)}.`);
  notes.push(
    hideZero
      ? `Zero-balance accounts hidden on screen when exported: ${shownCount} account${shownCount === 1 ? "" : "s"} shown, ${hiddenCount} hidden.`
      : `All accounts shown (${shownCount}); zero-balance accounts were not hidden.`,
  );
  if (axis.length) {
    notes.push(
      `${rangeNarrowed ? "Selected range" : "Full range"}: ${forecastRangeLabel(axis)} (${axis.length} month${axis.length === 1 ? "" : "s"}).`,
    );
  }
  if (statementUnavailable) {
    notes.push(
      "The statement layout was unavailable for this property, so the whole chart of accounts is listed in workbook bucket order rather than split into Income Statement and Balance Sheet.",
    );
  }
  notes.push(
    "A blank month cell is an account-month with no row behind it; a zero is a figure the budget carries.",
  );
  return notes;
}

export function buildForecastExportModel({
  propertyCode,
  mode,
  axis = [],
  rows = [],
  hideZero = false,
  hiddenCount = 0,
  shownCount = 0,
  rangeNarrowed = false,
  statementUnavailable = false,
} = {}) {
  return {
    title: `${FORECAST_EXPORT_TITLE} \u2014 ${forecastModeLabel(mode)}`,
    propertyCode: propertyCode || "",
    periodLabel: forecastRangeLabel(axis),
    mode,
    columns: buildForecastExportColumns(axis),
    rows,
    notes: buildForecastExportNotes({
      mode,
      hideZero,
      hiddenCount,
      shownCount,
      axis,
      rangeNarrowed,
      statementUnavailable,
    }),
  };
}

export function budgetForecastExportFilename(
  propertyCode,
  mode,
  axis,
  extension,
) {
  const safe = String(propertyCode || "Property").replace(/[^a-z0-9]+/gi, "-");
  const tab = mode === "is" ? "IS" : mode === "bs" ? "BS" : "Combined";
  const ym = (m) => String(m?.month_end || "").slice(0, 7);
  const window =
    axis && axis.length ? `-${ym(axis[0])}_${ym(axis[axis.length - 1])}` : "";
  return `BudgetForecast-${safe}-${tab}${window}.${extension}`;
}

export function budgetForecastDatasetKey(propertyCode) {
  return `budget-forecast:${propertyCode || ""}`;
}

export function budgetForecastExportRowCount(rows) {
  return (rows || []).filter((r) => r && r.kind !== "header").length;
}
