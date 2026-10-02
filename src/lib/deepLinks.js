import {
  PROPERTY_TAB_STRUCTURE,
  getVisiblePropertyTabs,
} from "./propertyTabRoleGating.js";
import {
  filterPropertyTabsByVisibility,
  isPropertyDestHidden,
  isDestinationHidden,
  isModuleViewHidden,
} from "./propertyTabVisibility.js";
import { MODULE_WORKSPACE_SURFACE_KEYS } from "./navSections.js";

export const RESERVED_PATH_PREFIXES = ["/auth", "/.netlify", "/assets"];

const MAX_PATH_LENGTH = 512;
const MAX_SEGMENTS = 8;

export const PROPERTY_NAV_KEY_PREFIX = "prop_";

export function propertyNavKeyFromName(name) {
  return (
    PROPERTY_NAV_KEY_PREFIX +
    String(name || "")
      .replace(/\s+/g, "-")
      .toLowerCase()
  );
}

export function propertySlugFromName(name) {
  return propertyNavKeyFromName(name).slice(PROPERTY_NAV_KEY_PREFIX.length);
}

export const DEEP_LINK_SURFACES = [
  { slug: "", kind: "nav", navKey: "home", label: "Home" },
  {
    slug: "portfolio/unified",
    kind: "nav",
    navKey: "unifiedPortfolioView",
    label: "Unified Portfolio View",
  },
  {
    slug: "portfolio/budget",
    kind: "nav",
    navKey: "portfolioBudget",
    label: "Portfolio Budget",
  },
  { slug: "bi", kind: "nav", navKey: "biDashboards", label: "BI Dashboards" },

  {
    slug: "rent-rolls",
    kind: "module",
    module: "Live Rent Rolls",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.liveRentRolls,
    label: "Live Rent Rolls",
  },
  {
    slug: "rent-rolls/:slug",
    kind: "module",
    module: "Live Rent Rolls",
    view: "liveRentRoll",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.liveRentRolls,
    label: "Live Rent Rolls > Property",
    quickAccess: true,
  },
  {
    slug: "property/:slug/rent-roll",
    kind: "module",
    module: "Live Rent Rolls",
    view: "liveRentRoll",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.liveRentRolls,
    aliasFor: "rent-rolls/:slug",
    label: "Live Rent Rolls > Property (moved from Asset Management > Leasing)",
  },

  {
    slug: "budget",
    kind: "module",
    module: "Budget Consolidation",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.budgetConsolidation,
    label: "Budget Consolidation",
  },
  {
    slug: "budget/:slug",
    kind: "module",
    module: "Budget Consolidation",
    view: "analysis",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.budgetConsolidation,
    label: "Budget Consolidation > Property",
    quickAccess: true,
  },
  {
    slug: "property/:slug/budget",
    kind: "module",
    module: "Budget Consolidation",
    view: "analysis",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.budgetConsolidation,
    aliasFor: "budget/:slug",
    label: "Budget Consolidation > Property (moved from Budget > Analysis)",
  },

  {
    slug: "variance",
    kind: "module",
    module: "Variance Analysis",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.varianceAnalysis,
    label: "Variance Analysis",
  },
  {
    slug: "variance/:slug",
    kind: "module",
    module: "Variance Analysis",
    view: "variance",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.varianceAnalysis,
    label: "Variance Analysis > Property",
    quickAccess: true,
  },
  {
    slug: "property/:slug/budget/variance",
    kind: "module",
    module: "Variance Analysis",
    view: "variance",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.varianceAnalysis,
    aliasFor: "variance/:slug",
    label: "Variance Analysis > Property (moved from Budget > Budget Variance)",
  },

  {
    slug: "property/:slug",
    kind: "property",
    main: "overview",
    sub: "dashboard",
    label: "Overview > Dashboard",
  },
  {
    slug: "property/:slug/underwriting",
    kind: "module",
    module: "Quarterly Reporting",
    view: "underwriting",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
    aliasFor: "quarterly-reporting/:slug",
    label:
      "Quarterly Reporting > Underwriting Model (moved from Overview > Underwriting Model)",
  },
  {
    slug: "quarterly-reporting",
    kind: "module",
    module: "Quarterly Reporting",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
    label: "Quarterly Reporting",
  },
  {
    slug: "quarterly-reporting/:slug",
    kind: "module",
    module: "Quarterly Reporting",
    view: "underwriting",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
    label: "Quarterly Reporting > Property",
    quickAccess: true,
  },
  {
    slug: "quarterly-reporting/:slug/financial-statements",
    kind: "module",
    module: "Quarterly Reporting",
    view: "financialStatements",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
    label: "Quarterly Reporting > Property > Financial Statements",
  },
  {
    slug: "quarterly-reporting/:slug/report-builder",
    kind: "module",
    module: "Quarterly Reporting",
    view: "apiReportBuilder",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
    label: "Quarterly Reporting > Property > API Report Builder",
  },
  {
    slug: "quarterly-reporting/:slug/documents",
    kind: "module",
    module: "Quarterly Reporting",
    view: "fileStorage",
    gateRoles: ["gp"],
    gateSurfaceKey: MODULE_WORKSPACE_SURFACE_KEYS.quarterlyReporting,
    label: "Quarterly Reporting > Property > Property Documents",
  },
  {
    slug: "property/:slug/income-expenses",
    kind: "property",
    main: "assetManagement",
    sub: "incomeExpenses",
    label: "Asset Management > Income & Expenses",
    quickAccess: true,
  },
];

