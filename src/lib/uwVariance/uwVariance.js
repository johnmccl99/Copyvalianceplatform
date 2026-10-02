export const UNMODELED_ANCHORS = new Set(["noi_stabilized", "noi_peak"]);

export function isModeledAnchor(row) {
  return !UNMODELED_ANCHORS.has(row?.uw_anchor);
}

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function anchorRows(rows) {
  return [...(rows || [])]
    .filter(isModeledAnchor)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function unmodeledAnchorLabels(rows) {
  return (rows || [])
    .filter((r) => !isModeledAnchor(r))
    .map((r) => r.uw_label || r.uw_anchor);
}

export function pctIsMeaningful(row) {
  const base = row?.uw_noi;
  return base != null && Number.isFinite(Number(base)) && Number(base) > 0;
}

export function uwPresent(row) {
  if (!row?.uw_available || row.uw_noi == null) return false;
  const n = Number(row.uw_noi);
  return Number.isFinite(n) && n !== 0;
}

export function hasUwBaseline(rows) {
  return anchorRows(rows).some(uwPresent);
}

export function hasActualNoi(rows) {
  return (rows || []).some((r) => r.actual_noi != null);
}

export function alignmentSupported(rows) {
  return (rows || []).some((r) => r && "is_aligned" in r);
}

export function alignedRow(rows) {
  return anchorRows(rows).find((r) => r.is_aligned === true) || null;
}

export function alignmentInfo(rows) {
  const list = anchorRows(rows);
  const any = list[0] || {};
  const supported = alignmentSupported(rows);
  const aligned = alignedRow(rows);
  return {
    supported,
    aligned,
    aligned_hold_year: supported ? (aligned?.hold_year ?? null) : null,
    aligned_overlap_months: supported
      ? (aligned?.overlap_months ?? null)
      : null,
    acquisition_close: supported ? (any.acquisition_close ?? null) : null,
    window_hold_year: supported ? (any.window_hold_year ?? null) : null,
    modeled_hold_years: supported ? (any.modeled_hold_years ?? null) : null,
    past_modeled_hold: supported ? any.past_modeled_hold === true : false,
    pre_close_months: supported ? (any.pre_close_months ?? null) : null,
    beyond_modeled_months: supported
      ? (any.beyond_modeled_months ?? null)
      : null,
  };
}

export function summarizeUwVariance(rows) {
  const list = anchorRows(rows);
  const withActual = list.find((r) => r.actual_noi != null) || list[0] || {};
  const available = list.filter(uwPresent);
  const alignment = alignmentInfo(rows);
  return {
    actual_noi: withActual.actual_noi ?? null,
    actual_months: withActual.actual_months ?? 0,
    actual_through: withActual.actual_through ?? null,
    actual_full_year: !!withActual.actual_full_year,
    uw_count: available.length,
    primary: alignment.aligned,
    alignment,
  };
}

export function isFavorable(variance) {
  if (variance == null || !Number.isFinite(variance) || variance === 0)
    return null;
  return variance > 0;
}

export function benchmarkChartData(rows, actualNoi) {
  const a = num(actualNoi);
  if (actualNoi == null) return [];
  const bars = [{ label: "Actual (window)", value: a, kind: "actual" }];
  for (const r of anchorRows(rows)) {
    if (uwPresent(r)) {
      bars.push({
        label: r.uw_label || r.uw_anchor,
        value: num(r.uw_noi),
        kind: r.is_aligned === true ? "uw-aligned" : "uw",
      });
    }
  }
  return bars;
}
