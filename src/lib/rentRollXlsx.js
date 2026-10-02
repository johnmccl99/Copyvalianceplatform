import ExcelJS from "exceljs";
import {
  buildColumnTotals,
  totalCoverageLabel,
  rentColumnTotal,
  rentTotalCoverageSentence,
} from "./rentRollTotals.js";
import {
  unitCellLabel,
  MTM_MARKER,
  isByUnitRoll,
  NOT_MOVED_IN_LABEL,
} from "./rentRollView.js";
import { byUnitBasisSentence } from "./rentRollByUnit.js";
import {
  buildRentRollSummary,
  CHARGE_SUMMARY_ACTUAL_NOTE,
  CHARGE_SUMMARY_LEDGER_NOTE,
  STATUS_SUMMARY_BASIS_NOTE,
} from "./rentRollSummary.js";
import {
  UNASSIGNED_SECTION_HEADING,
  UNASSIGNED_SECTION_NOTE,
} from "./rentRollUnassigned.js";
import { normalizeAsOf } from "./entrataLeaseStatus.js";
import { logExportEvent } from "./supabaseClient.js";

const SHEET_NAME = "Rent Roll";
const REPORT_TITLE = "Rent Roll";
const MONEY_FORMAT = "#,##0.00;(#,##0.00)";
const NUMBER_FORMAT = "#,##0";
const DATE_FORMAT = "mm-dd-yy";
const FONT_NAME = "Arial";
const HEADER_FILL = "FFC0C0C0";
const BLACK = "FF000000";

export function rentRollCellValue(col, row) {
  if (!col || typeof col.get !== "function") return "";

  if (col.key === "unit") return unitCellLabel(row);

  if (col.key === "tenant" && row && row.not_moved_in) {
    const name = col.get(row);
    return (
      (name == null || name === "" ? "" : String(name) + " — ") +
      NOT_MOVED_IN_LABEL
    );
  }

  if (col.key === "leaseEnd") {
    const end = col.get(row);
    if (end == null || String(end).trim() === "") {
      return row && row.is_mtm ? MTM_MARKER : "";
    }
    return String(end);
  }

  const v = col.get(row);
  if (v == null || v === "") return "";

  if (col.type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : "";
  }

  if (col.type === "bool") {
    return v ? "Yes" : "";
  }

  return String(v);
}

export function buildRentRollAoa({ columns, rows } = {}) {
  const cols = Array.isArray(columns) ? columns.filter(Boolean) : [];
  const data = Array.isArray(rows) ? rows : [];
  const aoa = [cols.map((c) => c.label || c.key || "")];
  for (const row of data) {
    aoa.push(cols.map((c) => rentRollCellValue(c, row)));
  }

  if (data.length) {
    const totals = buildColumnTotals(data, cols);
    const sums = cols.map((c, i) => {
      if (i === 0) return "Totals";
      const entry = totals.get(c.key);
      if (!entry || entry.sum == null) return "";
      const n = Number(entry.sum);
      return Number.isFinite(n) ? n : "";
    });
    const coverage = cols.map((c, i) => {
      if (i === 0) return "Coverage";
      const entry = totals.get(c.key);
      const label = entry ? totalCoverageLabel(entry) : null;
      return label || "";
    });
    aoa.push(sums);
    if (coverage.some((v, i) => i > 0 && v)) aoa.push(coverage);
  }

  return aoa;
}

function dateAtUtcMidnight(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date;
}

function widthForColumn(col) {
  if (!col) return 14;
  if (col.key === "unit") return 18;
  if (col.key === "tenant") return 24;
  if (col.type === "date") return 12;
  if (col.type === "number") return 14;
  const labelLength = String(col.label || col.key || "").length;
  return Math.min(20, Math.max(12, labelLength + 2));
}

const SUMMARY_SECTION_ROW = 6;
const SUMMARY_HEADER_ROW = 7;
const SUMMARY_FIRST_ROW = 8;

