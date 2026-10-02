import * as XLSX from "xlsx";

export const ITEMIZED_CATEGORIES = [
  "RentalIncome",
  "OtherIncome",
  "Utilities",
  "RepairsMaintenance",
  "Turnover",
  "ManagementFee",
  "MaintenancePayroll",
  "OfficePayroll",
  "PayrollCosts",
  "ContractServices",
  "AdvertisingMarketing",
  "Administrative",
  "InsuranceTax",
  "MortgageReserves",
  "CapExRepairs",
  "CapExImprovements",
  "CapExAdministrative",
  "CapExReimbursements",
  "AssetServicing",
  "Cash",
  "Prepaid",
  "AccruedLiabilities",
  "OtherCurrentLiabilities",
  "LongTermDebt",
];

export const FREQUENCY_VALUES = new Set([
  "Monthly",
  "BiMonthly",
  "Quarterly",
  "Quadrimester",
  "SemiAnnually",
  "Annually",
]);

export const FREQUENCY_MONTHS = Object.freeze({
  Monthly: 1,
  BiMonthly: 2,
  Quarterly: 3,
  Quadrimester: 4,
  SemiAnnually: 6,
  Annually: 12,
});

export const INCREASE_FREQUENCY_VALUES = new Set([
  ...FREQUENCY_VALUES,
  "Custom",
]);

export function frequencyMonths(frequency, intervalMonths) {
  if (frequency === "Custom") {
    const n = Number(intervalMonths);
    return Number.isInteger(n) && n >= 1 ? n : null;
  }
  return FREQUENCY_MONTHS[frequency] ?? null;
}

export const LEASE_LOG_SHEETS = [
  { sheet: "Fall 25 Lease Log", tag: "Fall25" },
  { sheet: "Spring 26 Lease Log", tag: "Spring26" },
  { sheet: "Summer 26 Lease Log", tag: "Summer26" },
  { sheet: "Fall 26 Lease Log", tag: "Fall26" },
  { sheet: "Spring 27 Lease Log", tag: "Spring27" },
  { sheet: "Summer 27 Lease Log", tag: "Summer27" },
];

const ITEMIZED_SHEET_NAME = "Income & Expenses";
const FINANCIALS_SHEET_NAME = "Financials";
const PROPERTY_DIRECTORY_SHEET_NAME = "Property Directory";
const COMP_SUMMARY_SHEET_NAME = "Comp Summary";
const RENT_ROLL_PQ_SHEET_NAME = "Rent Roll PQ";
const MONTHLY_NOI_SHEET_NAME = "Monthly NOI";
const BUDGET_ANALYSIS_SHEET_NAME = "Budget Analysis";

export const PARSED_SHEET_NAMES = Object.freeze([
  ITEMIZED_SHEET_NAME,
  FINANCIALS_SHEET_NAME,
  PROPERTY_DIRECTORY_SHEET_NAME,
  COMP_SUMMARY_SHEET_NAME,
  RENT_ROLL_PQ_SHEET_NAME,
  MONTHLY_NOI_SHEET_NAME,
  BUDGET_ANALYSIS_SHEET_NAME,
  ...LEASE_LOG_SHEETS.map(({ sheet }) => sheet),
]);

const PDPQ_KEY_TOKENS = [
  "expense",
  "income",
  "per bed",
  "per unit",
  "monthly",
  "accrual",
  "property type",
  "service",
  "insurance",
  "tax",
  "reserve",
  "allocation",
];
const PDPQ_MIN_HEADER_HITS = 3;
const PDPQ_HEADER_REPEAT_RATIO = 0.6;

const T12_KEY_LABEL = "per active beds";
const EXPENSE_HEADER_RE = /expense\s*$/i;
const T12_MIN_EXPENSE_HEADERS = 2;

function rowIsT12Header(row) {
  if (!Array.isArray(row)) return false;
  let hasKey = false;
  let expenseCols = 0;
  for (const cell of row) {
    if (lower(cell) === T12_KEY_LABEL) hasKey = true;
    const t = trimmed(cell);
    if (t && EXPENSE_HEADER_RE.test(t)) expenseCols++;
  }
  return hasKey && expenseCols >= T12_MIN_EXPENSE_HEADERS;
}

const ITEMIZED_COL = Object.freeze({
  lineDescription: 0,
  dataSource: 1,
  reference: 2,
  frequency: 3,
  firstMonth: 4,
  amount: 5,
  lastMonth: 6,
  adjustments: 7,
  function2: 8,
  growth: 9,
  activeBedsPct: 10,
  categoryLabel: 11,
  accountNumber: 12,
  lineDate: 13,
  noiBuildBucket: 14,
});

const ACTUAL_COL = Object.freeze({
  code: 0,
  accountNumber: 1,
  accountName: 2,
  transactionDate: 3,
  amount: 4,
  balance: 5,
  noiReturn: 6,
});

