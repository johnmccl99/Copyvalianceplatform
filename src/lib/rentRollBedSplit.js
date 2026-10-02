import {
  expandGroupLeaseSpaceNumbers,
  rosterSpaceNumberSet,
  spaceIdByNumber,
} from "./rentRollSpaces.js";
import { isRosterRow, effectiveRentOf } from "./rentRollView.js";
import { indexSpaceSquareFeet } from "./rentRollBedspaceSf.js";
import { indexSpaceMarketRent } from "./rentRollGpr.js";
import { RENT_CHARGE_CODES } from "./rentRollChargeColumns.js";

export const SPLIT_MONEY_FIELDS = Object.freeze([
  "rent",
  "effective_rent",
  "rent_charges",
  "total_charges",
  "net_effective",
  "deposit",
]);

export function indexWorkbookMarketRent(workbookRows) {
  const list = Array.isArray(workbookRows) ? workbookRows : [];
  const byLabel = new Map();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const label = r.space_label == null ? "" : String(r.space_label).trim();
    if (!label || byLabel.has(label)) continue;
    const rent = toFiniteNumber(r.market_rent);
    if (rent == null || rent <= 0) continue;
    byLabel.set(label, rent);
  }
  return byLabel;
}

export function bedNumberSet(spaces, workbookRows) {
  const set = rosterSpaceNumberSet(Array.isArray(spaces) ? spaces : []);
  const out = set instanceof Set ? new Set(set) : new Set();
  for (const r of Array.isArray(workbookRows) ? workbookRows : []) {
    if (!r || typeof r !== "object") continue;
    const label = r.space_label == null ? "" : String(r.space_label).trim();
    if (label) out.add(label);
  }
  return out;
}

export function bedWeights(labels, workbookByLabel, entrataByLabel) {
  const list = Array.isArray(labels) ? labels : [];
  const even = { weights: list.map(() => 1), basis: "even" };
  if (!list.length) return { weights: [], basis: "even" };

  for (const [source, index] of [
    ["workbook", workbookByLabel],
    ["entrata", entrataByLabel],
  ]) {
    if (!(index instanceof Map) || !index.size) continue;
    const weights = [];
    let ok = true;
    for (const label of list) {
      const w = toFiniteNumber(index.get(label));
      if (w == null || w <= 0) {
        ok = false;
        break;
      }
      weights.push(w);
    }
    if (ok && weights.length === list.length) return { weights, basis: source };
  }

  return even;
}

export function apportion(total, weights) {
  const ws = Array.isArray(weights) ? weights : [];
  if (!ws.length) return [];
  const amount = toFiniteNumber(total);
  if (amount == null) return ws.map(() => null);

  const sum = ws.reduce((a, w) => a + (toFiniteNumber(w) || 0), 0);
  if (!(sum > 0)) {
    const equal = ws.map(() => 1);
    return apportion(amount, equal);
  }

  const totalCents = Math.round(amount * 100);
  const out = [];
  let allocated = 0;
  for (let i = 0; i < ws.length - 1; i += 1) {
    const cents = Math.round((totalCents * (toFiniteNumber(ws[i]) || 0)) / sum);
    allocated += cents;
    out.push(cents / 100);
  }
  out.push((totalCents - allocated) / 100);
  return out;
}

