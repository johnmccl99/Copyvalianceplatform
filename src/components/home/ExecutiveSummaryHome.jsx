import React, { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  fetchEntrataPortfolioOccupancy,
  fetchPortfolioNoiMonthly,
  getRealPropertyFilterContext,
} from "../../lib/supabaseClient.js";
import { computePortfolioOccupancyTotals } from "../../lib/entrataBI.js";
import { formatCurrency, formatPercent } from "../../lib/numberFormat.js";
import { formatDate as formatCalendarDate } from "../../lib/dateFormat.js";
import { alpha, T } from "../../lib/theme.js";
import {
  homeIsDemoMode,
  sectionHasData,
  computeLiveKpis,
  computeFundKpis,
  buildRecentActivity,
  buildActionItems,
  activitySourceLabel,
  HOME_EMPTY_COPY,
  selectPortfolioOccupancy,
  selectPortfolioNOI,
  computePortfolioNoiFromMonthly,
  portfolioNoiSubLabel,
  HOME_KPI_NOT_CONNECTED,
  HOME_NOT_CONNECTED_SUB,
} from "../../lib/homeSummary.js";
import { visibleQuickNavCards } from "../../lib/homeQuickNav.js";
import ModuleGlossary from "./ModuleGlossary.jsx";

const BarShape = ({ getColor, ...props }) => {
  const { fill, x, y, width, height, payload } = props;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={getColor ? getColor(payload) : fill}
      radius={[0, 4, 4, 0]}
    />
  );
};