const LEASE_LOG_COL = Object.freeze({
  property: 0,
  v26PropertyCode: 1,
  propertyType: 2,
  oldUnit: 3,
  oldUnitBedspace: 4,
  spaceConfiguration: 5,
  avail: 6,
  currentStatus: 7,
  availableDate: 8,
  admin: 9,
  residentName: 10,
  leaseType: 11,
  offlineBackfill: 12,
  vacancyBackfill: 13,
  rentStatus: 14,
  market: 15,
  currentRent: 16,
  signedFullRate: 17,
  lossToLease: 18,
  leaseStartDate: 19,
  leaseEndDate: 20,
  leaseTerm: 21,
  securityDeposit: 22,
  applicationFees: 23,
  oneTimeConcession: 24,
  adminUnits: 25,
  utilityFee: 26,
  cam: 27,
  parking: 28,
  effectiveRent: 29,
  utilities: 30,
  effectiveLtl: 31,
  monthlyRecurring: 32,
  signed: 33,
});

const LEASE_LOG_SF_FIELDS = Object.freeze({
  common_sf: "common",
  bedspace_sf: "bedspace",
  bedroom_sf: "bedroom",
});

export const LEASE_LOG_SF_SCAN_END = 94;

export function resolveLeaseLogSfColumns(headerRow) {
  const row = Array.isArray(headerRow) ? headerRow : [];
  const out = { common_sf: null, bedspace_sf: null, bedroom_sf: null };
  const end = Math.min(row.length - 1, LEASE_LOG_SF_SCAN_END);
  for (let c = LEASE_LOG_MAPPED_COLUMNS; c <= end; c++) {
    const label = lower(row[c]);
    if (!label) continue;
    for (const [field, wanted] of Object.entries(LEASE_LOG_SF_FIELDS)) {
      if (out[field] === null && label === wanted) out[field] = c;
    }
  }
  return out;
}

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

function dateOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  let d = null;
  if (v instanceof Date) {
    d = v;
  } else if (typeof v === "number" && Number.isFinite(v)) {
    d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  } else if (typeof v === "string") {
    const s = v.trim();
    const looksLikeDate =
      /^\d{4}-\d{1,2}-\d{1,2}([T ]|$)/.test(s) ||
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s);
    if (looksLikeDate) {
      const t = Date.parse(s);
      if (Number.isFinite(t)) d = new Date(t);
    }
  }
  if (d === null || Number.isNaN(d.valueOf())) return null;
  const year = d.getUTCFullYear();
  if (year < 1900 || year > 2200) return null;
  return d.toISOString().slice(0, 10);
}

function frequencyOrNull(v) {
  const s = trimmed(v);
  if (!s) return null;
  return FREQUENCY_VALUES.has(s) ? s : null;
}

function isEmptyRow(row) {
  if (!Array.isArray(row) || row.length === 0) return true;
  return row.every(
    (cell) => cell === null || cell === undefined || cell === "",
  );
}

const CATEGORY_ALIASES = Object.freeze({
  "rental income": "RentalIncome",
  "other income": "OtherIncome",
  utilities: "Utilities",
  "repairs & maintenance": "RepairsMaintenance",
  "repairs and maintenance": "RepairsMaintenance",
  "turnover expenses": "Turnover",
  turnover: "Turnover",
  "management fees": "ManagementFee",
  "management fee": "ManagementFee",
  "maintenance & support": "MaintenancePayroll",
  "maintenance and support": "MaintenancePayroll",
  "maintenance payroll": "MaintenancePayroll",
  office: "OfficePayroll",
  "office payroll": "OfficePayroll",
  "employee costs": "PayrollCosts",
  "payroll costs": "PayrollCosts",
  "contracted services": "ContractServices",
  "contract services": "ContractServices",
  "advertising & marketing": "AdvertisingMarketing",
  "advertising and marketing": "AdvertisingMarketing",
  "administrative supplies & services": "Administrative",
  "administrative supplies and services": "Administrative",
  administrative: "Administrative",
  "insurance & tax": "InsuranceTax",
  "insurance and tax": "InsuranceTax",
  "mortgage & reserves": "MortgageReserves",
  "mortgage and reserves": "MortgageReserves",
  "capital replacements, repairs & maintenance": "CapExRepairs",
  "capital replacements, repairs and maintenance": "CapExRepairs",
  "capex repairs": "CapExRepairs",
  "capital improvements & projects": "CapExImprovements",
  "capital improvements and projects": "CapExImprovements",
  "capex improvements": "CapExImprovements",
  "administrative capital expenses": "CapExAdministrative",
  "capex administrative": "CapExAdministrative",
  "capital reimbursements": "CapExReimbursements",
  "capex reimbursements": "CapExReimbursements",
  "asset servicing": "AssetServicing",
  cash: "Cash",
  "prepaid expenses": "Prepaid",
  prepaid: "Prepaid",
  "accrued liabilities": "AccruedLiabilities",
  "other current liabilities": "OtherCurrentLiabilities",
  "long term debt": "LongTermDebt",
});

const CATEGORY_COLLAPSED_LOOKUP = (() => {
  const m = new Map();
  for (const canonical of ITEMIZED_CATEGORIES) {
    m.set(canonical.toLowerCase(), canonical);
  }
  return m;
})();

export function normalizeCategoryName(rawHeader) {
  const raw = trimmed(rawHeader);
  if (!raw) return null;
  const stripped = raw.replace(/_itemized$/i, "").trim();
  const aliasHit = CATEGORY_ALIASES[stripped.toLowerCase()];
  if (aliasHit) return aliasHit;
  const collapsed = stripped.replace(/\s+/g, "").toLowerCase();
  return CATEGORY_COLLAPSED_LOOKUP.get(collapsed) || null;
}

