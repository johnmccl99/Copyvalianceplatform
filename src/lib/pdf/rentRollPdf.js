import {
  buildDocShell,
  printableWidth,
  NARROW_MARGIN_X,
  BRAND_NAVY,
  BRAND_STRIPE,
  BRAND_SUBTOTAL_FILL,
} from "./valianceLetterhead.js";
import {
  leasedAs,
  spaceOption,
  unitStatus,
  isByUnitRoll,
  rowNounSingular,
} from "../rentRollView.js";
import { byUnitBasisSentence } from "../rentRollByUnit.js";
import { unitCellLabel, NO_UNIT_ASSIGNED_LABEL } from "../rentRollView.js";
import {
  leaseEndCell,
  MTM_MARKER,
  NOT_MOVED_IN_LABEL,
} from "../rentRollView.js";

import { buildRentRollColumns } from "../rentRollView.js";
import { RENT_PLAUSIBLE_MIN } from "../rentRollView.js";
import {
  rentColumnTotal,
  rentKpiSubLabel,
  buildColumnTotals,
  totalCoverageLabel,
  rentTotalCoverageSentence,
} from "../rentRollTotals.js";
import {
  buildRentRollSummary,
  CHARGE_SUMMARY_ACTUAL_NOTE,
  CHARGE_SUMMARY_LEDGER_NOTE,
  STATUS_SUMMARY_BASIS_NOTE,
} from "../rentRollSummary.js";
import { rentRollKpis } from "../rentRollKpis.js";
import {
  UNASSIGNED_SECTION_HEADING,
  UNASSIGNED_SECTION_NOTE,
} from "../rentRollUnassigned.js";

const DASH = "—";

export function money0(v) {
  return (
    "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
  );
}

