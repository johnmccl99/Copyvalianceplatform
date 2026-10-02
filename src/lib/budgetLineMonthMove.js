import {
  formatMonthKey,
  itemizedMonthKey,
  monthEndDate,
} from "./budgetAccountCard.js";

export const MONTH_MOVE_STRIDE_MONTHS = Object.freeze({
  Monthly: 1,
  BiMonthly: 2,
  Quarterly: 3,
  Quadrimester: 4,
  SemiAnnually: 6,
  Annually: 12,
});

export const MONTH_MOVE_REFUSAL_TEXT = Object.freeze({
  "no-line": "Choose a stored budget line with an id.",
  "no-month": "The stored budget line has no readable first month.",
  "bad-target": "Choose a target month in YYYY-MM form.",
  "same-month": "The line is already on that month.",
  "off-axis": "The target month is outside the statement axis.",
  "closed-source": "A month this line is leaving is realized in the GL.",
  "closed-target": "The month being entered is realized in the GL.",
  "closed-landing":
    "A later occurrence of this recurring line would land on a month realized in the GL.",
  inverted: "The stored line has an inverted month range.",
  "read-only": "This account is read-only, so the month cannot be changed.",
});

export const MONTH_MOVE_WARNING_TEXT = Object.freeze({
  "landing-off-axis":
    "A later occurrence of this recurring line falls outside the statement axis.",
  "not-monthly":
    "The carry family only reads Monthly lines; no carry impact is computed for this line.",
  "no-last-month":
    "The stored line has no readable last month; the moved bound will be set to the target month.",
});