function rentRollSummaryLayout(summary, hasChargeColumns) {
  if (!summary) {
    return {
      summaryHeight: 0,
      notesRow: null,
      unitDetailsRow: 6,
      columnHeaderRow: 7,
      firstDataRow: 8,
    };
  }
  const chargeRowCount =
    hasChargeColumns && summary.charges.groups.length
      ? summary.charges.groups.reduce(
          (count, group) => count + 2 + group.entries.length,
          0,
        ) + 1
      : 0;
  const summaryHeight = Math.max(summary.status.entries.length, chargeRowCount);
  const notesRow = SUMMARY_FIRST_ROW + summaryHeight;
  const trailingRows = hasChargeColumns ? 4 : 2;
  return {
    summaryHeight,
    notesRow,
    unitDetailsRow: notesRow + trailingRows,
    columnHeaderRow: notesRow + trailingRows + 1,
    firstDataRow: notesRow + trailingRows + 2,
  };
}

function sumFormula(columnLetter, ranges) {
  return `SUM(${ranges
    .map(
      ({ start, length }) =>
        `${columnLetter}${start}:${columnLetter}${start + length - 1}`,
    )
    .join(",")})`;
}

function setSummaryHeader(cell, text, alignment = "left") {
  cell.value = text;
  cell.font = { name: FONT_NAME, size: 10, bold: true };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  cell.alignment = {
    horizontal: alignment,
    vertical: "middle",
    wrapText: true,
  };
}

function setSummaryCell(
  cell,
  value,
  { alignment = "left", numFmt, bold = false, italic = false } = {},
) {
  cell.value = value == null ? null : value;
  cell.font = { name: FONT_NAME, size: 10, bold, italic };
  cell.alignment = {
    horizontal: alignment,
    vertical: "middle",
    wrapText: true,
  };
  if (numFmt) cell.numFmt = numFmt;
}

function setSummaryFormula(cell, columnLetter, ranges, result, options = {}) {
  if (result == null || !Number.isFinite(Number(result)) || !ranges.length) {
    setSummaryCell(cell, null, options);
    return;
  }
  setSummaryCell(cell, null, options);
  cell.value = {
    formula: sumFormula(columnLetter, ranges),
    result: Number(result),
  };
}

function mergeSummaryNote(ws, rowNumber, lastColumn, text) {
  ws.mergeCells(rowNumber, 1, rowNumber, lastColumn);
  const cell = ws.getCell(rowNumber, 1);
  setSummaryCell(cell, text, { italic: true });
}

const NOTE_LINE_HEIGHT = 13.5;

function fitMergedNoteRows(ws, rowNumbers, lastColumn) {
  let charsPerLine = 0;
  for (let column = 1; column <= lastColumn; column += 1) {
    charsPerLine += ws.getColumn(column).width || 0;
  }
  if (charsPerLine <= 0) return;
  for (const rowNumber of rowNumbers) {
    const text = ws.getCell(rowNumber, 1).value;
    if (typeof text !== "string" || !text) continue;
    const lines = Math.ceil(text.length / charsPerLine);
    if (lines > 1) ws.getRow(rowNumber).height = lines * NOTE_LINE_HEIGHT;
  }
}