export function worksheetToRows(ws) {
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

export function findItemizedTables(ws) {
  const rows = worksheetToRows(ws);
  return findItemizedTablesFromRows(rows);
}

export function findItemizedTablesFromRows(rows) {
  const tables = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] || [];
    const isHeader =
      lower(row[ITEMIZED_COL.dataSource]) === "data source" &&
      lower(row[ITEMIZED_COL.frequency]) === "frequency";
    if (!isHeader) {
      i++;
      continue;
    }
    const category = normalizeCategoryName(row[ITEMIZED_COL.lineDescription]);
    const headerRowIndex = i;
    const dataRows = [];
    let j = i + 1;
    while (j < rows.length) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) break;
      const isNextHeader =
        lower(dataRow[ITEMIZED_COL.dataSource]) === "data source" &&
        lower(dataRow[ITEMIZED_COL.frequency]) === "frequency";
      if (isNextHeader) break;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
      j++;
    }
    if (category) {
      tables.push({ category, headerRowIndex, dataRows });
    }
    i = j;
  }
  return tables;
}

function textResidue(v) {
  if (numericOrNull(v) !== null) return null;
  return trimmed(v);
}

export function itemizedRowFromV26Row(category, row, sourceRowIndex) {
  return {
    category,
    line_description: trimmed(row[ITEMIZED_COL.lineDescription]),
    data_source: trimmed(row[ITEMIZED_COL.dataSource]),
    reference: trimmed(row[ITEMIZED_COL.reference]),
    frequency: frequencyOrNull(row[ITEMIZED_COL.frequency]),
    first_month: dateOrNull(row[ITEMIZED_COL.firstMonth]),
    amount: numericOrNull(row[ITEMIZED_COL.amount]),
    last_month: dateOrNull(row[ITEMIZED_COL.lastMonth]),
    adjustments: numericOrNull(row[ITEMIZED_COL.adjustments]),
    function_2: trimmed(row[ITEMIZED_COL.function2]),
    growth: numericOrNull(row[ITEMIZED_COL.growth]),
    active_beds_pct: numericOrNull(row[ITEMIZED_COL.activeBedsPct]),
    adjustments_text: textResidue(row[ITEMIZED_COL.adjustments]),
    growth_text: textResidue(row[ITEMIZED_COL.growth]),
    active_beds_pct_text: textResidue(row[ITEMIZED_COL.activeBedsPct]),
    category_label: trimmed(row[ITEMIZED_COL.categoryLabel]),
    account_number: trimmed(row[ITEMIZED_COL.accountNumber]),
    line_date: trimmed(row[ITEMIZED_COL.lineDate]),
    noi_build_bucket: trimmed(row[ITEMIZED_COL.noiBuildBucket]),
    source_row_index: sourceRowIndex,
  };
}

export function findActualTable(ws) {
  const rows = worksheetToRows(ws);
  return findActualTableFromRows(rows);
}

export function findActualTableFromRows(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (
      lower(row[0]) === "code" &&
      lower(row[1]) === "account number" &&
      lower(row[3]) === "date" &&
      lower(row[4]) === "amount"
    ) {
      const dataRows = [];
      let j = i + 1;
      while (j < rows.length) {
        const dataRow = rows[j] || [];
        if (isEmptyRow(dataRow)) break;
        if (lower(dataRow[0]) === "code") break;
        dataRows.push({ row: dataRow, sourceRowIndex: j });
        j++;
      }
      return { headerRowIndex: i, dataRows };
    }
  }
  return null;
}

export function actualRowFromV26Row(row, sourceRowIndex) {
  return {
    code: trimmed(row[ACTUAL_COL.code]),
    account_number: trimmed(row[ACTUAL_COL.accountNumber]),
    account_name: trimmed(row[ACTUAL_COL.accountName]),
    transaction_date: dateOrNull(row[ACTUAL_COL.transactionDate]),
    amount: numericOrNull(row[ACTUAL_COL.amount]),
    balance: numericOrNull(row[ACTUAL_COL.balance]),
    noi_return: trimmed(row[ACTUAL_COL.noiReturn]),
    source_row_index: sourceRowIndex,
  };
}

export function findAccountGroups(ws) {
  const rows = worksheetToRows(ws);
  return findAccountGroupsFromRows(rows);
}

export function findAccountGroupsFromRows(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    let usageCol = -1;
    for (let c = 0; c < row.length; c++) {
      if (lower(row[c]) === "usage") {
        usageCol = c;
        break;
      }
    }
    if (usageCol === -1) continue;

    const categoryCols = [];
    for (let c = usageCol + 1; c < row.length; c++) {
      const label = trimmed(row[c]);
      if (label) categoryCols.push({ col: c, label });
    }
    if (!categoryCols.length) continue;

    const dataRows = [];
    let j = i + 1;
    while (j < rows.length) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) break;
      if (lower(dataRow[usageCol]) === "usage") break;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
      j++;
    }
    return { headerRowIndex: i, usageCol, categoryCols, dataRows };
  }
  return null;
}