const ExecutiveSummaryHome = ({
  onNavigate,
  loading = false,
  loadError = false,
  hiddenNavKeys,
  navSections,
  onOpenSection,
  role,
  deps = {},
}) => {
  const {
    C,
    fmt,
    fmtPct,
    KPI,
    SectionCard,
    Badge,
    FUND_DATA = [],
    PROPERTIES = [],
    CASH_FLOW = [],
    DEBT_SCHEDULE = [],
    CAPITAL_EVENTS = [],
    ACTION_ITEMS = [],
    PIPELINE = [],
    INVESTORS = [],
    COMPLIANCE = [],
  } = deps;

  const [selectedFund, setSelectedFund] = useState(null);
  const [expandedAction, setExpandedAction] = useState(null);
  const [completedActions, setCompletedActions] = useState({});
  const [expandedActivity, setExpandedActivity] = useState(null);

  const [entrataRows, setEntrataRows] = useState(null);
  const [entrataLoading, setEntrataLoading] = useState(true);
  const [rpContext, setRpContext] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEntrataLoading(true);
      try {
        const rows = await fetchEntrataPortfolioOccupancy();
        if (!cancelled) setEntrataRows(Array.isArray(rows) ? rows : []);
        const ctx = await getRealPropertyFilterContext();
        if (!cancelled) setRpContext(ctx);
      } catch (err) {
        console.error("[Home] Entrata portfolio occupancy fetch failed:", err);
        if (!cancelled) setEntrataRows([]);
      } finally {
        if (!cancelled) setEntrataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [noiRows, setNoiRows] = useState(null);
  const [noiLoading, setNoiLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNoiLoading(true);
      try {
        const rows = await fetchPortfolioNoiMonthly();
        if (!cancelled) setNoiRows(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error("[Home] Portfolio NOI monthly fetch failed:", err);
        if (!cancelled) setNoiRows([]);
      } finally {
        if (!cancelled) setNoiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isDemo = homeIsDemoMode();

  const liveKpis = useMemo(
    () => computeLiveKpis(PROPERTIES, ACTION_ITEMS),
    [PROPERTIES, ACTION_ITEMS],
  );
  const fundKpis = useMemo(
    () => computeFundKpis(FUND_DATA, PIPELINE, INVESTORS),
    [FUND_DATA, PIPELINE, INVESTORS],
  );
  const actionItemsSorted = useMemo(
    () => buildActionItems(ACTION_ITEMS),
    [ACTION_ITEMS],
  );
  const quickNavCards = useMemo(
    () => visibleQuickNavCards(role, hiddenNavKeys, undefined, navSections),
    [role, hiddenNavKeys, navSections],
  );
  const recentActivity = useMemo(
    () => buildRecentActivity(CAPITAL_EVENTS, COMPLIANCE),
    [CAPITAL_EVENTS, COMPLIANCE],
  );

  const entrataTotals = useMemo(
    () => computePortfolioOccupancyTotals(entrataRows || []),
    [entrataRows],
  );
  const hasEntrataData = (Number(entrataTotals.totalUnits) || 0) > 0;
  const occupancy = useMemo(
    () => selectPortfolioOccupancy(entrataTotals, liveKpis),
    [entrataTotals, liveKpis],
  );
  const noiSummary = useMemo(
    () => computePortfolioNoiFromMonthly(noiRows || []),
    [noiRows],
  );
  const portfolioNOI = useMemo(
    () => selectPortfolioNOI(liveKpis, noiSummary),
    [liveKpis, noiSummary],
  );

  const showFundKpis = sectionHasData(FUND_DATA, isDemo);
  const showPipelineKpi = sectionHasData(PIPELINE, isDemo);
  const showInvestorKpi = sectionHasData(INVESTORS, isDemo);
  const showActionItems = sectionHasData(ACTION_ITEMS, isDemo);
  const showActivity =
    sectionHasData(CAPITAL_EVENTS, isDemo) ||
    sectionHasData(COMPLIANCE, isDemo);
  const showFundChart = sectionHasData(FUND_DATA, isDemo);
  const showCashFlow = sectionHasData(CASH_FLOW, isDemo);
  const showDebt = sectionHasData(DEBT_SCHEDULE, isDemo);

  const getDebtMaturityColor = (maturityDate) => {
    const now = new Date();
    const maturity = new Date(maturityDate);
    const months =
      (maturity.getFullYear() - now.getFullYear()) * 12 +
      (maturity.getMonth() - now.getMonth());
    if (months < 18) return C.red;
    if (months < 36) return C.amber;
    return C.green;
  };

  const NotConnectedKpi = ({ label, sub = HOME_NOT_CONNECTED_SUB }) => (
    <KPI
      label={label}
      value={HOME_KPI_NOT_CONNECTED}
      sub={sub}
      color={C.textSecondary}
    />
  );

  const EmptyState = ({ children }) => (
    <div
      style={{
        padding: "28px 16px",
        textAlign: "center",
        color: C.textSecondary,
        fontSize: T.textBody,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );

  const Skeleton = ({ height = 80 }) => (
    <div
      style={{
        height,
        borderRadius: 10,
        background: C.subtleBg || C.cardBg,
        border: `1px solid ${C.border}`,
        opacity: 0.6,
        animation: "pulse 1.6s infinite",
      }}
    />
  );

  return (
    <div style={{ padding: "20px", background: C.bg, minHeight: "100vh" }}>
      {loadError && (
        <div
          style={{
            marginBottom: 20,
            padding: "12px 16px",
            borderRadius: 8,
            background: `${alpha(C.red, 5.1)}`,
            border: `1px solid ${alpha(C.red, 25.1)}`,
            color: C.textPrimary,
            fontSize: T.textBody,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>
            Some live data could not be loaded. Showing what is available.
          </span>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: T.textDense,
              fontWeight: 600,
              background: "transparent",
              color: C.red,
              border: `1px solid ${alpha(C.red, 37.6)}`,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {(showActionItems || showActivity) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              showActionItems && showActivity ? "2fr 1fr" : "1fr",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          {showActionItems && (
            <SectionCard title="Action Items & Deadlines">
              <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                {loading && actionItemsSorted.length === 0 ? (
                  <Skeleton height={120} />
                ) : actionItemsSorted.length === 0 ? (
                  <EmptyState>{HOME_EMPTY_COPY.actionItems}</EmptyState>
                ) : (
                  actionItemsSorted.map((item, idx) => {
                    const bgHighlight = item.isOverdue
                      ? "rgba(239, 68, 68, 0.05)"
                      : item.isDueSoon
                        ? "rgba(217, 119, 6, 0.05)"
                        : "transparent";
                    const priorityColor = (() => {
                      const k = String(item.priority || "").toLowerCase();
                      if (k === "critical" || k === "high") return C.red;
                      if (k === "medium") return C.amber;
                      if (k === "low") return C.green;
                      return C.accent;
                    })();
                    const isCompleted = completedActions[idx];
                    const isExpanded = expandedAction === idx;
                    return (
                      <div
                        key={idx}
                        onClick={() =>
                          setExpandedAction(isExpanded ? null : idx)
                        }
                        style={{
                          padding: "12px",
                          borderBottom: `1px solid ${C.border}`,
                          background: isExpanded
                            ? `${alpha(C.accent, 3.1)}`
                            : isCompleted
                              ? `${alpha(C.green, 3.1)}`
                              : bgHighlight,
                          cursor: "pointer",
                          transition: "all 0.2s",
                          opacity: isCompleted ? 0.6 : 1,
                          borderLeft: isExpanded
                            ? `3px solid ${C.accent}`
                            : "3px solid transparent",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: "12px",
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompletedActions((prev) => ({
                                ...prev,
                                [idx]: !prev[idx],
                              }));
                            }}
                            style={{
                              width: "18px",
                              height: "18px",
                              borderRadius: "4px",
                              border: `2px solid ${isCompleted ? C.green : priorityColor}`,
                              background: isCompleted ? C.green : "transparent",
                              marginTop: "2px",
                              flexShrink: 0,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "10px",
                              color: "#fff",
                            }}
                          >
                            {isCompleted && "✓"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: T.textBody,
                                fontWeight: "500",
                                color: C.textPrimary,
                                textDecoration: isCompleted
                                  ? "line-through"
                                  : "none",
                              }}
                            >
                              {item.text}
                            </div>
                            <div
                              style={{
                                fontSize: T.textDense,
                                color: C.textSecondary,
                                marginTop: "4px",
                              }}
                            >
                              Due:{" "}
                              {formatCalendarDate(item.dueDate, {
                                style: "numeric",
                              })}{" "}
                              ({item.daysUntilDue} days)
                            </div>
                            <Badge text={item.category} color="default" />
                          </div>
                          {(item.isOverdue || item.isDueSoon) &&
                            !isCompleted && (
                              <div
                                style={{
                                  fontSize: "10px",
                                  fontWeight: "600",
                                  color: item.isOverdue ? C.red : C.amber,
                                  textTransform: "uppercase",
                                }}
                              >
                                {item.isOverdue ? "Overdue" : "Urgent"}
                              </div>
                            )}
                        </div>
                        {isExpanded && (
                          <div
                            style={{
                              marginTop: 10,
                              marginLeft: 30,
                              padding: 12,
                              background: C.subtleBg,
                              borderRadius: 8,
                              border: `1px solid ${C.border}`,
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                                fontSize: T.textDense,
                                marginBottom: 10,
                              }}
                            >
                              <div>
                                <span style={{ color: C.textSecondary }}>
                                  Priority:{" "}
                                </span>
                                <span
                                  style={{
                                    color: priorityColor,
                                    fontWeight: 600,
                                  }}
                                >
                                  {item.priority}
                                </span>
                              </div>
                              <div>
                                <span style={{ color: C.textSecondary }}>
                                  Category:{" "}
                                </span>
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: C.textPrimary,
                                  }}
                                >
                                  {item.category}
                                </span>
                              </div>
                              <div>
                                <span style={{ color: C.textSecondary }}>
                                  Due Date:{" "}
                                </span>
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: C.textPrimary,
                                  }}
                                >
                                  {formatCalendarDate(item.dueDate, {
                                    style: "numeric",
                                  })}
                                </span>
                              </div>
                              <div>
                                <span style={{ color: C.textSecondary }}>
                                  Status:{" "}
                                </span>
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: isCompleted
                                      ? C.green
                                      : item.isOverdue
                                        ? C.red
                                        : C.accent,
                                  }}
                                >
                                  {isCompleted
                                    ? "Completed"
                                    : item.isOverdue
                                      ? "Overdue"
                                      : "Pending"}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCompletedActions((prev) => ({
                                    ...prev,
                                    [idx]: !prev[idx],
                                  }));
                                }}
                                style={{
                                  padding: "5px 12px",
                                  borderRadius: 6,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: isCompleted ? C.amber : C.green,
                                  color: "#fff",
                                  border: "none",
                                  cursor: "pointer",
                                }}
                              >
                                {isCompleted ? "Reopen" : "Mark Complete"}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedAction(null);
                                }}
                                style={{
                                  padding: "5px 12px",
                                  borderRadius: 6,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "transparent",
                                  color: C.textSecondary,
                                  border: `1px solid ${C.border}`,
                                  cursor: "pointer",
                                }}
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </SectionCard>
          )}

          {showActivity && (
            <SectionCard title="Recent Activity">
              <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                {loading && recentActivity.length === 0 ? (
                  <Skeleton height={120} />
                ) : recentActivity.length === 0 ? (
                  <EmptyState>{HOME_EMPTY_COPY.activity}</EmptyState>
                ) : (
                  recentActivity.map((activity, idx) => {
                    const isExpanded = expandedActivity === idx;
                    const sourceLabel = activitySourceLabel(activity.type);
                    return (
                      <div
                        key={idx}
                        onClick={() =>
                          setExpandedActivity(isExpanded ? null : idx)
                        }
                        style={{
                          padding: "10px",
                          borderBottom: `1px solid ${C.border}`,
                          fontSize: T.textDense,
                          cursor: "pointer",
                          transition: "all 0.2s",
                          background: isExpanded
                            ? `${alpha(C.accent, 2.4)}`
                            : "transparent",
                          borderLeft: isExpanded
                            ? `3px solid ${C.accent}`
                            : "3px solid transparent",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: C.accent,
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                color: C.textPrimary,
                                fontWeight: "500",
                              }}
                            >
                              {activity.title}
                            </div>
                            <div
                              style={{
                                color: C.textSecondary,
                                fontSize: T.textMicro,
                                marginTop: "2px",
                              }}
                            >
                              {sourceLabel} ·{" "}
                              {isNaN(new Date(activity.timestamp))
                                ? activity.timestamp
                                : formatCalendarDate(activity.timestamp, {
                                    style: "numeric",
                                  })}
                            </div>
                          </div>
                          <span
                            style={{ fontSize: 10, color: C.textSecondary }}
                          >
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </div>
                        {isExpanded && (
                          <div
                            style={{
                              marginTop: 8,
                              marginLeft: 15,
                              padding: 10,
                              background: C.subtleBg,
                              borderRadius: 6,
                              border: `1px solid ${C.border}`,
                            }}
                          >
                            <div
                              style={{
                                fontSize: T.textMicro,
                                color: C.textSecondary,
                                marginBottom: 6,
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>Source:</span>{" "}
                              {sourceLabel}
                            </div>
                            <div
                              style={{
                                fontSize: T.textMicro,
                                color: C.textSecondary,
                                marginBottom: 6,
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>Details:</span>{" "}
                              {activity.detail || activity.title}
                            </div>
                            <div
                              style={{
                                fontSize: T.textMicro,
                                color: C.textSecondary,
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>Date:</span>{" "}
                              {isNaN(new Date(activity.timestamp))
                                ? activity.timestamp
                                : formatCalendarDate(activity.timestamp, {
                                    style: "numeric",
                                  })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {showFundChart && (
        <SectionCard title="Fund Performance Overview">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={FUND_DATA}
              margin={{ top: 20, right: 30, left: 0, bottom: 50 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                yAxisId="left"
                label={{
                  value: "IRR / DPI",
                  angle: -90,
                  position: "insideLeft",
                }}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                label={{ value: "EM (%)", angle: 90, position: "insideRight" }}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(val) => fmtPct(val)}
                contentStyle={{
                  background: C.cardBg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ fontWeight: 600, color: C.textPrimary }}
              />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="irr"
                name="IRR"
                fill={C.navy}
                style={{ cursor: "pointer" }}
                onClick={(data) => {
                  if (data && data.name)
                    setSelectedFund(
                      selectedFund === data.name ? null : data.name,
                    );
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="dpi"
                name="DPI"
                fill={C.midBlue}
                style={{ cursor: "pointer" }}
                onClick={(data) => {
                  if (data && data.name)
                    setSelectedFund(
                      selectedFund === data.name ? null : data.name,
                    );
                }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="em"
                name="EM %"
                stroke={C.accent}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {showFundChart &&
        selectedFund &&
        (() => {
          const fund = FUND_DATA.find((f) => f.name === selectedFund);
          return fund ? (
            <div
              style={{
                padding: "16px",
                background: C.cardBg,
                border: `1px solid ${alpha(C.accent, 25.1)}`,
                borderRadius: "10px",
                margin: "16px 0 24px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: T.textTitle,
                    fontWeight: "700",
                    color: C.textPrimary,
                  }}
                >
                  {fund.name}
                </div>
                <div
                  style={{
                    fontSize: T.textDense,
                    color: C.textSecondary,
                    marginTop: "4px",
                  }}
                >
                  Click a bar above to select a different fund, or click again
                  to deselect
                </div>
              </div>
              <div style={{ display: "flex", gap: "24px" }}>
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: T.textPage,
                      fontWeight: "700",
                      color: C.navy,
                    }}
                  >
                    {fund.irr}%
                  </div>
                  <div style={{ fontSize: "10px", color: C.textSecondary }}>
                    IRR
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: T.textPage,
                      fontWeight: "700",
                      color: C.midBlue,
                    }}
                  >
                    {fund.dpi}x
                  </div>
                  <div style={{ fontSize: "10px", color: C.textSecondary }}>
                    DPI
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: T.textPage,
                      fontWeight: "700",
                      color: C.accent,
                    }}
                  >
                    {fund.em}%
                  </div>
                  <div style={{ fontSize: "10px", color: C.textSecondary }}>
                    EM
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedFund(null)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  background: C.subtleBg,
                  border: `1px solid ${C.border}`,
                  color: C.textSecondary,
                  cursor: "pointer",
                  fontSize: T.textMicro,
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null;
        })()}

      {(showCashFlow || showDebt) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: showCashFlow && showDebt ? "1fr 1fr" : "1fr",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          {showCashFlow && (
            <SectionCard title="Net Cash Flow Trend (YTD)">
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={CASH_FLOW}>
                  <defs>
                    <linearGradient id="colorCF" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={C.midBlue}
                        stopOpacity={0.8}
                      />
                      <stop
                        offset="95%"
                        stopColor={C.midBlue}
                        stopOpacity={0.1}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(val) => fmt(val)}
                    contentStyle={{
                      background: C.cardBg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ fontWeight: 600, color: C.textPrimary }}
                  />
                  <Area
                    type="monotone"
                    dataKey="inflow"
                    stroke={C.midBlue}
                    fillOpacity={1}
                    fill="url(#colorCF)"
                    name="Inflow"
                  />
                  <Area
                    type="monotone"
                    dataKey="outflow"
                    stroke={C.red}
                    fillOpacity={0.5}
                    name="Outflow"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
          {showDebt && (
            <SectionCard title="Debt Maturity Timeline">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={DEBT_SCHEDULE}
                  layout="vertical"
                  margin={{ top: 10, right: 30, left: 150, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? "$" + (v / 1000000).toFixed(0) + "M"
                        : v >= 1000
                          ? "$" + (v / 1000).toFixed(0) + "K"
                          : "$" + v
                    }
                  />
                  <YAxis
                    dataKey="property"
                    type="category"
                    tick={{ fontSize: 11 }}
                    width={140}
                  />
                  <Tooltip
                    formatter={(val) => fmt(val)}
                    contentStyle={{
                      background: C.cardBg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ fontWeight: 600, color: C.textPrimary }}
                  />
                  <Bar
                    dataKey="balance"
                    fill={C.midBlue}
                    radius={[0, 4, 4, 0]}
                    shape={
                      <BarShape
                        getColor={(dp) => getDebtMaturityColor(dp.maturity)}
                      />
                    }
                  />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
        </div>
      )}

      <ModuleGlossary
        sections={navSections}
        onOpenSection={onOpenSection}
        C={C}
      />

      {quickNavCards.length >= 2 && (
        <SectionCard title="Quick Navigation">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "16px",
            }}
          >
            {quickNavCards.map((card) => (
              <div
                key={card.section || card.tab}
                onClick={() =>
                  card.section
                    ? onOpenSection?.(card.section)
                    : onNavigate?.(card.tab)
                }
                style={{
                  padding: "18px 16px",
                  background: C.cardBg,
                  border: `1px solid ${C.border}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.3s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 4px 12px rgba(0,0,0,0.1)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div
                  style={{
                    fontSize: T.textBody,
                    fontWeight: "600",
                    color: C.textPrimary,
                  }}
                >
                  {card.label}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

export default ExecutiveSummaryHome;
