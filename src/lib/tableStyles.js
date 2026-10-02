export const BANDED_ROW_PARITY = 1;

export function isBandedRow(index) {
  return (
    typeof index === "number" && index >= 0 && index % 2 === BANDED_ROW_PARITY
  );
}

export function bandedRowStyle(index, C, opts = {}) {
  const theme = C || {};
  const { background, borderColor, transition = true } = opts;
  const band = isBandedRow(index)
    ? theme.tableBgAlt || "transparent"
    : "transparent";
  return {
    background: background != null ? background : band,
    borderBottom: `1px solid ${borderColor || theme.border || "transparent"}`,
    ...(transition ? { transition: "background 0.15s" } : null),
  };
}

export function bandedCellBackground(index, C) {
  const theme = C || {};
  return isBandedRow(index)
    ? theme.tableBgAlt || theme.cardBg || "transparent"
    : theme.cardBg || "transparent";
}

export function scrollContainerStyle(maxHeight = "60vh") {
  return {
    maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
    overflowY: "auto",
    overflowX: "auto",
  };
}

export function stickyHeaderCellStyle(C, opts = {}) {
  const theme = C || {};
  const { top = 0, zIndex = 2 } = opts;
  return {
    position: "sticky",
    top: typeof top === "number" ? `${top}px` : top,
    zIndex,
    background:
      theme.tableHeaderBg || theme.subtleBg || theme.cardBg || "transparent",
    boxShadow: `inset 0 -1px 0 ${theme.border || "transparent"}`,
  };
}

export const STATEMENT_HEADER_ROW_VAR = "--stmt-header-row-1";
export const STATEMENT_HEADER_BLOCK_VAR = "--stmt-header-block";

export function statementHeaderCellStyle(C, opts = {}) {
  const { row = 0, zIndex = 3, background } = opts;
  const base = stickyHeaderCellStyle(C, {
    top: row <= 0 ? 0 : `var(${STATEMENT_HEADER_ROW_VAR}, 0px)`,
    zIndex,
  });
  return background ? { ...base, background } : base;
}

export const STICKY_BAND_LABEL_SCROLLPORT_VAR = "--stmt-scrollport";

export function stickyBandLabelStyle(leftPad = 12) {
  const pad = typeof leftPad === "number" ? `${leftPad}px` : leftPad;
  return {
    position: "sticky",
    left: pad,
    display: "inline-block",
    maxWidth: `calc(var(${STICKY_BAND_LABEL_SCROLLPORT_VAR}, 100vw) - ${pad})`,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

export function stickyDrawerContentStyle(leftPad = 12) {
  const pad = typeof leftPad === "number" ? `${leftPad}px` : leftPad;
  return {
    position: "sticky",
    left: pad,
    display: "block",
    maxWidth: `calc(var(${STICKY_BAND_LABEL_SCROLLPORT_VAR}, 100vw) - ${pad} - ${pad})`,
  };
}

export const numericCellStyle = { textAlign: "right" };
export const numericHeaderStyle = { textAlign: "right", whiteSpace: "nowrap" };

export function columnAlignStyle(columnIndex, opts = {}) {
  const { labelColumns = 1, header = false } = opts;
  if (columnIndex < labelColumns) return { textAlign: "left" };
  return header ? numericHeaderStyle : numericCellStyle;
}
