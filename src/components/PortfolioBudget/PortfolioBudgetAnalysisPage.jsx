import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPortfolioBudgetCoaMonthly,
  fetchPortfolioBudgetNoiBuild,
  fetchPortfolioBudgetRunningBalances,
  fetchBudgetPropertyCodes,
  fetchOrgPropertyCount,
} from "../../lib/supabaseClient.js";
import {
  synthesizePortfolioNoiBuild,
  groupPortfolioCoaForGrid,
  groupPortfolioRunningBalancesForGrid,
  formatMonthLabel,
  portfolioScopeNote,
  PORTFOLIO_ZERO_LEGEND,
  portfolioZeroCellTitle,
  portfolioSubtotalCellTitle,
  portfolioBalanceCellTitle,
  countPortfolioGridAccounts,
  countPortfolioStatementAccounts,
  hidePortfolioZeroBalanceAccounts,
  buildPortfolioCoaStatementLayout,
  splitPortfolioCoaStatementExcluded,
  firstFiguredMonthIndex,
  trimLeadingEmptyMonths,
  PORTFOLIO_UNPLACED_NOTE,
  COA_ORPHAN_NOTE,
} from "../../lib/portfolioBudgetSurfaces.js";
import {
  splitNoiExcludedRows,
  noiExclusionTitle,
} from "../../lib/noiExclusions.js";
import { useNoiExclusions } from "../../lib/useNoiExclusions.js";
import { balanceCellContent } from "../../lib/budgetBalanceCell.js";
import { formatBudgetCell } from "../../lib/budgetCellFormat.js";
import StatementBandLabel from "../../lib/statementBandLabel.jsx";
import StatementStickyGrid from "../statements/StatementStickyGrid.jsx";
import StatementMonthGridHeader from "../statements/StatementMonthGridHeader.jsx";
import { statementHeaderCellStyle } from "../../lib/tableStyles.js";
import {
  statementRowPresentation,
  statementIndent,
} from "../../lib/statementPresentation.js";

const h = React.createElement;

const PORTFOLIO_BUDGET_TABS = [
  { key: "is", label: "Income Statement" },
  { key: "bs", label: "Balance Sheet" },
];
const PORTFOLIO_COMBINED_TOGGLE_LABEL = "Show both statements as one sheet";

const fmtBudgetCell = formatBudgetCell;

function statementPresence(row) {
  const present = row.amountPresentByMonth;
  const absent = row.absentByMonth;
  if (!present)
    return absent ? absent.map((a) => (a ? false : null)) : undefined;
  return present.map((p, i) =>
    absent && absent[i] ? false : p === undefined ? null : p,
  );
}
function fmtBudgetTotal(n) {
  const num = Number(n == null ? 0 : n);
  if (!Number.isFinite(num)) return "—";
  return Math.round(num).toLocaleString();
}

const CELL_BASE = {
  padding: "6px 10px",
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  whiteSpace: "nowrap",
};
function stickyAcct(rowBg, z) {
  return {
    position: "sticky",
    left: 0,
    background: rowBg,
    zIndex: z,
    minWidth: 90,
    maxWidth: 90,
  };
}
function stickyName(rowBg, z) {
  return {
    position: "sticky",
    left: 90,
    background: rowBg,
    zIndex: z,
    minWidth: 220,
    maxWidth: 220,
  };
}

const COVERAGE_TINT = {
  actual: { bg: "var(--ds-success-bg)", fg: "#047857" },
  mixed: { bg: "var(--ds-warning-bg)", fg: "var(--ds-warning-text)" },
  forecast: { bg: "transparent", fg: null },
};

function renderGridHeader(C, axis, leftLabel1, leftLabel2, coverage) {
  return h(StatementMonthGridHeader, {
    C,
    axis,
    leftLabel1,
    leftLabel2,
    secondRow: renderCoverageRow(C, axis, coverage),
  });
}

function renderCoverageRow(C, axis, coverage) {
  const rowBg = C.cardBg;
  const byIdx = new Map((coverage || []).map((c) => [c.month_index, c]));
  const covCell = (background) =>
    statementHeaderCellStyle(C, { row: 1, background });
  return h(
    "tr",
    { key: "coverage-strip" },
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          ...covCell(rowBg),
          ...stickyAcct(rowBg, 4),
          textAlign: "left",
          fontSize: 10,
          color: C.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        },
      },
      "Coverage",
    ),
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          ...covCell(rowBg),
          ...stickyName(rowBg, 4),
          textAlign: "left",
          fontSize: 10,
          color: C.textSecondary,
        },
      },
      "realized / contributing",
    ),
    ...axis.map((m) => {
      const c = byIdx.get(m.month_index) || {
        coverage: "forecast",
        property_count: 0,
        actual_property_count: 0,
      };
      const tint = COVERAGE_TINT[c.coverage] || COVERAGE_TINT.forecast;
      const label =
        c.property_count > 0
          ? `${c.actual_property_count}/${c.property_count}`
          : "—";
      return h(
        "td",
        {
          key: `cov-${m.month_index}`,
          style: {
            ...CELL_BASE,
            ...covCell(tint.bg === "transparent" ? rowBg : tint.bg),
            fontSize: 10,
            color: tint.fg || C.textSecondary,
            fontWeight: c.coverage === "actual" ? 700 : 500,
          },
          title: `${formatMonthLabel(m.month_end)}: ${c.actual_property_count} of ${c.property_count} properties realized (${c.coverage})`,
        },
        label,
      );
    }),
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          ...covCell(rowBg),
          borderLeft: `1px solid ${C.border}`,
        },
      },
      "",
    ),
  );
}

