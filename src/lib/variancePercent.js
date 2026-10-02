import { ACTIVITY_EPSILON, isActivityAmount } from "./varianceRowActivity.js";

export { ACTIVITY_EPSILON };

export function pctChange(value, base) {
  if (!isActivityAmount(base)) return null;
  const v = Number(value);
  const b = Number(base);
  if (!Number.isFinite(v) || !Number.isFinite(b)) return null;
  return ((v - b) / b) * 100;
}

export default pctChange;
