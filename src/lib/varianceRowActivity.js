export const ACTIVITY_EPSILON = 0.005;

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isActivityAmount(v) {
  return Math.abs(num(v)) >= ACTIVITY_EPSILON;
}

export function budgetVarianceRowHasActivity(r) {
  if (!r) return false;
  return isActivityAmount(r.budget) || isActivityAmount(r.actual);
}

export function priorYearVarianceRowHasActivity(r) {
  if (!r) return false;
  if (isActivityAmount(r.current)) return true;
  return r.py_available === true && isActivityAmount(r.py);
}

export function partitionByActivity(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const hasActivity =
    typeof opts.hasActivity === "function" ? opts.hasActivity : () => true;
  const isPinned =
    typeof opts.isPinned === "function" ? opts.isPinned : () => false;
  const active = [];
  const inactive = [];
  for (const row of list) {
    if (isPinned(row) || hasActivity(row)) active.push(row);
    else inactive.push(row);
  }
  return { active, inactive };
}

export function isStructuralRow(r) {
  return (
    !!r && (r.kind === "subtotal" || r.kind === "total" || r.kind === "header")
  );
}

export const NO_ACTIVITY_DIVIDER = Object.freeze({ __noActivityDivider: true });

export function isNoActivityDivider(r) {
  return r === NO_ACTIVITY_DIVIDER;
}

export function withNoActivitySection(active, inactive, open) {
  const activeList = Array.isArray(active) ? active : [];
  const inactiveList = Array.isArray(inactive) ? inactive : [];
  if (inactiveList.length === 0) return activeList;
  return open
    ? [...activeList, NO_ACTIVITY_DIVIDER, ...inactiveList]
    : [...activeList, NO_ACTIVITY_DIVIDER];
}

export const SHOW_NO_ACTIVITY_KEY = "ds-filter:variance-show-no-activity";

function safeStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readShowNoActivity() {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    return storage.getItem(SHOW_NO_ACTIVITY_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowNoActivity(value) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(SHOW_NO_ACTIVITY_KEY, value ? "1" : "0");
  } catch {}
}
