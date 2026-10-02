export const THEME_STORAGE_KEY = "ds-theme";
export const DEFAULT_THEME = "light";
export const SUPPORTED_THEMES = Object.freeze(["light", "dark"]);

export const THEME_META_COLOR = Object.freeze({
  light: "#F9F9FA",
  dark: "#0E1011",
});

export const T = Object.freeze({
  bg: "var(--ds-bg)",
  surface: "var(--ds-surface)",
  surfaceRaised: "var(--ds-surface-raised)",
  inset: "var(--ds-inset)",
  hover: "var(--ds-hover)",
  selected: "var(--ds-selected)",
  border: "var(--ds-border)",
  borderSubtle: "var(--ds-border-subtle)",
  textPrimary: "var(--ds-text-primary)",
  textSecondary: "var(--ds-text-secondary)",
  textTertiary: "var(--ds-text-tertiary)",
  accent: "var(--ds-accent)",
  accentFill: "var(--ds-accent-fill)",
  accentFillText: "var(--ds-accent-fill-text)",
  accentMuted: "var(--ds-accent-muted)",
  focusRing: "var(--ds-focus-ring)",
  successText: "var(--ds-success-text)",
  successDot: "var(--ds-success-dot)",
  successBg: "var(--ds-success-bg)",
  dangerText: "var(--ds-danger-text)",
  dangerDot: "var(--ds-danger-dot)",
  dangerBg: "var(--ds-danger-bg)",
  warningText: "var(--ds-warning-text)",
  warningDot: "var(--ds-warning-dot)",
  warningBg: "var(--ds-warning-bg)",
  infoText: "var(--ds-info-text)",
  infoDot: "var(--ds-info-dot)",
  infoBg: "var(--ds-info-bg)",
  neutralText: "var(--ds-neutral-text)",
  neutralDot: "var(--ds-neutral-dot)",
  neutralBg: "var(--ds-neutral-bg)",
  ai: "var(--ds-ai)",
  shadowCard: "var(--ds-shadow-card)",
  shadowModal: "var(--ds-shadow-modal)",
  scrim: "var(--ds-scrim)",
  font: "var(--ds-font)",
  fontMono: "var(--ds-font-mono)",
  radiusSm: "var(--ds-radius-sm)",
  radius: "var(--ds-radius)",
  radiusLg: "var(--ds-radius-lg)",
  radiusXl: "var(--ds-radius-xl)",
  radiusPill: "var(--ds-radius-pill)",

  textMicro: "var(--ds-text-micro)",
  textDense: "var(--ds-text-dense)",
  textBody: "var(--ds-text-body)",
  textEmphasis: "var(--ds-text-emphasis)",
  textTitle: "var(--ds-text-title)",
  textPage: "var(--ds-text-page)",
  textKpi: "var(--ds-text-kpi)",
  textDisplay: "var(--ds-text-display)",

  space1: "var(--ds-space-1)",
  space2: "var(--ds-space-2)",
  space3: "var(--ds-space-3)",
  space4: "var(--ds-space-4)",
  space5: "var(--ds-space-5)",
  space6: "var(--ds-space-6)",
  space7: "var(--ds-space-7)",
  space8: "var(--ds-space-8)",
  space9: "var(--ds-space-9)",
  space10: "var(--ds-space-10)",
});

export function alpha(tokenVar, pct) {
  if (typeof tokenVar !== "string" || tokenVar.length === 0) {
    return "transparent";
  }
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new TypeError(`alpha(): pct must be 0-100, got ${String(pct)}`);
  }
  return `color-mix(in srgb, ${tokenVar} ${n}%, transparent)`;
}

function defaultStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function defaultDocument() {
  return typeof document !== "undefined" ? document : null;
}

export function getStoredTheme(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const v = storage.getItem(THEME_STORAGE_KEY);
    return SUPPORTED_THEMES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function resolveInitialTheme(storage = defaultStorage()) {
  return getStoredTheme(storage) || DEFAULT_THEME;
}

export function getTheme(doc = defaultDocument()) {
  const v = doc?.documentElement?.getAttribute("data-theme");
  return SUPPORTED_THEMES.includes(v) ? v : DEFAULT_THEME;
}

export function setTheme(
  mode,
  { doc = defaultDocument(), storage = defaultStorage() } = {},
) {
  if (!SUPPORTED_THEMES.includes(mode)) {
    throw new TypeError(`setTheme(): unsupported theme "${String(mode)}"`);
  }
  if (doc?.documentElement) {
    doc.documentElement.setAttribute("data-theme", mode);
    const meta = doc.querySelector?.('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_META_COLOR[mode]);
  }
  try {
    storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {}
  return mode;
}

export function initTheme(opts = {}) {
  return setTheme(resolveInitialTheme(opts.storage), opts);
}

export const SIDEBAR_STORAGE_KEY = "ds-sidebar-collapsed";

export function getStoredSidebarCollapsed(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStoredSidebarCollapsed(
  collapsed,
  storage = defaultStorage(),
) {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {}
  return !!collapsed;
}
