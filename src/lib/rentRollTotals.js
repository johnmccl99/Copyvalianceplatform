import {
  RENT_PLAUSIBLE_MIN,
  isRosterRow,
  RENT_TOTAL_COLUMN,
  rowNounPlural,
  rowNounSingular,
} from "./rentRollView.js";

export function isTotalableColumn(col) {
  return !!col && col.type === "number" && col.totalable !== false;
}

export function amountOf(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function floorFor(col) {
  if (!col || col.key !== RENT_TOTAL_COLUMN.key) return null;
  return RENT_PLAUSIBLE_MIN;
}

export function columnTotal(rows, col) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  if (!isTotalableColumn(col) || typeof col.get !== "function") {
    return { sum: null, counted: 0, total, excluded: 0 };
  }

  const floor = floorFor(col);
  let sum = 0;
  let counted = 0;
  let excluded = 0;
  for (const row of list) {
    let raw;
    try {
      raw = col.get(row);
    } catch {
      raw = null;
    }
    const n = amountOf(raw);
    if (n == null) continue;
    if (floor != null && isRosterRow(row)) continue;
    const floorRow = floor != null ? amountOf(row.split_unit_rent_total) : null;
    const floorBasis = floorRow != null ? floorRow : n;
    if (floor != null && floorBasis < floor) {
      excluded += 1;
      continue;
    }
    sum += n;
    counted += 1;
  }

  return { sum: counted > 0 ? sum : null, counted, total, excluded };
}

export function rentColumnTotal(rows) {
  const col = RENT_TOTAL_COLUMN;
  if (!col)
    return {
      sum: null,
      counted: 0,
      total: Array.isArray(rows) ? rows.length : 0,
      excluded: 0,
    };
  return columnTotal(rows, col);
}

export function rentSourceColumn(col) {
  if (col && col.key === "rentCharges") return RENT_TOTAL_COLUMN;
  return col;
}

export function rentKpiSubLabel(entry, noun) {
  const e = entry || {};
  const word = rowNounSingular(noun);
  const n = e.excluded || 0;
  const plural = n === 1 ? word : word + "s";

  if (e.sum == null) {
    if (!n) return "no rent recorded on this roll";
    return (
      "no " + word + " on this roll carries a rent above $" + RENT_PLAUSIBLE_MIN
    );
  }

  if (!n) return "sum of effective rent";
  return (
    "sum of effective rent · excludes " +
    n +
    " " +
    plural +
    " recorded below $" +
    RENT_PLAUSIBLE_MIN
  );
}

export function buildColumnTotals(rows, columns) {
  const cols = Array.isArray(columns) ? columns : [];
  const out = new Map();
  for (const col of cols) {
    if (!col || !col.key) continue;
    if (!isTotalableColumn(col)) continue;
    out.set(col.key, columnTotal(rows, rentSourceColumn(col)));
  }
  return out;
}

export function totalCoverageLabel(entry) {
  if (!entry || !entry.total) return null;
  if (!entry.counted) return null;
  return entry.counted + " of " + entry.total;
}

export function hasPartialCoverage(totals) {
  if (!totals || typeof totals.forEach !== "function") return false;
  let partial = false;
  totals.forEach((entry) => {
    if (!entry || !entry.total) return;
    if (entry.counted < entry.total) partial = true;
  });
  return partial;
}

export function totalsBasisSentence(options) {
  const o = options || {};
  const noun = rowNounPlural(o.noun);
  const shown = Number(o.shown) || 0;

  if (o.filtersActive) {
    return (
      "Totals cover the " +
      shown +
      " filtered " +
      noun +
      " shown above, not the whole property. Each column counts only the " +
      noun +
      " carrying that value."
    );
  }

  if (o.partial) {
    return (
      "Totals cover all " +
      shown +
      " " +
      noun +
      " on this roll. Each column counts only the " +
      noun +
      " carrying that value."
    );
  }

  return "Totals cover all " + shown + " " + noun + " on this roll.";
}

export function rentTotalCoverageSentence(entry, options) {
  const e = entry || {};
  const total = Number(e.total) || 0;
  if (!total) return null;
  const counted = Number(e.counted) || 0;
  const gap = total - counted;
  if (gap <= 0) {
    return (
      "Sum of all " + total + " " + (total === 1 ? "lease" : "leases") + "."
    );
  }
  const o = options || {};
  const gapNoun = gap === 1 ? rowNounSingular(o.noun) : rowNounPlural(o.noun);
  return (
    "Sum of " +
    counted +
    " of " +
    total +
    " leases; " +
    gap +
    " " +
    gapNoun +
    (gap === 1 ? " has" : " have") +
    " no rent charge."
  );
}

export function excludedCount(totals) {
  if (!totals || typeof totals.forEach !== "function") return 0;
  let n = 0;
  totals.forEach((entry) => {
    if (entry && entry.excluded) n += entry.excluded;
  });
  return n;
}

export function totalsCoverageLine(totals, options) {
  const o = options || {};
  const excluded = excludedCount(totals);
  if (!excluded) return null;

  const noun = rowNounPlural(o.noun);
  const one = excluded === 1;

  return (
    "Excludes " +
    excluded +
    " " +
    (one ? noun.slice(0, -1) : noun) +
    " whose rent is recorded below $" +
    RENT_PLAUSIBLE_MIN +
    " — " +
    (one ? "a placeholder value" : "placeholder values") +
    " rather than " +
    (one ? "a rent" : "rents") +
    ", so " +
    (one ? "it is" : "they are") +
    " left out of the total above rather than added into it."
  );
}
