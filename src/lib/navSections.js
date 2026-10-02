import {
  PROPERTY_TAB_STRUCTURE,
  getVisiblePropertyTabs,
} from "./propertyTabRoleGating.js";
import {
  BUDGET_AGENT_SURFACE_HIDDEN,
  VARIANCE_SECONDARY_COMPARISONS_HIDDEN,
} from "./hiddenSurfaces.js";
import { moduleWorkspaceDestinations } from "./moduleWorkspaceViews.js";

export const IN_DEVELOPMENT_LABEL = "Beta";

export const PIPELINE_ACQUISITIONS_NAV_KEY = "pipelineAcquisitions";
export const PIPELINE_DISPOSITIONS_NAV_KEY = "pipelineDispositions";

export const MODULE_WORKSPACE_SURFACE_KEYS = {
  liveRentRolls: "module.liveRentRolls",
  budgetConsolidation: "module.budgetConsolidation",
  varianceAnalysis: "module.varianceAnalysis",
  quarterlyReporting: "module.quarterlyReporting",
};

export const MODULE_WORKSPACE_VIEW_SURFACE_KEYS = {
  "Variance Analysis/variance": "module.varianceAnalysis.variance",
  "Variance Analysis/pyVariance": "module.varianceAnalysis.pyVariance",
  "Variance Analysis/uwVariance": "module.varianceAnalysis.uwVariance",
  "Quarterly Reporting/underwriting": "module.quarterlyReporting.underwriting",
  "Quarterly Reporting/financialStatements":
    "module.quarterlyReporting.financialStatements",
  "Quarterly Reporting/apiReportBuilder":
    "module.quarterlyReporting.apiReportBuilder",
  "Quarterly Reporting/fileStorage": "module.quarterlyReporting.fileStorage",
};

export const PROPERTIES_SECTION_LABEL = "Properties";
export const CURRENT_PORTFOLIO_BUCKET_LABEL = "Current Portfolio";

export const MODULE_LABELS = [
  "Budget Consolidation",
  "Variance Analysis",
  "Live Rent Rolls",
  "Quarterly Reporting",
];

export const HOME_SECTION_LABEL = "Home";

export const SECTION_DIRECT_NAV_KEYS = {
  [HOME_SECTION_LABEL]: "home",
};

export function sectionDirectNavKey(section) {
  if (!section || section.type === "portfolio" || section.type === "grouped")
    return null;
  const key = SECTION_DIRECT_NAV_KEYS[section.label];
  if (!key) return null;
  return (section.items || []).some((i) => i && i.key === key) ? key : null;
}

export const UNKNOWN_ROLE_FALLBACK_NAV_KEYS = [
  "home",
  "alerts",
  "activityTimeline",
  "meetings",
  "myComms",
  "myFileStorage",
  "myCalendar",
  "myRoles",
  "myTasks",
  "myPerformance",
  "myNotes",
  "userGuide",
];

