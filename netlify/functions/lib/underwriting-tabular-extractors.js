import * as XLSX from "xlsx";
import {
  findCanonicalRanges,
  domainTagsForUnitType,
} from "./underwriting-model-intelligence.js";

const EXCLUDED_SHEET_RE = /^claude\b|\bclaude\s*\(|^cim\s*uw$|\(cim\s*uw\)$/i;
const PRIOR_VERSION_SHEET_RE =
  /\(\s*prior\s*q\s*\)|\(\s*cim\s*uw\s*\)|\(\s*lender\s*\)|\bv2\b|\(\s*v2\s*\)|\bold\b|\bprior\b/i;

const DEFAULT_TABULAR_INSERT_BATCH_SIZE = 500;

const DEFAULT_HEADER_LOOKAHEAD_ROWS = 6;

const DEFAULT_BLANK_RUN_END = 2;

const TABLE_DEFAULT_SOURCE_SYSTEM = {
  property_underwriting_unit_mix: "model",
  property_underwriting_waterfall_tiers: "model",
  property_underwriting_investor_classes: "model",
  property_underwriting_debt_schedule: "model",
  property_underwriting_capex_schedule: "model",
  property_underwriting_monthly_noi: "model",
  property_underwriting_budget_lines: "entrata",
  property_underwriting_closing_statement_lines: "document:term_sheet",
  property_underwriting_rent_comps: "model",
  property_underwriting_sale_comps: "model",
  property_underwriting_permit_history: "model",
  property_underwriting_cost_seg_categories: "model",
};

export function extractorContext({ graphId, orgId, propertyId, sourceFileId }) {
  if (!graphId) throw new Error("extractorContext: graphId required");
  if (!orgId) throw new Error("extractorContext: orgId required");
  if (!propertyId) throw new Error("extractorContext: propertyId required");
  return Object.freeze({
    graphId,
    orgId,
    propertyId,
    sourceFileId: sourceFileId || null,
    ingestTimestamp: new Date().toISOString(),
  });
}

export function cellToValue(cell) {
  if (!cell) return { raw: null, text: null, num: null, date: null };
  const v = cell.v;
  if (v === undefined || v === null || v === "") {
    return { raw: null, text: null, num: null, date: null };
  }
  if (v instanceof Date) {
    return {
      raw: v,
      text: null,
      num: null,
      date: v.toISOString().slice(0, 10),
    };
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v))
      return { raw: v, text: null, num: null, date: null };
    return { raw: v, text: null, num: v, date: null };
  }
  if (typeof v === "boolean") {
    return { raw: v, text: v ? "true" : "false", num: v ? 1 : 0, date: null };
  }
  const s = String(v).trim();
  if (!s) return { raw: v, text: null, num: null, date: null };
  const numLike = /^-?\s*\$?\s*-?\d[\d,]*\.?\d*\s*%?$/.test(s);
  if (numLike) {
    const cleaned = s.replace(/[\$,\s]/g, "").replace(/%$/, "");
    const n = Number(cleaned);
    if (Number.isFinite(n)) {
      return {
        raw: v,
        text: s,
        num: s.endsWith("%") ? n / 100 : n,
        date: null,
      };
    }
  }
  return { raw: v, text: s.slice(0, 2000), num: null, date: null };
}

function readCell(ws, addr) {
  if (!ws) return cellToValue(null);
  return cellToValue(ws[addr]);
}

function cellText(ws, r, c) {
  if (!ws) return null;
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (!cell || cell.v === undefined || cell.v === null) return null;
  const s = typeof cell.v === "string" ? cell.v : String(cell.v);
  const trimmed = s.trim();
  return trimmed || null;
}

function cellNumber(ws, r, c) {
  if (!ws) return null;
  const addr = XLSX.utils.encode_cell({ r, c });
  const cv = cellToValue(ws[addr]);
  return cv.num;
}

function buildRangeA1(sheetName, r0, c0, r1, c1) {
  const tl = XLSX.utils.encode_cell({ r: r0, c: c0 });
  const br = XLSX.utils.encode_cell({ r: r1, c: c1 });
  const needsQuote = /[^A-Za-z0-9_]/.test(sheetName);
  const qname = needsQuote ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
  return `${qname}!${tl}:${br}`;
}

function pickSheets(workbook, sheetRe) {
  const primary = [];
  const fallback = [];
  for (const name of workbook.SheetNames) {
    if (EXCLUDED_SHEET_RE.test(name)) continue;
    if (!sheetRe.test(name)) continue;
    if (PRIOR_VERSION_SHEET_RE.test(name)) fallback.push(name);
    else primary.push(name);
  }
  return [...primary, ...fallback];
}

export function findSection(workbook, sheetRe, sectionRe) {
  for (const sheetName of pickSheets(workbook, sheetRe)) {
    const hit = findSectionOnSheet(workbook, sheetName, sectionRe);
    if (hit) return { sheet: sheetName, ...hit };
  }
  return null;
}

export function findAllSections(workbook, sheetRe, sectionRe) {
  const results = [];
  for (const sheetName of pickSheets(workbook, sheetRe)) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const t = cellText(ws, r, c);
        if (!t) continue;
        if (t.length > 200) continue;
        if (sectionRe.test(t)) {
          results.push({ sheet: sheetName, row: r, col: c, label: t });
        }
      }
    }
  }
  return results;
}

function findSectionOnSheet(workbook, sheetName, sectionRe) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return null;
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const t = cellText(ws, r, c);
      if (!t || t.length > 200) continue;
      if (sectionRe.test(t)) return { row: r, col: c, label: t };
    }
  }
  return null;
}

export function findColumnHeaders(
  workbook,
  sheetName,
  startRow,
  colPatterns,
  maxRowsBelow = DEFAULT_HEADER_LOOKAHEAD_ROWS,
  { anchorCol = null, scanWidth = 30 } = {},
) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return null;
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const lookaheadEnd = Math.min(range.e.r, startRow + maxRowsBelow);
  const scanC0 = anchorCol != null ? Math.max(range.s.c, anchorCol) : range.s.c;
  const scanC1 =
    anchorCol != null ? Math.min(range.e.c, anchorCol + scanWidth) : range.e.c;

  let bestRow = -1;
  let bestScore = 0;
  let bestMap = null;
  let bestBounds = null;

  for (let r = startRow; r <= lookaheadEnd; r++) {
    const map = {};
    let firstHitCol = null;
    let lastHitCol = null;
    for (let c = scanC0; c <= scanC1; c++) {
      const t = cellText(ws, r, c);
      if (!t || t.length > 80) continue;
      for (const [key, re] of Object.entries(colPatterns)) {
        if (map[key] != null) continue;
        if (re.test(t)) {
          map[key] = c;
          if (firstHitCol == null || c < firstHitCol) firstHitCol = c;
          if (lastHitCol == null || c > lastHitCol) lastHitCol = c;
          break;
        }
      }
    }
    const score = Object.keys(map).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
      bestMap = map;
      bestBounds = { startCol: firstHitCol, endCol: lastHitCol };
    }
  }

  if (bestRow < 0 || bestScore === 0) return null;
  return { headerRow: bestRow, columnMap: bestMap, headerBounds: bestBounds };
}

export function iterateDataRows(
  workbook,
  sheetName,
  dataStartRow,
  columnMap,
  {
    skipLabels = [],
    endMarkers = [],
    maxBlankRun = DEFAULT_BLANK_RUN_END,
    labelCol = null,
    maxRows = 400,
  } = {},
) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const cols = Object.values(columnMap).filter((v) => v != null);
  if (!cols.length) return [];
  const minCol = Math.min(...cols);
  const effLabelCol = labelCol != null ? labelCol : minCol;

  const results = [];
  let blankRun = 0;
  for (
    let r = dataStartRow;
    r <= range.e.r && r < dataStartRow + maxRows;
    r++
  ) {
    const values = {};
    let anyValue = false;
    for (const [key, c] of Object.entries(columnMap)) {
      if (c == null) {
        values[key] = null;
        continue;
      }
      const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c })]);
      values[key] = cv;
      if (cv.raw != null) anyValue = true;
    }
    const labelText = cellText(ws, r, effLabelCol);

    if (!labelText && !anyValue) {
      blankRun += 1;
      if (blankRun >= maxBlankRun) break;
      continue;
    }
    blankRun = 0;

    if (labelText && endMarkers.some((re) => re.test(labelText))) break;
    if (labelText && skipLabels.some((re) => re.test(labelText))) continue;

    results.push({ row: r, values, labelText });
  }
  return results;
}

export function normalizeUnitType(raw) {
  if (!raw)
    return { unit_type_base: null, rent_control_tier: null, is_bmr: false };
  const s = String(raw).trim();
  const tierMatch = s.match(/\b(RC[123]|BMR|RTL)\b/i);
  const tier = tierMatch ? tierMatch[1].toUpperCase() : null;
  const base = tier
    ? s.replace(tierMatch[0], "").replace(/\s+/g, " ").trim()
    : s;
  return {
    unit_type_base: base || null,
    rent_control_tier: tier,
    is_bmr: tier === "BMR",
  };
}

const CAPEX_CATEGORY_PATTERNS = [
  [
    "capex_interior_renovation",
    /interior\s*(reno|renovation)|unit\s*interior/i,
  ],
  [
    "capex_exterior_renovation",
    /exterior\s*(reno|renovation)|building\s*exterior/i,
  ],
  ["capex_common_area", /common\s*area/i],
  [
    "capex_mechanical_electrical_plumbing",
    /\bmep\b|mechanical.*electrical.*plumbing|plumbing|hvac/i,
  ],
  ["capex_building_systems", /building\s*systems?|roof/i],
  [
    "capex_soft_costs",
    /soft\s*costs?|architect|\bgc\s*fee\b|permits?|engineering/i,
  ],
  ["capex_contingency", /contingency/i],
  ["capex_appliances", /appliance(s)?|range|refrigerator|dishwasher/i],
  ["capex_kitchen", /kitchen\s*(reno|upgrade|cabinet|countertop)?/i],
  ["capex_bath", /bath(room)?\s*(reno|upgrade|tile|fixture)?/i],
  ["capex_flooring", /flooring|carpet|lvt|\btile\b/i],
  ["capex_windows", /windows?|glazing/i],
  [
    "capex_landscape_hardscape",
    /landscape\s*\/\s*hardscape|hardscaping|site\s*work/i,
  ],
  ["capex_elevator", /elevator\s*(modernization|reno|replace)?/i],
  ["capex_life_safety", /life\s*safety|fire\s*sprinkler|alarm\s*system/i],
  ["capex_per_unit", /capex\s*\/\s*unit|capex\s*per\s*unit/i],
];

function normalizeCapexCategory(label) {
  if (!label) return null;
  for (const [key, re] of CAPEX_CATEGORY_PATTERNS) {
    if (re.test(label)) return key;
  }
  return null;
}

