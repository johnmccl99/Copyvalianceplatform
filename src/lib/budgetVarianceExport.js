import { isNoActivityDivider } from "./varianceRowActivity.js";

const QUARTET = ["budget", "actual", "variance", "pct_variance"];

export const VARIANCE_EXPORT_REPORT_TITLE = "Budget Variance";

function monthGroupLabel(m) {
  const base = m?.label || String(m?.month_end || "").slice(0, 7);
  if (!m?.pairYears) return base;
  return `${base} (${m.pairYears}${m.pairPaired === false ? ", unpaired" : ""})`;
}

export function buildVarianceExportColumns({
  monthCols = [],
  totalHeading = null,
  baselineToken = "Bud",
  compareToken = "Act",
  baselineTotalLabel = "Baseline",
  compareTotalLabel = "Compare",
} = {}) {
  const columns = [
    { key: "account", label: "Account", group: "", type: "text" },
  ];
  (monthCols || []).forEach((m, i) => {
    const group = monthGroupLabel(m);
    columns.push({
      key: `m${i}_budget`,
      label: baselineToken,
      group,
      type: "money",
    });
    columns.push({
      key: `m${i}_actual`,
      label: compareToken,
      group,
      type: "money",
    });
    columns.push({ key: `m${i}_variance`, label: "Var", group, type: "money" });
    columns.push({ key: `m${i}_pct`, label: "%", group, type: "percent" });
  });
  const totalGroup = totalHeading?.label || "Period total";
  columns.push({
    key: "total_budget",
    label: baselineTotalLabel,
    group: totalGroup,
    type: "money",
  });
  columns.push({
    key: "total_actual",
    label: compareTotalLabel,
    group: totalGroup,
    type: "money",
  });
  columns.push({
    key: "total_variance",
    label: "Variance",
    group: totalGroup,
    type: "money",
  });
  columns.push({
    key: "total_pct",
    label: "%",
    group: totalGroup,
    type: "percent",
  });
  return columns;
}