function splitAccountCell(cellValue) {
  const s = trimmed(cellValue);
  if (!s) return null;
  const m = s.match(/^\s*([0-9A-Z][0-9A-Z\-]*)\s+(.*)$/i);
  if (m) return { account_number: m[1], account_name: m[2].trim() };
  return { account_number: s, account_name: null };
}

export function emitAccountGroupsRows(header, row, sourceRowIndex) {
  const usageValue = trimmed(row[header.usageCol]);
  const out = [];
  for (const { col, label } of header.categoryCols) {
    const split = splitAccountCell(row[col]);
    if (!split) continue;
    out.push({
      account_number: split.account_number,
      account_name: split.account_name,
      noi_build_bucket: label,
      group_attributes: {
        usage: usageValue || null,
        source_column_label: label,
        raw_cell: trimmed(row[col]),
      },
      source_row_index: sourceRowIndex,
    });
  }
  return out;
}

export function findLeaseLog(ws, seasonTag) {
  const rows = worksheetToRows(ws);
  return findLeaseLogFromRows(rows, seasonTag);
}

export function findLeaseLogFromRows(rows, seasonTag) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (lower(row[LEASE_LOG_COL.property]) !== "property") continue;
    if (lower(row[LEASE_LOG_COL.v26PropertyCode]) !== "property code") continue;

    const dataRows = [];
    let j = i + 1;
    while (j < rows.length) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) break;
      if (lower(dataRow[LEASE_LOG_COL.property]) === "property") break;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
      j++;
    }
    return {
      seasonTag,
      headerRowIndex: i,
      dataRows,
      sfColumns: resolveLeaseLogSfColumns(row),
    };
  }
  return null;
}

export function leaseLogRowFromV26Row(
  seasonTag,
  row,
  sourceRowIndex,
  sfColumns,
) {
  const sf = sfColumns || {};
  const atColumn = (index) =>
    Number.isInteger(index) ? numericOrNull(row[index]) : null;
  return {
    season_tag: seasonTag,
    property: trimmed(row[LEASE_LOG_COL.property]),
    v26_property_code: trimmed(row[LEASE_LOG_COL.v26PropertyCode]),
    property_type: trimmed(row[LEASE_LOG_COL.propertyType]),
    old_unit: trimmed(row[LEASE_LOG_COL.oldUnit]),
    old_unit_bedspace: trimmed(row[LEASE_LOG_COL.oldUnitBedspace]),
    space_configuration: trimmed(row[LEASE_LOG_COL.spaceConfiguration]),
    avail: trimmed(row[LEASE_LOG_COL.avail]),
    current_status: trimmed(row[LEASE_LOG_COL.currentStatus]),
    available_date: dateOrNull(row[LEASE_LOG_COL.availableDate]),
    admin: trimmed(row[LEASE_LOG_COL.admin]),
    resident_name: trimmed(row[LEASE_LOG_COL.residentName]),
    lease_type: trimmed(row[LEASE_LOG_COL.leaseType]),
    offline_backfill: trimmed(row[LEASE_LOG_COL.offlineBackfill]),
    vacancy_backfill: trimmed(row[LEASE_LOG_COL.vacancyBackfill]),
    rent_status: trimmed(row[LEASE_LOG_COL.rentStatus]),
    market: numericOrNull(row[LEASE_LOG_COL.market]),
    current_rent: numericOrNull(row[LEASE_LOG_COL.currentRent]),
    signed_full_rate: numericOrNull(row[LEASE_LOG_COL.signedFullRate]),
    loss_to_lease: numericOrNull(row[LEASE_LOG_COL.lossToLease]),
    lease_start_date: dateOrNull(row[LEASE_LOG_COL.leaseStartDate]),
    lease_end_date: dateOrNull(row[LEASE_LOG_COL.leaseEndDate]),
    lease_term: trimmed(row[LEASE_LOG_COL.leaseTerm]),
    security_deposit: numericOrNull(row[LEASE_LOG_COL.securityDeposit]),
    application_fees: numericOrNull(row[LEASE_LOG_COL.applicationFees]),
    one_time_concession: numericOrNull(row[LEASE_LOG_COL.oneTimeConcession]),
    admin_units: trimmed(row[LEASE_LOG_COL.adminUnits]),
    utility_fee: numericOrNull(row[LEASE_LOG_COL.utilityFee]),
    cam: numericOrNull(row[LEASE_LOG_COL.cam]),
    parking: numericOrNull(row[LEASE_LOG_COL.parking]),
    effective_rent: numericOrNull(row[LEASE_LOG_COL.effectiveRent]),
    utilities: numericOrNull(row[LEASE_LOG_COL.utilities]),
    effective_ltl: numericOrNull(row[LEASE_LOG_COL.effectiveLtl]),
    monthly_recurring: numericOrNull(row[LEASE_LOG_COL.monthlyRecurring]),
    signed: trimmed(row[LEASE_LOG_COL.signed]),
    common_sf: atColumn(sf.common_sf),
    bedspace_sf: atColumn(sf.bedspace_sf),
    bedroom_sf: atColumn(sf.bedroom_sf),
    source_row_index: sourceRowIndex,
  };
}

export function findPdpq(ws) {
  const rows = worksheetToRows(ws);
  return findPdpqFromRows(rows);
}

