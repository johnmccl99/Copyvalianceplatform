export const SHOW_TOP_VARIANCE_CHART_KEY = "ds-filter:variance-show-top-chart";

function safeStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readShowTopVarianceChart() {
  const storage = safeStorage();
  if (!storage) return true;
  try {
    return storage.getItem(SHOW_TOP_VARIANCE_CHART_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeShowTopVarianceChart(value) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(SHOW_TOP_VARIANCE_CHART_KEY, value ? "1" : "0");
  } catch {}
}