const CLOSING_CATEGORY_PATTERNS = [
  ["closing_cost_lender_legal", /lender\s*legal|lender('?s)?\s*counsel/i],
  [
    "closing_cost_legal",
    /legal(?!.*lender)|(acquisition|acq)\s*legal|counsel/i,
  ],
  ["closing_cost_title", /title(\s*insurance)?|clta|alta/i],
  ["closing_cost_escrow", /escrow(\s*fees?)?/i],
  ["closing_cost_recording", /recording\s*(fees?)?/i],
  [
    "closing_cost_transfer_tax",
    /transfer\s*tax|county\s*transfer|city\s*transfer/i,
  ],
  ["closing_cost_prorations", /proration(s)?/i],
  ["closing_cost_due_diligence", /due\s*diligence|\bdd\b|inspection/i],
  [
    "closing_cost_financing_fees",
    /financing\s*fees?|loan\s*fees?|origination\s*fees?|points/i,
  ],
  ["closing_cost_survey", /survey/i],
  ["closing_cost_environmental", /environmental|phase\s*i|phase\s*ii|esa/i],
  ["closing_cost_appraisal", /appraisal/i],
  [
    "closing_cost_acquisition_fee",
    /acquisition\s*fee|acq\s*fee|sponsor\s*fee/i,
  ],
  ["closing_cost_rate_cap", /rate\s*cap(?!\s*strike)/i],
  ["closing_cost_swap", /\bswap\b|\binterest\s*rate\s*swap\b/i],
  ["closing_cost_zoning", /zoning\s*(study|report|opinion)?/i],
  [
    "closing_cost_insurance_binder",
    /insurance\s*binder|insurance\s*premium\s*at\s*close/i,
  ],
  ["closing_cost_other", /other\s*closing|misc.*closing|other\s*costs?/i],
];

function normalizeClosingCategory(label) {
  if (!label) return "uncategorized";
  for (const [key, re] of CLOSING_CATEGORY_PATTERNS) {
    if (re.test(label)) return key;
  }
  return "uncategorized";
}

const COST_SEG_CATEGORY_PATTERNS = [
  [
    "personal_property_5yr",
    /personal\s*property.*5|5[-\s]*year.*personal|\b5\s*yr\b.*property/i,
  ],
  [
    "personal_property_7yr",
    /personal\s*property.*7|7[-\s]*year.*personal|\b7\s*yr\b.*property/i,
  ],
  ["land_improvements_15yr", /land\s*improvement|15[-\s]*year|\b15\s*yr\b/i],
  [
    "building_27_5yr",
    /building.*27\.?5|27\.?5[-\s]*year|residential.*building/i,
  ],
  [
    "building_39yr",
    /building.*39|39[-\s]*year|commercial.*building|non[-\s]*residential/i,
  ],
  ["land", /^\s*land\s*$|land\s*(basis|value|cost)/i],
  ["bonus_depreciation_eligible", /bonus\s*depreciation/i],
];

function normalizeCostSegCategory(label) {
  if (!label) return "other";
  for (const [key, re] of COST_SEG_CATEGORY_PATTERNS) {
    if (re.test(label)) return key;
  }
  return "other";
}

const MONTHLY_NOI_CATEGORY_PATTERNS = [
  [
    "gpr",
    /gross\s*potential\s*rent|\bgpr\b|gross\s*scheduled\s*rent|potential\s*rent/i,
  ],
  [
    "vacancy",
    /vacancy|loss[\s-]to[\s-]lease|concession|bad\s*debt|credit\s*loss/i,
  ],
  [
    "oinc",
    /other\s*income|oinc|ancillary|laundry|parking|pet\s*fee|rubs|utility\s*reimb|reimbursement|application\s*fee|late\s*fee/i,
  ],
  ["egi", /effective\s*gross\s*income|\begi\b|total\s*revenue|total\s*income/i],
  [
    "debt_service",
    /debt\s*service|interest\s*expense|principal\s*payment|\bp&i\b/i,
  ],
  ["noi", /\bnoi\b|net\s*operating\s*income/i],
  [
    "cashflow_before_tax",
    /cash\s*flow\s*(before|from)?(\s*tax)?|\bcfbt\b|levered\s*cash/i,
  ],
  ["retail", /\brtl\b|retail\s*(income|rent|gpr)/i],
  [
    "opex",
    /operating\s*expense|\bopex\b|total\s*expense|payroll|utilities|repairs|taxes|insurance|management\s*fee/i,
  ],
];

function normalizeMonthlyNOICategory(label) {
  if (!label) return "other";
  for (const [key, re] of MONTHLY_NOI_CATEGORY_PATTERNS) {
    if (re.test(label)) return key;
  }
  return "other";
}

function inferDebtTranche(sheetName) {
  const s = sheetName.toLowerCase();
  if (/refi/.test(s)) return "senior";
  if (/bridge/.test(s)) return "bridge";
  if (/mezz/.test(s)) return "mezz";
  if (/construction/.test(s)) return "construction";
  if (/pref[\s_-]*equity|\bpe\b/.test(s)) return "pref_equity";
  if (/ltl|long[\s-]*term[\s-]*loan/.test(s)) return "senior";
  if (/senior|loan/.test(s)) return "senior";
  return "senior";
}

export function logExtractorDiag(extractor, rowCount, warnings = []) {
  const warnStr = warnings.length ? ` warnings=${warnings.length}` : "";
  console.log(`[tabular:${extractor}] rows=${rowCount}${warnStr}`);
  if (warnings.length) {
    for (const w of warnings.slice(0, 5)) {
      console.log(`[tabular:${extractor}]   warn: ${String(w).slice(0, 200)}`);
    }
  }
}

function tagProvenance(
  rows,
  ctx,
  { source_sheet, source_cell_range, source_system, source_detail },
) {
  return rows.map((row) => ({
    property_id: ctx.propertyId,
    org_id: ctx.orgId,
    graph_id: ctx.graphId,
    source_sheet,
    source_cell_range,
    source_system,
    source_detail,
    ...row,
  }));
}

function emptyResult(extractorName, note) {
  return {
    rows: [],
    warnings: [],
    diag: {
      extractor: extractorName,
      sections_found: 0,
      rows_parsed: 0,
      rows_skipped: 0,
      note: note || null,
    },
  };
}

const UNIT_MIX_SKIP_LABELS = [
  /^total$/i,
  /^subtotal$/i,
  /^grand\s*total$/i,
  /^wtd\s*avg$/i,
  /^weighted\s*avg/i,
  /^total\s*\/\s*wtd\s*avg$/i,
  /^note\b/i,
  /^n\.?b\.?\b/i,
  /^footnote\b/i,
  /^includes?\b/i,
  /^rc$/i,
  /^rtl$/i,
  /^bmr$/i,
  /^adu$/i,
  /^market$/i,
  /^-+$/,
  /^—+$/,
  /^N\/A$/i,
  /^wa\s+based\s+on/i,
  /^based\s+on\s+units/i,
];

const UNIT_MIX_COL_PATTERNS = {
  unit_type: /occupancy\s*type|unit\s*type|^type\b/i,

  unit_count: /^units$|^#\s*units?$|^total\s*units?$|^unit\s*count$/i,

  beds_per_unit: /^beds?$|^bedrooms?$|^br$/i,
  baths_per_unit: /^baths?$|^bathrooms?$|^ba$/i,

  rent_current:
    /current\s*rent|in[-\s]*place\s*rent|rent\s*current|^\$\s*\/\s*month$|^monthly\s*rent$|^rent\s*\(\s*current\s*\)/i,

  rent_pro_forma:
    /pro[-\s]*forma\s*rent|stabilized\s*rent|market\s*rent|proforma\s*rent|pro[-\s]*forma\s*\$\s*\/\s*month/i,

  rent_per_sf:
    /^\$\s*\/\s*sq?\s*\.?\s*ft\.?$|^\$\s*\/\s*sf$|rent\s*\/\s*sf|rent\s*psf/i,

  sf_per_unit: /^sf$|^size$|^sq\.?\s*ft\.?$|^square\s*feet$/i,

  mix_pct: /mix\s*%|%\s*of\s*total|mix\s*pct|%\s*mix/i,
  unit_config: /^config(uration)?$|single\s*\/\s*double/i,
};

function colLetterToNum(col) {
  let n = 0;
  for (const ch of String(col).toUpperCase())
    n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function buildUnitMixRowFromDataRow(dr, sectionTag) {
  const rawType = dr.values.unit_type?.text || dr.labelText;
  if (!rawType) return null;

  const hasNumeric = [
    "unit_count",
    "beds_per_unit",
    "sf_per_unit",
    "rent_current",
    "rent_pro_forma",
    "rent_per_sf",
  ].some((k) => dr.values[k]?.num != null);
  if (!hasNumeric) return null;

  const explicitUnitCount = dr.values.unit_count?.num;
  const unitCount = explicitUnitCount != null ? explicitUnitCount : 1;

  const rentCurrent = dr.values.rent_current?.num;
  const rentPF = dr.values.rent_pro_forma?.num;
  const isPlaceholder =
    (unitCount == null || unitCount <= 0) &&
    (rentCurrent == null || rentCurrent <= 0) &&
    (rentPF == null || rentPF <= 0);
  if (isPlaceholder) return null;

  const norm = normalizeUnitType(rawType);
  const tags = domainTagsForUnitType(rawType);

  let outRentCurrent, outRentProForma;
  if (sectionTag === "stabilized") {
    outRentCurrent = null;
    outRentProForma = rentCurrent ?? rentPF ?? null;
  } else {
    outRentCurrent = rentCurrent ?? null;
    outRentProForma = rentPF ?? null;
  }

  return {
    section: sectionTag,
    unit_type: rawType,
    unit_count: unitCount != null ? Math.round(unitCount) : null,
    beds_per_unit:
      dr.values.beds_per_unit?.num != null
        ? Math.round(dr.values.beds_per_unit.num)
        : null,
    sf_per_unit:
      dr.values.sf_per_unit?.num != null
        ? Math.round(dr.values.sf_per_unit.num)
        : null,
    rent_current: outRentCurrent,
    rent_pro_forma: outRentProForma,
    rent_per_sf: dr.values.rent_per_sf?.num ?? null,
    mix_pct: dr.values.mix_pct?.num ?? null,
    rent_control_tier: norm.rent_control_tier,
    is_bmr: Boolean(norm.is_bmr || tags.is_bmr),
    unit_config: dr.values.unit_config?.text || null,
    _workbook_row: dr.row != null ? dr.row : null,
    _domain_tags: {
      is_rent_controlled: tags.is_rent_controlled,
      renovation_cycle: tags.renovation_cycle,
      is_adu: tags.is_adu,
      is_bmr: Boolean(norm.is_bmr || tags.is_bmr),
      unit_class: tags.unit_class,
    },
  };
}

const UNIT_TYPE_LEAD_TOKEN_RE =
  /^\s*(?:\d+\s*x\s*\d+|studio|jr\.?|junior|adu|townhouse|loft|penthouse|ph\d?|garden|garage|retail|commercial|rtl|bmr|market|micro|loft\b|den\b|alcove)/i;

function findUnitTypeLabelColumns(
  workbook,
  sheetName,
  { maxBlankGap = 1, minHits = 3 } = {},
) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const candidates = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let runStart = -1,
      runEnd = -1,
      runHits = 0,
      blankGap = 0;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const t = cellText(ws, r, c);
      const trimmed = t ? String(t).trim() : "";
      const isHit =
        trimmed.length > 0 &&
        trimmed.length <= 40 &&
        UNIT_TYPE_LEAD_TOKEN_RE.test(trimmed);
      if (isHit) {
        if (runStart === -1) runStart = r;
        runEnd = r;
        runHits += 1;
        blankGap = 0;
      } else if (runStart !== -1) {
        blankGap += 1;
        if (blankGap > maxBlankGap) {
          if (runHits >= minHits) {
            candidates.push({
              sheet: sheetName,
              labelCol: c,
              startRow: runStart,
              endRow: runEnd,
              hits: runHits,
            });
          }
          runStart = -1;
          runEnd = -1;
          runHits = 0;
          blankGap = 0;
        }
      }
    }
    if (runStart !== -1 && runHits >= minHits) {
      candidates.push({
        sheet: sheetName,
        labelCol: c,
        startRow: runStart,
        endRow: runEnd,
        hits: runHits,
      });
    }
  }
  candidates.sort((a, b) => b.hits - a.hits);
  return candidates;
}

