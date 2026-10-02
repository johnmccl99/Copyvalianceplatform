import { buildDeepLink, resolveDeepLink, isReservedPath } from "./deepLinks.js";

export const HOME_NAVIGATION = Object.freeze({
  activeTab: "home",
  sectionLanding: null,
  workspaceSelection: null,
});

function hasNavKey(navItems, key) {
  return Array.isArray(navItems) && navItems.some((i) => i && i.key === key);
}

export function navigationForDeepLink(
  intent,
  { navItems, sectionLabels } = {},
) {
  if (!intent || typeof intent !== "object") return HOME_NAVIGATION;

  if (intent.kind === "nav") {
    return hasNavKey(navItems, intent.navKey)
      ? {
          activeTab: intent.navKey,
          sectionLanding: null,
          workspaceSelection: null,
        }
      : HOME_NAVIGATION;
  }

  if (intent.kind === "module") {
    if (!Array.isArray(sectionLabels) || !sectionLabels.includes(intent.module))
      return HOME_NAVIGATION;
    if (!intent.propertyNavKey) {
      return {
        activeTab: "__section__",
        sectionLanding: intent.module,
        workspaceSelection: null,
      };
    }
    if (!hasNavKey(navItems, intent.propertyNavKey)) return HOME_NAVIGATION;
    return {
      activeTab: "__section__",
      sectionLanding: intent.module,
      workspaceSelection: {
        module: intent.module,
        propertyKey: intent.propertyNavKey,
        view: intent.view || null,
      },
    };
  }

  return HOME_NAVIGATION;
}

export function navigationForPathname(
  pathname,
  { basePath, navItems, role, hiddenModuleKeys, sectionLabels } = {},
) {
  const stripped = stripBasePath(pathname, basePath);
  if (isReservedPath(stripped)) return null;
  const intent = resolveDeepLink(stripped, {
    navItems,
    role,
    hiddenModuleKeys,
  });
  return navigationForDeepLink(intent, { navItems, sectionLabels });
}

export function historyActionForSync({
  first,
  fromPopState,
  currentPath,
  nextPath,
} = {}) {
  if (currentPath === nextPath) return "none";
  return first || fromPopState ? "replace" : "push";
}

export function deepLinkForNavigation({
  activeTab,
  sectionLanding,
  workspaceSelection,
} = {}) {
  if (activeTab === "__section__") {
    if (!sectionLanding) return null;
    const sel =
      workspaceSelection && workspaceSelection.module === sectionLanding
        ? workspaceSelection
        : null;
    return buildDeepLink({
      kind: "module",
      module: sectionLanding,
      view: sel ? sel.view : null,
      propertyNavKey: sel ? sel.propertyKey : null,
    });
  }
  if (typeof activeTab !== "string" || !activeTab) return null;
  return buildDeepLink({ kind: "nav", navKey: activeTab });
}

export function normalizeBasePath(base) {
  if (typeof base !== "string") return "";
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : "/" + trimmed;
}

export function stripBasePath(pathname, base) {
  const prefix = normalizeBasePath(base);
  const p = typeof pathname === "string" && pathname ? pathname : "/";
  if (!prefix) return p;
  if (p === prefix) return "/";
  if (p.startsWith(prefix + "/")) return p.slice(prefix.length);
  return p;
}

export function withBasePath(path, base) {
  const prefix = normalizeBasePath(base);
  if (typeof path !== "string" || !path) return null;
  if (!prefix) return path;
  return path === "/" ? prefix + "/" : prefix + path;
}