function bandLabel(label, leftPad) {
  return h(StatementBandLabel, { label, leftPad });
}

function renderSectionBand(C, key, label, axis, depth = 0) {
  const p = statementRowPresentation({
    kind: "header",
    headerKind: "section",
    depth,
  });
  return h(
    "tr",
    {
      key: `band-section-${key}`,
      "data-statement-heading": `section-${key}`,
      "data-statement-depth": depth,
      "data-statement-label": label,
    },
    h(
      "td",
      {
        colSpan: axis.length + 3,
        style: {
          padding: "10px 12px",
          paddingLeft: p.paddingLeft,
          background: C.subtleBg,
          color: C.textPrimary,
          fontSize: 12,
          fontWeight: p.fontWeight,
          textTransform: p.textTransform,
          letterSpacing: p.letterSpacing,
          borderTop: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
        },
      },
      bandLabel(label, p.paddingLeft),
    ),
  );
}

function renderBucketBand(C, key, label, axis, depth = 0, stackDepth = depth) {
  const p = statementRowPresentation({
    kind: "header",
    headerKind: "group",
    depth,
  });
  return h(
    "tr",
    {
      key: `band-bucket-${key}`,
      "data-statement-heading": `bucket-${key}`,
      "data-statement-depth": stackDepth,
      "data-statement-label": label,
    },
    h(
      "td",
      {
        colSpan: axis.length + 3,
        style: {
          padding: "6px 12px",
          paddingLeft: p.paddingLeft,
          background: "transparent",
          color: C.textSecondary,
          fontSize: 11,
          fontWeight: p.fontWeight,
          textTransform: p.textTransform,
          letterSpacing: p.letterSpacing,
          borderTop: `1px solid ${C.border}`,
        },
      },
      bandLabel(label, p.paddingLeft),
    ),
  );
}

function renderAccountRow(
  C,
  {
    keyPrefix,
    account,
    axis,
    valueByMonth,
    totalValue,
    activityByMonth,
    activityPresentByMonth,
    presentByMonth,
    depth = 0,
    exclusionNote = null,
  },
) {
  const rowBg = C.cardBg;
  const accountNameText = account.account_name || "\u2014";
  return h(
    "tr",
    {
      key: `${keyPrefix}-${account.account_number}`,
      style: { borderTop: `1px solid ${C.border}` },
    },
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          ...stickyAcct(rowBg, 1),
          textAlign: "left",
          fontFamily: "monospace",
          color: C.textPrimary,
        },
      },
      account.account_number || "",
    ),
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          ...stickyName(rowBg, 1),
          textAlign: "left",
          paddingLeft: statementRowPresentation({ kind: "account", depth })
            .paddingLeft,
          color: C.textPrimary,
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        title: account.account_name || "",
      },
      exclusionNote
        ? h(
            "span",
            {
              title: exclusionNote,
              style: {
                borderBottom: `1px dotted ${C.textSecondary}`,
                cursor: "help",
              },
            },
            accountNameText,
          )
        : accountNameText,
    ),
    ...axis.map((m, i) => {
      const presence = presentByMonth ? presentByMonth[i] : true;
      const activityPresence = activityPresentByMonth
        ? activityPresentByMonth[i]
        : true;
      return h(
        "td",
        {
          key: `${keyPrefix}-${account.account_number}-${m.month_index}`,
          title: activityByMonth
            ? portfolioBalanceCellTitle({
                change: activityByMonth[i],
                balance: valueByMonth[i],
                changePresent: activityPresence,
              })
            : portfolioZeroCellTitle(valueByMonth[i], presence),
          style: { ...CELL_BASE, color: C.textPrimary },
        },
        activityByMonth
          ? balanceCellContent({
              change: activityByMonth[i],
              balance: valueByMonth[i],
              changePresent: activityPresence,
              fmtCell: fmtBudgetCell,
            })
          : fmtBudgetCell(valueByMonth[i], { present: presence }),
      );
    }),
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          fontWeight: 700,
          color: C.textPrimary,
          borderLeft: `1px solid ${C.border}`,
        },
      },
      totalValue == null ? "" : fmtBudgetTotal(totalValue),
    ),
  );
}

