import * as XLSX from "xlsx";

export const REFERENCE_WORKBOOK_KINDS = [
  "portfolio_tax_tracking",
  "entity_matrix",
];

export const WORKBOOK_KIND_TABLE = Object.freeze({
  portfolio_tax_tracking: "property_tax_assessment",
  entity_matrix: "entity_matrix",
});

const TAX_MASTER_SHEET = "Master";
const ENTITY_MATRIX_SHEET = "Matrix";

export const TAX_TYPES = ["SEC", "SUP", "FS", "Total"];

const TAX_HEADER_RE = /^(sec|sup|fs|total)\s+(\d{4}-\d{4})$/i;

export const ENTITY_MATRIX_COLUMNS = Object.freeze([
  { header: "LookUp", key: "lookup" },
  { header: "Status", key: "status" },
  { header: "Entrata ID", key: "entrata_id" },
  { header: "Entity", key: "entity" },
  { header: "Entity Code", key: "entity_code" },
  { header: "Property Code", key: "property_code" },
  { header: "Entrata Code", key: "entrata_code" },
  { header: "Entrata Name", key: "entrata_name" },
  { header: "Entity Owner", key: "entity_owner" },
  { header: "Entrata Property Owner", key: "entrata_property_owner" },
  { header: "Entrata Type", key: "entrata_type" },
  { header: "Property Type", key: "property_type" },
]);

function lower(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function trimmed(s) {
  if (s === undefined || s === null) return null;
  const out = String(s).trim();
  return out.length ? out : null;
}

function numericOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isEmptyRow(row) {
  if (!Array.isArray(row) || row.length === 0) return true;
  return row.every(
    (cell) => cell === null || cell === undefined || cell === "",
  );
}

function normalizeTaxType(rawPrefix) {
  switch (String(rawPrefix ?? "").toLowerCase()) {
    case "sec":
      return "SEC";
    case "sup":
      return "SUP";
    case "fs":
      return "FS";
    case "total":
      return "Total";
    default:
      return null;
  }
}

export function worksheetToRows(ws) {
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

export function parsePortfolioTaxTrackingFromRows(rows) {
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (lower(row[0]) === "property" && lower(row[1]) === "code") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      'Portfolio Tax Tracking "Master" sheet: header row (Property | Code | ...) not found.',
    );
  }

  const headerRow = rows[headerIdx] || [];
  const taxColumns = [];
  for (let c = 2; c < headerRow.length; c++) {
    const cell = trimmed(headerRow[c]);
    if (!cell) continue;
    const m = cell.match(TAX_HEADER_RE);
    if (m) {
      taxColumns.push({
        col: c,
        taxType: normalizeTaxType(m[1]),
        fiscalYear: m[2],
      });
    }
  }
  if (!taxColumns.length) {
    throw new Error(
      'Portfolio Tax Tracking "Master" sheet: no SEC/SUP/FS/Total year columns found in the header row.',
    );
  }

  const out = [];
  const properties = new Set();
  const fiscalYears = new Set();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isEmptyRow(row)) break;
    const propertyCode = trimmed(row[1]);
    if (!propertyCode) continue;
    const propertyName = trimmed(row[0]);
    properties.add(propertyCode);
    for (const { col, taxType, fiscalYear } of taxColumns) {
      fiscalYears.add(fiscalYear);
      out.push({
        property_code: propertyCode,
        property_name: propertyName,
        fiscal_year: fiscalYear,
        tax_type: taxType,
        amount: numericOrNull(row[col]),
        source_row_index: i,
      });
    }
  }

  return {
    rows: out,
    summary: {
      property_tax_assessment: out.length,
      properties: properties.size,
      fiscal_years: fiscalYears.size,
    },
  };
}

export function parsePortfolioTaxTracking(workbook) {
  const ws = workbook?.Sheets?.[TAX_MASTER_SHEET];
  if (!ws) {
    throw new Error(
      `Portfolio Tax Tracking workbook is missing the "${TAX_MASTER_SHEET}" sheet.`,
    );
  }
  return parsePortfolioTaxTrackingFromRows(worksheetToRows(ws));
}

export function parseEntityMatrixFromRows(rows) {
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (
      lower(row[0]) === "lookup" &&
      row.some((cell) => lower(cell) === "property code")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      'Entity Matrix "Matrix" sheet: header row (LookUp | ... | Property Code | ...) not found.',
    );
  }

  const headerRow = rows[headerIdx] || [];
  const colIndex = {};
  for (const { header, key } of ENTITY_MATRIX_COLUMNS) {
    const idx = headerRow.findIndex(
      (cell) => lower(cell) === header.toLowerCase(),
    );
    if (idx === -1) {
      throw new Error(
        `Entity Matrix "Matrix" sheet: expected mapping column "${header}" not found in the header row.`,
      );
    }
    colIndex[key] = idx;
  }

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isEmptyRow(row)) break;
    const rec = { source_row_index: i };
    for (const { key } of ENTITY_MATRIX_COLUMNS) {
      rec[key] = trimmed(row[colIndex[key]]);
    }
    if (!rec.entity && !rec.entity_code && !rec.entrata_id) continue;
    out.push(rec);
  }

  return {
    rows: out,
    summary: { entity_matrix: out.length },
  };
}

export function parseEntityMatrix(workbook) {
  const ws = workbook?.Sheets?.[ENTITY_MATRIX_SHEET];
  if (!ws) {
    throw new Error(
      `Entity Matrix workbook is missing the "${ENTITY_MATRIX_SHEET}" sheet.`,
    );
  }
  return parseEntityMatrixFromRows(worksheetToRows(ws));
}

export function parseReferenceWorkbook(workbook, workbookKind) {
  if (workbookKind === "portfolio_tax_tracking") {
    const parsed = parsePortfolioTaxTracking(workbook);
    return {
      workbook_kind: workbookKind,
      table: WORKBOOK_KIND_TABLE.portfolio_tax_tracking,
      rows: parsed.rows,
      summary: parsed.summary,
    };
  }
  if (workbookKind === "entity_matrix") {
    const parsed = parseEntityMatrix(workbook);
    return {
      workbook_kind: workbookKind,
      table: WORKBOOK_KIND_TABLE.entity_matrix,
      rows: parsed.rows,
      summary: parsed.summary,
    };
  }
  throw new Error(
    `Unknown workbook_kind: ${workbookKind ?? "(missing)"}. Expected one of: ${REFERENCE_WORKBOOK_KINDS.join(", ")}.`,
  );
}