function writeRentRollSummary(ws, summary, chargeColumns, lastColumn, layout) {
  const hasChargeColumns = Array.isArray(chargeColumns);
  const statusEntries = summary.status.entries;
  const chargeGroups = hasChargeColumns ? summary.charges.groups : [];
  ws.getCell(SUMMARY_SECTION_ROW, 1).value = "Status Summary";
  ws.getCell(SUMMARY_SECTION_ROW, 1).font = {
    name: FONT_NAME,
    size: 12,
    bold: true,
  };
  if (hasChargeColumns) {
    ws.getCell(SUMMARY_SECTION_ROW, 5).value = "Charge Code Summary";
    ws.getCell(SUMMARY_SECTION_ROW, 5).font = {
      name: FONT_NAME,
      size: 12,
      bold: true,
    };
  }

  setSummaryHeader(ws.getCell(SUMMARY_HEADER_ROW, 1), "Description");
  setSummaryHeader(ws.getCell(SUMMARY_HEADER_ROW, 2), "Unit Count", "right");
  setSummaryHeader(ws.getCell(SUMMARY_HEADER_ROW, 3), "Percent", "right");
  if (hasChargeColumns) {
    setSummaryHeader(ws.getCell(SUMMARY_HEADER_ROW, 5), "Charge Code");
    setSummaryHeader(ws.getCell(SUMMARY_HEADER_ROW, 6), "Scheduled", "right");
    setSummaryHeader(ws.getCell(SUMMARY_HEADER_ROW, 7), "Charge Code Type");
    setSummaryHeader(ws.getCell(SUMMARY_HEADER_ROW, 8), "Actual", "right");
  }

  statusEntries.forEach((entry, index) => {
    const rowNumber = SUMMARY_FIRST_ROW + index;
    const isTotal = entry.kind === "total";
    const isDerived = entry.kind === "derived";
    const isSubtotal = entry.kind === "subtotal";
    const style = isTotal ? { bold: true } : { bold: isSubtotal || isDerived };
    setSummaryCell(ws.getCell(rowNumber, 1), entry.description, style);
    if (isSubtotal) {
      setSummaryFormula(
        ws.getCell(rowNumber, 2),
        "B",
        [
          {
            start: SUMMARY_FIRST_ROW + entry.run.start,
            length: entry.run.length,
          },
        ],
        entry.count,
        { alignment: "right", numFmt: NUMBER_FORMAT, bold: true },
      );
    } else if (isTotal || isDerived) {
      setSummaryFormula(
        ws.getCell(rowNumber, 2),
        "B",
        entry.runs.map((run) => ({
          start: SUMMARY_FIRST_ROW + run.start,
          length: run.length,
        })),
        entry.count,
        { alignment: "right", numFmt: NUMBER_FORMAT, bold: true },
      );
    } else {
      setSummaryCell(ws.getCell(rowNumber, 2), entry.count, {
        alignment: "right",
        numFmt: NUMBER_FORMAT,
      });
    }
    setSummaryCell(ws.getCell(rowNumber, 3), entry.percent, {
      alignment: "right",
      numFmt: "0.00%",
      ...style,
    });
    if (isSubtotal || isDerived || isTotal) {
      ws.getCell(rowNumber, 1).border = {
        top: { style: isTotal ? "double" : "thin", color: { argb: BLACK } },
        ...(isTotal
          ? { bottom: { style: "double", color: { argb: BLACK } } }
          : {}),
      };
      ws.getCell(rowNumber, 2).border = ws.getCell(rowNumber, 1).border;
      ws.getCell(rowNumber, 3).border = ws.getCell(rowNumber, 1).border;
    }
  });

  if (hasChargeColumns) {
    let rowNumber = SUMMARY_FIRST_ROW;
    let chargeOffset = 0;
    const groupRanges = [];
    for (const group of chargeGroups) {
      ws.mergeCells(rowNumber, 5, rowNumber, 8);
      setSummaryCell(ws.getCell(rowNumber, 5), "Ledger: " + group.ledger, {
        bold: true,
      });
      rowNumber += 1;
      const detailStart =
        SUMMARY_FIRST_ROW + chargeOffset + 1 + group.run.start;
      group.entries.forEach((entry) => {
        setSummaryCell(ws.getCell(rowNumber, 5), entry.label);
        setSummaryCell(ws.getCell(rowNumber, 6), entry.scheduled, {
          alignment: "right",
          numFmt: MONEY_FORMAT,
        });
        setSummaryCell(ws.getCell(rowNumber, 7), entry.type);
        setSummaryCell(ws.getCell(rowNumber, 8), null, {
          alignment: "right",
          numFmt: MONEY_FORMAT,
        });
        rowNumber += 1;
      });
      groupRanges.push({
        start: detailStart,
        length: group.run.length,
      });
      setSummaryCell(ws.getCell(rowNumber, 5), "Total Scheduled Charges", {
        bold: true,
      });
      setSummaryFormula(
        ws.getCell(rowNumber, 6),
        "F",
        [
          {
            start: detailStart,
            length: group.run.length,
          },
        ],
        group.subtotal.scheduled,
        { alignment: "right", numFmt: MONEY_FORMAT, bold: true },
      );
      setSummaryCell(ws.getCell(rowNumber, 7), null, { bold: true });
      setSummaryCell(ws.getCell(rowNumber, 8), null, {
        alignment: "right",
        numFmt: MONEY_FORMAT,
        bold: true,
      });
      for (let column = 5; column <= 8; column += 1) {
        ws.getCell(rowNumber, column).border = {
          top: { style: "thin", color: { argb: BLACK } },
        };
      }
      rowNumber += 1;
      chargeOffset += 2 + group.entries.length;
    }
    setSummaryCell(ws.getCell(rowNumber, 5), "Grand Total", { bold: true });
    setSummaryFormula(
      ws.getCell(rowNumber, 6),
      "F",
      groupRanges,
      summary.charges.total.scheduled,
      {
        alignment: "right",
        numFmt: MONEY_FORMAT,
        bold: true,
      },
    );
    setSummaryCell(ws.getCell(rowNumber, 7), null, { bold: true });
    setSummaryCell(ws.getCell(rowNumber, 8), null, {
      alignment: "right",
      numFmt: MONEY_FORMAT,
      bold: true,
    });
    for (let column = 5; column <= 8; column += 1) {
      ws.getCell(rowNumber, column).border = {
        top: { style: "double", color: { argb: BLACK } },
        bottom: { style: "double", color: { argb: BLACK } },
      };
    }
  }

  mergeSummaryNote(ws, layout.notesRow, lastColumn, STATUS_SUMMARY_BASIS_NOTE);
  if (hasChargeColumns) {
    mergeSummaryNote(
      ws,
      layout.notesRow + 1,
      lastColumn,
      CHARGE_SUMMARY_ACTUAL_NOTE,
    );
    mergeSummaryNote(
      ws,
      layout.notesRow + 2,
      lastColumn,
      CHARGE_SUMMARY_LEDGER_NOTE,
    );
  }
}