export function buildNavSections({
  properties = [],
  pipeline = [],
  dispositionPipeline = [],
} = {}) {
  return [
    {
      label: HOME_SECTION_LABEL,
      blurb:
        "Where the day starts: what changed, what needs a decision, what is on the calendar.",
      items: [
        { key: "home", label: "Executive Summary" },
        { key: "alerts", label: "Alerts & Notifications" },
        { key: "actions", label: "Action Items" },
        { key: "meetings", label: "Meetings" },
        { key: "activityTimeline", label: "Activity Timeline" },
      ],
    },
    {
      label: "Budget Consolidation",
      blurb:
        "Build the quarterly reforecast, review it property by property, and push it back to Entrata.",
      items: [
        ...(BUDGET_AGENT_SURFACE_HIDDEN
          ? []
          : [{ key: "budgetAgent", label: "Budget Agent" }]),
        { key: "portfolioBudget", label: "Portfolio Budget" },
      ],
      propertyDestinations: [
        ...moduleWorkspaceDestinations("Budget Consolidation", {
          roles: ["gp"],
          surfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.budgetConsolidation,
          viewSurfaceKeys: MODULE_WORKSPACE_VIEW_SURFACE_KEYS,
        }),
      ],
    },
    {
      label: "Variance Analysis",
      blurb: VARIANCE_SECONDARY_COMPARISONS_HIDDEN
        ? "See which accounts are off budget and why. Compare one property's actuals against budget, or scope a set of properties and flag the material misses across them."
        : "See which accounts are off budget and why. Compare one property's actuals against budget, prior year or the underwriting, or scope a set of properties and flag the material misses across them.",
      items: [{ key: "unifiedPortfolioView", label: "Unified Portfolio View" }],
      propertyDestinations: [
        ...moduleWorkspaceDestinations("Variance Analysis", {
          roles: ["gp"],
          surfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.varianceAnalysis,
          viewSurfaceKeys: MODULE_WORKSPACE_VIEW_SURFACE_KEYS,
        }),
      ],
    },
    {
      label: "Live Rent Rolls",
      blurb:
        "Pick a property to open its current adjusted rent roll. Adjustments and version history live right here in the same workspace.",
      items: [],
      propertyDestinations: [
        ...moduleWorkspaceDestinations("Live Rent Rolls", {
          roles: ["gp"],
          surfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.liveRentRolls,
          viewSurfaceKeys: MODULE_WORKSPACE_VIEW_SURFACE_KEYS,
        }),
      ],
    },
    {
      label: "Quarterly Reporting",
      blurb:
        "What the quarterly report is built from: live Entrata dashboards, one property's reconciled data packet, and the files. The Assembler exports that packet as JSON — writing the report itself still happens outside the platform.",
      items: [
        { key: "biDashboards", label: "BI Dashboards" },
        { key: "quarterlyAssembler", label: "Quarterly Assembler" },
        { key: "myFileStorage", label: "File Storage" },
      ],
      propertyDestinations: [
        ...moduleWorkspaceDestinations("Quarterly Reporting", {
          roles: ["gp"],
          surfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
          viewSurfaceKeys: MODULE_WORKSPACE_VIEW_SURFACE_KEYS,
        }),
      ],
    },
    {
      label: "More",
      blurb:
        "The rest of the platform: firm-level surfaces, market research, your own workspace, and help.",
      items: [
        { key: "changeLog", label: "Change Log" },
        { key: "cycleTime", label: "Cycle Time" },
        { key: "cmInvestorRelations", label: "Investor Relations" },
        { key: "cmFundraising", label: "Fund & Fundraising" },
        { key: "cmDebtMarkets", label: "Debt & Lending" },
        { key: "cmEquityMarkets", label: "Equity Markets" },
        { key: "cmTransactions", label: "Transactions & Comps" },
        { key: "cmNews", label: "Industry News" },
        { key: "corporateFinancials", label: "Corporate P&L" },
        { key: "debtDashboard", label: "Debt & Capital" },
        { key: "myRoles", label: "Roles & Responsibilities" },
        { key: "myComms", label: "Communications" },
        { key: "myCalendar", label: "Calendar" },
        { key: "myTasks", label: "Tasks" },
        { key: "myPerformance", label: "Performance & Goals" },
        { key: "myNotes", label: "Notes" },
        { key: "userGuide", label: "User Guide" },
      ],
    },
    {
      label: "Admin Console",
      type: "grouped",
      subGroups: [
        {
          label: "Security & Compliance",
          items: [
            { key: "adminUsers", label: "Users & Access" },
            { key: "adminMfa", label: "Multi-Factor Auth" },
            { key: "adminAuditLog", label: "Audit & Activity" },
            { key: "adminSessions", label: "Sessions & Network" },
            { key: "adminExportControls", label: "Export Controls" },
            { key: "adminVendors", label: "Vendor Risk" },
            { key: "adminSecurityProgram", label: "Security Program" },
            { key: "adminDataPrivacy", label: "Data Privacy" },
          ],
        },
        {
          label: "Platform",
          items: [
            { key: "adminSettings", label: "Settings" },
            { key: "integrationHub", label: "Integrations" },
            { key: "adminNewsFeeds", label: "News Sources" },
            { key: "adminUnderwriting", label: "Underwriting Model Intake" },
            { key: "adminOnboarding", label: "Onboarding" },
            { key: "budgetWorkbookIntake", label: "Budget Workbook Intake" },
          ],
        },
      ],
      get items() {
        return this.subGroups.flatMap((g) => g.items);
      },
    },
    {
      label: IN_DEVELOPMENT_LABEL,
      items: [
        { key: "moduleVisibility", label: "Module Visibility" },
        { key: "usageDashboard", label: "Usage & Time Saved" },
        { key: "dataHealth", label: "Data Health" },
        { key: "portfolioAssumptions", label: "Portfolio Assumptions" },
        { key: "assumptionExplanations", label: "Assumption Explanations" },
      ],
    },
  ];
}

export function isPropertyDestinationRoleVisible(dest, role) {
  if (!dest || !role) return false;
  if (Array.isArray(dest.roles))
    return role === "admin" || dest.roles.includes(role);
  if (!dest.main) return false;
  const mainEntry = getVisiblePropertyTabs(PROPERTY_TAB_STRUCTURE, role).find(
    (t) => t.key === dest.main,
  );
  if (!mainEntry) return false;
  if (!dest.sub) return true;
  return getVisiblePropertyTabs(mainEntry.subTabs || [], role).some(
    (s) => s.key === dest.sub,
  );
}