function shiftMonthKey(key, delta) {
  const parsed = itemizedMonthKey(key);
  if (!parsed || !Number.isInteger(delta)) return null;
  const total =
    Number(parsed.slice(0, 4)) * 12 + Number(parsed.slice(5, 7)) - 1 + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  if (year < 1 || year > 9999) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function monthDifference(fromKey, toKey) {
  const from = itemizedMonthKey(fromKey);
  const to = itemizedMonthKey(toKey);
  if (!from || !to) return null;
  return (
    Number(to.slice(0, 4)) * 12 +
    Number(to.slice(5, 7)) -
    Number(from.slice(0, 4)) * 12 -
    Number(from.slice(5, 7))
  );
}

function strideFor(frequency) {
  return MONTH_MOVE_STRIDE_MONTHS[frequency] || 1;
}

export function monthMoveLandings(firstMonthKey, lastMonthKey, frequency) {
  const first = itemizedMonthKey(firstMonthKey);
  if (!first) return [];
  const last = itemizedMonthKey(lastMonthKey);
  if (!last) return [first];
  const span = monthDifference(first, last);
  if (span < 0) return [];
  const stride = strideFor(frequency);
  const landings = [];
  for (let offset = 0; offset <= span; offset += stride) {
    landings.push(shiftMonthKey(first, offset));
  }
  return landings.filter(Boolean);
}

function axisMonthSet(axis) {
  return new Set(
    (axis || [])
      .map((entry) => itemizedMonthKey(entry && entry.month_end))
      .filter(Boolean),
  );
}

function numericAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function usableSourceIndex(line) {
  if (
    line == null ||
    line.source_row_index == null ||
    String(line.source_row_index).trim() === ""
  ) {
    return null;
  }
  const value = Number(line && line.source_row_index);
  return Number.isFinite(value) ? value : null;
}

function eligibleMonthlyLine(line) {
  return Boolean(
    line &&
    line.frequency === "Monthly" &&
    itemizedMonthKey(line.first_month) &&
    line.line_description != null &&
    usableSourceIndex(line) != null,
  );
}

function effectiveMonth(line, movedLineId, toKey) {
  if (line && line.id === movedLineId) return toKey;
  return itemizedMonthKey(line && line.first_month);
}

function predecessorFor(carryLine, lines, movedLineId, toKey) {
  const carryIndex = usableSourceIndex(carryLine);
  const carryMonth = effectiveMonth(carryLine, movedLineId, toKey);
  const description = carryLine.line_description;
  const candidates = (lines || [])
    .filter((candidate) => {
      if (!eligibleMonthlyLine(candidate)) return false;
      if (candidate.line_description !== description) return false;
      if (usableSourceIndex(candidate) >= carryIndex) return false;
      if (
        carryLine.data_source === "Prior Year" &&
        itemizedMonthKey(effectiveMonth(candidate, movedLineId, toKey)) &&
        itemizedMonthKey(carryMonth) &&
        effectiveMonth(candidate, movedLineId, toKey).slice(5, 7) !==
          carryMonth.slice(5, 7)
      )
        return false;
      return true;
    })
    .sort((a, b) => usableSourceIndex(b) - usableSourceIndex(a));
  const predecessor = candidates[0];
  if (!predecessor) return null;
  const predecessorMonth = effectiveMonth(predecessor, movedLineId, toKey);
  return {
    id: predecessor.id,
    month: predecessorMonth,
    amount: numericAmount(predecessor.amount),
  };
}

export function lineMonthCarryImpact({ line, toKey, accountLines } = {}) {
  if (!eligibleMonthlyLine(line) || !itemizedMonthKey(toKey)) return [];
  const lines = accountLines || [];
  const carryLines = lines
    .filter(
      (candidate) =>
        eligibleMonthlyLine(candidate) &&
        (candidate.data_source === "Prior Month" ||
          candidate.data_source === "Prior Year"),
    )
    .sort(
      (a, b) =>
        usableSourceIndex(a) - usableSourceIndex(b) ||
        String(a.id || "").localeCompare(String(b.id || "")),
    );
  const movedLineId = line.id;
  const impacts = [];
  for (const carryLine of carryLines) {
    const before = predecessorFor(carryLine, lines, null, null);
    const after = predecessorFor(carryLine, lines, movedLineId, toKey);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (!changed) continue;
    impacts.push({
      id: carryLine.id,
      description: carryLine.line_description,
      month: effectiveMonth(carryLine, movedLineId, toKey),
      dataSource: carryLine.data_source,
      before,
      after,
      changed: true,
    });
  }
  return impacts;
}

function refusal(reason) {
  return { reason, text: MONTH_MOVE_REFUSAL_TEXT[reason] };
}

function patchFor(plan) {
  if (!plan || !plan.ready) return null;
  if (monthDifference(plan.from, plan.to) == null) return null;
  return {
    first_month: monthEndDate(plan.to),
    last_month:
      plan.spanMonths == null
        ? null
        : monthEndDate(shiftMonthKey(plan.to, plan.spanMonths)),
  };
}

export function planLineMonthMove({
  line,
  targetMonth,
  axis,
  closedMonths,
  accountLines,
  canWrite = true,
} = {}) {
  const refusals = [];
  const warnings = [];
  const lineId = line && line.id ? line.id : null;
  const description =
    line && line.line_description != null ? line.line_description : null;
  const from = itemizedMonthKey(line && line.first_month);
  const to = itemizedMonthKey(targetMonth);
  const last = itemizedMonthKey(line && line.last_month);
  const frequency = line && line.frequency != null ? line.frequency : null;
  const strideMonths = strideFor(frequency);
  const spanMonths = from && last ? monthDifference(from, last) : 0;
  const landingsBefore = from ? monthMoveLandings(from, last, frequency) : [];
  const landingsAfter =
    from && to
      ? monthMoveLandings(to, shiftMonthKey(to, spanMonths), frequency)
      : [];

  if (!line || !line.id) refusals.push(refusal("no-line"));
  if (line && line.id && !from) refusals.push(refusal("no-month"));
  if (!to) refusals.push(refusal("bad-target"));
  if (from && last && spanMonths < 0) refusals.push(refusal("inverted"));
  if (from && to && from === to) refusals.push(refusal("same-month"));

  const axisKeys = axisMonthSet(axis);
  if (to && !axisKeys.has(to)) refusals.push(refusal("off-axis"));

  const closed = closedMonths || new Set();
  if (landingsBefore.some((key) => closed.has(key)))
    refusals.push(refusal("closed-source"));
  if (to && closed.has(to)) refusals.push(refusal("closed-target"));
  if (
    to &&
    landingsAfter.length > 1 &&
    landingsAfter.slice(1).some((key) => closed.has(key))
  ) {
    refusals.push(refusal("closed-landing"));
  }
  if (!canWrite) refusals.push(refusal("read-only"));

  const landingsOffAxis = landingsAfter
    .slice(1)
    .filter((key) => !axisKeys.has(key));
  if (landingsOffAxis.length)
    warnings.push(MONTH_MOVE_WARNING_TEXT["landing-off-axis"]);
  if (line && from && !last)
    warnings.push(MONTH_MOVE_WARNING_TEXT["no-last-month"]);
  const carryImpact =
    line && line.frequency === "Monthly"
      ? lineMonthCarryImpact({ line, toKey: to, accountLines })
      : [];
  if (line && line.frequency !== "Monthly") {
    warnings.push(MONTH_MOVE_WARNING_TEXT["not-monthly"]);
  }

  const leadingRefusal =
    refusals.find((entry) => entry.reason !== "same-month") || refusals[0];
  const ready = refusals.length === 0 && Boolean(from && to && from !== to);
  const plan = {
    ready,
    refusals,
    error:
      leadingRefusal && leadingRefusal.reason !== "same-month"
        ? leadingRefusal.text
        : null,
    lineId,
    description,
    from,
    to,
    frequency,
    strideMonths,
    spanMonths,
    landingsBefore,
    landingsAfter,
    landingsOffAxis,
    patch: null,
    carryImpact,
    warnings,
  };
  plan.patch = patchFor(plan);
  return plan;
}

export function lineMonthMovePatch(plan) {
  return plan && plan.ready ? plan.patch : null;
}

export function lineMonthMoveFingerprint(plan) {
  if (!plan) return "none";
  return JSON.stringify({
    lineId: plan.lineId || null,
    from: plan.from || null,
    to: plan.to || null,
    landingsAfter: plan.landingsAfter || [],
    refusals: (plan.refusals || []).map(({ reason, text }) => [reason, text]),
    carryImpact: (plan.carryImpact || []).map((row) => ({
      id: row.id,
      before: row.before
        ? [row.before.id, row.before.month, row.before.amount]
        : null,
      after: row.after
        ? [row.after.id, row.after.month, row.after.amount]
        : null,
    })),
  });
}

function formatMonths(keys) {
  return keys
    .map((key) => formatMonthKey(key))
    .filter(Boolean)
    .join(", ");
}

export function describeLineMonthMovePlan(plan) {
  if (!plan) return { ready: false, message: "" };
  const route =
    plan.from && plan.to
      ? `${formatMonthKey(plan.from)} → ${formatMonthKey(plan.to)}`
      : null;
  const refusalText = plan.refusals.map((entry) => entry.text).join(" ");
  const parts = [];
  if (refusalText) parts.push(refusalText);
  if (route) parts.push(`Move ${route}.`);
  if (
    plan.frequency &&
    plan.frequency !== "Monthly" &&
    plan.landingsAfter.length
  ) {
    parts.push(
      `${plan.frequency} moves every occurrence: ${formatMonths(plan.landingsAfter)}.`,
    );
  }
  if (plan.carryImpact.length) {
    const one = plan.carryImpact.length === 1;
    parts.push(
      `This changes which row ${plan.carryImpact.length} other ` +
        `${one ? "line carries" : "lines carry"} from.`,
    );
  } else if (plan.frequency === "Monthly") {
    parts.push("No other line's carry-forward source changes.");
  }
  if (plan.warnings.length) parts.push(...plan.warnings);
  if (!parts.length) parts.push("There is no month move to plan.");
  return { ready: plan.ready, message: parts.join(" ") };
}

export function describeLineMonthMoveOutcome({
  requested = 0,
  updated = 0,
  missing = 0,
  error = null,
} = {}) {
  if (error) {
    return {
      ok: false,
      message: `${error} The stored line's final state could not be confirmed; reload before trying again.`,
    };
  }
  if (requested === 0) {
    return {
      ok: false,
      message: "No stored line was requested, so no move was confirmed.",
    };
  }
  if (updated === requested) {
    return { ok: true, message: "Moved one stored line." };
  }
  if (missing > 0) {
    return {
      ok: false,
      message:
        "The stored line could not be found, so the month move was not confirmed.",
    };
  }
  return {
    ok: false,
    message:
      "The month move was not confirmed; reload the statement before trying again.",
  };
}
