import { TENANT_CRM_SURFACE_HIDDEN } from "./hiddenSurfaces.js";

export const RELATED_PAGES = {
  home: ["alerts", "actions", "investment", "meetings", "scenarioModeler"],
  alerts: ["home", "actions", "asset", "debtDashboard"],
  acquisitions: [
    "scorecards",
    "bovTracker",
    "ddChecklist",
    "submarkets",
    "scenarioModeler",
  ],
  investment: ["holdSellRefi", "fundLifecycle", "waterfall", "scenarioModeler"],
  holdSellRefi: ["investment", "valuations", "scenarioModeler", "capMarkets"],
  asset: [
    ...(TENANT_CRM_SURFACE_HIDDEN ? [] : ["leaseRenewals"]),
    "valuations",
    "capex",
  ],
  ...(TENANT_CRM_SURFACE_HIDDEN
    ? {}
    : { leaseRenewals: ["tenantCRM", "asset", "scenarioModeler"] }),
  debtDashboard: ["debtAmortization", "capMarkets", "scenarioModeler"],
  lpPortal: ["investorCRM", "reporting", "documents"],
  capMarkets: ["submarkets", "debtDashboard", "zoe", "scenarioModeler"],
  scenarioModeler: ["investment", "holdSellRefi", "capMarkets", "waterfall"],
  meetings: ["actions", "myCalendar", "myTasks"],
  capitalStack: [
    "investment",
    "debtDashboard",
    "holdSellRefi",
    "riskDashboard",
  ],
  ...(TENANT_CRM_SURFACE_HIDDEN
    ? {}
    : {
        tenantHealth: ["tenantCRM", "leaseRenewals", "asset", "riskDashboard"],
      }),
  dispositionAnalyzer: [
    "holdSellRefi",
    "capitalStack",
    "waterfall",
    "investment",
  ],
  pipelineAnalytics: ["acquisitions", "dealCRM", "scorecards", "dealRoom"],
  icPackage: ["meetings", "acquisitions", "dispositionAnalyzer"],
};

export function resolveRelatedPages(activeTab, navItems) {
  const related = RELATED_PAGES[activeTab];
  if (!Array.isArray(related) || related.length === 0) return [];
  if (!Array.isArray(navItems)) return [];
  const out = [];
  for (const key of related) {
    const item = navItems.find((i) => i && i.key === key);
    if (item) out.push(item);
  }
  return out;
}