const PROPERTY_TEMPLATES = DEEP_LINK_SURFACES.filter(
  (s) => s.kind === "property",
)
  .map((s) => ({ ...s, tail: s.slug.replace(/^property\/:slug\/?/, "") }))
  .sort((a, b) => b.tail.length - a.tail.length);

const NAV_BY_SLUG = new Map(
  DEEP_LINK_SURFACES.filter((s) => s.kind === "nav").map((s) => [s.slug, s]),
);

const MODULE_STATIC_BY_SLUG = new Map(
  DEEP_LINK_SURFACES.filter(
    (s) => s.kind === "module" && !s.slug.includes(":slug"),
  ).map((s) => [s.slug, s]),
);
const MODULE_PROPERTY_TEMPLATES = DEEP_LINK_SURFACES.filter(
  (s) => s.kind === "module" && s.slug.includes(":slug"),
).map((s) => ({ ...s, parts: s.slug.split("/") }));

export function isReservedPath(pathname) {
  if (typeof pathname !== "string") return true;
  const p = pathname.toLowerCase();
  return RESERVED_PATH_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix + "/"),
  );
}

function safeSegments(pathname) {
  if (typeof pathname !== "string") return null;
  if (pathname.length > MAX_PATH_LENGTH) return null;
  if (pathname.includes("\0")) return null;

  const raw = pathname.split("?")[0].split("#")[0];
  const parts = raw.split("/").filter((s) => s.length > 0);
  if (parts.length > MAX_SEGMENTS) return null;

  const out = [];
  for (const part of parts) {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (decoded === "." || decoded === "..") return null;
    if (decoded.includes("\0")) return null;
    if (/[\u0000-\u001F\u007F]/.test(decoded)) return null;
    if (decoded.trim().length === 0) return null;
    out.push(decoded);
  }
  return out;
}

function navKeyIsVisible(navKey, navItems) {
  if (!Array.isArray(navItems)) return false;
  return navItems.some((i) => i && i.key === navKey);
}

export function isModuleEntryReachable(entry, role, hiddenModuleKeys) {
  if (!entry || !role) return false;
  if (!Array.isArray(entry.gateRoles)) {
    return isPropertyDestReachable(
      entry.gateMain,
      entry.gateSub,
      role,
      hiddenModuleKeys,
    );
  }
  if (
    isDestinationHidden(hiddenModuleKeys, { surfaceKey: entry.gateSurfaceKey })
  )
    return false;
  if (
    entry.view &&
    isModuleViewHidden(hiddenModuleKeys, entry.module, entry.view)
  )
    return false;
  return role === "admin" || entry.gateRoles.includes(role);
}

export function isPropertyDestReachable(main, sub, role, hiddenModuleKeys) {
  if (!main || !sub || !role) return false;
  if (isPropertyDestHidden(hiddenModuleKeys, main, sub)) return false;

  const visibleStructure = filterPropertyTabsByVisibility(
    PROPERTY_TAB_STRUCTURE,
    hiddenModuleKeys,
  );
  const visibleMains = getVisiblePropertyTabs(visibleStructure, role);
  const mainEntry = visibleMains.find((t) => t.key === main);
  if (!mainEntry) return false;

  const subs = mainEntry.subTabs || [];
  if (subs.length === 0) return false;
  return getVisiblePropertyTabs(subs, role).some((s) => s.key === sub);
}

