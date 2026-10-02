import { formatBudgetCell, BUDGET_ABSENT_CELL } from "./budgetCellFormat.js";
import { EMPTY } from "./numberFormat.js";

export const STATEMENT_MISSING_GLYPH = EMPTY;

export const STATEMENT_INDENT_BASE = 12;
export const STATEMENT_INDENT_STEP = 12;

export function statementIndent(depth) {
  const d = Number(depth);
  return (
    STATEMENT_INDENT_BASE +
    Math.max(0, Number.isFinite(d) ? d : 0) * STATEMENT_INDENT_STEP
  );
}

export function statementRowPresentation(row) {
  const r = row || {};
  const kind = r.kind === "total" ? "subtotal" : r.kind;
  const paddingLeft = statementIndent(r.depth);

  if (kind === "header") {
    const isSection = r.headerKind === "section";
    return {
      paddingLeft,
      fontWeight: 700,
      textTransform: isSection ? "uppercase" : "none",
      letterSpacing: isSection ? 0.5 : 0,
    };
  }

  if (kind === "subtotal") {
    return {
      paddingLeft,
      fontWeight: r.isGrandTotal ? 800 : 700,
      textTransform: "none",
      letterSpacing: 0,
    };
  }

  return {
    paddingLeft,
    fontWeight: 400,
    textTransform: "none",
    letterSpacing: 0,
  };
}

export function formatStatementFigure(value, { present = true } = {}) {
  return formatBudgetCell(value, { present });
}

export function formatStatementMoney(value) {
  if (value === null || value === undefined) return STATEMENT_MISSING_GLYPH;
  if (typeof value === "string" && value.trim() === "")
    return STATEMENT_MISSING_GLYPH;
  const n = Number(value);
  if (!Number.isFinite(n)) return STATEMENT_MISSING_GLYPH;
  return Math.round(n).toLocaleString("en-US");
}

export const STATEMENT_ABSENT_CELL = BUDGET_ABSENT_CELL;
