import ExcelJS from "exceljs";
import {
  budgetVarianceDatasetKey,
  budgetVarianceExportFilename,
  budgetVarianceExportRowCount,
} from "./budgetVarianceExport.js";
import { logExportEvent } from "./supabaseClient.js";

const SHEET_NAME = "Budget Variance";
export const NOI_BUILD_SHEET_NAME = "NOI Build";
const MONEY_FORMAT = "#,##0;(#,##0)";
const PERCENT_FORMAT = "0.0%;(0.0%)";
const FONT_NAME = "Arial";
const HEADER_FILL = "FFC0C0C0";
const GROUP_FILL = "FFE4E4E4";
const SECTION_FILL = "FFF2F2F2";

export function varianceXlsxCellValue(column, value) {
  if (value === null || value === undefined) return null;
  if (!column || column.type === "text") return value === "" ? null : value;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return column.type === "percent" ? n / 100 : n;
}

function widthForColumn(column, index) {
  if (column.key === "account") return 12;
  if (index === 0 || column.key === "name") return 42;
  if (column.type === "text") return 16;
  return column.type === "percent" ? 9 : 14;
}

export function buildBudgetVarianceWorksheet(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Pace Labs";
  const ws = writeVarianceSheet(workbook, SHEET_NAME, model);
  if (model?.noiBuild) {
    writeVarianceSheet(workbook, NOI_BUILD_SHEET_NAME, {
      ...model.noiBuild,
      propertyCode: model?.propertyCode,
      periodLabel: model?.periodLabel,
    });
  }
  return ws;
}

export function writeVarianceSheet(workbook, sheetName, model) {
  const columns = model?.columns || [];
  const rows = model?.rows || [];
  const notes = model?.notes || [];
  const lastColumn = Math.max(columns.length, 1);

  const ws = workbook.addWorksheet(sheetName, {
    properties: { defaultRowHeight: 15 },
    pageSetup: {
      paperSize: 1,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.4,
        right: 0.4,
        top: 0.5,
        bottom: 0.5,
        header: 0.25,
        footer: 0.25,
      },
    },
  });

  const title = model?.title || sheetName;
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: FONT_NAME, size: 12, bold: true };
  ws.getCell(2, 1).value = model?.propertyCode || "";
  ws.getCell(3, 1).value = model?.periodLabel || "";
  for (const rowNumber of [2, 3]) {
    ws.getCell(rowNumber, 1).font = { name: FONT_NAME, size: 10, italic: true };
  }

  let rowNumber = 4;
  for (const note of notes) {
    rowNumber += 1;
    if (lastColumn > 1) ws.mergeCells(rowNumber, 1, rowNumber, lastColumn);
    const cell = ws.getCell(rowNumber, 1);
    cell.value = note;
    cell.font = { name: FONT_NAME, size: 9, italic: true };
    cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  }

  const groupRow = rowNumber + 2;
  const headerRow = groupRow + 1;
  let spanStart = null;
  for (let i = 0; i < columns.length; i += 1) {
    const group = columns[i].group || "";
    const cell = ws.getCell(groupRow, i + 1);
    cell.value =
      group && (i === 0 || columns[i - 1].group !== group) ? group : null;
    cell.font = { name: FONT_NAME, size: 10, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    if (group) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: GROUP_FILL },
      };
    }
    if (group && (i === 0 || columns[i - 1].group !== group)) spanStart = i;
    const groupEnds =
      group && (i === columns.length - 1 || columns[i + 1].group !== group);
    if (groupEnds && spanStart !== null && i > spanStart) {
      ws.mergeCells(groupRow, spanStart + 1, groupRow, i + 1);
      spanStart = null;
    }
  }
  columns.forEach((column, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = column.label;
    cell.font = { name: FONT_NAME, size: 10, bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = {
      horizontal: column.type === "text" ? "left" : "right",
      vertical: "middle",
      wrapText: true,
    };
  });

  ws.views = [
    {
      state: "frozen",
      xSplit: model?.freezeColumns || 1,
      ySplit: headerRow,
      topLeftCell: ws.getCell(headerRow + 1, (model?.freezeColumns || 1) + 1)
        .address,
    },
  ];
  ws.pageSetup.printTitlesRow = `${groupRow}:${headerRow}`;

  rows.forEach((row, rowIndex) => {
    const sheetRow = ws.getRow(headerRow + 1 + rowIndex);
    if (row.kind === "header") {
      const cell = ws.getCell(sheetRow.number, 1);
      cell.value = row.label;
      cell.font = { name: FONT_NAME, size: 10, bold: true };
      if (lastColumn > 1)
        ws.mergeCells(sheetRow.number, 1, sheetRow.number, lastColumn);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: SECTION_FILL },
      };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      return;
    }
    const bold = row.kind === "subtotal" || row.kind === "total";
    columns.forEach((column, i) => {
      const cell = ws.getCell(sheetRow.number, i + 1);
      cell.value = varianceXlsxCellValue(column, row.cells[i]);
      cell.font = { name: FONT_NAME, size: 10, bold };
      if (column.type === "money") cell.numFmt = MONEY_FORMAT;
      if (column.type === "percent") cell.numFmt = PERCENT_FORMAT;
      cell.alignment = {
        horizontal: column.type === "text" ? "left" : "right",
        vertical: "middle",
        indent: i === 0 ? Math.min(Number(row.depth) || 0, 4) : undefined,
      };
    });
  });

  columns.forEach((column, i) => {
    ws.getColumn(i + 1).width = widthForColumn(column, i);
  });

  return ws;
}

export async function exportBudgetVarianceXLSX({
  model,
  period,
  comparePeriod = null,
} = {}) {
  const ws = buildBudgetVarianceWorksheet(model);
  const buffer = await ws.workbook.xlsx.writeBuffer();

  const filename = budgetVarianceExportFilename(
    model?.propertyCode,
    period,
    "xlsx",
    comparePeriod,
  );
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  const rowCount =
    budgetVarianceExportRowCount(model?.rows) +
    budgetVarianceExportRowCount(model?.noiBuild?.rows);
  try {
    await logExportEvent({
      datasetKey: budgetVarianceDatasetKey(model?.propertyCode),
      format: "xlsx",
      rowCount,
      action: "completed",
    });
  } catch (_e) {}

  return { filename, rowCount };
}
