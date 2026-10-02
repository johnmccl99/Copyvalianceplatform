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
import {
  fetchPyVariance,
  fetchPyNoiVariance,
  fetchAccountGlDetail,
} from "../../lib/supabaseClient.js";
import {
  aggregateByAccount,
  summarizePyVariance,
  hasPriorYearOverlap,
  isFavorable,
  rollupBySection,
  topVarianceAccounts,
  monthsForAccount,
  aggregatePyNoiByLine,
} from "../../lib/priorYearVariance/priorYearVariance.js";
import { buildPyVarianceStatementRows } from "../../lib/priorYearVarianceStatement.js";
import COA_STATEMENT_SPEC from "../../lib/coaStatementSpec.json";
import { isBalanceClassAccount } from "../../lib/glAccountClass.js";
import {
  partitionByActivity,
  priorYearVarianceRowHasActivity,
  isStructuralRow,
  isNoActivityDivider,
  withNoActivitySection,
  readShowNoActivity,
  writeShowNoActivity,
} from "../../lib/varianceRowActivity.js";
import {
  readShowTopVarianceChart,
  writeShowTopVarianceChart,
} from "../../lib/varianceTopChartPreference.js";
import NoActivityDisclosureRow from "../variance/NoActivityDisclosureRow.jsx";
import VarianceProvenancePanel from "../variance/VarianceProvenancePanel.jsx";
import {
  buildVarianceHeader,
  COMPARISON,
} from "../../lib/varianceProvenance/varianceProvenance.js";
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";
import { currentMonthMarkerValue } from "../../lib/budgetOutputSurfaces.js";
import { T } from "../../lib/theme.js";
import {
  bandedRowStyle,
  statementHeaderCellStyle,
} from "../../lib/tableStyles.js";
import StatementStickyGrid from "../statements/StatementStickyGrid.jsx";
import StatementBandLabel from "../../lib/statementBandLabel.jsx";
import {
  statementRowPresentation,
  formatStatementMoney,
} from "../../lib/statementPresentation.js";

const SECTION_LABEL = {
  revenue: "Revenue",
  operating_expense: "Operating Expense",
  below_noi: "Below NOI",
  asset: "Assets",
  liability: "Liabilities",
  other: "Other",
};

