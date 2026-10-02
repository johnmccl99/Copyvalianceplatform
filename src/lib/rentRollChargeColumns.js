import { isUtilityFormulaValue } from "./rentRollMoneyOverride.js";

const CONCESSION_CODE_RE = /concession/i;

export const RENT_CHARGE_CODES = new Set(["rent", "retail rent"]);

export const MARKET_UTILITY_CHARGE_CODE = "utility flat fee";

export function normalizeChargeCode(code) {
  if (typeof code !== "string") return null;
  const n = code.trim().replace(/\s+/g, " ").toLowerCase();
  return n || null;
}

export function chargeCodeLabel(code) {
  if (typeof code !== "string") return "";
  return code.trim().replace(/\s+/g, " ");
}

export function isConcessionCode(code) {
  return typeof code === "string" && CONCESSION_CODE_RE.test(code);
}

function toAmount(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function indexChargesByLease(
  chargeRows,
  { recurringOnly = false, asOf = null } = {},
) {
  const byLease = new Map();
  if (!Array.isArray(chargeRows)) return byLease;
  for (const row of chargeRows) {
    if (!row) continue;
    if (recurringOnly && !isRecurringFrequency(row.frequency)) continue;
    if (asOf && !isChargeInPeriod(row, asOf)) continue;
    const code = normalizeChargeCode(row.charge_code);
    const amount = toAmount(row.amount);
    if (!code || amount == null || row.lease_id == null) continue;
    const key = String(row.lease_id);
    if (!byLease.has(key)) byLease.set(key, new Map());
    const codes = byLease.get(key);
    codes.set(code, (codes.get(code) || 0) + amount);
  }
  return byLease;
}

export function deriveChargeColumns(
  chargeRows,
  renderedRowCount,
  options = {},
) {
  if (!Array.isArray(chargeRows) || !renderedRowCount || renderedRowCount < 1)
    return [];
  const includeOneTime = options.includeOneTime === true;
  const asOf = options.asOf || null;

  const leasesByCode = new Map();
  const labelByCode = new Map();
  const typeCountsByCode = new Map();
  for (const row of chargeRows) {
    if (!row) continue;
    if (!includeOneTime && !isRecurringFrequency(row.frequency)) continue;
    if (asOf && !isChargeInForce(row, asOf)) continue;
    const code = normalizeChargeCode(row.charge_code);
    if (!code || row.lease_id == null) continue;
    if (toAmount(row.amount) == null) continue;
    if (!leasesByCode.has(code)) {
      leasesByCode.set(code, new Set());
      labelByCode.set(code, chargeCodeLabel(row.charge_code));
    }
    leasesByCode.get(code).add(String(row.lease_id));

    const type =
      typeof row.charge_type === "string"
        ? row.charge_type.trim().replace(/\s+/g, " ").toLowerCase()
        : "";
    if (type) {
      if (!typeCountsByCode.has(code)) typeCountsByCode.set(code, new Map());
      const counts = typeCountsByCode.get(code);
      counts.set(type, (counts.get(type) || 0) + 1);
    }
  }

  const out = [];
  for (const [code, leases] of leasesByCode) {
    if (RENT_CHARGE_CODES.has(code)) continue;
    const typeCounts = typeCountsByCode.get(code);
    const type =
      typeCounts && typeCounts.size
        ? [...typeCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
            .split(" ")
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ")
        : null;
    out.push({
      code,
      label: labelByCode.get(code) || code,
      leases: leases.size,
      fill: leases.size / renderedRowCount,
      type,
    });
  }
  out.sort((a, b) => b.fill - a.fill || a.code.localeCompare(b.code));
  return out;
}

export function withMarketUtilityColumn(chargeColumns, rows, renderedRowCount) {
  const columns = Array.isArray(chargeColumns) ? chargeColumns : [];
  if (!Array.isArray(rows) || !renderedRowCount || renderedRowCount < 1)
    return columns;

  let leases = 0;
  let applied = false;
  for (const r of rows) {
    if (!r || !r.charges || typeof r.charges !== "object") continue;
    if (toAmount(r.charges[MARKET_UTILITY_CHARGE_CODE]) == null) continue;
    leases += 1;
    if (r.market_utility_applied === true) applied = true;
  }
  if (!applied) return columns;

  const existing = columns.find(
    (c) => c && c.code === MARKET_UTILITY_CHARGE_CODE,
  );
  const next = columns.map((c) =>
    c === existing
      ? { ...c, leases, fill: leases / renderedRowCount, marketUtility: true }
      : c,
  );
  if (!existing) {
    next.push({
      code: MARKET_UTILITY_CHARGE_CODE,
      label: titleCaseChargeCode(MARKET_UTILITY_CHARGE_CODE),
      leases,
      fill: leases / renderedRowCount,
      type: null,
      marketUtility: true,
    });
  }
  next.sort((a, b) => b.fill - a.fill || a.code.localeCompare(b.code));
  return next;
}

export function withChargeOverrideColumns(
  chargeColumns,
  rows,
  renderedRowCount,
) {
  const columns = Array.isArray(chargeColumns) ? chargeColumns : [];
  if (!Array.isArray(rows) || !renderedRowCount || renderedRowCount < 1)
    return columns;

  const leasesByCode = new Map();
  for (const r of rows) {
    const overrides = chargeOverridesOf(r);
    if (!overrides) continue;
    for (const code of overrides.keys()) {
      leasesByCode.set(code, (leasesByCode.get(code) || 0) + 1);
    }
  }
  if (leasesByCode.size === 0) return columns;

  const next = columns.slice();
  let added = false;
  for (const [code, leases] of leasesByCode) {
    if (next.some((c) => c && c.code === code)) continue;
    next.push({
      code,
      label: titleCaseChargeCode(code),
      leases,
      fill: leases / renderedRowCount,
      type: null,
    });
    added = true;
  }
  if (!added) return columns;
  next.sort((a, b) => b.fill - a.fill || a.code.localeCompare(b.code));
  return next;
}

export function deriveChargeColumnsFromFrozenLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const codes = new Set();
  for (const l of list) {
    if (
      !l ||
      !l.charges ||
      typeof l.charges !== "object" ||
      Array.isArray(l.charges)
    )
      continue;
    for (const [code, amount] of Object.entries(l.charges)) {
      const c = normalizeChargeCode(code);
      if (!c || RENT_CHARGE_CODES.has(c)) continue;
      if (amount == null || toAmount(amount) == null) continue;
      codes.add(c);
    }
  }
  return [...codes]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({ code, label: titleCaseChargeCode(code) }));
}