function tryExtractUnitMixAtLabelColumn(
  workbook,
  ctx,
  cand,
  method,
  sectionTag = "existing",
) {
  const headerSearchStart = Math.max(0, cand.startRow - 5);
  const headerLookahead = Math.min(7, cand.startRow + 1);
  const anchorCol =
    sectionTag === "stabilized"
      ? Math.max(0, cand.labelCol - 8)
      : cand.labelCol;
  const scanWidth = sectionTag === "stabilized" ? 18 : 15;
  const headers = findColumnHeaders(
    workbook,
    cand.sheet,
    headerSearchStart,
    UNIT_MIX_COL_PATTERNS,
    headerLookahead,
    { anchorCol, scanWidth },
  );
  if (!headers) return null;
  if (
    Object.keys(headers.columnMap).filter((k) => k !== "unit_type").length < 1
  )
    return null;

  const dataStart = cand.startRow;
  const maxRows = Math.max(5, cand.endRow - cand.startRow + 1 + 5);
  const dataRows = iterateDataRows(
    workbook,
    cand.sheet,
    dataStart,
    headers.columnMap,
    {
      skipLabels: UNIT_MIX_SKIP_LABELS,
      maxBlankRun: 2,
      maxRows,
      labelCol: cand.labelCol,
    },
  );
  if (!dataRows.length) return null;

  const builtRows = [];
  let rowsSkipped = 0;
  for (const dr of dataRows) {
    const built = buildUnitMixRowFromDataRow(dr, sectionTag);
    if (!built) {
      rowsSkipped += 1;
      continue;
    }
    builtRows.push(built);
  }
  if (!builtRows.length) return null;

  const typeCounts = new Map();
  for (const r of builtRows) {
    const k = String(r.unit_type).trim().toLowerCase();
    typeCounts.set(k, (typeCounts.get(k) || 0) + 1);
  }
  const isPerUnitTable = Array.from(typeCounts.values()).some((c) => c > 1);

  let sectionRows;
  if (isPerUnitTable) {
    sectionRows = builtRows;
  } else {
    sectionRows = [];
    const seen = new Map();
    for (const built of builtRows) {
      const dedupeKey = String(built.unit_type).trim().toLowerCase();
      if (seen.has(dedupeKey)) {
        const existingIdx = seen.get(dedupeKey);
        const prev = sectionRows[existingIdx];
        if ((built.unit_count ?? 0) <= (prev.unit_count ?? 0)) {
          rowsSkipped += 1;
          continue;
        }
        sectionRows.splice(existingIdx, 1);
      }
      seen.set(dedupeKey, sectionRows.length);
      sectionRows.push(built);
    }
  }
  if (!sectionRows.length) return null;

  const domainTagsPerRow = sectionRows.map((r) => r._domain_tags);
  const workbookRowPerRow = sectionRows.map((r) => r._workbook_row);
  const persistableRows = sectionRows.map(
    ({ _domain_tags: _dt, _workbook_row: _wr, ...rest }) => rest,
  );

  const lastDataRow0Indexed = dataRows[dataRows.length - 1].row;
  const dataCols = Object.values(headers.columnMap).filter((v) => v != null);
  const minCol = Math.min(cand.labelCol, ...dataCols);
  const maxCol = Math.max(cand.labelCol, ...dataCols);
  const startCellA1 = `${XLSX.utils.encode_col(minCol)}${dataStart + 1}`;
  const endCellA1 = `${XLSX.utils.encode_col(maxCol)}${lastDataRow0Indexed + 1}`;
  const cellRange = `${startCellA1}:${endCellA1}`;

  const NUMERIC_FIELDS = [
    "beds_per_unit",
    "sf_per_unit",
    "rent_current",
    "rent_pro_forma",
    "rent_per_sf",
  ];
  let totalPopulatedFields = 0;
  for (const r of sectionRows) {
    for (const k of NUMERIC_FIELDS) {
      if (r[k] != null) totalPopulatedFields += 1;
    }
  }
  const fieldDensity =
    sectionRows.length > 0 ? totalPopulatedFields / sectionRows.length : 0;
  const score = sectionRows.length * (1 + fieldDensity * 5);

  const headerColMap = {};
  for (const [k, v] of Object.entries(headers.columnMap)) {
    if (v != null) headerColMap[k] = XLSX.utils.encode_col(v);
  }

  const tagged = tagProvenance(persistableRows, ctx, {
    source_sheet: cand.sheet,
    source_cell_range: cellRange,
    source_system: TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_unit_mix,
    source_detail: {
      extractor: "extractUnitMix",
      method,
      label_column: XLSX.utils.encode_col(cand.labelCol),
      label_hits: cand.hits,
      header_row: headers.headerRow,
      header_col_map: headerColMap,
      score: Number(score.toFixed(2)),
      field_density: Number(fieldDensity.toFixed(3)),
      domain_tags_per_row: domainTagsPerRow,
    },
  });

  for (let i = 0; i < tagged.length; i++) {
    if (
      tagged[i].source_detail &&
      typeof tagged[i].source_detail === "object"
    ) {
      tagged[i].source_detail = {
        ...tagged[i].source_detail,
        workbook_row: workbookRowPerRow[i],
        section_tag: sectionTag,
      };
    }
  }

  return {
    score,
    rows: tagged,
    warnings: [],
    diag: {
      extractor: "extractUnitMix",
      method,
      sheet: cand.sheet,
      label_column: XLSX.utils.encode_col(cand.labelCol),
      label_hits: cand.hits,
      cell_range: cellRange,
      header_row: headers.headerRow,
      header_col_map: headerColMap,
      rows_parsed: tagged.length,
      rows_skipped: rowsSkipped,
      total_populated_fields: totalPopulatedFields,
      field_density: Number(fieldDensity.toFixed(3)),
      score: Number(score.toFixed(2)),
    },
  };
}

