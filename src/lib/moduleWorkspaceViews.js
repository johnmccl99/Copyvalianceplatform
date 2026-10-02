import {
  ENTRATA_WRITEBACK_TAB_HIDDEN,
  ITEMIZED_EDITOR_TAB_HIDDEN,
  VARIANCE_SECONDARY_COMPARISONS_HIDDEN,
} from "./hiddenSurfaces.js";

export const MODULE_WORKSPACE_VIEWS = {
  "Budget Consolidation": [
    {
      key: "analysis",
      destinationKey: "propertyBudget",
      label: "Budget & Forecast",
      blurb:
        "The month-by-month statement for one property, with Entrata actuals blended in through the last closed month. Each GL account opens an editing card in place, and the Entrata send opens as a drawer over it.",
    },
    ...(ITEMIZED_EDITOR_TAB_HIDDEN
      ? []
      : [
          {
            key: "editor",
            label: "Itemized Editor (line level)",
            blurb:
              "The stored budget lines themselves \u2014 one row per line \u2014 for pasting a block out of a workbook, selecting across accounts, and editing a single line against its neighbours. Account-level add, delete and monthly-amount paste live on Budget & Forecast.",
          },
        ]),
    ...(ENTRATA_WRITEBACK_TAB_HIDDEN
      ? []
      : [
          {
            key: "writeback",
            label: "Entrata Writeback",
            blurb:
              "Send the finished budget back to Entrata. The same send also opens as a drawer on Budget & Forecast.",
          },
        ]),
  ],

  "Live Rent Rolls": [
    {
      key: "liveRentRoll",
      label: "Live Rent Roll",
      blurb:
        "The current rent roll from Entrata, with the standard corrections applied. Adjust a lease in place and capture a dated version from the same page.",
    },
  ],

  "Variance Analysis": [
    {
      key: "variance",
      destinationKey: "propertyVariance",
      label: "Budget Analysis",
      blurb:
        "Actuals against budget for every account, drillable to the month, with the arithmetic and its sources shown. Journal-line detail lives in Entrata.",
    },
    ...(VARIANCE_SECONDARY_COMPARISONS_HIDDEN
      ? []
      : [
          {
            key: "pyVariance",
            label: "Prior-Year Variance",
            blurb: "This year against last year, account by account.",
          },
          {
            key: "uwVariance",
            label: "Underwriting Variance",
            blurb:
              "Actuals against the assumptions the deal was underwritten on.",
          },
        ]),
  ],

  "Quarterly Reporting": [
    {
      key: "underwriting",
      destinationKey: "propertyUnderwriting",
      label: "Underwriting Model",
      blurb:
        "The property's underwriting assumptions — the original-model side of the quarterly comparison.",
    },
    {
      key: "financialStatements",
      label: "Financial Statements",
      blurb:
        "The property's income statement for a month or a range of months.",
    },
    {
      key: "apiReportBuilder",
      label: "API Report Builder",
      blurb: "Build a report straight off the Entrata API for one property.",
    },
    {
      key: "fileStorage",
      label: "Property Documents",
      blurb: "The documents and files stored for this property.",
    },
  ],
};

export function moduleWorkspaceViewMeta(moduleLabel) {
  return MODULE_WORKSPACE_VIEWS[moduleLabel] || null;
}

export function moduleWorkspaceDestinations(
  moduleLabel,
  { roles, surfaceKey, viewSurfaceKeys } = {},
) {
  const views = MODULE_WORKSPACE_VIEWS[moduleLabel];
  if (!views) return [];
  return views.map((v) => {
    const viewSurfaceKey = viewSurfaceKeys
      ? viewSurfaceKeys[moduleLabel + "/" + v.key]
      : undefined;
    return {
      key: v.destinationKey || v.key,
      label: v.label,
      blurb: v.blurb,
      roles: v.roles || roles,
      surfaceKey: v.surfaceKey || surfaceKey,
      ...(viewSurfaceKey ? { viewSurfaceKey } : {}),
      view: v.key,
    };
  });
}