export function attachRentChargesToFrozenLines(lines, plausibleMin) {
  const list = Array.isArray(lines) ? lines : [];
  return list.map((l) => {
    if (!l) return l;
    const gross = l.effective_rent != null ? l.effective_rent : l.rent;
    return { ...l, rent_charges: rentChargesOf(gross, plausibleMin) };
  });
}

export function frozenChargesRecorded(lines) {
  const list = Array.isArray(lines) ? lines : [];
  return list.some(
    (l) =>
      l &&
      l.charges &&
      typeof l.charges === "object" &&
      !Array.isArray(l.charges),
  );
}

export function titleCaseChargeCode(code) {
  return String(code)
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function netEffectiveOf(grossRent, leaseCharges, plausibleMin) {
  const gross = toAmount(grossRent);
  if (gross == null) return null;
  if (plausibleMin != null && gross < plausibleMin) return null;
  if (!leaseCharges || typeof leaseCharges.get !== "function") return gross;
  let concessions = 0;
  for (const [code, amount] of leaseCharges) {
    if (isConcessionCode(code)) concessions += amount;
  }
  return gross + concessions;
}

export function isRecurringFrequency(frequency) {
  if (frequency == null) return true;
  const f = String(frequency).trim().toLowerCase();
  if (!f) return true;
  return f === "monthly";
}

export function isChargeInForce(charge, asOf) {
  if (!charge) return false;
  if (!asOf) return true;
  const on = String(asOf).slice(0, 10);
  const start = charge.charge_start_date
    ? String(charge.charge_start_date).slice(0, 10)
    : null;
  const end = charge.charge_end_date
    ? String(charge.charge_end_date).slice(0, 10)
    : null;
  if (start && start > on) return false;
  if (end && end < on) return false;
  return true;
}

export function isChargeInPeriod(charge, asOf) {
  if (!charge) return false;
  if (!asOf) return true;
  if (isRecurringFrequency(charge.frequency))
    return isChargeInForce(charge, asOf);

  const month = String(asOf).slice(0, 7);
  const start = charge.charge_start_date
    ? String(charge.charge_start_date).slice(0, 7)
    : null;
  if (!start) return isChargeInForce(charge, asOf);
  if (start !== month) return false;
  const end = charge.charge_end_date
    ? String(charge.charge_end_date).slice(0, 7)
    : null;
  if (end && end < month) return false;
  return true;
}

export function rentChargesOf(grossRent, plausibleMin) {
  const gross = toAmount(grossRent);
  if (gross == null) return null;
  if (plausibleMin != null && gross < plausibleMin) return null;
  return gross;
}

export function totalRecurringChargesOf(
  grossRent,
  recurringCharges,
  plausibleMin,
) {
  const gross = toAmount(grossRent);
  if (gross == null) return null;
  if (plausibleMin != null && gross < plausibleMin) return null;
  return gross + sumNonRentCharges(recurringCharges);
}

function sumNonRentCharges(recurringCharges) {
  if (!recurringCharges || typeof recurringCharges.get !== "function") return 0;
  let extra = 0;
  for (const [code, amount] of recurringCharges) {
    if (RENT_CHARGE_CODES.has(code)) continue;
    extra += amount;
  }
  return extra;
}

export function chargeMatrixObserved(chargeRows) {
  if (!Array.isArray(chargeRows)) return false;
  return chargeRows.some(
    (row) =>
      row &&
      row.lease_id != null &&
      normalizeChargeCode(row.charge_code) != null &&
      toAmount(row.amount) != null,
  );
}

export function chargeOverridesOf(row) {
  const raw = row && row.charge_overrides;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let out = null;
  for (const [code, amount] of Object.entries(raw)) {
    const c = normalizeChargeCode(code);
    if (!c || amount == null) continue;
    if (isUtilityFormulaValue(amount)) continue;
    const n = toAmount(amount);
    if (n == null) continue;
    if (!out) out = new Map();
    out.set(c, n);
  }
  return out;
}

function withChargeOverrides(charges, overrides) {
  if (!overrides || overrides.size === 0) return charges;
  const next = new Map(charges || []);
  for (const [code, amount] of overrides) next.set(code, amount);
  return next;
}

export function attachChargesToRows(
  rows,
  chargeRows,
  plausibleMin,
  asOf = null,
  options = {},
) {
  if (!Array.isArray(rows)) return [];
  const includeOneTime = options.includeOneTime === true;
  const byLease = indexChargesByLease(chargeRows);
  const basisByLease = indexChargesByLease(chargeRows, {
    recurringOnly: !includeOneTime,
    asOf,
  });
  const observed = chargeMatrixObserved(chargeRows);
  const marketUtility = toAmount(options.marketUtility);
  return rows.map((r) => {
    if (!r) return r;
    const overrides = chargeOverridesOf(r);
    const leaseCharges = withChargeOverrides(
      byLease.get(String(r.lease_id)),
      overrides,
    );
    const basis = withChargeOverrides(
      basisByLease.get(String(r.lease_id)),
      overrides,
    );
    const charges = {};
    if (basis) for (const [code, amount] of basis) charges[code] = amount;
    const gross = r.effective_rent != null ? r.effective_rent : r.rent;
    const out = {
      ...r,
      charges,
      charges_observed: observed,
      net_effective: netEffectiveOf(gross, leaseCharges, plausibleMin),
      total_charges: observed
        ? totalRecurringChargesOf(gross, basis, plausibleMin)
        : null,
      rent_charges: rentChargesOf(gross, plausibleMin),
    };
    if (overrides && overrides.size > 0) {
      const billed = basisByLease.get(String(r.lease_id));
      const entrataCharges = {};
      for (const code of overrides.keys()) {
        entrataCharges[code] =
          billed && billed.has(code) ? billed.get(code) : null;
      }
      out.entrata_charges = entrataCharges;
    }
    if (
      options.defaultAbsentDeposit === true &&
      out.deposit == null &&
      observed &&
      r.lease_id != null
    )
      out.deposit = 0;
    return applyMarketUtility(out, marketUtility, plausibleMin, observed);
  });
}

export function applyMarketUtility(
  row,
  marketUtility,
  plausibleMin,
  chargesObserved,
) {
  if (!row) return row;
  const market = toAmount(marketUtility);
  if (market == null || market <= 0) return row;
  if (chargesObserved !== true) return row;
  if (row.occupied !== true) return row;

  const charges =
    row.charges && typeof row.charges === "object" ? row.charges : {};
  const billedRaw = charges[MARKET_UTILITY_CHARGE_CODE];
  const billed = billedRaw == null ? 0 : toAmount(billedRaw);
  if (billed == null) return row;
  const stated = Math.max(billed, market);
  const delta = stated - billed;

  const rent = row.rent_charges == null ? null : toAmount(row.rent_charges);
  if (rent == null) return row;
  const adjustedRent = rent - delta;
  if (plausibleMin != null && adjustedRent < plausibleMin) return row;

  return {
    ...row,
    charges: { ...charges, [MARKET_UTILITY_CHARGE_CODE]: stated },
    rent_charges: adjustedRent,
    market_utility_applied: true,
  };
}

export function previewMarketUtility({
  billed,
  rent,
  marketUtility,
  plausibleMin,
}) {
  const row = {
    occupied: true,
    rent_charges: rent == null ? null : rent,
    charges: billed == null ? {} : { [MARKET_UTILITY_CHARGE_CODE]: billed },
  };
  const out = applyMarketUtility(row, marketUtility, plausibleMin, true);
  if (!out || out.market_utility_applied !== true) return undefined;
  return out.charges[MARKET_UTILITY_CHARGE_CODE];
}

export function chargeColumnsSentence(chargeColumns) {
  if (!Array.isArray(chargeColumns) || chargeColumns.length === 0) return null;
  const names = chargeColumns.map((c) => c.label);
  const list =
    names.length === 1
      ? names[0]
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return (
    `Charge columns are derived from this property's own Entrata charge codes: ${list}. ` +
    `Every code this property carries has a column, however few rows use it, ` +
    `so a different property will show a different set.`
  );
}