export function resolveDeepLink(pathname, ctx) {
  const { navItems, role, hiddenModuleKeys } = ctx || {};
  if (!Array.isArray(navItems)) return null;
  if (isReservedPath(pathname)) return null;

  const segments = safeSegments(pathname);
  if (segments === null) return null;

  const joined = segments.join("/");
  const navEntry = NAV_BY_SLUG.get(joined);
  if (navEntry) {
    return navKeyIsVisible(navEntry.navKey, navItems)
      ? { kind: "nav", navKey: navEntry.navKey }
      : null;
  }

  const moduleEntry = MODULE_STATIC_BY_SLUG.get(joined);
  if (moduleEntry) {
    return isModuleEntryReachable(moduleEntry, role, hiddenModuleKeys)
      ? {
          kind: "module",
          module: moduleEntry.module,
          view: moduleEntry.view || null,
          propertyNavKey: null,
          propertySlug: null,
        }
      : null;
  }
  for (const t of MODULE_PROPERTY_TEMPLATES) {
    if (t.parts.length !== segments.length) continue;
    let slugSeg = null;
    let matched = true;
    for (let i = 0; i < t.parts.length; i++) {
      if (t.parts[i] === ":slug") slugSeg = segments[i];
      else if (t.parts[i] !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (!matched || !slugSeg) continue;
    const modulePropertyNavKey =
      PROPERTY_NAV_KEY_PREFIX + slugSeg.toLowerCase();
    if (!navKeyIsVisible(modulePropertyNavKey, navItems)) return null;
    if (!isModuleEntryReachable(t, role, hiddenModuleKeys)) return null;
    return {
      kind: "module",
      module: t.module,
      view: t.view || null,
      propertyNavKey: modulePropertyNavKey,
      propertySlug: slugSeg.toLowerCase(),
    };
  }

  if (segments[0] !== "property") return null;
  const propertySlug = segments[1];
  if (!propertySlug) return null;

  const tail = segments.slice(2).join("/");
  const template = PROPERTY_TEMPLATES.find((t) => t.tail === tail);
  if (!template) return null;

  const propertyNavKey = PROPERTY_NAV_KEY_PREFIX + propertySlug.toLowerCase();
  if (!navKeyIsVisible(propertyNavKey, navItems)) return null;

  if (
    !isPropertyDestReachable(
      template.main,
      template.sub,
      role,
      hiddenModuleKeys,
    )
  )
    return null;

  return {
    kind: "property",
    navKey: "__property__",
    propertyNavKey,
    propertySlug: propertySlug.toLowerCase(),
    main: template.main,
    sub: template.sub,
    inner: template.inner || null,
  };
}

export function buildDeepLink(intent) {
  if (!intent || typeof intent !== "object") return null;

  if (intent.kind === "nav") {
    const entry = DEEP_LINK_SURFACES.find(
      (s) => s.kind === "nav" && s.navKey === intent.navKey,
    );
    if (!entry) return null;
    return "/" + entry.slug;
  }

  if (intent.kind === "module") {
    const canonical = DEEP_LINK_SURFACES.filter(
      (s) => s.kind === "module" && s.module === intent.module && !s.aliasFor,
    );
    const slug =
      intent.propertySlug ||
      (intent.propertyNavKey || "").slice(PROPERTY_NAV_KEY_PREFIX.length);
    if (slug) {
      const templates = canonical.filter((s) => s.slug.includes(":slug"));
      const t = intent.view
        ? templates.find((s) => s.view === intent.view)
        : templates.find((s) => s.quickAccess) || templates[0];
      return t ? "/" + t.slug.replace(":slug", encodeURIComponent(slug)) : null;
    }
    const st = canonical.find((s) => !s.slug.includes(":slug"));
    return st ? "/" + st.slug : null;
  }

  if (intent.kind === "property") {
    const slug =
      intent.propertySlug ||
      (intent.propertyNavKey || "").slice(PROPERTY_NAV_KEY_PREFIX.length);
    if (!slug) return null;

    const template = PROPERTY_TEMPLATES.find(
      (t) => t.main === intent.main && t.sub === intent.sub,
    );
    if (!template) return null;

    const base = "/property/" + encodeURIComponent(slug);
    return template.tail ? base + "/" + template.tail : base;
  }

  return null;
}

export function findSlugCollisions(names) {
  if (!Array.isArray(names)) return [];
  const bySlug = new Map();
  for (const name of names) {
    const slug = propertySlugFromName(name);
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(name);
  }
  return [...bySlug.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([slug, group]) => ({ slug, names: group }));
}
