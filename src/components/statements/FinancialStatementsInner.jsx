import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "../../lib/theme.js";
import {
  bandedRowStyle,
  statementHeaderCellStyle,
} from "../../lib/tableStyles.js";
import {
  statementRowPresentation,
  statementIndent,
} from "../../lib/statementPresentation.js";
import { currentMonthMarkerValue } from "../../lib/budgetOutputSurfaces.js";
import StatementStickyGrid from "./StatementStickyGrid.jsx";
import {
  fetchAccountGlDetail,
  logExportEvent,
  getCurrentOrgName,
  fetchGlActualFreshness,
} from "../../lib/supabaseClient.js";
import {
  freshnessCaption,
  GL_SYNC_WINDOW_CAPTION,
} from "../../lib/dataFreshness.js";
import {
  startStatementSample,
  formatStatementPerf,
  statementPerfEnabled,
} from "../../lib/statementPerf.js";
import { downloadPdf } from "../../lib/pdf/pdfEngine.js";
import { buildFinancialStatementDocDefinition } from "../../lib/pdf/financialStatementPdf.js";
import {
  fetchIncomeStatement,
  fetchBalanceSheet,
  fetchAccountBalanceDetail,
  fetchNoiSectionMap,
  fetchGlTreeAccountCount,
  buildIncomeStatement,
  buildBalanceSheet,
  monthEndIso,
  lastClosedMonth,
  shiftMonth,
} from "../../lib/financialStatements.js";

function fmtMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