function renderNoiTemplateRow(C, row, axis) {
  const lineType = row.line_type || "detail";
  const indent = Number(row.indent_level || 0);
  const lineId = row.line_id;

  if (lineType === "section_header") {
    const p = statementRowPresentation({
      kind: "header",
      headerKind: "section",
      depth: 0,
    });
    return h(
      "tr",
      {
        key: `noi-line-${lineId}`,
        "data-statement-heading": `noi-${lineId}`,
        "data-statement-depth": 0,
        "data-statement-label": row.line_label,
      },
      h(
        "td",
        {
          colSpan: axis.length + 3,
          style: {
            padding: "10px 12px",
            paddingLeft: p.paddingLeft,
            background: C.subtleBg,
            color: C.textPrimary,
            fontSize: 12,
            fontWeight: p.fontWeight,
            textTransform: p.textTransform,
            letterSpacing: p.letterSpacing,
            borderTop: `1px solid ${C.border}`,
            borderBottom: `1px solid ${C.border}`,
          },
        },
        bandLabel(row.line_label, p.paddingLeft),
      ),
    );
  }
  if (lineType === "subgroup_header") {
    const p = statementRowPresentation({
      kind: "header",
      headerKind: "group",
      depth: indent,
    });
    return h(
      "tr",
      {
        key: `noi-line-${lineId}`,
        "data-statement-heading": `noi-${lineId}`,
        "data-statement-depth": indent,
        "data-statement-label": row.line_label,
      },
      h(
        "td",
        {
          colSpan: axis.length + 3,
          style: {
            padding: `6px 12px 6px ${p.paddingLeft}px`,
            background: "transparent",
            color: C.textSecondary,
            fontSize: 11,
            fontWeight: p.fontWeight,
            textTransform: p.textTransform,
            letterSpacing: p.letterSpacing,
            borderTop: `1px solid ${C.border}`,
          },
        },
        bandLabel(row.line_label, p.paddingLeft),
      ),
    );
  }
  if (lineType === "spacer") {
    return h(
      "tr",
      { key: `noi-line-${lineId}` },
      h(
        "td",
        {
          colSpan: axis.length + 3,
          style: { padding: "4px 0", background: C.cardBg },
        },
        "",
      ),
    );
  }

  const isTotal = lineType === "total";
  const isSubtotal = lineType === "subtotal";
  const isPlaceholder =
    lineType === "placeholder_uwpf" || lineType === "derived_placeholder";
  const rowBg = isTotal
    ? "var(--ds-info-bg)"
    : isSubtotal
      ? C.subtleBg
      : C.cardBg;
  const borderTop = isTotal ? `2px solid ${C.accent}` : `1px solid ${C.border}`;
  const borderBottom = isTotal ? `1px solid ${C.border}` : undefined;
  const labelColor = isPlaceholder ? C.textSecondary : C.textPrimary;
  const labelWeight = isTotal ? 800 : isSubtotal ? 700 : 500;
  const cellWeight = isTotal ? 700 : isSubtotal ? 700 : 400;
  const totalWeight = isTotal ? 800 : isSubtotal ? 700 : 500;
  const tooltip =
    isPlaceholder && row.placeholder_tooltip
      ? row.placeholder_tooltip
      : undefined;
  const labelStyle = {
    ...CELL_BASE,
    ...stickyName(rowBg, 1),
    textAlign: "left",
    paddingLeft: statementIndent(indent),
    fontWeight: labelWeight,
    color: labelColor,
    fontStyle: isPlaceholder ? "italic" : "normal",
  };

  return h(
    "tr",
    {
      key: `noi-line-${lineId}`,
      style: { borderTop, borderBottom, background: rowBg },
      ...(isTotal || isSubtotal
        ? {
            "data-statement-total": `noi-${lineId}`,
            "data-statement-depth": indent,
          }
        : null),
    },
    h(
      "td",
      { style: { ...CELL_BASE, ...stickyAcct(rowBg, 1), textAlign: "left" } },
      "",
    ),
    h(
      "td",
      { style: labelStyle, title: tooltip || row.line_label },
      row.line_label,
    ),
    ...axis.map((m, i) => {
      const v = row.monthly ? row.monthly[i] : null;
      const display = isPlaceholder ? "—" : v == null ? "—" : fmtBudgetCell(v);
      return h(
        "td",
        {
          key: `noi-line-${lineId}-${m.month_index}`,
          style: { ...CELL_BASE, fontWeight: cellWeight, color: labelColor },
          title: tooltip,
        },
        display,
      );
    }),
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          fontWeight: totalWeight,
          color: labelColor,
          borderLeft: `1px solid ${C.border}`,
        },
        title: tooltip,
      },
      isPlaceholder || row.total == null ? "—" : fmtBudgetTotal(row.total),
    ),
  );
}

