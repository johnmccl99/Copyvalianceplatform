import React, { useMemo, useState } from "react";
import {
  UW_GRAIN_STATEMENT,
  buildUwLineMatrix,
  uwWindowSummary,
  reconciliationSummary,
  nonComparableStatements,
} from "../../lib/uwLineVariance/uwLineVariance.js";
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";
import { isFavorable } from "../../lib/budgetVariance.js";
import { formatMonthLabel } from "../../lib/dateFormat.js";
import { bandedRowStyle } from "../../lib/tableStyles.js";
import { T } from "../../lib/theme.js";

export default function UwLineComparisonPanel({
  C = {},
  propertyCode,
  rows = [],
  reconciliation = [],
  otherLabel = "the other side",
  otherShortLabel = "Other",
  favourability = false,
  loading = false,
  error = null,
  missingSideLabel = null,
}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;
  const amber = C.amber || C.warning || T.warningText;
  const bandC = {
    tableBgAlt: C.tableBgAlt || "var(--ds-legacy-table-bg-alt)",
    border,
  };

  const [openLine, setOpenLine] = useState(null);

  const matrix = useMemo(() => buildUwLineMatrix(rows), [rows]);
  const summary = useMemo(() => uwWindowSummary(rows), [rows]);
  const recon = useMemo(
    () => reconciliationSummary(reconciliation),
    [reconciliation],
  );
  const statements = useMemo(
    () => nonComparableStatements(summary, recon, otherShortLabel),
    [summary, recon, otherShortLabel],
  );

  const th = {
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 12,
    color: sub,
    fontWeight: 600,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const thNum = { ...th, textAlign: "right" };
  const td = {
    padding: "7px 10px",
    fontSize: 13,
    color: text,
    borderBottom: `1px solid ${border}`,
  };
  const tdNum = {
    ...td,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };

  const varColor = (variance, noiSection) => {
    if (!favourability) return text;
    const fav = isFavorable(variance, noiSection);
    if (fav === null) return text;
    return fav ? green : red;
  };

  const grainStatement = (
    <div
      style={{
        padding: "10px 14px",
        marginBottom: 14,
        background: subtle,
        border: `1px solid ${border}`,
        borderRadius: 8,
        fontSize: 12,
        color: text,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ fontWeight: 700 }}>Grain: NOI line, monthly.</strong>{" "}
      {UW_GRAIN_STATEMENT}
    </div>
  );

  if (loading) {
    return (
      <div>
        {grainStatement}
        <div style={{ padding: 24, color: sub, fontSize: 14 }} role="status">
          Loading the underwriting comparison…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {grainStatement}
        <div
          style={{
            padding: 16,
            border: `1px solid ${red}`,
            borderRadius: 8,
            color: red,
            fontSize: 13,
          }}
        >
          Could not load the underwriting comparison for {propertyCode}.{" "}
          {error?.message ? String(error.message) : ""}
        </div>
      </div>
    );
  }

  if (!matrix.months.length) {
    return (
      <div>
        {grainStatement}
        <div
          style={{
            padding: 24,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {missingSideLabel
            ? `${missingSideLabel} is not sealed for ${propertyCode}, so there is nothing to compare the underwriting against. Nothing was substituted for it.`
            : `${otherLabel} and the underwriting model share no month for ${propertyCode}, so no window lines up and no comparison is drawn. ` +
              "The underwriting's own months and the other side's months do not overlap; this is a coverage fact, not a failed read."}
        </div>
      </div>
    );
  }

  const monthLabel = (m) => formatMonthLabel(String(m).slice(0, 7));
  const money = (v) => (v == null ? EMPTY : formatCurrencyFull(v));

  return (
    <div>
      {grainStatement}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          marginBottom: 14,
          padding: "10px 14px",
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: sub }}>
          Window
        </span>
        <span style={{ fontSize: 12, color: text }}>
          {summary.months} shared {summary.months === 1 ? "month" : "months"}
          {summary.monthStart
            ? ` — ${monthLabel(summary.monthStart)} to ${monthLabel(summary.monthEnd)}`
            : ""}
          {", "}
          {summary.comparableMonths} of them comparable
        </span>
        <span style={{ fontSize: 12, color: sub }}>
          {summary.lines} NOI {summary.lines === 1 ? "line" : "lines"}
          {summary.unmodeledLines > 0
            ? `, ${summary.unmodeledLines} not modeled by the underwriting`
            : ""}
        </span>
        <span style={{ fontSize: 11, color: sub, flexBasis: "100%" }}>
          Underwritten hold{" "}
          {summary.holdYears.length === 1 ? "period" : "periods"} touched:{" "}
          {summary.holdYears.map((y) => (
            <span
              key={y.hold_year}
              style={{ color: y.reconciles ? sub : amber }}
            >
              Year {y.hold_year} ({y.windowMonths} of{" "}
              {y.months == null ? "?" : y.months} modeled{" "}
              {y.months === 1 ? "month" : "months"}
              {y.reconciles ? "" : ", not reconciled"}){"  "}
            </span>
          ))}
        </span>
        {recon.years > 0 && (
          <span style={{ fontSize: 11, color: sub, flexBasis: "100%" }}>
            Underwriting side self-check: the model's monthly detail reconciles
            to its own annual NOI on {recon.reconciling} of {recon.years}{" "}
            modeled hold {recon.years === 1 ? "year" : "years"}
            {recon.reconcilingYears.length
              ? ` (${recon.reconcilingYears.map((y) => `Year ${y}`).join(", ")})`
              : ""}
            . Only those years are compared.
          </span>
        )}
      </div>

      {statements.length > 0 && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            background: card,
            border: `1px solid ${amber}`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: amber,
              marginBottom: 6,
            }}
          >
            What does not compare
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              color: sub,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {statements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          overflowX: "auto",
          border: `1px solid ${border}`,
          borderRadius: 8,
          background: card,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>NOI line</th>
              <th style={thNum}>Underwritten</th>
              <th style={thNum}>{otherShortLabel}</th>
              <th style={thNum}>Variance</th>
              <th style={thNum}>%</th>
              <th style={th}>Comparable months</th>
            </tr>
          </thead>
          <tbody>
            {matrix.lines.map((line, i) => {
              const open = openLine === line.line_id;
              const monthsOfLine = matrix.months.filter((m) => line.cells[m]);
              return (
                <React.Fragment key={line.line_id}>
                  <tr
                    onClick={() => setOpenLine(open ? null : line.line_id)}
                    style={{
                      ...bandedRowStyle(
                        i,
                        bandC,
                        open ? { background: subtle } : undefined,
                      ),
                      cursor: "pointer",
                    }}
                  >
                    <td style={td}>
                      {line.line_label}
                      {!line.uw_line_modeled && (
                        <span
                          style={{ marginLeft: 8, fontSize: 11, color: amber }}
                        >
                          not modeled by the underwriting
                        </span>
                      )}
                    </td>
                    <td style={tdNum}>
                      {line.comparable_months ? money(line.uw_total) : EMPTY}
                    </td>
                    <td style={tdNum}>
                      {line.comparable_months ? money(line.other_total) : EMPTY}
                    </td>
                    <td
                      style={{
                        ...tdNum,
                        color: varColor(line.variance, line.noi_section),
                      }}
                    >
                      {line.variance == null
                        ? EMPTY
                        : formatCurrencyFull(line.variance)}
                    </td>
                    <td style={tdNum}>
                      {line.pct_variance == null
                        ? EMPTY
                        : formatPercent(line.pct_variance, { signed: true })}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: sub }}>
                      {line.comparable_months} of {monthsOfLine.length}
                      {line.comparable_months === 0 && line.uw_line_modeled
                        ? " — no month of this line falls in a reconciling hold year"
                        : ""}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td
                        colSpan={6}
                        style={{ ...td, background: subtle, padding: 0 }}
                      >
                        <table
                          style={{ width: "100%", borderCollapse: "collapse" }}
                        >
                          <thead>
                            <tr>
                              <th style={th}>Month</th>
                              <th style={th}>Hold year</th>
                              <th style={thNum}>Underwritten</th>
                              <th style={thNum}>{otherShortLabel}</th>
                              <th style={thNum}>Variance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthsOfLine.map((m, j) => {
                              const cell = line.cells[m];
                              const holdYear = matrix.monthHoldYear[m] ?? null;
                              return (
                                <tr key={m} style={bandedRowStyle(j, bandC)}>
                                  <td style={{ ...td, fontSize: 12 }}>
                                    {monthLabel(m)}
                                  </td>
                                  <td
                                    style={{ ...td, fontSize: 12, color: sub }}
                                  >
                                    {holdYear == null
                                      ? EMPTY
                                      : `Year ${holdYear}`}
                                    {cell.comparable ? "" : " — not comparable"}
                                  </td>
                                  <td style={tdNum}>{money(cell.uw_amount)}</td>
                                  <td style={tdNum}>
                                    {money(cell.other_amount)}
                                  </td>
                                  <td
                                    style={{
                                      ...tdNum,
                                      color: varColor(
                                        cell.variance,
                                        line.noi_section,
                                      ),
                                    }}
                                  >
                                    {cell.variance == null
                                      ? EMPTY
                                      : formatCurrencyFull(cell.variance)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: sub, marginTop: 10, lineHeight: 1.6 }}>
        Line totals sum only the comparable months, so a total is never struck
        over months this pairing cannot compare.{" "}
        {favourability
          ? "Favourable/unfavourable direction applies because one side is realized GL."
          : "Both sides are plans, so seal-time realization and favourable/unfavourable direction do not apply."}
      </p>
    </div>
  );
}
