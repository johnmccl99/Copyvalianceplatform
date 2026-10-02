import { formatCurrencyFull } from "./numberFormat.js";
import { calendarDaysBetween, todayISODate } from "./dateFormat.js";

export function homeIsDemoMode() {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage?.getItem("demoMode") === "1"
    );
  } catch {
    return false;
  }
}

export function sectionHasData(arr, isDemo) {
  return (Array.isArray(arr) && arr.length > 0) || !!isDemo;
}

export function computeLiveKpis(properties, actionItems) {
  const props = Array.isArray(properties) ? properties : [];
  const items = Array.isArray(actionItems) ? actionItems : [];
  const portfolioNOI = props.reduce((sum, p) => sum + (Number(p?.noi) || 0), 0);
  const portfolioOccupancy = props.length
    ? props.reduce((sum, p) => sum + (Number(p?.occupancy) || 0), 0) /
      props.length
    : 0;
  const openActionItems = items.filter((i) => i?.status !== "Completed").length;
  return {
    propertiesCount: props.length,
    portfolioNOI,
    portfolioOccupancy,
    openActionItems,
  };
}

export function computeFundKpis(fundData, pipeline, investors) {
  const funds = Array.isArray(fundData) ? fundData : [];
  const deals = Array.isArray(pipeline) ? pipeline : [];
  const invs = Array.isArray(investors) ? investors : [];
  const totalAUM = funds.reduce((sum, f) => sum + (Number(f?.aum) || 0), 0);
  const weightedAvgIRR =
    totalAUM > 0
      ? funds.reduce(
          (sum, f) =>
            sum + ((Number(f?.irr) || 0) * (Number(f?.aum) || 0)) / totalAUM,
          0,
        )
      : 0;
  const activePipelineValue = deals.reduce(
    (sum, d) => sum + (Number(d?.askPrice) || 0),
    0,
  );
  const investorCount = invs.filter((i) => i?.type === "LP").length;
  return { totalAUM, weightedAvgIRR, activePipelineValue, investorCount };
}

export const HOME_KPI_NOT_CONNECTED = "Not connected";
export const HOME_NOT_CONNECTED_SUB = "Not yet wired to a live source";

export function selectPortfolioOccupancy(entrataTotals, liveKpis) {
  const entPct =
    entrataTotals && Number.isFinite(entrataTotals.physicalOccupancyPct)
      ? entrataTotals.physicalOccupancyPct
      : null;
  if (entPct != null && (Number(entrataTotals.totalUnits) || 0) > 0) {
    return { value: entPct, source: "entrata" };
  }
  const liveOcc = Number(liveKpis?.portfolioOccupancy) || 0;
  if (liveOcc > 0) return { value: liveOcc, source: "property" };
  return { value: null, source: "none" };
}

export function computePortfolioNoiFromMonthly(rows, now = new Date()) {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const byMonth = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = new Date(r?.monthEnd);
    if (isNaN(d) || d >= monthStart) continue;
    if ((Number(r?.actualPropertyCount) || 0) <= 0) continue;
    if (r?.actualNoi == null || !Number.isFinite(Number(r.actualNoi))) continue;
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const prev = byMonth.get(key);
    if (prev) {
      prev.actualNoi += Number(r.actualNoi);
      prev.actualPropertyCount += Number(r.actualPropertyCount) || 0;
      prev.propertyCount += Number(r.propertyCount) || 0;
      if (d > prev.date) {
        prev.date = d;
        prev.monthEnd = r.monthEnd;
      }
    } else {
      byMonth.set(key, {
        key,
        date: d,
        monthEnd: r.monthEnd,
        actualNoi: Number(r.actualNoi),
        actualPropertyCount: Number(r.actualPropertyCount) || 0,
        propertyCount: Number(r.propertyCount) || 0,
      });
    }
  }
  const months = [...byMonth.values()].sort((a, b) => a.key - b.key);
  if (months.length === 0) return null;
  const win = [months[months.length - 1]];
  for (let i = months.length - 2; i >= 0 && win.length < 12; i--) {
    if (months[i].key !== win[win.length - 1].key - 1) break;
    win.push(months[i]);
  }
  if (win.length < 3) return null;
  const latest = win[0];
  const propertyCount = Math.max(...win.map((m) => m.propertyCount));
  const minActualPropertyCount = Math.min(
    ...win.map((m) => m.actualPropertyCount),
  );
  return {
    value: win.reduce((sum, m) => sum + m.actualNoi, 0),
    kind: win.length === 12 ? "t12" : "trailing",
    monthCount: win.length,
    asOfMonthEnd: latest.monthEnd,
    propertyCount: propertyCount || null,
    minActualPropertyCount: minActualPropertyCount || null,
  };
}

