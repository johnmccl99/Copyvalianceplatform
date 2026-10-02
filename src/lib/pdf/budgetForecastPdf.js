import { formatBudgetCell, formatBudgetTotal } from "../budgetCellFormat.js";
import {
  buildVariancePdfBody,
  TABLE_LAYOUT,
  VARIANCE_PDF_STYLES,
} from "./budgetVariancePdf.js";
import {
  buildDocShell,
  printableWidth,
  NARROW_MARGIN_X,
} from "./valianceLetterhead.js";

const CELL_PADDING_X = 2;
const MIN_MONEY_WIDTH = 38;
const ACCOUNT_WIDTH = 34;
const NAME_WIDTH = 120;
const FIXED_TEXT_COLUMNS = 2;
const PAGE_LADDER = ["LETTER", "LEGAL", "TABLOID"];

export function forecastPdfMonthCapacity(pageSize) {
  const contentWidth = printableWidth("landscape", pageSize, NARROW_MARGIN_X);
  const fixed =
    ACCOUNT_WIDTH +
    NAME_WIDTH +
    MIN_MONEY_WIDTH +
    (FIXED_TEXT_COLUMNS + 1) * 2 * CELL_PADDING_X;
  const perMonth = MIN_MONEY_WIDTH + 2 * CELL_PADDING_X;
  return Math.max(1, Math.floor((contentWidth - fixed) / perMonth));
}

export function forecastPdfPageChoice(monthCount) {
  const pageSize =
    PAGE_LADDER.find((size) => forecastPdfMonthCapacity(size) >= monthCount) ||
    PAGE_LADDER[PAGE_LADDER.length - 1];
  return {
    pageSize,
    marginX: NARROW_MARGIN_X,
    monthsPerPage: forecastPdfMonthCapacity(pageSize),
  };
}

export function forecastMonthCount(columns = []) {
  return Math.max(0, columns.length - FIXED_TEXT_COLUMNS - 1);
}

export function sliceForecastModelByMonths(model, monthsPerChunk) {
  const columns = model?.columns || [];
  const monthCount = forecastMonthCount(columns);
  if (monthCount <= monthsPerChunk) return [model];

  const chunks = [];
  for (let first = 0; first < monthCount; first += monthsPerChunk) {
    const last = Math.min(first + monthsPerChunk, monthCount);
    const indices = [
      0,
      1,
      ...Array.from(
        { length: last - first },
        (_v, k) => FIXED_TEXT_COLUMNS + first + k,
      ),
      columns.length - 1,
    ];
    chunks.push({
      ...model,
      columns: indices.map((i) => columns[i]),
      rows: (model.rows || []).map((row) =>
        row.kind === "header"
          ? row
          : { ...row, cells: indices.map((i) => row.cells[i]) },
      ),
    });
  }
  return chunks;
}

export function forecastPdfColumnWidths(columns, contentWidth) {
  const available = contentWidth - columns.length * 2 * CELL_PADDING_X;
  const figures = Math.max(1, columns.length - FIXED_TEXT_COLUMNS);
  const nameWidth = Math.min(NAME_WIDTH, Math.max(70, available * 0.18));
  const perFigure =
    Math.max(0, available - ACCOUNT_WIDTH - nameWidth) / figures;
  return [
    ACCOUNT_WIDTH,
    nameWidth,
    ...Array.from({ length: figures }, () => perFigure),
  ];
}

export function forecastPdfCellText(column, value, row) {
  if (column.type === "text") return value == null ? "" : String(value);
  if (value == null)
    return row?.kind === "account" ? "" : formatBudgetTotal(value);
  return column.isTotal ? formatBudgetTotal(value) : formatBudgetCell(value);
}

export function buildBudgetForecastPdfDoc(model, { orgName } = {}) {
  const monthCount = forecastMonthCount(model?.columns);
  const { pageSize, marginX, monthsPerPage } =
    forecastPdfPageChoice(monthCount);
  const contentWidth = printableWidth("landscape", pageSize, marginX);
  const chunks = sliceForecastModelByMonths(model, monthsPerPage);

  const content = [];
  chunks.forEach((chunk, i) => {
    if (i > 0) content.push({ text: "", pageBreak: "before" });
    content.push({
      table: {
        headerRows: 1,
        widths: forecastPdfColumnWidths(chunk.columns, contentWidth),
        body: buildVariancePdfBody(chunk, { formatCell: forecastPdfCellText }),
      },
      layout: TABLE_LAYOUT,
    });
  });
  (model?.notes || []).forEach((note, i) => {
    content.push({
      text: note,
      style: "varianceNote",
      margin: [0, i === 0 ? 8 : 2, 0, 0],
    });
  });

  return buildDocShell({
    propertyName: model?.propertyCode || "",
    reportTitle: model?.title || "Budget & Forecast",
    periodLabel: model?.periodLabel || "",
    content,
    pageOrientation: "landscape",
    pageSize,
    marginX,
    orgName,
    styles: { ...VARIANCE_PDF_STYLES },
  });
}
