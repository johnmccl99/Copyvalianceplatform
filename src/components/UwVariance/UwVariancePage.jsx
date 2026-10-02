import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { fetchUwVariance } from "../../lib/supabaseClient.js";
import {
  anchorRows,
  hasUwBaseline,
  hasActualNoi,
  summarizeUwVariance,
  isFavorable,
  benchmarkChartData,
  pctIsMeaningful,
  uwPresent,
  unmodeledAnchorLabels,
} from "../../lib/uwVariance/uwVariance.js";
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";
import { T } from "../../lib/theme.js";
import {
  bandedRowStyle,
  statementHeaderCellStyle,
} from "../../lib/tableStyles.js";
import StatementStickyGrid from "../statements/StatementStickyGrid.jsx";

export default function UwVariancePage({ C = {}, propertyCode } = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const bandC = {
    tableBgAlt: C.tableBgAlt || "var(--ds-legacy-table-bg-alt)",
    border,
  };
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;
  const accent = C.accent || T.accent;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!propertyCode) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchUwVariance(propertyCode)
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (err) setError(err);
        setRows(data || []);
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

  const anchors = useMemo(() => anchorRows(rows), [rows]);
  const summary = useMemo(() => summarizeUwVariance(rows), [rows]);
  const hasUw = useMemo(() => hasUwBaseline(rows), [rows]);
  const hasActual = useMemo(() => hasActualNoi(rows), [rows]);
  const chartData = useMemo(
    () => benchmarkChartData(rows, summary.actual_noi),
    [rows, summary.actual_noi],
  );
  const retired = useMemo(() => unmodeledAnchorLabels(rows), [rows]);
  const hasNonPositiveBase = useMemo(() => {
    const a = anchorRows(rows).find((r) => r.is_aligned === true);
    return !!a && uwPresent(a) && !pctIsMeaningful(a);
  }, [rows]);

  const varColor = (variance) => {
    const fav = isFavorable(variance);
    if (fav === null) return text;
    return fav ? green : red;
  };

  const noUw = (
    <em style={{ color: sub, fontStyle: "italic" }}>no underwritten value</em>
  );
  const noPct = (
    <span
      style={{ color: sub }}
      title="A percentage against a negative or zero underwritten NOI is not meaningful."
    >
      {EMPTY}
    </span>
  );
  const trailingLabel = summary.actual_through
    ? `trailing ${summary.actual_months} mo through ${summary.actual_through}`
    : "no realized actuals yet";

  const al = summary.alignment;
  const aligned = al.aligned;
  const alignedModeled = !!aligned && uwPresent(aligned);
  const comparable = alignedModeled && summary.actual_full_year;
  const months = (n) => `${n} month${Number(n) === 1 ? "" : "s"}`;

  const th = {
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 12,
    color: sub,
    fontWeight: 600,
    whiteSpace: "nowrap",
    ...statementHeaderCellStyle({ subtleBg: subtle, border }, { row: 0 }),
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

  return (
    <div style={{ padding: 20, color: text }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            Underwriting Variance
          </h1>
          <p style={{ fontSize: 13, color: sub, margin: "4px 0 0" }}>
            Actual NOI for the trailing window vs the underwritten NOI for the
            hold year that window falls in.
          </p>
        </div>
      </div>

      {propertyCode && loading && (
        <div style={{ padding: 24, color: sub, fontSize: 14 }} role="status">
          Loading underwriting variance…
        </div>
      )}
      {propertyCode && !loading && error && (
        <div
          style={{
            padding: 16,
            border: `1px solid ${red}`,
            borderRadius: 8,
            color: red,
            fontSize: 13,
          }}
        >
          Could not load underwriting variance for {propertyCode}.{" "}
          {error?.message ? String(error.message) : ""}
        </div>
      )}

      {propertyCode && !loading && !error && !hasActual && !hasUw && (
        <div
          style={{
            padding: 24,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 14,
          }}
        >
          No general-ledger actuals or underwritten NOI baseline are available
          for {propertyCode} yet. Underwriting variance compares
          trailing-twelve-month actual NOI to the underwritten NOI; it appears
          once both are available for this property.
        </div>
      )}

      {propertyCode && !loading && !error && hasActual && !hasUw && (
        <>
          <div
            style={{
              padding: 24,
              border: `1px dashed ${border}`,
              borderRadius: 8,
              color: sub,
              fontSize: 14,
              lineHeight: 1.6,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: text,
                marginBottom: 6,
              }}
            >
              Underwriting comparison not yet available for {propertyCode}.
            </div>
            Underwriting variance compares each property's trailing-twelve-month
            actual NOI to the NOI underwritten at acquisition. No underwritten
            NOI baseline is available for this property yet, so there is no
            comparison to show. It appears automatically once the property's
            underwritten NOI benchmarks are available. Until then, use Budget
            Variance and Prior-Year Variance to track performance.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>Actual NOI</div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  marginTop: 4,
                  color: text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatCurrencyFull(summary.actual_noi)}
              </div>
              <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                {trailingLabel}
              </div>
            </div>
          </div>
        </>
      )}

      {propertyCode && !loading && !error && hasUw && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>Actual NOI</div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  marginTop: 4,
                  color: text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatCurrencyFull(summary.actual_noi)}
              </div>
              <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                {trailingLabel}
              </div>
            </div>
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>
                {aligned?.uw_label || "Underwritten NOI"}
              </div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  marginTop: 4,
                  color: text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {alignedModeled ? formatCurrencyFull(aligned.uw_noi) : EMPTY}
              </div>
              <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                {!aligned
                  ? "no hold year lines up with the window"
                  : alignedModeled
                    ? `the hold year the window falls in — ${months(aligned.overlap_months)} of it`
                    : `the model projects no value for Year ${aligned.hold_year}`}
              </div>
            </div>
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>Variance</div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  marginTop: 4,
                  color: comparable ? varColor(aligned.variance) : sub,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {comparable ? formatCurrencyFull(aligned.variance) : EMPTY}
              </div>
            </div>
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>% Variance</div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  marginTop: 4,
                  color: text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {comparable && pctIsMeaningful(aligned)
                  ? formatPercent(aligned.pct_variance, { signed: true })
                  : noPct}
              </div>
            </div>
          </div>

          {!summary.actual_full_year && (
            <div
              style={{
                padding: "10px 14px",
                border: `1px dashed ${border}`,
                borderRadius: 8,
                color: sub,
                fontSize: 13,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              {propertyCode} has {months(summary.actual_months)} of realized
              actuals — less than a full year. The underwritten figures are
              annual, so the variance is shown only once a full trailing year of
              actuals has accrued. The underwritten benchmarks are listed below
              for reference.
            </div>
          )}

          {!al.supported && (
            <div
              style={{
                padding: "10px 14px",
                border: `1px dashed ${border}`,
                borderRadius: 8,
                color: sub,
                fontSize: 13,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              The hold-year alignment is not available from the server for this
              property yet, so no variance is computed. An underwritten annual
              figure is only comparable to the actual window once the window's
              position in the hold period is known. The underwritten benchmarks
              are listed below for reference.
            </div>
          )}

          {al.supported && !aligned && (
            <div
              style={{
                padding: "10px 14px",
                border: `1px dashed ${border}`,
                borderRadius: 8,
                color: sub,
                fontSize: 13,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              {!al.acquisition_close ? (
                <>
                  No acquisition close date is recorded on {propertyCode}'s
                  underwriting model, so the actual window cannot be placed in
                  the hold period and no underwritten year is comparable to it.
                  The benchmarks below are the underwritten trajectory, listed
                  for reference.
                </>
              ) : al.past_modeled_hold && al.modeled_hold_years ? (
                <>
                  {propertyCode}'s actual window ends in hold year{" "}
                  {al.window_hold_year}, past the end of the underwritten model,
                  which runs to Year {al.modeled_hold_years}
                  {al.beyond_modeled_months ? (
                    <>
                      {" "}
                      — {months(al.beyond_modeled_months)} of the window fall
                      beyond it
                    </>
                  ) : null}
                  . There is no underwritten year covering this period, so no
                  variance is shown. Comparing it against Year{" "}
                  {al.modeled_hold_years} would present a post-hold result as a
                  plan comparison. The benchmarks below are the underwritten
                  trajectory, listed for reference.
                </>
              ) : (
                <>
                  No underwritten year holds enough of {propertyCode}'s actual
                  window to be comparable to it
                  {al.pre_close_months ? (
                    <>
                      {" "}
                      ({months(al.pre_close_months)} of the window fall before
                      the acquisition close)
                    </>
                  ) : null}
                  , so no variance is shown. The benchmarks below are the
                  underwritten trajectory, listed for reference.
                </>
              )}
            </div>
          )}

          {aligned && !alignedModeled && (
            <div
              style={{
                padding: "10px 14px",
                border: `1px dashed ${border}`,
                borderRadius: 8,
                color: sub,
                fontSize: 13,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              {propertyCode}'s actual window falls in hold Year{" "}
              {aligned.hold_year}, but the underwriting projects no NOI for that
              year — the model is shorter than the hold period it is being read
              against. There is no underwritten figure to compare the window to,
              so no variance is shown. The benchmarks below are the years the
              model does project, listed for reference.
            </div>
          )}

          {alignedModeled &&
            (al.past_modeled_hold || al.pre_close_months > 0) && (
              <div
                style={{
                  padding: "10px 14px",
                  border: `1px dashed ${border}`,
                  borderRadius: 8,
                  color: sub,
                  fontSize: 13,
                  marginBottom: 16,
                  lineHeight: 1.5,
                }}
              >
                {al.past_modeled_hold && (
                  <>
                    The actual window has crossed the end of the underwritten
                    model: it ends in hold year {al.window_hold_year} and the
                    model runs to Year {al.modeled_hold_years}, so{" "}
                    {months(al.beyond_modeled_months)} of it fall past the last
                    modeled year. The comparison uses Year {aligned.hold_year},
                    which still holds {months(aligned.overlap_months)} of the
                    window — the majority of it, but not all of it.{" "}
                  </>
                )}
                {al.pre_close_months > 0 && (
                  <>
                    {months(al.pre_close_months)} of the window{" "}
                    {Number(al.pre_close_months) === 1 ? "falls" : "fall"}{" "}
                    before {propertyCode}'s acquisition close
                    {al.acquisition_close ? ` (${al.acquisition_close})` : ""}{" "}
                    and so{" "}
                    {Number(al.pre_close_months) === 1 ? "belongs" : "belong"}{" "}
                    to no underwritten hold year.
                  </>
                )}
              </div>
            )}

          {chartData.length > 1 && (
            <>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>
                Underwritten NOI trajectory, and the actual window against its
                aligned year
              </h2>
              <div
                style={{
                  background: card,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: "12px 8px 12px 0",
                  marginBottom: 24,
                }}
              >
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(160, chartData.length * 38)}
                >
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ left: 16, right: 28, top: 4, bottom: 4 }}
                  >
                    <XAxis
                      type="number"
                      tickFormatter={(v) => formatCurrencyFull(v)}
                      stroke={sub}
                      fontSize={11}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={170}
                      stroke={sub}
                      fontSize={11}
                      interval={0}
                    />
                    <Tooltip
                      formatter={(v) => formatCurrencyFull(v)}
                      cursor={{ fill: subtle }}
                    />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                      {chartData.map((b, i) => (
                        <Cell
                          key={i}
                          fillOpacity={b.kind === "uw" ? 0.45 : 1}
                          fill={
                            b.kind === "actual"
                              ? accent
                              : b.kind === "uw-aligned"
                                ? text
                                : sub
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <div
            style={{
              padding: "10px 14px",
              border: `1px dashed ${border}`,
              borderRadius: 8,
              color: sub,
              fontSize: 13,
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            The underwritten figures are annual and tied to the deal's hold
            period: Year 1 is the twelve months after acquisition close
            {al.acquisition_close ? ` (${al.acquisition_close})` : ""}, Year 2
            the twelve after that, and so on. The actual side is the{" "}
            {months(summary.actual_months)} of realized actuals
            {summary.actual_through ? ` through ${summary.actual_through}` : ""}
            , which is anniversary-relative to nothing and so generally
            straddles two hold years.
            {alignedModeled ? (
              <>
                {" "}
                Only one year is comparable to it — Year {aligned.hold_year},
                which covers {months(aligned.overlap_months)} of the window
                {comparable ? (
                  <> — and that is the only row carrying a variance</>
                ) : (
                  <>
                    , but the window is a partial year, so no variance is shown
                    on it either
                  </>
                )}
                . The other years are the underwritten trajectory, shown for
                reference with the part of the window each one covers.
              </>
            ) : (
              <>
                {" "}
                No single year is comparable to it here, so every row below is
                reference only.
              </>
            )}{" "}
            The underwriting carries annual NOI and no account-level detail, so
            this comparison exists at the NOI line only — it cannot be broken
            down by account the way Budget Variance and Prior-Year Variance can.
          </div>

          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>
            Underwritten benchmarks
          </h2>
          <StatementStickyGrid
            theme={{ border, subtle }}
            maxHeight={520}
            style={{ background: card }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: card,
              }}
            >
              <thead data-statement-header="">
                <tr>
                  <th style={th}>Benchmark</th>
                  <th style={thNum}>Underwritten NOI</th>
                  <th
                    style={thNum}
                    title="How many months of the actual window fall inside this underwritten year."
                  >
                    Window overlap
                  </th>
                  <th style={thNum}>Actual NOI (window)</th>
                  <th style={thNum}>Variance</th>
                  <th style={thNum}>%</th>
                </tr>
              </thead>
              <tbody>
                {anchors.map((r, ri) => {
                  const isAligned = r.is_aligned === true;
                  const showVar =
                    isAligned && summary.actual_full_year && uwPresent(r);
                  const overlap =
                    al.supported && r.hold_year != null
                      ? (r.overlap_months ?? 0)
                      : null;
                  return (
                    <tr
                      key={r.uw_anchor}
                      style={{
                        ...bandedRowStyle(ri, bandC),
                        ...(isAligned ? { background: subtle } : null),
                      }}
                    >
                      <td style={{ ...td, fontWeight: isAligned ? 700 : 400 }}>
                        {r.uw_label}
                        {isAligned && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              fontWeight: 600,
                              color: accent,
                            }}
                          >
                            aligned with the actual window
                          </span>
                        )}
                      </td>
                      <td style={tdNum}>
                        {uwPresent(r) ? formatCurrencyFull(r.uw_noi) : noUw}
                      </td>
                      <td style={{ ...tdNum, color: sub }}>
                        {overlap == null
                          ? EMPTY
                          : `${overlap} of ${summary.actual_months} mo`}
                      </td>
                      <td style={tdNum}>
                        {isAligned && r.actual_noi != null
                          ? formatCurrencyFull(r.actual_noi)
                          : EMPTY}
                      </td>
                      <td
                        style={{
                          ...tdNum,
                          color: showVar ? varColor(r.variance) : sub,
                          fontWeight: 600,
                        }}
                      >
                        {showVar ? formatCurrencyFull(r.variance) : EMPTY}
                      </td>
                      <td style={tdNum}>
                        {showVar && pctIsMeaningful(r)
                          ? formatPercent(r.pct_variance, { signed: true })
                          : noPct}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </StatementStickyGrid>

          {hasNonPositiveBase && (
            <p
              style={{
                fontSize: 12,
                color: sub,
                margin: "8px 0 0",
                lineHeight: 1.5,
              }}
            >
              A percentage is not shown where the underwritten NOI is negative
              or zero: the ratio would carry the base's sign and read backwards.
              A value-add deal can legitimately underwrite a negative NOI in its
              renovation years. The dollar variance is unaffected.
            </p>
          )}

          {retired.length > 0 && (
            <p
              style={{
                fontSize: 12,
                color: sub,
                margin: "8px 0 0",
                lineHeight: 1.5,
              }}
            >
              {retired.join(" and ")} {retired.length === 1 ? "is" : "are"} not
              shown: the underwriting model does not produce{" "}
              {retired.length === 1 ? "it" : "them"} for any property, so{" "}
              {retired.length === 1 ? "the row" : "those rows"} could only ever
              be blank.{" "}
              {retired.length === 1 ? "It reappears" : "They reappear"}{" "}
              automatically if the model starts carrying{" "}
              {retired.length === 1 ? "it" : "them"}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