const MONTH_NAMES = [
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

function fmtMonth(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const [y, m] = iso.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${y}` : iso;
}

export default function FinancialStatementsInner({
  C = {},
  propertyCode = "",
  initialAsOfYm = "",
  initialFromYm = "",
  initialToYm = "",
  onSeedConsumed,
} = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;
  const amber = C.amber || C.warning || T.warningText;

  const [noiMap, setNoiMap] = useState({});
  const [treeCount, setTreeCount] = useState(null);
  const [view, setView] = useState("is");
  const defaultTo = lastClosedMonth();
  const [fromYm, setFromYm] = useState(
    initialFromYm || shiftMonth(defaultTo, -5),
  );
  const [toYm, setToYm] = useState(initialToYm || defaultTo);
  const [asOfYm, setAsOfYm] = useState(initialAsOfYm || defaultTo);
  const [stmt, setStmt] = useState({
    loading: !!propertyCode,
    error: null,
    rows: [],
  });
  const [glFresh, setGlFresh] = useState({ loaded: false, maxLastSeen: null });

  useEffect(() => {
    let alive = true;
    setGlFresh({ loaded: false, maxLastSeen: null });
    if (!propertyCode) return undefined;
    fetchGlActualFreshness(propertyCode)
      .then((s) => {
        if (alive)
          setGlFresh({ loaded: true, maxLastSeen: s?.maxLastSeen || null });
      })
      .catch(() => {
        if (alive) setGlFresh({ loaded: true, maxLastSeen: null });
      });
    return () => {
      alive = false;
    };
  }, [propertyCode]);
  const [drill, setDrill] = useState(null);
  const perfRef = useRef(null);
  const [perfSample, setPerfSample] = useState(null);
  const perfOn = statementPerfEnabled();

  useEffect(() => {
    if (!(initialAsOfYm || initialFromYm || initialToYm)) return;
    if (initialFromYm) setFromYm(initialFromYm);
    if (initialToYm) setToYm(initialToYm);
    if (initialAsOfYm) setAsOfYm(initialAsOfYm);
    if (onSeedConsumed) onSeedConsumed();
  }, [initialAsOfYm, initialFromYm, initialToYm]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [n, t] = await Promise.all([
        fetchNoiSectionMap(),
        fetchGlTreeAccountCount(),
      ]);
      if (!alive) return;
      setNoiMap(n.data || {});
      setTreeCount(t.error ? null : t.data);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!propertyCode) return;
    let alive = true;
    setStmt({ loading: true, error: null, rows: [] });
    setDrill(null);
    const perf = startStatementSample({
      surface: "financial-statements",
      view,
      propertyCode,
      params: view === "is" ? { fromYm, toYm } : { asOfYm },
    });
    perfRef.current = perf;
    perf.begin();
    (async () => {
      const res =
        view === "is"
          ? await fetchIncomeStatement(
              propertyCode,
              monthEndIso(fromYm),
              monthEndIso(toYm),
            )
          : await fetchBalanceSheet(propertyCode, monthEndIso(asOfYm));
      if (!alive) {
        perf.abort();
        return;
      }
      perf.fetched((res.data || []).length);
      setStmt({ loading: false, error: res.error, rows: res.data || [] });
    })();
    return () => {
      alive = false;
      perf.abort();
    };
  }, [propertyCode, view, fromYm, toYm, asOfYm]);

  const isModel = useMemo(() => {
    const m = view === "is" ? buildIncomeStatement(stmt.rows, noiMap) : null;
    if (m) perfRef.current?.built();
    return m;
  }, [view, stmt.rows, noiMap]);
  const markedMonth = useMemo(
    () => currentMonthMarkerValue(isModel?.months),
    [isModel],
  );
  const bsModel = useMemo(() => {
    const m = view === "bs" ? buildBalanceSheet(stmt.rows) : null;
    if (m) perfRef.current?.built();
    return m;
  }, [view, stmt.rows]);

  useEffect(() => {
    if (stmt.loading) return undefined;
    const perf = perfRef.current;
    if (!perf || !perf.enabled) return undefined;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        perf.painted();
        setPerfSample({ ...perf.sample });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [stmt]);

  async function openIsDrill(account, monthEnd) {
    setDrill({
      kind: "is",
      account,
      monthEnd,
      loading: true,
      error: null,
      rows: [],
    });
    const res = await fetchAccountGlDetail(
      propertyCode,
      account.accountNumber,
      monthEnd,
    );
    setDrill((d) =>
      d && d.kind === "is" && d.account === account && d.monthEnd === monthEnd
        ? { ...d, loading: false, error: res.error, rows: res.data || [] }
        : d,
    );
  }

  async function openBsDrill(account) {
    if (!account.accountNumber) return;
    setDrill({ kind: "bs", account, loading: true, error: null, rows: [] });
    const res = await fetchAccountBalanceDetail(
      propertyCode,
      account.accountNumber,
    );
    setDrill((d) =>
      d && d.kind === "bs" && d.account === account
        ? { ...d, loading: false, error: res.error, rows: res.data || [] }
        : d,
    );
  }

  function exportStatementPdf() {
    try {
      const property = { name: propertyCode };
      const orgName = getCurrentOrgName();
      const doc =
        view === "is"
          ? buildFinancialStatementDocDefinition({
              incomeStatement: isModel,
              property,
              orgName,
            })
          : buildFinancialStatementDocDefinition({
              balanceSheet: bsModel,
              property,
              orgName,
            });
      const label = view === "is" ? "income-statement" : "balance-sheet";
      const fname =
        "FinancialStatements-" +
        String(propertyCode || "property").replace(/[^a-z0-9]+/gi, "-") +
        "-" +
        label +
        ".pdf";
      downloadPdf(doc, fname).catch((e) =>
        console.error("Financial statement PDF export failed:", e),
      );
      logExportEvent({
        datasetKey: "financial-statements:" + propertyCode + ":" + view,
        format: "pdf",
        rowCount: (stmt.rows || []).length,
        action: "completed",
      }).catch(() => {});
    } catch (e) {
      console.error("Financial statement PDF export failed:", e);
    }
  }

  const th = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: sub,
    textAlign: "right",
    padding: "6px 10px",
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const thLeft = { ...th, textAlign: "left" };
  const stickyTheme = {
    border,
    tableHeaderBg: C.tableHeaderBg,
    subtleBg: subtle,
    cardBg: card,
  };
  const gridTh = {
    ...th,
    borderBottom: undefined,
    ...statementHeaderCellStyle(stickyTheme, { row: 0 }),
  };
  const gridThLeft = { ...gridTh, textAlign: "left" };

  const sectionPres = statementRowPresentation({
    kind: "header",
    headerKind: "section",
    depth: 0,
  });
  const branchPres = statementRowPresentation({
    kind: "header",
    headerKind: "group",
    depth: 1,
  });
  const branchTotalPres = statementRowPresentation({
    kind: "subtotal",
    depth: 1,
  });
  const sectionTotalPres = statementRowPresentation({
    kind: "subtotal",
    depth: 0,
  });
  const bottomLinePres = statementRowPresentation({
    kind: "subtotal",
    depth: 0,
    isGrandTotal: true,
  });
  const accountIndent = statementIndent(2);
  const td = {
    fontSize: 12,
    color: text,
    textAlign: "right",
    padding: "4px 10px",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  };
  const tdLeft = { ...td, textAlign: "left", whiteSpace: "normal" };
  const cellBtn = {
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    color: "inherit",
    cursor: "pointer",
    textDecoration: "underline dotted",
    textUnderlineOffset: 2,
  };
  const sectionRow = {
    fontSize: 12,
    color: text,
    padding: "10px 10px 4px",
    paddingLeft: sectionPres.paddingLeft,
    fontWeight: sectionPres.fontWeight,
    textTransform: sectionPres.textTransform,
    letterSpacing: sectionPres.letterSpacing,
    background: subtle,
    textAlign: "left",
  };
  const branchRow = {
    fontSize: 12,
    color: sub,
    padding: "8px 10px 2px",
    paddingLeft: branchPres.paddingLeft,
    fontWeight: branchPres.fontWeight,
    textTransform: branchPres.textTransform,
    letterSpacing: branchPres.letterSpacing,
    background: card,
    textAlign: "left",
  };
  const subtotalTd = {
    ...td,
    fontWeight: branchTotalPres.fontWeight,
    borderTop: `1px solid ${border}`,
  };
  const totalTd = {
    ...td,
    fontWeight: sectionTotalPres.fontWeight,
    borderTop: `2px solid ${border}`,
  };
  const branchTotalLabelTd = {
    ...tdLeft,
    fontWeight: branchTotalPres.fontWeight,
    paddingLeft: branchTotalPres.paddingLeft,
  };
  const sectionTotalLabelTd = {
    ...tdLeft,
    fontWeight: sectionTotalPres.fontWeight,
    paddingLeft: sectionTotalPres.paddingLeft,
  };
  const bottomLineLabelTd = {
    ...tdLeft,
    fontWeight: bottomLinePres.fontWeight,
    paddingLeft: bottomLinePres.paddingLeft,
  };
  const badge = (bg) => ({
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: bg || subtle,
    color: sub,
    marginLeft: 6,
  });

  const bandC = {
    tableBgAlt: C.tableBgAlt || "var(--ds-legacy-table-bg-alt)",
    border,
  };
  const bandRow = (i) =>
    bandedRowStyle(i, bandC, { borderColor: "transparent" });

  const rowStyles = {
    sectionRow,
    branchRow,
    td,
    tdLeft,
    subtotalTd,
    totalTd,
    cellBtn,
    bandRow,
    sectionTotalLabelTd,
    branchTotalLabelTd,
    accountIndent,
  };

  const toggleBtn = (active) => ({
    fontSize: 12,
    padding: "4px 12px",
    borderRadius: 6,
    cursor: "pointer",
    border: `1px solid ${border}`,
    background: active ? subtle : "transparent",
    color: active ? text : sub,
    fontWeight: active ? 600 : 400,
  });

  const drillPanel = drill ? (
    <div
      style={{
        flex: "0 0 340px",
        border: `1px solid ${border}`,
        borderRadius: 8,
        background: card,
        padding: "12px 14px",
        alignSelf: "flex-start",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: text }}>
          {drill.account.accountNumber} {drill.account.accountName}
        </div>
        <button
          onClick={() => setDrill(null)}
          style={{
            ...cellBtn,
            color: sub,
            textDecoration: "none",
            fontSize: 12,
          }}
          aria-label="Close drill panel"
        >
          Close
        </button>
      </div>
      <div style={{ fontSize: 11, color: sub, margin: "4px 0 8px" }}>
        {drill.kind === "is"
          ? `GL detail for ${fmtMonth(drill.monthEnd)}. Detail is at the account-month grain — journal-line entries live in Entrata.`
          : "Balance walk by month (closing balance and net change). Detail is at the account-month grain — journal-line entries live in Entrata."}
      </div>
      {drill.loading ? (
        <div role="status" style={{ fontSize: 12, color: sub }}>
          Loading detail…
        </div>
      ) : drill.error ? (
        <div style={{ fontSize: 12, color: red }}>
          Could not load detail: {drill.error?.message || "unknown error"}
        </div>
      ) : drill.rows.length === 0 ? (
        <div style={{ fontSize: 12, color: sub }}>
          No stored GL rows for this account here.
        </div>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {drill.kind === "is" ? (
                <>
                  <th style={thLeft}>Date</th>
                  <th style={th}>Amount</th>
                  <th style={thLeft}>Source</th>
                </>
              ) : (
                <>
                  <th style={thLeft}>Month</th>
                  <th style={th}>Closing balance</th>
                  <th style={th}>Net change</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {drill.rows.map((r, i) => (
              <tr key={i} style={bandRow(i)}>
                {drill.kind === "is" ? (
                  <>
                    <td style={tdLeft}>{r.transaction_date}</td>
                    <td style={td}>{fmtMoney(r.amount)}</td>
                    <td style={tdLeft}>{r.source}</td>
                  </>
                ) : (
                  <>
                    <td style={tdLeft}>{fmtMonth(r.month_end)}</td>
                    <td style={td}>{fmtMoney(r.closing_balance)}</td>
                    <td style={td}>
                      {r.net_change == null ? "—" : fmtMoney(r.net_change)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ) : null;

  return (
    <div style={{ padding: "18px 22px", maxWidth: 1280 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: text, margin: 0 }}>
        Financial Statements
      </h2>
      <div
        style={{
          fontSize: 12,
          color: sub,
          margin: "6px 0 14px",
          maxWidth: 760,
        }}
      >
        Income Statement and Balance Sheet rendered in Entrata's own statement
        layout (the Master GL Tree), from the platform's synced Entrata GL.
        Closed months only — the in-progress month is excluded, matching every
        actuals surface. Line drill-down is at the account-month grain;
        journal-line entries live in Entrata.
      </div>
      {propertyCode ? (
        <div
          style={{ fontSize: 11, color: sub, marginBottom: 10 }}
          data-testid="gl-freshness"
        >
          {freshnessCaption({ ...glFresh, scope: "GL data" })} ·{" "}
          {GL_SYNC_WINDOW_CAPTION}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div
          role="group"
          aria-label="Statement type"
          style={{ display: "flex", gap: 6 }}
        >
          <button
            style={toggleBtn(view === "is")}
            onClick={() => setView("is")}
          >
            Income Statement
          </button>
          <button
            style={toggleBtn(view === "bs")}
            onClick={() => setView("bs")}
          >
            Balance Sheet
          </button>
        </div>
        {view === "is" ? (
          <>
            <label style={{ fontSize: 12, color: sub }}>
              From{" "}
              <input
                type="month"
                value={fromYm}
                max={toYm}
                onChange={(e) => setFromYm(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: "3px 6px",
                  background: subtle,
                  color: text,
                  border: `1px solid ${border}`,
                  borderRadius: 6,
                }}
              />
            </label>
            <label style={{ fontSize: 12, color: sub }}>
              To{" "}
              <input
                type="month"
                value={toYm}
                min={fromYm}
                max={defaultTo}
                onChange={(e) => setToYm(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: "3px 6px",
                  background: subtle,
                  color: text,
                  border: `1px solid ${border}`,
                  borderRadius: 6,
                }}
              />
            </label>
          </>
        ) : (
          <label style={{ fontSize: 12, color: sub }}>
            As of{" "}
            <input
              type="month"
              value={asOfYm}
              max={defaultTo}
              onChange={(e) => setAsOfYm(e.target.value)}
              style={{
                fontSize: 12,
                padding: "3px 6px",
                background: subtle,
                color: text,
                border: `1px solid ${border}`,
                borderRadius: 6,
              }}
            />
          </label>
        )}
        {!stmt.loading && !stmt.error && stmt.rows.length > 0 ? (
          <button
            type="button"
            onClick={exportStatementPdf}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 12px",
              borderRadius: 6,
              cursor: "pointer",
              color: "#fff",
              background: "#0a1628",
              border: "1px solid #0a1628",
              marginLeft: "auto",
            }}
          >
            Export PDF
          </button>
        ) : null}
      </div>

      {perfOn && formatStatementPerf(perfSample) ? (
        <div
          data-testid="statement-perf"
          style={{
            fontSize: 11,
            color: sub,
            fontFamily: "ui-monospace, monospace",
            marginBottom: 8,
          }}
        >
          {formatStatementPerf(perfSample)}
        </div>
      ) : null}

      {stmt.loading ? (
        <div role="status" style={{ fontSize: 12, color: sub }}>
          Loading {view === "is" ? "income statement" : "balance sheet"}…
        </div>
      ) : stmt.error ? (
        <div
          style={{
            fontSize: 12,
            color: red,
            border: `1px solid ${red}`,
            borderRadius: 8,
            padding: "8px 12px",
            maxWidth: 640,
          }}
        >
          Could not load the{" "}
          {view === "is" ? "income statement" : "balance sheet"}:{" "}
          {stmt.error?.message || "unknown error"}
        </div>
      ) : stmt.rows.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: sub,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            padding: "10px 14px",
            maxWidth: 640,
          }}
        >
          {treeCount === 0
            ? "The Entrata GL tree has not synced yet. Statements place every line by the Master GL Tree, which lands with the next connector sweep (24-hour cadence) — data appears here once it does."
            : view === "is"
              ? `No GL actuals for ${propertyCode} between ${fmtMonth(monthEndIso(fromYm))} and ${fmtMonth(monthEndIso(toYm))}. Coverage follows the synced Entrata GL window and the workbook history.`
              : `No stored GL balances for ${propertyCode} at ${fmtMonth(monthEndIso(asOfYm))}. Balance depth follows the synced Entrata GL window (deeper after the history backfill).`}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <StatementStickyGrid
            theme={{ border, subtle, cardBg: card }}
            maxHeight={620}
            style={{ flex: "1 1 auto", minWidth: 0, background: card }}
          >
            {view === "is" && isModel ? (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead data-statement-header="">
                  <tr>
                    <th style={gridThLeft}>Line</th>
                    {isModel.months.map((m) => (
                      <th
                        key={m}
                        {...(markedMonth != null && m === markedMonth
                          ? { "data-statement-current-month": "" }
                          : null)}
                        style={gridTh}
                      >
                        {fmtMonth(m)}
                        {isModel.monthOrigins[m] ? (
                          <span style={badge()}>{isModel.monthOrigins[m]}</span>
                        ) : null}
                      </th>
                    ))}
                    <th style={gridTh}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { section: isModel.income, displaySign: 1 },
                    { section: isModel.operatingExpenses, displaySign: -1 },
                  ].map(({ section, displaySign }) => (
                    <SectionRows
                      key={section.name}
                      section={section}
                      displaySign={displaySign}
                      months={isModel.months}
                      styles={rowStyles}
                      onCell={openIsDrill}
                    />
                  ))}
                  <tr data-statement-total="noi" data-statement-depth={0}>
                    <td
                      style={{
                        ...bottomLineLabelTd,
                        borderTop: `2px solid ${border}`,
                      }}
                    >
                      Net Operating Income
                    </td>
                    {isModel.months.map((m) => (
                      <td key={m} style={totalTd}>
                        {isModel.noi.monthsPresent?.[m] === false
                          ? "—"
                          : fmtMoney(isModel.noi.byMonth[m])}
                      </td>
                    ))}
                    <td style={totalTd}>
                      {isModel.hasNoiCoverage
                        ? fmtMoney(isModel.noi.total)
                        : "—"}
                    </td>
                  </tr>
                  {isModel.otherExpenses &&
                  isModel.otherExpenses.branches.length > 0 ? (
                    <SectionRows
                      section={isModel.otherExpenses}
                      displaySign={-1}
                      months={isModel.months}
                      styles={rowStyles}
                      onCell={openIsDrill}
                    />
                  ) : null}
                  <tr
                    data-statement-total="net-income"
                    data-statement-depth={0}
                  >
                    <td style={bottomLineLabelTd}>Net Income</td>
                    {isModel.months.map((m) => (
                      <td key={m} style={{ ...td, fontWeight: 700 }}>
                        {fmtMoney(
                          isModel.netIncomeBeforeAdjustments.byMonth[m],
                        )}
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 700 }}>
                      {fmtMoney(isModel.netIncomeBeforeAdjustments.total)}
                    </td>
                  </tr>
                  {isModel.adjustments &&
                  isModel.adjustments.branches.length > 0 ? (
                    <>
                      <SectionRows
                        section={isModel.adjustments}
                        displaySign={-1}
                        months={isModel.months}
                        styles={rowStyles}
                        onCell={openIsDrill}
                      />
                      <tr
                        data-statement-total="adjusted-net-income"
                        data-statement-depth={0}
                      >
                        <td style={bottomLineLabelTd}>Adjusted Net Income</td>
                        {isModel.months.map((m) => (
                          <td key={m} style={totalTd}>
                            {fmtMoney(isModel.adjustedNetIncome.byMonth[m])}
                          </td>
                        ))}
                        <td style={totalTd}>
                          {fmtMoney(isModel.adjustedNetIncome.total)}
                        </td>
                      </tr>
                    </>
                  ) : null}
                  {!isModel.hasNoiCoverage ? (
                    <tr>
                      <td
                        colSpan={isModel.months.length + 2}
                        style={{ ...tdLeft, fontSize: 11, color: sub }}
                      >
                        The NOI line sums accounts carrying a workbook NOI
                        bucket; none are bucketed in this window, so it cannot
                        be computed and the line is shown as —.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            ) : null}

            {view === "bs" && bsModel ? (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead data-statement-header="">
                  <tr>
                    <th style={gridThLeft}>Line</th>
                    <th style={gridTh}>
                      Balance
                      {bsModel.asOf ? ` (as of ${fmtMonth(bsModel.asOf)})` : ""}
                    </th>
                    <th style={gridTh}>Last observed</th>
                  </tr>
                </thead>
                <tbody>
                  {bsModel.sections.map((section) => (
                    <BsSectionRows
                      key={section.name}
                      section={section}
                      styles={rowStyles}
                      onLine={openBsDrill}
                    />
                  ))}
                  <tr
                    data-statement-total="balance-check"
                    data-statement-depth={0}
                  >
                    <td
                      style={{
                        ...bottomLineLabelTd,
                        borderTop: `2px solid ${border}`,
                      }}
                    >
                      Balance check
                      <span style={badge()}>
                        {bsModel.identity.verifiable === false ? (
                          <span style={{ color: amber }}>
                            Cannot be verified
                          </span>
                        ) : (
                          <span
                            style={{
                              color: bsModel.identity.balanced ? green : amber,
                            }}
                          >
                            {bsModel.identity.balanced
                              ? "In balance"
                              : `Out of balance by ${fmtMoney(bsModel.identity.delta)}`}
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ ...totalTd }} colSpan={2}>
                      {bsModel.identity.verifiable === false
                        ? `${bsModel.identity.missingBalances} account ${bsModel.identity.missingBalances === 1 ? "balance is" : "balances are"} missing from this sheet, so the trial balance cannot be checked.`
                        : `Assets ${fmtMoney(bsModel.identity.assets)} vs Liabilities + Equity ${fmtMoney(bsModel.identity.liabilitiesPlusEquity)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
          </StatementStickyGrid>
          {drillPanel}
        </div>
      )}
    </div>
  );
}

