import { formatStatementMoney } from "../statementPresentation.js";
import { formatPercent, EMPTY } from "../numberFormat.js";
import {
  buildDocShell,
  printableWidth,
  NARROW_MARGIN_X,
  BRAND_MUTED,
  BRAND_BORDER,
  BRAND_STRIPE,
} from "./valianceLetterhead.js";

const CELL_PADDING_X = 2;

const MIN_MONEY_WIDTH = 34;
const MIN_PERCENT_WIDTH = 30;

const PERCENT_SHARE = 0.95;
const LABEL_WIDTH = 110;

const MONTH_BLOCK_MIN = MIN_MONEY_WIDTH * 3 + MIN_PERCENT_WIDTH;

const PAGE_LADDER = ["LETTER", "LEGAL", "TABLOID"];

export function variancePdfMonthCapacity(pageSize) {
  const contentWidth = printableWidth("landscape", pageSize, NARROW_MARGIN_X);
  const fixed = LABEL_WIDTH + MONTH_BLOCK_MIN + (1 + 4) * 2 * CELL_PADDING_X;
  const perMonth = MONTH_BLOCK_MIN + 4 * 2 * CELL_PADDING_X;
  return Math.max(1, Math.floor((contentWidth - fixed) / perMonth));
}

export function variancePdfPageChoice(monthCount) {
  const pageSize =
    PAGE_LADDER.find((size) => variancePdfMonthCapacity(size) >= monthCount) ||
    PAGE_LADDER[PAGE_LADDER.length - 1];
  return {
    pageSize,
    marginX: NARROW_MARGIN_X,
    monthsPerPage: variancePdfMonthCapacity(pageSize),
  };
}