async function tryCanonicalUnitMix(graph, workbook, ctx) {
  const candidateSheets = workbook.SheetNames.filter((n) =>
    /^(assumptions?|unit\s*mix)$/i.test(n),
  );
  if (!candidateSheets.length) return null;

  const labelCandidates = [];
  for (const sheet of candidateSheets) {
    const cands = findUnitTypeLabelColumns(workbook, sheet);
    labelCandidates.push(...cands);
  }
  labelCandidates.sort((a, b) => b.hits - a.hits || a.startRow - b.startRow);

  const evaluated = [];
  for (const cand of labelCandidates) {
    const result = tryExtractUnitMixAtLabelColumn(
      workbook,
      ctx,
      cand,
      "pattern_scan",
    );
    if (result && result.rows.length > 0) {
      evaluated.push(result);
    } else {
      evaluated.push({
        score: 0,
        rows: [],
        warnings: [],
        diag: {
          extractor: "extractUnitMix",
          method: "pattern_scan",
          sheet: cand.sheet,
          label_column: XLSX.utils.encode_col(cand.labelCol),
          label_hits: cand.hits,
          rejected: "no extractable rows",
          score: 0,
        },
      });
    }
  }

  evaluated.sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = evaluated[0];
  if (best && best.rows.length > 0 && (best.diag.field_density ?? 0) >= 0.5) {
    const primaryLabelColIdx =
      labelCandidates.find(
        (c) =>
          XLSX.utils.encode_col(c.labelCol) === best.diag.label_column &&
          c.sheet === best.diag.sheet,
      )?.labelCol ?? -1;
    const stabilizedCandidate = labelCandidates.find(
      (c) =>
        c.sheet === best.diag.sheet &&
        c.labelCol > primaryLabelColIdx &&
        Math.abs(
          c.startRow -
            (best.diag.cell_range
              ? parseInt(
                  best.diag.cell_range.split(":")[0].match(/\d+$/)?.[0] || "0",
                  10,
                ) - 1
              : 0),
        ) <= 5,
    );
    let stabilizedResult = null;
    if (stabilizedCandidate) {
      stabilizedResult = tryExtractUnitMixAtLabelColumn(
        workbook,
        ctx,
        stabilizedCandidate,
        "pattern_scan",
        "stabilized",
      );
      if (
        !stabilizedResult ||
        (stabilizedResult.score || 0) < (best.score || 0) * 0.3
      ) {
        stabilizedResult = null;
      }
    }

    const mergedRows =
      stabilizedResult && stabilizedResult.rows.length > 0
        ? [...best.rows, ...stabilizedResult.rows]
        : best.rows;

    const candidatesSummary = evaluated.slice(0, 8).map((e) => ({
      sheet: e.diag.sheet,
      label_column: e.diag.label_column,
      label_hits: e.diag.label_hits,
      score: e.diag.score,
      rows: e.diag.rows_parsed || 0,
      density: e.diag.field_density || 0,
      rejected: e.diag.rejected,
    }));
    mergedRows.forEach((r) => {
      if (!r.source_detail) return;
      r.source_detail.candidates_considered = evaluated.length;
      r.source_detail.candidate_scores = candidatesSummary;
      if (stabilizedResult && stabilizedResult.rows.length > 0) {
        r.source_detail.has_stabilized_section = true;
      }
    });

    best.diag.candidates_considered = evaluated.length;
    best.diag.candidate_scores = candidatesSummary;
    if (stabilizedResult && stabilizedResult.rows.length > 0) {
      best.diag.stabilized = {
        sheet: stabilizedResult.diag.sheet,
        label_column: stabilizedResult.diag.label_column,
        cell_range: stabilizedResult.diag.cell_range,
        rows_parsed: stabilizedResult.diag.rows_parsed,
        score: stabilizedResult.diag.score,
        field_density: stabilizedResult.diag.field_density,
      };
      best.diag.rows_parsed = mergedRows.length;
    }
    best.rows = mergedRows;
    return best;
  }

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return null;
  if (!graph.edges.length) return null;

  const allRanges = [];
  for (const sheet of candidateSheets) {
    const ranges = findCanonicalRanges(graph, {
      sheet,
      minIncoming: 1,
      minCellCount: 6,
      maxRowGap: 2,
      maxColGap: 0,
    });
    const tableShaped = ranges.filter((r) => {
      const rowCount = r.endRow - r.startRow + 1;
      const colCount =
        colLetterToNum(r.endCol) - colLetterToNum(r.startCol) + 1;
      return rowCount >= 4 && colCount >= 2;
    });
    allRanges.push(...tableShaped);
  }
  if (!allRanges.length) return null;

  allRanges.sort(
    (a, b) => b.cellCount - a.cellCount || b.totalIncoming - a.totalIncoming,
  );

  for (const range of allRanges) {
    const startColNum = colLetterToNum(range.startCol);
    const endColNum = colLetterToNum(range.endCol);
    const leftScanCol0Indexed = Math.max(0, startColNum - 1 - 6);
    const scanWidth = endColNum - 1 - leftScanCol0Indexed + 4;

    const headerSearchStart = Math.max(0, range.startRow - 7);
    const headerLookahead = Math.min(8, range.startRow);
    const headers = findColumnHeaders(
      workbook,
      range.sheet,
      headerSearchStart,
      UNIT_MIX_COL_PATTERNS,
      headerLookahead,
      { anchorCol: leftScanCol0Indexed, scanWidth },
    );
    if (!headers) continue;
    if (Object.keys(headers.columnMap).length < 2) continue;
    if (
      headers.columnMap.unit_type == null &&
      headers.columnMap.unit_count == null
    )
      continue;

    const dataStart = headers.headerRow + 1;
    const canonicalEndRow0Indexed = range.endRow - 1;
    const maxRows = Math.max(5, canonicalEndRow0Indexed - dataStart + 5);
    const dataRows = iterateDataRows(
      workbook,
      range.sheet,
      dataStart,
      headers.columnMap,
      {
        skipLabels: UNIT_MIX_SKIP_LABELS,
        maxBlankRun: 2,
        maxRows,
        labelCol: headers.columnMap.unit_type ?? headers.headerBounds.startCol,
      },
    );
    if (!dataRows.length) continue;

    const builtRows = [];
    let rowsSkipped = 0;
    for (const dr of dataRows) {
      const built = buildUnitMixRowFromDataRow(dr, sectionTag);
      if (!built) {
        rowsSkipped += 1;
        continue;
      }
      builtRows.push(built);
    }
    if (!builtRows.length) continue;

    const typeCounts = new Map();
    for (const r of builtRows) {
      const k = String(r.unit_type).trim().toLowerCase();
      typeCounts.set(k, (typeCounts.get(k) || 0) + 1);
    }
    const isPerUnitTable = Array.from(typeCounts.values()).some((c) => c > 1);

    let sectionRows;
    if (isPerUnitTable) {
      sectionRows = builtRows;
    } else {
      sectionRows = [];
      const seen = new Map();
      for (const built of builtRows) {
        const dedupeKey = String(built.unit_type).trim().toLowerCase();
        if (seen.has(dedupeKey)) {
          const existingIdx = seen.get(dedupeKey);
          const prev = sectionRows[existingIdx];
          if ((built.unit_count ?? 0) <= (prev.unit_count ?? 0)) {
            rowsSkipped += 1;
            continue;
          }
          sectionRows.splice(existingIdx, 1);
        }
        seen.set(dedupeKey, sectionRows.length);
        sectionRows.push(built);
      }
    }
    if (!sectionRows.length) continue;

    const domainTagsPerRow = sectionRows.map((r) => r._domain_tags);
    const workbookRowPerRow = sectionRows.map((r) => r._workbook_row);
    const persistableRows = sectionRows.map(
      ({ _domain_tags: _dt, _workbook_row: _wr, ...rest }) => rest,
    );

    const cellRange = `${range.startCell}:${range.endCell}`;
    const tagged = tagProvenance(persistableRows, ctx, {
      source_sheet: range.sheet,
      source_cell_range: cellRange,
      source_system: TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_unit_mix,
      source_detail: {
        extractor: "extractUnitMix",
        method: "canonical_range",
        canonical_range: `${range.sheet}!${cellRange}`,
        canonical_total_incoming: range.totalIncoming,
        canonical_cell_count: range.cellCount,
        header_row: headers.headerRow,
        domain_tags_per_row: domainTagsPerRow,
      },
    });

    for (let i = 0; i < tagged.length; i++) {
      if (
        tagged[i].source_detail &&
        typeof tagged[i].source_detail === "object"
      ) {
        tagged[i].source_detail = {
          ...tagged[i].source_detail,
          workbook_row: workbookRowPerRow[i],
          section_tag: tagged[i].section || "existing",
        };
      }
    }

    return {
      rows: tagged,
      warnings: [],
      diag: {
        extractor: "extractUnitMix",
        method: "canonical_range",
        canonical_range: `${range.sheet}!${cellRange}`,
        canonical_total_incoming: range.totalIncoming,
        canonical_cell_count: range.cellCount,
        rows_parsed: tagged.length,
        rows_skipped: rowsSkipped,
      },
    };
  }

  return null;
}

export async function extractUnitMix(graph, workbook, ctx) {
  const canonical = await tryCanonicalUnitMix(graph, workbook, ctx);
  if (canonical && canonical.rows && canonical.rows.length > 0) {
    logExtractorDiag(
      "extractUnitMix",
      canonical.rows.length,
      canonical.warnings,
    );
    return canonical;
  }
  return await extractUnitMixViaSectionHeaders(graph, workbook, ctx);
}

async function extractUnitMixViaSectionHeaders(graph, workbook, ctx) {
  const extractorName = "extractUnitMix";
  const rows = [];
  const warnings = [];
  let rowsSkipped = 0;

  const sheetRe = /^(assumptions?|unit\s*mix)$/i;
  const sectionRe =
    /unit\s*breakdown\s*[-–]\s*(existing|stabilized)|^unit\s*mix$/i;
  const sections = findAllSections(workbook, sheetRe, sectionRe);

  if (!sections.length) {
    return emptyResult(extractorName, "no unit-breakdown sections found");
  }

  const colPatterns = {
    unit_type: /unit\s*type|type\b/i,
    unit_count: /^units?$|^#\s*units?$|count/i,
    beds_per_unit: /^beds?$|bedrooms?/i,
    sf_per_unit: /^sf$|sq\.?\s*ft|square\s*feet/i,
    rent_current: /current\s*rent|in[-\s]*place\s*rent|rent\s*current/i,
    rent_pro_forma:
      /pro[-\s]*forma\s*rent|stabilized\s*rent|market\s*rent|proforma\s*rent/i,
    rent_per_sf: /rent\s*\/\s*sf|rent\s*psf|\$\s*\/\s*sf/i,
    mix_pct: /mix\s*%|%\s*of\s*total|mix\s*pct|%\s*mix/i,
    unit_config: /config(uration)?|single\s*\/\s*double/i,
  };

  for (const sec of sections) {
    const sectionTag = /stabilized/i.test(sec.label)
      ? "stabilized"
      : /existing/i.test(sec.label)
        ? "existing"
        : "existing";

    const headers = findColumnHeaders(
      workbook,
      sec.sheet,
      sec.row + 1,
      colPatterns,
      5,
      {
        anchorCol: sec.col,
        scanWidth: 40,
      },
    );
    if (!headers) {
      warnings.push(
        `unit-mix section "${sec.label}" on ${sec.sheet}: no column headers found within 5 rows`,
      );
      continue;
    }

    const dataStart = headers.headerRow + 1;
    const dataRows = iterateDataRows(
      workbook,
      sec.sheet,
      dataStart,
      headers.columnMap,
      {
        skipLabels: UNIT_MIX_SKIP_LABELS,
        endMarkers: [/unit\s*breakdown\s*[-–]\s*(existing|stabilized)/i],
        maxBlankRun: 2,
        labelCol: headers.columnMap.unit_type ?? headers.headerBounds.startCol,
      },
    );

    const sectionRows = [];
    let lastRow = headers.headerRow;
    const seenInSection = new Map();
    for (const dr of dataRows) {
      lastRow = dr.row;
      const rawType = dr.values.unit_type?.text || dr.labelText;
      if (!rawType) {
        rowsSkipped += 1;
        continue;
      }
      const hasNumeric = [
        "unit_count",
        "beds_per_unit",
        "sf_per_unit",
        "rent_current",
        "rent_pro_forma",
        "rent_per_sf",
      ].some((k) => dr.values[k]?.num != null);
      if (!hasNumeric) {
        rowsSkipped += 1;
        continue;
      }

      const unitCount = dr.values.unit_count?.num;
      const rentCurrent = dr.values.rent_current?.num;
      const rentPF = dr.values.rent_pro_forma?.num;
      const isPlaceholder =
        (unitCount == null || unitCount <= 0) &&
        (rentCurrent == null || rentCurrent <= 0) &&
        (rentPF == null || rentPF <= 0);
      if (isPlaceholder) {
        rowsSkipped += 1;
        continue;
      }

      const norm = normalizeUnitType(rawType);

      const dedupeKey = String(rawType).trim().toLowerCase();
      if (seenInSection.has(dedupeKey)) {
        const existingIdx = seenInSection.get(dedupeKey);
        const existing = sectionRows[existingIdx];
        const existingCount = existing.unit_count ?? 0;
        const newCount = unitCount ?? 0;
        if (newCount <= existingCount) {
          rowsSkipped += 1;
          continue;
        }
        sectionRows.splice(existingIdx, 1);
      }
      seenInSection.set(dedupeKey, sectionRows.length);
      sectionRows.push({
        section: sectionTag,
        unit_type: rawType,
        unit_count:
          dr.values.unit_count?.num != null
            ? Math.round(dr.values.unit_count.num)
            : null,
        beds_per_unit:
          dr.values.beds_per_unit?.num != null
            ? Math.round(dr.values.beds_per_unit.num)
            : null,
        sf_per_unit:
          dr.values.sf_per_unit?.num != null
            ? Math.round(dr.values.sf_per_unit.num)
            : null,
        rent_current: dr.values.rent_current?.num ?? null,
        rent_pro_forma: dr.values.rent_pro_forma?.num ?? null,
        rent_per_sf: dr.values.rent_per_sf?.num ?? null,
        mix_pct: dr.values.mix_pct?.num ?? null,
        rent_control_tier: norm.rent_control_tier,
        is_bmr: norm.is_bmr,
        unit_config: dr.values.unit_config?.text || null,
      });
    }

    const cellRange = buildRangeA1(
      sec.sheet,
      sec.row,
      sec.col,
      lastRow,
      headers.headerBounds.endCol != null
        ? headers.headerBounds.endCol + 2
        : sec.col + 10,
    );
    const tagged = tagProvenance(sectionRows, ctx, {
      source_sheet: sec.sheet,
      source_cell_range: cellRange,
      source_system: TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_unit_mix,
      source_detail: {
        extractor: extractorName,
        section: sectionTag,
        section_header: sec.label,
        header_row: headers.headerRow,
      },
    });
    rows.push(...tagged);
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sections.length,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractWaterfallTiers(graph, workbook, ctx) {
  const extractorName = "extractWaterfallTiers";
  const rows = [];
  const warnings = [];

  const sheetRe = /partnership|returns\s*summary|waterfall/i;
  const tierLabelRe =
    /pref(erred)?\s*return|hurdle\s*\d+|^tier\s*\d+|catch[\s-]?up/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no partnership/waterfall sheet");

  let sectionsFound = 0;

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const tierRows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 8); c++) {
        const t = cellText(ws, r, c);
        if (!t || t.length > 120) continue;
        if (tierLabelRe.test(t)) {
          tierRows.push({ row: r, col: c, label: t });
          break;
        }
      }
    }
    if (!tierRows.length) continue;
    sectionsFound += 1;

    for (const tr of tierRows) {
      const label = tr.label;
      let tierNumber = null;
      let tierName = label;
      if (/pref(erred)?\s*return/i.test(label)) {
        tierNumber = 0;
        tierName = "Pref";
      } else {
        const m = label.match(/(?:hurdle|tier)\s*(\d+)/i);
        if (m) {
          tierNumber = parseInt(m[1], 10);
          tierName = `Hurdle ${tierNumber}`;
        } else if (/catch[\s-]?up/i.test(label)) {
          tierNumber = -2;
          tierName = "Catchup";
        } else {
          tierNumber = -1;
          tierName = label.slice(0, 60);
        }
      }

      const numerics = [];
      for (let c = tr.col + 1; c <= Math.min(range.e.c, tr.col + 25); c++) {
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r: tr.row, c })]);
        if (cv.num != null) numerics.push({ col: c, value: cv.num });
      }

      let hurdle_irr_pct = null;
      let hurdle_em = null;
      const splitValues = [];
      for (const { value } of numerics) {
        if (hurdle_irr_pct == null && value > 0 && value < 0.5) {
          hurdle_irr_pct = value;
          continue;
        }
        if (hurdle_em == null && value > 1 && value < 10) {
          hurdle_em = value;
          continue;
        }
        if (value >= 0 && value <= 1.01) splitValues.push(value);
      }

      const splits = {
        investor_a_split_pct: splitValues[0] ?? null,
        investor_b_split_pct: splitValues[1] ?? null,
        sponsor_split_pct: splitValues[2] ?? null,
        coinvest_split_pct: splitValues[3] ?? null,
      };

      const nonNull = Object.values(splits).filter((v) => v != null);
      let extractionWarning = null;
      if (nonNull.length >= 2) {
        const sum = nonNull.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1.0) > 0.01) {
          extractionWarning = `splits sum to ${sum.toFixed(4)} (expected 1.0 ±0.01)`;
          warnings.push(
            `${sheetName} row ${tr.row} (${label}): ${extractionWarning}`,
          );
        }
      }

      let catchup_provision_pct = null;
      if (/catch[\s-]?up/i.test(label) && splitValues.length >= 1) {
        catchup_provision_pct = splitValues[0];
      }

      const splitVals = Object.values(splits);
      const hasIrr = hurdle_irr_pct != null && hurdle_irr_pct > 0;
      const hasEm = hurdle_em != null && hurdle_em > 0;
      const hasNonZeroSplit = splitVals.some((v) => v != null && v > 0);
      if (!hasIrr && !hasEm && !hasNonZeroSplit) continue;

      const rangeStr = buildRangeA1(
        sheetName,
        tr.row,
        tr.col,
        tr.row,
        tr.col + 25,
      );
      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        tier_number: tierNumber,
        tier_name: tierName,
        hurdle_irr_pct,
        hurdle_em,
        ...splits,
        catchup_provision_pct,
        description: label.slice(0, 200),
        extraction_warning: extractionWarning,
        source_sheet: sheetName,
        source_cell_range: rangeStr,
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_waterfall_tiers,
        source_detail: {
          extractor: extractorName,
          header_row: tr.row,
          label_col: tr.col,
        },
      });
    }
  }

  const dedupedRows = [];
  const seenTier = new Map();
  for (const row of rows) {
    const tn = row.tier_number;
    if (tn === -1 || tn === -2 || tn == null) {
      dedupedRows.push(row);
      continue;
    }
    if (!seenTier.has(tn)) {
      seenTier.set(tn, dedupedRows.length);
      dedupedRows.push(row);
      continue;
    }
    const idx = seenTier.get(tn);
    const existing = dedupedRows[idx];
    const merged = { ...existing };
    for (const k of [
      "hurdle_irr_pct",
      "hurdle_em",
      "investor_a_split_pct",
      "investor_b_split_pct",
      "sponsor_split_pct",
      "coinvest_split_pct",
      "catchup_provision_pct",
    ]) {
      if (
        (merged[k] == null || merged[k] === 0) &&
        row[k] != null &&
        row[k] !== 0
      ) {
        merged[k] = row[k];
      }
    }
    dedupedRows[idx] = merged;
  }
  rows.splice(0, rows.length, ...dedupedRows);

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: 0,
    },
  };
}