function SectionRows({ section, displaySign, months, styles, onCell }) {
  const {
    sectionRow,
    branchRow,
    td,
    tdLeft,
    subtotalTd,
    totalTd,
    cellBtn,
    bandRow,
    sectionTotalLabelTd,
    branchTotalLabelTd,
    accountIndent,
  } = styles;
  return (
    <>
      <tr
        data-statement-heading={`section:${section.name}`}
        data-statement-depth={0}
        data-statement-label={section.name}
      >
        <td style={sectionRow} colSpan={months.length + 2}>
          {section.name}
        </td>
      </tr>
      {section.branches.map((b) => (
        <BranchRows
          key={b.key}
          branch={b}
          displaySign={displaySign}
          months={months}
          collapsed={!!section.collapsed}
          accountIndent={section.collapsed ? statementIndent(1) : accountIndent}
          styles={{
            branchRow,
            td,
            tdLeft,
            subtotalTd,
            cellBtn,
            bandRow,
            branchTotalLabelTd,
          }}
          onCell={onCell}
        />
      ))}
      <tr
        data-statement-total={`section:${section.name}`}
        data-statement-depth={0}
      >
        <td style={sectionTotalLabelTd}>Total {section.name}</td>
        {months.map((m) => (
          <td key={m} style={totalTd}>
            {fmtMoney(section.total.byMonth[m] * displaySign)}
          </td>
        ))}
        <td style={totalTd}>{fmtMoney(section.total.total * displaySign)}</td>
      </tr>
    </>
  );
}

