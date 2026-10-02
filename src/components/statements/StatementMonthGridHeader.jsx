import React from "react";
import { statementHeaderCellStyle } from "../../lib/tableStyles.js";
import {
  formatMonthLabel,
  currentMonthMarkerValue,
} from "../../lib/budgetOutputSurfaces.js";

export const STATEMENT_ACCOUNT_COL_WIDTH = 90;
export const STATEMENT_NAME_COL_WIDTH = 220;

export function statementStickyAccountStyle(rowBg, zIndex) {
  return {
    position: "sticky",
    left: 0,
    background: rowBg,
    zIndex,
    minWidth: STATEMENT_ACCOUNT_COL_WIDTH,
    maxWidth: STATEMENT_ACCOUNT_COL_WIDTH,
  };
}

export function statementStickyNameStyle(rowBg, zIndex) {
  return {
    position: "sticky",
    left: STATEMENT_ACCOUNT_COL_WIDTH,
    background: rowBg,
    zIndex,
    minWidth: STATEMENT_NAME_COL_WIDTH,
    maxWidth: STATEMENT_NAME_COL_WIDTH,
  };
}

export default function StatementMonthGridHeader({
  C,
  axis,
  leftLabel1 = "",
  leftLabel2 = "",
  secondRow = null,
}) {
  const months = Array.isArray(axis) ? axis : [];
  const markedMonthEnd = currentMonthMarkerValue(
    months.map((m) => m.month_end),
  );
  const stickyHead = statementHeaderCellStyle(C, { row: 0 });
  const headBg = stickyHead.background;
  const headBase = {
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
    background: headBg,
    fontVariantNumeric: "tabular-nums",
  };
  return React.createElement(
    "thead",
    { "data-statement-header": "" },
    React.createElement(
      "tr",
      null,
      React.createElement(
        "th",
        {
          style: {
            ...headBase,
            ...stickyHead,
            ...statementStickyAccountStyle(headBg, 4),
            textAlign: "left",
          },
        },
        leftLabel1,
      ),
      React.createElement(
        "th",
        {
          style: {
            ...headBase,
            ...stickyHead,
            ...statementStickyNameStyle(headBg, 4),
            textAlign: "left",
          },
        },
        leftLabel2,
      ),
      ...months.map((m) =>
        React.createElement(
          "th",
          {
            key: `h-${m.month_index}`,
            ...(markedMonthEnd != null && m.month_end === markedMonthEnd
              ? { "data-statement-current-month": "" }
              : null),
            style: {
              ...headBase,
              ...stickyHead,
              textAlign: "right",
              minWidth: 100,
            },
          },
          formatMonthLabel(m.month_end),
        ),
      ),
      React.createElement(
        "th",
        {
          style: {
            ...headBase,
            ...stickyHead,
            textAlign: "right",
            minWidth: 110,
            borderLeft: `1px solid ${C.border}`,
            fontWeight: 700,
          },
        },
        "Total",
      ),
    ),
    secondRow,
  );
}