const INVESTOR_LABEL_RE =
  /^(investor\s*[A-Ca-c]|sponsor|co[\s-]?invest(or)?)\b/i;

function mapInvestorCode(label) {
  const l = label.toLowerCase();
  if (/sponsor/.test(l)) return "sponsor";
  if (/co[\s-]?invest/.test(l)) return "coinvest";
  const m = l.match(/investor\s*([a-c])/);
  if (m) return m[1];
  return null;
}

export async function extractInvestorClasses(graph, workbook, ctx) {
  const extractorName = "extractInvestorClasses";
  const rows = [];
  const warnings = [];
  const sheetRe = /partnership|investor|financing\s*overview|sheet2/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no partnership/investor sheet");

  const seen = new Set();
  let sectionsFound = 0;
  let priorityRank = 1;

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const labelRows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 8); c++) {
        const t = cellText(ws, r, c);
        if (!t) continue;
        if (INVESTOR_LABEL_RE.test(t)) {
          labelRows.push({ row: r, col: c, label: t });
          break;
        }
      }
    }
    if (!labelRows.length) continue;
    sectionsFound += 1;

    const firstRow = labelRows[0].row;
    const colPatterns = {
      total_commitment: /commitment|committed\s*capital/i,
      initial_contribution:
        /initial\s*contribution|first\s*contribution|day\s*1/i,
      preferred_return_pct: /pref(erred)?\s*(rate|return)|\bpref\b/i,
      promote_share_pct: /promote|gp\s*promote/i,
    };
    const headers = findColumnHeaders(
      workbook,
      sheetName,
      Math.max(range.s.r, firstRow - 6),
      colPatterns,
      12,
      {
        anchorCol: labelRows[0].col,
        scanWidth: 30,
      },
    );

    for (const lr of labelRows) {
      const code = mapInvestorCode(lr.label);
      if (!code) continue;
      const dedupeKey = `${code}\x00${sheetName}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const existingForCode = rows.find((r) => r.investor_class_code === code);
      if (existingForCode) continue;

      let total_commitment = null;
      let initial_contribution = null;
      let preferred_return_pct = null;
      let promote_share_pct = null;
      if (headers) {
        if (headers.columnMap.total_commitment != null)
          total_commitment = cellNumber(
            ws,
            lr.row,
            headers.columnMap.total_commitment,
          );
        if (headers.columnMap.initial_contribution != null)
          initial_contribution = cellNumber(
            ws,
            lr.row,
            headers.columnMap.initial_contribution,
          );
        if (headers.columnMap.preferred_return_pct != null)
          preferred_return_pct = cellNumber(
            ws,
            lr.row,
            headers.columnMap.preferred_return_pct,
          );
        if (headers.columnMap.promote_share_pct != null)
          promote_share_pct = cellNumber(
            ws,
            lr.row,
            headers.columnMap.promote_share_pct,
          );
      }

      if (total_commitment == null) {
        for (let c = lr.col + 1; c <= Math.min(range.e.c, lr.col + 15); c++) {
          const cv = cellToValue(ws[XLSX.utils.encode_cell({ r: lr.row, c })]);
          if (cv.num != null && cv.num > 10_000) {
            total_commitment = cv.num;
            break;
          }
        }
      }

      const rangeStr = buildRangeA1(
        sheetName,
        lr.row,
        lr.col,
        lr.row,
        lr.col + 20,
      );
      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        investor_class_code: code,
        investor_class_name: lr.label.slice(0, 80),
        total_commitment,
        initial_contribution,
        preferred_return_pct,
        call_protection_period_months: null,
        priority_rank: priorityRank++,
        promote_share_pct:
          code === "sponsor" ? (promote_share_pct ?? 1.0) : promote_share_pct,
        source_sheet: sheetName,
        source_cell_range: rangeStr,
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_investor_classes,
        source_detail: {
          extractor: extractorName,
          label_row: lr.row,
          label_col: lr.col,
          header_row: headers?.headerRow ?? null,
        },
      });
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: 0,
    },
  };
}

export async function extractDebtSchedule(graph, workbook, ctx) {
  const extractorName = "extractDebtSchedule";
  const rows = [];
  const warnings = [];
  const sheetRe =
    /ltl\s*schedule|debt\s*pro[\s-]*forma|refi\s*analysis|amortization|debt\s*schedule/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no debt-schedule sheets");

  const colPatterns = {
    month_index: /^month$|period|^#$|^mo\.?$/i,
    month_date: /date/i,
    beginning_balance: /beginning|begin\b|opening/i,
    principal_payment: /principal|\bp&?i\b(?!.*interest)|amortization/i,
    interest_payment: /interest(?!\s*rate)|\bi&?p\b/i,
    total_payment: /total\s*(debt\s*)?(service|payment|ds)|payment\s*total/i,
    ending_balance: /ending|end\b|closing(?!.*stmt)/i,
  };

  let sectionsFound = 0;
  let rowsSkipped = 0;

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const headers = findColumnHeaders(
      workbook,
      sheetName,
      range.s.r,
      colPatterns,
      Math.min(50, range.e.r - range.s.r),
      {
        scanWidth: range.e.c - range.s.c,
      },
    );
    if (!headers) {
      warnings.push(`${sheetName}: debt-schedule header row not found`);
      continue;
    }
    const nCols = Object.keys(headers.columnMap).length;
    if (nCols < 3) continue;
    const hasPaymentCol =
      headers.columnMap.principal_payment != null ||
      headers.columnMap.interest_payment != null ||
      headers.columnMap.total_payment != null;
    if (!hasPaymentCol) {
      warnings.push(
        `${sheetName}: header matched but no principal/interest/total column — skipping to avoid NULL-payment rows`,
      );
      continue;
    }
    sectionsFound += 1;

    const tranche = inferDebtTranche(sheetName);
    const dataStart = headers.headerRow + 1;
    const dataRows = iterateDataRows(
      workbook,
      sheetName,
      dataStart,
      headers.columnMap,
      {
        skipLabels: [/^total\b/i, /^note\b/i],
        endMarkers: [/^total\b/i],
        maxBlankRun: 2,
        maxRows: 600,
      },
    );

    let rowNum = 0;
    for (const dr of dataRows) {
      rowNum += 1;
      const beg = dr.values.beginning_balance?.num ?? null;
      const prin = dr.values.principal_payment?.num ?? null;
      const intr = dr.values.interest_payment?.num ?? null;
      const tot = dr.values.total_payment?.num ?? null;
      const end = dr.values.ending_balance?.num ?? null;
      const mi = dr.values.month_index?.num ?? null;
      const md = dr.values.month_date?.date ?? null;

      if (mi == null && beg == null && end == null) {
        rowsSkipped += 1;
        continue;
      }

      let period_type = null;
      if (prin != null && intr != null) {
        if (Math.abs(prin) < 1 && Math.abs(intr) > 0) period_type = "io";
        else if (Math.abs(prin) > 1) period_type = "amort";
      }
      if (end != null && Math.abs(end) < 1 && beg != null && Math.abs(beg) > 1)
        period_type = "balloon";

      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        tranche,
        row_num: rowNum,
        month_index: mi != null ? Math.round(mi) : null,
        month_date: md,
        beginning_balance: beg,
        principal_payment: prin,
        interest_payment: intr,
        total_payment: tot,
        ending_balance: end,
        period_type,
        source_sheet: sheetName,
        source_cell_range: buildRangeA1(
          sheetName,
          headers.headerRow,
          headers.headerBounds.startCol ?? range.s.c,
          dr.row,
          headers.headerBounds.endCol ?? range.e.c,
        ),
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_debt_schedule,
        source_detail: {
          extractor: extractorName,
          header_row: headers.headerRow,
          tranche_inferred_from: sheetName,
        },
      });

      if (end != null && Math.abs(end) < 1 && prin != null) break;
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractCapexSchedule(graph, workbook, ctx) {
  const extractorName = "extractCapexSchedule";
  const rows = [];
  const warnings = [];
  const sheetRe = /capex\s*schedule|^capex(?:\s*[\d.]+)?$/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no capex-schedule sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    let headerRow = -1;
    let headerCols = [];
    const upperLimit = Math.min(range.e.r, range.s.r + 20);
    for (let r = range.s.r; r <= upperLimit; r++) {
      const cols = [];
      for (let c = range.s.c + 1; c <= range.e.c; c++) {
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c })]);
        if (cv.date) {
          cols.push({ col: c, date: cv.date, monthIndex: null });
          continue;
        }
        if (
          cv.text &&
          /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*['-]?\s*\d{2,4}|\bm\d+\b|^month\s*\d+$|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(
            cv.text,
          )
        ) {
          cols.push({ col: c, date: null, monthIndex: null });
        }
      }
      if (cols.length >= 6) {
        headerRow = r;
        headerCols = cols;
        break;
      }
    }
    if (headerRow < 0) {
      warnings.push(`${sheetName}: no month-header row found`);
      continue;
    }
    headerCols = headerCols.map((h, i) => ({ ...h, monthIndex: i + 1 }));
    sectionsFound += 1;

    const labelCol = range.s.c;
    let rowNum = 0;
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const label = cellText(ws, r, labelCol) || cellText(ws, r, labelCol + 1);
      if (!label) continue;
      if (/^(total|subtotal|grand\s*total|note|footnote)\b/i.test(label))
        continue;
      const normalized = normalizeCapexCategory(label);

      for (const hc of headerCols) {
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c: hc.col })]);
        if (cv.num == null || Math.abs(cv.num) < 0.005) continue;
        rowNum += 1;
        rows.push({
          property_id: ctx.propertyId,
          org_id: ctx.orgId,
          graph_id: ctx.graphId,
          row_num: rowNum,
          month_index: hc.monthIndex,
          month_date: hc.date,
          category: label.slice(0, 200),
          category_normalized: normalized,
          amount: cv.num,
          draw_notes: null,
          source_sheet: sheetName,
          source_cell_range: buildRangeA1(sheetName, r, labelCol, r, hc.col),
          source_system:
            TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_capex_schedule,
          source_detail: {
            extractor: extractorName,
            header_row: headerRow,
            category_label: label,
          },
        });
      }
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

const MONTHLY_NOI_SKIP_LABEL_RE =
  /^(total|subtotal|grand\s*total|net\s*operating\s*income|gross\s*operating\s*cash\s*flow|net\s*operating\s*cash\s*flow|net\s*cash\s*flow|operating\s*income|operating\s*expenses?|other\s*operating\s*income|rental\s*income|controllable|uncontrollable|other\s*expenses?|reversion|growth\s*factor|actuals?\s*\/|final\s*month|note|as\s*of|footnote|effective\s*gross|\$|%)/i;

const GPR_LABEL_RE = /^gross\s*potential\s*rent\b/i;

function detectNOILabelColumn(ws, range, headerRow) {
  let best = range.s.c;
  let bestCount = -1;
  const lastCol = Math.min(range.e.c, range.s.c + 6);
  const lastRow = Math.min(range.e.r, headerRow + 200);
  for (let c = range.s.c; c <= lastCol; c++) {
    let count = 0;
    for (let r = headerRow + 1; r <= lastRow; r++) {
      if (cellToValue(ws[XLSX.utils.encode_cell({ r, c })]).text != null)
        count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

function countNOIPeriods(ws, r, headerCols) {
  let n = 0;
  for (const hc of headerCols) {
    if (cellToValue(ws[XLSX.utils.encode_cell({ r, c: hc.col })]).num != null)
      n += 1;
  }
  return n;
}

function findNOIBuildSection(ws, range, headerRow, labelCol, headerCols) {
  const periodCount = headerCols.length;
  const fullWidth = Math.max(6, Math.ceil(periodCount * 0.5));

  let startRow = -1;
  let bestWidth = -1;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const t = cellText(ws, r, labelCol);
    if (!t || !GPR_LABEL_RE.test(t)) continue;
    const nP = countNOIPeriods(ws, r, headerCols);
    if (nP < fullWidth) continue;
    if (nP >= bestWidth) {
      bestWidth = nP;
      startRow = r;
    }
  }
  if (startRow < 0) return null;

  let endRow = startRow;
  let gap = 0;
  for (let r = startRow; r <= range.e.r; r++) {
    if (countNOIPeriods(ws, r, headerCols) >= fullWidth) {
      endRow = r;
      gap = 0;
    } else if (++gap > 4) break;
  }
  return { startRow, endRow };
}

export async function extractMonthlyNOI(graph, workbook, ctx) {
  const extractorName = "extractMonthlyNOI";
  const rows = [];
  const warnings = [];
  const sheetRe = /^monthly\s*noi$|^noi\s*build|^noi\b/i;
  const candidateSheets = pickSheets(workbook, sheetRe).filter(
    (n) => !/lender/i.test(n),
  );

  if (!candidateSheets.length)
    return emptyResult(extractorName, "no Monthly NOI sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  for (const sheetName of candidateSheets) {
    if (sectionsFound >= 1) break;

    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    let headerRow = -1;
    let headerCols = [];
    const upperLimit = Math.min(range.e.r, range.s.r + 15);
    for (let r = range.s.r; r <= upperLimit; r++) {
      const cols = [];
      for (let c = range.s.c + 1; c <= range.e.c; c++) {
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c })]);
        if (cv.date) cols.push({ col: c, date: cv.date });
        else if (
          cv.text &&
          /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*['-]?\s*\d{2,4}|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|^m\d+$/i.test(
            cv.text,
          )
        ) {
          cols.push({ col: c, date: null });
        }
      }
      if (cols.length >= 6) {
        headerRow = r;
        headerCols = cols;
        break;
      }
    }
    if (headerRow < 0) {
      warnings.push(`${sheetName}: no period header`);
      continue;
    }
    headerCols = headerCols.map((h, i) => ({ ...h, periodIndex: i + 1 }));

    const labelCol = detectNOILabelColumn(ws, range, headerRow);

    const section = findNOIBuildSection(
      ws,
      range,
      headerRow,
      labelCol,
      headerCols,
    );
    if (!section) {
      warnings.push(`${sheetName}: no monthly-build section found`);
      continue;
    }

    sectionsFound += 1;
    const periodSource = /lender/i.test(sheetName)
      ? "monthly_noi_lender"
      : /entrata|build/i.test(sheetName)
        ? "noi_build_entrata"
        : "monthly_noi";

    let rowNum = 0;
    const seen = new Set();
    for (let r = section.startRow; r <= section.endRow; r++) {
      const label = cellText(ws, r, labelCol);
      if (!label) continue;
      if (MONTHLY_NOI_SKIP_LABEL_RE.test(label)) {
        rowsSkipped += 1;
        continue;
      }
      const lineItem = label.slice(0, 300);
      const category = normalizeMonthlyNOICategory(label);

      let emittedForRow = 0;
      for (const hc of headerCols) {
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c: hc.col })]);
        if (cv.num == null) continue;
        const dedupeKey = `${lineItem}|${hc.periodIndex}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        rowNum += 1;
        emittedForRow += 1;
        rows.push({
          property_id: ctx.propertyId,
          org_id: ctx.orgId,
          graph_id: ctx.graphId,
          period_source: periodSource,
          row_num: rowNum,
          period_index: hc.periodIndex,
          period_date: hc.date,
          category,
          line_item: lineItem,
          amount: cv.num,
          source_sheet: sheetName,
          source_cell_range: buildRangeA1(sheetName, r, labelCol, r, hc.col),
          source_system:
            TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_monthly_noi,
          source_detail: {
            extractor: extractorName,
            header_row: headerRow,
            section: "monthly_noi_build",
            label_col: XLSX.utils.encode_col(labelCol),
            line_item_label: label,
          },
        });
      }
      if (!emittedForRow) rowsSkipped += 1;
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