function renderBucketSubtotalRow(
  C,
  {
    keyPrefix,
    label,
    monthly,
    total,
    axis,
    depth = 0,
    stackDepth = depth,
    isGrandTotal = false,
  },
) {
  const rowBg = C.subtleBg;
  const p = statementRowPresentation({ kind: "subtotal", depth, isGrandTotal });
  return h(
    "tr",
    {
      key: `${keyPrefix}-subtotal`,
      "data-statement-total": `${keyPrefix}-subtotal`,
      "data-statement-depth": stackDepth,
      style: { borderTop: `1px solid ${C.border}`, background: rowBg },
    },
    h(
      "td",
      { style: { ...CELL_BASE, ...stickyAcct(rowBg, 1), textAlign: "left" } },
      "",
    ),
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          ...stickyName(rowBg, 1),
          textAlign: "left",
          paddingLeft: p.paddingLeft,
          fontWeight: p.fontWeight,
          color: C.textPrimary,
        },
      },
      label,
    ),
    ...axis.map((m, i) =>
      h(
        "td",
        {
          key: `${keyPrefix}-subtotal-${m.month_index}`,
          title: portfolioSubtotalCellTitle(monthly[i]),
          style: { ...CELL_BASE, fontWeight: 700, color: C.textPrimary },
        },
        fmtBudgetCell(monthly[i]),
      ),
    ),
    h(
      "td",
      {
        style: {
          ...CELL_BASE,
          fontWeight: 800,
          color: C.textPrimary,
          borderLeft: `1px solid ${C.border}`,
        },
      },
      fmtBudgetTotal(total),
    ),
  );
}

const PORTFOLIO_HIDE_ZERO_LABEL = "Hide zero balance accounts";

function renderZeroToggle(
  C,
  { id, checked, onChange, shownCount, hiddenCount },
) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: 12,
        marginBottom: 8,
        fontSize: 12,
        color: C.textSecondary,
      },
    },
    h(
      "label",
      {
        htmlFor: id,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          color: C.textPrimary,
          fontWeight: 600,
        },
      },
      h("input", {
        id,
        type: "checkbox",
        checked: !!checked,
        onChange: (e) => onChange(!!e.target.checked),
        style: { cursor: "pointer" },
      }),
      PORTFOLIO_HIDE_ZERO_LABEL,
    ),
    h(
      "span",
      null,
      `${shownCount} account${shownCount === 1 ? "" : "s"} shown`,
      hiddenCount > 0 ? ` · ${hiddenCount} hidden as zero balance` : "",
    ),
    checked ? null : h("span", null, PORTFOLIO_ZERO_LEGEND.caption),
  );
}

