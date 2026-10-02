export const VARIANCE_ALERT_BASES = Object.freeze(["ytd", "monthly"]);

export const VARIANCE_ALERT_DEFAULTS = Object.freeze({
  groupPctThreshold: 5,
  accountPctThreshold: 10,
  enabled: true,
  eligibleRoles: Object.freeze(["gp", "gp_admin"]),
  alertBasis: "ytd",
  accountDollarFloor: 2500,
  groupDollarFloor: 5000,
});

const DASHBOARD_AND_EVALUATOR = Object.freeze(["dashboard", "evaluator"]);
const EVALUATOR_ONLY = Object.freeze(["evaluator"]);

export const VARIANCE_ALERT_KEY_CONSUMERS = Object.freeze({
  groupPctThreshold: DASHBOARD_AND_EVALUATOR,
  accountPctThreshold: DASHBOARD_AND_EVALUATOR,
  enabled: EVALUATOR_ONLY,
  eligibleRoles: EVALUATOR_ONLY,
  alertBasis: EVALUATOR_ONLY,
  accountDollarFloor: EVALUATOR_ONLY,
  groupDollarFloor: EVALUATOR_ONLY,
});

export const VARIANCE_ALERT_CONFIG_FIELDS = Object.freeze([
  Object.freeze({
    key: "groupPctThreshold",
    label: "Group percentage threshold",
    consumers: VARIANCE_ALERT_KEY_CONSUMERS.groupPctThreshold,
  }),
  Object.freeze({
    key: "accountPctThreshold",
    label: "Account percentage threshold",
    consumers: VARIANCE_ALERT_KEY_CONSUMERS.accountPctThreshold,
  }),
  Object.freeze({
    key: "enabled",
    label: "Alerts enabled",
    consumers: VARIANCE_ALERT_KEY_CONSUMERS.enabled,
  }),
  Object.freeze({
    key: "eligibleRoles",
    label: "Eligible roles",
    consumers: VARIANCE_ALERT_KEY_CONSUMERS.eligibleRoles,
  }),
  Object.freeze({
    key: "alertBasis",
    label: "Alert basis",
    consumers: VARIANCE_ALERT_KEY_CONSUMERS.alertBasis,
  }),
  Object.freeze({
    key: "accountDollarFloor",
    label: "Account dollar floor",
    consumers: VARIANCE_ALERT_KEY_CONSUMERS.accountDollarFloor,
  }),
  Object.freeze({
    key: "groupDollarFloor",
    label: "Group dollar floor",
    consumers: VARIANCE_ALERT_KEY_CONSUMERS.groupDollarFloor,
  }),
]);

export const INTERNAL_ALERT_ROLES = Object.freeze(["admin", "gp", "gp_admin"]);

