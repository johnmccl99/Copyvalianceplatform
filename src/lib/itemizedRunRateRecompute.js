import { isPlausibleRate } from "./itemizedFieldSemantics.js";

export const WINDOW_MONTHS = 12;

const EPS = 1e-9;
const num = (v) => {
  const n =
    typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) =>
  (n < 0 ? -Math.round(Math.abs(n) * 100) : Math.round(n * 100)) / 100;

export const REFUSALS = Object.freeze({
  NO_ACCOUNT: "no_account",
  NO_HISTORY: "no_history",
  SHORT_HISTORY: "short_history",
  FLAT_HISTORY: "flat_history",
  NOT_MONTHLY: "not_monthly",
  GROWTH_NOT_A_RATE: "growth_not_a_rate",
});

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function trailingWindow(series, { months = WINDOW_MONTHS } = {}) {
  const rows = (series || [])
    .filter((r) => r && r.month)
    .map((r) => ({ month: String(r.month), amount: num(r.amount) }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const win = rows.slice(-months);
  return {
    months: win,
    monthsUsed: win.length,
    monthsAvailable: rows.length,
    from: win.length ? win[0].month : null,
    to: win.length ? win[win.length - 1].month : null,
  };
}

export function recomputeStableRunRate({
  series,
  statedGrowth,
  currentAmount,
  frequency = "Monthly",
  accountNumber = "",
  months = WINDOW_MONTHS,
} = {}) {
  const win = trailingWindow(series, { months });
  const current =
    currentAmount === "" ||
    currentAmount === null ||
    currentAmount === undefined
      ? null
      : num(currentAmount);
  const base = {
    ...win,
    statedGrowth: null,
    t12Mean: null,
    t12Median: null,
    currentAmount: current,
    proposedAmount: null,
    delta: null,
    deltaPct: null,
    medianVariant: null,
    changesAmount: false,
  };

  if (!String(accountNumber || "").trim())
    return { ...base, ok: false, refusal: REFUSALS.NO_ACCOUNT };

  if (String(frequency || "").trim() !== "Monthly")
    return { ...base, ok: false, refusal: REFUSALS.NOT_MONTHLY };

  if (win.monthsUsed === 0)
    return { ...base, ok: false, refusal: REFUSALS.NO_HISTORY };
  if (win.monthsUsed < months)
    return { ...base, ok: false, refusal: REFUSALS.SHORT_HISTORY };

  const amounts = win.months.map((r) => r.amount);
  const t12Mean = round2(amounts.reduce((s, v) => s + v, 0) / amounts.length);
  const t12Median = round2(median(amounts));

  if (Math.abs(t12Mean) < EPS) {
    return {
      ...base,
      t12Mean,
      t12Median,
      ok: false,
      refusal: REFUSALS.FLAT_HISTORY,
    };
  }

  const rawGrowth =
    statedGrowth === "" || statedGrowth === null || statedGrowth === undefined
      ? 0
      : statedGrowth;
  if (!isPlausibleRate(rawGrowth) && num(rawGrowth) !== 0) {
    return {
      ...base,
      t12Mean,
      t12Median,
      ok: false,
      refusal: REFUSALS.GROWTH_NOT_A_RATE,
    };
  }
  const g = num(rawGrowth);

  const proposedAmount = round2(t12Mean * (1 + g));
  const delta = current === null ? null : round2(proposedAmount - current);
  return {
    ...base,
    ok: true,
    refusal: null,
    statedGrowth: g,
    t12Mean,
    t12Median,
    proposedAmount,
    delta,
    deltaPct:
      current === null || Math.abs(current) < EPS
        ? null
        : round2(((proposedAmount - current) / Math.abs(current)) * 100),
    medianVariant: round2(t12Median * (1 + g)),
    changesAmount:
      current === null ? true : Math.abs(proposedAmount - current) >= 0.01,
  };
}

export function refusalText(refusal, { frequency } = {}) {
  switch (refusal) {
    case REFUSALS.NO_ACCOUNT:
      return "This line has no account number, so there is no GL history to derive a run-rate from.";
    case REFUSALS.NO_HISTORY:
      return "No GL actuals exist for this account, so there is no trailing run-rate to recompute. The stored amount is the only figure available.";
    case REFUSALS.SHORT_HISTORY:
      return "Fewer than twelve months of GL actuals exist for this account. A partial window would give a run-rate that reads like a full year and is not one.";
    case REFUSALS.FLAT_HISTORY:
      return "The trailing twelve GL months average to zero, so there is no level to grow. This account is dormant or lumpy, which is a different rule.";
    case REFUSALS.NOT_MONTHLY:
      return `R1 derives a monthly run-rate, and this line lands ${String(frequency || "on a non-monthly stride").trim()}. Writing a monthly figure into a per-landing amount would rescale the account, so it is not offered.`;
    case REFUSALS.GROWTH_NOT_A_RATE:
      return "The Increase field on this line does not hold a rate (it is 1 or larger), so it cannot be read as growth. Fix the field and the recompute becomes available.";
    default:
      return "";
  }
}
