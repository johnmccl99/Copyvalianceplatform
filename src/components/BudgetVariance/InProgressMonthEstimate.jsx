import React, { useEffect, useMemo, useState } from "react";
import { fetchInprogressMonthEstimate } from "../../lib/supabaseClient.js";
import { formatCurrencyFull, EMPTY } from "../../lib/numberFormat.js";
import { bandedRowStyle } from "../../lib/tableStyles.js";

const METHOD_LABEL = {
  prior_year_shape: "prior-year shape",
  run_rate: "run-rate",
  complete: "complete",
};

export default function InProgressMonthEstimate({
  propertyCode,
  theme = {},
} = {}) {
  const text = theme.text || "#0F172A";
  const sub = theme.sub || "#64748B";
  const border = theme.border || "#E2E8F0";
  const card = theme.card || "#FFFFFF";
  const subtle = theme.subtle || "#F8FAFC";
  const red = theme.red || "#DC2626";
  const bandC = {
    tableBgAlt: theme.tableBgAlt || "var(--ds-legacy-table-bg-alt)",
    border,
  };

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!propertyCode) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setRows([]);
    fetchInprogressMonthEstimate(propertyCode)
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (err) setError(err);
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [propertyCode]);

  const totals = useMemo(
    () =>
      (rows || []).reduce(
        (a, r) => ({
          booked: a.booked + (Number(r.booked_mtd) || 0),
          remainder: a.remainder + (Number(r.projected_remainder) || 0),
          full: a.full + (Number(r.full_month_estimate) || 0),
        }),
        { booked: 0, remainder: 0, full: 0 },
      ),
    [rows],
  );

  const period = rows[0] || null;

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

  if (!propertyCode) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
        In-progress month estimate{" "}
        <span style={{ fontSize: 12, fontWeight: 500, color: sub }}>
          (projected — not booked actuals)
        </span>
      </h2>
      <p style={{ fontSize: 13, color: sub, margin: "0 0 8px" }}>
        Projects the rest of the current month from actuals posted so far, so
        the live month reads as a full-month figure.
        {period
          ? ` Estimate based on ${period.days_elapsed}/${period.days_in_month} days of ${period.month_start}.`
          : ""}{" "}
        Booked and projected dollars are shown separately; the projected portion
        is an estimate, not booked actuals.
      </p>

      {loading && (
        <div style={{ padding: 20, color: sub, fontSize: 14 }} role="status">
          Loading estimate…
        </div>
      )}
      {!loading && error && (
        <div
          style={{
            padding: 16,
            border: `1px solid ${red}`,
            borderRadius: 8,
            color: red,
            fontSize: 13,
          }}
        >
          Could not load the in-progress-month estimate
          {error?.message ? `. ${String(error.message)}` : "."}
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div
          style={{
            padding: 20,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 14,
          }}
        >
          No live GL activity posted for {propertyCode} this month yet — nothing
          to project. An estimate appears once the current month has posted
          transactions.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            {[
              {
                label: "Booked so far (actual MTD)",
                value: formatCurrencyFull(totals.booked),
                color: text,
              },
              {
                label: "Projected remainder (est.)",
                value: formatCurrencyFull(totals.remainder),
                color: sub,
              },
              {
                label: "Full-month estimate",
                value: formatCurrencyFull(totals.full),
                color: text,
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: card,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 12, color: sub }}>{s.label}</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginTop: 4,
                    color: s.color,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              overflowX: "auto",
              border: `1px solid ${border}`,
              borderRadius: 8,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: card,
              }}
            >
              <thead style={{ background: subtle }}>
                <tr>
                  <th style={th}>Account</th>
                  <th style={thNum}>Actual MTD</th>
                  <th style={thNum}>
                    Projected remainder{" "}
                    <em style={{ fontWeight: 500, color: sub }}>(est.)</em>
                  </th>
                  <th style={thNum}>
                    Full-month{" "}
                    <em style={{ fontWeight: 500, color: sub }}>(est.)</em>
                  </th>
                  <th style={th}>Method</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr
                    key={`${r.property_code}|${r.account_number}`}
                    style={bandedRowStyle(ri, bandC)}
                  >
                    <td style={td}>
                      {r.account_number}
                      {r.account_name ? ` · ${r.account_name}` : ""}
                    </td>
                    <td style={tdNum}>{formatCurrencyFull(r.booked_mtd)}</td>
                    <td style={{ ...tdNum, color: sub }}>
                      {r.method === "complete"
                        ? EMPTY
                        : formatCurrencyFull(r.projected_remainder)}
                    </td>
                    <td style={tdNum}>
                      {formatCurrencyFull(r.full_month_estimate)}
                    </td>
                    <td style={{ ...td, color: sub, fontSize: 12 }}>
                      {METHOD_LABEL[r.method] || r.method}
                      {r.method !== "complete" ? (
                        <em style={{ color: sub }}> · est.</em>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: sub, margin: "8px 2px 0" }}>
            Estimate only — not booked actuals, and excluded from the budget
            snapshot and the closed-actuals NOI. The "run-rate" method scales
            actuals posted so far by elapsed days, then caps each account's
            full-month estimate at its recent trailing-month scale, so an
            account already fully posted for the month (e.g. a fixed monthly
            entry) is not over-projected.
          </p>
        </>
      )}
    </div>
  );
}
