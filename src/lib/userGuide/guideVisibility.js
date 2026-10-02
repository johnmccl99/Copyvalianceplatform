import { PROTECTED_SURFACE_KEYS, buildNavSections } from "../navSections.js";
import {
  MAIN_TAB_SURFACE_KEYS,
  SUB_TAB_SURFACE_KEYS,
  GENERATE_REPORT_SURFACE_KEY,
} from "../propertyTabVisibility.js";
import {
  PROPERTY_TAB_STRUCTURE,
  getVisiblePropertyTabs,
} from "../propertyTabRoleGating.js";

const PROPERTY_KEY_PREFIX = "prop.";

export function guideKeyAncestors(key) {
  if (typeof key !== "string" || key.length === 0) return [];
  const parts = key.split(".");
  const out = [];
  for (let i = parts.length; i > 0; i -= 1)
    out.push(parts.slice(0, i).join("."));
  return out;
}

const CURATION_ADDRESSABLE_KEYS = (() => {
  const keys = new Set();
  const sections = buildNavSections({
    properties: [],
    pipeline: [],
    dispositionPipeline: [],
  });
  for (const s of sections) {
    if (s.type === "portfolio") {
      for (const b of s.subBuckets || []) {
        if (b.key) keys.add(b.key);
        for (const i of b.items || []) keys.add(i.key);
      }
    } else if (s.type === "grouped") {
      for (const g of s.subGroups || [])
        for (const i of g.items || []) keys.add(i.key);
    } else {
      for (const i of s.items || []) keys.add(i.key);
    }
  }
  for (const k of Object.values(MAIN_TAB_SURFACE_KEYS)) keys.add(k);
  for (const k of Object.values(SUB_TAB_SURFACE_KEYS)) keys.add(k);
  keys.add(GENERATE_REPORT_SURFACE_KEY);
  for (const k of PROTECTED_SURFACE_KEYS) keys.add(k);
  return keys;
})();

const PROPERTY_TAB_COORDS = (() => {
  const map = new Map();
  for (const [mainKey, surfaceKey] of Object.entries(MAIN_TAB_SURFACE_KEYS)) {
    map.set(surfaceKey, { mainKey, subKey: null });
  }
  for (const [codePath, surfaceKey] of Object.entries(SUB_TAB_SURFACE_KEYS)) {
    const [mainKey, subKey] = codePath.split("/");
    map.set(surfaceKey, { mainKey, subKey });
  }
  return map;
})();

export function isCurationAddressable(key) {
  return guideKeyAncestors(key).some((k) => CURATION_ADDRESSABLE_KEYS.has(k));
}

export function isGuideKeyCuratedAway(key, hiddenKeys) {
  if (!isSetLike(hiddenKeys)) return false;
  if (typeof key !== "string" || key.length === 0) return false;
  if (PROTECTED_SURFACE_KEYS.has(key)) return false;
  return guideKeyAncestors(key).some(
    (k) => hiddenKeys.has(k) && !PROTECTED_SURFACE_KEYS.has(k),
  );
}

export function isPropertyGuideKeyRoleVisible(key, role) {
  const coords = guideKeyAncestors(key)
    .map((k) => PROPERTY_TAB_COORDS.get(k))
    .find(Boolean);
  if (!coords) return false;
  const main = PROPERTY_TAB_STRUCTURE.find((t) => t.key === coords.mainKey);
  if (!main) return false;
  if (getVisiblePropertyTabs([main], role).length === 0) return false;
  if (!coords.subKey) return true;
  const sub = (main.subTabs || []).find((t) => t.key === coords.subKey);
  if (!sub) return false;
  return getVisiblePropertyTabs([sub], role).length > 0;
}

function isSetLike(value) {
  return !!value && typeof value.has === "function";
}

function toNavKeySet(navItems) {
  if (!Array.isArray(navItems)) return null;
  const keys = new Set();
  for (const item of navItems) {
    if (item && typeof item.key === "string") keys.add(item.key);
  }
  return keys;
}

function isGuideKeyVisible(key, ctx) {
  if (typeof key !== "string" || key.length === 0) return false;

  if (isGuideKeyCuratedAway(key, ctx.hidden)) return false;

  if (key.startsWith(PROPERTY_KEY_PREFIX)) {
    if (ctx.role) return isPropertyGuideKeyRoleVisible(key, ctx.role);
    return isCurationAddressable(key);
  }

  if (ctx.navKeys) return ctx.navKeys.has(key);
  if (ctx.hidden) return isCurationAddressable(key);
  return true;
}

export function visibleGuideSurfaces(surfaces, options = {}) {
  if (!Array.isArray(surfaces)) return [];
  const { navItems = null, hiddenNavKeys = null, role = null } = options || {};
  const ctx = {
    navKeys: toNavKeySet(navItems),
    hidden: isSetLike(hiddenNavKeys) ? hiddenNavKeys : null,
    role: typeof role === "string" && role.length > 0 ? role : null,
  };
  if (!ctx.navKeys && !ctx.hidden && !ctx.role) return surfaces;
  return surfaces.filter((s) => isGuideKeyVisible(s && s.key, ctx));
}