function looksLikePdpqKey(s) {
  const v = lower(s);
  if (!v) return false;
  return PDPQ_KEY_TOKENS.some((t) => v.includes(t));
}

function rowRepeatsHeader(headerCols, row) {
  let matched = 0;
  let nonEmpty = 0;
  for (const { col, key } of headerCols) {
    const text = trimmed(row[col]);
    if (text === null) continue;
    nonEmpty++;
    if (lower(text) === lower(key)) matched++;
  }
  if (nonEmpty < PDPQ_MIN_HEADER_HITS) return false;
  return matched / nonEmpty >= PDPQ_HEADER_REPEAT_RATIO;
}

export function findPdpqFromRows(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (rowIsT12Header(row)) continue;
    const tokenHits = row.filter((cell) => looksLikePdpqKey(cell)).length;
    if (tokenHits < PDPQ_MIN_HEADER_HITS) continue;

    const cols = [];
    for (let c = 0; c < row.length; c++) {
      const key = trimmed(row[c]);
      if (key) cols.push({ col: c, key });
    }
    if (!cols.length) continue;

    const dataRows = [];
    let j = i + 1;
    while (j < rows.length) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) break;
      if (rowIsT12Header(dataRow)) break;
      if (rowRepeatsHeader(cols, dataRow)) break;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
      j++;
    }
    return { headerRowIndex: i, cols, dataRows };
  }
  return null;
}

export function emitPdpqRows(header, row, sourceRowIndex) {
  const out = [];
  for (const { col, key } of header.cols) {
    const text = trimmed(row[col]);
    const value = numericOrNull(row[col]);
    if (text === null && value === null) continue;
    out.push({
      assumption_key: key,
      assumption_value: value,
      assumption_text: text,
      period_date: dateOrNull(key),
      source_row_index: sourceRowIndex,
    });
  }
  return out;
}

const ACCOUNT_HEADER_RE = /^\d{5}$/;
const COMP_MIN_ACCOUNT_HEADERS = 3;

function looksLikeAccountHeader(s) {
  const v = trimmed(s);
  return v !== null && ACCOUNT_HEADER_RE.test(v);
}

export function findCompSummary(ws) {
  return findCompSummaryFromRows(worksheetToRows(ws));
}

export function findCompSummaryFromRows(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    let dateCol = -1;
    const accountCols = [];
    for (let c = 0; c < row.length; c++) {
      if (dateCol < 0 && lower(row[c]) === "date") {
        dateCol = c;
        continue;
      }
      if (looksLikeAccountHeader(row[c]))
        accountCols.push({ col: c, account: trimmed(row[c]) });
    }
    if (dateCol < 0 || accountCols.length < COMP_MIN_ACCOUNT_HEADERS) continue;

    const dataRows = [];
    let j = i + 1;
    while (j < rows.length) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) break;
      if (lower(dataRow[dateCol]) === "date") break;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
      j++;
    }
    return { headerRowIndex: i, dateCol, accountCols, dataRows };
  }
  return null;
}

export function emitMomcompRows(header, row, sourceRowIndex) {
  const period_date = dateOrNull(row[header.dateCol]);
  const out = [];
  for (const { col, account } of header.accountCols) {
    const text = trimmed(row[col]);
    const value = numericOrNull(row[col]);
    if (text === null && value === null) continue;
    out.push({
      account_number: account,
      period_date,
      comp_value: value,
      comp_text: text,
      allocation_metric: null,
      allocation_pct: null,
      source_row_index: sourceRowIndex,
    });
  }
  return out;
}

export function findT12Ratios(ws) {
  return findT12RatiosFromRows(worksheetToRows(ws));
}

export function findT12RatiosFromRows(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    let keyCol = -1;
    const expenseCols = [];
    for (let c = 0; c < row.length; c++) {
      if (keyCol < 0 && lower(row[c]) === T12_KEY_LABEL) {
        keyCol = c;
        continue;
      }
      const t = trimmed(row[c]);
      if (t && EXPENSE_HEADER_RE.test(t))
        expenseCols.push({ col: c, group: t });
    }
    if (keyCol < 0 || expenseCols.length < T12_MIN_EXPENSE_HEADERS) continue;

    const dataRows = [];
    let j = i + 1;
    while (j < rows.length) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) break;
      if (rowIsT12Header(dataRow)) break;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
      j++;
    }
    return { headerRowIndex: i, keyCol, expenseCols, dataRows };
  }
  return null;
}

const BUDGET_ANALYSIS_SCENARIO_LABEL_ROW = "noi build";

export function findBudgetAnalysisScenarios(ws) {
  return findBudgetAnalysisScenariosFromRows(worksheetToRows(ws));
}

export function findBudgetAnalysisScenariosFromRows(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const labelCol = row.findIndex(
      (cell) => lower(cell) === BUDGET_ANALYSIS_SCENARIO_LABEL_ROW,
    );
    if (labelCol < 0) continue;

    const scenarioCols = [];
    let gap = 0;
    for (let c = labelCol + 1; c < row.length; c++) {
      const cell = row[c];
      const text =
        cell instanceof Date || typeof cell === "number" ? null : trimmed(cell);
      if (text === null) {
        if (scenarioCols.length && ++gap >= 2) break;
        continue;
      }
      gap = 0;
      scenarioCols.push({ col: c, scenario: text });
    }
    if (!scenarioCols.length) continue;

    const dataRows = [];
    for (let j = 0; j < i; j++) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) continue;
      if (trimmed(dataRow[labelCol]) === null) continue;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
    }

    return { headerRowIndex: i, labelCol, scenarioCols, dataRows };
  }
  return null;
}

