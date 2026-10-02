export const BRAND_NAVY = "#0a1628";
export const BRAND_GOLD = "#c9a84c";
export const BRAND_TEXT = "#1f2933";
export const BRAND_MUTED = "#6b7280";
export const BRAND_BORDER = "#d7dbe0";
export const BRAND_STRIPE = "#f4f6f8";
export const BRAND_SUBTOTAL_FILL = "#eef1f4";

export const FIRM_NAME = "Valiance Capital";

export const VALIANCE_LOGO_PNG_DATAURI = null;
export const LOGO_WIDTH = 150;

const LETTER_SHORT = 612;
const LETTER_LONG = 792;
const PAGE_WIDTH = LETTER_SHORT;

const LEGAL_SHORT = 612;
const LEGAL_LONG = 1008;

const TABLOID_SHORT = 792;
const TABLOID_LONG = 1224;

const PAGE_DIMENSIONS = {
  LETTER: { short: LETTER_SHORT, long: LETTER_LONG },
  LEGAL: { short: LEGAL_SHORT, long: LEGAL_LONG },
  TABLOID: { short: TABLOID_SHORT, long: TABLOID_LONG },
};
export const MARGIN_X = 40;

export const NARROW_MARGIN_X = 18;

export function printableWidth(
  orientation,
  pageSize = "LETTER",
  marginX = MARGIN_X,
) {
  const dims = PAGE_DIMENSIONS[pageSize] || PAGE_DIMENSIONS.LETTER;
  const w = orientation === "landscape" ? dims.long : dims.short;
  return w - marginX * 2;
}

function brandCell(orgName, marginX = MARGIN_X) {
  if (VALIANCE_LOGO_PNG_DATAURI) {
    return {
      image: VALIANCE_LOGO_PNG_DATAURI,
      width: LOGO_WIDTH,
      margin: [marginX, 24, 0, 0],
    };
  }
  return {
    stack: [
      { text: String(orgName || FIRM_NAME).toUpperCase(), style: "wordmark" },
      { text: "Commercial Real Estate", style: "wordmarkSub" },
    ],
    margin: [marginX, 26, 0, 0],
  };
}

export function buildLetterheadHeader({
  propertyName,
  reportTitle,
  periodLabel,
  orgName,
  marginX = MARGIN_X,
}) {
  return function header(currentPage, pageCount, pageSize) {
    const pageWidth = (pageSize && pageSize.width) || PAGE_WIDTH;
    return {
      stack: [
        {
          columns: [
            brandCell(orgName, marginX),
            {
              width: "*",
              stack: [
                { text: reportTitle || "", style: "headerTitle" },
                { text: propertyName || "", style: "headerProperty" },
                { text: periodLabel || "", style: "headerPeriod" },
              ],
              alignment: "right",
              margin: [0, 26, marginX, 0],
            },
          ],
        },
        {
          canvas: [
            {
              type: "line",
              x1: marginX,
              y1: 8,
              x2: pageWidth - marginX,
              y2: 8,
              lineWidth: 2,
              lineColor: BRAND_GOLD,
            },
          ],
        },
      ],
    };
  };
}

export function buildFooter(note, marginX = MARGIN_X) {
  return function footer(currentPage, pageCount, pageSize) {
    const contentWidth =
      ((pageSize && pageSize.width) || PAGE_WIDTH) - marginX * 2;
    return {
      margin: [marginX, 10, marginX, 0],
      stack: [
        {
          canvas: [
            {
              type: "line",
              x1: 0,
              y1: 0,
              x2: contentWidth,
              y2: 0,
              lineWidth: 0.5,
              lineColor: BRAND_BORDER,
            },
          ],
        },
        {
          columns: [
            { text: "Confidential & Proprietary", style: "footerLeft" },
            {
              text: `Page ${currentPage} of ${pageCount}`,
              style: "footerRight",
              alignment: "right",
            },
          ],
          margin: [0, 4, 0, 0],
        },
        ...(note
          ? [
              {
                text: note,
                style: "footerLeft",
                italics: false,
                margin: [0, 2, 0, 0],
              },
            ]
          : []),
      ],
    };
  };
}

