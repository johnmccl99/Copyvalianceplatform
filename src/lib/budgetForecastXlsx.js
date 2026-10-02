import ExcelJS from "exceljs";
import { writeVarianceSheet } from "./budgetVarianceXlsx.js";
import {
  budgetForecastDatasetKey,
  budgetForecastExportFilename,
  budgetForecastExportRowCount,
} from "./budgetForecastExport.js";
import { logExportEvent } from "./supabaseClient.js";

const SHEET_NAME = "Budget & Forecast";

export function buildBudgetForecastWorksheet(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Pace Labs";
  return writeVarianceSheet(workbook, SHEET_NAME, {
    ...model,
    freezeColumns: 2,
  });
}

export async function exportBudgetForecastXLSX({ model, axis } = {}) {
  const ws = buildBudgetForecastWorksheet(model);
  const buffer = await ws.workbook.xlsx.writeBuffer();

  const filename = budgetForecastExportFilename(
    model?.propertyCode,
    model?.mode,
    axis,
    "xlsx",
  );
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  const rowCount = budgetForecastExportRowCount(model?.rows);
  try {
    await logExportEvent({
      datasetKey: budgetForecastDatasetKey(model?.propertyCode),
      format: "xlsx",
      rowCount,
      action: "completed",
    });
  } catch (_e) {}
  return { filename, rowCount };
}