export function emitBudgetAnalysisScenarioRows(header, row, sourceRowIndex) {
  const metric_label = trimmed(row[header.labelCol]);
  const out = [];
  for (const { col, scenario } of header.scenarioCols) {
    const cell = row[col];
    const value = numericOrNull(cell);
    const text =
      cell instanceof Date ? cell.toISOString().slice(0, 10) : trimmed(cell);
    if (text === null && value === null) continue;
    out.push({
      scenario_label: scenario,
      metric_label,
      metric_value: value,
      metric_text: text,
      source_row_index: sourceRowIndex,
    });
  }
  return out;
}

export function emitT12RatioRows(header, row, sourceRowIndex) {
  const ratio_key = trimmed(row[header.keyCol]);
  const out = [];
  for (const { col, group } of header.expenseCols) {
    const text = trimmed(row[col]);
    const value = numericOrNull(row[col]);
    if (text === null && value === null) continue;
    out.push({
      basis: "per_active_bed",
      ratio_key,
      expense_group: group,
      rate_value: value,
      rate_text: text,
      period_date: null,
      source_row_index: sourceRowIndex,
    });
  }
  return out;
}

const MONTH_MATRIX_MIN_DATE_COLS = 6;

const RENT_ROLL_LABEL_HEADERS = ["income category"];
const MONTHLY_NOI_LABEL_HEADERS = ["date"];

export function findMonthMatrixFromRows(rows, labelHeaders) {
  const wanted = labelHeaders.map((h) => lower(h));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    let labelCol = -1;
    const dateCols = [];
    for (let c = 0; c < row.length; c++) {
      if (labelCol < 0 && wanted.includes(lower(row[c]))) {
        labelCol = c;
        continue;
      }
      const period_date = dateOrNull(row[c]);
      if (period_date) dateCols.push({ col: c, period_date });
    }
    if (labelCol < 0 || dateCols.length < MONTH_MATRIX_MIN_DATE_COLS) continue;

    const dataRows = [];
    let j = i + 1;
    while (j < rows.length) {
      const dataRow = rows[j] || [];
      if (isEmptyRow(dataRow)) break;
      if (wanted.includes(lower(dataRow[labelCol]))) break;
      dataRows.push({ row: dataRow, sourceRowIndex: j });
      j++;
    }
    return { headerRowIndex: i, labelCol, dateCols, dataRows };
  }
  return null;
}

export function findRentRollMatrix(ws) {
  return findMonthMatrixFromRows(worksheetToRows(ws), RENT_ROLL_LABEL_HEADERS);
}

export function findWorkbookMonthlyNoi(ws) {
  return findMonthMatrixFromRows(
    worksheetToRows(ws),
    MONTHLY_NOI_LABEL_HEADERS,
  );
}

const LEADING_ACCOUNT_RE = /^(\d{5})\b\s*(.*)$/;

export function splitAccountLabel(label) {
  const text = trimmed(label);
  if (text === null) return { account_number: null, label: null };
  const m = LEADING_ACCOUNT_RE.exec(text);
  if (!m) return { account_number: null, label: text };
  return { account_number: m[1], label: trimmed(m[2]) ?? text };
}

export function emitMonthMatrixRows(header, row, sourceRowIndex) {
  const { account_number, label } = splitAccountLabel(row[header.labelCol]);
  const out = [];
  if (label === null && account_number === null) return out;
  for (const { col, period_date } of header.dateCols) {
    const text = trimmed(row[col]);
    const value = numericOrNull(row[col]);
    if (text === null && value === null) continue;
    out.push({
      account_number,
      line_label: label,
      period_date,
      amount: value,
      amount_text: value === null ? text : null,
      source_row_index: sourceRowIndex,
    });
  }
  return out;
}

export const LEASE_LOG_MAPPED_COLUMNS = Object.keys(LEASE_LOG_COL).length;

const DIAG_LABEL_MAX = 80;
const DIAG_LIST_MAX = 50;

function diagLabel(s) {
  const raw = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.length > DIAG_LABEL_MAX ? `${raw.slice(0, DIAG_LABEL_MAX)}…` : raw;
}

function diagList(values) {
  const labels = values.map(diagLabel);
  if (labels.length <= DIAG_LIST_MAX) return labels;
  return [
    ...labels.slice(0, DIAG_LIST_MAX),
    `(+${labels.length - DIAG_LIST_MAX} more)`,
  ];
}

export function sheetInventory(workbook) {
  const sheets = workbook?.Sheets || {};
  const names =
    Array.isArray(workbook?.SheetNames) && workbook.SheetNames.length
      ? workbook.SheetNames
      : Object.keys(sheets);
  const parsedSet = new Set(PARSED_SHEET_NAMES);
  return {
    present: names,
    parsed: names.filter((n) => parsedSet.has(n)),
    unparsed: names.filter((n) => !parsedSet.has(n)),
    expected_absent: PARSED_SHEET_NAMES.filter((n) => !names.includes(n)),
  };
}

