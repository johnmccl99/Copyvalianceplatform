const TYPE_LABELS = {
  2: "Alternate Quarterly Projections",
  3: "Operating Budget",
  4: "Current Quarterly Projections",
};
export const UNCLASSIFIED_TYPE_LABEL = "Sealed budget snapshot";

export function budgetTypeLabel(budgetStatusTypeId) {
  return TYPE_LABELS[Number(budgetStatusTypeId)] || UNCLASSIFIED_TYPE_LABEL;
}

function intOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function baselineKey(baseline) {
  if (!baseline) return "";
  const type = intOrNull(
    baseline.budgetStatusTypeId ?? baseline.budget_status_type_id,
  );
  const year = intOrNull(baseline.fiscalYear ?? baseline.fiscal_year);
  if (type === null || year === null) return "";
  return `${type}|${year}`;
}

export function parseBaselineKey(key) {
  if (typeof key !== "string" || !key.includes("|")) return null;
  const [t, y] = key.split("|");
  const type = intOrNull(t);
  const year = intOrNull(y);
  if (type === null || year === null) return null;
  return { budgetStatusTypeId: type, fiscalYear: year };
}

export function normalizeBaselines(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      snapshotId: r?.snapshot_id ?? null,
      budgetStatusTypeId: intOrNull(r?.budget_status_type_id),
      fiscalYear: intOrNull(r?.fiscal_year),
      budgetTypeLabel:
        r?.budget_type_label || budgetTypeLabel(r?.budget_status_type_id),
      snapshotLabel: r?.snapshot_label ?? null,
      sealedAt: r?.sealed_at ?? null,
      isPrimary: r?.is_primary === true,
      monthEndMin: r?.month_end_min ?? null,
      monthEndMax: r?.month_end_max ?? null,
      coaLineCount: Number(r?.coa_line_count ?? 0),
      coaAccountCount: Number(r?.coa_account_count ?? 0),
      noiBuildLineCount: Number(r?.noi_build_line_count ?? 0),
      runningBalanceLineCount: Number(r?.running_balance_line_count ?? 0),
    }))
    .filter((b) => baselineKey(b) !== "");
}

export function baselineShortLabel(baseline) {
  if (!baseline) return "the property’s primary sealed budget";
  const type =
    baseline.budgetTypeLabel || budgetTypeLabel(baseline.budgetStatusTypeId);
  const year = intOrNull(baseline.fiscalYear);
  return year === null || year === 0 ? type : `${type} FY${year}`;
}

export function baselineOptionLabel(baseline) {
  if (!baseline) return "";
  return `${baselineShortLabel(baseline)}${baseline.isPrimary ? " · default" : ""}`;
}

export function primaryBaseline(baselines) {
  return (baselines || []).find((b) => b.isPrimary) || null;
}

export function resolveSelectedBaseline(baselines, selection) {
  const list = baselines || [];
  const key = baselineKey(selection);
  if (key) {
    const hit = list.find((b) => baselineKey(b) === key);
    if (hit) return hit;
  }
  return primaryBaseline(list);
}

export function isSelectionStale(baselines, selection) {
  const key = baselineKey(selection);
  if (!key) return false;
  return !(baselines || []).some((b) => baselineKey(b) === key);
}

export const OPERATING_BUDGET_TYPE_ID = 3;

function monthKeyOf(v) {
  const k = typeof v === "string" ? v.slice(0, 7) : "";
  return /^\d{4}-\d{2}$/.test(k) ? k : null;
}

function coversAnyOf(baseline, window) {
  const min = monthKeyOf(baseline?.monthEndMin);
  const max = monthKeyOf(baseline?.monthEndMax);
  if (!min || !max || !window) return false;
  return min <= window.end && max >= window.start;
}

export function currentFiscalYearOperatingBaseline(
  baselines,
  { currentWindow, targetWindow = null, exclude = null } = {},
) {
  const excludeKey = baselineKey(exclude);
  const candidates = (baselines || []).filter(
    (b) =>
      Number(b.budgetStatusTypeId) === OPERATING_BUDGET_TYPE_ID &&
      baselineKey(b) !== excludeKey &&
      coversAnyOf(b, currentWindow),
  );
  if (!candidates.length) return null;
  return candidates.find((b) => coversAnyOf(b, targetWindow)) || candidates[0];
}

export function baselineRpcArgs(selection) {
  const type = intOrNull(
    selection?.budgetStatusTypeId ?? selection?.budget_status_type_id,
  );
  const year = intOrNull(selection?.fiscalYear ?? selection?.fiscal_year);
  if (type === null || year === null) return {};
  return { p_budget_status_type_id: type, p_fiscal_year: year };
}