function renderChrome(C, { state, hasData, emptyCopy, onRetry, content }) {
  if (state.loading) {
    return h(
      "div",
      {
        style: {
          padding: 16,
          color: C.textSecondary,
          fontSize: 13,
          minHeight: 240,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.cardBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
        },
        role: "status",
      },
      "Loading portfolio budget…",
    );
  }
  if (state.error) {
    return h(
      "div",
      {
        style: {
          padding: 12,
          background: "var(--ds-danger-bg)",
          border:
            "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
          borderRadius: 6,
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        },
      },
      h(
        "div",
        { style: { color: "var(--ds-danger-text)" } },
        `Could not load the portfolio budget rollup: ${state.error.message || String(state.error)}`,
      ),
      h(
        "button",
        {
          type: "button",
          onClick: onRetry,
          style: {
            padding: "6px 12px",
            background: "#fff",
            color: "var(--ds-danger-text)",
            border:
              "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          },
        },
        "Retry",
      ),
    );
  }
  if (!hasData) {
    return h(
      "div",
      {
        style: {
          padding: 16,
          background: C.cardBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          color: C.textSecondary,
          fontSize: 13,
        },
      },
      emptyCopy,
    );
  }
  return content;
}

const EMPTY_COPY_ADMIN =
  "No budget data for your organization yet. Register and parse the v26 workbooks in Admin Console > Platform > Budget Workbook Intake — the portfolio rollup aggregates every property that has budget data.";
const EMPTY_COPY_NON_ADMIN =
  "No budget data for your organization yet. Ask your administrator to register and parse the v26 budget workbooks — the portfolio rollup aggregates every property that has budget data.";
function emptyCopyForUser(userProfile) {
  const isAdmin =
    !!userProfile &&
    (userProfile.is_admin === true ||
      String(userProfile.role || "").toLowerCase() === "admin");
  return isAdmin ? EMPTY_COPY_ADMIN : EMPTY_COPY_NON_ADMIN;
}

function gridShell(C, headerEls) {
  return h(
    StatementStickyGrid,
    {
      theme: { border: C.border, subtle: C.subtleBg, cardBg: C.cardBg },
      maxHeight: 640,
      style: { background: C.cardBg },
    },
    h(
      "table",
      {
        style: {
          borderCollapse: "separate",
          borderSpacing: 0,
          fontSize: 12,
          width: "max-content",
          minWidth: "100%",
        },
      },
      ...headerEls,
    ),
  );
}

function renderBudgetSectionHeading(C, key, title, copy) {
  return h(
    "div",
    { key: `section-heading-${key}`, style: { paddingTop: 4 } },
    h(
      "div",
      { style: { fontSize: 14, fontWeight: 700, color: C.textPrimary } },
      title,
    ),
    h(
      "div",
      {
        style: {
          marginTop: 2,
          fontSize: 12,
          color: C.textSecondary,
          lineHeight: 1.45,
          maxWidth: 900,
        },
      },
      copy,
    ),
  );
}

function PortfolioNoiPanel({ C, state, onRetry, emptyCopy }) {
  const view = useMemo(
    () => synthesizePortfolioNoiBuild(state.data),
    [state.data],
  );
  const rows = view.rows.map((row) => renderNoiTemplateRow(C, row, view.axis));
  const content = gridShell(C, [
    renderGridHeader(C, view.axis, "", "NOI Build line", view.coverage),
    h("tbody", null, ...rows),
  ]);
  return renderChrome(C, {
    state,
    hasData: view.hasData,
    emptyCopy,
    onRetry,
    content,
  });
}

function PortfolioCoaPanel({
  C,
  state,
  onRetry,
  emptyCopy,
  mode = "combined",
}) {
  const showIncomeStatement = mode !== "bs";
  const showBalanceSheet = mode !== "is";
  const [hideZero, setHideZero] = useState(false);
  const noiExclusions = useNoiExclusions();
  const view = useMemo(
    () => groupPortfolioCoaForGrid(state.data),
    [state.data],
  );
  const statementAll = useMemo(
    () => buildPortfolioCoaStatementLayout(state.data, false),
    [state.data],
  );
  const statement = useMemo(
    () =>
      hideZero
        ? buildPortfolioCoaStatementLayout(state.data, true)
        : statementAll,
    [state.data, hideZero, statementAll],
  );
  const tail = useMemo(() => {
    const split = splitPortfolioCoaStatementExcluded(statement.excluded);
    const band = splitNoiExcludedRows(split.unplaced, noiExclusions);
    const unplaced = groupPortfolioCoaForGrid(band.mismatched);
    const noiExcluded = groupPortfolioCoaForGrid(band.excluded);
    const balanceSheet = groupPortfolioCoaForGrid(split.balanceSheet);
    const hidden = (grid) =>
      hideZero
        ? {
            ...grid,
            sections: hidePortfolioZeroBalanceAccounts(
              grid.sections,
              "monthly",
            ),
          }
        : grid;
    return {
      unplaced: hidden(unplaced),
      noiExcluded: hidden(noiExcluded),
      balanceSheet: hidden(balanceSheet),
    };
  }, [statement.excluded, hideZero, noiExclusions]);
  const tailAll = useMemo(() => {
    if (!hideZero) return tail;
    const split = splitPortfolioCoaStatementExcluded(statementAll.excluded);
    const band = splitNoiExcludedRows(split.unplaced, noiExclusions);
    return {
      unplaced: groupPortfolioCoaForGrid(band.mismatched),
      noiExcluded: groupPortfolioCoaForGrid(band.excluded),
      balanceSheet: groupPortfolioCoaForGrid(split.balanceSheet),
    };
  }, [hideZero, statementAll.excluded, tail, noiExclusions]);

  const axisMatchesView = (axis) =>
    axis.length === view.axis.length &&
    axis.every((m, i) => m.month_index === view.axis[i].month_index);
  const axesMatch =
    axisMatchesView(statement.axis) &&
    (!tail.unplaced.hasData || axisMatchesView(tail.unplaced.axis)) &&
    (!tail.noiExcluded.hasData || axisMatchesView(tail.noiExcluded.axis)) &&
    (!tail.balanceSheet.hasData || axisMatchesView(tail.balanceSheet.axis));
  const useStatement = axesMatch && statement.hasData;
  const rows = [];
  let shownCount = 0;

  const pushGridSections = (gridView, keyBase, noteFor = null) => {
    for (const section of gridView.sections) {
      rows.push(
        renderSectionBand(
          C,
          `${keyBase}-${section.key}`,
          section.label,
          view.axis,
        ),
      );
      for (const bucket of section.buckets) {
        const keyPrefix = `${keyBase}-${section.key}-${bucket.bucket}`;
        rows.push(
          renderBucketBand(C, keyPrefix, bucket.label, view.axis, 0, 1),
        );
        for (const acct of bucket.accounts) {
          rows.push(
            renderAccountRow(C, {
              keyPrefix,
              account: acct,
              axis: view.axis,
              valueByMonth: acct.monthly,
              totalValue: acct.total,
              presentByMonth: acct.amountPresentByMonth,
              exclusionNote: noteFor ? noteFor(acct.account_number) : null,
            }),
          );
          shownCount += 1;
        }
        if (bucket.subtotal) {
          rows.push(
            renderBucketSubtotalRow(C, {
              keyPrefix,
              label: bucket.subtotal.label,
              monthly: bucket.subtotal.monthly,
              total: bucket.subtotal.total,
              axis: view.axis,
              stackDepth: 1,
            }),
          );
        }
      }
    }
  };

  if (useStatement && showIncomeStatement) {
    for (const row of statement.rows) {
      if (row.kind === "header") {
        rows.push(
          row.headerKind === "section"
            ? renderSectionBand(
                C,
                `stmt-${row.specRow}`,
                row.label,
                view.axis,
                row.depth,
              )
            : renderBucketBand(
                C,
                `stmt-${row.specRow}`,
                row.label,
                view.axis,
                row.depth,
              ),
        );
      } else if (row.kind === "account") {
        rows.push(
          renderAccountRow(C, {
            keyPrefix: "stmt",
            account: {
              account_number: row.accountNumber,
              account_name: row.accountName,
            },
            axis: view.axis,
            valueByMonth: row.monthly,
            totalValue: row.total,
            presentByMonth: statementPresence(row),
            depth: row.depth,
          }),
        );
        shownCount += 1;
      } else {
        rows.push(
          renderBucketSubtotalRow(C, {
            keyPrefix: `stmt-${row.specRow}`,
            label: row.label,
            monthly: row.monthly,
            total: row.total,
            axis: view.axis,
            depth: row.depth,
            isGrandTotal: row.isGrandTotal,
          }),
        );
      }
    }
    if (statement.orphans.length) {
      rows.push(
        renderSectionBand(
          C,
          "stmt-orphans",
          `In the data, not in the statement template (${statement.orphans.length}) — ${COA_ORPHAN_NOTE}`,
          view.axis,
        ),
      );
      for (const orphan of statement.orphans) {
        rows.push(
          renderAccountRow(C, {
            keyPrefix: "stmt-orphan",
            account: orphan,
            axis: view.axis,
            valueByMonth: orphan.monthly,
            totalValue: orphan.total,
            presentByMonth: statementPresence(orphan),
          }),
        );
        shownCount += 1;
      }
    }
    if (tail.unplaced.hasData) {
      rows.push(
        renderSectionBand(
          C,
          "stmt-unplaced",
          `Not placed by the workbook layout (${countPortfolioGridAccounts(tail.unplaced.sections)}) — ${PORTFOLIO_UNPLACED_NOTE}`,
          view.axis,
        ),
      );
      pushGridSections(tail.unplaced, "unplaced");
    }
    if (tail.noiExcluded.hasData) {
      pushGridSections(tail.noiExcluded, "noi-excluded", (accountNumber) =>
        noiExclusionTitle(noiExclusions.get(String(accountNumber))),
      );
    }
  }
  if (useStatement && showBalanceSheet) {
    if (showIncomeStatement && tail.balanceSheet.hasData) {
      rows.push(
        renderSectionBand(
          C,
          "stmt-tail",
          "Balance sheet and unbucketed accounts (included in the budget, outside the income statement)",
          view.axis,
        ),
      );
    }
    pushGridSections(tail.balanceSheet, "coa");
  }
  if (!useStatement) {
    const sections = hideZero
      ? hidePortfolioZeroBalanceAccounts(view.sections, "monthly")
      : view.sections;
    pushGridSections({ ...view, sections }, "coa");
  }

  const allCount = useStatement
    ? (showIncomeStatement
        ? countPortfolioStatementAccounts(statementAll) +
          countPortfolioGridAccounts(tailAll.unplaced.sections) +
          countPortfolioGridAccounts(tailAll.noiExcluded.sections)
        : 0) +
      (showBalanceSheet
        ? countPortfolioGridAccounts(tailAll.balanceSheet.sections)
        : 0)
    : countPortfolioGridAccounts(view.sections);
  const content = h(
    "div",
    null,
    !useStatement
      ? h(
          "div",
          {
            style: {
              fontSize: 12,
              color: C.textSecondary,
              marginBottom: 8,
              maxWidth: 900,
              lineHeight: 1.5,
            },
          },
          "The statement layout is unavailable for this portfolio, so this tab shows the whole chart of accounts in workbook bucket order instead of split into Income Statement and Balance Sheet. Nothing is hidden — the split is, not the accounts.",
        )
      : null,
    renderZeroToggle(C, {
      id: `portfolio-coa-${mode}-hide-zero`,
      checked: hideZero,
      onChange: setHideZero,
      shownCount,
      hiddenCount: Math.max(0, allCount - shownCount),
    }),
    gridShell(C, [
      renderGridHeader(C, view.axis, "Account", "Name", view.coverage),
      h("tbody", null, ...rows),
    ]),
  );
  return renderChrome(C, {
    state,
    hasData: view.hasData,
    emptyCopy,
    onRetry,
    content,
  });
}

function PortfolioBalancesPanel({ C, state, onRetry, emptyCopy }) {
  const [hideZero, setHideZero] = useState(false);
  const view = useMemo(
    () => groupPortfolioRunningBalancesForGrid(state.data),
    [state.data],
  );
  const allCount = useMemo(
    () => countPortfolioGridAccounts(view.sections),
    [view.sections],
  );
  const sections = useMemo(
    () =>
      hideZero
        ? hidePortfolioZeroBalanceAccounts(view.sections, "running")
        : view.sections,
    [view.sections, hideZero],
  );
  const shownCount = useMemo(
    () => countPortfolioGridAccounts(sections),
    [sections],
  );
  const rows = [];
  for (const section of sections) {
    rows.push(renderSectionBand(C, section.key, section.label, view.axis));
    for (const bucket of section.buckets) {
      const keyPrefix = `bal-${section.key}-${bucket.bucket}`;
      rows.push(
        renderBucketBand(
          C,
          `${section.key}-${bucket.bucket}`,
          bucket.label,
          view.axis,
          0,
          1,
        ),
      );
      for (const acct of bucket.accounts) {
        rows.push(
          renderAccountRow(C, {
            keyPrefix,
            account: acct,
            axis: view.axis,
            valueByMonth: acct.running,
            totalValue: acct.total,
            activityByMonth: acct.activity,
            activityPresentByMonth: acct.activityPresentByMonth,
          }),
        );
      }
      if (bucket.subtotal) {
        rows.push(
          renderBucketSubtotalRow(C, {
            keyPrefix,
            label: bucket.subtotal.label,
            monthly: bucket.subtotal.monthly,
            total: bucket.subtotal.total,
            axis: view.axis,
            stackDepth: 1,
          }),
        );
      }
    }
  }
  const content = h(
    "div",
    null,
    renderZeroToggle(C, {
      id: "portfolio-balances-hide-zero",
      checked: hideZero,
      onChange: setHideZero,
      shownCount,
      hiddenCount: allCount - shownCount,
    }),
    gridShell(C, [
      renderGridHeader(C, view.axis, "Account", "Name", view.coverage),
      h("tbody", null, ...rows),
    ]),
  );
  return renderChrome(C, {
    state,
    hasData: view.hasData,
    emptyCopy,
    onRetry,
    content,
  });
}

function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PortfolioBudgetAnalysisPage({
  C = {},
  userProfile = null,
} = {}) {
  const emptyCopy = emptyCopyForUser(userProfile);
  const T = {
    textPrimary: C.textPrimary || C.text || "var(--ds-text-primary)",
    textSecondary: C.textSecondary || "var(--ds-text-secondary)",
    border: C.border || "var(--ds-border)",
    cardBg: C.cardBg || C.card || "#FFFFFF",
    subtleBg: C.subtleBg || "var(--ds-inset)",
    accent: C.accent || "var(--ds-accent)",
    green: C.green || "var(--ds-success-dot)",
    red: C.red || "var(--ds-danger-text)",
  };

  const [tab, setTab] = useState("is");
  const [combined, setCombined] = useState(false);
  const [codes, setCodes] = useState([]);
  const [orgPropertyCount, setOrgPropertyCount] = useState(null);
  const [noi, setNoi] = useState({
    data: [],
    loading: true,
    error: null,
    loaded: false,
  });
  const [coa, setCoa] = useState({
    data: [],
    loading: true,
    error: null,
    loaded: false,
  });
  const [running, setRunning] = useState({
    data: [],
    loading: true,
    error: null,
    loaded: false,
  });

  const reload = useCallback(() => {
    setNoi({ data: [], loading: true, error: null, loaded: false });
    setCoa({ data: [], loading: true, error: null, loaded: false });
    setRunning({ data: [], loading: true, error: null, loaded: false });
    fetchPortfolioBudgetNoiBuild().then(({ data, error }) => {
      setNoi({
        data: Array.isArray(data) ? data : [],
        loading: false,
        error: error || null,
        loaded: true,
      });
    });
    fetchPortfolioBudgetCoaMonthly().then(({ data, error }) => {
      setCoa({
        data: Array.isArray(data) ? data : [],
        loading: false,
        error: error || null,
        loaded: true,
      });
    });
    fetchPortfolioBudgetRunningBalances().then(({ data, error }) => {
      setRunning({
        data: Array.isArray(data) ? data : [],
        loading: false,
        error: error || null,
        loaded: true,
      });
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let alive = true;
    fetchBudgetPropertyCodes().then(({ data }) => {
      if (alive) setCodes(Array.isArray(data) ? data : []);
    });
    fetchOrgPropertyCount().then(({ data }) => {
      if (alive) setOrgPropertyCount(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const propertyCount = useMemo(() => {
    const view = synthesizePortfolioNoiBuild(noi.data);
    const fromCoverage = (view.coverage || []).reduce(
      (mx, c) => Math.max(mx, c.property_count || 0),
      0,
    );
    return fromCoverage || codes.length;
  }, [noi.data, codes.length]);
  const countKnown = propertyCount > 0;

  const trimFrom = useMemo(() => {
    const candidates = [coa.data, noi.data, running.data]
      .map(firstFiguredMonthIndex)
      .filter((value) => value != null);
    return candidates.length ? Math.min(...candidates) : null;
  }, [coa.data, noi.data, running.data]);

  const trimmed = useCallback(
    (state) => ({
      ...state,
      data: trimLeadingEmptyMonths(state.data, trimFrom),
      untrimmed: state.data,
      trimFrom,
    }),
    [trimFrom],
  );
  const coaView = useMemo(() => trimmed(coa), [coa, trimmed]);
  const noiView = useMemo(() => trimmed(noi), [noi, trimmed]);
  const runningView = useMemo(() => trimmed(running), [running, trimmed]);

  const tabStrip = h(
    "div",
    {
      style: {
        display: "flex",
        gap: 0,
        alignItems: "center",
        borderBottom: `1px solid ${T.border}`,
        marginBottom: 10,
      },
    },
    PORTFOLIO_BUDGET_TABS.map((t) =>
      h(
        "button",
        {
          key: t.key,
          type: "button",
          onClick: () => setTab(t.key),
          style: {
            padding: "10px 16px",
            background: "transparent",
            color: tab === t.key ? T.textPrimary : T.textSecondary,
            border: "none",
            borderBottom:
              tab === t.key ? `2px solid ${T.accent}` : "2px solid transparent",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: tab === t.key ? 700 : 600,
            marginBottom: -1,
          },
        },
        t.label,
      ),
    ),
    h(
      "label",
      {
        htmlFor: "portfolio-budget-analysis-combined",
        style: {
          marginLeft: "auto",
          marginRight: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          fontSize: 12,
          color: combined ? T.textPrimary : T.textSecondary,
          fontWeight: combined ? 700 : 600,
        },
      },
      h("input", {
        id: "portfolio-budget-analysis-combined",
        type: "checkbox",
        checked: combined,
        onChange: (event) => setCombined(!!event.target.checked),
        style: { cursor: "pointer" },
      }),
      PORTFOLIO_COMBINED_TOGGLE_LABEL,
    ),
  );

  const showIncomeStatement = combined || tab === "is";
  const showBalanceSheet = combined || tab === "bs";
  const sections = [
    combined
      ? renderBudgetSectionHeading(
          T,
          "combined",
          "Income Statement and Balance Sheet, one sheet",
          "The same accounts, the same subtotals and the same figures as the two tabs, in one continuous grid. The income statement ends at the fence band.",
        )
      : null,
    h(PortfolioCoaPanel, {
      key: `stmt-${combined ? "combined" : tab}`,
      C: T,
      state: coaView,
      onRetry: reload,
      emptyCopy,
      mode: combined ? "combined" : tab,
    }),
    showIncomeStatement
      ? renderBudgetSectionHeading(
          T,
          "noi",
          "NOI build",
          "The v26 workbook's own roll-up of the income statement above — the same accounts through the workbook's NOI lines. This was the NOI Build tab.",
        )
      : null,
    showIncomeStatement
      ? h(PortfolioNoiPanel, {
          key: "noi",
          C: T,
          state: noiView,
          onRetry: reload,
          emptyCopy,
        })
      : null,
    showBalanceSheet
      ? renderBudgetSectionHeading(
          T,
          "balances",
          "Running balances",
          "The closing balance of every balance-sheet account, month by month, with that month’s change above it. The grid above is the same accounts’ monthly activity. This was the Running Balances tab.",
        )
      : null,
    showBalanceSheet
      ? h(PortfolioBalancesPanel, {
          key: "balances",
          C: T,
          state: runningView,
          onRetry: reload,
          emptyCopy,
        })
      : null,
  ];

  const activeStates = combined
    ? [coa, noi, running]
    : tab === "is"
      ? [coa, noi]
      : [coa, running];
  const refreshedAt = activeStates
    .map((state) =>
      Array.isArray(state.data) && state.data[0]
        ? state.data[0].refreshed_at
        : null,
    )
    .filter(Boolean)
    .reduce((oldest, value) => {
      if (!oldest) return value;
      return new Date(value).getTime() < new Date(oldest).getTime()
        ? value
        : oldest;
    }, null);
  let stalenessLine = null;
  if (refreshedAt) {
    stalenessLine = h(
      "div",
      { style: { fontSize: 11, color: T.textSecondary, marginBottom: 8 } },
      `Recomputed on each budget update — as of ${formatTimestamp(refreshedAt)}.`,
    );
  } else if (
    activeStates.every(
      (state) => state.loaded && (!state.data || state.data.length === 0),
    )
  ) {
    stalenessLine = h(
      "div",
      { style: { fontSize: 11, color: T.textSecondary, marginBottom: 8 } },
      "Portfolio rollup not yet computed — it builds automatically after the next budget update.",
    );
  }

  const legendItem = (label, tint) =>
    h(
      "span",
      {
        key: label,
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11,
          color: T.textSecondary,
        },
      },
      h("span", {
        style: {
          width: 11,
          height: 11,
          borderRadius: 2,
          background: tint.bg === "transparent" ? T.subtleBg : tint.bg,
          border: `1px solid ${T.border}`,
          display: "inline-block",
        },
      }),
      label,
    );

  const headerCopy =
    `${portfolioScopeNote({ budgetPropertyCount: countKnown ? propertyCount : null, orgPropertyCount })} ` +
    "Each property switches from realized GL actuals to budget forecast at its own actuals-through month, " +
    "so a portfolio month mixes both — the coverage strip under the header shows how many properties have " +
    "realized each month.";

  return h(
    "div",
    { style: { padding: 20, color: T.textPrimary } },
    h(
      "div",
      { style: { marginBottom: 14 } },
      h(
        "h1",
        { style: { fontSize: 20, fontWeight: 700, margin: 0 } },
        "Portfolio Budget Analysis",
      ),
      h(
        "p",
        {
          style: {
            fontSize: 13,
            color: T.textSecondary,
            margin: "4px 0 0",
            maxWidth: 760,
          },
        },
        headerCopy,
      ),
      h(
        "div",
        { style: { display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" } },
        legendItem("all realized", COVERAGE_TINT.actual),
        legendItem("partial (mixed)", COVERAGE_TINT.mixed),
        legendItem("all forecast", COVERAGE_TINT.forecast),
      ),
    ),
    tabStrip,
    stalenessLine,
    h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 12 } },
      ...sections,
    ),
  );
}
