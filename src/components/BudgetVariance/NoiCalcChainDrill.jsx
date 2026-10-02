import React from "react";
import { reshapeCalcChain } from "../../lib/noiCalcChain/noiCalcChain.js";
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";
import { bandedRowStyle } from "../../lib/tableStyles.js";

const MONTHS_ABBR = [
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
function fmtMonth(monthEnd) {
  if (!monthEnd) return "";
  const m = String(monthEnd).match(/^(\d{4})-(\d{2})/);
  if (!m) return String(monthEnd);
  return `${MONTHS_ABBR[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

export default function NoiCalcChainDrill({
  entry,
  lineMeta,
  proformaOverlay,
  sides,
  theme,
}) {
  const { text, sub, border, card, subtle, red, varColor } = theme || {};
  const baselineSide = sides?.baseline || null;
  const actualSide = sides?.actual || sides?.compare || null;
  const baselineColumnLabel = sides?.baselineColumnLabel || "Budget";
  const compareColumnLabel =
    sides?.compareColumnLabel || (actualSide ? "Actual" : "Compare");

  if (!entry || entry.loading) {
    return (
      <span style={{ color: sub, fontSize: 12 }}>Loading calc chain…</span>
    );
  }
  if (entry.error) {
    return (
      <span style={{ color: red, fontSize: 12 }}>
        Could not load the calc chain.{" "}
        {entry.error?.message ? String(entry.error.message) : ""}
      </span>
    );
  }

  const chain = reshapeCalcChain(entry.rows, lineMeta || {});

  const dth = {
    textAlign: "left",
    padding: "5px 8px",
    fontSize: 11,
    color: sub,
    fontWeight: 600,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const dthNum = { ...dth, textAlign: "right" };
  const dtd = {
    padding: "5px 8px",
    fontSize: 12,
    color: text,
    borderBottom: `1px solid ${border}`,
  };
  const dtdNum = {
    ...dtd,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };
  const bandC = {
    tableBgAlt: theme?.tableBgAlt || "var(--ds-legacy-table-bg-alt)",
    border,
  };

  if (chain.kind === "placeholder") {
    const overlay = (
      Array.isArray(proformaOverlay) ? proformaOverlay : []
    ).filter((r) => r && r.amount != null);
    if (overlay.length) {
      const total = overlay.reduce((s, r) => s + Number(r.amount || 0), 0);
      return (
        <div style={{ fontSize: 12, color: text }}>
          <div style={{ color: sub, marginBottom: 6 }}>
            UW pro-forma loan model ·{" "}
            <span style={{ color: text, fontWeight: 600 }}>
              {chain.line_label}
            </span>
            <span style={{ color: sub }}>
              {" "}
              — planned debt service from the underwriting model (not
              budget/actual)
            </span>
          </div>
          <div
            style={{
              overflowX: "auto",
              border: `1px solid ${border}`,
              borderRadius: 6,
              background: card,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: subtle }}>
                <tr>
                  <th style={dth}>Month</th>
                  <th style={dthNum}>Pro-forma debt service</th>
                </tr>
              </thead>
              <tbody>
                {overlay.map((r, i) => (
                  <tr
                    key={`${r.month_end || i}`}
                    style={bandedRowStyle(i, bandC)}
                  >
                    <td style={dtd}>{fmtMonth(r.month_end)}</td>
                    <td style={dtdNum}>{formatCurrencyFull(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr
                  style={bandedRowStyle(0, bandC, {
                    background: subtle,
                    borderColor: "transparent",
                  })}
                >
                  <td
                    style={{ ...dtd, fontWeight: 700, borderBottom: "none" }}
                  >{`Σ ${chain.line_label}`}</td>
                  <td
                    style={{ ...dtdNum, fontWeight: 700, borderBottom: "none" }}
                  >
                    {formatCurrencyFull(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div style={{ fontSize: 12, color: sub, lineHeight: 1.5 }}>
        <strong style={{ color: text }}>{chain.line_label}</strong> is sourced
        from the underwriting loan model, which is not yet wired into the budget
        engine.
        <div style={{ marginTop: 4, fontStyle: "italic" }}>
          {chain.placeholder_tooltip || "UWPF loan-model integration pending"}
        </div>
        <div style={{ marginTop: 4 }}>
          Debt-service, DSCR and LTV lines will populate automatically once the
          loan model integration lands — no action needed here.
        </div>
      </div>
    );
  }

  if (chain.kind === "empty" || chain.contributors.length === 0) {
    return (
      <span style={{ color: sub, fontSize: 12 }}>
        No constituent detail is available for this line on this property.
      </span>
    );
  }

  const isRollup = chain.kind === "rollup";
  const firstColHeader = isRollup ? "Component" : "Account";
  const caption = isRollup
    ? chain.formula
      ? `${chain.line_label} = ${chain.formula}`
      : `${chain.line_label} — roll-up of its components`
    : chain.noi_category
      ? `Accounts mapped to ${chain.noi_category}`
      : `Accounts behind ${chain.line_label}`;

  const cellColor = (variance, section) =>
    typeof varColor === "function" ? varColor(variance, section) : text;
  const lineSection =
    lineMeta?.noi_section ?? chain.contributors[0]?.noi_section ?? null;

  return (
    <div style={{ fontSize: 12, color: text }}>
      <div style={{ color: sub, marginBottom: 6 }}>
        {isRollup ? "Roll-up formula: " : "Calc chain: "}
        <span style={{ color: text, fontWeight: 600 }}>{caption}</span>
        <span style={{ color: sub }}>
          {baselineSide
            ? ` · ${baselineSide} vs ${actualSide || "live GL actual"} over the selected period`
            : " · budget vs actual over the selected period"}
        </span>
      </div>
      <div
        style={{
          overflowX: "auto",
          border: `1px solid ${border}`,
          borderRadius: 6,
          background: card,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: subtle }}>
            <tr>
              <th style={dth}>{firstColHeader}</th>
              <th style={dthNum} title={baselineSide || undefined}>
                {baselineColumnLabel}
                {baselineSide ? (
                  <div style={{ fontWeight: 400, fontSize: 10, color: sub }}>
                    {baselineSide}
                  </div>
                ) : null}
              </th>
              <th style={dthNum} title={actualSide || undefined}>
                {compareColumnLabel}
                {actualSide ? (
                  <div style={{ fontWeight: 400, fontSize: 10, color: sub }}>
                    {actualSide}
                  </div>
                ) : null}
              </th>
              <th style={dthNum}>Variance</th>
              <th style={dthNum}>%</th>
            </tr>
          </thead>
          <tbody>
            {chain.contributors.map((c, i) => (
              <tr
                key={`${c.account_number || c.noi_build_bucket || "c"}-${i}`}
                style={bandedRowStyle(i, bandC)}
              >
                <td style={dtd}>
                  {isRollup
                    ? c.label || c.noi_build_bucket || EMPTY
                    : `${c.account_number || EMPTY}${c.label && c.label !== c.account_number ? ` · ${c.label}` : ""}`}
                </td>
                <td style={dtdNum}>{formatCurrencyFull(c.budget)}</td>
                <td style={dtdNum}>{formatCurrencyFull(c.actual)}</td>
                <td
                  style={{
                    ...dtdNum,
                    color: cellColor(c.variance, c.noi_section),
                    fontWeight: 600,
                  }}
                >
                  {formatCurrencyFull(c.variance)}
                </td>
                <td style={dtdNum}>
                  {formatPercent(c.pct_variance, { signed: true })}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr
              style={bandedRowStyle(0, bandC, {
                background: subtle,
                borderColor: "transparent",
              })}
            >
              <td
                style={{ ...dtd, fontWeight: 700, borderBottom: "none" }}
              >{`Σ ${chain.line_label}`}</td>
              <td style={{ ...dtdNum, fontWeight: 700, borderBottom: "none" }}>
                {formatCurrencyFull(chain.totals.budget)}
              </td>
              <td style={{ ...dtdNum, fontWeight: 700, borderBottom: "none" }}>
                {formatCurrencyFull(chain.totals.actual)}
              </td>
              <td
                style={{
                  ...dtdNum,
                  fontWeight: 700,
                  borderBottom: "none",
                  color: cellColor(chain.totals.variance, lineSection),
                }}
              >
                {formatCurrencyFull(chain.totals.variance)}
              </td>
              <td style={{ ...dtdNum, fontWeight: 700, borderBottom: "none" }}>
                {formatPercent(chain.totals.pct_variance, { signed: true })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
