import {
  PROTECTED_SURFACE_KEYS,
  PIPELINE_ACQUISITIONS_NAV_KEY,
  PIPELINE_DISPOSITIONS_NAV_KEY,
  MODULE_WORKSPACE_SURFACE_KEYS,
  MODULE_WORKSPACE_VIEW_SURFACE_KEYS,
} from "./navSections.js";
import { PROPERTY_TAB_STRUCTURE } from "./propertyTabRoleGating.js";

export const GENERATE_REPORT_SURFACE_KEY = "prop.generateReport";

export const MAIN_TAB_SURFACE_KEYS = {
  overview: "prop.overview",
  transactions: "prop.transactions",
  assetManagement: "prop.assetMgmt",
  capitalStack: "prop.capitalStack",
  strategy: "prop.strategy",
};

export const SUB_TAB_SURFACE_KEYS = {
  "overview/dashboard": "prop.overview.dashboard",
  "overview/reportingEngine": "prop.overview.reportingEngine",
  "transactions/acquisition": "prop.transactions.acquisition",
  "transactions/refinance": "prop.transactions.refinance",
  "transactions/recapitalization": "prop.transactions.recapitalization",
  "transactions/disposition": "prop.transactions.disposition",
  "assetManagement/leasing": "prop.assetMgmt.leasing",
  "assetManagement/operations": "prop.assetMgmt.operations",
  "assetManagement/incomeExpenses": "prop.assetMgmt.incomeExpenses",
  "assetManagement/capexConstruction": "prop.assetMgmt.capex",
  "capitalStack/stackOverview": "prop.capitalStack.overview",
  "capitalStack/debt": "prop.capitalStack.debt",
  "capitalStack/equity": "prop.capitalStack.equity",
  "strategy/scenarioModeling": "prop.strategy.scenarioModeling",
  "strategy/risk": "prop.strategy.riskDashboard",
  "strategy/taxStrategy": "prop.strategy.taxStrategy",
  "strategy/capMarkets": "prop.strategy.capitalMarkets",
  "strategy/esgGresb": "prop.strategy.esg",
  "strategy/market": "prop.strategy.benchmarking",
};

export const VALIANCE_DEFAULT_HIDDEN_SURFACE_KEYS = [
  "prop.transactions",
  "prop.capitalStack",
  "prop.strategy",
  "prop.assetMgmt.operations",
  "prop.assetMgmt.capex",
  "prop.overview.reportingEngine",
  GENERATE_REPORT_SURFACE_KEY,
  PIPELINE_ACQUISITIONS_NAV_KEY,
  PIPELINE_DISPOSITIONS_NAV_KEY,
];

export const NEVER_HIDEABLE_PROPERTY_TAB_KEYS = new Set(["prop.overview"]);

function isHiddenKey(hiddenSet, key) {
  return (
    key != null &&
    hiddenSet.has(key) &&
    !PROTECTED_SURFACE_KEYS.has(key) &&
    !NEVER_HIDEABLE_PROPERTY_TAB_KEYS.has(key)
  );
}

function normalizeHiddenKeys(hiddenKeys, fnName) {
  if (hiddenKeys == null) return null;
  if (typeof hiddenKeys.has === "function")
    return hiddenKeys.size === 0 ? null : hiddenKeys;
  if (Array.isArray(hiddenKeys))
    return hiddenKeys.length === 0 ? null : new Set(hiddenKeys);
  throw new TypeError(
    fnName +
      ": hiddenKeys must be a Set, an Array, or null/undefined — received " +
      (typeof hiddenKeys === "object" ? "a plain object" : typeof hiddenKeys) +
      ". A malformed curation set is a caller bug, not an uncurated org, and" +
      " must not silently render the full surface area.",
  );
}

function isSetLike(hiddenKeys) {
  return !!hiddenKeys && typeof hiddenKeys.has === "function";
}

export function filterPropertyTabsByVisibility(tabs, hiddenKeys) {
  const list = Array.isArray(tabs) ? tabs : [];
  const hidden = normalizeHiddenKeys(
    hiddenKeys,
    "filterPropertyTabsByVisibility",
  );
  if (!hidden) return list;
  const out = [];
  let changed = false;
  for (const t of list) {
    const mainKey = MAIN_TAB_SURFACE_KEYS[t.key];
    if (isHiddenKey(hidden, mainKey)) {
      changed = true;
      continue;
    }
    const subTabs = Array.isArray(t.subTabs) ? t.subTabs : [];
    if (subTabs.length === 0) {
      out.push(t);
      continue;
    }
    const visibleSubs = subTabs.filter(
      (st) => !isHiddenKey(hidden, SUB_TAB_SURFACE_KEYS[t.key + "/" + st.key]),
    );
    if (visibleSubs.length === 0) {
      if (!NEVER_HIDEABLE_PROPERTY_TAB_KEYS.has(mainKey)) {
        changed = true;
        continue;
      }
      out.push(t);
      continue;
    }
    if (visibleSubs.length === subTabs.length) {
      out.push(t);
      continue;
    }
    changed = true;
    out.push({ ...t, subTabs: visibleSubs });
  }
  return changed ? out : list;
}

export function isPropertyDestHidden(hiddenKeys, mainKey, subKey) {
  const hidden = normalizeHiddenKeys(hiddenKeys, "isPropertyDestHidden");
  if (!hidden) return false;
  if (isHiddenKey(hidden, MAIN_TAB_SURFACE_KEYS[mainKey])) return true;
  if (
    subKey != null &&
    isHiddenKey(hidden, SUB_TAB_SURFACE_KEYS[mainKey + "/" + subKey])
  )
    return true;
  return false;
}