const PARTNERSHIP_DEBT_SERVICE_LINES = [
  { re: /^debt\s*issuance\s*\(draw\)/i, line_item: "Debt Issuance (Draw)" },
  { re: /^debt\s*repayment\b/i, line_item: "Debt Repayment (Principal)" },
  {
    re: /^interest\s*expense(\s*\(io\))?\s*$/i,
    line_item: "Interest Expense (IO)",
  },
  { re: /^member\s*loan\s*interest\s*$/i, line_item: "Member Loan Interest" },
];

export async function extractPartnershipDebtService(graph, workbook, ctx) {
  const extractorName = "extractPartnershipDebtService";
  const rows = [];
  const warnings = [];
  const sheetRe = /^partnership$/i;
  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no Partnership sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  for (const sheetName of candidateSheets) {
    if (sectionsFound >= 1) break;
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    let headerRow = -1;
    let headerCols = [];
    const upperLimit = Math.min(range.e.r, range.s.r + 15);
    for (let r = range.s.r; r <= upperLimit; r++) {
      const cols = [];
      for (let c = range.s.c + 1; c <= range.e.c; c++) {
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c })]);
        if (cv.date) cols.push({ col: c, date: cv.date });
        else if (
          cv.text &&
          /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*['-]?\s*\d{2,4}|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|^m\d+$/i.test(
            cv.text,
          )
        ) {
          cols.push({ col: c, date: null });
        }
      }
      if (cols.length >= 6) {
        headerRow = r;
        headerCols = cols;
        break;
      }
    }
    if (headerRow < 0) {
      warnings.push(`${sheetName}: no period-date header row`);
      continue;
    }

    sectionsFound += 1;
    headerCols = headerCols.map((h, i) => ({ ...h, periodIndex: i + 1 }));

    const labelScanEnd = Math.min(range.e.c, range.s.c + 4);
    let rowNum = 0;
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      let lineItem = null;
      let rawLabel = null;
      for (let c = range.s.c; c <= labelScanEnd && lineItem == null; c++) {
        const t = cellText(ws, r, c);
        if (!t) continue;
        const match = PARTNERSHIP_DEBT_SERVICE_LINES.find((e) => e.re.test(t));
        if (match) {
          lineItem = match.line_item;
          rawLabel = t;
        }
      }
      if (lineItem == null) continue;

      for (const hc of headerCols) {
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c: hc.col })]);
        if (cv.num == null || Math.abs(cv.num) < 0.005) continue;
        rowNum += 1;
        rows.push({
          property_id: ctx.propertyId,
          org_id: ctx.orgId,
          graph_id: ctx.graphId,
          period_source: "partnership",
          row_num: rowNum,
          period_index: hc.periodIndex,
          period_date: hc.date,
          category: "debt_service",
          line_item: lineItem,
          amount: cv.num,
          source_sheet: sheetName,
          source_cell_range: buildRangeA1(sheetName, r, range.s.c, r, hc.col),
          source_system:
            TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_monthly_noi,
          source_detail: {
            extractor: extractorName,
            header_row: headerRow,
            line_item_label: rawLabel,
          },
        });
      }
    }
    if (!rows.length)
      warnings.push(`${sheetName}: no debt-service rows matched the allowlist`);
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractBudgetLines(graph, workbook, ctx) {
  const extractorName = "extractBudgetLines";
  const rows = [];
  const warnings = [];
  const sheetRe = /^budget(_?[\d.]+)?$|^budget\s+\d/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no Budget sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const colPatterns = {
      line_item:
        /line\s*item|description|gl\s*(account|description)|account\s*name/i,
      source_account: /account\s*(#|number|code|id)|gl\s*(#|code)/i,
      amount_annual: /annual(\s*budget)?|\btotal\b|fy\s*\d/i,
      amount_ytd: /\bytd\b|year[\s-]*to[\s-]*date/i,
      category: /category|class(ification)?|type/i,
    };
    const headers = findColumnHeaders(
      workbook,
      sheetName,
      range.s.r,
      colPatterns,
      20,
    );
    if (!headers || !headers.columnMap.line_item) {
      warnings.push(`${sheetName}: budget header not found`);
      continue;
    }
    sectionsFound += 1;

    const dataRows = iterateDataRows(
      workbook,
      sheetName,
      headers.headerRow + 1,
      headers.columnMap,
      {
        skipLabels: [/^(total|subtotal|grand\s*total|section)/i],
        endMarkers: [],
        maxBlankRun: 3,
        maxRows: 1000,
        labelCol: headers.columnMap.line_item,
      },
    );

    const amountKey =
      headers.columnMap.amount_annual != null ? "amount_annual" : "amount_ytd";
    const period = headers.columnMap.amount_annual != null ? "annual" : "ytd";

    for (const dr of dataRows) {
      const lineItem = dr.values.line_item?.text || dr.labelText;
      if (!lineItem) {
        rowsSkipped += 1;
        continue;
      }
      const amount = dr.values[amountKey]?.num ?? null;
      if (amount == null) {
        rowsSkipped += 1;
        continue;
      }

      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        line_item: lineItem.slice(0, 500),
        category: dr.values.category?.text || null,
        period,
        period_date: null,
        amount,
        source_account: dr.values.source_account?.text || null,
        source_sheet: sheetName,
        source_cell_range: buildRangeA1(
          sheetName,
          headers.headerRow,
          headers.headerBounds.startCol ?? range.s.c,
          dr.row,
          headers.headerBounds.endCol ?? range.e.c,
        ),
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_budget_lines,
        source_detail: {
          extractor: extractorName,
          header_row: headers.headerRow,
          amount_column: amountKey,
        },
      });
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractClosingStatementLines(graph, workbook, ctx) {
  const extractorName = "extractClosingStatementLines";
  const rows = [];
  const warnings = [];
  const sheetRe = /closing\s*stmt|closing\s*statement/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no Closing Stmt sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    sectionsFound += 1;

    let buyerCol = null;
    let sellerCol = null;
    const upperLimit = Math.min(range.e.r, range.s.r + 15);
    for (let r = range.s.r; r <= upperLimit; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const t = cellText(ws, r, c);
        if (!t || t.length > 40) continue;
        if (buyerCol == null && /buyer|purchaser/i.test(t)) buyerCol = c;
        if (sellerCol == null && /seller|vendor/i.test(t)) sellerCol = c;
      }
      if (buyerCol != null && sellerCol != null) break;
    }

    const labelCols = [range.s.c, range.s.c + 1];
    const amountCols = [
      range.s.c + 1,
      range.s.c + 2,
      range.s.c + 3,
      range.s.c + 4,
    ];

    for (let r = range.s.r; r <= range.e.r; r++) {
      let label = null;
      let labelColUsed = null;
      for (const lc of labelCols) {
        const t = cellText(ws, r, lc);
        if (
          t &&
          t.length >= 3 &&
          t.length <= 200 &&
          !/^total|subtotal|^\s*$/i.test(t)
        ) {
          label = t;
          labelColUsed = lc;
          break;
        }
      }
      if (!label) continue;
      if (/^(note|as\s*of|buyer|seller|settlement)\b/i.test(label)) continue;

      let amount = null;
      let amountCol = null;
      for (const ac of amountCols) {
        if (ac <= (labelColUsed || 0)) continue;
        const cv = cellToValue(ws[XLSX.utils.encode_cell({ r, c: ac })]);
        if (cv.num != null && Math.abs(cv.num) > 0.005) {
          amount = cv.num;
          amountCol = ac;
          break;
        }
      }
      if (amount == null) {
        rowsSkipped += 1;
        continue;
      }

      let payer = null;
      if (buyerCol != null && Math.abs(amountCol - buyerCol) <= 1)
        payer = "buyer";
      else if (sellerCol != null && Math.abs(amountCol - sellerCol) <= 1)
        payer = "seller";

      const category = normalizeClosingCategory(label);

      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        line_item: label.slice(0, 300),
        category,
        amount,
        payer,
        source_sheet: sheetName,
        source_cell_range: buildRangeA1(
          sheetName,
          r,
          labelColUsed ?? 0,
          r,
          amountCol,
        ),
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_closing_statement_lines,
        source_detail: {
          extractor: extractorName,
          buyer_col: buyerCol,
          seller_col: sellerCol,
          amount_col: amountCol,
        },
      });
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractRentComps(graph, workbook, ctx) {
  const extractorName = "extractRentComps";
  const rows = [];
  const warnings = [];
  const sheetRe = /rent(s)?\s*comps?|initial\s*rent\s*comps?/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no rent-comps sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  const colPatterns = {
    comp_property_name: /property\s*name|comp\s*name|name(?!\s*plate)/i,
    comp_address: /address|location/i,
    distance_miles: /distance|miles?/i,
    units: /^units?$|\b#\s*units\b/i,
    avg_sf: /avg\s*sf|sq\.?\s*ft|square\s*feet|\bsf\b/i,
    year_built: /year\s*built|yr\s*built|vintage/i,
    avg_rent: /avg\s*rent|average\s*rent|\brent\b/i,
    avg_rent_psf: /rent\s*\/\s*sf|rent\s*psf|\$\s*\/\s*sf/i,
    occupancy_pct: /occupancy|\bocc\b|occ\s*%/i,
    source_notes: /costar|notes?|listing|source/i,
  };

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const headers = findColumnHeaders(
      workbook,
      sheetName,
      range.s.r,
      colPatterns,
      15,
    );
    if (!headers) {
      warnings.push(`${sheetName}: rent-comps header not found`);
      continue;
    }
    sectionsFound += 1;

    const compTier = /initial/i.test(sheetName)
      ? "acquisition_era"
      : /unreno/i.test(sheetName)
        ? "unrenovated"
        : "market";

    const dataRows = iterateDataRows(
      workbook,
      sheetName,
      headers.headerRow + 1,
      headers.columnMap,
      {
        skipLabels: [/^total|^subtotal|^avg|^average|^mean/i],
        endMarkers: [/^source:|^note:/i],
        maxBlankRun: 2,
        maxRows: 200,
        labelCol:
          headers.columnMap.comp_property_name ??
          headers.headerBounds.startCol ??
          0,
      },
    );

    for (const dr of dataRows) {
      const name = dr.values.comp_property_name?.text || dr.labelText;
      if (!name) {
        rowsSkipped += 1;
        continue;
      }
      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        comp_tier: compTier,
        snapshot_date: ctx.ingestTimestamp.slice(0, 10),
        comp_property_name: name.slice(0, 200),
        comp_address: dr.values.comp_address?.text || null,
        distance_miles: dr.values.distance_miles?.num ?? null,
        units:
          dr.values.units?.num != null ? Math.round(dr.values.units.num) : null,
        avg_sf:
          dr.values.avg_sf?.num != null
            ? Math.round(dr.values.avg_sf.num)
            : null,
        year_built:
          dr.values.year_built?.num != null
            ? Math.round(dr.values.year_built.num)
            : null,
        avg_rent: dr.values.avg_rent?.num ?? null,
        avg_rent_psf: dr.values.avg_rent_psf?.num ?? null,
        occupancy_pct: dr.values.occupancy_pct?.num ?? null,
        source_notes: dr.values.source_notes?.text || null,
        source_sheet: sheetName,
        source_cell_range: buildRangeA1(
          sheetName,
          headers.headerRow,
          headers.headerBounds.startCol ?? range.s.c,
          dr.row,
          headers.headerBounds.endCol ?? range.e.c,
        ),
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_rent_comps,
        source_detail: {
          extractor: extractorName,
          header_row: headers.headerRow,
          comp_tier: compTier,
        },
      });
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractSaleComps(graph, workbook, ctx) {
  const extractorName = "extractSaleComps";
  const rows = [];
  const warnings = [];
  const sheetRe = /sale\s*comps?|disposition\s*comps?|property\s*comparables?/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "sheet not found");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  const colPatterns = {
    comp_property_name: /property\s*name|comp\s*name|^name$/i,
    comp_address: /address|location/i,
    distance_miles: /distance|miles?/i,
    sale_date: /sale\s*date|closing\s*date|^date$/i,
    sale_price: /sale\s*price|purchase\s*price|sold\s*price/i,
    cap_rate: /cap\s*rate|\bcap\b/i,
    units: /^units?$|\b#\s*units\b/i,
    price_per_unit: /\$\s*\/\s*unit|price\s*\/\s*unit|price\s*per\s*unit/i,
    price_per_sf: /\$\s*\/\s*sf|price\s*\/\s*sf|price\s*per\s*sf/i,
    condition_notes: /condition|notes?|vintage/i,
  };

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const headers = findColumnHeaders(
      workbook,
      sheetName,
      range.s.r,
      colPatterns,
      15,
    );
    if (!headers) {
      warnings.push(`${sheetName}: sale-comps header not found`);
      continue;
    }
    sectionsFound += 1;

    const dataRows = iterateDataRows(
      workbook,
      sheetName,
      headers.headerRow + 1,
      headers.columnMap,
      {
        skipLabels: [/^total|^avg|^average|^mean/i],
        endMarkers: [/^source:|^note:/i],
        maxBlankRun: 2,
        maxRows: 200,
        labelCol:
          headers.columnMap.comp_property_name ??
          headers.headerBounds.startCol ??
          0,
      },
    );

    for (const dr of dataRows) {
      const name = dr.values.comp_property_name?.text || dr.labelText;
      if (!name) {
        rowsSkipped += 1;
        continue;
      }
      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        comp_property_name: name.slice(0, 200),
        comp_address: dr.values.comp_address?.text || null,
        distance_miles: dr.values.distance_miles?.num ?? null,
        sale_date: dr.values.sale_date?.date ?? null,
        sale_price: dr.values.sale_price?.num ?? null,
        cap_rate: dr.values.cap_rate?.num ?? null,
        units:
          dr.values.units?.num != null ? Math.round(dr.values.units.num) : null,
        price_per_unit: dr.values.price_per_unit?.num ?? null,
        price_per_sf: dr.values.price_per_sf?.num ?? null,
        condition_notes: dr.values.condition_notes?.text || null,
        source_sheet: sheetName,
        source_cell_range: buildRangeA1(
          sheetName,
          headers.headerRow,
          headers.headerBounds.startCol ?? range.s.c,
          dr.row,
          headers.headerBounds.endCol ?? range.e.c,
        ),
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_sale_comps,
        source_detail: {
          extractor: extractorName,
          header_row: headers.headerRow,
        },
      });
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractPermitHistory(graph, workbook, ctx) {
  const extractorName = "extractPermitHistory";
  const rows = [];
  const warnings = [];
  const sheetRe = /permit\s*history|permit\s*log/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no Permit History sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  const colPatterns = {
    permit_number: /permit\s*(number|#|id)|^#$/i,
    permit_date: /(permit\s*)?date|issue(d)?\s*date|filed/i,
    permit_type: /permit\s*type|\btype\b|category/i,
    description: /description|scope|work/i,
    status: /^status$/i,
    cost: /cost|value|valuation|amount|fee/i,
  };

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const headers = findColumnHeaders(
      workbook,
      sheetName,
      range.s.r,
      colPatterns,
      15,
    );
    if (!headers || Object.keys(headers.columnMap).length < 3) {
      warnings.push(`${sheetName}: permit header needs 3+ matched cols`);
      continue;
    }
    sectionsFound += 1;

    const dataRows = iterateDataRows(
      workbook,
      sheetName,
      headers.headerRow + 1,
      headers.columnMap,
      {
        skipLabels: [/^(total|summary|note)\b/i],
        endMarkers: [/^source:|^note:/i],
        maxBlankRun: 3,
        maxRows: 500,
        labelCol:
          headers.columnMap.permit_number ??
          headers.columnMap.description ??
          headers.headerBounds.startCol ??
          0,
      },
    );

    for (const dr of dataRows) {
      const hasContent =
        dr.values.permit_number?.text ||
        dr.values.description?.text ||
        dr.values.permit_date?.date ||
        dr.values.permit_type?.text;
      if (!hasContent) {
        rowsSkipped += 1;
        continue;
      }
      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        permit_number:
          dr.values.permit_number?.text ||
          (dr.values.permit_number?.num != null
            ? String(dr.values.permit_number.num)
            : null),
        permit_date: dr.values.permit_date?.date ?? null,
        permit_type: dr.values.permit_type?.text || null,
        description: dr.values.description?.text || null,
        status: dr.values.status?.text || null,
        cost: dr.values.cost?.num ?? null,
        source_sheet: sheetName,
        source_cell_range: buildRangeA1(
          sheetName,
          headers.headerRow,
          headers.headerBounds.startCol ?? range.s.c,
          dr.row,
          headers.headerBounds.endCol ?? range.e.c,
        ),
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_permit_history,
        source_detail: {
          extractor: extractorName,
          header_row: headers.headerRow,
        },
      });
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export async function extractCostSegCategories(graph, workbook, ctx) {
  const extractorName = "extractCostSegCategories";
  const rows = [];
  const warnings = [];
  const sheetRe = /cost\s*seg(regation)?/i;

  const candidateSheets = pickSheets(workbook, sheetRe);
  if (!candidateSheets.length)
    return emptyResult(extractorName, "no Cost Segregation sheet");

  let sectionsFound = 0;
  let rowsSkipped = 0;

  const categoryLabelRe =
    /personal\s*property|land\s*improvement|building|^\s*land\s*$|bonus\s*depreciation/i;

  const colPatterns = {
    depreciable_basis: /basis|amount|\bcost\b|value/i,
    useful_life_years: /useful\s*life|years?|life\s*\(?\s*yrs?\s*\)?/i,
    recovery_class: /recovery\s*class|macrs|class/i,
    y1_accelerated_amount: /year\s*1|yr\s*1|y1|first\s*year/i,
    lifetime_accelerated_amount: /lifetime|total\s*acceler|cumulative/i,
  };

  for (const sheetName of candidateSheets) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

    const headers = findColumnHeaders(
      workbook,
      sheetName,
      range.s.r,
      colPatterns,
      20,
    );
    if (!headers) {
      warnings.push(`${sheetName}: cost-seg header not found`);
      continue;
    }
    sectionsFound += 1;

    const labelCol =
      headers.headerBounds.startCol != null
        ? Math.max(range.s.c, headers.headerBounds.startCol - 1)
        : range.s.c;

    for (let r = headers.headerRow + 1; r <= range.e.r; r++) {
      const label =
        cellText(ws, r, labelCol) ||
        cellText(ws, r, labelCol + 1) ||
        cellText(ws, r, range.s.c);
      if (!label) continue;
      if (/^(total|note|source)\b/i.test(label)) continue;
      if (!categoryLabelRe.test(label)) continue;

      const category = normalizeCostSegCategory(label);
      const basis =
        headers.columnMap.depreciable_basis != null
          ? cellNumber(ws, r, headers.columnMap.depreciable_basis)
          : null;
      const life =
        headers.columnMap.useful_life_years != null
          ? cellNumber(ws, r, headers.columnMap.useful_life_years)
          : null;
      const recCls =
        headers.columnMap.recovery_class != null
          ? cellText(ws, r, headers.columnMap.recovery_class)
          : null;
      const y1 =
        headers.columnMap.y1_accelerated_amount != null
          ? cellNumber(ws, r, headers.columnMap.y1_accelerated_amount)
          : null;
      const life$ =
        headers.columnMap.lifetime_accelerated_amount != null
          ? cellNumber(ws, r, headers.columnMap.lifetime_accelerated_amount)
          : null;

      rows.push({
        property_id: ctx.propertyId,
        org_id: ctx.orgId,
        graph_id: ctx.graphId,
        category,
        depreciable_basis: basis,
        useful_life_years: life != null ? Math.round(life) : null,
        recovery_class: recCls,
        y1_accelerated_amount: y1,
        lifetime_accelerated_amount: life$,
        source_sheet: sheetName,
        source_cell_range: buildRangeA1(
          sheetName,
          headers.headerRow,
          headers.headerBounds.startCol ?? range.s.c,
          r,
          headers.headerBounds.endCol ?? range.e.c,
        ),
        source_system:
          TABLE_DEFAULT_SOURCE_SYSTEM.property_underwriting_cost_seg_categories,
        source_detail: {
          extractor: extractorName,
          header_row: headers.headerRow,
          raw_label: label,
        },
      });
    }
  }

  logExtractorDiag(extractorName, rows.length, warnings);
  return {
    rows,
    warnings,
    diag: {
      extractor: extractorName,
      sections_found: sectionsFound,
      rows_parsed: rows.length,
      rows_skipped: rowsSkipped,
    },
  };
}

