import * as XLSX from "xlsx";
import {
  downloadCSV,
  generateHTMLReport,
  logExportEvent,
} from "../supabaseClient.js";
import { escapeHtml, csvGuard, fmtWhen } from "./changeLogFormat.js";

export const CHANGE_LOG_HEADERS = [
  "Change Type",
  "Property",
  "Entity",
  "Field",
  "Old Value",
  "New Value",
  "Changed By",
  "When (UTC)",
  "Source",
  "Why",
];

export const CHANGE_TYPE_LABELS = {
  assumption: "Budget Assumption",
  itemized: "Itemized Budget Edit",
  lease_adjustment: "Rent-Roll Adjustment",
  rent_roll_version: "Rent-Roll Version",
  budget_seal: "Budget Sealing",
  writeback: "Entrata Write-Back",
};

const EMPTY_MESSAGE = "No platform changes recorded in this range.";

function typeLabel(row) {
  return (
    row.change_type_label ||
    CHANGE_TYPE_LABELS[row.change_type] ||
    row.change_type ||
    ""
  );
}

function rowToCells(row) {
  return [
    typeLabel(row),
    row.property_label ?? "",
    row.entity ?? "",
    row.field ?? "",
    row.old_value ?? "",
    row.new_value ?? "",
    row.changed_by_label ?? "",
    fmtWhen(row.changed_at),
    row.source_ref ?? "",
    row.why ?? "",
  ];
}

function buildSummaryItems(rows) {
  const counts = {};
  for (const r of rows) {
    const k = r.change_type || "other";
    counts[k] = (counts[k] || 0) + 1;
  }
  const items = [{ label: "Total changes", value: String(rows.length) }];
  for (const k of Object.keys(CHANGE_TYPE_LABELS)) {
    if (counts[k])
      items.push({ label: CHANGE_TYPE_LABELS[k], value: String(counts[k]) });
  }
  return items;
}

function filterSummaryText(meta = {}) {
  const parts = [];
  parts.push(`Property: ${meta.propertyLabel || "All properties"}`);
  if (meta.startDate || meta.endDate) {
    parts.push(
      `Range: ${meta.startDate || "earliest"} to ${meta.endDate || "latest"}`,
    );
  } else {
    parts.push("Range: all dates");
  }
  const types =
    Array.isArray(meta.changeTypes) && meta.changeTypes.length
      ? meta.changeTypes.map((t) => CHANGE_TYPE_LABELS[t] || t).join(", ")
      : "All change types";
  parts.push(`Types: ${types}`);
  return parts.join("  ·  ");
}

function slug(s) {
  return (
    String(s || "")
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "all"
  );
}

function buildFilename(meta = {}, ext) {
  const prop = meta.propertyLabel ? slug(meta.propertyLabel) : "all-properties";
  const start = meta.startDate || "start";
  const end = meta.endDate || "end";
  return `change-log_${prop}_${start}_${end}.${ext}`;
}

async function logExport({ format, rowCount, durationMs, fileSizeBytes }) {
  try {
    await logExportEvent({
      datasetKey: "change_log",
      format,
      rowCount,
      durationMs,
      fileSizeBytes: fileSizeBytes || null,
    });
  } catch (_e) {}
}

function now() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : 0;
}

export async function exportChangeLogCSV(rows, meta = {}) {
  const t0 = now();
  const dataRows = rows.length
    ? rows.map((r) => rowToCells(r).map(csvGuard))
    : [[EMPTY_MESSAGE, ...Array(CHANGE_LOG_HEADERS.length - 1).fill("")]];
  const filename = buildFilename(meta, "csv");
  downloadCSV(filename, CHANGE_LOG_HEADERS, dataRows);
  await logExport({
    format: "csv",
    rowCount: rows.length,
    durationMs: Math.round(now() - t0),
  });
  return { filename, rowCount: rows.length };
}

export async function exportChangeLogXLSX(rows, meta = {}) {
  const t0 = now();
  const aoa = [
    ["Change Log"],
    [filterSummaryText(meta)],
    [
      `Generated ${fmtWhen(new Date().toISOString())} UTC · ${rows.length} change(s)`,
    ],
    [],
    CHANGE_LOG_HEADERS,
  ];
  if (rows.length) {
    for (const r of rows) aoa.push(rowToCells(r));
  } else {
    aoa.push([EMPTY_MESSAGE]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = CHANGE_LOG_HEADERS.map((h, i) => ({
    wch: i === 0 ? 18 : i >= 4 && i <= 5 ? 28 : 16,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Change Log");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildFilename(meta, "xlsx");
  a.click();
  URL.revokeObjectURL(url);
  await logExport({
    format: "xlsx",
    rowCount: rows.length,
    durationMs: Math.round(now() - t0),
    fileSizeBytes: wbout.byteLength || wbout.length || null,
  });
  return { rowCount: rows.length };
}

export async function exportChangeLogPDF(rows, meta = {}) {
  const t0 = now();
  const sections = [
    {
      type: "text",
      title: "Filters",
      content: escapeHtml(filterSummaryText(meta)),
    },
  ];
  if (rows.length) {
    sections.push({
      type: "metrics",
      title: "Summary",
      items: buildSummaryItems(rows).map((m) => ({
        label: escapeHtml(m.label),
        value: escapeHtml(m.value),
      })),
    });
    sections.push({
      type: "table",
      title: "Changes",
      headers: CHANGE_LOG_HEADERS.map(escapeHtml),
      rows: rows.map((r) => rowToCells(r).map(escapeHtml)),
    });
  } else {
    sections.push({
      type: "text",
      title: "Changes",
      content: escapeHtml(EMPTY_MESSAGE),
    });
  }
  generateHTMLReport({
    title: "Change Log",
    subtitle: escapeHtml(filterSummaryText(meta)),
    sections,
  });
  await logExport({
    format: "pdf",
    rowCount: rows.length,
    durationMs: Math.round(now() - t0),
  });
  return { rowCount: rows.length };
}