export const LETTERHEAD_STYLES = {
  wordmark: {
    fontSize: 16,
    bold: true,
    color: BRAND_NAVY,
    characterSpacing: 1,
  },
  wordmarkSub: {
    fontSize: 7,
    color: BRAND_GOLD,
    characterSpacing: 2,
    margin: [0, 1, 0, 0],
  },
  headerTitle: { fontSize: 13, bold: true, color: BRAND_NAVY },
  headerProperty: { fontSize: 10, color: BRAND_TEXT, margin: [0, 1, 0, 0] },
  headerPeriod: { fontSize: 8.5, color: BRAND_MUTED, margin: [0, 1, 0, 0] },
  footerLeft: { fontSize: 7, color: BRAND_MUTED, italics: true },
  footerRight: { fontSize: 7, color: BRAND_MUTED },
  reportSubtitle: { fontSize: 8.5, color: BRAND_MUTED },
  preparedFor: { fontSize: 9, bold: true, color: BRAND_TEXT },
  sectionHeader: {
    fontSize: 11,
    bold: true,
    color: BRAND_NAVY,
    margin: [0, 12, 0, 4],
  },
  tableHeader: {
    fontSize: 8,
    bold: true,
    color: "#ffffff",
    fillColor: BRAND_NAVY,
  },
  cell: { fontSize: 8.5, color: BRAND_TEXT },
  cellMuted: { fontSize: 7.5, color: BRAND_MUTED },
  subtotalCell: {
    fontSize: 8.5,
    bold: true,
    color: BRAND_NAVY,
    fillColor: BRAND_SUBTOTAL_FILL,
  },
  totalCell: {
    fontSize: 9,
    bold: true,
    color: "#ffffff",
    fillColor: BRAND_NAVY,
  },
  noteBox: { fontSize: 9, color: BRAND_MUTED, italics: true },
  kpiLabel: { fontSize: 7.5, color: BRAND_MUTED, characterSpacing: 0.5 },
  kpiValue: { fontSize: 15, bold: true, color: BRAND_NAVY },
  badge: { fontSize: 6.5, color: BRAND_GOLD, bold: true },
};

export function buildDocShell({
  propertyName,
  reportTitle,
  periodLabel,
  content,
  styles,
  pageOrientation = "portrait",
  orgName,
  pageSize = "LETTER",
  footerNote,
  marginX = MARGIN_X,
}) {
  const firm = orgName || FIRM_NAME;
  return {
    pageSize,
    pageOrientation,
    pageMargins: [marginX, 104, marginX, footerNote ? 66 : 54],
    header: buildLetterheadHeader({
      propertyName,
      reportTitle,
      periodLabel,
      orgName: firm,
      marginX,
    }),
    footer: buildFooter(footerNote, marginX),
    content,
    styles: { ...LETTERHEAD_STYLES, ...(styles || {}) },
    defaultStyle: { font: "Roboto", fontSize: 9, color: BRAND_TEXT },
    info: {
      title: `${propertyName || firm}${reportTitle ? ` — ${reportTitle}` : ""}`,
      author: firm,
    },
  };
}

export function kpiRow(cards) {
  return {
    columns: cards.map((c) => ({
      width: "*",
      stack: [
        { text: c.label, style: "kpiLabel" },
        { text: c.value, style: "kpiValue", margin: [0, 2, 0, 0] },
        ...(c.sub
          ? [{ text: c.sub, style: "cellMuted", margin: [0, 1, 0, 0] }]
          : []),
      ],
      margin: [0, 0, 10, 0],
    })),
    columnGap: 8,
    margin: [0, 6, 0, 8],
  };
}
