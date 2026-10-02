export const UW_GRAIN_STATEMENT =
  "The underwriting model has no account-level grain — its finest dimension is the NOI line, by month. " +
  "So this pairing compares NOI lines, not accounts, and there is no account drill beneath it. " +
  "The other side is rolled UP to the underwriting's lines; nothing is pushed down to accounts.";

const num = (v) => (v == null ? null : Number(v));

function isRow(row) {
  return !!row && row.line_id != null && row.month_end != null;
}

export function comparableRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(
    (r) => isRow(r) && r.comparable === true,
  );
}

export function pctFromBase(variance, base) {
  const b = num(base);
  const v = num(variance);
  if (
    b == null ||
    v == null ||
    !Number.isFinite(b) ||
    !Number.isFinite(v) ||
    b <= 0
  )
    return null;
  return (v / b) * 100;
}

export function windowMonths(rows) {
  const set = new Set();
  for (const r of Array.isArray(rows) ? rows : [])
    if (isRow(r)) set.add(r.month_end);
  return [...set].sort();
}

export function holdYears(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isRow(r) || r.hold_year == null) continue;
    const key = Number(r.hold_year);
    if (!by.has(key)) {
      by.set(key, {
        hold_year: key,
        months: r.hold_year_months == null ? null : Number(r.hold_year_months),
        reconciles: r.hold_year_reconciles === true,
        monthKeys: new Set(),
      });
    }
    by.get(key).monthKeys.add(r.month_end);
  }
  return [...by.values()]
    .map(({ monthKeys, ...rest }) => ({
      ...rest,
      windowMonths: monthKeys.size,
    }))
    .sort((a, b) => a.hold_year - b.hold_year);
}

export function buildUwLineMatrix(rows) {
  const months = windowMonths(rows);
  const monthHoldYear = {};
  const byLine = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isRow(r)) continue;
    if (r.hold_year != null && monthHoldYear[r.month_end] == null) {
      monthHoldYear[r.month_end] = Number(r.hold_year);
    }
    const id = Number(r.line_id);
    if (!byLine.has(id)) {
      byLine.set(id, {
        line_id: id,
        line_label: r.line_label || `Line ${id}`,
        display_order: r.display_order == null ? id : Number(r.display_order),
        noi_category: r.noi_category || null,
        noi_section: r.noi_section || null,
        uw_line_modeled: r.uw_line_modeled === true,
        cells: {},
        uw_total: null,
        other_total: null,
        variance: null,
        pct_variance: null,
        comparable_months: 0,
      });
    }
    const line = byLine.get(id);
    const uw = num(r.uw_amount);
    const other = num(r.other_amount);
    const comparable = r.comparable === true;
    const bothSides = uw != null && other != null;
    line.cells[r.month_end] = {
      uw_amount: uw,
      other_amount: other,
      comparable,
      variance: comparable && bothSides ? other - uw : null,
    };
    if (comparable && bothSides) {
      line.comparable_months += 1;
      line.uw_total = (line.uw_total || 0) + uw;
      line.other_total = (line.other_total || 0) + other;
    }
  }
  const lines = [...byLine.values()].sort(
    (a, b) => a.display_order - b.display_order || a.line_id - b.line_id,
  );
  for (const line of lines) {
    if (line.comparable_months > 0) {
      line.variance = line.other_total - line.uw_total;
      line.pct_variance = pctFromBase(line.variance, line.uw_total);
    }
  }
  return { months, monthHoldYear, lines, holdYears: holdYears(rows) };
}

export function uwWindowSummary(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(isRow);
  const months = windowMonths(list);
  const comparable = comparableRows(list);
  const comparableMonths = windowMonths(comparable);
  const years = holdYears(list);
  const lineIds = new Set(list.map((r) => Number(r.line_id)));
  const unmodeled = new Set(
    list
      .filter((r) => r.uw_line_modeled !== true)
      .map((r) => Number(r.line_id)),
  );
  return {
    rows: list.length,
    months: months.length,
    monthStart: months[0] || null,
    monthEnd: months[months.length - 1] || null,
    comparableRows: comparable.length,
    comparableMonths: comparableMonths.length,
    lines: lineIds.size,
    unmodeledLines: unmodeled.size,
    holdYears: years,
    reconcilingYears: years.filter((y) => y.reconciles),
    nonReconcilingYears: years.filter((y) => !y.reconciles),
  };
}

export function reconciliationSummary(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && r.hold_year != null,
  );
  const modeled = list.filter((r) => Number(r.hold_year) <= 10);
  const ok = modeled.filter((r) => r.reconciles === true);
  return {
    years: modeled.length,
    reconciling: ok.length,
    reconcilingYears: ok.map((r) => Number(r.hold_year)).sort((a, b) => a - b),
    partialYears: modeled
      .filter((r) => r.months != null && Number(r.months) !== 12)
      .map((r) => Number(r.hold_year))
      .sort((a, b) => a - b),
    anchorlessYears: modeled
      .filter((r) => r.uw_annual_noi == null)
      .map((r) => Number(r.hold_year))
      .sort((a, b) => a - b),
  };
}

const list = (arr) => arr.map((n) => `Year ${n}`).join(", ");

export function nonComparableStatements(
  summary,
  reconciliation,
  sideLabel = "the other side",
) {
  const out = [];
  if (!summary || summary.rows === 0) return out;
  const nonRecon = (summary.nonReconcilingYears || []).map((y) => y.hold_year);
  if (nonRecon.length) {
    out.push(
      `${list(nonRecon)} of the underwritten hold ${nonRecon.length === 1 ? "period does" : "periods do"} not compare: ` +
        "the model's monthly detail for those months does not add up to the model's own annual NOI for that year, " +
        "so the two halves of the underwriting disagree and no variance against them would mean anything. " +
        "Their months are shown with both figures and no variance.",
    );
  }
  if (summary.unmodeledLines > 0) {
    out.push(
      `${summary.unmodeledLines} NOI ${summary.unmodeledLines === 1 ? "line is" : "lines are"} not modeled by the ` +
        `underwriting at all, so ${summary.unmodeledLines === 1 ? "it carries" : "they carry"} a ${sideLabel} figure ` +
        "and an em-dash. That is the model not addressing the line, not a value of zero.",
    );
  }
  if (reconciliation && reconciliation.partialYears?.length) {
    out.push(
      `${list(reconciliation.partialYears)} of the model's hold ${reconciliation.partialYears.length === 1 ? "period is" : "periods are"} ` +
        "shorter than twelve months in the substrate, so no annual reconciliation is possible for " +
        `${reconciliation.partialYears.length === 1 ? "it" : "them"} and ${reconciliation.partialYears.length === 1 ? "it is" : "they are"} not compared.`,
    );
  }
  if (reconciliation && reconciliation.anchorlessYears?.length) {
    out.push(
      `${list(reconciliation.anchorlessYears)} ${reconciliation.anchorlessYears.length === 1 ? "carries" : "carry"} no ` +
        "underwritten annual NOI, so there is nothing to reconcile the monthly detail against.",
    );
  }
  out.push(
    "No account-level comparison is available on this pairing, and none is being withheld: " +
      "the underwriting model does not contain accounts.",
  );
  return out;
}