export const EXTRACTOR_TABLE_MAP = [
  {
    name: "extractUnitMix",
    fn: extractUnitMix,
    table: "property_underwriting_unit_mix",
  },
  {
    name: "extractWaterfallTiers",
    fn: extractWaterfallTiers,
    table: "property_underwriting_waterfall_tiers",
  },
  {
    name: "extractInvestorClasses",
    fn: extractInvestorClasses,
    table: "property_underwriting_investor_classes",
  },
  {
    name: "extractDebtSchedule",
    fn: extractDebtSchedule,
    table: "property_underwriting_debt_schedule",
  },
  {
    name: "extractCapexSchedule",
    fn: extractCapexSchedule,
    table: "property_underwriting_capex_schedule",
  },
  {
    name: "extractMonthlyNOI",
    fn: extractMonthlyNOI,
    table: "property_underwriting_monthly_noi",
  },
  {
    name: "extractPartnershipDebtService",
    fn: extractPartnershipDebtService,
    table: "property_underwriting_monthly_noi",
  },
  {
    name: "extractBudgetLines",
    fn: extractBudgetLines,
    table: "property_underwriting_budget_lines",
  },
  {
    name: "extractClosingStatementLines",
    fn: extractClosingStatementLines,
    table: "property_underwriting_closing_statement_lines",
  },
  {
    name: "extractRentComps",
    fn: extractRentComps,
    table: "property_underwriting_rent_comps",
  },
  {
    name: "extractSaleComps",
    fn: extractSaleComps,
    table: "property_underwriting_sale_comps",
  },
  {
    name: "extractPermitHistory",
    fn: extractPermitHistory,
    table: "property_underwriting_permit_history",
  },
  {
    name: "extractCostSegCategories",
    fn: extractCostSegCategories,
    table: "property_underwriting_cost_seg_categories",
  },
];