function plainSectionHasContent(s) {
  return (
    (s.items || []).length > 0 || (s.propertyDestinations || []).length > 0
  );
}

export function filterNavSectionsByAllowlist(sections, allowedKeys, opts = {}) {
  const { role, currentPortfolioOnly = false } = opts;
  const allowed = new Set(allowedKeys);
  return sections
    .map((s) => {
      if (s.type === "portfolio") {
        if (currentPortfolioOnly) {
          const kept = (s.subBuckets || []).filter(
            (b) => b.label === CURRENT_PORTFOLIO_BUCKET_LABEL,
          );
          return { ...s, subBuckets: kept };
        }
        return s;
      }
      if (s.type === "grouped") {
        const subGroups = s.subGroups
          .map((g) => ({
            ...g,
            items: g.items.filter((i) => allowed.has(i.key)),
          }))
          .filter((g) => g.items.length > 0);
        return { ...s, subGroups };
      }
      const next = { ...s, items: s.items.filter((i) => allowed.has(i.key)) };
      if (s.propertyDestinations) {
        next.propertyDestinations = role
          ? s.propertyDestinations.filter((d) =>
              isPropertyDestinationRoleVisible(d, role),
            )
          : s.propertyDestinations;
      }
      return next;
    })
    .filter((s) => {
      if (s.type === "portfolio") {
        return (s.subBuckets || []).some((b) => (b.items || []).length > 0);
      }
      if (s.type === "grouped") return (s.subGroups || []).length > 0;
      return plainSectionHasContent(s);
    });
}

export function isKnownNavRole(role) {
  return role === "admin" || role === "gp";
}

export function filterNavSectionsByRole(sections, role, opts = {}) {
  const { isAdmin = false } = opts;
  if (role === "admin") return sections;
  if (role === "gp") {
    if (isAdmin) return sections;
    return sections.filter((section) => section.label !== "Admin Console");
  }
  const unrecognized =
    typeof role === "string" && role !== "" ? role : "unknown";
  return filterNavSectionsByAllowlist(
    sections,
    UNKNOWN_ROLE_FALLBACK_NAV_KEYS,
    {
      role: unrecognized,
      currentPortfolioOnly: true,
    },
  );
}

export const PROTECTED_SURFACE_KEYS = new Set([
  "adminUsers",
  "adminMfa",
  "adminAuditLog",
  "adminSessions",
  "adminExportControls",
  "adminVendors",
  "adminSecurityProgram",
  "adminDataPrivacy",
]);

export function filterNavSectionsByVisibility(sections, hiddenKeys) {
  const hidden = new Set(
    [...(hiddenKeys || [])].filter((k) => !PROTECTED_SURFACE_KEYS.has(k)),
  );
  if (hidden.size === 0) return sections;
  return sections
    .map((s) => {
      if (s.type === "portfolio") {
        const subBuckets = (s.subBuckets || [])
          .filter((b) => !b.key || !hidden.has(b.key))
          .map((b) => ({
            ...b,
            items: (b.items || []).filter((i) => !hidden.has(i.key)),
          }))
          .filter((b) => (b.items || []).length > 0);
        return { ...s, subBuckets };
      }
      if (s.type === "grouped") {
        const subGroups = s.subGroups
          .map((g) => ({
            ...g,
            items: g.items.filter((i) => !hidden.has(i.key)),
          }))
          .filter((g) => g.items.length > 0);
        return { ...s, subGroups };
      }
      return { ...s, items: s.items.filter((i) => !hidden.has(i.key)) };
    })
    .filter((s) => {
      if (s.type === "portfolio")
        return (s.subBuckets || []).some((b) => (b.items || []).length > 0);
      if (s.type === "grouped") return (s.subGroups || []).length > 0;
      return plainSectionHasContent(s);
    });
}

export function flattenNavItems(sections) {
  const out = [];
  for (const s of sections || []) {
    if (s.type === "portfolio") {
      for (const sb of s.subBuckets || []) {
        for (const i of sb.items || [])
          out.push({ ...i, section: s.label + " > " + sb.label });
      }
    } else if (s.type === "grouped") {
      for (const g of s.subGroups || []) {
        for (const i of g.items || []) out.push({ ...i, section: s.label });
      }
    } else {
      for (const i of s.items || []) out.push({ ...i, section: s.label });
    }
  }
  return out;
}
