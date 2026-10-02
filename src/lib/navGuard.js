export const NAV_SENTINEL_KEYS = Object.freeze(["__property__", "__section__"]);

const SENTINELS = new Set(NAV_SENTINEL_KEYS);

export const MAX_NAV_KEY_LENGTH = 256;

export const NAV_DECISION = Object.freeze({
  SENTINEL: "sentinel",
  IN_NAV: "in-nav",
  NO_NAV_INDEX: "no-nav-index",
  INVALID_KEY: "invalid-key",
  NOT_IN_NAV: "not-in-nav",
  NAV_INDEX_REQUIRED: "nav-index-required",
});

export function navKeySet(navItems) {
  const out = new Set();
  if (!Array.isArray(navItems)) return out;
  for (const entry of navItems) {
    if (typeof entry === "string") {
      if (entry) out.add(entry);
      continue;
    }
    if (entry && typeof entry.key === "string" && entry.key) out.add(entry.key);
  }
  return out;
}

function resolveIndex(ctx) {
  const { navKeys, navItems } = ctx;
  if (navKeys && typeof navKeys.has === "function") {
    return typeof navKeys.size === "number" && navKeys.size === 0
      ? null
      : navKeys;
  }
  if (Array.isArray(navKeys)) {
    const built = navKeySet(navKeys);
    return built.size === 0 ? null : built;
  }
  if (navItems && typeof navItems.has === "function") {
    return typeof navItems.size === "number" && navItems.size === 0
      ? null
      : navItems;
  }
  if (Array.isArray(navItems)) {
    const built = navKeySet(navItems);
    return built.size === 0 ? null : built;
  }
  return null;
}

function decision(allowed, reason, key, degraded = false) {
  return { allowed, reason, key, degraded };
}

export function navigationDecision(key, ctx = {}) {
  const context = ctx && typeof ctx === "object" ? ctx : {};

  if (typeof key !== "string")
    return decision(false, NAV_DECISION.INVALID_KEY, null);
  if (key.trim().length === 0)
    return decision(false, NAV_DECISION.INVALID_KEY, null);
  if (key.length > MAX_NAV_KEY_LENGTH)
    return decision(false, NAV_DECISION.INVALID_KEY, null);

  const index = resolveIndex(context);

  if (!index && context.strict === true) {
    return decision(false, NAV_DECISION.NAV_INDEX_REQUIRED, key, true);
  }

  if (SENTINELS.has(key)) return decision(true, NAV_DECISION.SENTINEL, key);

  if (!index) return decision(true, NAV_DECISION.NO_NAV_INDEX, key, true);

  if (index.has(key)) return decision(true, NAV_DECISION.IN_NAV, key);
  return decision(false, NAV_DECISION.NOT_IN_NAV, key);
}

export function canNavigateTo(key, ctx = {}) {
  return navigationDecision(key, ctx).allowed;
}