function BranchRows({
  branch,
  displaySign,
  months,
  collapsed = false,
  accountIndent = statementIndent(2),
  styles,
  onCell,
}) {
  const {
    branchRow,
    td,
    tdLeft,
    subtotalTd,
    cellBtn,
    bandRow,
    branchTotalLabelTd,
  } = styles;
  return (
    <>
      {collapsed ? null : (
        <tr
          data-statement-heading={`branch:${branch.key}`}
          data-statement-depth={1}
          data-statement-label={branch.branchName}
        >
          <td style={branchRow} colSpan={months.length + 2}>
            {branch.branchName}
          </td>
        </tr>
      )}
      {branch.accounts.map((a, ai) => (
        <tr
          key={a.accountNumber || a.accountName}
          style={bandRow ? bandRow(ai) : undefined}
        >
          <td style={{ ...tdLeft, paddingLeft: accountIndent }}>
            {a.accountNumber} {a.accountName}
          </td>
          {months.map((m) => (
            <td key={m} style={td}>
              <button
                style={cellBtn}
                onClick={() => onCell(a, m)}
                aria-label={`Detail for ${a.accountNumber} ${fmtMonth(m)}`}
              >
                {a.monthsPresent?.[m] === false
                  ? "—"
                  : fmtMoney(a.byMonth[m] * displaySign)}
              </button>
            </td>
          ))}
          <td style={td}>{fmtMoney(a.total * displaySign)}</td>
        </tr>
      ))}
      {branch.showSummaryRow && !collapsed ? (
        <tr
          data-statement-total={`branch:${branch.key}`}
          data-statement-depth={1}
        >
          <td style={branchTotalLabelTd}>
            {branch.summaryRowName || `Total ${branch.branchName}`}
          </td>
          {months.map((m) => (
            <td key={m} style={subtotalTd}>
              {fmtMoney(branch.subtotal.byMonth[m] * displaySign)}
            </td>
          ))}
          <td style={subtotalTd}>
            {fmtMoney(branch.subtotal.total * displaySign)}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BsSectionRows({ section, styles, onLine }) {
  const {
    sectionRow,
    branchRow,
    td,
    tdLeft,
    subtotalTd,
    totalTd,
    cellBtn,
    bandRow,
    sectionTotalLabelTd,
    branchTotalLabelTd,
    accountIndent,
  } = styles;
  return (
    <>
      <tr
        data-statement-heading={`bs-section:${section.name}`}
        data-statement-depth={0}
        data-statement-label={section.name}
      >
        <td style={sectionRow} colSpan={3}>
          {section.name}
        </td>
      </tr>
      {section.branches.map((b) => (
        <BsBranchRows
          key={b.key}
          branch={b}
          accountIndent={accountIndent}
          styles={{
            branchRow,
            td,
            tdLeft,
            subtotalTd,
            cellBtn,
            bandRow,
            branchTotalLabelTd,
          }}
          onLine={onLine}
        />
      ))}
      <tr
        data-statement-total={`bs-section:${section.name}`}
        data-statement-depth={0}
      >
        <td style={sectionTotalLabelTd}>Total {section.name}</td>
        <td style={totalTd}>{fmtMoney(section.total.display)}</td>
        <td style={totalTd} />
      </tr>
    </>
  );
}

function BsBranchRows({
  branch,
  accountIndent = statementIndent(2),
  styles,
  onLine,
}) {
  const {
    branchRow,
    td,
    tdLeft,
    subtotalTd,
    cellBtn,
    bandRow,
    branchTotalLabelTd,
  } = styles;
  return (
    <>
      <tr
        data-statement-heading={`bs-branch:${branch.key}`}
        data-statement-depth={1}
        data-statement-label={branch.branchName}
      >
        <td style={branchRow} colSpan={3}>
          {branch.branchName}
        </td>
      </tr>
      {branch.accounts.map((a, ai) => (
        <tr
          key={a.accountNumber || a.accountName}
          style={bandRow ? bandRow(ai) : undefined}
        >
          <td style={{ ...tdLeft, paddingLeft: accountIndent }}>
            {a.accountNumber ? (
              <button
                style={cellBtn}
                onClick={() => onLine(a)}
                aria-label={`Balance walk for ${a.accountNumber}`}
              >
                {a.accountNumber} {a.accountName}
              </button>
            ) : (
              <span>{a.accountName}</span>
            )}
          </td>
          <td style={td}>
            {a.balancePresent === false ? "—" : fmtMoney(a.display)}
          </td>
          <td style={td}>{fmtMonth(a.balanceMonth)}</td>
        </tr>
      ))}
      {branch.showSummaryRow ? (
        <tr
          data-statement-total={`bs-branch:${branch.key}`}
          data-statement-depth={1}
        >
          <td style={branchTotalLabelTd}>
            {branch.summaryRowName || `Total ${branch.branchName}`}
          </td>
          <td style={subtotalTd}>{fmtMoney(branch.subtotal.display)}</td>
          <td style={subtotalTd} />
        </tr>
      ) : null}
    </>
  );
}