function formatDataCells(ws, cols, data, firstDataRow) {
  for (let columnIndex = 0; columnIndex < cols.length; columnIndex += 1) {
    const col = cols[columnIndex];
    for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
      const cell = ws.getCell(firstDataRow + rowIndex, columnIndex + 1);
      cell.font = { name: FONT_NAME, size: 10 };
      cell.alignment = {
        horizontal: col.type === "number" ? "right" : "left",
        vertical: "middle",
      };

      if (col.type === "date") {
        const date = dateAtUtcMidnight(cell.value);
        if (date) {
          cell.value = date;
          cell.numFmt = DATE_FORMAT;
        }
        continue;
      }
      if (col.type === "number") {
        if (col.totalable === false) {
          cell.numFmt = NUMBER_FORMAT;
          continue;
        }
        const entry = buildColumnTotals([data[rowIndex]], [col]).get(col.key);
        if (!entry || entry.sum == null) {
          cell.value = null;
          continue;
        }
        cell.value = Number(entry.sum);
        cell.numFmt = MONEY_FORMAT;
      }
    }
  }
}

export function buildRentRollWorksheet({
  columns,
  rows,
  property,
  asOf,
  chargeColumns,
  unassignedRows,
  noun,
} = {}) {
  const cols = Array.isArray(columns) ? columns.filter(Boolean) : [];
  const data = Array.isArray(rows) ? rows : [];
  const unassigned = Array.isArray(unassignedRows)
    ? unassignedRows.filter(Boolean)
    : [];
  const table = buildRentRollAoa({ columns: cols, rows: data });
  const coverageSentence = data.length
    ? rentTotalCoverageSentence(rentColumnTotal(data), { noun })
    : null;
  if (coverageSentence)
    table.push([coverageSentence, ...cols.slice(1).map(() => "")]);
  const summary = data.length
    ? buildRentRollSummary({ rows: data, chargeColumns })
    : null;
  const hasChargeColumns = Array.isArray(chargeColumns);
  const layout = rentRollSummaryLayout(summary, hasChargeColumns);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Pace Labs";
  workbook.calcProperties.fullCalcOnLoad = true;
  const ws = workbook.addWorksheet(SHEET_NAME, {
    properties: { defaultRowHeight: 15 },
    pageSetup: {
      paperSize: 1,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.5,
        right: 0.5,
        top: 0.5,
        bottom: 0.5,
        header: 0.25,
        footer: 0.25,
      },
    },
    views: [
      {
        state: "frozen",
        ySplit: layout.columnHeaderRow,
        topLeftCell: "A" + layout.firstDataRow,
        activeCell: "A" + layout.firstDataRow,
      },
    ],
  });
  ws.headerFooter.oddHeader = `&L ${REPORT_TITLE}`;
  ws.headerFooter.oddFooter = `&L Page &P of &N &R &I${REPORT_TITLE}&I`;
  ws.pageSetup.printTitlesRow = `${layout.unitDetailsRow}:${layout.columnHeaderRow}`;

  const lastColumn = summary
    ? Math.max(cols.length, hasChargeColumns ? 8 : 3, 1)
    : Math.max(cols.length, 1);
  if (lastColumn > 1) {
    for (const rowNumber of [2, 3, 4]) {
      ws.mergeCells(rowNumber, 1, rowNumber, lastColumn);
    }
  }

  ws.getCell(2, 1).value = REPORT_TITLE;
  ws.getCell(2, 1).font = { name: FONT_NAME, size: 12, bold: true };
  ws.getCell(2, 1).alignment = { horizontal: "left", vertical: "middle" };

  const byUnit = isByUnitRoll(data);
  ws.getCell(3, 1).value = String((property && property.name) || "Property");
  ws.getCell(4, 1).value = byUnit
    ? `As of ${normalizeAsOf(asOf)} · ${byUnitBasisSentence(data)}`
    : `As of ${normalizeAsOf(asOf)}`;
  for (const rowNumber of [3, 4]) {
    ws.getCell(rowNumber, 1).font = { name: FONT_NAME, size: 10, italic: true };
    ws.getCell(rowNumber, 1).alignment = {
      horizontal: "left",
      vertical: "middle",
    };
  }

  if (summary) {
    writeRentRollSummary(ws, summary, chargeColumns, lastColumn, layout);
    ws.getCell(layout.unitDetailsRow, 1).value = "Unit Details";
    ws.getCell(layout.unitDetailsRow, 1).font = {
      name: FONT_NAME,
      size: 12,
      bold: true,
    };
  } else {
    ws.getCell(6, 1).value = "Unit Details";
    ws.getCell(6, 1).font = { name: FONT_NAME, size: 12, bold: true };
  }

  table.forEach((values, tableRowIndex) => {
    const row = ws.getRow(layout.columnHeaderRow + tableRowIndex);
    row.values = values.map((value) => (value === "" ? null : value));
  });

  const headerRow = ws.getRow(layout.columnHeaderRow);
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const col = cols[columnNumber - 1];
    cell.font = { name: FONT_NAME, size: 10, bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = {
      horizontal: col && col.type === "number" ? "right" : "left",
      vertical: "middle",
      wrapText: true,
    };
  });

  for (let columnIndex = 0; columnIndex < cols.length; columnIndex += 1) {
    ws.getColumn(columnIndex + 1).width = widthForColumn(cols[columnIndex]);
  }
  formatDataCells(ws, cols, data, layout.firstDataRow);

  if (summary) {
    const minimumWidths = {
      1: 26,
      2: 12,
      3: 12,
      5: 24,
      6: 14,
      7: 18,
      8: 12,
    };
    for (const [columnNumber, minimum] of Object.entries(minimumWidths)) {
      const column = ws.getColumn(Number(columnNumber));
      column.width = Math.max(column.width || 0, minimum);
    }
    fitMergedNoteRows(
      ws,
      [layout.notesRow, layout.notesRow + 1, layout.notesRow + 2],
      lastColumn,
    );
  }

  if (data.length) {
    const totals = buildColumnTotals(data, cols);
    const totalsRow = layout.firstDataRow + data.length;
    const lastDataRow = totalsRow - 1;
    const border = {
      top: { style: "thin", color: { argb: BLACK } },
      bottom: { style: "double", color: { argb: BLACK } },
    };
    for (let columnIndex = 0; columnIndex < cols.length; columnIndex += 1) {
      const col = cols[columnIndex];
      const cell = ws.getCell(totalsRow, columnIndex + 1);
      cell.font = { name: FONT_NAME, size: 10, bold: true };
      cell.alignment = {
        horizontal: col.type === "number" ? "right" : "left",
        vertical: "middle",
      };
      cell.border = border;

      const entry = totals.get(col.key);
      if (!entry || entry.sum == null) continue;
      const cachedValue = Number(entry.sum);
      if (!Number.isFinite(cachedValue)) continue;

      const columnName = ws.getColumn(columnIndex + 1).letter;
      cell.value = {
        formula: `SUM(${columnName}${layout.firstDataRow}:${columnName}${lastDataRow})`,
        result: cachedValue,
      };
      cell.numFmt = MONEY_FORMAT;
    }

    const coverageRow = totalsRow + 1;
    if (ws.getCell(coverageRow, 1).value === "Coverage") {
      ws.getRow(coverageRow).eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: FONT_NAME, size: 10, italic: true };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      });
    }
    if (coverageSentence) {
      const sentenceRow = layout.columnHeaderRow + table.length - 1;
      if (lastColumn > 1) {
        mergeSummaryNote(ws, sentenceRow, lastColumn, coverageSentence);
      } else {
        setSummaryCell(ws.getCell(sentenceRow, 1), coverageSentence, {
          italic: true,
        });
      }
    }
  }

  if (unassigned.length) {
    const headingRow = layout.columnHeaderRow + table.length + 1;
    ws.getCell(headingRow, 1).value = UNASSIGNED_SECTION_HEADING;
    ws.getCell(headingRow, 1).font = { name: FONT_NAME, size: 12, bold: true };
    if (lastColumn > 1) {
      mergeSummaryNote(ws, headingRow + 1, lastColumn, UNASSIGNED_SECTION_NOTE);
    } else {
      setSummaryCell(ws.getCell(headingRow + 1, 1), UNASSIGNED_SECTION_NOTE, {
        italic: true,
      });
    }

    const aoa = buildRentRollAoa({ columns: cols, rows: unassigned }).slice(
      0,
      unassigned.length + 1,
    );
    const unassignedHeaderRow = headingRow + 2;
    aoa.forEach((values, index) => {
      ws.getRow(unassignedHeaderRow + index).values = values.map((value) =>
        value === "" ? null : value,
      );
    });
    ws.getRow(unassignedHeaderRow).eachCell(
      { includeEmpty: true },
      (cell, columnNumber) => {
        const col = cols[columnNumber - 1];
        cell.font = { name: FONT_NAME, size: 10, bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HEADER_FILL },
        };
        cell.alignment = {
          horizontal: col && col.type === "number" ? "right" : "left",
          vertical: "middle",
          wrapText: true,
        };
      },
    );
    formatDataCells(ws, cols, unassigned, unassignedHeaderRow + 1);
  }

  return ws;
}