export async function runAllTabularExtractions(graph, workbook, ctx) {
  const results = [];
  let totalRows = 0;
  let totalWarnings = 0;
  const summary = {};

  for (const entry of EXTRACTOR_TABLE_MAP) {
    let result;
    try {
      result = await entry.fn(graph, workbook, ctx);
    } catch (e) {
      console.error(`[tabular:${entry.name}] threw:`, e?.message || e);
      result = {
        rows: [],
        warnings: [`${entry.name} threw: ${e?.message || String(e)}`],
        diag: {
          extractor: entry.name,
          sections_found: 0,
          rows_parsed: 0,
          rows_skipped: 0,
          error: String(e?.message || e).slice(0, 400),
        },
      };
    }
    const rowCount = Array.isArray(result?.rows) ? result.rows.length : 0;
    const warnCount = Array.isArray(result?.warnings)
      ? result.warnings.length
      : 0;
    totalRows += rowCount;
    totalWarnings += warnCount;
    summary[entry.table] = {
      extractor: entry.name,
      rows: rowCount,
      warnings: warnCount,
      diag: result?.diag ?? null,
    };
    results.push({
      extractor: entry.name,
      table: entry.table,
      rows: result?.rows ?? [],
      warnings: result?.warnings ?? [],
      diag: result?.diag ?? null,
    });
  }

  return { results, totalRows, totalWarnings, summary };
}

export async function writeTabularRows(
  tableName,
  rows,
  { srInsertBatched, batchSize = DEFAULT_TABULAR_INSERT_BATCH_SIZE },
) {
  if (!Array.isArray(rows) || !rows.length) {
    return { inserted: 0, errors: [] };
  }
  if (typeof srInsertBatched !== "function") {
    return { inserted: 0, errors: ["srInsertBatched dependency not provided"] };
  }
  const errors = [];
  try {
    await srInsertBatched(`/${tableName}`, rows, {
      batchSize,
      prefer: "return=minimal",
    });
    return { inserted: rows.length, errors };
  } catch (e) {
    const msg = `insert to ${tableName} failed: ${e?.message || String(e)}`;
    console.error(`[tabular:writeTabularRows] ${msg}`);
    errors.push(msg);
    return { inserted: 0, errors };
  }
}