export function sliceVarianceModelByMonths(model, monthsPerChunk) {
  const columns = model?.columns || [];
  const monthCount = Math.max(0, (columns.length - 5) / 4);
  if (monthCount <= monthsPerChunk) return [model];

  const chunks = [];
  for (let first = 0; first < monthCount; first += monthsPerChunk) {
    const last = Math.min(first + monthsPerChunk, monthCount);
    const indices = [
      0,
      ...Array.from(
        { length: (last - first) * 4 },
        (_v, k) => 1 + first * 4 + k,
      ),
      ...Array.from({ length: 4 }, (_v, k) => columns.length - 4 + k),
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

export function variancePdfColumnWidths(columns, contentWidth) {
  const available = contentWidth - columns.length * 2 * CELL_PADDING_X;
  const labelWidth = Math.min(LABEL_WIDTH, Math.max(60, available * 0.14));
  const figures = columns.slice(1);
  const units =
    figures.reduce(
      (sum, c) => sum + (c.type === "percent" ? PERCENT_SHARE : 1),
      0,
    ) || 1;
  const perUnit = Math.max(0, available - labelWidth) / units;
  return [
    labelWidth,
    ...figures.map((c) =>
      c.type === "percent" ? perUnit * PERCENT_SHARE : perUnit,
    ),
  ];
}

function cellText(column, value) {
  if (column.type === "percent")
    return formatPercent(value, { signed: true, empty: EMPTY });
  if (column.type === "money") return formatStatementMoney(value);
  return value == null || value === "" ? EMPTY : String(value);
}

function styleForRow(kind) {
  if (kind === "total") return "totalCell";
  if (kind === "subtotal") return "subtotalCell";
  return "cell";
}

export function buildVariancePdfBody(model, { formatCell = cellText } = {}) {
  const columns = model?.columns || [];
  const body = [];

  const groupRow = columns.map((c, i) => {
    const isStart = c.group && (i === 0 || columns[i - 1].group !== c.group);
    if (!isStart) return { text: "", style: "tableHeader" };
    let span = 1;
    while (i + span < columns.length && columns[i + span].group === c.group)
      span += 1;
    return {
      text: c.group,
      style: "tableHeader",
      alignment: "center",
      colSpan: span,
    };
  });
  if (columns.some((c) => c.group)) body.push(groupRow);
  body.push(
    columns.map((c) => ({
      text: c.label,
      style: "tableHeader",
      alignment: c.type === "text" ? "left" : "right",
    })),
  );

  for (const row of model?.rows || []) {
    if (row.kind === "header") {
      body.push(
        columns.map((_c, i) =>
          i === 0
            ? {
                text: row.label,
                style: "varianceBand",
                colSpan: columns.length,
                margin: [Math.min(Number(row.depth) || 0, 4) * 4, 1, 0, 1],
              }
            : { text: "", style: "varianceBand" },
        ),
      );
      continue;
    }
    const style = styleForRow(row.kind);
    body.push(
      columns.map((column, i) => ({
        text: formatCell(column, row.cells[i], row),
        style,
        alignment: column.type === "text" ? "left" : "right",
        ...(i === 0
          ? { margin: [Math.min(Number(row.depth) || 0, 4) * 4, 0, 0, 0] }
          : null),
      })),
    );
  }
  return body;
}

export const TABLE_LAYOUT = {
  hLineWidth: () => 0.4,
  vLineWidth: () => 0,
  hLineColor: () => BRAND_BORDER,
  fillColor: (rowIndex) =>
    rowIndex > 1 && rowIndex % 2 === 1 ? BRAND_STRIPE : null,
  paddingTop: () => 1,
  paddingBottom: () => 1,
  paddingLeft: () => CELL_PADDING_X,
  paddingRight: () => CELL_PADDING_X,
};

export function noiBuildPdfColumnWidths(columns, contentWidth) {
  const available = contentWidth - columns.length * 2 * CELL_PADDING_X;
  const figures = columns.slice(1);
  const figureWidth = Math.min(90, Math.max(MIN_MONEY_WIDTH, available * 0.14));
  const labelWidth = Math.max(
    LABEL_WIDTH,
    available - figureWidth * figures.length,
  );
  return [labelWidth, ...figures.map(() => figureWidth)];
}

export function buildBudgetVariancePdfDoc(model, { orgName } = {}) {
  const columns = model?.columns || [];
  const monthCount = Math.max(0, (columns.length - 5) / 4);
  const { pageSize, marginX, monthsPerPage } =
    variancePdfPageChoice(monthCount);
  const contentWidth = printableWidth("landscape", pageSize, marginX);
  const chunks = sliceVarianceModelByMonths(model, monthsPerPage);

  const content = [];
  chunks.forEach((chunk, i) => {
    if (i > 0) content.push({ text: "", pageBreak: "before" });
    content.push({
      table: {
        headerRows: 2,
        widths: variancePdfColumnWidths(chunk.columns, contentWidth),
        body: buildVariancePdfBody(chunk),
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

  const noiBuild = model?.noiBuild;
  if (noiBuild && Array.isArray(noiBuild.rows) && noiBuild.rows.length) {
    content.push({
      text: noiBuild.title || "NOI Build",
      style: "varianceSectionTitle",
      pageBreak: "before",
    });
    content.push({
      table: {
        headerRows: 1,
        widths: noiBuildPdfColumnWidths(
          noiBuild.columns,
          Math.min(contentWidth, 560),
        ),
        body: buildVariancePdfBody(noiBuild),
      },
      layout: TABLE_LAYOUT,
    });
    (noiBuild.notes || []).forEach((note, i) => {
      content.push({
        text: note,
        style: "varianceNote",
        margin: [0, i === 0 ? 8 : 2, 0, 0],
      });
    });
  }

  return buildDocShell({
    propertyName: model?.propertyCode || "",
    reportTitle: model?.title || "Budget Variance",
    periodLabel: model?.periodLabel || "",
    content,
    pageOrientation: "landscape",
    pageSize,
    marginX,
    orgName,
    styles: {
      ...VARIANCE_PDF_STYLES,
    },
  });
}

export const VARIANCE_PDF_STYLES = {
  varianceBand: { fontSize: 8, bold: true, color: BRAND_MUTED },
  varianceSectionTitle: {
    fontSize: 10,
    bold: true,
    color: "#0a1628",
    margin: [0, 0, 0, 6],
  },
  varianceNote: { fontSize: 7.5, color: BRAND_MUTED, italics: true },
  cell: { fontSize: 7, color: "#1f2933" },
  tableHeader: {
    fontSize: 6.5,
    bold: true,
    color: "#ffffff",
    fillColor: "#0a1628",
  },
  subtotalCell: {
    fontSize: 7,
    bold: true,
    color: "#0a1628",
    fillColor: "#eef1f4",
  },
  totalCell: {
    fontSize: 7,
    bold: true,
    color: "#ffffff",
    fillColor: "#0a1628",
  },
};