export function leaseLogWidthDiagnostic({ sheet, tag, rows, headerRowIndex }) {
  const allRows = rows || [];
  let maxRowLength = 0;
  let rowsWiderThanMap = 0;
  for (const row of allRows) {
    const len = Array.isArray(row) ? row.length : 0;
    if (len > maxRowLength) maxRowLength = len;
    if (len > LEASE_LOG_MAPPED_COLUMNS) rowsWiderThanMap++;
  }
  const headerRow = Number.isInteger(headerRowIndex)
    ? allRows[headerRowIndex] || []
    : [];
  const unmappedHeaders = [];
  for (let c = LEASE_LOG_MAPPED_COLUMNS; c < headerRow.length; c++) {
    const label = trimmed(headerRow[c]);
    if (label === null) continue;
    unmappedHeaders.push({ index: c, label: diagLabel(label) });
  }
  return {
    sheet,
    tag,
    header_row_index: Number.isInteger(headerRowIndex) ? headerRowIndex : null,
    max_row_length: maxRowLength,
    mapped_columns: LEASE_LOG_MAPPED_COLUMNS,
    columns_past_map: Math.max(0, maxRowLength - LEASE_LOG_MAPPED_COLUMNS),
    rows_wider_than_map: rowsWiderThanMap,
    unmapped_headers: unmappedHeaders.slice(0, DIAG_LIST_MAX),
    sf_columns: resolveLeaseLogSfColumns(headerRow),
  };
}

export function formatCoverageDiagnosticLines(diagnostics) {
  const d = diagnostics || {};
  const inv = d.sheets || {
    present: [],
    parsed: [],
    unparsed: [],
    expected_absent: [],
  };
  const lines = [];
  lines.push(
    `sheets: ${inv.present.length} present, ${inv.parsed.length} parsed` +
      ` | present=[${diagList(inv.present).join(", ")}]` +
      ` | parsed=[${diagList(inv.parsed).join(", ")}]`,
  );
  lines.push(
    inv.unparsed.length
      ? `sheets NOT parsed (${inv.unparsed.length}): [${diagList(inv.unparsed).join(", ")}]`
      : "sheets NOT parsed (0): every sheet in this workbook is read by an extractor",
  );
  if (inv.expected_absent.length) {
    lines.push(
      `expected sheets absent (${inv.expected_absent.length}):` +
        ` [${diagList(inv.expected_absent).join(", ")}]`,
    );
  }
  for (const w of d.lease_logs || []) {
    if (w.header_row_index === null) {
      lines.push(
        `lease log ${w.tag} (${diagLabel(w.sheet)}): no header row found, nothing measured`,
      );
      continue;
    }
    const headers = w.unmapped_headers.length
      ? w.unmapped_headers
          .map(({ index, label }) => `${index}='${label}'`)
          .join(", ")
      : "(none)";
    lines.push(
      `lease log ${w.tag} (${diagLabel(w.sheet)}): widest row ${w.max_row_length} cols` +
        ` vs map ${w.mapped_columns} -> ${w.columns_past_map} dropped,` +
        ` ${w.rows_wider_than_map} rows wider than the map;` +
        ` unmapped headers: ${headers}`,
    );
    const sf = w.sf_columns || {};
    lines.push(
      `lease log ${w.tag} (${diagLabel(w.sheet)}): size columns matched by label` +
        ` -> common_sf=${sf.common_sf ?? "not found"},` +
        ` bedspace_sf=${sf.bedspace_sf ?? "not found"},` +
        ` bedroom_sf=${sf.bedroom_sf ?? "not found"}` +
        ` (scan ${LEASE_LOG_MAPPED_COLUMNS}..${LEASE_LOG_SF_SCAN_END})`,
    );
  }
  return lines;
}

