export const EMPTY = "—";

function isNullish(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function toNum(v) {
  if (isNullish(v)) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function trimFixed(n, decimals) {
  const fixed = n.toFixed(decimals);
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/\.?0+$/, "");
}

export function formatCurrency(value, opts = {}) {
  const {
    abbreviate = true,
    decimals = 1,
    fullDecimals = 0,
    empty = EMPTY,
  } = opts;
  const n = toNum(value);
  if (n === null) return empty;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  let body;
  if (abbreviate && abs >= 1e9) {
    body = trimFixed(abs / 1e9, decimals) + "B";
  } else if (abbreviate && abs >= 1e6) {
    body = trimFixed(abs / 1e6, decimals) + "M";
  } else {
    body = abs.toLocaleString("en-US", {
      minimumFractionDigits: fullDecimals,
      maximumFractionDigits: fullDecimals,
    });
  }
  return `${sign}$${body}`;
}

export function formatCurrencyFull(value, opts = {}) {
  return formatCurrency(value, { ...opts, abbreviate: false });
}

export function formatPercent(value, opts = {}) {
  const {
    decimals = 1,
    signed = false,
    fromFraction = false,
    empty = EMPTY,
  } = opts;
  let n = toNum(value);
  if (n === null) return empty;
  if (fromFraction) n *= 100;
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
}

export function formatNumber(value, opts = {}) {
  const { decimals = 0, empty = EMPTY } = opts;
  const n = toNum(value);
  if (n === null) return empty;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatMultiple(value, opts = {}) {
  const { decimals = 2, empty = EMPTY } = opts;
  const n = toNum(value);
  if (n === null) return empty;
  return `${n.toFixed(decimals)}x`;
}