export function isDestinationHidden(hiddenKeys, dest) {
  if (!dest) return false;
  if (!isSetLike(hiddenKeys) || hiddenKeys.size === 0) return false;
  if (dest.viewSurfaceKey && isHiddenKey(hiddenKeys, dest.viewSurfaceKey))
    return true;
  if (dest.surfaceKey) return isHiddenKey(hiddenKeys, dest.surfaceKey);
  return isPropertyDestHidden(hiddenKeys, dest.main, dest.sub);
}

export function isModuleViewHidden(hiddenKeys, moduleLabel, viewKey) {
  if (!isSetLike(hiddenKeys) || hiddenKeys.size === 0) return false;
  return isHiddenKey(
    hiddenKeys,
    MODULE_WORKSPACE_VIEW_SURFACE_KEYS[moduleLabel + "/" + viewKey],
  );
}

export function filterNavSectionDestinationsByVisibility(sections, hiddenKeys) {
  if (!Array.isArray(sections)) return [];
  if (!isSetLike(hiddenKeys) || hiddenKeys.size === 0) return sections;
  return sections
    .map((s) => {
      if (!Array.isArray(s.propertyDestinations)) return s;
      return {
        ...s,
        propertyDestinations: s.propertyDestinations.filter(
          (d) => !isDestinationHidden(hiddenKeys, d),
        ),
      };
    })
    .filter((s) => {
      if (!Array.isArray(s.propertyDestinations)) return true;
      return (s.items || []).length > 0 || s.propertyDestinations.length > 0;
    });
}

export function isGenerateReportHidden(hiddenKeys) {
  const hidden = normalizeHiddenKeys(hiddenKeys, "isGenerateReportHidden");
  return !!hidden && isHiddenKey(hidden, GENERATE_REPORT_SURFACE_KEY);
}

function buildPropertyTabPanelGroups() {
  const groups = [];
  const mainItems = PROPERTY_TAB_STRUCTURE.filter(
    (t) => MAIN_TAB_SURFACE_KEYS[t.key],
  ).map((t) => ({ key: MAIN_TAB_SURFACE_KEYS[t.key], label: t.label }));
  if (mainItems.length)
    groups.push({ label: "Property Pages — Tabs", items: mainItems });
  for (const t of PROPERTY_TAB_STRUCTURE) {
    const subItems = (t.subTabs || [])
      .filter((st) => SUB_TAB_SURFACE_KEYS[t.key + "/" + st.key])
      .map((st) => ({
        key: SUB_TAB_SURFACE_KEYS[t.key + "/" + st.key],
        label: st.label,
      }));
    if (subItems.length) {
      groups.push({
        label: "Property Pages — " + t.label + " Sub-Tabs",
        items: subItems,
      });
    }
  }
  groups.push({
    label: "Property Pages — Controls",
    items: [
      {
        key: GENERATE_REPORT_SURFACE_KEY,
        label: "Generate Report button (Export This View)",
      },
    ],
  });
  groups.push({
    label: "Module Workspaces",
    items: [
      {
        key: MODULE_WORKSPACE_SURFACE_KEYS.liveRentRolls,
        label: "Live Rent Rolls — property destination",
      },
      {
        key: MODULE_WORKSPACE_SURFACE_KEYS.budgetConsolidation,
        label: "Budget Consolidation — property destination",
      },
      {
        key: MODULE_WORKSPACE_SURFACE_KEYS.varianceAnalysis,
        label: "Variance Analysis — property destination",
      },
      {
        key: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
        label: "Quarterly Reporting — property destination",
      },
    ],
  });
  groups.push({
    label: "Module Workspaces — Quarterly Reporting Views",
    items: [
      {
        key: MODULE_WORKSPACE_VIEW_SURFACE_KEYS[
          "Quarterly Reporting/underwriting"
        ],
        label: "Underwriting Model",
      },
      {
        key: MODULE_WORKSPACE_VIEW_SURFACE_KEYS[
          "Quarterly Reporting/financialStatements"
        ],
        label: "Financial Statements",
      },
      {
        key: MODULE_WORKSPACE_VIEW_SURFACE_KEYS[
          "Quarterly Reporting/apiReportBuilder"
        ],
        label: "API Report Builder",
      },
      {
        key: MODULE_WORKSPACE_VIEW_SURFACE_KEYS[
          "Quarterly Reporting/fileStorage"
        ],
        label: "File Storage",
      },
    ],
  });
  groups.push({
    label: "Module Workspaces — Variance Analysis Views",
    items: [
      {
        key: MODULE_WORKSPACE_VIEW_SURFACE_KEYS["Variance Analysis/variance"],
        label: "Budget Analysis",
      },
      {
        key: MODULE_WORKSPACE_VIEW_SURFACE_KEYS["Variance Analysis/pyVariance"],
        label: "Prior-Year Variance",
      },
      {
        key: MODULE_WORKSPACE_VIEW_SURFACE_KEYS["Variance Analysis/uwVariance"],
        label: "Underwriting Variance",
      },
    ],
  });
  groups.push({
    label: "Properties Nav",
    items: [
      { key: PIPELINE_ACQUISITIONS_NAV_KEY, label: "Active Acquisitions" },
      { key: PIPELINE_DISPOSITIONS_NAV_KEY, label: "Active Dispositions" },
    ],
  });
  return groups;
}

export const PROPERTY_TAB_PANEL_GROUPS = buildPropertyTabPanelGroups();
