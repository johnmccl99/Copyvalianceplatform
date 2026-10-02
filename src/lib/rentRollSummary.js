import {
  buildRentRollColumns,
  byUnitCell,
  rollOccupancy,
  OCCUPANCY_LABELS,
  OCCUPANCY_OCCUPIED,
  OCCUPANCY_VACANT,
  OCCUPANCY_OCCUPIED_NO_LEASE,
} from "./rentRollView.js";
import { buildColumnTotals } from "./rentRollTotals.js";

export const CHARGE_SUMMARY_ACTUAL_NOTE =
  "Actual is not measured on this roll: the charge matrix carries Entrata's SCHEDULED charges only, and billed actuals live on the AR ledger, which this surface does not load.";

export const CHARGE_SUMMARY_LEDGER_NOTE =
  "The charge matrix projects no ledger name, so codes are grouped as one scheduled-charge ledger rather than split per ledger.";

export const STATUS_SUMMARY_BASIS_NOTE =
  "This summary counts occupancy for the roll's as-of date, derived from the leases in term on " +
  "that date: a bed with a lease in term is occupied, and a bed without one is vacant unless " +
  "Entrata reports it tenanted, in which case it is pending — counted on its own line, and " +
  "again in Total Leased + Pending, but never inside Total Occupied Units. The Unit " +
  "Status column is different — it is Entrata's live status as of the last sync, which has no " +
  "date dimension and does not change with the as-of date. On a back-dated or pre-leasing roll " +
  "the two can disagree, because they answer different questions.";

const STATUS_RUNS = [
  {
    key: "occupied",
    keys: [OCCUPANCY_OCCUPIED],
    label: "Total Occupied Units",
  },
  {
    key: "pending",
    keys: [OCCUPANCY_OCCUPIED_NO_LEASE],
    label: "Total Pending Units",
  },
  { key: "vacant", keys: [OCCUPANCY_VACANT], label: "Total Vacant Units" },
  { key: "other", keys: null, label: "Total Other Units" },
];

export const LEASED_PLUS_PENDING_LABEL = "Total Leased + Pending";
const LEASED_PLUS_PENDING_RUN_KEYS = ["occupied", "pending"];

function percentOf(count, total) {
  return total ? count / total : null;
}

function sumNullable(values) {
  let total = 0;
  let counted = 0;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    counted += 1;
  }
  return counted ? total : null;
}

export function buildStatusSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return {
      entries: [],
      runs: [],
      total: {
        kind: "total",
        description: "Total Rentable Units",
        count: 0,
        percent: null,
        runs: [],
      },
    };
  }

  const descriptionsByRun = STATUS_RUNS.map(() => new Map());
  for (const row of list) {
    const key = rollOccupancy(row);
    const description =
      OCCUPANCY_LABELS[key] ||
      byUnitCell(row, "occupancySummary") ||
      "Occupancy not determined";
    const runIndex = STATUS_RUNS.findIndex(
      (run, index) =>
        index === STATUS_RUNS.length - 1 || run.keys.includes(key),
    );
    const descriptions = descriptionsByRun[runIndex];
    descriptions.set(description, (descriptions.get(description) || 0) + 1);
  }

  const entries = [];
  const runs = [];
  const runsByKey = new Map();
  for (let index = 0; index < STATUS_RUNS.length; index += 1) {
    const run = STATUS_RUNS[index];
    const descriptions = [...descriptionsByRun[index].entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    if (!descriptions.length) continue;

    const start = entries.length;
    let count = 0;
    for (const [description, descriptionCount] of descriptions) {
      count += descriptionCount;
      entries.push({
        kind: "detail",
        description,
        count: descriptionCount,
        percent: percentOf(descriptionCount, list.length),
      });
    }
    const length = descriptions.length;
    const runMetadata = { start, length };
    runs.push({ key: run.key, ...runMetadata });
    runsByKey.set(run.key, { ...runMetadata, count });
    entries.push({
      kind: "subtotal",
      description: run.label,
      count,
      percent: percentOf(count, list.length),
      run: runMetadata,
    });
  }

  if (runsByKey.has("pending")) {
    const parts = LEASED_PLUS_PENDING_RUN_KEYS.map((key) =>
      runsByKey.get(key),
    ).filter(Boolean);
    const count = parts.reduce((total, part) => total + part.count, 0);
    entries.push({
      kind: "derived",
      description: LEASED_PLUS_PENDING_LABEL,
      count,
      percent: percentOf(count, list.length),
      runs: parts.map(({ start, length }) => ({ start, length })),
    });
  }

  entries.push({
    kind: "total",
    description: "Total Rentable Units",
    count: list.length,
    percent: percentOf(list.length, list.length),
    runs: runs.map(({ start, length }) => ({ start, length })),
  });
  return { entries, runs, total: entries[entries.length - 1] };
}

export function buildChargeSummary(rows, chargeColumns) {
  const columns = buildRentRollColumns(chargeColumns);
  const rentColumn = columns.find(
    (column) => column && column.key === "rentCharges",
  );
  const perCodeColumns = columns.filter(
    (column) => column && column.charge === true,
  );
  const chargeEntries =
    Array.isArray(rows) && rows.length
      ? [rentColumn, ...perCodeColumns].filter(Boolean)
      : [];
  const totals = buildColumnTotals(rows, columns);
  const chargeColumnByCode = new Map(
    (Array.isArray(chargeColumns) ? chargeColumns : [])
      .filter((column) => column && column.code != null)
      .map((column) => [column.code, column]),
  );

  const entries = chargeEntries.map((column) => {
    const code = column.charge ? column.key.slice("charge:".length) : "rent";
    const source = chargeColumnByCode.get(code);
    const total = totals.get(column.key);
    return {
      key: column.key,
      code,
      label: column.label,
      scheduled: total ? total.sum : null,
      type: column.charge ? (source ? source.type || null : null) : "Rent",
      actual: null,
    };
  });

  if (!chargeEntries.length) {
    return {
      groups: [],
      total: { scheduled: null, actual: null },
    };
  }

  const group = {
    ledger: "Scheduled Charges",
    entries,
    subtotal: {
      scheduled: sumNullable(entries.map((entry) => entry.scheduled)),
      actual: null,
    },
    run: { start: 0, length: entries.length },
  };
  const groups = [group];
  return {
    groups,
    total: {
      scheduled: sumNullable(groups.map((item) => item.subtotal.scheduled)),
      actual: null,
    },
  };
}

export function buildRentRollSummary({ rows, chargeColumns } = {}) {
  return {
    status: buildStatusSummary(rows),
    charges: buildChargeSummary(rows, chargeColumns),
  };
}
