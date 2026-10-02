import React from "react";
import {
  formatMultiple,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";

function fmtMetric(lineId, value) {
  if (value == null || !Number.isFinite(Number(value))) return EMPTY;
  if (Number(lineId) === 700) return formatMultiple(value, { decimals: 2 });
  if (Number(lineId) === 710)
    return formatPercent(value, { fromFraction: true, decimals: 0 });
  return String(value);
}

function fyLabel(row) {
  const m = row.month_end && String(row.month_end).match(/^(\d{4})/);
  if (m) return `FY${m[1].slice(2)}`;
  return `FY${row.fiscal_year ?? ""}`;
}

export default function DebtMetricsSummary({ rows, theme }) {
  const { text, sub, border, card, subtle } = theme || {};
  const all = Array.isArray(rows) ? rows : [];
  const stabilized = all.filter((r) => r && r.grain === "stabilized");
  const fySteps = all.filter((r) => r && r.grain === "fy_stepped");
  if (stabilized.length === 0 && fySteps.length === 0) return null;

  const fyCols = [];
  const seen = new Set();
  for (const r of [...fySteps].sort(
    (a, b) => (a.fiscal_year || 0) - (b.fiscal_year || 0),
  )) {
    if (!seen.has(r.fiscal_year)) {
      seen.add(r.fiscal_year);
      fyCols.push(r);
    }
  }

  const lookup = (lineId, grain, fiscalYear) => {
    const hit = all.find(
      (r) =>
        Number(r.line_id) === lineId &&
        r.grain === grain &&
        (grain !== "fy_stepped" || r.fiscal_year === fiscalYear),
    );
    return hit ? hit.amount : null;
  };

  const metricRows = [
    { lineId: 700, label: "DSCR" },
    { lineId: 710, label: "LTV — CAP 5.25%" },
  ];

  const th = {
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: sub,
    textAlign: "right",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  };
  const thLeft = { ...th, textAlign: "left" };
  const td = {
    padding: "6px 10px",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    whiteSpace: "nowrap",
    color: text,
  };
  const tdLeft = { ...td, textAlign: "left", fontWeight: 600 };

  return (
    <div
      style={{
        marginTop: 12,
        background: card,
        border: `1px solid ${border}`,
        borderRadius: 8,
        overflow: "auto",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: text,
          borderBottom: `1px solid ${border}`,
        }}
        title="Trailing-12 DSCR/LTV are shown per month on the grid above (rows 700/710). This block shows the stabilized-year figure and the per-fiscal-year figures. DSCR = NOI / debt service; LTV = senior loan / (NOI / 5.25% cap)."
      >
        Debt coverage &amp; leverage — UW pro-forma
      </div>
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: 0,
          width: "max-content",
          minWidth: "100%",
        }}
      >
        <thead>
          <tr style={{ background: subtle }}>
            <th style={thLeft}>Metric</th>
            <th style={th}>Stabilized</th>
            {fyCols.map((c) => (
              <th key={`fy-${c.fiscal_year}`} style={th}>
                {fyLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metricRows.map((mr) => (
            <tr
              key={`m-${mr.lineId}`}
              style={{ borderTop: `1px solid ${border}` }}
            >
              <td style={tdLeft}>{mr.label}</td>
              <td style={td}>
                {fmtMetric(mr.lineId, lookup(mr.lineId, "stabilized"))}
              </td>
              {fyCols.map((c) => (
                <td key={`m-${mr.lineId}-fy-${c.fiscal_year}`} style={td}>
                  {fmtMetric(
                    mr.lineId,
                    lookup(mr.lineId, "fy_stepped", c.fiscal_year),
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
