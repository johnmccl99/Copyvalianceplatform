export const EVENT_TYPES = Object.freeze({
  SURFACE_VIEW: "surface_view",
  ACTION: "action",
  EXPORT: "export",
  SESSION_START: "session_start",
});

export const ALLOWED_EVENT_TYPES = Object.freeze(Object.values(EVENT_TYPES));

export const ALLOWED_ACTOR_ROLES = Object.freeze(["gp", "gp_admin", "admin"]);

export const SURFACE_KEYS = Object.freeze({
  COMMAND_CENTER: "command_center",

  PROPERTY_OVERVIEW: "property.overview_dashboard",
  PROPERTY_UNDERWRITING_MODEL: "property.underwriting_model",
  PROPERTY_LIVE_RENT_ROLL: "property.live_rent_roll",
  PROPERTY_INCOME_EXPENSES: "property.income_expenses",
  PROPERTY_BUDGET_ANALYSIS: "property.budget_analysis",

  BI_PORTFOLIO_OCCUPANCY: "bi_dashboards.portfolio_occupancy",
  BI_LEASE_EXPIRATION: "bi_dashboards.lease_expiration",
  BI_WORK_ORDERS: "bi_dashboards.work_orders",

  RENT_ROLL_ADJUSTMENTS: "rent_roll.adjustments",
  RENT_ROLL_SIGNOFF: "rent_roll.signoff",

  INVESTOR_PORTAL_HOME: "investor.portal_home",
  INVESTOR_DOCUMENTS: "investor.documents",
  INVESTOR_DISTRIBUTIONS: "investor.distributions",
  INVESTOR_STATEMENTS: "investor.statements",
});

export function biSurfaceKey(subtabKey) {
  if (typeof subtabKey !== "string" || !subtabKey) return null;
  const norm = subtabKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return norm ? `bi_dashboards.${norm}` : null;
}

export const SURFACE_LABELS = Object.freeze({
  [SURFACE_KEYS.COMMAND_CENTER]: "Home",
  [SURFACE_KEYS.PROPERTY_OVERVIEW]: "Property — Overview",
  [SURFACE_KEYS.PROPERTY_UNDERWRITING_MODEL]: "Property — Underwriting Model",
  [SURFACE_KEYS.PROPERTY_LIVE_RENT_ROLL]: "Property — Live Rent Roll",
  [SURFACE_KEYS.PROPERTY_INCOME_EXPENSES]: "Property — Income & Expenses",
  [SURFACE_KEYS.PROPERTY_BUDGET_ANALYSIS]: "Property — Budget Analysis",
  [SURFACE_KEYS.BI_PORTFOLIO_OCCUPANCY]: "BI — Portfolio Occupancy",
  [SURFACE_KEYS.BI_LEASE_EXPIRATION]: "BI — Lease Expiration",
  [SURFACE_KEYS.BI_WORK_ORDERS]: "BI — Work Orders",
  [SURFACE_KEYS.RENT_ROLL_ADJUSTMENTS]: "Rent Roll — Adjustments",
  [SURFACE_KEYS.RENT_ROLL_SIGNOFF]: "Rent Roll — Sign-Off",
  [SURFACE_KEYS.INVESTOR_PORTAL_HOME]: "Investor Portal — Home",
  [SURFACE_KEYS.INVESTOR_DOCUMENTS]: "Investor Portal — Documents",
  [SURFACE_KEYS.INVESTOR_DISTRIBUTIONS]: "Investor Portal — Distributions",
  [SURFACE_KEYS.INVESTOR_STATEMENTS]: "Investor Portal — Statements",
});

export const ACTION_KEYS = Object.freeze({
  VIEW: "view",
  APPLY_ADJUSTMENT: "apply_adjustment",
  EDIT_ADJUSTMENT: "edit_adjustment",
  DELETE_ADJUSTMENT: "delete_adjustment",
  SIGN_OFF: "sign_off",
  CAPTURE_VERSION: "capture_version",
  LOCK_VERSION: "lock_version",
  EXPORT_CSV: "export_csv",
  ROLLUP: "rollup",
});

export const LP_SURFACE_KEYS = Object.freeze([
  SURFACE_KEYS.INVESTOR_PORTAL_HOME,
  SURFACE_KEYS.INVESTOR_DOCUMENTS,
  SURFACE_KEYS.INVESTOR_DISTRIBUTIONS,
  SURFACE_KEYS.INVESTOR_STATEMENTS,
]);

export function isLpSurfaceKey(surfaceKey) {
  return LP_SURFACE_KEYS.includes(surfaceKey);
}

export function surfaceLabel(surfaceKey) {
  return SURFACE_LABELS[surfaceKey] || surfaceKey || "(unknown surface)";
}

function snake(s) {
  if (typeof s !== "string") return null;
  const n = s
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return n || null;
}

const NAV_KEY_OVERRIDES = {
  home: SURFACE_KEYS.COMMAND_CENTER,
};

export function navSurfaceKey(navKey) {
  if (NAV_KEY_OVERRIDES[navKey]) return NAV_KEY_OVERRIDES[navKey];
  const s = snake(navKey);
  return s ? `nav.${s}` : null;
}

const PROPERTY_TAB_OVERRIDES = {
  "overview|dashboard": SURFACE_KEYS.PROPERTY_OVERVIEW,
  "overview|reportingEngine": SURFACE_KEYS.PROPERTY_UNDERWRITING_MODEL,
  "assetManagement|leasing": SURFACE_KEYS.PROPERTY_LIVE_RENT_ROLL,
  "assetManagement|incomeExpenses": SURFACE_KEYS.PROPERTY_INCOME_EXPENSES,
  "budget|analysis": SURFACE_KEYS.PROPERTY_BUDGET_ANALYSIS,
};

export function propertySurfaceKey(mainTab, subTab) {
  const override = PROPERTY_TAB_OVERRIDES[`${mainTab}|${subTab}`];
  if (override) return override;
  const m = snake(mainTab);
  const s = snake(subTab);
  if (m && s) return `property.${m}_${s}`;
  if (m) return `property.${m}`;
  return null;
}
