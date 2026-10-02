export const EMPTY_METRIC = "—";

const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);

export function meanOrDash(rows, pick, format = (n) => String(n)) {
  if (!Array.isArray(rows) || rows.length === 0) return EMPTY_METRIC;
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const v = typeof pick === "function" ? pick(row) : row;
    if (!isFiniteNumber(v)) continue;
    sum += v;
    count += 1;
  }
  if (count === 0) return EMPTY_METRIC;
  return format(sum / count);
}

export function shareOrDash(
  part,
  whole,
  format = (pct) => `${Math.round(pct)}%`,
) {
  if (!isFiniteNumber(part) || !isFiniteNumber(whole) || whole <= 0)
    return EMPTY_METRIC;
  return format((part / whole) * 100);
}

export function ratioOrDash(numerator, denominator, format = (n) => String(n)) {
  if (
    !isFiniteNumber(numerator) ||
    !isFiniteNumber(denominator) ||
    denominator === 0
  ) {
    return EMPTY_METRIC;
  }
  return format(numerator / denominator);
}