export function portfolioNoiSubLabel(sel) {
  if (!sel || sel.source !== "gl") return null;
  const asOf = new Date(sel.asOfMonthEnd);
  const asOfLabel = isNaN(asOf)
    ? ""
    : ` through ${asOf.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`;
  const window = sel.kind === "t12" ? "T12" : `Trailing ${sel.monthCount} mo`;
  const minProps = Number(sel.minActualPropertyCount) || 0;
  const totalProps = Number(sel.propertyCount) || 0;
  const coverage =
    minProps > 0 && totalProps > 0 && minProps < totalProps
      ? ` · ${minProps} of ${totalProps} properties`
      : "";
  return `${window} · GL actuals${asOfLabel}${coverage}`;
}

export function selectPortfolioNOI(liveKpis, noiSummary = null) {
  if (
    noiSummary &&
    typeof noiSummary.value === "number" &&
    Number.isFinite(noiSummary.value)
  ) {
    return {
      value: noiSummary.value,
      source: "gl",
      kind: noiSummary.kind,
      monthCount: noiSummary.monthCount,
      asOfMonthEnd: noiSummary.asOfMonthEnd,
      propertyCount: noiSummary.propertyCount,
      minActualPropertyCount: noiSummary.minActualPropertyCount,
    };
  }
  const noi = Number(liveKpis?.portfolioNOI) || 0;
  return noi > 0
    ? { value: noi, source: "property" }
    : { value: null, source: "none" };
}

export function activitySourceLabel(type) {
  switch (type) {
    case "capital_event":
      return "Capital Events";
    case "compliance":
      return "Compliance Calendar";
    case "lease":
      return "Lease Management";
    default:
      return "Property Operations";
  }
}

export function buildRecentActivity(capitalEvents, compliance, limit = 8) {
  const fmtAmount = (n) => formatCurrencyFull(n);
  const events = (Array.isArray(capitalEvents) ? capitalEvents : []).map(
    (e) => ({
      type: "capital_event",
      timestamp: e?.date,
      title: e?.details,
      detail: `${e?.type ?? ""}: ${fmtAmount(e?.amount)}`.trim(),
    }),
  );
  const comp = (Array.isArray(compliance) ? compliance : []).map((c) => ({
    type: "compliance",
    timestamp: c?.deadline,
    title: c?.item,
    detail: c?.status,
  }));
  return [...events, ...comp]
    .sort((a, b) => {
      const da = new Date(a.timestamp),
        db = new Date(b.timestamp);
      const va = isNaN(da) ? -Infinity : da.getTime();
      const vb = isNaN(db) ? -Infinity : db.getTime();
      return vb - va;
    })
    .slice(0, limit);
}

export function buildActionItems(actionItems, limit = 8, now = new Date()) {
  const items = Array.isArray(actionItems) ? actionItems : [];
  return items
    .filter((item) => item?.status !== "Completed")
    .sort((a, b) => new Date(a?.dueDate) - new Date(b?.dueDate))
    .slice(0, limit)
    .map((item) => {
      const daysUntilDue = calendarDaysBetween(
        todayISODate(now),
        item?.dueDate,
      );
      const isOverdue = daysUntilDue != null && daysUntilDue < 0;
      const isDueSoon =
        daysUntilDue != null && daysUntilDue >= 0 && daysUntilDue <= 3;
      return { ...item, daysUntilDue, isOverdue, isDueSoon };
    });
}

export const HOME_EMPTY_COPY = {
  actionItems:
    "No open action items. Items appear here as deadlines and tasks are assigned across the portfolio.",
  activity:
    "No recent activity. Capital events and compliance updates appear here as they post.",
};