export function splitRowIntoBeds(row, ctx) {
  if (!row || typeof row !== "object") return null;
  if (isRosterRow(row)) return null;
  const unitNumber = row.unit_number;
  if (typeof unitNumber !== "string" || !unitNumber.includes(",")) return null;

  const labels = expandGroupLeaseSpaceNumbers(unitNumber, ctx.numberSet);
  if (labels.length < 2) return null;

  const { weights, basis } = bedWeights(
    labels,
    ctx.workbookMarketByLabel,
    ctx.entrataMarketByLabel,
  );
  const shares = {};
  for (const field of SPLIT_MONEY_FIELDS) {
    shares[field] = apportion(row[field], weights);
  }
  const chargeCodes =
    row.charges && typeof row.charges === "object"
      ? Object.keys(row.charges)
      : [];
  const chargeShares = {};
  for (const code of chargeCodes) {
    chargeShares[code] = apportion(row.charges[code], weights);
  }

  if (
    toFiniteNumber(row.total_charges) != null &&
    toFiniteNumber(row.rent_charges) != null
  ) {
    shares.total_charges = labels.map((_, i) => {
      let cents = Math.round(shares.rent_charges[i] * 100);
      for (const code of chargeCodes) {
        if (RENT_CHARGE_CODES.has(code)) continue;
        const share = chargeShares[code][i];
        if (share == null) continue;
        cents += Math.round(share * 100);
      }
      return cents / 100;
    });
  }

  return labels.map((label, i) => {
    const next = { ...row, unit_number: label };
    for (const field of SPLIT_MONEY_FIELDS) {
      if (row[field] === undefined) continue;
      next[field] = shares[field][i];
    }
    if (chargeCodes.length) {
      const charges = {};
      for (const code of chargeCodes) charges[code] = chargeShares[code][i];
      next.charges = charges;
    }

    const spaceId =
      ctx.idByNumber instanceof Map ? ctx.idByNumber.get(label) : undefined;
    if (spaceId != null) next.unit_space_id = spaceId;
    else delete next.unit_space_id;
    const avail =
      ctx.availabilityByLabel instanceof Map
        ? ctx.availabilityByLabel.get(label)
        : undefined;
    if (avail) next.availability_status = avail;
    else delete next.availability_status;

    const gpr =
      ctx.entrataMarketByLabel instanceof Map
        ? ctx.entrataMarketByLabel.get(label)
        : undefined;
    if (gpr != null) {
      next.gpr = gpr;
      next.gpr_spaces = 1;
    } else {
      delete next.gpr;
      delete next.gpr_spaces;
    }
    const sf =
      ctx.sfByLabel instanceof Map ? ctx.sfByLabel.get(label) : undefined;
    if (sf != null) {
      next.bedspace_sf = sf;
      next.bedspace_sf_spaces = 1;
    } else {
      delete next.bedspace_sf;
      delete next.bedspace_sf_spaces;
    }

    next.split_of_unit_number = unitNumber;
    next.split_unit_rent_total = effectiveRentOf(row);
    next.split_bed_index = i;
    next.split_bed_count = labels.length;
    next.split_weight_basis = basis;
    next.row_key =
      "split-" +
      (row.lease_id != null
        ? row.lease_id
        : row.adjustment_id != null
          ? "adj-" + row.adjustment_id
          : unitNumber) +
      "-" +
      label;
    return next;
  });
}

export function splitGroupLeaseRows(
  rows,
  spaces,
  workbookSfRows,
  workbookMarketRows,
) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const spaceList = Array.isArray(spaces) ? spaces : [];
  const sfList = Array.isArray(workbookSfRows) ? workbookSfRows : [];
  const marketList = Array.isArray(workbookMarketRows)
    ? workbookMarketRows
    : [];

  const { rentByNumber } = indexSpaceMarketRent(spaceList);
  const { sfByNumber } = indexSpaceSquareFeet(spaceList, sfList);
  const availabilityByLabel = new Map();
  for (const s of spaceList) {
    if (!s || typeof s !== "object") continue;
    const n = s.space_number == null ? "" : String(s.space_number);
    if (n && s.availability_status && !availabilityByLabel.has(n)) {
      availabilityByLabel.set(n, s.availability_status);
    }
  }

  const ctx = {
    numberSet: bedNumberSet(spaceList, sfList.concat(marketList)),
    idByNumber: spaceIdByNumber(spaceList),
    workbookMarketByLabel: indexWorkbookMarketRent(marketList),
    entrataMarketByLabel: rentByNumber,
    sfByLabel: sfByNumber,
    availabilityByLabel,
  };

  const out = [];
  for (const row of list) {
    const split = splitRowIntoBeds(row, ctx);
    if (split) out.push(...split);
    else out.push(row);
  }
  return out;
}

export function splitCoverage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let units = 0;
  let bedRows = 0;
  const byBasis = { workbook: 0, entrata: 0, even: 0 };
  for (const row of list) {
    if (!row || typeof row !== "object" || row.split_bed_count == null)
      continue;
    bedRows += 1;
    if (row.split_bed_index === 0) units += 1;
    if (byBasis[row.split_weight_basis] != null)
      byBasis[row.split_weight_basis] += 1;
  }
  return { units, bedRows, byBasis };
}

function toFiniteNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