function resolveThreshold(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveFloor(value, fallback) {
  if (typeof value === "string" && value.trim() === "") return fallback;
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function resolveBasis(value, fallback) {
  return typeof value === "string" && VARIANCE_ALERT_BASES.includes(value)
    ? value
    : fallback;
}

export function resolveVarianceAlertConfig(settings) {
  const raw =
    settings && typeof settings === "object" ? settings.varianceAlerts : null;
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  const roles = Array.isArray(cfg.eligibleRoles)
    ? cfg.eligibleRoles
        .filter((r) => typeof r === "string" && r.trim() !== "")
        .map((r) => r.trim())
    : null;

  return {
    groupPctThreshold: resolveThreshold(
      cfg.groupPctThreshold,
      VARIANCE_ALERT_DEFAULTS.groupPctThreshold,
    ),
    accountPctThreshold: resolveThreshold(
      cfg.accountPctThreshold,
      VARIANCE_ALERT_DEFAULTS.accountPctThreshold,
    ),
    enabled: cfg.enabled !== false,
    eligibleRoles:
      roles && roles.length
        ? roles
        : [...VARIANCE_ALERT_DEFAULTS.eligibleRoles],
    alertBasis: resolveBasis(
      cfg.alertBasis,
      VARIANCE_ALERT_DEFAULTS.alertBasis,
    ),
    accountDollarFloor: resolveFloor(
      cfg.accountDollarFloor,
      VARIANCE_ALERT_DEFAULTS.accountDollarFloor,
    ),
    groupDollarFloor: resolveFloor(
      cfg.groupDollarFloor,
      VARIANCE_ALERT_DEFAULTS.groupDollarFloor,
    ),
    usedDefaults: !(raw && typeof raw === "object" && !Array.isArray(raw)),
  };
}

export function resolveVarianceAlertProvenance(platformSettings) {
  const row =
    platformSettings &&
    typeof platformSettings === "object" &&
    !Array.isArray(platformSettings)
      ? platformSettings
      : null;
  const settings = row?.settings;
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings.varianceAlerts
      : null;
  const configured = !!(raw && typeof raw === "object" && !Array.isArray(raw));

  return {
    configured,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export function validateVarianceAlertForm(form) {
  const f = form || {};
  const errors = {};
  const num = (v) =>
    typeof v === "number" ? v : Number(String(v ?? "").trim());

  for (const key of ["groupPctThreshold", "accountPctThreshold"]) {
    const n = num(f[key]);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) {
      errors[key] = "Enter a percentage greater than 0 and at most 1000.";
    }
  }
  for (const key of ["accountDollarFloor", "groupDollarFloor"]) {
    const n = num(f[key]);
    if (!Number.isFinite(n) || n < 0) {
      errors[key] =
        "Enter a dollar amount of 0 or more (0 disables the floor).";
    }
  }
  if (!VARIANCE_ALERT_BASES.includes(f.alertBasis)) {
    errors.alertBasis = "Choose YTD or monthly.";
  }
  const roles = Array.isArray(f.eligibleRoles) ? f.eligibleRoles : [];
  if (!roles.length || roles.some((r) => !INTERNAL_ALERT_ROLES.includes(r))) {
    errors.eligibleRoles = "Choose at least one internal role.";
  }
  return errors;
}

export function buildVarianceAlertConfigPatch(stored, form) {
  const base =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...stored }
      : {};
  const resolved = resolveVarianceAlertConfig({ varianceAlerts: base });
  const f = form || {};
  const out = { ...base };

  const same = (a, b) =>
    Array.isArray(a) && Array.isArray(b)
      ? JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
      : JSON.stringify(a) === JSON.stringify(b);
  const setIfMoved = (key, value) => {
    if (same(value, resolved[key])) return;
    out[key] = value;
  };

  setIfMoved("groupPctThreshold", Number(f.groupPctThreshold));
  setIfMoved("accountPctThreshold", Number(f.accountPctThreshold));
  setIfMoved("accountDollarFloor", Number(f.accountDollarFloor));
  setIfMoved("groupDollarFloor", Number(f.groupDollarFloor));
  setIfMoved("enabled", !!f.enabled);
  setIfMoved("alertBasis", String(f.alertBasis));
  setIfMoved(
    "eligibleRoles",
    INTERNAL_ALERT_ROLES.filter((r) => (f.eligibleRoles || []).includes(r)),
  );

  return out;
}

export function resolveAlertRecipients(profiles, eligibleRoles) {
  const allowed = new Set(
    (eligibleRoles || [])
      .filter((r) => typeof r === "string")
      .filter((r) => INTERNAL_ALERT_ROLES.includes(r)),
  );
  const seen = new Set();
  const out = [];
  for (const p of profiles || []) {
    if (!p || p.is_active === false) continue;
    if (p.id == null) continue;
    if (typeof p.email !== "string" || !p.email.includes("@")) continue;
    if (!allowed.has(p.role)) continue;
    const key = p.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: p.id, address: p.email, name: p.display_name || p.email });
  }
  return out;
}