export function rentRollXlsxFilename(
  propertyName,
  asOf,
  { includeOneTime = false } = {},
) {
  const safe = String(propertyName || "Property").replace(/[^a-z0-9]+/gi, "-");
  const basis = includeOneTime ? "-with-one-time" : "";
  return `RentRoll-${safe}-${normalizeAsOf(asOf)}${basis}.xlsx`;
}

export async function exportRentRollXLSX({
  rows,
  columns,
  property,
  asOf,
  includeOneTime = false,
  chargeColumns,
  unassignedRows,
  noun,
} = {}) {
  const data = Array.isArray(rows) ? rows : [];
  const unassigned = Array.isArray(unassignedRows) ? unassignedRows : [];
  const ws = buildRentRollWorksheet({
    columns,
    rows: data,
    property,
    asOf,
    chargeColumns,
    unassignedRows: unassigned,
    noun,
  });
  const wbout = await ws.workbook.xlsx.writeBuffer();

  const filename = rentRollXlsxFilename(property && property.name, asOf, {
    includeOneTime,
  });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  try {
    await logExportEvent({
      datasetKey: "rent-roll:" + ((property && property.name) || ""),
      format: "xlsx",
      rowCount: data.length + unassigned.length,
      action: "completed",
    });
  } catch (_e) {}

  return { filename, rowCount: data.length + unassigned.length };
}
