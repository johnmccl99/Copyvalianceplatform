import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  fetchBudgetVariance,
  fetchBudgetVariancePairing,
  fetchBudgetNoiVariance,
  fetchNoiBuildTemplate,
  fetchBudgetBaselines,
  fetchNoiLineCalcChain,
  fetchBudgetProformaDebtService,
  fetchActualLoanPrincipalActivity,
  fetchPlatformSettings,
  fetchGlActualFreshness,
  fetchBudgetActualsThrough,
  fetchUwLineVariance,
  fetchUwLineReconciliation,
  logExportEvent,
  getCurrentOrgName,
} from "../../lib/supabaseClient.js";
import {
  freshnessCaption,
  GL_SYNC_WINDOW_CAPTION,
} from "../../lib/dataFreshness.js";
import {
  normalizeBaselines,
  resolveSelectedBaseline,
  isSelectionStale,
  baselineKey,
  parseBaselineKey,
  baselineShortLabel,
  baselineOptionLabel,
  currentFiscalYearOperatingBaseline,
} from "../../lib/budgetBaseline.js";
import {
  ACTUALS_SIDE,
  LIVE_ACTUALS,
  sealedBudgetSide,
  pairingKind,
  involvesLiveActuals,
  favourabilityApplies,
  realizedFlagApplies,
  adaptPairingRows,
  isSameSide,
  sideColumnToken,
  UNDERWRITING_SIDE,
  involvesUnderwriting,
  uwPairingOtherSide,
} from "../../lib/varianceSides.js";
import UwLineComparisonPanel from "./UwLineComparisonPanel.jsx";
import VarianceGlActivityPanel from "./VarianceGlActivityPanel.jsx";
import { fetchVarianceGlActivity } from "../../lib/varianceGlActivityClient.js";
import BudgetAssumptionPanel from "./BudgetAssumptionPanel.jsx";
import {
  assumptionFiscalYearLabel,
  budgetMonthsForAccount,
  budgetMonthsForAccounts,
  actualMonthsForAccount,
  actualMonthsForAccounts,
  ANALYSIS_MODE_BUDGET,
  ANALYSIS_MODE_VARIANCE,
  ANALYSIS_MODE_GROUP,
  canReadBudgetAssumptions,
  fiscalYearBudgetMonths,
  loadStoredAssumption,
  requestBudgetAssumptionAnalysisWithRetry,
  warmBudgetAssumptionAnalysis,
} from "../../lib/budgetAssumptionDrill.js";
import {
  buildGlActivityEntry,
  buildGlActivityTarget,
  glActivityDrillWindows,
  GL_ACTIVITY_RESOLUTION,
} from "../../lib/varianceGlActivity.js";
import {
  fiscalYearDefaultPeriod,
  firstFutureFiscalYearPeriod,
  filterRowsToPeriod,
  makePeriodPair,
  partitionRowsToPeriods,
  periodCoverage,
  priorYearPeriod,
  monthsInRows,
} from "../../lib/budgetVariancePeriod.js";
import {
  averageDivisors,
  averagePeriodTotals,
  buildPeriodPairColumns,
  pairCoverageSentence,
  pairRowsToColumns,
  periodPairTotalHeading,
  periodSpanLabel,
} from "../../lib/variancePeriodPairAxis.js";
import { formatMonthLabel, isMonthKey } from "../../lib/dateFormat.js";
import { currentMonthMarkerValue } from "../../lib/budgetOutputSurfaces.js";
import {
  resolveVarianceAlertConfig,
  resolveVarianceAlertProvenance,
} from "../../lib/varianceAlertConfig.js";
import {
  aggregateCoaByAccount,
  aggregateNoiByLine,
  headlineFromStatementRows,
  otherExpensesResidualFromStatementRows,
  principalFromDebtSources,
  debtServiceFromStatementRows,
  cashFlowFromStatementRows,
  OTHER_EXPENSES_TOTAL_LABEL,
  STATEMENT_HEADLINE_LABEL,
  DEBT_SERVICE_LABEL,
  CASH_FLOW_LABEL,
  isFavorable,
  topVarianceAccounts,
  monthsForAccount,
} from "../../lib/budgetVariance.js";
import { buildVarianceStatementRows } from "../../lib/budgetVarianceStatement.js";
import COA_STATEMENT_SPEC from "../../lib/coaStatementSpec.json";
import { isBalanceClassAccount } from "../../lib/glAccountClass.js";
import {
  partitionByActivity,
  budgetVarianceRowHasActivity,
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
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";
import {
  buildVarianceExportModel,
  budgetVarianceDatasetKey,
  budgetVarianceExportFilename,
  budgetVarianceExportRowCount,
} from "../../lib/budgetVarianceExport.js";
import { exportBudgetVarianceXLSX } from "../../lib/budgetVarianceXlsx.js";
import { buildBudgetVariancePdfDoc } from "../../lib/pdf/budgetVariancePdf.js";
import { downloadPdf } from "../../lib/pdf/pdfEngine.js";
import NoiCalcChainDrill from "./NoiCalcChainDrill.jsx";
import NoiBuildDerivedTable from "./NoiBuildDerivedTable.jsx";
import {
  deriveNoiBuildLines,
  reconcileDerivedNoi,
} from "../../lib/noiBuildDerived.js";
import { calcChainCacheKey } from "../../lib/noiCalcChain/noiCalcChain.js";
import InProgressMonthEstimate from "./InProgressMonthEstimate.jsx";
import {
  IN_PROGRESS_MONTH_ESTIMATE_HIDDEN,
  CASH_FLOW_STATEMENT_ROWS_SUBLINE_HIDDEN,
} from "../../lib/hiddenSurfaces.js";
import VarianceNotePanel from "./VarianceNotePanel.jsx";
import {
  fetchVarianceNoteAccess,
  fetchVarianceNotes,
  fetchNoteAuthorNames,
  fetchNoteHistory,
  indexVarianceNotes,
  noteCoversMonth,
  createVarianceNote,
  updateVarianceNote,
  deleteVarianceNote,
} from "../../lib/varianceNotes.js";
import TrackedChangeMark, {
  formatTrackedChangeTime,
} from "../shared/TrackedChangeMark.jsx";
import {
  attributionLine,
  noteAttribution,
  noteMarksForMonth,
} from "../../lib/varianceNoteAttribution.js";
import { T } from "../../lib/theme.js";
import {
  bandedRowStyle,
  statementHeaderCellStyle,
} from "../../lib/tableStyles.js";
import StatementStickyGrid from "../statements/StatementStickyGrid.jsx";
import StatementBandLabel, {
  StatementStickyDrawer,
} from "../../lib/statementBandLabel.jsx";
import {
  statementRowPresentation,
  formatStatementMoney,
} from "../../lib/statementPresentation.js";

const PARTIAL_PRINCIPAL_TEXT =
  "loan principal is available on one side only, so the other reads an em-dash and no variance is struck";

const EMPTY_ASSUMPTION = Object.freeze({
  rowKey: null,
  groupKey: null,
  mode: ANALYSIS_MODE_BUDGET,
  varianceFigures: null,
  accountNumber: null,
  accountLabel: "",
  fiscalYear: null,
  budgetDisplay: "",
  focusMonth: null,
  yearMonths: [],
  analysisLoading: false,
  recordLoading: false,
  analysis: null,
  analysisInputs: null,
  analysisModel: null,
  analysisGeneratedAt: null,
  analysisStored: false,
  analysisError: null,
  analysisRetrying: false,
  analysisRetryable: false,
  record: null,
  recordScope: null,
  recordError: null,
});

const EMPTY_VARIANCE_CELL = Object.freeze({
  rowKey: null,
  month: null,
  monthEnd: null,
});

const EMPTY_GL_ACTIVITY = Object.freeze({
  target: null,
  entry: null,
  cursor: null,
  cursorStack: [],
  rowKey: null,
  contextEntry: null,
  contextCursor: null,
  contextCursorStack: [],
});

const UW_BASELINE_VALUE = "__underwriting__";

export function buildHeadlineCaption({
  pairing,
  showBalanceSheet,
  headlineCards,
  principal,
  compareSideLong,
  baselineSideLong,
}) {
  return `Each headline card names the statement row beneath it and reads it verbatim from the table below, except Other expenses, which is that row less the mortgage and other interest accounts, so interest is not counted twice once debt service has its own card. Every other account below NOI — including the reserve and servicing lines — stays inside Other expenses. ${
    involvesLiveActuals(pairing)
      ? "Debt service is principal plus those same interest accounts, following the debt-service definition: loan draws are a financing inflow and are excluded, as is member-loan interest. Cash flow is Net Income plus principal — only principal, because Net Income already carries the interest half. Live GL principal is classified from journal-entry detail on the loan accounts, never from their netted monthly movement, which cannot tell a repayment from a draw."
      : "Plan-to-plan comparisons include the statement rows only; debt-service and cash-flow overlays are live-GL-specific and are omitted."
  } ${
    showBalanceSheet
      ? "Off-statement and balance-sheet accounts are shown in their own section below and excluded."
      : 'Off-statement accounts are shown in their own section below and excluded; balance-sheet accounts are not shown until "Show balance-sheet accounts" is ticked and are excluded from the headline.'
  }${
    headlineCards.some(({ row }) => !row)
      ? " One or more of those rows is not present for this property, so its card reads em-dashes rather than zero."
      : ""
  }${
    headlineCards.some(
      ({ row }) => row && (row.budget === null || row.actual === null),
    )
      ? " Where loan principal exists on only one side, that side is shown and the other reads an em-dash: no variance is struck against a figure the data does not carry."
      : ""
  }${
    principal
      ? ` Principal is classified on ${principal.actualMonths} month${principal.actualMonths === 1 ? "" : "s"} of this window${principal.mixedDirectionMonths > 0 ? `, ${principal.mixedDirectionMonths} of which carried both a draw and a repayment` : ""}; a month with no ingested journal detail contributes nothing rather than a zero.`
      : ""
  } Every variance on these cards is ${compareSideLong} minus ${baselineSideLong}.`;
}

const TOP_CHART_MARGIN = { left: 16, right: 28, top: 4, bottom: 4 };
const TOP_CHART_BAR_RADIUS = [0, 3, 3, 0];
const ROW_HEIGHT = 24;
const ACCOUNT_COL_MIN_WIDTH = 340;
const formatChartCurrency = (v) => formatCurrencyFull(v);

export const TopVarianceChart = React.memo(function TopVarianceChart({
  bars,
  sub,
  subtle,
  onDrill,
}) {
  const cursor = useMemo(() => ({ fill: subtle }), [subtle]);
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, bars.length * 30)}>
      <BarChart data={bars} layout="vertical" margin={TOP_CHART_MARGIN}>
        <XAxis
          type="number"
          tickFormatter={formatChartCurrency}
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
        <Tooltip formatter={formatChartCurrency} cursor={cursor} />
        <Bar dataKey="variance" radius={TOP_CHART_BAR_RADIUS}>
          {bars.map((a, i) => (
            <Cell
              key={i}
              fill={a.fill}
              cursor={a.drillable ? "pointer" : "default"}
              onClick={a.drillable ? () => onDrill(a) : undefined}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

export default function BudgetVariancePage({ C = {}, propertyCode } = {}) {
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
  const amber = C.amber || C.warning || T.warningText;
  const redChipBg = C.dangerBg || T.dangerBg;
  const greenChipBg = C.successBg || T.successBg;
  const leadingBg = C.infoBg || T.infoBg;
  const leadingFg = C.infoText || T.infoText;

  const [coa, setCoa] = useState([]);
  const [noi, setNoi] = useState([]);
  const [noiTemplate, setNoiTemplate] = useState(null);
  const [noiTemplateError, setNoiTemplateError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [baselines, setBaselines] = useState([]);
  const [baselinesLoading, setBaselinesLoading] = useState(false);
  const [baselinesError, setBaselinesError] = useState(null);
  const [baselineSelection, setBaselineSelection] = useState(null);
  const [uwBaselineSelected, setUwBaselineSelected] = useState(false);
  const [uwReconciliation, setUwReconciliation] = useState([]);
  const [uwRows, setUwRows] = useState([]);
  const [compareSelection, setCompareSelection] = useState(null);

  const activeBaseline = useMemo(
    () => resolveSelectedBaseline(baselines, baselineSelection),
    [baselines, baselineSelection],
  );
  const baselineSide = useMemo(
    () =>
      uwBaselineSelected ? UNDERWRITING_SIDE : sealedBudgetSide(activeBaseline),
    [uwBaselineSelected, activeBaseline],
  );
  const budgetSideOptions = useMemo(
    () =>
      baselines
        .map((row) => ({ row, side: sealedBudgetSide(row) }))
        .filter(({ side }) => side),
    [baselines],
  );
  const compareSide = useMemo(() => {
    if (!compareSelection) return ACTUALS_SIDE;
    const selected = budgetSideOptions.find(
      ({ side }) => baselineKey(side) === baselineKey(compareSelection),
    );
    return selected?.side || null;
  }, [budgetSideOptions, compareSelection]);
  const missingCompareSideLabel = compareSelection
    ? `Sealed budget type ${compareSelection.budgetStatusTypeId} FY${compareSelection.fiscalYear}`
    : "the selected comparison side";
  useEffect(() => {
    if (
      compareSelection &&
      !budgetSideOptions.some(
        ({ side }) => baselineKey(side) === baselineKey(compareSelection),
      )
    ) {
      setCompareSelection(null);
    }
  }, [budgetSideOptions, compareSelection]);
  const pairing = useMemo(
    () => pairingKind(baselineSide, compareSide),
    [baselineSide, compareSide],
  );
  const uwPairing = involvesUnderwriting(pairing);
  const uwOtherSide = useMemo(
    () => uwPairingOtherSide(baselineSide, compareSide),
    [baselineSide, compareSide],
  );
  const uwAvailable = uwReconciliation.length > 0;

  const [varianceCell, setVarianceCell] = useState(EMPTY_VARIANCE_CELL);
  const [glActivity, setGlActivity] = useState(EMPTY_GL_ACTIVITY);
  const glActivityPanelRef = useRef(null);
  const glActivityTriggerRef = useRef(null);
  const glActivityRequestRef = useRef(0);
  const glActivityScrollRef = useRef(false);

  const [assumption, setAssumption] = useState(EMPTY_ASSUMPTION);
  const [assumptionPermitted, setAssumptionPermitted] = useState(null);
  const assumptionPanelRef = useRef(null);
  const assumptionTriggerRef = useRef(null);
  const noteDraftDirtyRef = useRef(false);
  const onNoteDraftDirtyChange = useCallback((dirty) => {
    noteDraftDirtyRef.current = dirty;
  }, []);
  const assumptionRequestRef = useRef(0);
  const assumptionRetryRef = useRef(null);
  const assumptionRefreshRef = useRef(null);

  useEffect(() => {
    if (!propertyCode) return;
    warmBudgetAssumptionAnalysis();
  }, [propertyCode]);

  const [notePermitted, setNotePermitted] = useState(null);
  const [notes, setNotes] = useState({
    rows: [],
    authors: {},
    loading: false,
    error: null,
    truncated: false,
  });
  const [openNoteAccount, setOpenNoteAccount] = useState(null);
  const [leadingMonthEnd, setLeadingMonthEnd] = useState(null);

  const [openNoiLine, setOpenNoiLine] = useState(null);
  const [noiCalcCache, setNoiCalcCache] = useState({});
  const [debtOverlay, setDebtOverlay] = useState([]);
  const [actualPrincipal, setActualPrincipal] = useState([]);

  const [showBalanceSheet, setShowBalanceSheet] = useState(false);

  const [actualsThrough, setActualsThrough] = useState(null);
  const [actualsThroughKnown, setActualsThroughKnown] = useState(false);
  const [customPeriod, setCustomPeriod] = useState(null);
  const [comparePeriod, setComparePeriod] = useState(null);

  const [alertConfig, setAlertConfig] = useState(() =>
    resolveVarianceAlertConfig(null),
  );
  const [alertProvenance, setAlertProvenance] = useState(() =>
    resolveVarianceAlertProvenance(null),
  );

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
    let alive = true;
    fetchPlatformSettings().then((r) => {
      if (alive) {
        setAlertConfig(resolveVarianceAlertConfig(r?.settings));
        setAlertProvenance(resolveVarianceAlertProvenance(r));
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!propertyCode) {
      setBaselines([]);
      setBaselineSelection(null);
      return;
    }
    let alive = true;
    setBaselinesLoading(true);
    setBaselinesError(null);
    setBaselines([]);
    setBaselineSelection(null);
    setCompareSelection(null);
    setUwBaselineSelected(false);
    setUwRows([]);
    fetchBudgetBaselines(propertyCode)
      .then(({ data, error: blErr }) => {
        if (!alive) return;
        setBaselines(normalizeBaselines(data));
        setBaselinesError(blErr || null);
        setBaselinesLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setBaselines([]);
        setBaselinesError(err);
        setBaselinesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [propertyCode]);

  const selectionKey = `${uwBaselineSelected ? "underwriting" : baselineKey(baselineSelection)}::${baselineKey(compareSelection) || "actuals"}`;
  useEffect(() => {
    if (!propertyCode) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setVarianceCell(EMPTY_VARIANCE_CELL);
    setOpenNoteAccount(null);
    glActivityRequestRef.current += 1;
    setGlActivity({ target: null, entry: null, cursor: null, cursorStack: [] });
    assumptionRequestRef.current += 1;
    setAssumption(EMPTY_ASSUMPTION);
    setOpenNoiLine(null);
    setNoiCalcCache({});
    if (uwPairing) {
      setCoa([]);
      setNoi([]);
      fetchUwLineVariance(propertyCode, uwOtherSide)
        .then(({ data, error: uwErr }) => {
          if (!alive) return;
          setUwRows(data || []);
          setError(uwErr || null);
          setLoading(false);
        })
        .catch((err) => {
          if (!alive) return;
          setUwRows([]);
          setError(err);
          setLoading(false);
        });
      return () => {
        alive = false;
      };
    }
    setUwRows([]);
    const reads =
      pairing === "budget_vs_budget"
        ? [
            fetchBudgetVariancePairing(propertyCode, baselineSide, compareSide),
            Promise.resolve({ data: [], error: null }),
          ]
        : [
            fetchBudgetVariance(propertyCode, baselineSelection),
            fetchBudgetNoiVariance(propertyCode, baselineSelection),
          ];
    Promise.all(reads)
      .then(([cv, nv]) => {
        if (!alive) return;
        if (cv.error || nv.error) setError(cv.error || nv.error);
        setCoa(
          pairing === "budget_vs_budget"
            ? adaptPairingRows(cv.data || [])
            : cv.data || [],
        );
        setNoi(nv.data || []);
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
  }, [
    propertyCode,
    selectionKey,
    pairing,
    baselineSide,
    compareSide,
    uwPairing,
    uwOtherSide,
  ]);

  useEffect(() => {
    if (!propertyCode) {
      setUwReconciliation([]);
      return undefined;
    }
    let alive = true;
    setUwReconciliation([]);
    fetchUwLineReconciliation(propertyCode)
      .then(({ data }) => {
        if (alive) setUwReconciliation(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (alive) setUwReconciliation([]);
      });
    return () => {
      alive = false;
    };
  }, [propertyCode]);

  useEffect(() => {
    if (!propertyCode) return;
    let alive = true;
    setDebtOverlay([]);
    setActualPrincipal([]);
    setCustomPeriod(null);
    setComparePeriod(null);
    setActualsThrough(null);
    setActualsThroughKnown(false);
    Promise.all([
      fetchBudgetProformaDebtService(propertyCode).catch(() => ({
        data: [],
        error: null,
      })),
      fetchActualLoanPrincipalActivity(propertyCode).catch(() => ({
        data: [],
        error: null,
      })),
      fetchBudgetActualsThrough(propertyCode).catch((err) => ({
        data: null,
        error: err || new Error("actuals-through lookup failed"),
      })),
    ])
      .then(([ds, ap, at]) => {
        if (!alive) return;
        setDebtOverlay(Array.isArray(ds?.data) ? ds.data : []);
        setActualPrincipal(Array.isArray(ap?.data) ? ap.data : []);
        setActualsThrough(at?.data || null);
        setActualsThroughKnown(!at?.error);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [propertyCode]);

  useEffect(() => {
    let alive = true;
    fetchNoiBuildTemplate()
      .then(({ data, error: tplErr }) => {
        if (!alive) return;
        setNoiTemplate(data || null);
        setNoiTemplateError(tplErr || null);
      })
      .catch((err) => {
        if (!alive) return;
        setNoiTemplate(null);
        setNoiTemplateError(err);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchVarianceNoteAccess()
      .then(({ permitted, role, isAdmin }) => {
        if (!alive) return;
        setNotePermitted(permitted === true);
        setAssumptionPermitted(canReadBudgetAssumptions({ role, isAdmin }));
      })
      .catch(() => {
        if (!alive) return;
        setNotePermitted(false);
        setAssumptionPermitted(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const fyDefault = useMemo(() => fiscalYearDefaultPeriod(coa), [coa]);
  const defaultPeriod = fyDefault.period;
  const period = customPeriod || defaultPeriod;
  const futurePeriod = useMemo(() => firstFutureFiscalYearPeriod(coa), [coa]);
  const controlPeriod = period || futurePeriod;
  const periodPair = useMemo(
    () => makePeriodPair(period, comparePeriod),
    [period, comparePeriod],
  );
  const coaByPeriod = useMemo(
    () => partitionRowsToPeriods(coa, periodPair),
    [coa, periodPair],
  );
  const noiByPeriod = useMemo(
    () => partitionRowsToPeriods(noi, periodPair),
    [noi, periodPair],
  );
  const pairColumns = useMemo(
    () => buildPeriodPairColumns(periodPair),
    [periodPair],
  );
  const pairColumnsByMonth = useMemo(
    () =>
      new Map(
        pairColumns.map((c) => [String(c.month_end || "").slice(0, 7), c]),
      ),
    [pairColumns],
  );
  const periodCoa = useMemo(
    () => pairRowsToColumns(coaByPeriod, pairColumns),
    [coaByPeriod, pairColumns],
  );
  const periodNoi = useMemo(
    () => pairRowsToColumns(noiByPeriod, pairColumns),
    [noiByPeriod, pairColumns],
  );
  const coverageSentence = useMemo(
    () => pairCoverageSentence(periodPair, pairColumns),
    [periodPair, pairColumns],
  );

  useEffect(() => {
    glActivityRequestRef.current += 1;
    setGlActivity(EMPTY_GL_ACTIVITY);
    assumptionRequestRef.current += 1;
    setAssumption(EMPTY_ASSUMPTION);
  }, [
    propertyCode,
    selectionKey,
    period?.start,
    period?.end,
    comparePeriod?.start,
    comparePeriod?.end,
  ]);

  const noteWindowKey = period ? `${period.start}..${period.end}` : "";
  useEffect(() => {
    if (notePermitted !== true || !propertyCode) return undefined;
    let alive = true;
    setNotes((n) => ({ ...n, loading: true, error: null, truncated: false }));
    fetchVarianceNotes(propertyCode, period)
      .then(async ({ data, truncated, error: noteErr }) => {
        if (!alive) return;
        if (noteErr) {
          setNotes({
            rows: [],
            authors: {},
            loading: false,
            error: noteErr,
            truncated: false,
          });
          return;
        }
        const ids = data
          .flatMap((r) => [r.created_by, r.updated_by])
          .filter(Boolean);
        const { data: authors } = await fetchNoteAuthorNames(ids).catch(() => ({
          data: {},
        }));
        if (!alive) return;
        setNotes({
          rows: data,
          authors: authors || {},
          loading: false,
          error: null,
          truncated,
        });
      })
      .catch((err) => {
        if (alive)
          setNotes({
            rows: [],
            authors: {},
            loading: false,
            error: err,
            truncated: false,
          });
      });
    return () => {
      alive = false;
    };
  }, [propertyCode, noteWindowKey, notePermitted]);

  const noteIndex = useMemo(() => indexVarianceNotes(notes.rows), [notes.rows]);

  const saveNote = async (accountNumber, accountName, range, noteText) => {
    const monthStart = range?.monthStart ?? null;
    const monthEnd = range?.monthEnd ?? range;
    const {
      data,
      error: writeErr,
      reason,
    } = await createVarianceNote({
      propertyCode,
      monthStart,
      monthEnd,
      accountNumber,
      accountName,
      noteText,
    });
    if (writeErr || !data) return { ok: false, reason: reason || "failed" };
    const { data: authors } = await fetchNoteAuthorNames(
      [data.created_by, data.updated_by].filter(Boolean),
    ).catch(() => ({ data: {} }));
    const overlaps = (r) =>
      String(r.account_number ?? "") === String(data.account_number ?? "") &&
      String(r.group_key ?? "") === String(data.group_key ?? "") &&
      !r.superseded_at &&
      String(r.month_start || r.month_end) <= String(data.month_end) &&
      String(r.month_end) >= String(data.month_start || data.month_end);
    setNotes((n) => ({
      ...n,
      rows: [
        ...n.rows
          .filter((r) => r.id !== data.id)
          .map((r) =>
            overlaps(r)
              ? { ...r, superseded_at: data.created_at, superseded_by: data.id }
              : r,
          ),
        data,
      ],
      authors: { ...n.authors, ...(authors || {}) },
    }));
    return { ok: true, reason: null };
  };

  const editNote = async (id, noteText) => {
    const {
      data,
      error: writeErr,
      reason,
    } = await updateVarianceNote({ id, noteText });
    if (writeErr || !data) return { ok: false, reason: reason || "failed" };
    const { data: authors } = await fetchNoteAuthorNames(
      [data.created_by, data.updated_by].filter(Boolean),
    ).catch(() => ({ data: {} }));
    setNotes((n) => ({
      ...n,
      rows: n.rows.map((r) => (r.id === data.id ? data : r)),
      authors: { ...n.authors, ...(authors || {}) },
    }));
    return { ok: true, reason: null };
  };

  const removeNote = async (id) => {
    const { data, error: writeErr, reason } = await deleteVarianceNote(id);
    if (writeErr || !data) return { ok: false, reason: reason || "failed" };
    setNotes((n) => ({ ...n, rows: n.rows.filter((r) => r.id !== id) }));
    return { ok: true, reason: null };
  };

  const loadNoteHistory = async (id) => {
    const { data, error: histErr } = await fetchNoteHistory(id);
    if (histErr) return { data: [], error: histErr };
    const ids = data.map((v) => v.changed_by).filter(Boolean);
    const { data: authors } = await fetchNoteAuthorNames(ids).catch(() => ({
      data: {},
    }));
    if (authors && Object.keys(authors).length) {
      setNotes((n) => ({ ...n, authors: { ...n.authors, ...authors } }));
    }
    return { data, error: null };
  };

  const noteWindowLabel = period
    ? `${formatMonthLabel(period.start)} – ${formatMonthLabel(period.end)}`
    : "";
  const coverage = useMemo(
    () => periodCoverage(coa, period, { actualsThrough, actualsThroughKnown }),
    [coa, period, actualsThrough, actualsThroughKnown],
  );
  const planCoverage = useMemo(() => {
    const byMonth = new Map();
    for (const row of periodCoa) {
      const month = row?.month_end;
      if (!month || byMonth.has(month)) continue;
      byMonth.set(month, {
        baseline: row.baseline_covers_month === true,
        compare: row.compare_covers_month === true,
      });
    }
    const baselineOnly = [...byMonth.values()].filter(
      ({ baseline, compare }) => baseline && !compare,
    ).length;
    const compareOnly = [...byMonth.values()].filter(
      ({ baseline, compare }) => compare && !baseline,
    ).length;
    return { months: byMonth.size, baselineOnly, compareOnly };
  }, [periodCoa]);
  const snapshotMonths = useMemo(() => monthsInRows(coa), [coa]);
  const noComparablePeriod = !loading && coa.length > 0 && !period;

  const futureWindowDefaultedRef = useRef(null);
  const autoCompareKeyRef = useRef(null);
  useEffect(() => {
    if (!customPeriod || futureWindowDefaultedRef.current === customPeriod)
      return;
    if (
      compareSelection ||
      uwBaselineSelected ||
      pairing !== "actuals_vs_budget"
    )
      return;
    if (!coverage.months || coverage.beyondActuals !== coverage.months) return;
    futureWindowDefaultedRef.current = customPeriod;
    const counterpart = currentFiscalYearOperatingBaseline(baselines, {
      currentWindow: fyDefault.wanted,
      targetWindow: customPeriod,
      exclude: baselineSide,
    });
    if (counterpart) {
      const picked = {
        budgetStatusTypeId: counterpart.budgetStatusTypeId,
        fiscalYear: counterpart.fiscalYear,
      };
      autoCompareKeyRef.current = baselineKey(picked);
      setCompareSelection(picked);
    }
  }, [
    customPeriod,
    compareSelection,
    uwBaselineSelected,
    pairing,
    coverage,
    baselines,
    fyDefault,
    baselineSide,
  ]);

  const staleSelection = isSelectionStale(baselines, baselineSelection);
  const baselineName = activeBaseline
    ? baselineShortLabel(activeBaseline)
    : "the sealed budget snapshot";
  const baselineSealedOn = (() => {
    if (!activeBaseline?.sealedAt) return null;
    const d = new Date(activeBaseline.sealedAt);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
  })();
  const baselineSideLong = baselineSide
    ? `${baselineSide.label}, sealed${baselineSealedOn ? ` ${baselineSealedOn}` : ""}`
    : "the selected sealed budget";
  const compareSideLong =
    compareSide?.kind === LIVE_ACTUALS
      ? period
        ? `${compareSide.shortLabel}s through ${formatMonthLabel(period.end)}`
        : `${compareSide.shortLabel}s`
      : compareSide?.label || "the selected sealed budget";
  const sideFormula = `Variance = ${compareSide?.shortLabel || (compareSelection ? missingCompareSideLabel : "Live GL actual")} − ${baselineSide?.shortLabel || "selected side"}`;
  const compareName = compareSide?.label || missingCompareSideLabel;
  const baselineAmountLabel = baselineSide?.shortLabel || "budget";
  const compareAmountLabel = compareSide?.shortLabel || "actual";

  useEffect(() => {
    if (!glActivity.target) return;
    const panel = glActivityPanelRef.current;
    if (!panel) return;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView?.({
      block: glActivityScrollRef.current ? "center" : "nearest",
      inline: "nearest",
    });
    glActivityScrollRef.current = false;
  }, [glActivity.target, glActivity.rowKey]);

  const closeGlActivity = ({ refocus = true } = {}) => {
    glActivityRequestRef.current += 1;
    const trigger = glActivityTriggerRef.current;
    setGlActivity(EMPTY_GL_ACTIVITY);
    if (refocus) trigger?.focus();
  };

  const assumptionFiscalYear = useMemo(
    () => assumptionFiscalYearLabel(baselineSide),
    [baselineSide],
  );
  const assumptionDrillable =
    assumptionPermitted === true && assumptionFiscalYear !== null;
  const varianceExplainable =
    assumptionDrillable &&
    involvesLiveActuals(pairing) &&
    comparePeriod === null;
  const groupSummarizable = varianceExplainable;

  useEffect(() => {
    if (!assumption.rowKey) return;
    const panel = assumptionPanelRef.current;
    if (!panel) return;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [assumption.rowKey]);

  const closeAssumption = ({ refocus = true } = {}) => {
    assumptionRequestRef.current += 1;
    const trigger = assumptionTriggerRef.current;
    setAssumption(EMPTY_ASSUMPTION);
    if (refocus) trigger?.focus();
  };

  const closeVarianceDrawer = ({ refocus = true } = {}) => {
    if (
      noteDraftDirtyRef.current &&
      typeof window !== "undefined" &&
      !window.confirm(
        "Discard unsaved commentary? The text you typed has not been saved.",
      )
    ) {
      return false;
    }
    noteDraftDirtyRef.current = false;
    setVarianceCell(EMPTY_VARIANCE_CELL);
    if (assumption.mode === ANALYSIS_MODE_VARIANCE)
      closeAssumption({ refocus });
    return true;
  };

  const collapseOtherRows = (rowKey) => {
    if (
      varianceCell.rowKey &&
      varianceCell.rowKey !== rowKey &&
      !closeVarianceDrawer({ refocus: false })
    )
      return false;
    if (glActivity.target && glActivity.rowKey !== rowKey)
      closeGlActivity({ refocus: false });
    if (assumption.rowKey && assumption.rowKey !== rowKey)
      closeAssumption({ refocus: false });
    setOpenNoteAccount(null);
    return true;
  };

  const openAssumption = (
    row,
    trigger,
    rowKey,
    {
      month = null,
      mode = ANALYSIS_MODE_BUDGET,
      figures = null,
      collapse = true,
    } = {},
  ) => {
    if (!row || !rowKey || !assumptionDrillable) return;
    if (assumption.rowKey === rowKey && assumption.mode === mode) {
      assumptionTriggerRef.current = trigger || assumptionTriggerRef.current;
      if ((assumption.focusMonth ?? null) === month) {
        closeAssumption();
        return;
      }
      if (mode === ANALYSIS_MODE_BUDGET) {
        setAssumption((prev) =>
          prev.rowKey === rowKey ? { ...prev, focusMonth: month } : prev,
        );
        return;
      }
    }
    if (collapse && !collapseOtherRows(rowKey)) return;
    assumptionTriggerRef.current = trigger;
    const ticket = ++assumptionRequestRef.current;
    const accountNumber = String(row.account_number);
    const accountLabel = `${row.account_number}${row.account_name ? ` · ${row.account_name}` : ""}`;
    const isVariance = mode === ANALYSIS_MODE_VARIANCE;
    setAssumption({
      ...EMPTY_ASSUMPTION,
      rowKey,
      mode,
      varianceFigures: isVariance
        ? figures || {
            budget: row.budget,
            actual: row.actual,
            variance: row.variance,
          }
        : null,
      accountNumber,
      accountLabel,
      fiscalYear: assumptionFiscalYear,
      budgetDisplay: formatStatementMoney(row.budget),
      focusMonth: month,
      yearMonths: fiscalYearBudgetMonths(
        coa,
        accountNumber,
        assumptionFiscalYear,
      ),
      analysisLoading: true,
      recordLoading: true,
    });
    const patch = (fields) => {
      if (assumptionRequestRef.current !== ticket) return;
      setAssumption((prev) =>
        prev.rowKey === rowKey ? { ...prev, ...fields } : prev,
      );
    };
    const budgetStatusTypeId = baselineSide?.budgetStatusTypeId ?? null;
    loadStoredAssumption({
      propertyCode,
      accountNumber,
      fiscalYear: assumptionFiscalYear,
      budgetStatusTypeId,
    })
      .then(({ record, scope, error }) =>
        patch({
          recordLoading: false,
          record,
          recordScope: scope,
          recordError: error,
        }),
      )
      .catch((e) =>
        patch({
          recordLoading: false,
          record: null,
          recordScope: null,
          recordError: e?.message || String(e),
        }),
      );
    const packet = {
      propertyCode,
      accountNumber,
      accountName: row.account_name || "",
      fiscalYear: assumptionFiscalYear,
      budgetStatusTypeId,
      periodLabel: noteWindowLabel,
      budgetTotal: row.budget,
      budgetMonths: budgetMonthsForAccount(periodCoa, accountNumber),
      ...(isVariance
        ? {
            mode: ANALYSIS_MODE_VARIANCE,
            focusMonth: month,
            actualTotal: row.actual,
            varianceTotal: row.variance,
            actualMonths: actualMonthsForAccount(periodCoa, accountNumber),
          }
        : {}),
    };
    assumptionRetryRef.current = () => runAssumptionAnalysis(packet, patch);
    assumptionRefreshRef.current = () =>
      runAssumptionAnalysis({ ...packet, refresh: true }, patch);
    runAssumptionAnalysis(packet, patch);
  };

  const openGroupAssumption = (row, trigger, rowKey) => {
    if (!groupSummarizable || !row?.key || !rowKey) return;
    if (
      assumption.rowKey === rowKey &&
      assumption.mode === ANALYSIS_MODE_GROUP
    ) {
      closeAssumption();
      return;
    }
    if (!collapseOtherRows(rowKey)) return;
    assumptionTriggerRef.current = trigger;
    const ticket = ++assumptionRequestRef.current;
    const memberSet = new Set((row.member_account_numbers || []).map(String));
    const members = displayIsRows
      .filter(
        (r) =>
          r.account_number != null && memberSet.has(String(r.account_number)),
      )
      .map((r) => ({
        account_number: String(r.account_number),
        account_name: r.account_name || "",
        budget: r.budget,
        actual: r.actual,
        variance: r.variance,
      }))
      .sort(
        (a, b) =>
          Math.abs(Number(b.variance) || 0) - Math.abs(Number(a.variance) || 0),
      )
      .slice(0, 80);
    const memberAccountNumbers = (row.member_account_numbers || []).slice(
      0,
      300,
    );
    setAssumption({
      ...EMPTY_ASSUMPTION,
      rowKey,
      mode: ANALYSIS_MODE_GROUP,
      groupKey: row.key,
      accountNumber: null,
      accountLabel: row.line_label,
      fiscalYear: assumptionFiscalYear,
      budgetDisplay: formatStatementMoney(row.budget),
      varianceFigures: {
        budget: row.budget,
        actual: row.actual,
        variance: row.variance,
      },
      analysisLoading: true,
      recordLoading: false,
    });
    const patch = (fields) => {
      if (assumptionRequestRef.current !== ticket) return;
      setAssumption((prev) =>
        prev.rowKey === rowKey ? { ...prev, ...fields } : prev,
      );
    };
    const budgetStatusTypeId = baselineSide?.budgetStatusTypeId ?? null;
    const packet = {
      mode: ANALYSIS_MODE_GROUP,
      propertyCode,
      groupKey: row.key,
      groupLabel: row.line_label,
      memberAccountNumbers,
      members,
      fiscalYear: assumptionFiscalYear,
      budgetStatusTypeId,
      periodLabel: noteWindowLabel,
      budgetTotal: row.budget,
      actualTotal: row.actual,
      varianceTotal: row.variance,
      budgetMonths: budgetMonthsForAccounts(
        periodCoa,
        members.map((member) => member.account_number),
      ),
      actualMonths: actualMonthsForAccounts(
        periodCoa,
        members.map((member) => member.account_number),
      ),
    };
    assumptionRetryRef.current = () => runAssumptionAnalysis(packet, patch);
    assumptionRefreshRef.current = () =>
      runAssumptionAnalysis({ ...packet, refresh: true }, patch);
    runAssumptionAnalysis(packet, patch);
  };

  const runAssumptionAnalysis = (packet, patch) => {
    patch({
      analysisLoading: true,
      analysisError: null,
      analysisRetrying: false,
      analysisRetryable: false,
    });
    requestBudgetAssumptionAnalysisWithRetry(packet, {
      onRetry: () => patch({ analysisRetrying: true }),
    })
      .then(({ data, error, retryable }) =>
        patch({
          analysisLoading: false,
          analysisRetrying: false,
          analysis: data?.analysis || null,
          analysisInputs: data?.inputs || null,
          analysisModel: data?.model || null,
          analysisGeneratedAt: data?.generated_at || null,
          analysisStored: data?.stored === true,
          analysisError: error,
          analysisRetryable: Boolean(error && retryable),
        }),
      )
      .catch((e) =>
        patch({
          analysisLoading: false,
          analysisRetrying: false,
          analysis: null,
          analysisError: e?.message || String(e),
          analysisRetryable: true,
        }),
      );
  };

  const retryAssumptionAnalysis = () => {
    assumptionRetryRef.current?.();
  };

  const refreshAssumptionAnalysis = () => {
    assumptionRefreshRef.current?.();
  };

  const loadGlActivity = async (
    target,
    cursor = null,
    cursorStack = [],
    rowKey = null,
    {
      contextCursor = null,
      contextCursorStack = [],
      only = null,
      keep = {},
    } = {},
  ) => {
    const contextTarget = target?.contextTarget ?? null;
    const requestId = glActivityRequestRef.current + 1;
    glActivityRequestRef.current = requestId;
    const held = {
      target,
      cursor,
      cursorStack,
      rowKey,
      contextCursor,
      contextCursorStack,
    };
    const readActual = only !== "context" || Boolean(keep.entry?.loading);
    const readContext =
      Boolean(contextTarget) &&
      (only !== "actual" || Boolean(keep.contextEntry?.loading));
    const heldEntry = keep.entry ?? null;
    const heldContextEntry = contextTarget ? (keep.contextEntry ?? null) : null;
    setGlActivity({
      ...held,
      entry: readActual
        ? buildGlActivityEntry({ target, loading: true })
        : heldEntry,
      contextEntry: readContext
        ? buildGlActivityEntry({ target: contextTarget, loading: true })
        : heldContextEntry,
    });
    const read = async (which, atCursor) => {
      try {
        const { data, error: activityError } = await fetchVarianceGlActivity(
          which,
          {
            cursor: atCursor,
          },
        );
        return buildGlActivityEntry({
          target: which,
          error: activityError || null,
          response: data,
        });
      } catch (activityError) {
        return buildGlActivityEntry({ target: which, error: activityError });
      }
    };
    const [entry, contextEntry] = await Promise.all([
      readActual ? read(target, cursor) : Promise.resolve(heldEntry),
      readContext
        ? read(contextTarget, contextCursor)
        : Promise.resolve(heldContextEntry),
    ]);
    if (glActivityRequestRef.current !== requestId) return;
    setGlActivity({ ...held, entry, contextEntry });
  };

  const openGlActivity = (
    target,
    trigger,
    rowKey = null,
    { scrollTo = false } = {},
  ) => {
    if (!target) return;
    if (glActivity.target?.id === target.id && glActivity.rowKey === rowKey) {
      if (!trigger || trigger === glActivityTriggerRef.current) {
        glActivityTriggerRef.current = trigger || glActivityTriggerRef.current;
        closeGlActivity();
        return;
      }
      glActivityTriggerRef.current = trigger;
      return;
    }
    glActivityTriggerRef.current = trigger;
    glActivityScrollRef.current = scrollTo;
    if (!collapseOtherRows(rowKey)) return;
    loadGlActivity(target, null, [], rowKey);
  };

  const makeGlActivityTarget = ({
    kind,
    label,
    accountNumbers,
    cell = null,
    selectedAmount,
    reconcileAmount = undefined,
    resolution = GL_ACTIVITY_RESOLUTION.EXACT,
    unresolvedComponents = [],
  }) => {
    const accounts = (accountNumbers || []).map(String).filter(Boolean);
    const windows = glActivityDrillWindows(periodPair, cell);
    const drillable = Boolean(
      propertyCode &&
      involvesLiveActuals(pairing) &&
      selectedAmount != null &&
      accounts.length > 0,
    );
    if (!drillable) return null;
    const withinCoverage = (w) =>
      Boolean(w && coverage.through && w.to <= coverage.through);
    if (!withinCoverage(windows.actual)) return null;
    const comparable = accounts.every(
      (account) => !isBalanceClassAccount(account),
    );
    const common = {
      kind,
      propertyCode,
      accountNumbers: accounts,
      comparisonKey: pairing,
      baselineKey: selectionKey,
      resolution,
      unresolvedComponents,
      label,
      liveActuals: true,
    };
    const target = buildGlActivityTarget({
      ...common,
      monthFrom: windows.actual.from,
      monthTo: windows.actual.to,
      side: "actual",
      selectedAmount,
      reconcilesTo: comparable
        ? reconcileAmount === undefined
          ? selectedAmount
          : reconcileAmount
        : null,
    });
    if (!withinCoverage(windows.context)) return target;
    const contextTarget = buildGlActivityTarget({
      ...common,
      monthFrom: windows.context.from,
      monthTo: windows.context.to,
      side: "baseline",
      selectedAmount: null,
      reconcilesTo: null,
    });
    return { ...target, contextTarget, id: `${target.id}~${contextTarget.id}` };
  };

  const figureButton = (
    display,
    target,
    label,
    rowKey = null,
    { scrollTo = false } = {},
  ) => {
    if (!target || !rowKey) return display;
    return (
      <button
        type="button"
        aria-label={label}
        aria-controls="variance-gl-activity-panel"
        aria-expanded={
          glActivity.target?.id === target.id && glActivity.rowKey === rowKey
        }
        onClick={(event) =>
          openGlActivity(target, event.currentTarget, rowKey, { scrollTo })
        }
        style={{
          border: 0,
          borderBottom: "1px dotted currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          fontWeight: "inherit",
          fontVariantNumeric: "inherit",
          padding: 0,
        }}
      >
        {display}
      </button>
    );
  };

  const groupSummaryButton = (
    display,
    row,
    rowKey,
    label = `View group summary for ${row?.line_label}`,
  ) => {
    if (!groupSummarizable || !rowKey || !row?.key) return display;
    return (
      <button
        type="button"
        aria-label={label}
        aria-controls="variance-budget-assumption-panel"
        aria-expanded={
          assumption.rowKey === rowKey &&
          assumption.mode === ANALYSIS_MODE_GROUP
        }
        onClick={(event) =>
          openGroupAssumption(row, event.currentTarget, rowKey)
        }
        style={{
          border: 0,
          borderBottom: "1px dotted currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          fontWeight: "inherit",
          fontVariantNumeric: "inherit",
          padding: 0,
        }}
      >
        {display}
      </button>
    );
  };

  const budgetFigureButton = (row, rowKey) => {
    const display = formatStatementMoney(row.budget);
    if (
      !assumptionDrillable ||
      !rowKey ||
      row.budget === null ||
      row.budget === undefined
    )
      return display;
    return (
      <button
        type="button"
        aria-label={`View budget assumption for account ${row.account_number}`}
        aria-controls="variance-budget-assumption-panel"
        aria-expanded={assumption.rowKey === rowKey}
        onClick={(event) => openAssumption(row, event.currentTarget, rowKey)}
        style={{
          border: 0,
          borderBottom: "1px dotted currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          fontWeight: "inherit",
          fontVariantNumeric: "inherit",
          padding: 0,
        }}
      >
        {display}
      </button>
    );
  };

  const budgetMonthButton = (row, rowKey, month, amount) => {
    const display = formatStatementMoney(amount);
    if (!assumptionDrillable || !rowKey || !month || row.account_number == null)
      return display;
    const open =
      assumption.rowKey === rowKey && assumption.focusMonth === month;
    return (
      <button
        type="button"
        aria-label={`View budget assumption for account ${row.account_number} in ${month}`}
        aria-controls="variance-budget-assumption-panel"
        aria-expanded={open}
        onClick={(event) =>
          openAssumption(row, event.currentTarget, rowKey, { month })
        }
        style={{
          border: 0,
          borderBottom: "1px dotted currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          fontWeight: "inherit",
          fontVariantNumeric: "inherit",
          padding: 0,
        }}
      >
        {display}
      </button>
    );
  };

  const varianceCommentable = notePermitted === true;
  const varianceFigureButton = (
    row,
    rowKey,
    { month = null, monthEnd = null, figures = null, label } = {},
  ) => {
    const amount = figures ? figures.variance : row.variance;
    const display = formatStatementMoney(amount);
    if (
      (!varianceExplainable && !varianceCommentable) ||
      !rowKey ||
      amount === null ||
      amount === undefined
    ) {
      return display;
    }
    const open =
      varianceCell.rowKey === rowKey && (varianceCell.month ?? null) === month;
    return (
      <button
        type="button"
        aria-label={label}
        aria-controls="variance-cell-panel"
        aria-expanded={open}
        onClick={(event) => {
          if (open) {
            closeVarianceDrawer({ refocus: false });
            return;
          }
          if (
            varianceCell.rowKey === rowKey &&
            !closeVarianceDrawer({ refocus: false })
          )
            return;
          if (!collapseOtherRows(rowKey)) return;
          setVarianceCell({ rowKey, month, monthEnd });
          if (varianceExplainable) {
            openAssumption(row, event.currentTarget, rowKey, {
              month,
              mode: ANALYSIS_MODE_VARIANCE,
              figures,
              collapse: false,
            });
          }
        }}
        style={{
          border: 0,
          borderBottom: "1px dotted currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          fontWeight: "inherit",
          fontVariantNumeric: "inherit",
          padding: 0,
        }}
      >
        {display}
      </button>
    );
  };

  const assumptionDrawer = (rowKey) => {
    if (!assumption.rowKey || !rowKey || assumption.rowKey !== rowKey)
      return null;
    return (
      <div
        id="variance-budget-assumption-panel"
        ref={assumptionPanelRef}
        tabIndex={-1}
        style={{
          background: card,
          border: `2px solid ${border}`,
          borderRadius: 8,
          outline: "none",
          padding: 14,
        }}
      >
        <BudgetAssumptionPanel
          accountLabel={assumption.accountLabel}
          groupKey={assumption.groupKey}
          fiscalYear={assumption.fiscalYear}
          budgetDisplay={assumption.budgetDisplay}
          focusMonth={assumption.focusMonth}
          yearMonths={assumption.yearMonths}
          mode={assumption.mode}
          varianceFigures={assumption.varianceFigures}
          loading={assumption.analysisLoading || assumption.recordLoading}
          analysis={assumption.analysis}
          analysisInputs={assumption.analysisInputs}
          analysisModel={assumption.analysisModel}
          analysisGeneratedAt={assumption.analysisGeneratedAt}
          analysisStored={assumption.analysisStored}
          onRefreshAnalysis={refreshAssumptionAnalysis}
          analysisError={assumption.analysisError}
          analysisRetrying={assumption.analysisRetrying}
          onRetryAnalysis={
            assumption.analysisRetryable ? retryAssumptionAnalysis : null
          }
          record={assumption.record}
          recordScope={assumption.recordScope}
          recordError={assumption.recordError}
          onClose={
            assumption.mode === ANALYSIS_MODE_VARIANCE
              ? closeVarianceDrawer
              : closeAssumption
          }
          theme={{ sub, border, red }}
        />
      </div>
    );
  };

  const glRowKey = (row) => {
    if (!row) return null;
    if (row.kind === "subtotal" || row.kind === "total")
      return `line:${row.key}`;
    return row.account_number == null ? null : `account:${row.account_number}`;
  };

  const chartGlTarget = (account) =>
    makeGlActivityTarget({
      kind: "chart-account-period",
      label: account.label,
      accountNumbers: [account.account_number],
      selectedAmount: account.actual,
      reconcileAmount: account.period_total_actual_sum,
    });

  const thinBaseline = Boolean(
    activeBaseline &&
    activeBaseline.coaAccountCount > 0 &&
    activeBaseline.coaAccountCount <= 3,
  );

  const visibleCoa = useMemo(
    () =>
      showBalanceSheet
        ? periodCoa
        : periodCoa.filter((r) => !isBalanceClassAccount(r.account_number)),
    [periodCoa, showBalanceSheet],
  );
  const preserveNulls =
    pairing === "budget_vs_budget" || Boolean(comparePeriod);
  const coaRows = useMemo(
    () =>
      averagePeriodTotals(
        aggregateCoaByAccount(periodCoa, { preserveNulls }),
        periodPair,
      ),
    [periodCoa, preserveNulls, periodPair],
  );
  const visibleCoaRows = useMemo(
    () =>
      averagePeriodTotals(
        aggregateCoaByAccount(visibleCoa, { preserveNulls }),
        periodPair,
      ),
    [visibleCoa, preserveNulls, periodPair],
  );
  const statement = useMemo(
    () =>
      buildVarianceStatementRows({
        specRows: COA_STATEMENT_SPEC.incomeStatement,
        rows: periodCoa,
        balanceSheetAccounts: COA_STATEMENT_SPEC.balanceSheetAccounts,
        includeBalanceSheet: showBalanceSheet,
        preserveNulls,
      }),
    [periodCoa, showBalanceSheet, preserveNulls],
  );
  const statementRows = useMemo(
    () => averagePeriodTotals(statement.rows, periodPair),
    [statement.rows, periodPair],
  );
  const headlineCardDescriptors = useMemo(
    () => [
      { label: "Income", statementLabel: "Total Operating Income" },
      { label: "Expenses", statementLabel: "Total Operating Expenses" },
      { label: "NOI", statementLabel: "Net Operating Income" },
      {
        label: "Other expenses",
        statementLabel: `${OTHER_EXPENSES_TOTAL_LABEL} − interest`,
        missingLabel: OTHER_EXPENSES_TOTAL_LABEL,
        derive: otherExpensesResidualFromStatementRows,
      },
      { label: "Net Income", statementLabel: STATEMENT_HEADLINE_LABEL },
    ],
    [],
  );
  const principal = useMemo(() => {
    const raw = principalFromDebtSources(
      filterRowsToPeriod(debtOverlay, periodPair?.baseline || period),
      filterRowsToPeriod(actualPrincipal, periodPair?.compare || period),
    );
    const divisors = averageDivisors(periodPair);
    if (!raw || !divisors) return raw;
    const perMonth = (v, months) => (v === null ? null : v / months);
    return {
      ...raw,
      budget: perMonth(raw.budget, divisors.baseline),
      actual: perMonth(raw.actual, divisors.compare),
    };
  }, [debtOverlay, actualPrincipal, period, periodPair]);
  const debtCardDescriptors = useMemo(
    () => [
      {
        label: DEBT_SERVICE_LABEL,
        statementLabel:
          "Mortgage Interest + Other Interest & Financing + loan principal",
        missingLabel: true,
        unavailableText:
          "Loan principal is missing on both sides for this property, or it carries no interest rows at all, so this figure is unavailable rather than shown without its principal half.",
        unavailableFaceText:
          "No loan principal or interest data on either side",
        partialText: PARTIAL_PRINCIPAL_TEXT,
        derive: (rows) => debtServiceFromStatementRows(rows, principal),
      },
      {
        label: CASH_FLOW_LABEL,
        statementLabel: `${STATEMENT_HEADLINE_LABEL} + loan principal`,
        missingLabel: true,
        unavailableText:
          "Loan principal is not available for this property on either side, so this figure is unavailable rather than repeating Net Income.",
        unavailableFaceText: "No loan principal data on either side",
        partialText: PARTIAL_PRINCIPAL_TEXT,
        derive: (rows) => cashFlowFromStatementRows(rows, principal),
      },
    ],
    [principal],
  );
  const headlineCards = useMemo(
    () =>
      [
        ...headlineCardDescriptors.slice(0, 3),
        debtCardDescriptors[0],
        ...headlineCardDescriptors.slice(3),
        debtCardDescriptors[1],
      ].map((descriptor) => ({
        ...descriptor,
        row: descriptor.derive
          ? descriptor.derive(statementRows)
          : headlineFromStatementRows(statementRows, descriptor.statementLabel),
      })),
    [headlineCardDescriptors, debtCardDescriptors, statementRows],
  );
  const renderedHeadlineCards = involvesLiveActuals(pairing)
    ? headlineCards
    : headlineCards.filter(
        ({ label }) =>
          label !== DEBT_SERVICE_LABEL && label !== CASH_FLOW_LABEL,
      );
  const isRows = statementRows;
  const monthCols = useMemo(() => {
    const axis = statement.axis || [];
    if (!pairColumns.length) return axis;
    const byIndex = new Map(pairColumns.map((c) => [c.index, c]));
    return axis.map((m) => {
      const col = byIndex.get(Number(m.month_index));
      if (!col) return m;
      return {
        ...m,
        label: col.monthName,
        pairYears: col.yearsLabel,
        pairPaired: col.paired,
      };
    });
  }, [statement.axis, pairColumns]);
  const markedMonthEnd = useMemo(
    () => currentMonthMarkerValue(monthCols.map((m) => m.month_end)),
    [monthCols],
  );
  const noteColumnShown = notePermitted === true;
  const noteColumnNotice = !noteColumnShown
    ? null
    : notes.error
      ? "Commentary unavailable. This column is incomplete."
      : notes.truncated
        ? "Commentary partly loaded. This column is incomplete."
        : null;
  const TOTAL_COLS = 1 + (noteColumnShown ? 1 : 0) + monthCols.length * 4 + 4;
  const headlineRowKey = (statementLabel) => {
    const wanted = String(statementLabel ?? "")
      .trim()
      .toLowerCase();
    if (!wanted) return null;
    return glRowKey(
      isRows.find(
        (candidate) =>
          (candidate?.kind === "subtotal" || candidate?.kind === "total") &&
          String(candidate.line_label ?? "")
            .trim()
            .toLowerCase() === wanted,
      ),
    );
  };
  const glActivityDrawer = (rowKey) => {
    if (!glActivity.target || !rowKey || glActivity.rowKey !== rowKey)
      return null;
    return (
      <div
        id="variance-gl-activity-panel"
        ref={glActivityPanelRef}
        tabIndex={-1}
        style={{
          background: card,
          border: `2px solid ${border}`,
          borderRadius: 8,
          outline: "none",
          padding: 14,
        }}
      >
        <VarianceGlActivityPanel
          entry={glActivity.entry}
          onClose={closeGlActivity}
          hasPrevious={glActivity.cursorStack.length > 0}
          onPreviousPage={() => {
            const previousCursor =
              glActivity.cursorStack[glActivity.cursorStack.length - 1] ?? null;
            loadGlActivity(
              glActivity.target,
              previousCursor,
              glActivity.cursorStack.slice(0, -1),
              rowKey,
              {
                contextCursor: glActivity.contextCursor,
                contextCursorStack: glActivity.contextCursorStack,
                only: "actual",
                keep: {
                  entry: glActivity.entry,
                  contextEntry: glActivity.contextEntry,
                },
              },
            );
          }}
          onNextPage={(nextCursor) =>
            loadGlActivity(
              glActivity.target,
              nextCursor,
              [...glActivity.cursorStack, glActivity.cursor],
              rowKey,
              {
                contextCursor: glActivity.contextCursor,
                contextCursorStack: glActivity.contextCursorStack,
                only: "actual",
                keep: {
                  entry: glActivity.entry,
                  contextEntry: glActivity.contextEntry,
                },
              },
            )
          }
          contextEntry={glActivity.contextEntry}
          hasContextPrevious={glActivity.contextCursorStack.length > 0}
          onContextPreviousPage={() => {
            const stack = glActivity.contextCursorStack;
            loadGlActivity(
              glActivity.target,
              glActivity.cursor,
              glActivity.cursorStack,
              rowKey,
              {
                contextCursor: stack[stack.length - 1] ?? null,
                contextCursorStack: stack.slice(0, -1),
                only: "context",
                keep: {
                  entry: glActivity.entry,
                  contextEntry: glActivity.contextEntry,
                },
              },
            );
          }}
          onContextNextPage={(nextCursor) =>
            loadGlActivity(
              glActivity.target,
              glActivity.cursor,
              glActivity.cursorStack,
              rowKey,
              {
                contextCursor: nextCursor,
                contextCursorStack: [
                  ...glActivity.contextCursorStack,
                  glActivity.contextCursor,
                ],
                only: "context",
                keep: {
                  entry: glActivity.entry,
                  contextEntry: glActivity.contextEntry,
                },
              },
            )
          }
          theme={{ text, sub, border, surface: subtle, green, red, amber }}
        />
      </div>
    );
  };
  const monthActualState = useMemo(() => {
    const byIndex = new Map();
    for (const r of periodCoa || []) {
      const k = Number(r.month_index);
      const state = r.is_actual ? "realized" : "forward";
      const seen = byIndex.get(k);
      if (seen === undefined) byIndex.set(k, state);
      else if (seen !== state) byIndex.set(k, "mixed");
    }
    return byIndex;
  }, [periodCoa]);
  const sealStateTitle = (state) => {
    if (state === "realized") {
      return "Realized at seal: this month had already closed when the budget was sealed, so its actual is compared against the GL as it stood at seal. The variance is restatement drift, not actual versus budget.";
    }
    if (state === "forward") {
      return "Forward at seal: this month had not closed when the budget was sealed, so the variance is actual versus budget. A month can read forward and still have closed since — the tag describes the snapshot, not today.";
    }
    return "Mixed: this month's accounts disagree on whether they were realized at seal, so no single comparison describes the column. Read the individual accounts.";
  };
  const stickyCell = {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: card,
    borderRight: `1px solid ${border}`,
    whiteSpace: "nowrap",
    minWidth: ACCOUNT_COL_MIN_WIDTH,
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
  const emptyCell = preserveNulls ? EMPTY : "";
  const monthCells = (row, keyPrefix, bold = false) =>
    (row.monthly || []).map((m, i) => {
      const month =
        m.month_key || String(monthCols[i]?.month_end || "").slice(0, 7);
      const accounts =
        row.member_account_numbers ||
        (row.account_number ? [row.account_number] : []);
      const column = pairColumnsByMonth.get(month) || null;
      const target = makeGlActivityTarget({
        kind: `${row.kind || "account"}-month`,
        label: `${row.line_label || row.account_name || row.account_number} · ${column?.label || month}`,
        accountNumbers: accounts,
        cell: column
          ? {
              baselineMonth: column.baselineMonth,
              compareMonth: column.compareMonth,
            }
          : { baselineMonth: month, compareMonth: month },
        selectedAmount: m.actual,
      });
      const leading =
        leadingMonthEnd != null && monthCols[i]?.month_end === leadingMonthEnd;
      const noteMarks =
        noteColumnShown && row.account_number != null && monthCols[i]?.month_end
          ? noteMarksForMonth(
              noteIndex.byAccount.get(String(row.account_number)) || [],
              monthCols[i].month_end,
              notes.authors,
            )
          : [];
      return (
        <React.Fragment key={`${keyPrefix}-m${i}`}>
          <td
            style={{
              ...tdNum,
              borderLeft: `1px solid ${leading ? leadingFg : border}`,
              boxShadow: leading ? `inset 1px 0 0 ${leadingFg}` : undefined,
              fontWeight: bold ? 700 : undefined,
            }}
          >
            {m.budget === null
              ? emptyCell
              : bold || row.account_number == null
                ? formatStatementMoney(m.budget)
                : budgetMonthButton(row, glRowKey(row), month, m.budget)}
          </td>
          <td style={{ ...tdNum, fontWeight: bold ? 700 : undefined }}>
            {m.actual === null
              ? emptyCell
              : figureButton(
                  formatStatementMoney(m.actual),
                  target,
                  `View GL activity for ${row.line_label || row.account_number} in ${month}`,
                  glRowKey(row),
                )}
          </td>
          <td
            style={{
              ...tdNum,
              color:
                m.variance === null
                  ? undefined
                  : varColor(m.variance, row.noi_section),
              background:
                m.variance === null
                  ? undefined
                  : varBg(m.variance, row.noi_section),
              fontWeight: bold ? 700 : 600,
            }}
          >
            {m.variance === null
              ? emptyCell
              : bold || row.account_number == null
                ? formatStatementMoney(m.variance)
                : varianceFigureButton(row, glRowKey(row), {
                    month,
                    monthEnd: monthCols[i]?.month_end || null,
                    figures: {
                      budget: m.budget,
                      actual: m.actual,
                      variance: m.variance,
                    },
                    label: `Explain account ${row.account_number} variance for ${month}`,
                  })}
            {noteMarks.length ? (
              <TrackedChangeMark
                changes={noteMarks}
                heading="Commentary"
                C={{
                  textPrimary: text,
                  textSecondary: sub,
                  border,
                  card,
                  accent: leadingFg,
                }}
              />
            ) : null}
          </td>
          <td
            style={{ ...tdNum, color: sub, fontWeight: bold ? 700 : undefined }}
          >
            {m.pct_variance === null || m.pct_variance === undefined
              ? ""
              : formatPercent(m.pct_variance, { signed: true })}
          </td>
        </React.Fragment>
      );
    });
  const coverageNote = (row) => {
    const c = row?.coverage;
    if (!c) return null;
    const short = [];
    if (c.baselineUncovered > 0)
      short.push(
        `${baselineAmountLabel} carries ${c.baselineCovered} of ${c.baselineCovered + c.baselineUncovered} account-months`,
      );
    if (c.compareUncovered > 0)
      short.push(
        `${compareAmountLabel} carries ${c.compareCovered} of ${c.compareCovered + c.compareUncovered} account-months`,
      );
    if (short.length === 0) return null;
    return (
      <span
        style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: sub }}
      >
        partial coverage — {short.join(", ")}
      </span>
    );
  };

  const noiRows = useMemo(
    () => averagePeriodTotals(aggregateNoiByLine(periodNoi), periodPair),
    [periodNoi, periodPair],
  );
  const itemizedNoiBuild = pairing !== "budget_vs_budget" && noiRows.length > 0;
  const derivedNoiRows = useMemo(
    () =>
      noiTemplate
        ? averagePeriodTotals(
            deriveNoiBuildLines(periodCoa, noiTemplate, { preserveNulls }),
            periodPair,
          )
        : [],
    [periodCoa, noiTemplate, preserveNulls, periodPair],
  );
  const derivedNoiReconciliation = useMemo(
    () => reconcileDerivedNoi(derivedNoiRows, statementRows),
    [derivedNoiRows, statementRows],
  );
  const totalHeading = useMemo(
    () => periodPairTotalHeading(periodPair),
    [periodPair],
  );
  const chartData = useMemo(
    () => topVarianceAccounts(visibleCoaRows, 10),
    [visibleCoaRows],
  );
  const { active: activeIsRows, inactive: noActivityIsRows } = useMemo(
    () =>
      partitionByActivity(isRows, {
        hasActivity: budgetVarianceRowHasActivity,
        isPinned: isStructuralRow,
      }),
    [isRows],
  );
  const displayIsRows = useMemo(
    () => withNoActivitySection(activeIsRows, noActivityIsRows, showNoActivity),
    [activeIsRows, noActivityIsRows, showNoActivity],
  );
  const exportModel = useMemo(
    () =>
      buildVarianceExportModel({
        rows: displayIsRows,
        monthCols,
        totalHeading,
        baselineToken: involvesLiveActuals(pairing)
          ? "Bud"
          : sideColumnToken(baselineSide),
        compareToken: involvesLiveActuals(pairing)
          ? "Act"
          : sideColumnToken(compareSide),
        baselineTotalLabel: baselineSide?.shortLabel || "Baseline",
        compareTotalLabel: compareSide?.shortLabel || "Compare",
        propertyCode,
        periodLabel: noteWindowLabel,
        comparePeriodLabel: comparePeriod
          ? `${formatMonthLabel(comparePeriod.start)} – ${formatMonthLabel(comparePeriod.end)}`
          : "",
        baselineSideLong,
        compareSideLong,
        baselineName,
        compareName,
        showBalanceSheet,
        hiddenNoActivityCount: showNoActivity ? 0 : noActivityIsRows.length,
        noiBuildLines:
          !itemizedNoiBuild && noiTemplate && periodCoa.length > 0
            ? derivedNoiRows
            : null,
      }),
    [
      displayIsRows,
      monthCols,
      totalHeading,
      pairing,
      baselineSide,
      compareSide,
      propertyCode,
      noteWindowLabel,
      comparePeriod,
      baselineSideLong,
      compareSideLong,
      baselineName,
      compareName,
      showBalanceSheet,
      showNoActivity,
      noActivityIsRows.length,
      itemizedNoiBuild,
      noiTemplate,
      periodCoa.length,
      derivedNoiRows,
    ],
  );
  const [exporting, setExporting] = useState(null);
  const [exportError, setExportError] = useState(null);

  const handleExportExcel = async () => {
    setExporting("xlsx");
    setExportError(null);
    try {
      await exportBudgetVarianceXLSX({
        model: exportModel,
        period,
        comparePeriod,
      });
    } catch (e) {
      console.error("Budget variance Excel export failed:", e);
      setExportError("Excel export failed. Nothing was downloaded.");
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    setExporting("pdf");
    setExportError(null);
    try {
      const doc = buildBudgetVariancePdfDoc(exportModel, {
        orgName: getCurrentOrgName(),
      });
      await downloadPdf(
        doc,
        budgetVarianceExportFilename(
          propertyCode,
          period,
          "pdf",
          comparePeriod,
        ),
      );
      logExportEvent({
        datasetKey: budgetVarianceDatasetKey(propertyCode),
        format: "pdf",
        rowCount: budgetVarianceExportRowCount(exportModel.rows),
        action: "completed",
      }).catch(() => {});
    } catch (e) {
      console.error("Budget variance PDF export failed:", e);
      setExportError("PDF export failed. Nothing was downloaded.");
    } finally {
      setExporting(null);
    }
  };

  const overlayByLine = useMemo(() => {
    const by = {};
    for (const r of debtOverlay || []) {
      if (!r || r.line_id == null || r.amount == null) continue;
      const k = Number(r.line_id);
      (by[k] = by[k] || []).push(r);
    }
    for (const k of Object.keys(by)) {
      by[k].sort((a, b) => Number(a.month_index) - Number(b.month_index));
    }
    return by;
  }, [debtOverlay]);

  const varColor = (variance, section) => {
    if (!favourabilityApplies(pairing)) return text;
    const fav = isFavorable(variance, section);
    if (fav === null) return text;
    return fav ? green : red;
  };

  const chartBars = useMemo(
    () =>
      chartData.map((a) => {
        const color = varColor(a.variance, a.noi_section);
        return {
          ...a,
          fill: color === text ? sub : color,
          drillable: Boolean(chartGlTarget(a)),
        };
      }),
    [chartData, pairing, text, sub, green, red],
  );

  const openGlActivityRef = useRef(openGlActivity);
  openGlActivityRef.current = openGlActivity;
  const drillChartAccount = useCallback((a) => {
    const target = chartGlTarget(a);
    if (target)
      openGlActivityRef.current(target, null, `account:${a.account_number}`, {
        scrollTo: true,
      });
  }, []);

  const varBg = (variance, section) => {
    if (!favourabilityApplies(pairing)) return undefined;
    const fav = isFavorable(variance, section);
    if (fav === null) return undefined;
    return fav ? greenChipBg : redChipBg;
  };

  const favourabilitySwatch = (fav) => (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 2,
        background: fav ? greenChipBg : redChipBg,
        border: `1px solid ${fav ? green : red}`,
        verticalAlign: "middle",
        marginRight: 5,
      }}
    />
  );

  const alertChangedDate = (() => {
    if (!alertProvenance.updatedAt) return null;
    const date = new Date(alertProvenance.updatedAt);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
  })();

  const toggleNoteWindow = (acct) => {
    if (openNoteAccount === acct) {
      setOpenNoteAccount(null);
      return;
    }
    if (!collapseOtherRows(`account:${acct}`)) return;
    setOpenNoteAccount(acct);
  };

  const NOI_DRILLABLE = new Set([
    "detail",
    "subtotal",
    "total",
    "placeholder_uwpf",
    "derived_placeholder",
  ]);

  const noiCalcKey = (lineId) =>
    `${selectionKey}::${calcChainCacheKey(lineId, period)}`;

  const toggleNoiLine = (lineId) => {
    if (openNoiLine === lineId) {
      setOpenNoiLine(null);
      return;
    }
    setOpenNoiLine(lineId);
    const key = noiCalcKey(lineId);
    if (!noiCalcCache[key]) {
      setNoiCalcCache((c) => ({
        ...c,
        [key]: { loading: true, rows: [], error: null },
      }));
      fetchNoiLineCalcChain(propertyCode, lineId, period, baselineSelection)
        .then(({ data, error: chainErr }) => {
          setNoiCalcCache((c) => ({
            ...c,
            [key]: {
              loading: false,
              rows: data || [],
              error: chainErr || null,
            },
          }));
        })
        .catch((err) => {
          setNoiCalcCache((c) => ({
            ...c,
            [key]: { loading: false, rows: [], error: err },
          }));
        });
    }
  };

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
    padding: "0 10px",
    height: ROW_HEIGHT,
    fontSize: 13,
    color: text,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const drawerTd = {
    ...td,
    padding: "7px 10px 7px 28px",
    height: undefined,
    whiteSpace: "normal",
  };
  const tdNum = {
    ...td,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };
  const exportable =
    Boolean(propertyCode) &&
    !uwPairing &&
    !loading &&
    !error &&
    coa.length > 0 &&
    Boolean(period);
  const exportButtonStyle = {
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: text,
    background: card,
    border: `1px solid ${border}`,
    borderRadius: 6,
    cursor: exporting ? "wait" : "pointer",
    opacity: exporting ? 0.6 : 1,
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
          <h1
            style={{ fontSize: 20, fontWeight: 700, margin: 0, cursor: "help" }}
            title={[
              `${compareSide?.label || (compareSelection ? compareName : "Live GL actuals")} vs ${baselineSide?.label || baselineName}.`,
              uwPairing
                ? "The underwriting model has no account grain, so this pairing is compared at NOI-line × month and there is no account drill beneath it."
                : `${sideFormula} The months run across the top${involvesLiveActuals(pairing) ? "; click an actual or variance figure for the GL activity behind it" : ""}${assumptionDrillable ? "; click a period budget figure for the assumption it was budgeted on" : ""}.${groupSummarizable ? " Click a total or subtotal line for an AI summary of the group's budget, actual and variance." : ""}${notePermitted === true ? " Click an account to read or record commentary on it; the 💬 column marks the accounts that already carry a note, and opens it in place." : ""} Click an NOI build line to expose how it is computed — its two-side composition.`,
              involvesLiveActuals(pairing)
                ? `${freshnessCaption({ ...glFresh, scope: "GL data" })} · ${GL_SYNC_WINDOW_CAPTION}`
                : null,
            ]
              .filter(Boolean)
              .join("\n")}
            data-testid="gl-freshness"
          >
            Budget Analysis
            {uwPairing ? (
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 12,
                  fontWeight: 600,
                  color: sub,
                }}
              >
                — underwriting, at NOI-line grain
              </span>
            ) : null}
          </h1>
        </div>
        {exportable ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {exportError ? (
              <span role="alert" style={{ fontSize: 12, color: red }}>
                {exportError}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exporting !== null}
              style={exportButtonStyle}
              title="Download the variance table below as a branded PDF, exactly as it is on screen"
            >
              {exporting === "pdf" ? "Exporting…" : "Export PDF"}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting !== null}
              style={exportButtonStyle}
              title="Download the variance table below as an Excel workbook, exactly as it is on screen"
            >
              {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        ) : null}
      </div>

      {propertyCode && loading && (
        <div style={{ padding: 24, color: sub, fontSize: 14 }} role="status">
          Loading variance…
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
          Could not load variance for {propertyCode}.{" "}
          {error?.message ? String(error.message) : ""}
        </div>
      )}
      {propertyCode &&
        (baselines.length > 0 ||
          uwAvailable ||
          baselinesLoading ||
          baselinesError) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 14,
              padding: "10px 14px",
              background: card,
              border: `1px solid ${border}`,
              borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: sub }}>
              Comparison sides
            </span>
            {baselinesLoading && (
              <span style={{ fontSize: 12, color: sub }} role="status">
                Listing sealed budgets…
              </span>
            )}
            {!baselinesLoading && baselinesError && (
              <span style={{ fontSize: 12, color: amber }}>
                Could not list this property’s sealed budgets, so the figures
                below are its default baseline and no other can be chosen here.
              </span>
            )}
            {!baselinesLoading &&
              !baselinesError &&
              (baselines.length > 0 || uwAvailable) && (
                <>
                  {(baselines.length > 1 || uwAvailable) && (
                    <label style={{ fontSize: 12, color: sub }}>
                      Baseline{" "}
                      <select
                        value={
                          uwBaselineSelected
                            ? UW_BASELINE_VALUE
                            : baselineKey(activeBaseline)
                        }
                        aria-label="Sealed budget baseline"
                        onChange={(e) => {
                          if (e.target.value === UW_BASELINE_VALUE) {
                            setUwBaselineSelected(true);
                            return;
                          }
                          setUwBaselineSelected(false);
                          const picked = parseBaselineKey(e.target.value);
                          const primary = baselines.find((b) => b.isPrimary);
                          const pickedSide = sealedBudgetSide(
                            baselines.find(
                              (b) => baselineKey(b) === e.target.value,
                            ),
                          );
                          if (isSameSide(pickedSide, compareSide)) return;
                          setBaselineSelection(
                            picked &&
                              primary &&
                              baselineKey(picked) === baselineKey(primary)
                              ? null
                              : picked,
                          );
                        }}
                        style={{
                          fontSize: 12,
                          padding: "3px 6px",
                          background: subtle,
                          color: text,
                          border: `1px solid ${border}`,
                          borderRadius: 6,
                        }}
                      >
                        {baselines.map((b) => (
                          <option
                            key={baselineKey(b)}
                            value={baselineKey(b)}
                            disabled={isSameSide(
                              compareSide,
                              sealedBudgetSide(b),
                            )}
                          >
                            {baselineOptionLabel(b)}
                          </option>
                        ))}
                        {uwAvailable && (
                          <option value={UW_BASELINE_VALUE}>
                            {UNDERWRITING_SIDE.label}
                          </option>
                        )}
                      </select>
                    </label>
                  )}
                  <label style={{ fontSize: 12, color: sub }}>
                    Compare{" "}
                    <select
                      value={
                        compareSelection
                          ? baselineKey(compareSelection)
                          : "__actuals__"
                      }
                      aria-label="Variance compare side"
                      onChange={(e) => {
                        if (e.target.value === "__actuals__") {
                          setCompareSelection(null);
                          return;
                        }
                        const picked = parseBaselineKey(e.target.value);
                        if (
                          picked &&
                          !isSameSide(
                            baselineSide,
                            sealedBudgetSide(
                              baselines.find(
                                (b) => baselineKey(b) === e.target.value,
                              ),
                            ),
                          )
                        ) {
                          setCompareSelection(picked);
                        }
                      }}
                      style={{
                        fontSize: 12,
                        padding: "3px 6px",
                        background: subtle,
                        color: text,
                        border: `1px solid ${border}`,
                        borderRadius: 6,
                      }}
                    >
                      <option value="__actuals__">{ACTUALS_SIDE.label}</option>
                      {baselines.map((b) => {
                        const side = sealedBudgetSide(b);
                        return (
                          <option
                            key={`compare-${baselineKey(b)}`}
                            value={baselineKey(b)}
                            disabled={isSameSide(baselineSide, side)}
                          >
                            {side?.label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </>
              )}
            {!baselinesLoading &&
              !baselinesError &&
              baselines.length === 1 &&
              !uwAvailable && (
                <span style={{ fontSize: 12, color: text, fontWeight: 600 }}>
                  {baselineName}
                </span>
              )}
            {!baselinesLoading &&
              !baselinesError &&
              !uwBaselineSelected &&
              activeBaseline && (
                <span style={{ fontSize: 11, color: sub }}>
                  Sealed {baselineSealedOn || "date unavailable"} ·{" "}
                  {activeBaseline.coaAccountCount} account
                  {activeBaseline.coaAccountCount === 1 ? "" : "s"} ·{" "}
                  {activeBaseline.coaLineCount} account-month row
                  {activeBaseline.coaLineCount === 1 ? "" : "s"}
                  {baselines.length === 1
                    ? " — the only sealed budget currently held for this property"
                    : ""}
                </span>
              )}
            {!baselinesLoading &&
              !baselinesError &&
              !uwBaselineSelected &&
              thinBaseline && (
                <span style={{ fontSize: 11, color: amber, flexBasis: "100%" }}>
                  This baseline was sealed from a near-empty budget — it
                  itemizes only {activeBaseline.coaAccountCount} account
                  {activeBaseline.coaAccountCount === 1 ? "" : "s"}, so most
                  accounts below have no baseline amount to compare against.
                  That is what this budget holds, not missing data.
                </span>
              )}
            {!baselinesLoading &&
              !baselinesError &&
              !uwBaselineSelected &&
              activeBaseline &&
              !activeBaseline.isPrimary && (
                <span style={{ fontSize: 11, color: amber, flexBasis: "100%" }}>
                  This is not the property’s default baseline, so every figure
                  below differs from the page’s default view. The nightly alert
                  evaluator and the portfolio and quarterly-packet views
                  continue to read the default budget, so they will not agree
                  with this screen while it is selected.
                </span>
              )}
            {staleSelection && (
              <span style={{ fontSize: 11, color: amber, flexBasis: "100%" }}>
                The budget that was selected is no longer a current baseline for
                this property — it has been superseded by a newer seal — so the
                figures below are the default baseline instead.
              </span>
            )}
            {pairing === "budget_vs_budget" &&
              (compareSide || compareSelection) && (
                <span style={{ fontSize: 11, color: sub, flexBasis: "100%" }}>
                  This is a plan-to-plan comparison. Seal-time realization and
                  favourable/unfavourable direction do not apply when neither
                  side is live GL actuals.
                </span>
              )}
            {uwPairing && (
              <span style={{ fontSize: 11, color: amber, flexBasis: "100%" }}>
                The underwriting model is compared at NOI-line grain, not by
                account: the model holds no accounts, so the by-account
                statement below is replaced rather than filled in.
              </span>
            )}
          </div>
        )}

      {propertyCode && uwPairing && !loading && !error && (
        <UwLineComparisonPanel
          C={C}
          propertyCode={propertyCode}
          rows={uwRows}
          reconciliation={uwReconciliation}
          otherLabel={compareSide?.label || "the selected comparison side"}
          otherShortLabel={compareSide?.shortLabel || "Compare"}
          favourability={favourabilityApplies(pairing)}
          missingSideLabel={
            uwOtherSide === null || (compareSelection && !compareSide)
              ? missingCompareSideLabel
              : null
          }
        />
      )}

      {propertyCode && !uwPairing && !loading && !error && coa.length === 0 && (
        <div
          style={{
            padding: 24,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 14,
          }}
        >
          {pairing === "budget_vs_budget" && (compareSide || compareSelection)
            ? `${compareName} has no current account rows for ${propertyCode}, or this comparison side is no longer a current pointer. The comparison was refused rather than falling back to another plan.`
            : baselines.length > 1
              ? `${baselineName} holds no account rows for ${propertyCode}, so there is nothing to compare against it. Choose another sealed budget above, or re-seal this one.`
              : baselines.length === 1
                ? `${baselineName} holds no account rows for ${propertyCode}, so there is nothing to compare against it, and it is the only sealed budget this property holds. Re-seal it to fill it in.`
                : `No sealed budget snapshot for ${propertyCode}. Seal a snapshot of the approved budget first; variance compares actuals against it.`}
        </div>
      )}

      {propertyCode &&
        !uwPairing &&
        !loading &&
        !error &&
        coa.length > 0 &&
        controlPeriod && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
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
              {comparePeriod ? "This side" : "Period"}
            </span>
            <label style={{ fontSize: 12, color: sub }}>
              From{" "}
              <input
                type="month"
                value={controlPeriod.start}
                min={snapshotMonths[0] || undefined}
                max={controlPeriod.end}
                aria-label="Period start month"
                onChange={(e) => {
                  const v = e.target.value;
                  if (!isMonthKey(v) || v > controlPeriod.end) return;
                  setCustomPeriod({ start: v, end: controlPeriod.end });
                }}
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
                value={controlPeriod.end}
                min={controlPeriod.start}
                max={snapshotMonths[snapshotMonths.length - 1] || undefined}
                aria-label="Period end month"
                onChange={(e) => {
                  const v = e.target.value;
                  if (!isMonthKey(v) || v < controlPeriod.start) return;
                  setCustomPeriod({ start: controlPeriod.start, end: v });
                }}
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
            {customPeriod && (
              <button
                type="button"
                onClick={() => {
                  if (
                    compareSelection &&
                    baselineKey(compareSelection) === autoCompareKeyRef.current
                  ) {
                    setCompareSelection(null);
                  }
                  autoCompareKeyRef.current = null;
                  setCustomPeriod(null);
                }}
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background: subtle,
                  color: text,
                  border: `1px solid ${border}`,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Reset to default
              </button>
            )}
            {!period && (
              <button
                type="button"
                onClick={() => setCustomPeriod(controlPeriod)}
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background: subtle,
                  color: text,
                  border: `1px solid ${border}`,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Open {formatMonthLabel(controlPeriod.start)} –{" "}
                {formatMonthLabel(controlPeriod.end)}
              </button>
            )}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: sub,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={!comparePeriod}
                aria-label="Both sides use the same period"
                onChange={(e) =>
                  setComparePeriod(
                    e.target.checked ? null : priorYearPeriod(period),
                  )
                }
              />
              Both sides use the same period
            </label>
            {comparePeriod && (
              <>
                <span style={{ fontSize: 12, fontWeight: 600, color: sub }}>
                  Against
                </span>
                <label style={{ fontSize: 12, color: sub }}>
                  From{" "}
                  <input
                    type="month"
                    value={comparePeriod.start}
                    min={snapshotMonths[0] || undefined}
                    max={comparePeriod.end}
                    aria-label="Comparison period start month"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!isMonthKey(v) || v > comparePeriod.end) return;
                      setComparePeriod({ start: v, end: comparePeriod.end });
                    }}
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
                    value={comparePeriod.end}
                    min={comparePeriod.start}
                    max={snapshotMonths[snapshotMonths.length - 1] || undefined}
                    aria-label="Comparison period end month"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!isMonthKey(v) || v < comparePeriod.start) return;
                      setComparePeriod({ start: comparePeriod.start, end: v });
                    }}
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
            )}
            {comparePeriod && (
              <span
                style={{
                  fontSize: 11,
                  color: coverageSentence.nothingPaired ? amber : sub,
                }}
              >
                {coverageSentence.text}
              </span>
            )}
            {comparePeriod && periodPair && !periodPair.equalLength && (
              <span style={{ flexBasis: "100%", fontSize: 11, color: sub }}>
                These windows are different lengths (
                {periodPair.baseline.months} against {periodPair.compare.months}{" "}
                months), so the right-hand block holds each side’s average per
                month rather than its total — a {periodPair.baseline.months}
                -month total beside a {periodPair.compare.months}-month one is
                not a comparison. The monthly columns are unaffected.
              </span>
            )}
            {!customPeriod && fyDefault.fallback && period && (
              <span style={{ flexBasis: "100%", fontSize: 11, color: amber }}>
                Showing {formatMonthLabel(period.start)} –{" "}
                {formatMonthLabel(period.end)} — no budget has been sealed for
                the current fiscal year (
                {formatMonthLabel(fyDefault.wanted.start)} –{" "}
                {formatMonthLabel(fyDefault.wanted.end)}) yet.
              </span>
            )}
            {!period ? (
              <span style={{ fontSize: 11, color: sub }}>
                No window is open. Choose From/To, or open the first budgeted
                year above.
              </span>
            ) : pairing === "budget_vs_budget" ? (
              <span style={{ fontSize: 11, color: sub }}>
                {planCoverage.baselineOnly === 0 &&
                planCoverage.compareOnly === 0
                  ? `${planCoverage.months} plan ${planCoverage.months === 1 ? "month is" : "months are"} carried by both ${baselineName} and ${compareName}.`
                  : [
                      planCoverage.baselineOnly > 0
                        ? `${planCoverage.baselineOnly} ${planCoverage.baselineOnly === 1 ? "month is" : "months are"} carried by ${baselineName} only; ${compareName} reads an em-dash with no variance struck.`
                        : "",
                      planCoverage.compareOnly > 0
                        ? `${planCoverage.compareOnly} ${planCoverage.compareOnly === 1 ? "month is" : "months are"} carried by ${compareName} only; ${baselineName} reads an em-dash with no variance struck.`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
              </span>
            ) : coverage.complete ? (
              <span style={{ fontSize: 11, color: sub }}>
                {coverage.months} closed{" "}
                {coverage.months === 1 ? "month" : "months"} through{" "}
                {formatMonthLabel(period.end)}
                {actualsThroughKnown ? "" : " (actuals coverage unverified)"}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: amber }}>
                {coverage.beyondActuals}{" "}
                {coverage.beyondActuals === 1 ? "month" : "months"} in this
                window {coverage.beyondActuals === 1 ? "has" : "have"} no{" "}
                {baselineSide ? "live GL actuals" : "actuals"} yet (from{" "}
                {formatMonthLabel(coverage.firstBeyond)}) — their budget is
                counted against a zero actual, which reads as an unfavourable
                variance.
              </span>
            )}
          </div>
        )}

      {propertyCode &&
        !uwPairing &&
        !loading &&
        !error &&
        noComparablePeriod && (
          <div
            style={{
              padding: 24,
              border: `1px dashed ${border}`,
              borderRadius: 8,
              color: sub,
              fontSize: 14,
            }}
          >
            No comparable month yet for {propertyCode}
            {snapshotMonths.length
              ? ` — the sealed budget begins ${formatMonthLabel(snapshotMonths[0])}, after the current fiscal year (${formatMonthLabel(fyDefault.wanted.start)} – ${formatMonthLabel(fyDefault.wanted.end)}).`
              : "."}{" "}
            {futurePeriod
              ? `Use From/To above to open the future budget (${formatMonthLabel(futurePeriod.start)} – ${formatMonthLabel(futurePeriod.end)}); a window with no live actuals is read against the current year's operating budget where one is sealed, otherwise its budget is counted against a zero actual.`
              : "Use From/To above once that year begins, or seal a budget for the current year."}
          </div>
        )}

      {propertyCode &&
        !uwPairing &&
        !loading &&
        !error &&
        coa.length > 0 &&
        period && (
          <>
            <style>{`
            .bv-headline-card .bv-card-tooltip { display: none; }
            .bv-headline-card:hover .bv-card-tooltip,
            .bv-headline-card:focus-within .bv-card-tooltip { display: block; }
          `}</style>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              {renderedHeadlineCards.map(
                ({
                  label,
                  statementLabel,
                  missingLabel,
                  unavailableText,
                  unavailableFaceText,
                  partialText,
                  row,
                }) => {
                  const oneSided = Boolean(
                    row &&
                    partialText &&
                    (row.budget === null || row.actual === null),
                  );
                  const faceReason = !row
                    ? `Unavailable — ${unavailableFaceText || "not a row in this property’s statement"}`
                    : oneSided
                      ? `One side only — loan principal missing on the ${row.budget === null ? "baseline" : "compare"} side; no variance struck`
                      : null;
                  const target =
                    label === DEBT_SERVICE_LABEL || label === CASH_FLOW_LABEL
                      ? null
                      : makeGlActivityTarget({
                          kind: "headline",
                          label,
                          accountNumbers: row?.account_numbers,
                          selectedAmount: row?.actual,
                          reconcileAmount: row?.period_total_actual_sum,
                        });
                  const rowKey = headlineRowKey(
                    typeof missingLabel === "string"
                      ? missingLabel
                      : statementLabel,
                  );
                  return (
                    <div
                      key={label}
                      className="bv-headline-card"
                      tabIndex={0}
                      style={{
                        position: "relative",
                        background: card,
                        border: `1px solid ${border}`,
                        borderRadius: 8,
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ fontSize: 12, color: sub }}>{label}</div>
                      {!(
                        CASH_FLOW_STATEMENT_ROWS_SUBLINE_HIDDEN &&
                        label === CASH_FLOW_LABEL
                      ) && (
                        <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                          {missingLabel ? "Statement rows" : "Statement row"}:{" "}
                          {statementLabel}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 19,
                          fontWeight: 700,
                          marginTop: 4,
                          color: row
                            ? row.variance == null ||
                              !favourabilityApplies(pairing)
                              ? text
                              : row.variance >= 0
                                ? green
                                : red
                            : undefined,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {row
                          ? figureButton(
                              formatCurrencyFull(row.variance),
                              target,
                              `Explain ${label} variance with GL activity`,
                              rowKey,
                              { scrollTo: true },
                            )
                          : formatCurrencyFull(row?.variance)}{" "}
                        <span
                          style={{ fontSize: 12, fontWeight: 500, color: sub }}
                        >
                          {formatPercent(row?.pct_variance, { signed: true })}
                        </span>
                      </div>
                      {faceReason && (
                        <div
                          className="bv-card-face-reason"
                          style={{
                            fontSize: 11,
                            lineHeight: 1.3,
                            marginTop: 4,
                            color: oneSided ? amber : sub,
                            fontStyle: oneSided ? "normal" : "italic",
                          }}
                        >
                          {faceReason}
                        </div>
                      )}
                      <div
                        className="bv-card-tooltip"
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          zIndex: 20,
                          background: card,
                          border: `1px solid ${border}`,
                          borderRadius: 8,
                          padding: "8px 10px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                        }}
                      >
                        <div style={{ fontSize: 11, color: sub }}>
                          {row
                            ? `${baselineSide ? baselineAmountLabel : "budget"} ${formatCurrencyFull(row.budget)} · ${baselineSide ? compareAmountLabel : "actual"} ${formatCurrencyFull(row.actual)}${
                                partialText &&
                                (row.budget === null || row.actual === null)
                                  ? ` — ${partialText}`
                                  : ""
                              }`
                            : unavailableText ||
                              `${missingLabel === true ? statementLabel : missingLabel || statementLabel} is not a row in this property’s statement, so this figure is unavailable.`}
                        </div>
                        {row ? (
                          <div
                            style={{ fontSize: 10, color: sub, marginTop: 2 }}
                          >
                            {baselineSide?.shortLabel || "Baseline"} ={" "}
                            {baselineName} ·{" "}
                            {compareSide?.shortLabel || "Compare"} ={" "}
                            {compareName}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                },
              )}
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
                      The ten largest variances by size over the selected
                      period, largest first, over the accounts currently shown —
                      so ticking “Show balance-sheet accounts” below changes
                      which ten appear. Individual GL accounts, not account
                      groups.
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
                      <TopVarianceChart
                        bars={chartBars}
                        sub={sub}
                        subtle={subtle}
                        onDrill={drillChartAccount}
                      />
                      <div
                        aria-label="Top variance account GL activity"
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          padding: "4px 8px 0 16px",
                        }}
                      >
                        {chartData.map((account) => {
                          const target = chartGlTarget(account);
                          if (!target) return null;
                          const rowKey = `account:${account.account_number}`;
                          return (
                            <button
                              key={account.account_number}
                              type="button"
                              aria-controls="variance-gl-activity-panel"
                              aria-expanded={
                                glActivity.target?.id === target.id &&
                                glActivity.rowKey === rowKey
                              }
                              onClick={(event) =>
                                openGlActivity(
                                  target,
                                  event.currentTarget,
                                  rowKey,
                                  { scrollTo: true },
                                )
                              }
                              style={{
                                background: subtle,
                                border: `1px solid ${border}`,
                                borderRadius: 6,
                                color: text,
                                cursor: "pointer",
                                fontSize: 11,
                                padding: "4px 7px",
                              }}
                            >
                              View {account.account_number} GL
                            </button>
                          );
                        })}
                      </div>
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
                margin: "0 0 4px",
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
            <p
              style={{
                fontSize: 12,
                color: sub,
                margin: "0 0 8px",
                lineHeight: 1.5,
              }}
            >
              {compareSideLong} vs {baselineSideLong} over the selected period —
              the baseline column is {baselineSideLong}, the comparison column
              is {compareSideLong}. The injected Total Operating Expenses and
              NOI subtotals cover that period only — they are not a full-year
              projection.
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                margin: "0 0 8px",
                fontSize: 11,
                color: sub,
              }}
            >
              {favourabilityApplies(pairing) ? (
                <>
                  <span>
                    {favourabilitySwatch(true)} month variance favourable
                    (revenue over, expense under)
                  </span>
                  <span>
                    {favourabilitySwatch(false)} month variance unfavourable
                  </span>
                </>
              ) : (
                <span>
                  Plan-to-plan differences are neutral, not favourable or
                  unfavourable; month cells are untinted.
                </span>
              )}
              <span style={{ flexBasis: "100%" }}>
                {alertProvenance.configured
                  ? `Percent thresholds are from saved org configuration${alertChangedDate ? ` (last changed ${alertChangedDate})` : " (last changed date unavailable)"}.`
                  : `Percent thresholds use platform defaults${alertChangedDate ? ` (platform settings last saved ${alertChangedDate}).` : "."}`}
              </span>
              <span style={{ flexBasis: "100%" }}>
                Nightly alert evaluator additionally applies a basis and dollar
                floors, so dashboard badges and emailed alerts can differ.
              </span>
            </div>
            <StatementStickyGrid
              theme={{ border, subtle, cardBg: card }}
              style={{ marginBottom: 24 }}
              onLeadingColumnChange={setLeadingMonthEnd}
            >
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
                    {noteColumnShown ? (
                      <th
                        style={{
                          ...th,
                          ...stickyTh1,
                          textAlign: "center",
                          padding: "8px 4px",
                          width: 28,
                        }}
                        rowSpan={2}
                        title={
                          noteColumnNotice
                            ? `Commentary: accounts with a recorded note are marked here. ${noteColumnNotice}`
                            : "Commentary: accounts with a recorded note are marked here. Click the mark to read it."
                        }
                        aria-label={
                          noteColumnNotice
                            ? `Commentary — ${noteColumnNotice}`
                            : "Commentary"
                        }
                      >
                        <span aria-hidden="true">💬</span>
                        {noteColumnNotice ? (
                          <span
                            role="img"
                            aria-label={noteColumnNotice}
                            title={noteColumnNotice}
                            style={{
                              display: "block",
                              color: red,
                              fontSize: 10,
                              lineHeight: 1,
                              marginTop: 1,
                            }}
                          >
                            ⚠
                          </span>
                        ) : null}
                      </th>
                    ) : null}
                    {monthCols.map((m) => {
                      const leading =
                        leadingMonthEnd != null &&
                        m.month_end === leadingMonthEnd;
                      return (
                        <th
                          key={`mh-${m.month_index}`}
                          data-statement-column={m.month_end}
                          {...(markedMonthEnd != null &&
                          m.month_end === markedMonthEnd
                            ? { "data-statement-current-month": "" }
                            : null)}
                          {...(leading
                            ? {
                                "data-statement-leading-month": "",
                                "aria-current": "true",
                                title: `${m.label} — month in view; commentary covering it is tinted to match`,
                              }
                            : null)}
                          style={{
                            ...thNum,
                            ...stickyTh1,
                            textAlign: "center",
                            borderLeft: `1px solid ${border}`,
                            ...(m.pairYears && !m.pairPaired
                              ? { color: sub }
                              : null),
                            ...(leading
                              ? {
                                  background: leadingBg,
                                  borderLeft: `1px solid ${leadingFg}`,
                                  boxShadow: `inset 1px 0 0 ${leadingFg}, inset 0 -1px 0 ${border}`,
                                }
                              : null),
                          }}
                          colSpan={4}
                        >
                          {m.label}
                          {m.pairYears ? (
                            <div
                              style={{
                                fontWeight: 400,
                                fontSize: 10,
                                color: sub,
                              }}
                            >
                              {m.pairYears}
                            </div>
                          ) : null}
                          {realizedFlagApplies(pairing) &&
                          monthActualState.get(m.month_index) ? (
                            <em
                              style={{
                                color: sub,
                                fontWeight: 400,
                                cursor: "help",
                                borderBottomWidth: 1,
                                borderBottomStyle: "dotted",
                                borderBottomColor: border,
                              }}
                              title={sealStateTitle(
                                monthActualState.get(m.month_index),
                              )}
                            >
                              {" "}
                              ({monthActualState.get(m.month_index)})
                            </em>
                          ) : null}
                        </th>
                      );
                    })}
                    <th
                      style={{
                        ...thNum,
                        ...stickyTh1,
                        textAlign: "center",
                        borderLeft: `2px solid ${border}`,
                      }}
                      colSpan={4}
                    >
                      {totalHeading.label}
                      {totalHeading.sidesLabel ? (
                        <div
                          style={{ fontWeight: 400, fontSize: 10, color: sub }}
                        >
                          {totalHeading.sidesLabel}
                        </div>
                      ) : null}
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
                          title={baselineSideLong}
                        >
                          {involvesLiveActuals(pairing)
                            ? "Bud"
                            : sideColumnToken(baselineSide)}
                        </th>
                        <th
                          style={{ ...thNum, ...stickyTh2 }}
                          title={compareSideLong}
                        >
                          {involvesLiveActuals(pairing)
                            ? "Act"
                            : sideColumnToken(compareSide)}
                        </th>
                        <th style={{ ...thNum, ...stickyTh2 }}>Var</th>
                        <th style={{ ...thNum, ...stickyTh2 }}>%</th>
                      </React.Fragment>
                    ))}
                    <th
                      style={{
                        ...thNum,
                        ...stickyTh2,
                        borderLeft: `2px solid ${border}`,
                      }}
                      title={baselineSideLong}
                    >
                      {baselineSide?.shortLabel || "Baseline"}
                      <div
                        style={{ fontWeight: 400, fontSize: 10, color: sub }}
                      >
                        {baselineName}
                      </div>
                    </th>
                    <th
                      style={{ ...thNum, ...stickyTh2 }}
                      title={compareSideLong}
                    >
                      {compareSide?.shortLabel || "Compare"}
                      <div
                        style={{ fontWeight: 400, fontSize: 10, color: sub }}
                      >
                        {compareName}
                      </div>
                    </th>
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
                      const target = makeGlActivityTarget({
                        kind: `${r.kind}-period`,
                        label: r.line_label,
                        accountNumbers: r.member_account_numbers,
                        selectedAmount: r.actual,
                        reconcileAmount: r.period_total_actual_sum,
                      });
                      const rowKey = glRowKey(r);
                      const drawer = glActivityDrawer(rowKey);
                      const groupDrawer = assumptionDrawer(rowKey);
                      const presentation = statementRowPresentation(r);
                      return (
                        <React.Fragment key={r.key}>
                          <tr
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
                                ...presentation,
                              }}
                            >
                              {groupSummaryButton(r.line_label, r, rowKey)}
                              {coverageNote(r)}
                            </td>
                            {noteColumnShown ? (
                              <td style={{ ...td, background: subtle }} />
                            ) : null}
                            {monthCells(r, r.key, true)}
                            <td
                              style={{
                                ...tdNum,
                                borderLeft: `2px solid ${border}`,
                                fontWeight: 700,
                              }}
                            >
                              {groupSummaryButton(
                                formatStatementMoney(r.budget),
                                r,
                                rowKey,
                              )}
                            </td>
                            <td style={{ ...tdNum, fontWeight: 700 }}>
                              {figureButton(
                                formatStatementMoney(r.actual),
                                target,
                                `View GL activity for ${r.line_label} over the selected period`,
                                rowKey,
                              )}
                            </td>
                            <td
                              style={{
                                ...tdNum,
                                color: varColor(r.variance, r.noi_section),
                                fontWeight: 700,
                              }}
                            >
                              {groupSummaryButton(
                                formatStatementMoney(r.variance),
                                r,
                                rowKey,
                              )}
                            </td>
                            <td style={tdNum}>
                              {formatPercent(r.pct_variance, { signed: true })}
                            </td>
                          </tr>
                          {drawer || groupDrawer ? (
                            <tr>
                              <td
                                colSpan={TOTAL_COLS}
                                style={{ ...drawerTd, background: subtle }}
                              >
                                <StatementStickyDrawer leftPad={28}>
                                  {drawer ? <div>{drawer}</div> : null}
                                  {groupDrawer ? (
                                    <div style={{ marginTop: drawer ? 12 : 0 }}>
                                      {groupDrawer}
                                    </div>
                                  ) : null}
                                </StatementStickyDrawer>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    }
                    const rowKey = glRowKey(r);
                    const drawer = glActivityDrawer(rowKey);
                    const budgetDrawer = assumptionDrawer(rowKey);
                    const varianceOpen = varianceCell.rowKey === rowKey;
                    const commentaryOpen =
                      varianceOpen && notePermitted === true;
                    const cellMonthEnd = varianceOpen
                      ? varianceCell.monthEnd
                      : null;
                    const accountChains =
                      noteIndex.byAccount.get(String(r.account_number)) || [];
                    const cellChains = cellMonthEnd
                      ? accountChains.filter((c) =>
                          noteCoversMonth(c.note || c, cellMonthEnd),
                        )
                      : accountChains;
                    const months = commentaryOpen
                      ? monthsForAccount(periodCoa, r.account_number, {
                          preserveNulls,
                        })
                      : [];
                    const fixedRange = cellMonthEnd
                      ? { monthStart: cellMonthEnd, monthEnd: cellMonthEnd }
                      : null;
                    const noteChains = noteColumnShown ? accountChains : [];
                    const noteWindowOpen =
                      noteChains.length > 0 &&
                      openNoteAccount === r.account_number &&
                      !commentaryOpen;
                    const noteOnLeadingMonth =
                      leadingMonthEnd != null &&
                      noteChains.some((c) =>
                        noteCoversMonth(c.note || c, leadingMonthEnd),
                      );
                    const noteAttributionLines = noteChains
                      .map((c) => noteAttribution(c.note || c, notes.authors))
                      .filter(Boolean)
                      .map(
                        (a) =>
                          `${a.months ? `${a.months}: ` : ""}${attributionLine(a, formatTrackedChangeTime)}`,
                      );
                    const target = makeGlActivityTarget({
                      kind: "account-period",
                      label: `${r.account_number}${r.account_name ? ` · ${r.account_name}` : ""}`,
                      accountNumbers: r.member_account_numbers || [
                        r.account_number,
                      ],
                      selectedAmount: r.actual,
                      reconcileAmount: r.period_total_actual_sum,
                    });
                    return (
                      <React.Fragment key={r.account_number}>
                        <tr
                          style={{
                            ...bandedRowStyle(ri, bandC, {
                              background:
                                varianceOpen || drawer ? subtle : undefined,
                            }),
                          }}
                        >
                          <td
                            style={{
                              ...td,
                              ...stickyCell,
                              background:
                                varianceOpen || drawer ? subtle : card,
                            }}
                          >
                            {r.account_number}
                            {r.account_name ? ` · ${r.account_name}` : ""}
                            {coverageNote(r)}
                          </td>
                          {noteColumnShown ? (
                            <td
                              style={{
                                ...td,
                                textAlign: "center",
                                padding: "0 4px",
                                background:
                                  varianceOpen || drawer ? subtle : undefined,
                              }}
                            >
                              {noteChains.length ? (
                                <button
                                  type="button"
                                  aria-expanded={noteWindowOpen}
                                  aria-label={`Read commentary for account ${r.account_number} (${noteChains.length} note${noteChains.length === 1 ? "" : "s"})${noteOnLeadingMonth ? " — includes the month in view" : ""}`}
                                  title={`${noteChains.length} note${noteChains.length === 1 ? "" : "s"} recorded on this account${noteOnLeadingMonth ? ", including the month in view" : ""} — click to read${noteAttributionLines.length ? `\n${noteAttributionLines.join("\n")}` : ""}`}
                                  onClick={() =>
                                    toggleNoteWindow(r.account_number)
                                  }
                                  style={{
                                    background: noteOnLeadingMonth
                                      ? leadingBg
                                      : "transparent",
                                    border: 0,
                                    borderRadius: 3,
                                    color: "inherit",
                                    cursor: "pointer",
                                    font: "inherit",
                                    lineHeight: 1,
                                    padding: "2px 3px",
                                  }}
                                >
                                  💬
                                  {noteChains.length > 1 ? (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: sub,
                                        marginLeft: 1,
                                      }}
                                    >
                                      {noteChains.length}
                                    </span>
                                  ) : null}
                                </button>
                              ) : null}
                            </td>
                          ) : null}
                          {monthCells(r, r.key)}
                          <td
                            style={{
                              ...tdNum,
                              borderLeft: `2px solid ${border}`,
                            }}
                          >
                            {budgetFigureButton(r, rowKey)}
                          </td>
                          <td style={tdNum}>
                            {figureButton(
                              formatStatementMoney(r.actual),
                              target,
                              `View GL activity for account ${r.account_number} over the selected period`,
                              rowKey,
                            )}
                          </td>
                          <td
                            style={{
                              ...tdNum,
                              color: varColor(r.variance, r.noi_section),
                              fontWeight: 600,
                            }}
                          >
                            {varianceFigureButton(r, rowKey, {
                              label: `Explain account ${r.account_number} variance over the selected period`,
                            })}
                          </td>
                          <td style={tdNum}>
                            {formatPercent(r.pct_variance, { signed: true })}
                          </td>
                        </tr>
                        {noteWindowOpen && (
                          <tr>
                            <td
                              colSpan={TOTAL_COLS}
                              style={{ ...drawerTd, background: subtle }}
                            >
                              <StatementStickyDrawer leftPad={28}>
                                <VarianceNotePanel
                                  notes={noteChains}
                                  authors={notes.authors}
                                  loading={notes.loading}
                                  error={notes.error}
                                  truncated={notes.truncated}
                                  windowLabel={noteWindowLabel}
                                  leadingMonthEnd={leadingMonthEnd}
                                  onLoadHistory={loadNoteHistory}
                                  theme={{
                                    text,
                                    sub,
                                    border,
                                    card,
                                    subtle,
                                    red,
                                    leadingBg,
                                    leadingFg,
                                  }}
                                />
                              </StatementStickyDrawer>
                            </td>
                          </tr>
                        )}
                        {(commentaryOpen || drawer || budgetDrawer) && (
                          <tr>
                            <td
                              id={
                                varianceOpen ? "variance-cell-panel" : undefined
                              }
                              colSpan={TOTAL_COLS}
                              style={{ ...drawerTd, background: subtle }}
                            >
                              <StatementStickyDrawer leftPad={28}>
                                {[
                                  budgetDrawer &&
                                  assumption.mode === ANALYSIS_MODE_VARIANCE
                                    ? {
                                        key: "explanation",
                                        content: budgetDrawer,
                                      }
                                    : null,
                                  commentaryOpen
                                    ? {
                                        key: "commentary",
                                        content: (
                                          <VarianceNotePanel
                                            notes={cellChains}
                                            authors={notes.authors}
                                            loading={notes.loading}
                                            error={notes.error}
                                            truncated={notes.truncated}
                                            windowLabel={noteWindowLabel}
                                            leadingMonthEnd={leadingMonthEnd}
                                            monthOptions={months}
                                            fixedRange={fixedRange}
                                            onSaveNote={(range, noteText) =>
                                              saveNote(
                                                r.account_number,
                                                r.account_name,
                                                range,
                                                noteText,
                                              )
                                            }
                                            onDraftDirtyChange={
                                              onNoteDraftDirtyChange
                                            }
                                            onEditNote={editNote}
                                            onDeleteNote={removeNote}
                                            onLoadHistory={loadNoteHistory}
                                            theme={{
                                              text,
                                              sub,
                                              border,
                                              card,
                                              subtle,
                                              red,
                                              leadingBg,
                                              leadingFg,
                                            }}
                                          />
                                        ),
                                      }
                                    : null,
                                  drawer
                                    ? { key: "gl", content: drawer }
                                    : null,
                                  budgetDrawer &&
                                  assumption.mode !== ANALYSIS_MODE_VARIANCE
                                    ? { key: "budget", content: budgetDrawer }
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .map(({ key, content }, index) => (
                                    <div
                                      key={key}
                                      style={{ marginTop: index > 0 ? 12 : 0 }}
                                    >
                                      {content}
                                    </div>
                                  ))}
                              </StatementStickyDrawer>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </StatementStickyGrid>

            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
              NOI build
            </h2>
            {itemizedNoiBuild ? (
              <>
                <p
                  style={{
                    fontSize: 12,
                    color: sub,
                    margin: "0 0 8px",
                    lineHeight: 1.5,
                  }}
                >
                  {`NOI build over the selected period — ${compareSideLong} plus forward budget (itemized) from ${baselineName} for any months in the window that have not closed yet. Expanding a line shows the accounts and buckets behind it over the same period, so the drill totals to the line it opens from.${
                    totalHeading.average
                      ? ` The two windows are different lengths, so each figure here is that side’s average per month (${totalHeading.baselineMonths} months against ${totalHeading.compareMonths}) rather than its total.`
                      : ""
                  }`}
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
                        <th style={thNum} title={baselineSideLong}>
                          {baselineSide?.shortLabel || "Baseline"}
                          <div
                            style={{
                              fontWeight: 400,
                              fontSize: 10,
                              color: sub,
                            }}
                          >
                            {baselineName}
                          </div>
                        </th>
                        <th style={thNum} title={compareSideLong}>
                          {compareSide?.shortLabel || "Compare"}
                          <div
                            style={{
                              fontWeight: 400,
                              fontSize: 10,
                              color: sub,
                            }}
                          >
                            {compareName}
                          </div>
                        </th>
                        <th style={thNum}>Variance</th>
                        <th style={thNum}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {noiRows.map((r, ri) => {
                        const isTotal =
                          r.line_type === "total" || r.line_type === "subtotal";
                        const drillable = NOI_DRILLABLE.has(r.line_type);
                        const isOpen = openNoiLine === r.line_id;
                        return (
                          <React.Fragment key={r.line_id}>
                            <tr
                              onClick={
                                drillable
                                  ? () => toggleNoiLine(r.line_id)
                                  : undefined
                              }
                              style={{
                                ...bandedRowStyle(ri, bandC, {
                                  background:
                                    isOpen || isTotal ? subtle : undefined,
                                }),
                                cursor: drillable ? "pointer" : "default",
                              }}
                            >
                              <td
                                style={{
                                  ...td,
                                  fontWeight: isTotal ? 700 : 400,
                                }}
                              >
                                {drillable ? `${isOpen ? "▾" : "▸"} ` : ""}
                                {r.line_label || EMPTY}
                              </td>
                              <td style={tdNum}>
                                {r.budget == null
                                  ? EMPTY
                                  : formatCurrencyFull(r.budget)}
                              </td>
                              <td style={tdNum}>
                                {r.budget == null
                                  ? EMPTY
                                  : formatCurrencyFull(r.actual)}
                              </td>
                              <td
                                style={{
                                  ...tdNum,
                                  color:
                                    r.variance == null
                                      ? text
                                      : varColor(r.variance, r.noi_section),
                                  fontWeight: 600,
                                }}
                              >
                                {r.variance == null
                                  ? EMPTY
                                  : formatCurrencyFull(r.variance)}
                              </td>
                              <td style={tdNum}>
                                {formatPercent(r.pct_variance, {
                                  signed: true,
                                })}
                              </td>
                            </tr>
                            {drillable && isOpen && (
                              <tr>
                                <td
                                  colSpan={5}
                                  style={{ ...drawerTd, background: subtle }}
                                >
                                  <NoiCalcChainDrill
                                    entry={noiCalcCache[noiCalcKey(r.line_id)]}
                                    lineMeta={r}
                                    proformaOverlay={
                                      overlayByLine[Number(r.line_id)]
                                    }
                                    sides={{
                                      baseline: baselineName,
                                      compare: compareName,
                                      baselineColumnLabel:
                                        baselineSide?.shortLabel || "Baseline",
                                      compareColumnLabel:
                                        compareSide?.shortLabel || "Compare",
                                    }}
                                    theme={{
                                      text,
                                      sub,
                                      border,
                                      card,
                                      subtle,
                                      red,
                                      varColor,
                                      tableBgAlt: bandC.tableBgAlt,
                                    }}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <p
                  style={{
                    fontSize: 12,
                    color: sub,
                    margin: "0 0 8px",
                    lineHeight: 1.5,
                  }}
                >
                  {`NOI build over the selected period, derived from each side's chart-of-accounts rows: every account is rolled through its NOI build bucket into the build template, so ${baselineName} and ${compareName} are struck line by line from the same accounts the table above lists. Debt service, DSCR and LTV come from the loan model rather than the chart of accounts and stay as placeholders here.${
                    totalHeading.average
                      ? ` The two windows are different lengths, so each figure here is that side’s average per month (${totalHeading.baselineMonths} months against ${totalHeading.compareMonths}) rather than its total.`
                      : ""
                  }`}
                </p>
                {noiTemplateError ? (
                  <div
                    style={{
                      padding: 16,
                      border: `1px dashed ${border}`,
                      borderRadius: 8,
                      color: sub,
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    The NOI build template could not be read, so the build
                    cannot be derived for this period — reload to try again
                    rather than reading this as a zero.
                  </div>
                ) : !noiTemplate ? (
                  <div
                    style={{
                      padding: 16,
                      border: `1px dashed ${border}`,
                      borderRadius: 8,
                      color: sub,
                      fontSize: 13,
                    }}
                  >
                    Reading the NOI build template…
                  </div>
                ) : periodCoa.length === 0 ? (
                  <div
                    style={{
                      padding: 16,
                      border: `1px dashed ${border}`,
                      borderRadius: 8,
                      color: sub,
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    No account rows in the selected period
                    {period
                      ? ` (${formatMonthLabel(period.start)} – ${formatMonthLabel(period.end)})`
                      : ""}
                    , so there is nothing to roll into a build. Widen the period
                    above.
                  </div>
                ) : (
                  <>
                    <NoiBuildDerivedTable
                      lines={derivedNoiRows}
                      baselineLabel={baselineSide?.shortLabel || "Baseline"}
                      compareLabel={compareSide?.shortLabel || "Compare"}
                      baselineName={baselineName}
                      compareName={compareName}
                      varColor={varColor}
                      theme={{
                        text,
                        sub,
                        subtle,
                        border,
                        card,
                        tableBgAlt: bandC.tableBgAlt,
                      }}
                      styles={{ th, thNum, td, tdNum }}
                    />
                    {derivedNoiReconciliation &&
                    !derivedNoiReconciliation.reconciled ? (
                      <p
                        style={{
                          fontSize: 12,
                          color: sub,
                          margin: "8px 0 0",
                          lineHeight: 1.5,
                        }}
                      >
                        The derived Net Operating Income differs from the
                        account table’s NOI subtotal
                        {derivedNoiReconciliation.budgetGap
                          ? ` by ${formatCurrencyFull(derivedNoiReconciliation.budgetGap)} on the ${baselineSide?.shortLabel || "baseline"} side`
                          : ""}
                        {derivedNoiReconciliation.budgetGap &&
                        derivedNoiReconciliation.actualGap
                          ? " and"
                          : ""}
                        {derivedNoiReconciliation.actualGap
                          ? ` by ${formatCurrencyFull(derivedNoiReconciliation.actualGap)} on the ${compareSide?.shortLabel || "compare"} side`
                          : ""}
                        . The usual cause is an account the workbook places
                        above the NOI line whose NOI build bucket is missing,
                        which sits on the Unmapped line here instead of on an
                        operating line.
                      </p>
                    ) : null}
                  </>
                )}
              </>
            )}
          </>
        )}

      {!IN_PROGRESS_MONTH_ESTIMATE_HIDDEN &&
        propertyCode &&
        involvesLiveActuals(pairing) && (
          <InProgressMonthEstimate
            propertyCode={propertyCode}
            theme={{
              text,
              sub,
              border,
              card,
              subtle,
              red,
              green,
              tableBgAlt: bandC.tableBgAlt,
            }}
          />
        )}
    </div>
  );
}
