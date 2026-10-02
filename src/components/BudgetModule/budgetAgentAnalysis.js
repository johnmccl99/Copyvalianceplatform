export const MAGNITUDE_FACTOR = 5;
export const OUTLIER_MEDIAN_FACTOR = 10;
export const OUTLIER_MIN_LIVE_ROWS = 3;

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function matchScope(change) {
  if (!change) return "line";
  if (change.target === "pdpq") return "key";
  const match = change.match || {};
  const hasDescKey = Object.prototype.hasOwnProperty.call(
    match,
    "line_description",
  );
  if (!hasDescKey) return "account";
  if (match.line_description === undefined) return "account";
  if (match.line_description === null) return "no-description";
  return "line";
}

export function isAccountWildcard(change) {
  return matchScope(change) === "account";
}

export function scopeLabel(change) {
  switch (matchScope(change)) {
    case "account":
      return "Entire account · all lines";
    case "no-description":
      return "Lines with no description";
    case "key":
      return "Assumption key";
    default:
      return "Single line";
  }
}

export function rowFlags(row, ctx = {}) {
  const flags = [];
  if (!row) return flags;

  const isLive = row.numeric_effect === "live";
  const oldN = toNum(row.old_value);
  const newN = toNum(row.new_value);
  const oldEmpty =
    row.old_value === null ||
    row.old_value === undefined ||
    row.old_value === "";

  if (oldN !== null && newN !== null) {
    if ((oldN > 0 && newN < 0) || (oldN < 0 && newN > 0))
      flags.push("sign_flip");
    if (oldN !== 0) {
      const ratio = Math.abs(newN / oldN);
      if (ratio >= MAGNITUDE_FACTOR || ratio <= 1 / MAGNITUDE_FACTOR)
        flags.push("magnitude");
    } else if (newN !== 0) {
      flags.push("magnitude");
    }
  } else if (oldEmpty && newN !== null && newN !== 0) {
    flags.push("magnitude");
  }

  const delta = toNum(row.delta_total);
  if (
    isLive &&
    delta !== null &&
    Math.abs(delta) > 0 &&
    (ctx.liveRowCount ?? 0) >= OUTLIER_MIN_LIVE_ROWS &&
    (ctx.medianAbsDelta ?? 0) > 0 &&
    Math.abs(delta) >= ctx.medianAbsDelta * OUTLIER_MEDIAN_FACTOR
  ) {
    flags.push("outlier");
  }
  return flags;
}

export const FLAG_META = {
  sign_flip: {
    label: "Sign flip",
    tone: "danger",
    tip: "The value crosses zero — an expense would flip to income (or the reverse).",
  },
  magnitude: {
    label: "10x+ jump",
    tone: "danger",
    tip: "Order-of-magnitude change from the current value — verify the figure.",
  },
  outlier: {
    label: "Dollar outlier",
    tone: "warn",
    tip: "This row's dollar impact dwarfs the others in this batch.",
  },
};

export function analyzeDryRun(result) {
  const properties = Array.isArray(result?.properties) ? result.properties : [];

  const allRows = [];
  for (const p of properties) {
    const rows = Array.isArray(p.rows) ? p.rows : [];
    for (const row of rows)
      allRows.push({ ...row, property_code: p.property_code });
  }

  const crossPropertyTotal = properties.reduce(
    (s, p) => s + (toNum(p.delta_total) || 0),
    0,
  );

  const liveRows = allRows.filter((r) => r.numeric_effect === "live");
  const liveAbsDeltas = liveRows
    .map((r) => Math.abs(toNum(r.delta_total) || 0))
    .filter((d) => d > 0);
  const ctx = {
    medianAbsDelta: median(liveAbsDeltas),
    liveRowCount: liveRows.length,
  };

  const rowsWithFlags = allRows.map((row) => ({
    row,
    flags: rowFlags(row, ctx),
  }));
  const anomalies = rowsWithFlags.filter((x) => x.flags.length > 0);

  return {
    crossPropertyTotal,
    rowCount: allRows.length,
    liveRowCount: liveRows.length,
    anomalies,
    hasAnomalies: anomalies.length > 0,
    rowsWithFlags,
    ctx,
  };
}

export function oldNewForChange(changeIndex, change, result, ctx) {
  const properties = Array.isArray(result?.properties) ? result.properties : [];
  const rows = [];
  for (const p of properties) {
    for (const row of Array.isArray(p.rows) ? p.rows : []) {
      if (row.change_index === changeIndex)
        rows.push({ ...row, property_code: p.property_code });
    }
  }
  const scope = matchScope(change);
  if (!result || rows.length === 0) {
    return {
      status: "pending",
      oldDisplay: null,
      oldValues: [],
      rows,
      flags: [],
      scope,
    };
  }

  const flags = [...new Set(rows.flatMap((r) => rowFlags(r, ctx || {})))];

  const seen = new Map();
  for (const r of rows) {
    const key = JSON.stringify(r.old_value ?? null);
    if (!seen.has(key)) seen.set(key, r.old_value);
  }
  const oldValues = [...seen.values()];

  if (oldValues.length === 1) {
    return {
      status: "single",
      oldDisplay: oldValues[0],
      oldValues,
      rows,
      flags,
      scope,
    };
  }
  const nums = oldValues.map(toNum).filter((n) => n !== null);
  const range =
    nums.length === oldValues.length && nums.length > 1
      ? { min: Math.min(...nums), max: Math.max(...nums) }
      : null;
  return {
    status: "varies",
    oldDisplay: null,
    oldValues,
    range,
    rows,
    flags,
    scope,
  };
}