export function varianceExportRowLabel(row) {
  if (!row) return "";
  if (
    row.kind === "header" ||
    row.kind === "subtotal" ||
    row.kind === "total"
  ) {
    return String(row.line_label ?? "");
  }
  const number = row.account_number ?? "";
  return row.account_name ? `${number} · ${row.account_name}` : String(number);
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildVarianceExportRows({ rows = [], monthCols = [] } = {}) {
  const monthCount = (monthCols || []).length;
  const out = [];
  for (const r of rows || []) {
    if (!r || isNoActivityDivider(r) || r.__noActivityDivider) continue;
    if (r.kind === "header") {
      out.push({
        kind: "header",
        depth: r.depth ?? 0,
        label: varianceExportRowLabel(r),
        cells: [],
      });
      continue;
    }
    const cells = [varianceExportRowLabel(r)];
    const monthly = Array.isArray(r.monthly) ? r.monthly : [];
    for (let i = 0; i < monthCount; i += 1) {
      const m = monthly[i] || {};
      for (const field of QUARTET) cells.push(numberOrNull(m[field]));
    }
    cells.push(numberOrNull(r.budget));
    cells.push(numberOrNull(r.actual));
    cells.push(numberOrNull(r.variance));
    cells.push(numberOrNull(r.pct_variance));
    out.push({
      kind: r.kind === "subtotal" || r.kind === "total" ? r.kind : "account",
      depth: r.depth ?? 0,
      label: cells[0],
      cells,
    });
  }
  return out;
}

export function buildVarianceExportNotes({
  propertyCode,
  periodLabel,
  comparePeriodLabel = "",
  baselineSideLong,
  compareSideLong,
  baselineName,
  compareName,
  showBalanceSheet = false,
  hiddenNoActivityCount = 0,
  totalHeading = null,
} = {}) {
  const baselineWindow = periodLabel || "the selected period";
  const notes = [
    comparePeriodLabel && comparePeriodLabel !== periodLabel
      ? `${compareSideLong || "Comparison"} over ${comparePeriodLabel} vs ${baselineSideLong || "Baseline"} over ${baselineWindow}, for ${propertyCode || "this property"}. Every variance is the comparison side minus the baseline side.`
      : `${compareSideLong || "Comparison"} vs ${baselineSideLong || "Baseline"} for ${propertyCode || "this property"} over ${baselineWindow}. Every variance is the comparison side minus the baseline side.`,
  ];
  if (baselineName || compareName) {
    notes.push(
      `Baseline: ${baselineName || "unnamed"}. Comparison: ${compareName || "unnamed"}.`,
    );
  }
  notes.push(
    showBalanceSheet
      ? "Balance-sheet accounts are included, as they were on screen, and are excluded from the statement subtotals."
      : "Balance-sheet accounts were hidden on screen and are not in this file; they are excluded from the subtotals either way.",
  );
  if (hiddenNoActivityCount > 0) {
    notes.push(
      `${hiddenNoActivityCount} account${hiddenNoActivityCount === 1 ? "" : "s"} with no activity on either side ${hiddenNoActivityCount === 1 ? "was" : "were"} collapsed on screen and ${hiddenNoActivityCount === 1 ? "is" : "are"} not in this file. Each contributes exactly $0 to every subtotal, so no figure here moves because of it.`,
    );
  }
  if (totalHeading?.average) {
    notes.push(
      `The two windows are different lengths (${totalHeading.baselineMonths} months against ${totalHeading.compareMonths}), so the right-hand block is each side's average per month, not its total.`,
    );
  }
  notes.push(
    "An empty cell is a figure the data does not carry on that side. It is not a zero, and no variance is struck against it.",
  );
  return notes;
}

export const NOI_BUILD_EXPORT_TITLE = "NOI Build";

export function buildNoiBuildExportColumns({
  baselineTotalLabel = "Baseline",
  compareTotalLabel = "Compare",
} = {}) {
  return [
    { key: "line", label: "Line", group: "", type: "text" },
    { key: "budget", label: baselineTotalLabel, group: "", type: "money" },
    { key: "actual", label: compareTotalLabel, group: "", type: "money" },
    { key: "variance", label: "Variance", group: "", type: "money" },
    { key: "pct", label: "%", group: "", type: "percent" },
  ];
}

export function buildNoiBuildExportRows(lines = []) {
  const out = [];
  for (const l of lines || []) {
    if (!l || l.line_type === "spacer") continue;
    const depth = Number(l.indent_level) || 0;
    if (l.line_type === "section_header" || l.line_type === "subgroup_header") {
      out.push({
        kind: "header",
        depth,
        label: String(l.line_label ?? ""),
        cells: [],
      });
      continue;
    }
    const label =
      l.unmapped && Array.isArray(l.account_numbers) && l.account_numbers.length
        ? `${l.line_label} (${l.account_numbers.join(", ")})`
        : String(l.line_label ?? "");
    const cells = l.placeholder
      ? [label, null, null, null, null]
      : [
          label,
          numberOrNull(l.budget),
          numberOrNull(l.actual),
          numberOrNull(l.variance),
          numberOrNull(l.pct_variance),
        ];
    out.push({
      kind:
        l.line_type === "subtotal" || l.line_type === "total"
          ? l.line_type
          : "account",
      depth,
      label,
      cells,
      placeholder: l.placeholder === true,
    });
  }
  return out;
}

export function buildNoiBuildExportNotes({
  lines = [],
  totalHeading = null,
  baselineName,
  compareName,
} = {}) {
  const notes = [
    `NOI build over the selected period, derived from each side's chart-of-accounts rows: every account is rolled through its NOI build bucket into the build template, so ${baselineName || "the baseline"} and ${compareName || "the comparison"} are struck line by line from the same accounts the account table lists.`,
    "Debt service, DSCR and LTV come from the loan model rather than the chart of accounts; their cells are empty here, not zero.",
  ];
  if (totalHeading?.average) {
    notes.push(
      `The two windows are different lengths (${totalHeading.baselineMonths} months against ${totalHeading.compareMonths}), so each figure is that side's average per month rather than its total.`,
    );
  }
  const unmapped = (lines || []).find((l) => l?.unmapped);
  if (
    unmapped &&
    Array.isArray(unmapped.account_numbers) &&
    unmapped.account_numbers.length
  ) {
    const n = unmapped.account_numbers.length;
    notes.push(
      `${n} account${n === 1 ? "" : "s"} with no NOI build bucket (${unmapped.account_numbers.join(", ")}) ${n === 1 ? "is" : "are"} carried on the Unmapped accounts line so the build still totals the rows it was given.`,
    );
  }
  return notes;
}

export function buildNoiBuildExportSection({
  lines = null,
  totalHeading = null,
  baselineTotalLabel,
  compareTotalLabel,
  baselineName,
  compareName,
} = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return {
    title: NOI_BUILD_EXPORT_TITLE,
    columns: buildNoiBuildExportColumns({
      baselineTotalLabel,
      compareTotalLabel,
    }),
    rows: buildNoiBuildExportRows(lines),
    notes: buildNoiBuildExportNotes({
      lines,
      totalHeading,
      baselineName,
      compareName,
    }),
  };
}

export function buildVarianceExportModel({
  rows = [],
  monthCols = [],
  totalHeading = null,
  baselineToken,
  compareToken,
  baselineTotalLabel,
  compareTotalLabel,
  propertyCode,
  periodLabel,
  comparePeriodLabel = "",
  baselineSideLong,
  compareSideLong,
  baselineName,
  compareName,
  showBalanceSheet = false,
  hiddenNoActivityCount = 0,
  noiBuildLines = null,
} = {}) {
  const separateWindows =
    Boolean(comparePeriodLabel) && comparePeriodLabel !== periodLabel;
  return {
    title: VARIANCE_EXPORT_REPORT_TITLE,
    propertyCode: propertyCode || "",
    periodLabel: separateWindows
      ? `${periodLabel} vs ${comparePeriodLabel}`
      : periodLabel || "",
    baselinePeriodLabel: periodLabel || "",
    comparePeriodLabel: separateWindows ? comparePeriodLabel : "",
    columns: buildVarianceExportColumns({
      monthCols,
      totalHeading,
      baselineToken,
      compareToken,
      baselineTotalLabel,
      compareTotalLabel,
    }),
    rows: buildVarianceExportRows({ rows, monthCols }),
    notes: buildVarianceExportNotes({
      propertyCode,
      periodLabel,
      comparePeriodLabel,
      baselineSideLong,
      compareSideLong,
      baselineName,
      compareName,
      showBalanceSheet,
      hiddenNoActivityCount,
      totalHeading,
    }),
    noiBuild: buildNoiBuildExportSection({
      lines: noiBuildLines,
      totalHeading,
      baselineTotalLabel,
      compareTotalLabel,
      baselineName,
      compareName,
    }),
  };
}

export function budgetVarianceExportFilename(
  propertyCode,
  period,
  extension,
  comparePeriod = null,
) {
  const safe = String(propertyCode || "Property").replace(/[^a-z0-9]+/gi, "-");
  const stem = (w) => {
    const start = w?.start || "";
    const end = w?.end || "";
    return start && end ? `${start}_${end}` : start;
  };
  const baseline = stem(period);
  const compare = stem(comparePeriod);
  const window = baseline
    ? `-${baseline}${compare && compare !== baseline ? `-vs-${compare}` : ""}`
    : "";
  return `BudgetVariance-${safe}${window}.${extension}`;
}

export function budgetVarianceDatasetKey(propertyCode) {
  return `budget-variance:${propertyCode || ""}`;
}

export function budgetVarianceExportRowCount(exportRows) {
  return (exportRows || []).filter((r) => r && r.kind !== "header").length;
}