export function parseV26Workbook(workbook) {
  const sheets = workbook?.Sheets || {};

  const itemizedSheet = sheets[ITEMIZED_SHEET_NAME];
  const itemizedTables = itemizedSheet ? findItemizedTables(itemizedSheet) : [];
  const itemizedRows = [];
  const itemizedCountsByCategory = {};
  for (const table of itemizedTables) {
    itemizedCountsByCategory[table.category] =
      (itemizedCountsByCategory[table.category] || 0) + table.dataRows.length;
    for (const { row, sourceRowIndex } of table.dataRows) {
      itemizedRows.push(
        itemizedRowFromV26Row(table.category, row, sourceRowIndex),
      );
    }
  }

  const financialsSheet = sheets[FINANCIALS_SHEET_NAME];
  const actualTable = financialsSheet ? findActualTable(financialsSheet) : null;
  const actualRows = (actualTable?.dataRows || []).map(
    ({ row, sourceRowIndex }) => actualRowFromV26Row(row, sourceRowIndex),
  );

  const accountGroupsTable = financialsSheet
    ? findAccountGroups(financialsSheet)
    : null;
  const accountGroupRows = [];
  for (const { row, sourceRowIndex } of accountGroupsTable?.dataRows || []) {
    for (const emitted of emitAccountGroupsRows(
      accountGroupsTable,
      row,
      sourceRowIndex,
    )) {
      accountGroupRows.push(emitted);
    }
  }

  const leaseLogRows = [];
  const leaseLogCountsBySeason = {};
  const leaseLogWidths = [];
  for (const { sheet, tag } of LEASE_LOG_SHEETS) {
    const leaseSheet = sheets[sheet];
    if (!leaseSheet) {
      leaseLogCountsBySeason[tag] = 0;
      continue;
    }
    const sheetRows = worksheetToRows(leaseSheet);
    const log = findLeaseLogFromRows(sheetRows, tag);
    leaseLogWidths.push(
      leaseLogWidthDiagnostic({
        sheet,
        tag,
        rows: sheetRows,
        headerRowIndex: log ? log.headerRowIndex : null,
      }),
    );
    if (!log) {
      leaseLogCountsBySeason[tag] = 0;
      continue;
    }
    leaseLogCountsBySeason[tag] = log.dataRows.length;
    for (const { row, sourceRowIndex } of log.dataRows) {
      leaseLogRows.push(
        leaseLogRowFromV26Row(tag, row, sourceRowIndex, log.sfColumns),
      );
    }
  }

  const propertyDirectorySheet = sheets[PROPERTY_DIRECTORY_SHEET_NAME];
  const pdpqTable = propertyDirectorySheet
    ? findPdpq(propertyDirectorySheet)
    : null;
  const pdpqRows = [];
  for (const { row, sourceRowIndex } of pdpqTable?.dataRows || []) {
    for (const emitted of emitPdpqRows(pdpqTable, row, sourceRowIndex)) {
      pdpqRows.push(emitted);
    }
  }

  const compSummarySheet = sheets[COMP_SUMMARY_SHEET_NAME];
  const momcompTable = compSummarySheet
    ? findCompSummary(compSummarySheet)
    : null;
  const momcompRows = [];
  for (const { row, sourceRowIndex } of momcompTable?.dataRows || []) {
    for (const emitted of emitMomcompRows(momcompTable, row, sourceRowIndex)) {
      momcompRows.push(emitted);
    }
  }

  const t12Table = propertyDirectorySheet
    ? findT12Ratios(propertyDirectorySheet)
    : null;
  const t12RatioRows = [];
  for (const { row, sourceRowIndex } of t12Table?.dataRows || []) {
    for (const emitted of emitT12RatioRows(t12Table, row, sourceRowIndex)) {
      t12RatioRows.push(emitted);
    }
  }

  const rentRollSheet = sheets[RENT_ROLL_PQ_SHEET_NAME];
  const rentRollTable = rentRollSheet
    ? findRentRollMatrix(rentRollSheet)
    : null;
  const rentRollMatrixRows = [];
  for (const { row, sourceRowIndex } of rentRollTable?.dataRows || []) {
    for (const emitted of emitMonthMatrixRows(
      rentRollTable,
      row,
      sourceRowIndex,
    )) {
      rentRollMatrixRows.push(emitted);
    }
  }

  const monthlyNoiSheet = sheets[MONTHLY_NOI_SHEET_NAME];
  const monthlyNoiTable = monthlyNoiSheet
    ? findWorkbookMonthlyNoi(monthlyNoiSheet)
    : null;
  const workbookMonthlyNoiRows = [];
  for (const { row, sourceRowIndex } of monthlyNoiTable?.dataRows || []) {
    for (const emitted of emitMonthMatrixRows(
      monthlyNoiTable,
      row,
      sourceRowIndex,
    )) {
      workbookMonthlyNoiRows.push(emitted);
    }
  }

  const budgetAnalysisSheet = sheets[BUDGET_ANALYSIS_SHEET_NAME];
  const budgetAnalysisTable = budgetAnalysisSheet
    ? findBudgetAnalysisScenarios(budgetAnalysisSheet)
    : null;
  const budgetAnalysisScenarioRows = [];
  for (const { row, sourceRowIndex } of budgetAnalysisTable?.dataRows || []) {
    for (const emitted of emitBudgetAnalysisScenarioRows(
      budgetAnalysisTable,
      row,
      sourceRowIndex,
    )) {
      budgetAnalysisScenarioRows.push(emitted);
    }
  }

  return {
    itemized: itemizedRows,
    actual: actualRows,
    accountGroups: accountGroupRows,
    leaseLogs: leaseLogRows,
    pdpq: pdpqRows,
    momcomp: momcompRows,
    t12Ratios: t12RatioRows,
    rentRollMatrix: rentRollMatrixRows,
    workbookMonthlyNoi: workbookMonthlyNoiRows,
    budgetAnalysisScenario: budgetAnalysisScenarioRows,
    diagnostics: {
      sheets: sheetInventory(workbook),
      lease_logs: leaseLogWidths,
    },
    summary: {
      itemized: itemizedCountsByCategory,
      itemized_total: itemizedRows.length,
      actual: actualRows.length,
      account_groups: accountGroupRows.length,
      lease_logs: leaseLogCountsBySeason,
      lease_logs_total: leaseLogRows.length,
      pdpq: pdpqRows.length,
      momcomp: momcompRows.length,
      t12_ratios: t12RatioRows.length,
      rent_roll_matrix: rentRollMatrixRows.length,
      workbook_monthly_noi: workbookMonthlyNoiRows.length,
      budget_analysis_scenario: budgetAnalysisScenarioRows.length,
    },
  };
}
