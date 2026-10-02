import React from "react";
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";
import { bandedRowStyle } from "../../lib/tableStyles.js";

const PLACEHOLDER_TITLE =
  "Not derivable from the chart of accounts — this line comes from the UWPF loan model. Not a zero.";
const ABSENT_TITLE =
  "This side carries no figure for the accounts on this line in the selected period. Not a zero, and no variance is struck against it.";

export default function NoiBuildDerivedTable({
  lines,
  baselineLabel,
  compareLabel,
  baselineName,
  compareName,
  varColor,
  theme,
  styles,
}) {
  const { text, sub, subtle, border, card, tableBgAlt } = theme;
  const { th, thNum, td, tdNum } = styles;
  const bandC = { tableBgAlt, border };
  const money = (v, row) => {
    if (row.placeholder)
      return (
        <span
          title={row.placeholder_tooltip || PLACEHOLDER_TITLE}
          style={{ color: sub }}
        >
          {EMPTY}
        </span>
      );
    if (v == null)
      return (
        <span title={ABSENT_TITLE} style={{ color: sub }}>
          {EMPTY}
        </span>
      );
    return formatCurrencyFull(v);
  };
  return (
    <div
      style={{
        overflowX: "auto",
        border: `1px solid ${border}`,
        borderRadius: 8,
      }}
    >
      <table
        data-testid="noi-build-derived"
        style={{ width: "100%", borderCollapse: "collapse", background: card }}
      >
        <thead style={{ background: subtle }}>
          <tr>
            <th style={th}>Line</th>
            <th style={thNum}>
              {baselineLabel}
              <div style={{ fontWeight: 400, fontSize: 10, color: sub }}>
                {baselineName}
              </div>
            </th>
            <th style={thNum}>
              {compareLabel}
              <div style={{ fontWeight: 400, fontSize: 10, color: sub }}>
                {compareName}
              </div>
            </th>
            <th style={thNum}>Variance</th>
            <th style={thNum}>%</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((r, ri) => {
            const isHeader =
              r.line_type === "section_header" ||
              r.line_type === "subgroup_header";
            const isSpacer = r.line_type === "spacer";
            const isTotal =
              r.line_type === "total" || r.line_type === "subtotal";
            const indent = 10 + Number(r.indent_level || 0) * 14;
            if (isSpacer) {
              return (
                <tr key={r.line_id}>
                  <td
                    colSpan={5}
                    style={{ ...td, padding: 3, borderBottom: "none" }}
                  />
                </tr>
              );
            }
            if (isHeader) {
              return (
                <tr key={r.line_id} style={{ background: subtle }}>
                  <td
                    colSpan={5}
                    style={{
                      ...td,
                      paddingLeft: indent,
                      fontWeight: 700,
                      color: sub,
                      fontSize: 12,
                      textTransform:
                        r.line_type === "section_header" ? "uppercase" : "none",
                      letterSpacing: r.line_type === "section_header" ? 0.4 : 0,
                    }}
                  >
                    {r.line_label}
                  </td>
                </tr>
              );
            }
            const withheld = r.placeholder || r.variance == null;
            return (
              <tr
                key={r.line_id}
                data-line-id={r.line_id}
                style={bandedRowStyle(ri, bandC, {
                  background: isTotal ? subtle : undefined,
                })}
              >
                <td
                  style={{
                    ...td,
                    paddingLeft: indent,
                    fontWeight: isTotal ? 700 : 400,
                  }}
                >
                  {r.line_label}
                  {r.unmapped ? (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: sub,
                        marginTop: 2,
                      }}
                    >
                      {r.account_numbers.length} account
                      {r.account_numbers.length === 1 ? "" : "s"} with no NOI
                      build bucket ({r.account_numbers.join(", ")}) — the bucket
                      mapping needs correcting; carried here so the build still
                      totals the rows it was given.
                    </div>
                  ) : null}
                </td>
                <td style={tdNum}>{money(r.budget, r)}</td>
                <td style={tdNum}>{money(r.actual, r)}</td>
                <td
                  style={{
                    ...tdNum,
                    color: withheld
                      ? text
                      : varColor(r.variance, r.noi_section),
                    fontWeight: 600,
                  }}
                >
                  {withheld ? (
                    <span style={{ color: sub }}>{EMPTY}</span>
                  ) : (
                    formatCurrencyFull(r.variance)
                  )}
                </td>
                <td style={tdNum}>
                  {withheld
                    ? EMPTY
                    : formatPercent(r.pct_variance, { signed: true })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
