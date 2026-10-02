import {
  buildDocShell,
  printableWidth,
  BRAND_NAVY,
  BRAND_MUTED,
  BRAND_TEXT,
  BRAND_SUBTOTAL_FILL,
  BRAND_STRIPE,
} from "./valianceLetterhead.js";

const DASH = "—";
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function fsFmtMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return DASH;
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

export function fsFmtMonth(iso) {
  if (!iso || typeof iso !== "string") return DASH;
  const [y, m] = iso.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${y}` : iso;
}

export const NOT_CONNECTED_NOTE =
  "This property is not connected to Entrata, and these statements are rendered from the synced Entrata GL. " +
  "Properties whose ledger lives outside Entrata report through the budget and variance surfaces instead. " +
  "An admin can review the connection under Admin Console → Integrations.";

export function incomeStatementRows(isModel) {
  if (!isModel) return [];
  const months = isModel.months || [];
  const out = [];
  const pushSection = (section, displaySign) => {
    if (!section) return;
    out.push({ kind: "section", label: section.name });
    const collapsed = !!section.collapsed;
    (section.branches || []).forEach((b) => {
      if (!collapsed) out.push({ kind: "branch", label: b.branchName });
      (b.accounts || []).forEach((a) => {
        out.push({
          kind: "account",
          label: accountLabel(a),
          cells: months.map((m) => fsFmtMoney(a.byMonth[m] * displaySign)),
          total: fsFmtMoney(a.total * displaySign),
        });
      });
      if (b.showSummaryRow && !collapsed) {
        out.push({
          kind: "subtotal",
          label: b.summaryRowName || `Total ${b.branchName}`,
          cells: months.map((m) =>
            fsFmtMoney(b.subtotal.byMonth[m] * displaySign),
          ),
          total: fsFmtMoney(b.subtotal.total * displaySign),
        });
      }
    });
    out.push({
      kind: "sectionTotal",
      label: `Total ${section.name}`,
      cells: months.map((m) =>
        fsFmtMoney(section.total.byMonth[m] * displaySign),
      ),
      total: fsFmtMoney(section.total.total * displaySign),
    });
  };

  pushSection(isModel.income, 1);
  pushSection(isModel.operatingExpenses, -1);
  out.push({
    kind: "grandTotal",
    label: "Net Operating Income",
    cells: months.map((m) => fsFmtMoney(isModel.noi.byMonth[m])),
    total: fsFmtMoney(isModel.noi.total),
  });
  if (
    isModel.otherExpenses &&
    (isModel.otherExpenses.branches || []).length > 0
  ) {
    pushSection(isModel.otherExpenses, -1);
  }
  const netIncomeBeforeAdj =
    isModel.netIncomeBeforeAdjustments || isModel.netIncome;
  out.push({
    kind: "grandTotal",
    label: "Net Income",
    cells: months.map((m) => fsFmtMoney(netIncomeBeforeAdj.byMonth[m])),
    total: fsFmtMoney(netIncomeBeforeAdj.total),
  });
  if (isModel.adjustments && (isModel.adjustments.branches || []).length > 0) {
    pushSection(isModel.adjustments, -1);
    const adjusted = isModel.adjustedNetIncome || isModel.netIncome;
    out.push({
      kind: "grandTotal",
      label: "Adjusted Net Income",
      cells: months.map((m) => fsFmtMoney(adjusted.byMonth[m])),
      total: fsFmtMoney(adjusted.total),
    });
  }
  if (!isModel.hasNoiCoverage) {
    out.push({
      kind: "footnote",
      label:
        "The NOI line sums accounts carrying a workbook NOI bucket; none are bucketed in this window, so it reads 0.00.",
    });
  }
  return out;
}

export function balanceSheetRows(bsModel) {
  if (!bsModel) return [];
  const out = [];
  (bsModel.sections || []).forEach((section) => {
    out.push({ kind: "section", label: section.name });
    (section.branches || []).forEach((b) => {
      out.push({ kind: "branch", label: b.branchName });
      (b.accounts || []).forEach((a) => {
        out.push({
          kind: "account",
          label: a.accountNumber
            ? `${a.accountNumber} ${a.accountName}`
            : a.accountName,
          balance: fsFmtMoney(a.display),
          lastObserved: fsFmtMonth(a.balanceMonth),
        });
      });
      if (b.showSummaryRow) {
        out.push({
          kind: "subtotal",
          label: b.summaryRowName || `Total ${b.branchName}`,
          balance: fsFmtMoney(b.subtotal.display),
          lastObserved: "",
        });
      }
    });
    out.push({
      kind: "sectionTotal",
      label: `Total ${section.name}`,
      balance: fsFmtMoney(section.total.display),
      lastObserved: "",
    });
  });
  return out;
}

export function balanceSheetIdentity(bsModel) {
  if (!bsModel || !bsModel.identity) return null;
  const id = bsModel.identity;
  const verifiable = id.verifiable !== false;
  const balanced = verifiable && !!id.balanced;
  return {
    label: "Balance check",
    status: !verifiable
      ? "Not verifiable"
      : balanced
        ? "In balance"
        : `Out of balance by ${fsFmtMoney(id.delta)}`,
    detail: !verifiable
      ? `${id.missingBalances || "One or more"} account balance(s) unavailable — the identity cannot be checked`
      : `Assets ${fsFmtMoney(id.assets)} vs Liabilities + Equity ${fsFmtMoney(id.liabilitiesPlusEquity)}`,
    balanced,
    verifiable,
  };
}

function accountLabel(a) {
  return a.accountNumber != null && a.accountNumber !== ""
    ? `${a.accountNumber} ${a.accountName}`
    : a.accountName;
}

function fillCells(n) {
  return Array.from({ length: n }, () => ({}));
}

const IS_BASE_FONT = 8.5;
const IS_MIN_FONT = 7;
const IS_MAX_ROW_FONT = 9.5;
const IS_LABEL_MIN = 96;
const IS_VALUE_GUTTER = 2;
const MAX_PORTRAIT_MONTHS = 4;

const ROBOTO_ADV = {
  digit: 0.56836,
  ",": 0.22363,
  ".": 0.27783,
  "(": 0.34619,
  ")": 0.34961,
  "—": 0.77051,
  " ": 0.24854,
  "-": 0.33984,
};
const ROBOTO_ADV_FALLBACK = 0.72;

export function isTextWidth(s, fontSize) {
  let em = 0;
  for (const ch of String(s == null ? "" : s)) {
    if (ch >= "0" && ch <= "9") em += ROBOTO_ADV.digit;
    else em += ROBOTO_ADV[ch] != null ? ROBOTO_ADV[ch] : ROBOTO_ADV_FALLBACK;
  }
  return em * fontSize;
}

export function isTableOffsets(nCols, padX) {
  return 2 * nCols * padX;
}

function repeat(n, v) {
  return Array.from({ length: n }, () => v);
}

function headFontFor(fontSize) {
  const scale = fontSize / IS_BASE_FONT;
  return Math.max(6, Math.round(7.5 * scale * 10) / 10);
}

export function widestValueTexts(rows) {
  const widest = (initial, pick) => {
    let best = initial;
    let bestEm = isTextWidth(initial, 1);
    (rows || []).forEach((r) => {
      pick(r).forEach((s) => {
        if (s == null || s === "") return;
        const w = isTextWidth(s, 1);
        if (w > bestEm) {
          bestEm = w;
          best = s;
        }
      });
    });
    return best;
  };
  return {
    month: widest("0.00", (r) => r.cells || []),
    total: widest("0.00", (r) => (r.total ? [r.total] : [])),
  };
}

function widestHeaderTokenEm(headerTexts) {
  let em = 0;
  (headerTexts || []).forEach((t) => {
    String(t == null ? "" : t)
      .split(/\s+/)
      .forEach((tok) => {
        const w = isTextWidth(tok, 1);
        if (w > em) em = w;
      });
  });
  return em;
}

const IS_CONFIGS = [
  {
    orientation: "portrait",
    fontSize: 8.5,
    padX: 6,
    maxMonths: MAX_PORTRAIT_MONTHS,
  },
  { orientation: "landscape", fontSize: 8.5, padX: 6 },
  { orientation: "landscape", fontSize: 8, padX: 5 },
  { orientation: "landscape", fontSize: 7.5, padX: 4 },
  { orientation: "landscape", fontSize: IS_MIN_FONT, padX: 3 },
];

function budgetFor(orientation, nCols, padX) {
  return printableWidth(orientation) - isTableOffsets(nCols, padX);
}

function colWidthFor(cfg, text, headTokenEm) {
  const scale = cfg.fontSize / IS_BASE_FONT;
  const moneyW = isTextWidth(text, IS_MAX_ROW_FONT * scale);
  const headW = headTokenEm * headFontFor(cfg.fontSize);
  return Math.ceil(Math.max(moneyW, headW) + IS_VALUE_GUTTER);
}

function fitConfig(cfg, nMonths, widest, headTokenEm) {
  const monthW = colWidthFor(cfg, widest.month, headTokenEm);
  const totalW = colWidthFor(cfg, widest.total, headTokenEm);
  const budget = budgetFor(cfg.orientation, nMonths + 2, cfg.padX);
  if (budget - (nMonths * monthW + totalW) < IS_LABEL_MIN) return null;
  return {
    orientation: cfg.orientation,
    fontSize: cfg.fontSize,
    padX: cfg.padX,
    monthW,
    totalW,
  };
}

function widthsFor(fit, nMonths) {
  const budget = budgetFor(fit.orientation, nMonths + 2, fit.padX);
  const labelW = budget - (nMonths * fit.monthW + fit.totalW);
  return [labelW, ...repeat(nMonths, fit.monthW), fit.totalW];
}

function solveIsFit(nMonths, widest, headTokenEm) {
  for (const cfg of IS_CONFIGS) {
    if (cfg.maxMonths != null && nMonths > cfg.maxMonths) continue;
    const f = fitConfig(cfg, nMonths, widest, headTokenEm);
    if (f) return f;
  }
  return null;
}

function forcedFit() {
  const cfg = IS_CONFIGS[IS_CONFIGS.length - 1];
  const budget = budgetFor(cfg.orientation, 3, cfg.padX);
  const w = Math.max(8, Math.floor((budget - IS_LABEL_MIN) / 2));
  return {
    orientation: cfg.orientation,
    fontSize: cfg.fontSize,
    padX: cfg.padX,
    monthW: w,
    totalW: w,
  };
}

export function planIncomeStatementLayout({
  nMonths,
  widest,
  headerTexts,
} = {}) {
  const n = Math.max(0, Number(nMonths) || 0);
  const w = {
    month: (widest && widest.month) || "0.00",
    total: (widest && widest.total) || "0.00",
  };
  const headTokenEm = widestHeaderTokenEm(headerTexts);

  let nChunks = 1;
  let fit = solveIsFit(n, w, headTokenEm);
  if (!fit && n > 1) {
    for (let c = 2; c <= n; c++) {
      fit = solveIsFit(Math.ceil(n / c), w, headTokenEm);
      if (fit) {
        nChunks = c;
        break;
      }
    }
  }
  if (!fit) {
    nChunks = n || 1;
    fit = forcedFit();
  }

  const chunks = [];
  if (n === 0) {
    chunks.push({ start: 0, end: 0, widths: widthsFor(fit, 0) });
  } else {
    const base = Math.floor(n / nChunks);
    const extra = n % nChunks;
    let start = 0;
    for (let i = 0; i < nChunks; i++) {
      const end = start + base + (i < extra ? 1 : 0);
      chunks.push({ start, end, widths: widthsFor(fit, end - start) });
      start = end;
    }
  }
  return {
    orientation: fit.orientation,
    monthFontSize: fit.fontSize,
    padX: fit.padX,
    monthW: fit.monthW,
    totalW: fit.totalW,
    chunks,
  };
}

function isHeaderTexts(isModel) {
  const months = (isModel && isModel.months) || [];
  const origins = (isModel && isModel.monthOrigins) || null;
  return months
    .map((m) =>
      origins && origins[m]
        ? `${fsFmtMonth(m)} (${origins[m]})`
        : fsFmtMonth(m),
    )
    .concat("Total");
}

function isTable(isModel, plan, chunk) {
  const allMonths = isModel.months || [];
  const months = allMonths.slice(chunk.start, chunk.end);
  const nCols = months.length + 2;
  const rows = incomeStatementRows(isModel);
  const scale = plan.monthFontSize / IS_BASE_FONT;
  const headFont = headFontFor(plan.monthFontSize);

  const header = [
    { text: "Line", style: "fsHead", alignment: "left", fontSize: headFont },
  ];
  months.forEach((m) => {
    const cell = {
      text: fsFmtMonth(m),
      style: "fsHead",
      alignment: "right",
      fontSize: headFont,
    };
    if (isModel.monthOrigins && isModel.monthOrigins[m]) {
      cell.text = `${fsFmtMonth(m)} (${isModel.monthOrigins[m]})`;
    }
    header.push(cell);
  });
  header.push({
    text: "Total",
    style: "fsHead",
    alignment: "right",
    fontSize: headFont,
  });

  const body = [header];
  rows.forEach((r) => {
    if (r.kind === "section") {
      body.push([
        { text: r.label, style: "fsSection", colSpan: nCols },
        ...fillCells(nCols - 1),
      ]);
    } else if (r.kind === "branch") {
      body.push([
        { text: r.label, style: "fsBranch", colSpan: nCols },
        ...fillCells(nCols - 1),
      ]);
    } else if (r.kind === "footnote") {
      body.push([
        { text: r.label, style: "fsFootnote", colSpan: nCols },
        ...fillCells(nCols - 1),
      ]);
    } else {
      const rowStyle = dataRowStyle(r.kind, scale);
      const label = { text: r.label, ...rowStyle };
      label.alignment = "left";
      if (r.kind === "account") label.margin = [14, 0, 0, 0];
      const line = [label];
      r.cells
        .slice(chunk.start, chunk.end)
        .forEach((c) =>
          line.push({ text: c, ...rowStyle, alignment: "right" }),
        );
      line.push({ text: r.total, ...rowStyle, alignment: "right" });
      body.push(line);
    }
  });

  return {
    table: { headerRows: 1, widths: chunk.widths, body },
    layout: makeFsLayout(plan.padX),
    margin: [0, 4, 0, 0],
  };
}

function bsTable(bsModel, orientation = "portrait") {
  const rows = balanceSheetRows(bsModel);
  const identity = balanceSheetIdentity(bsModel);
  const balanceHead =
    "Balance" + (bsModel.asOf ? ` (as of ${fsFmtMonth(bsModel.asOf)})` : "");
  const widths = orientation === "landscape" ? ["*", 130, 110] : [280, "*", 90];

  const body = [
    [
      { text: "Line", style: "fsHead", alignment: "left" },
      { text: balanceHead, style: "fsHead", alignment: "right" },
      { text: "Last observed", style: "fsHead", alignment: "right" },
    ],
  ];

  rows.forEach((r) => {
    if (r.kind === "section") {
      body.push([{ text: r.label, style: "fsSection", colSpan: 3 }, {}, {}]);
    } else if (r.kind === "branch") {
      body.push([{ text: r.label, style: "fsBranch", colSpan: 3 }, {}, {}]);
    } else {
      const rowStyle = dataRowStyle(r.kind);
      const label = { text: r.label, ...rowStyle, alignment: "left" };
      if (r.kind === "account") label.margin = [14, 0, 0, 0];
      body.push([
        label,
        { text: r.balance, ...rowStyle, alignment: "right" },
        { text: r.lastObserved, ...rowStyle, alignment: "right" },
      ]);
    }
  });

  if (identity) {
    body.push([
      {
        text: [
          { text: "Balance check  ", bold: true, color: BRAND_NAVY },
          {
            text: identity.status,
            color: identity.balanced ? "#2f855a" : "#b7791f",
            bold: true,
          },
        ],
        fontSize: 8.5,
        fillColor: BRAND_SUBTOTAL_FILL,
      },
      {
        text: identity.detail,
        colSpan: 2,
        bold: true,
        fontSize: 8.5,
        color: BRAND_NAVY,
        alignment: "right",
        fillColor: BRAND_SUBTOTAL_FILL,
      },
      {},
    ]);
  }

  return {
    table: { headerRows: 1, widths, body },
    layout: makeFsLayout(6),
    margin: [0, 4, 0, 0],
  };
}

function dataRowStyle(kind, scale = 1) {
  const s = (n) => Math.round(n * scale * 10) / 10;
  switch (kind) {
    case "account":
      return { fontSize: s(8.5), color: BRAND_TEXT };
    case "subtotal":
      return { fontSize: s(8.5), bold: true, color: BRAND_TEXT };
    case "sectionTotal":
      return {
        fontSize: s(9),
        bold: true,
        color: BRAND_NAVY,
        fillColor: BRAND_STRIPE,
      };
    case "grandTotal":
      return {
        fontSize: s(9.5),
        bold: true,
        color: BRAND_NAVY,
        fillColor: BRAND_SUBTOTAL_FILL,
      };
    default:
      return { fontSize: s(8.5), color: BRAND_TEXT };
  }
}

function makeFsLayout(padX) {
  return {
    hLineWidth: (i) => (i === 0 || i === 1 ? 0.75 : 0.3),
    vLineWidth: () => 0,
    hLineColor: () => "#d7dbe0",
    paddingTop: () => 2.5,
    paddingBottom: () => 2.5,
    paddingLeft: () => padX,
    paddingRight: () => padX,
  };
}

const FS_STYLES = {
  fsHead: {
    fontSize: 7.5,
    bold: true,
    color: "#ffffff",
    fillColor: BRAND_NAVY,
    characterSpacing: 0.3,
  },
  fsSection: {
    fontSize: 10,
    bold: true,
    color: BRAND_NAVY,
    margin: [0, 4, 0, 1],
  },
  fsBranch: {
    fontSize: 8.5,
    bold: true,
    color: BRAND_MUTED,
    margin: [4, 2, 0, 0],
  },
  fsFootnote: {
    fontSize: 7.5,
    italics: true,
    color: BRAND_MUTED,
    margin: [0, 3, 0, 0],
  },
};

function defaultPeriodLabel(isModel, bsModel) {
  const months = (isModel && isModel.months) || [];
  if (months.length) {
    const a = fsFmtMonth(months[0]);
    const b = fsFmtMonth(months[months.length - 1]);
    return a === b ? a : `${a} – ${b}`;
  }
  if (bsModel && bsModel.asOf) return `As of ${fsFmtMonth(bsModel.asOf)}`;
  return "";
}

export function buildFinancialStatementDocDefinition({
  incomeStatement = null,
  balanceSheet = null,
  property = null,
  period = null,
  notConnected = false,
  notConnectedNote = NOT_CONNECTED_NOTE,
  orgName = null,
} = {}) {
  const propertyName = (property && property.name) || "";
  const reportTitle = "Financial Statements";
  const periodLabel =
    typeof period === "string"
      ? period
      : (period && period.label) ||
        defaultPeriodLabel(incomeStatement, balanceSheet);

  if (notConnected) {
    return buildDocShell({
      propertyName,
      reportTitle,
      periodLabel: periodLabel || "",
      content: [{ text: notConnectedNote, style: "noteBox" }],
      orgName,
    });
  }

  const hasIs = !!(incomeStatement && (incomeStatement.months || []).length);
  const hasBs = !!(balanceSheet && (balanceSheet.sections || []).length);

  if (!hasIs && !hasBs) {
    return buildDocShell({
      propertyName,
      reportTitle,
      periodLabel: periodLabel || "",
      content: [
        {
          text:
            "No GL actuals or stored balances are available for this property in the selected window. " +
            "Coverage follows the synced Entrata GL window; deeper history lands with the connector backfill.",
          style: "noteBox",
        },
      ],
      orgName,
    });
  }

  const isRows = hasIs ? incomeStatementRows(incomeStatement) : [];
  const nMonths = hasIs ? (incomeStatement.months || []).length : 0;
  const plan = hasIs
    ? planIncomeStatementLayout({
        nMonths,
        widest: widestValueTexts(isRows),
        headerTexts: isHeaderTexts(incomeStatement),
      })
    : null;
  const orientation = plan ? plan.orientation : "portrait";

  const content = [];
  if (hasIs) {
    const months = incomeStatement.months || [];
    content.push({
      text: "Income Statement",
      style: "sectionHeader",
      margin: [0, 2, 0, 2],
    });
    content.push({
      text: "Rendered in Entrata’s Master GL Tree layout, from the synced Entrata GL. Closed months only.",
      style: "reportSubtitle",
      margin: [0, 0, 0, 4],
    });
    plan.chunks.forEach((chunk, i) => {
      if (plan.chunks.length > 1) {
        const from = fsFmtMonth(months[chunk.start]);
        const to = fsFmtMonth(months[chunk.end - 1]);
        content.push({
          text:
            `${from} – ${to} (columns ${chunk.start + 1}–${chunk.end} of ${months.length}). ` +
            "The Total column covers the full period.",
          style: "reportSubtitle",
          margin: [0, i === 0 ? 0 : 10, 0, 2],
          pageBreak: i === 0 ? undefined : "before",
        });
      }
      content.push(isTable(incomeStatement, plan, chunk));
    });
  }
  if (hasBs) {
    content.push({
      text: "Balance Sheet",
      style: "sectionHeader",
      margin: [0, 12, 0, 2],
      pageBreak: hasIs ? "before" : undefined,
    });
    content.push(bsTable(balanceSheet, orientation));
  }

  return buildDocShell({
    propertyName,
    reportTitle,
    periodLabel: periodLabel || "",
    content,
    styles: FS_STYLES,
    pageOrientation: orientation,
    orgName,
  });
}