export default function PriorYearVariancePage({ C = {}, propertyCode } = {}) {
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

  const [rows, setRows] = useState([]);
  const [noiRows, setNoiRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openAccount, setOpenAccount] = useState(null);
  const [glKey, setGlKey] = useState(null);
  const [glCache, setGlCache] = useState({});

  const [showBalanceSheet, setShowBalanceSheet] = useState(false);

  const [showNoActivity, setShowNoActivity] = useState(readShowNoActivity);
  const toggleNoActivity = () =>
    setShowNoActivity((prev) => {
      writeShowNoActivity(!prev);
      return !prev;
    });

  const [showTopChart, setShowTopChart] = useState(readShowTopVarianceChart);
  const toggleTopChart = () =>
    setShowTopChart((prev) => {
      writeShowTopVarianceChart(!prev);
      return !prev;
    });

  useEffect(() => {
    if (!propertyCode) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setOpenAccount(null);
    setGlKey(null);
    setGlCache({});
    Promise.all([
      fetchPyVariance(propertyCode),
      fetchPyNoiVariance(propertyCode),
    ])
      .then(([cv, nv]) => {
        if (!alive) return;
        if (cv.error || nv.error) setError(cv.error || nv.error);
        setRows(cv.data || []);
        setNoiRows(nv.data || []);
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

  const visibleRows = useMemo(
    () =>
      showBalanceSheet
        ? rows
        : rows.filter((r) => !isBalanceClassAccount(r.account_number)),
    [rows, showBalanceSheet],
  );
  const summary = useMemo(
    () => summarizePyVariance(visibleRows),
    [visibleRows],
  );
  const sections = useMemo(() => rollupBySection(visibleRows), [visibleRows]);
  const visibleAccountRows = useMemo(
    () => aggregateByAccount(visibleRows),
    [visibleRows],
  );
  const statement = useMemo(
    () =>
      buildPyVarianceStatementRows({
        specRows: COA_STATEMENT_SPEC.incomeStatement,
        rows,
        balanceSheetAccounts: COA_STATEMENT_SPEC.balanceSheetAccounts,
        includeBalanceSheet: showBalanceSheet,
      }),
    [rows, showBalanceSheet],
  );
  const isRows = statement.rows;
  const monthCols = statement.axis || [];
  const markedMonthEnd = useMemo(
    () => currentMonthMarkerValue(monthCols.map((m) => m.month_end)),
    [monthCols],
  );
  const TOTAL_COLS = 2 + monthCols.length * 3 + 4;
  const stickyCell = {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: card,
    borderRight: `1px solid ${border}`,
  };
  const stickyHead = { ...stickyCell, background: subtle, zIndex: 3 };
  const stickyTh1 = statementHeaderCellStyle(
    {},
    { row: 0, background: subtle },
  );
  const stickyTh2 = statementHeaderCellStyle(
    {},
    { row: 1, background: subtle },
  );
  const stickyThCorner = { ...stickyHead, ...stickyTh1, zIndex: 4 };
  const chartData = useMemo(
    () => topVarianceAccounts(visibleAccountRows, 10),
    [visibleAccountRows],
  );
  const { active: activeIsRows, inactive: noActivityIsRows } = useMemo(
    () =>
      partitionByActivity(isRows, {
        hasActivity: priorYearVarianceRowHasActivity,
        isPinned: isStructuralRow,
      }),
    [isRows],
  );
  const displayIsRows = useMemo(
    () => withNoActivitySection(activeIsRows, noActivityIsRows, showNoActivity),
    [activeIsRows, noActivityIsRows, showNoActivity],
  );
  const overlap = useMemo(() => hasPriorYearOverlap(rows), [rows]);
  const noiLines = useMemo(() => aggregatePyNoiByLine(noiRows), [noiRows]);

  const varColor = (variance, section) => {
    const fav = isFavorable(variance, section);
    if (fav === null) return text;
    return fav ? green : red;
  };

  const monthCells = (row, keyPrefix, bold = false) =>
    (row.monthly || []).map((m, i) => (
      <React.Fragment key={`${keyPrefix}-m${i}`}>
        <td
          style={{
            ...tdNum,
            borderLeft: `1px solid ${border}`,
            color: m.py_available ? undefined : sub,
            fontWeight: bold ? 700 : undefined,
          }}
        >
          {m.py === null
            ? ""
            : m.py_available
              ? formatStatementMoney(m.py)
              : EMPTY}
        </td>
        <td style={{ ...tdNum, fontWeight: bold ? 700 : undefined }}>
          {m.current === null ? "" : formatStatementMoney(m.current)}
        </td>
        <td
          style={{
            ...tdNum,
            color: m.py_available ? varColor(m.variance, row.noi_section) : sub,
            fontWeight: bold ? 700 : 600,
          }}
        >
          {m.variance === null
            ? ""
            : m.py_available
              ? formatStatementMoney(m.variance)
              : EMPTY}
        </td>
      </React.Fragment>
    ));

  const toggleAccount = (acct) => {
    setGlKey(null);
    setOpenAccount((cur) => (cur === acct ? null : acct));
  };

  const openGl = (acct, monthEnd) => {
    const key = `${acct}|${monthEnd}`;
    if (glKey === key) {
      setGlKey(null);
      return;
    }
    setGlKey(key);
    if (!glCache[key]) {
      setGlCache((c) => ({
        ...c,
        [key]: { loading: true, rows: [], error: null },
      }));
      fetchAccountGlDetail(propertyCode, acct, monthEnd)
        .then(({ data, error: glErr }) => {
          setGlCache((c) => ({
            ...c,
            [key]: { loading: false, rows: data || [], error: glErr || null },
          }));
        })
        .catch((err) => {
          setGlCache((c) => ({
            ...c,
            [key]: { loading: false, rows: [], error: err },
          }));
        });
    }
  };

  const noPy = (
    <em style={{ color: sub, fontStyle: "italic" }}>no prior-year data</em>
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
            Prior-Year Variance
          </h1>
          <p style={{ fontSize: 13, color: sub, margin: "4px 0 0" }}>
            Live actuals vs the same month one year earlier. Variance = Current
            − Prior Year. Click an account to drill into months, then a month
            for the arithmetic and the GL monthly net change behind the current
            actual. Journal-line detail lives in Entrata.
          </p>
        </div>
      </div>

      {propertyCode && loading && (
        <div style={{ padding: 24, color: sub, fontSize: 14 }} role="status">
          Loading prior-year variance…
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
          Could not load prior-year variance for {propertyCode}.{" "}
          {error?.message ? String(error.message) : ""}
        </div>
      )}
      {propertyCode && !loading && !error && rows.length === 0 && (
        <div
          style={{
            padding: 24,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 14,
          }}
        >
          No general-ledger actuals for {propertyCode} yet. Prior-year variance
          compares live GL to the same month last year; it appears once GL data
          is ingested for this property.
        </div>
      )}
      {propertyCode && !loading && !error && rows.length > 0 && !overlap && (
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
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: text,
              marginBottom: 6,
            }}
          >
            {propertyCode} has not existed for a full prior year yet.
          </div>
          Prior-year variance compares each month to the same month one year
          earlier. This property's general ledger does not yet reach back a full
          year, so there is no prior-year baseline to compare against. The
          comparison becomes available once twelve months of additional GL
          history accrue. Until then, use Budget Variance to track performance
          against the approved budget.
        </div>
      )}

      {propertyCode && !loading && !error && rows.length > 0 && overlap && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {[
              { label: "Prior year", value: formatCurrencyFull(summary.py) },
              { label: "Current", value: formatCurrencyFull(summary.current) },
              {
                label: "Variance",
                value: formatCurrencyFull(summary.variance),
                color: summary.variance >= 0 ? green : red,
              },
              {
                label: "% Variance",
                value: formatPercent(summary.pct_variance, { signed: true }),
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
                    fontSize: 19,
                    fontWeight: 700,
                    marginTop: 4,
                    color: s.color || text,
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
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {sections.map((s) => (
              <div
                key={s.noi_section}
                style={{
                  background: card,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: 12, color: sub }}>
                  {SECTION_LABEL[s.noi_section] || s.noi_section}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    marginTop: 2,
                    color: varColor(s.variance, s.noi_section),
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatCurrencyFull(s.variance)}{" "}
                  <span style={{ fontSize: 12, fontWeight: 500, color: sub }}>
                    {formatPercent(s.pct_variance, { signed: true })}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                  prior {formatCurrencyFull(s.py)} · current{" "}
                  {formatCurrencyFull(s.current)}
                </div>
              </div>
            ))}
          </div>

          {chartData.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  margin: showTopChart ? "0 0 4px" : "0 0 24px",
                }}
              >
                <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                  Top variance by account
                </h2>
                <button
                  type="button"
                  aria-expanded={showTopChart}
                  aria-controls="variance-top-chart"
                  onClick={toggleTopChart}
                  style={{
                    background: "none",
                    border: "none",
                    color: sub,
                    cursor: "pointer",
                    fontSize: 12,
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  {showTopChart ? "Hide chart" : "Show chart"}
                </button>
              </div>
              {showTopChart && (
                <>
                  <p
                    style={{
                      fontSize: 12,
                      color: sub,
                      margin: "0 0 8px",
                      lineHeight: 1.5,
                    }}
                  >
                    The ten largest variances by size over the selected period,
                    largest first, over the accounts currently shown — so
                    ticking “Show balance-sheet accounts” below changes which
                    ten appear. Accounts with no prior-year data are excluded.
                    Individual GL accounts, not account groups.
                  </p>
                  <div
                    id="variance-top-chart"
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
                      height={Math.max(180, chartData.length * 30)}
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
                          width={215}
                          stroke={sub}
                          fontSize={11}
                          interval={0}
                        />
                        <Tooltip
                          formatter={(v) => formatCurrencyFull(v)}
                          cursor={{ fill: subtle }}
                        />
                        <Bar dataKey="variance" radius={[0, 3, 3, 0]}>
                          {chartData.map((a, i) => (
                            <Cell
                              key={i}
                              fill={
                                varColor(a.variance, a.noi_section) === text
                                  ? sub
                                  : varColor(a.variance, a.noi_section)
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              margin: "0 0 8px",
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
              By account
            </h2>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: sub,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={showBalanceSheet}
                onChange={(e) => setShowBalanceSheet(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              Show balance-sheet accounts
            </label>
          </div>
          <StatementStickyGrid theme={{ border, subtle, cardBg: card }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: card,
              }}
            >
              <thead data-statement-header="" style={{ background: subtle }}>
                <tr>
                  <th style={{ ...th, ...stickyThCorner }} rowSpan={2}>
                    Account
                  </th>
                  <th style={{ ...th, ...stickyTh1 }} rowSpan={2}>
                    Section
                  </th>
                  {monthCols.map((m) => (
                    <th
                      key={`mh-${m.month_index}`}
                      {...(markedMonthEnd != null &&
                      m.month_end === markedMonthEnd
                        ? { "data-statement-current-month": "" }
                        : null)}
                      style={{
                        ...thNum,
                        ...stickyTh1,
                        textAlign: "center",
                        borderLeft: `1px solid ${border}`,
                      }}
                      colSpan={3}
                    >
                      {m.label}
                    </th>
                  ))}
                  <th
                    style={{
                      ...thNum,
                      ...stickyTh1,
                      textAlign: "center",
                      borderLeft: `2px solid ${border}`,
                    }}
                    colSpan={4}
                  >
                    Period total
                  </th>
                </tr>
                <tr>
                  {monthCols.map((m) => (
                    <React.Fragment key={`msh-${m.month_index}`}>
                      <th
                        style={{
                          ...thNum,
                          ...stickyTh2,
                          borderLeft: `1px solid ${border}`,
                        }}
                      >
                        PY
                      </th>
                      <th style={{ ...thNum, ...stickyTh2 }}>Cur</th>
                      <th style={{ ...thNum, ...stickyTh2 }}>Var</th>
                    </React.Fragment>
                  ))}
                  <th
                    style={{
                      ...thNum,
                      ...stickyTh2,
                      borderLeft: `2px solid ${border}`,
                    }}
                  >
                    Prior year
                  </th>
                  <th style={{ ...thNum, ...stickyTh2 }}>Current</th>
                  <th style={{ ...thNum, ...stickyTh2 }}>Variance</th>
                  <th style={{ ...thNum, ...stickyTh2 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {displayIsRows.map((r, ri) => {
                  if (isNoActivityDivider(r)) {
                    return (
                      <NoActivityDisclosureRow
                        key="__no_activity__"
                        count={noActivityIsRows.length}
                        open={showNoActivity}
                        onToggle={toggleNoActivity}
                        colSpan={TOTAL_COLS}
                        noun="account"
                        theme={{ text, sub, border, subtle }}
                      />
                    );
                  }
                  if (r.kind === "header") {
                    const hp = statementRowPresentation(r);
                    return (
                      <tr
                        key={r.key}
                        data-statement-heading={r.key}
                        data-statement-depth={r.depth ?? 0}
                        data-statement-label={r.line_label}
                      >
                        <td
                          colSpan={TOTAL_COLS}
                          style={{
                            ...td,
                            ...hp,
                            background: subtle,
                            color: text,
                            fontSize: r.headerKind === "section" ? 11 : 12,
                          }}
                        >
                          <StatementBandLabel
                            label={r.line_label}
                            leftPad={hp.paddingLeft}
                          />
                        </td>
                      </tr>
                    );
                  }
                  if (r.kind === "subtotal" || r.kind === "total") {
                    return (
                      <tr
                        key={r.key}
                        data-statement-total={r.key}
                        data-statement-depth={r.depth ?? 0}
                        style={bandedRowStyle(ri, bandC, {
                          background: subtle,
                        })}
                      >
                        <td
                          style={{
                            ...td,
                            ...stickyCell,
                            background: subtle,
                            ...statementRowPresentation(r),
                          }}
                        >
                          {r.line_label}
                        </td>
                        <td style={td} />
                        {monthCells(r, r.key, true)}
                        <td
                          style={{
                            ...tdNum,
                            borderLeft: `2px solid ${border}`,
                            fontWeight: 700,
                          }}
                        >
                          {r.py_available ? formatStatementMoney(r.py) : noPy}
                        </td>
                        <td style={{ ...tdNum, fontWeight: 700 }}>
                          {formatStatementMoney(r.current)}
                        </td>
                        <td
                          style={{
                            ...tdNum,
                            color: r.py_available
                              ? varColor(r.variance, r.noi_section)
                              : sub,
                            fontWeight: 700,
                          }}
                        >
                          {r.py_available
                            ? formatStatementMoney(r.variance)
                            : EMPTY}
                        </td>
                        <td style={tdNum}>
                          {r.py_available
                            ? formatPercent(r.pct_variance, { signed: true })
                            : EMPTY}
                        </td>
                      </tr>
                    );
                  }
                  const isOpen = openAccount === r.account_number;
                  const months = isOpen
                    ? monthsForAccount(rows, r.account_number)
                    : [];
                  return (
                    <React.Fragment key={r.key}>
                      <tr
                        onClick={() => toggleAccount(r.account_number)}
                        style={{
                          ...bandedRowStyle(ri, bandC, {
                            background: isOpen ? subtle : undefined,
                          }),
                          cursor: "pointer",
                        }}
                      >
                        <td
                          style={{
                            ...td,
                            ...stickyCell,
                            background: isOpen ? subtle : card,
                            paddingLeft: statementRowPresentation({
                              kind: "account",
                              depth: r.depth,
                            }).paddingLeft,
                          }}
                        >
                          {isOpen ? "▾" : "▸"} {r.account_number}
                          {r.account_name ? ` · ${r.account_name}` : ""}
                        </td>
                        <td style={{ ...td, color: sub }}>
                          {r.noi_section || EMPTY}
                        </td>
                        {monthCells(r, r.key)}
                        <td
                          style={{
                            ...tdNum,
                            borderLeft: `2px solid ${border}`,
                          }}
                        >
                          {r.py_available ? formatStatementMoney(r.py) : noPy}
                        </td>
                        <td style={tdNum}>{formatStatementMoney(r.current)}</td>
                        <td
                          style={{
                            ...tdNum,
                            color: r.py_available
                              ? varColor(r.variance, r.noi_section)
                              : sub,
                            fontWeight: 600,
                          }}
                        >
                          {r.py_available
                            ? formatStatementMoney(r.variance)
                            : EMPTY}
                        </td>
                        <td style={tdNum}>
                          {r.py_available
                            ? formatPercent(r.pct_variance, { signed: true })
                            : EMPTY}
                        </td>
                      </tr>
                      {isOpen &&
                        months.map((m) => {
                          const key = `${r.account_number}|${m.month_end}`;
                          const gl = glCache[key];
                          const glOpen = glKey === key;
                          return (
                            <React.Fragment key={m.month_end}>
                              <tr
                                onClick={() =>
                                  openGl(r.account_number, m.month_end)
                                }
                                style={{
                                  cursor: "pointer",
                                  background: glOpen ? subtle : card,
                                }}
                              >
                                <td
                                  style={{
                                    ...td,
                                    ...stickyCell,
                                    background: glOpen ? subtle : card,
                                    paddingLeft: 28,
                                    color: sub,
                                  }}
                                >
                                  {glOpen ? "▾" : "▸"} {m.month_end}
                                  {m.py_available ? (
                                    <em style={{ color: sub }}>
                                      {" "}
                                      vs {m.py_month_end}
                                    </em>
                                  ) : null}
                                </td>
                                <td style={{ ...td, color: sub }} />
                                {monthCols.length > 0 && (
                                  <td colSpan={monthCols.length * 3} />
                                )}
                                <td
                                  style={{
                                    ...tdNum,
                                    borderLeft: `2px solid ${border}`,
                                  }}
                                >
                                  {m.py_available
                                    ? formatStatementMoney(m.py)
                                    : noPy}
                                </td>
                                <td style={tdNum}>
                                  {formatStatementMoney(m.current)}
                                </td>
                                <td
                                  style={{
                                    ...tdNum,
                                    color: m.py_available
                                      ? varColor(m.variance, r.noi_section)
                                      : sub,
                                  }}
                                >
                                  {m.py_available
                                    ? formatStatementMoney(m.variance)
                                    : EMPTY}
                                </td>
                                <td style={tdNum} />
                              </tr>
                              {glOpen && (
                                <tr>
                                  <td
                                    colSpan={TOTAL_COLS}
                                    style={{
                                      ...td,
                                      paddingLeft: 44,
                                      background: subtle,
                                    }}
                                  >
                                    <VarianceProvenancePanel
                                      header={buildVarianceHeader({
                                        comparison: COMPARISON.PRIOR_YEAR,
                                        label: `${r.account_number} · ${m.month_end}`,
                                        actual: m.current,
                                        baseline: m.py,
                                        actualSource: "Live GL",
                                        actualAsOf: m.month_end,
                                        baselineSource: "Prior-year GL",
                                        baselineAsOf: m.py_month_end,
                                        baselineAvailable: m.py_available,
                                      })}
                                      entry={gl}
                                      reconcilesTo={m.current}
                                      reconcileLabel="Current"
                                      theme={{
                                        text,
                                        sub,
                                        border,
                                        card,
                                        subtle,
                                        red,
                                      }}
                                    />
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </StatementStickyGrid>

          {noiLines.length > 0 && (
            <>
              <h2
                style={{ fontSize: 15, fontWeight: 700, margin: "24px 0 8px" }}
              >
                NOI build
              </h2>
              <p style={{ fontSize: 12, color: sub, margin: "0 0 8px" }}>
                Live GL rolled into the NOI build lines vs the same month one
                year earlier. Subtotals and totals are shown in bold.
              </p>
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
                      <th style={th}>Line</th>
                      <th style={thNum}>Prior year</th>
                      <th style={thNum}>Current</th>
                      <th style={thNum}>Variance</th>
                      <th style={thNum}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noiLines.map((r, ri) => {
                      const isTotal =
                        r.line_type === "total" || r.line_type === "subtotal";
                      return (
                        <tr
                          key={r.line_id}
                          style={bandedRowStyle(ri, bandC, {
                            background: isTotal ? subtle : undefined,
                          })}
                        >
                          <td
                            style={{ ...td, fontWeight: isTotal ? 700 : 400 }}
                          >
                            {r.line_label}
                          </td>
                          <td style={tdNum}>
                            {r.py_available ? formatStatementMoney(r.py) : noPy}
                          </td>
                          <td
                            style={{
                              ...tdNum,
                              fontWeight: isTotal ? 700 : 400,
                            }}
                          >
                            {formatStatementMoney(r.current)}
                          </td>
                          <td
                            style={{
                              ...tdNum,
                              color: r.py_available
                                ? varColor(r.variance, r.noi_section)
                                : sub,
                              fontWeight: isTotal ? 700 : 600,
                            }}
                          >
                            {r.py_available
                              ? formatStatementMoney(r.variance)
                              : EMPTY}
                          </td>
                          <td style={tdNum}>
                            {r.py_available
                              ? formatPercent(r.pct_variance, { signed: true })
                              : EMPTY}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
