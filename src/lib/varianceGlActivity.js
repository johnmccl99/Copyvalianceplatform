export const GL_ACTIVITY_RESOLUTION = Object.freeze({
  EXACT: "exact",
  PARTIAL: "partial",
  DEFERRED: "deferred",
  UNRESOLVABLE: "unresolvable",
});

export const GL_ACTIVITY_COVERAGE = Object.freeze({
  UNKNOWN: "coverage_unknown",
  AVAILABLE: "available",
  COMPLETE_EMPTY: "complete_empty",
  NOT_LOADED: "not_loaded",
  PARTIAL: "partial",
  OUTSIDE_HELD_WINDOW: "outside_held_window",
  DEFERRED: "deferred",
  UNRESOLVABLE: "unresolvable",
  UNSUPPORTED: "unsupported",
  ERROR: "error",
});

export const GL_ACTIVITY_RECONCILIATION = Object.freeze({
  MATCHED: "matched",
  MISMATCHED: "mismatched",
  PARTIAL: "partial",
  UNAVAILABLE: "unavailable",
  UNTESTED: "untested",
  NOT_APPLICABLE: "not_applicable",
  NOT_COMPARABLE: "not_comparable",
});

export const GL_ACTIVITY_EXCLUSION_COPY = Object.freeze({
  not_served: "the variance surface does not serve this period yet",
  balance_class: "balance-sheet accounts are served from the workbook",
  ytd_opening_month: "the opening month of the year is served as a YTD balance",
  other_origin: "the served figure does not come from Entrata",
});

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function requiredText(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function month(value, name) {
  const normalized = requiredText(value, name);
  if (!MONTH_RE.test(normalized)) throw new Error(`${name} must use YYYY-MM`);
  return normalized;
}

export function normalizeGlAccountNumbers(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function resolveGlActivityAccounts({
  kind,
  accountNumber = null,
  accountNumbers = [],
  memberAccountNumbers = [],
  unresolvedComponents = [],
  liveActuals = true,
} = {}) {
  const accounts = normalizeGlAccountNumbers([
    accountNumber,
    ...(Array.isArray(accountNumbers) ? accountNumbers : []),
    ...(Array.isArray(memberAccountNumbers) ? memberAccountNumbers : []),
  ]);
  const unresolved = (
    Array.isArray(unresolvedComponents) ? unresolvedComponents : []
  )
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (!liveActuals) {
    return {
      kind: requiredText(kind, "kind"),
      accountNumbers: accounts,
      unresolvedComponents: unresolved,
      resolution: GL_ACTIVITY_RESOLUTION.UNRESOLVABLE,
      detailAvailability: GL_ACTIVITY_COVERAGE.UNSUPPORTED,
    };
  }
  if (accounts.length === 0) {
    return {
      kind: requiredText(kind, "kind"),
      accountNumbers: [],
      unresolvedComponents: unresolved,
      resolution: GL_ACTIVITY_RESOLUTION.UNRESOLVABLE,
      detailAvailability: GL_ACTIVITY_COVERAGE.UNRESOLVABLE,
    };
  }
  return {
    kind: requiredText(kind, "kind"),
    accountNumbers: accounts,
    unresolvedComponents: unresolved,
    resolution:
      unresolved.length > 0
        ? GL_ACTIVITY_RESOLUTION.PARTIAL
        : GL_ACTIVITY_RESOLUTION.EXACT,
    detailAvailability: GL_ACTIVITY_COVERAGE.UNKNOWN,
  };
}

export function glActivityTargetKey(target) {
  const parts = [
    target.propertyCode,
    target.monthFrom,
    target.monthTo,
    target.comparisonKey,
    target.baselineKey,
    target.side,
    target.kind,
    target.resolution,
    target.accountNumbers.join(","),
    target.liveActuals ? "live" : "not-live",
    target.selectedAmount,
    target.reconcilesTo,
  ];
  return parts.map((part) => encodeURIComponent(part ?? "")).join("|");
}

export function glActivityDrillWindows(pair, cell = null) {
  const none = { actual: null, context: null };
  const baseline = pair?.baseline;
  const compare = pair?.compare;
  if (!baseline || !compare) return none;
  const window = (from, to) => (from && to ? { from, to } : null);

  if (!cell) {
    if (pair.linked)
      return { actual: window(baseline.start, baseline.end), context: null };
    return {
      actual: window(compare.start, compare.end),
      context: window(baseline.start, baseline.end),
    };
  }

  const baselineMonth = cell.baselineMonth || null;
  const compareMonth = cell.compareMonth || null;
  if (pair.linked) {
    const only = baselineMonth || compareMonth;
    return { actual: window(only, only), context: null };
  }
  return {
    actual: window(compareMonth, compareMonth),
    context: window(baselineMonth, baselineMonth),
  };
}

export function buildGlActivityTarget({
  kind,
  propertyCode,
  monthFrom,
  monthTo = monthFrom,
  accountNumbers = [],
  comparisonKey = "budget-vs-actual",
  baselineKey = "",
  side = "actual",
  resolution = GL_ACTIVITY_RESOLUTION.EXACT,
  unresolvedComponents = [],
  selectedAmount = null,
  reconcilesTo = null,
  label = "",
  liveActuals = true,
} = {}) {
  const normalizedResolution = requiredText(resolution, "resolution");
  if (!Object.values(GL_ACTIVITY_RESOLUTION).includes(normalizedResolution)) {
    throw new Error(
      `Unsupported GL activity resolution: ${normalizedResolution}`,
    );
  }

  const normalizedMonthFrom = month(monthFrom, "monthFrom");
  const normalizedMonthTo = month(monthTo, "monthTo");
  if (normalizedMonthFrom > normalizedMonthTo) {
    throw new Error("monthFrom must not be after monthTo");
  }

  const accounts = normalizeGlAccountNumbers(accountNumbers);
  const requestableResolution =
    normalizedResolution === GL_ACTIVITY_RESOLUTION.EXACT ||
    normalizedResolution === GL_ACTIVITY_RESOLUTION.PARTIAL;
  const requestable = Boolean(
    liveActuals && requestableResolution && accounts.length > 0,
  );
  const detailAvailability = !liveActuals
    ? GL_ACTIVITY_COVERAGE.UNSUPPORTED
    : normalizedResolution === GL_ACTIVITY_RESOLUTION.DEFERRED
      ? GL_ACTIVITY_COVERAGE.DEFERRED
      : requestable
        ? GL_ACTIVITY_COVERAGE.UNKNOWN
        : GL_ACTIVITY_COVERAGE.UNRESOLVABLE;
  const target = {
    kind: requiredText(kind, "kind"),
    propertyCode: requiredText(propertyCode, "propertyCode"),
    monthFrom: normalizedMonthFrom,
    monthTo: normalizedMonthTo,
    comparisonKey: requiredText(comparisonKey, "comparisonKey"),
    baselineKey: String(baselineKey ?? "").trim(),
    side: requiredText(side, "side"),
    resolution: normalizedResolution,
    accountNumbers: accounts,
    unresolvedComponents: (Array.isArray(unresolvedComponents)
      ? unresolvedComponents
      : []
    )
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
    selectedAmount: selectedAmount == null ? null : Number(selectedAmount),
    reconcilesTo: reconcilesTo == null ? null : Number(reconcilesTo),
    label: String(label ?? "").trim(),
    liveActuals: Boolean(liveActuals),
    requestable,
    detailAvailability,
  };
  return { ...target, id: glActivityTargetKey(target) };
}

function dominantExclusion(excluded) {
  const entries = Object.entries(excluded ?? {})
    .filter(
      ([key, count]) => key in GL_ACTIVITY_EXCLUSION_COPY && Number(count) > 0,
    )
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return entries.length > 0 ? entries[0][0] : null;
}

function reconcileFromServer(serverReconciliation) {
  const {
    state,
    comparable_delta: comparableDelta,
    comparable_cell_count: comparableCells,
    mismatched_cell_count: mismatchedCells,
    excluded,
  } = serverReconciliation;

  const shared = {
    comparableCells: Number(comparableCells ?? 0),
    mismatchedCells: Number(mismatchedCells ?? 0),
    excluded: excluded ?? null,
    excludedReason: dominantExclusion(excluded),
  };

  if (state === "reconciled") {
    return { state: GL_ACTIVITY_RECONCILIATION.MATCHED, delta: 0, ...shared };
  }
  if (state === "mismatched") {
    return {
      state: GL_ACTIVITY_RECONCILIATION.MISMATCHED,
      delta: comparableDelta == null ? null : Number(comparableDelta),
      ...shared,
    };
  }
  return {
    state: GL_ACTIVITY_RECONCILIATION.NOT_COMPARABLE,
    delta: null,
    ...shared,
  };
}

export function reconcileGlActivity({
  coverage,
  resolution,
  presentationTotal,
  targetAmount,
  serverReconciliation = null,
  tolerance = 0.01,
} = {}) {
  if (coverage === GL_ACTIVITY_COVERAGE.UNSUPPORTED) {
    return { state: GL_ACTIVITY_RECONCILIATION.NOT_APPLICABLE, delta: null };
  }
  if (
    coverage !== GL_ACTIVITY_COVERAGE.AVAILABLE &&
    coverage !== GL_ACTIVITY_COVERAGE.COMPLETE_EMPTY
  ) {
    return { state: GL_ACTIVITY_RECONCILIATION.UNAVAILABLE, delta: null };
  }
  if (resolution === GL_ACTIVITY_RESOLUTION.PARTIAL) {
    return { state: GL_ACTIVITY_RECONCILIATION.PARTIAL, delta: null };
  }
  if (serverReconciliation?.state) {
    return reconcileFromServer(serverReconciliation);
  }
  if (presentationTotal == null || targetAmount == null) {
    return { state: GL_ACTIVITY_RECONCILIATION.UNTESTED, delta: null };
  }

  const total = Number(presentationTotal);
  const target = Number(targetAmount);
  if (!Number.isFinite(total) || !Number.isFinite(target)) {
    return { state: GL_ACTIVITY_RECONCILIATION.UNTESTED, delta: null };
  }

  const delta = total - target;
  return {
    state:
      Math.abs(delta) <= Math.abs(Number(tolerance) || 0)
        ? GL_ACTIVITY_RECONCILIATION.MATCHED
        : GL_ACTIVITY_RECONCILIATION.MISMATCHED,
    delta,
  };
}

export function buildGlActivityEntry({
  target,
  loading = false,
  error = null,
  response = null,
} = {}) {
  const coverage =
    response?.status ??
    target?.detailAvailability ??
    GL_ACTIVITY_COVERAGE.UNKNOWN;
  const rows = Array.isArray(response?.lines) ? response.lines : [];
  const reconciliation = reconcileGlActivity({
    coverage,
    resolution: target?.resolution,
    presentationTotal: response?.summary?.presentation_activity_total,
    targetAmount: target?.reconcilesTo,
    serverReconciliation: response?.summary?.reconciliation ?? null,
  });

  return {
    target: target ?? null,
    loading: Boolean(loading),
    error,
    coverage,
    coverageByMonth: Array.isArray(response?.coverage) ? response.coverage : [],
    heldWindow: response?.held_window ?? null,
    rows,
    page: response?.page ?? {
      returned: rows.length,
      total_count: rows.length,
      has_more: false,
      next_cursor: null,
    },
    summary: response?.summary ?? null,
    reconciliationCells: Array.isArray(response?.reconciliation_cells)
      ? response.reconciliation_cells
      : [],
    source: response?.source ?? null,
    reconciliation,
  };
}