export function money2(v) {
  if (v == null) return DASH;
  return (
    "$" +
    Number(v).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function computeRentRollKpis(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  const rent = rentColumnTotal(list);
  const k = rentRollKpis(list, options);
  const occupied = k.occupiedLeases;
  const entrataCount = k.entrataCount;
  const addedCount = k.addedCount;
  const adjustedCount = k.adjustedCount;
  return {
    total: k.leases,
    totalRent: rent.sum,
    rentExcluded: rent.excluded,
    rentCounted: rent.counted,
    occupied,
    entrataCount,
    addedCount,
    adjustedCount,
    occupancy: k.occupancy,
    occupiedLeases: k.occupiedLeases,
    noun: k.noun,
  };
}

export function capturedRentSubLabel(placeholderCount, noun) {
  const n = Number(placeholderCount) || 0;
  const base = "sum of effective rent as captured";
  if (n <= 0) return base;
  const word = rowNounSingular(noun);
  return (
    base +
    " · includes " +
    n +
    " " +
    (n === 1 ? word : word + "s") +
    " recorded below $" +
    RENT_PLAUSIBLE_MIN
  );
}

export function rentRollFreshnessSubtitle(asOf, options) {
  const base = asOf
    ? "Data current as of " + new Date(asOf).toLocaleString()
    : "Data freshness unknown";
  const showsUnitStatus = !!(options && options.unitStatusRendered);
  return showsUnitStatus
    ? base + " · Unit Status reflects today, not the as-of date"
    : base;
}

export function rentRollProvenanceLine(generatedAt, asOf) {
  const gen = generatedAt ? new Date(generatedAt).toLocaleString() : null;
  const data = asOf ? new Date(asOf).toLocaleString() : null;
  if (!gen && !data) return null;
  if (!data) return "Generated " + gen;
  if (!gen) return "Data as of " + data;
  return "Generated " + gen + " · data as of " + data;
}

export function rentRollRowCells(r) {
  const isAdj = r.source === "adjustment";
  const rentOverridden =
    !isAdj &&
    r.adjusted &&
    r.effective_rent != null &&
    Number(r.effective_rent) !== Number(r.rent);
  const effStatus = r.effective_status || r.status || "";
  const groupName = r.group ? r.group.group_name || "" : r.group_name || "";
  const hasGroup = !!(r.group || r.group_name);
  return {
    unit: unitCellLabel(r),
    unitAbsent: unitCellLabel(r) === NO_UNIT_ASSIGNED_LABEL,
    leasedAs: leasedAs(r) || DASH,
    spaceOption: spaceOption(r) || DASH,
    unitStatus: unitStatus(r) || DASH,
    tenant: r.tenant_name || DASH,
    offEntrata: isAdj,
    notMovedIn: !!r.not_moved_in,
    masterLease: hasGroup ? "Master lease: " + groupName : null,
    unitType: r.unit_type_name || DASH,
    unitSf: r.unit_sqft == null ? DASH : Number(r.unit_sqft).toLocaleString(),
    bedspaceSf:
      r.bedspace_sf == null ? DASH : Number(r.bedspace_sf).toLocaleString(),
    leaseStart: r.lease_start || DASH,
    leaseEnd: leaseEndCell(r),
    gpr: r.gpr == null ? DASH : money2(r.gpr),
    rentCharges: r.rent_charges == null ? DASH : money2(r.rent_charges),
    totalCharges: r.total_charges == null ? DASH : money2(r.total_charges),
    rentWas: rentOverridden ? "was " + money2(r.rent) : null,
    deposit: r.deposit == null ? DASH : money2(r.deposit),
    status: effStatus || DASH,
    adjustedBadge: !isAdj && r.adjusted,
    mtmFlag: !!r.is_mtm,
  };
}

const PDF_PAGE_SIZE = "TABLOID";
const PDF_MARGIN_X = NARROW_MARGIN_X;
const PRINTABLE_WIDTH = printableWidth(
  "landscape",
  PDF_PAGE_SIZE,
  PDF_MARGIN_X,
);

const PAD_PER_COLUMN = 8;
const TENANT_MIN_WIDTH = 110;
const DYNAMIC_MIN_WIDTH = 46;

export const PDF_GEOMETRY = {
  pageSize: PDF_PAGE_SIZE,
  orientation: "landscape",
  marginX: PDF_MARGIN_X,
  printableWidth: PRINTABLE_WIDTH,
  padPerColumn: PAD_PER_COLUMN,
  tenantMinWidth: TENANT_MIN_WIDTH,
  dynamicMinWidth: DYNAMIC_MIN_WIDTH,
};

const TENANT_CELL_FONT_SIZE = 8.5;
const ROBOTO_WIDEST_ADVANCE_EM = 0.9;
const TENANT_TOKEN_MAX_CHARS = Math.floor(
  (TENANT_MIN_WIDTH - PAD_PER_COLUMN) /
    (ROBOTO_WIDEST_ADVANCE_EM * TENANT_CELL_FONT_SIZE),
);
const TENANT_TOKEN_CHUNK = Math.max(1, Math.floor(TENANT_TOKEN_MAX_CHARS / 2));

export function breakLongTokens(text) {
  const s = String(text == null ? "" : text);
  const inlines = [];
  let carry = "";
  const flush = () => {
    if (carry) inlines.push({ text: carry });
    carry = "";
  };
  for (const token of s.split(/(\s+)/)) {
    if (/^\s*$/.test(token) || [...token].length <= TENANT_TOKEN_MAX_CHARS) {
      carry += token;
      continue;
    }
    flush();
    const chars = [...token];
    for (let i = 0; i < chars.length; i += TENANT_TOKEN_CHUNK) {
      inlines.push({ text: chars.slice(i, i + TENANT_TOKEN_CHUNK).join("") });
    }
  }
  flush();
  return inlines.length ? inlines : [{ text: s }];
}

const UNIT_TYPE_WIDTH = 48;
const UNIT_SF_WIDTH = 32;

export const PDF_DROPPABLE_KEYS = [
  "leasedAs",
  "unitType",
  "status",
  "deposit",
  "rentCharges",
  "unitSf",
  "gpr",
];

export const PDF_OMITTED_KEYS = ["netEffective"];

export const PDF_HEADER_LABELS = { bedspaceSf: "Bed SF" };

export function pdfHeaderLabel(col) {
  if (!col) return "";
  return PDF_HEADER_LABELS[col.key] || col.label;
}

export const PDF_SPINE_ORDER = [
  "unit",
  "spaceOption",
  "unitType",
  "unitSf",
  "bedspaceSf",
  "unitStatus",
  "leasedAs",
  "tenant",
  "leaseStart",
  "leaseEnd",
  "gpr",
  "rentCharges",
  "totalCharges",
  "deposit",
  "status",
];

function fixedWidthOf(col) {
  if (!col) return 0;
  if (col.charge || col.netEffective) return 0;
  switch (col.key) {
    case "unit":
      return 64;
    case "unitType":
      return UNIT_TYPE_WIDTH;
    case "unitSf":
      return UNIT_SF_WIDTH;
    case "bedspaceSf":
      return UNIT_SF_WIDTH;
    case "leasedAs":
      return 62;
    case "spaceOption":
      return 78;
    case "tenant":
      return 0;
    case "leaseStart":
      return 62;
    case "leaseEnd":
      return 62;
    case "gpr":
      return 68;
    case "deposit":
      return 52;
    case "rentCharges":
      return 66;
    case "totalCharges":
      return 66;
    case "unitStatus":
      return 66;
    case "status":
      return 68;
    default:
      return 0;
  }
}

export function rentRollPdfRequiredWidth(cols) {
  const list = Array.isArray(cols) ? cols : [];
  const dynamic = list.filter((c) => c && (c.charge || c.netEffective)).length;
  const fixed = list.reduce((sum, c) => sum + fixedWidthOf(c), 0);
  const padding = PAD_PER_COLUMN * list.length;
  return fixed + TENANT_MIN_WIDTH + dynamic * DYNAMIC_MIN_WIDTH + padding;
}

function fitsPrintableWidth(cols) {
  return rentRollPdfRequiredWidth(cols) <= PRINTABLE_WIDTH;
}

function toPdfSpineOrder(cols) {
  const dynamic = cols.filter((c) => c && (c.charge || c.netEffective));
  const spine = cols.filter((c) => !(c && (c.charge || c.netEffective)));
  const rank = (c) => {
    const i = PDF_SPINE_ORDER.indexOf(c && c.key);
    return i < 0 ? PDF_SPINE_ORDER.length : i;
  };
  spine.sort((a, b) => rank(a) - rank(b));
  if (!dynamic.length) return spine;

  const anchorRank = PDF_SPINE_ORDER.indexOf("gpr");
  if (anchorRank < 0) return spine.concat(dynamic);
  let at = -1;
  for (let i = 0; i < spine.length; i += 1) {
    if (rank(spine[i]) > anchorRank) break;
    at = i;
  }
  return spine
    .slice(0, at + 1)
    .concat(dynamic)
    .concat(spine.slice(at + 1));
}

export function rentRollPdfColumnPlan(columns) {
  const requested = toPdfSpineOrder(
    Array.isArray(columns) ? columns.slice() : [],
  );
  let cols = requested.filter((c) => !(c && PDF_OMITTED_KEYS.includes(c.key)));
  const droppedForWidth = [];
  for (const key of PDF_DROPPABLE_KEYS) {
    if (fitsPrintableWidth(cols)) break;
    const before = cols.length;
    const col = cols.find((c) => c && c.key === key);
    cols = cols.filter((c) => !(c && c.key === key));
    if (cols.length !== before && col) droppedForWidth.push(col);
  }
  return { columns: cols, droppedForWidth, fits: fitsPrintableWidth(cols) };
}

export function pdfWidthDropSentence(plan) {
  if (!plan) return null;
  const names = (plan.droppedForWidth || [])
    .map((c) => (c && (c.label || c.key)) || "")
    .filter(Boolean);
  const overflows = plan.fits === false;
  if (!names.length && !overflows) return null;
  const list =
    names.length === 1
      ? names[0]
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  if (names.length && overflows) {
    return (
      `${list} could not fit this page and ${names.length === 1 ? "was" : "were"} left off, ` +
      "and the remaining columns are still wider than the page. " +
      "Every column you selected is in the Excel export and on screen."
    );
  }
  if (names.length) {
    return (
      `${list} ${names.length === 1 ? "was" : "were"} left off this page for width. ` +
      `${names.length === 1 ? "It is" : "They are"} in the Excel export and on screen.`
    );
  }
  return (
    "The selected columns are wider than this page. " +
    "Every column you selected is in the Excel export and on screen."
  );
}

export function rentRollPdfColumns(columns) {
  let cols = toPdfSpineOrder(Array.isArray(columns) ? columns.slice() : []);
  cols = cols.filter((c) => !(c && PDF_OMITTED_KEYS.includes(c.key)));
  for (const key of PDF_DROPPABLE_KEYS) {
    if (fitsPrintableWidth(cols)) break;
    cols = cols.filter((c) => !(c && c.key === key));
  }
  return cols;
}

export function rentRollPdfWidths(columns) {
  const cols = Array.isArray(columns) ? columns : [];
  const dynamic = cols.filter((c) => c && (c.charge || c.netEffective)).length;
  const fixed = cols.reduce((sum, c) => sum + fixedWidthOf(c), 0);
  const available =
    PRINTABLE_WIDTH - fixed - TENANT_MIN_WIDTH - PAD_PER_COLUMN * cols.length;
  const per = dynamic
    ? Math.max(DYNAMIC_MIN_WIDTH, Math.min(82, Math.floor(available / dynamic)))
    : 0;

  const out = [];
  for (const c of cols) {
    if (c && (c.charge || c.netEffective)) out.push(per);
    else if (c && c.key === "tenant") out.push("*");
    else if (fixedWidthOf(c) > 0) out.push(fixedWidthOf(c));
    else
      throw new Error("rentRollPdfWidths: no width for column " + (c && c.key));
  }
  return out;
}

function rentRollTable(rows, chargeColumns, columnOptions, tableOptions) {
  const columns = rentRollPdfColumns(
    buildRentRollColumns(chargeColumns, columnOptions || {}),
  );
  const header = columns.map((c) => ({
    text: pdfHeaderLabel(c),
    style: "tableHeader",
  }));
  const dynamicCols = columns.filter((c) => c.charge || c.netEffective);

  const body = [header];
  rows.forEach((r, i) => {
    const c = rentRollRowCells(r);
    const fill = i % 2 === 1 ? BRAND_STRIPE : null;

    const tenantStack = [
      {
        text: [
          ...breakLongTokens(c.tenant),
          c.offEntrata ? { text: "  Off-Entrata", style: "badge" } : "",
          c.notMovedIn
            ? { text: "  " + NOT_MOVED_IN_LABEL, style: "badge" }
            : "",
        ],
        style: "cell",
      },
    ];
    if (c.masterLease)
      tenantStack.push({
        text: breakLongTokens(c.masterLease),
        style: "cellMuted",
      });

    const rentStack = [
      { text: c.rentCharges, style: "cell", alignment: "right" },
    ];
    if (c.rentWas) {
      rentStack.push({
        text: c.rentWas,
        style: "cellMuted",
        alignment: "right",
        decoration: "lineThrough",
      });
    }

    const statusText = [{ text: c.status }];
    if (c.adjustedBadge)
      statusText.push({ text: "  Adjusted", style: "badge" });
    const renderedKeys = new Set(columns.map((col) => col && col.key));
    const mtmHost = renderedKeys.has("leaseEnd")
      ? "leaseEnd"
      : renderedKeys.has("status")
        ? "status"
        : renderedKeys.has("unitStatus")
          ? "unitStatus"
          : "unit";
    const withMtm = (text, style) =>
      c.mtmFlag
        ? {
            stack: [
              { text, style },
              { text: "MTM", style: "badge" },
            ],
            fillColor: fill,
          }
        : { text, style, fillColor: fill };
    const statusCell =
      mtmHost === "status"
        ? withMtm(statusText, "cell")
        : { text: statusText, style: "cell", fillColor: fill };

    const dynamicCells = dynamicCols.map((col) => {
      const v = col.get(r);
      return {
        text: v == null ? DASH : money2(v),
        style: "cell",
        alignment: "right",
        fillColor: fill,
      };
    });

    const unitStyle = c.unitAbsent ? "cellMuted" : "cell";
    const unitBold = !c.unitAbsent;
    const cellByKey = {
      unit:
        mtmHost === "unit"
          ? c.mtmFlag
            ? {
                stack: [
                  { text: c.unit, style: unitStyle, bold: unitBold },
                  { text: "MTM", style: "badge" },
                ],
                fillColor: fill,
              }
            : {
                text: c.unit,
                style: unitStyle,
                bold: unitBold,
                fillColor: fill,
              }
          : { text: c.unit, style: unitStyle, bold: unitBold, fillColor: fill },
      unitType: { text: c.unitType, style: "cellMuted", fillColor: fill },
      unitSf: {
        text: c.unitSf,
        style: "cellMuted",
        alignment: "right",
        fillColor: fill,
      },
      bedspaceSf: {
        text: c.bedspaceSf,
        style: "cellMuted",
        alignment: "right",
        fillColor: fill,
      },
      leasedAs: { text: c.leasedAs, style: "cellMuted", fillColor: fill },
      spaceOption: { text: c.spaceOption, style: "cellMuted", fillColor: fill },
      tenant: { stack: tenantStack, fillColor: fill },
      leaseStart: { text: c.leaseStart, style: "cellMuted", fillColor: fill },
      leaseEnd:
        mtmHost === "leaseEnd"
          ? c.leaseEnd === MTM_MARKER
            ? { text: MTM_MARKER, style: "badge", fillColor: fill }
            : withMtm(c.leaseEnd, "cellMuted")
          : { text: c.leaseEnd, style: "cellMuted", fillColor: fill },
      gpr: {
        text: c.gpr,
        style: "cellMuted",
        alignment: "right",
        fillColor: fill,
      },
      deposit: {
        text: c.deposit,
        style: "cell",
        alignment: "right",
        fillColor: fill,
      },
      rentCharges: { stack: rentStack, fillColor: fill },
      totalCharges: {
        text: c.totalCharges,
        style: "cell",
        alignment: "right",
        fillColor: fill,
      },
      unitStatus:
        mtmHost === "unitStatus"
          ? withMtm(c.unitStatus, "cellMuted")
          : { text: c.unitStatus, style: "cellMuted", fillColor: fill },
      status: statusCell,
    };

    let d = 0;
    body.push(
      columns.map((col) => {
        if (col.charge || col.netEffective) return dynamicCells[d++];
        const cell = cellByKey[col.key];
        if (!cell)
          throw new Error("rentRollTable: no PDF cell for column " + col.key);
        return cell;
      }),
    );
  });

  const totals = buildColumnTotals(rows, columns);
  if (rows.length && !(tableOptions && tableOptions.suppressTotals)) {
    body.push(
      columns.map((col, i) => {
        if (i === 0) return { text: "Totals", style: "subtotalCell" };
        const entry = totals.get(col.key);
        if (!entry) return { text: "", style: "subtotalCell" };
        const label = totalCoverageLabel(entry);
        return {
          stack: [
            {
              text: entry.sum == null ? DASH : money2(entry.sum),
              style: "subtotalCell",
              alignment: "right",
            },
            ...(label
              ? [{ text: label, style: "cellMuted", alignment: "right" }]
              : []),
          ],
          fillColor: BRAND_SUBTOTAL_FILL,
        };
      }),
    );
  }

  return {
    table: {
      headerRows: 1,
      widths: rentRollPdfWidths(columns),
      body,
    },
    layout: {
      hLineWidth: (i) => (i === 0 || i === 1 ? 0.75 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => "#d7dbe0",
      paddingTop: () => 3,
      paddingBottom: () => 3,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
    margin: [0, 4, 0, 0],
  };
}

function summaryPercent(fraction) {
  return fraction == null ? DASH : (fraction * 100).toFixed(2) + "%";
}

function summaryMoney(amount) {
  return amount == null ? DASH : money2(amount);
}

function summaryCell(text, style, alignment) {
  return {
    text,
    style,
    ...(alignment ? { alignment } : {}),
  };
}

function summaryTable(headers, body, widths, boundaryRows, totalRow) {
  return {
    table: {
      headerRows: 1,
      widths,
      body: [headers.map((text) => ({ text, style: "tableHeader" })), ...body],
    },
    layout: {
      hLineWidth: (index) => {
        if (index === 0) return 0.75;
        if (index === totalRow) return 1.5;
        if (boundaryRows.has(index)) return 0.75;
        return 0.4;
      },
      vLineWidth: () => 0,
      hLineColor: () => "#d7dbe0",
      paddingTop: () => 3,
      paddingBottom: () => 3,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
  };
}

function rentRollSummaryContent({ rows, chargeColumns }) {
  const hasChargeColumns = Array.isArray(chargeColumns);
  const summary = buildRentRollSummary({ rows, chargeColumns });
  const statusBody = [];
  const statusBoundaries = new Set();
  let statusTotalRow = -1;
  summary.status.entries.forEach((entry, index) => {
    const isSubtotal = entry.kind === "subtotal" || entry.kind === "derived";
    const style =
      entry.kind === "total"
        ? "totalCell"
        : isSubtotal
          ? "subtotalCell"
          : "cell";
    if (isSubtotal || entry.kind === "total") statusBoundaries.add(index + 1);
    if (entry.kind === "total") statusTotalRow = index + 1;
    statusBody.push([
      summaryCell(entry.description, style),
      summaryCell(entry.count, style, "right"),
      summaryCell(summaryPercent(entry.percent), style, "right"),
    ]);
  });

  const summaryColumns = [
    {
      width: "*",
      stack: [
        {
          text: "Status Summary",
          style: "sectionHeader",
          margin: [0, 0, 0, 4],
        },
        summaryTable(
          ["Description", "Unit Count", "Percent"],
          statusBody,
          ["*", 58, 52],
          statusBoundaries,
          statusTotalRow,
        ),
      ],
    },
  ];

  if (hasChargeColumns) {
    const chargeBody = [];
    const chargeBoundaries = new Set();
    let chargeRow = 0;
    const chargeRanges = [];
    summary.charges.groups.forEach((group) => {
      chargeBody.push([
        { text: "Ledger: " + group.ledger, style: "subtotalCell", colSpan: 4 },
        {},
        {},
        {},
      ]);
      chargeRow += 1;
      const detailStart = chargeRow;
      group.entries.forEach((entry) => {
        chargeBody.push([
          summaryCell(entry.label, "cell"),
          summaryCell(summaryMoney(entry.scheduled), "cell", "right"),
          summaryCell(entry.type || DASH, "cell"),
          summaryCell(DASH, "cell", "right"),
        ]);
        chargeRow += 1;
      });
      chargeRanges.push({ start: detailStart, length: group.entries.length });
      chargeBody.push([
        summaryCell("Total Scheduled Charges", "subtotalCell"),
        summaryCell(
          summaryMoney(group.subtotal.scheduled),
          "subtotalCell",
          "right",
        ),
        summaryCell("", "subtotalCell"),
        summaryCell(DASH, "subtotalCell", "right"),
      ]);
      chargeRow += 1;
      chargeBoundaries.add(chargeRow);
    });
    chargeBody.push([
      summaryCell("Grand Total", "totalCell"),
      summaryCell(
        summaryMoney(summary.charges.total.scheduled),
        "totalCell",
        "right",
      ),
      summaryCell("", "totalCell"),
      summaryCell(DASH, "totalCell", "right"),
    ]);
    chargeRow += 1;
    chargeBoundaries.add(chargeRow);
    summaryColumns.push({
      width: "*",
      stack: [
        {
          text: "Charge Code Summary",
          style: "sectionHeader",
          margin: [0, 0, 0, 4],
        },
        summaryTable(
          ["Charge Code", "Scheduled", "Charge Code Type", "Actual"],
          chargeBody,
          ["*", 66, 76, 52],
          chargeBoundaries,
          chargeRow,
        ),
      ],
    });
  }

  const content = [
    { text: "Summary", style: "sectionHeader", margin: [0, 10, 0, 4] },
    { columns: summaryColumns, columnGap: 12 },
    {
      text: STATUS_SUMMARY_BASIS_NOTE,
      style: "cellMuted",
      margin: [0, 6, 0, 0],
    },
  ];
  if (hasChargeColumns) {
    content.push(
      {
        text: CHARGE_SUMMARY_ACTUAL_NOTE,
        style: "cellMuted",
        margin: [0, 3, 0, 0],
      },
      {
        text: CHARGE_SUMMARY_LEDGER_NOTE,
        style: "cellMuted",
        margin: [0, 3, 0, 0],
      },
    );
  }
  return content;
}

function unassignedSectionContent(rows, chargeColumns, columnOptions) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  return [
    {
      text: UNASSIGNED_SECTION_HEADING,
      style: "sectionHeader",
      margin: [0, 14, 0, 4],
    },
    { text: UNASSIGNED_SECTION_NOTE, style: "cellMuted", margin: [0, 0, 0, 6] },
    rentRollTable(list, chargeColumns, columnOptions, { suppressTotals: true }),
  ];
}

export function buildRentRollDocDefinition({
  rows,
  summary,
  property,
  asOf,
  subtitle,
  title,
  chargeColumns,
  orgName,
  preparedFor,
  generatedAt,
  capturedRentTotal,
  kpiRows,
  occupancy,
  columnOptions,
  unassignedRows,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const unassignedList = Array.isArray(unassignedRows) ? unassignedRows : [];
  const propertyName = (property && property.name) || "";
  const reportTitle = title || "Rent Roll";
  const unitStatusRendered = rentRollPdfColumns(
    buildRentRollColumns(chargeColumns || [], columnOptions || {}),
  ).some((c) => c && c.key === "unitStatus");
  const baseSubLine = subtitle || rentRollFreshnessSubtitle(asOf);
  const subLine =
    unitStatusRendered && !/reflects today/.test(baseSubLine)
      ? baseSubLine + " · Unit Status reflects today, not the as-of date"
      : baseSubLine;

  const addressee = typeof preparedFor === "string" ? preparedFor.trim() : "";
  const preparedForBlock = addressee
    ? [
        {
          text: `Prepared for: ${addressee}`,
          style: "preparedFor",
          margin: [0, 0, 0, 6],
        },
      ]
    : [];

  if (list.length === 0) {
    return buildDocShell({
      propertyName,
      reportTitle,
      periodLabel: subLine,
      orgName,
      content: [
        { text: subLine, style: "reportSubtitle", margin: [0, 0, 0, 12] },
        ...preparedForBlock,
        ...(unassignedList.length
          ? unassignedSectionContent(
              unassignedList,
              chargeColumns,
              columnOptions,
            )
          : [
              {
                text: "No Entrata rent-roll data has been synced for this property yet. Sync the Entrata connector, then re-export.",
                style: "noteBox",
              },
            ]),
      ],
    });
  }

  const kpiList = Array.isArray(kpiRows) ? kpiRows : list;
  const k = computeRentRollKpis(kpiList, { occupancy });

  const content = [
    { text: subLine, style: "reportSubtitle", margin: [0, 0, 0, 2] },
    ...preparedForBlock,
    ...rentRollSummaryContent({
      rows: list,
      chargeColumns,
    }),
    { text: "Unit Details", style: "sectionHeader", margin: [0, 10, 0, 4] },
    ...(isByUnitRoll(list)
      ? [
          {
            text: byUnitBasisSentence(list),
            style: "cellMuted",
            margin: [0, 0, 0, 4],
          },
        ]
      : []),
    rentRollTable(list, chargeColumns, columnOptions),
    ...(() => {
      const sentence = rentTotalCoverageSentence(rentColumnTotal(list), {
        noun: k.noun,
      });
      return sentence
        ? [{ text: sentence, style: "cellMuted", margin: [0, 4, 0, 0] }]
        : [];
    })(),
    ...(() => {
      const sentence = pdfWidthDropSentence(
        rentRollPdfColumnPlan(
          buildRentRollColumns(chargeColumns, columnOptions || {}),
        ),
      );
      return sentence
        ? [{ text: sentence, style: "cellMuted", margin: [0, 6, 0, 0] }]
        : [];
    })(),
    ...unassignedSectionContent(unassignedList, chargeColumns, columnOptions),
  ];

  const adjustmentsApplied = k.adjustedCount + k.addedCount;
  if (adjustmentsApplied > 0) {
    content.push({
      text:
        "Reflecting " +
        adjustmentsApplied +
        " adjustment" +
        (adjustmentsApplied === 1 ? "" : "s") +
        ": " +
        k.adjustedCount +
        " adjusted, " +
        k.addedCount +
        " off-Entrata. Raw Entrata fields are preserved; overrides layer on top.",
      style: "cellMuted",
      margin: [0, 8, 0, 0],
    });
  }

  return buildDocShell({
    propertyName,
    reportTitle,
    periodLabel: subLine,
    content,
    pageOrientation: "landscape",
    orgName,
    pageSize: PDF_PAGE_SIZE,
    marginX: PDF_MARGIN_X,
    footerNote: rentRollProvenanceLine(generatedAt, asOf),
  });
}

export const _RENT_ROLL_HEADER_NAVY = BRAND_NAVY;
