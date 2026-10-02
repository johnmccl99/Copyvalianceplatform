import {
  RENT_ROLL_SUPERSEDED_ROWS_KEY,
  rentRollRowSupersedes,
} from "./entrataLeaseStatus.js";
import { bedKeyOf } from "./rentRollBedCensus.js";

function isLeaseRow(row) {
  return !!row && typeof row === "object" && row.lease_id != null;
}

export function dedupeRentRollBedRows(rows) {
  if (!Array.isArray(rows)) return [];

  const winnerAt = new Map();
  const superseded = [];
  const out = [];

  for (const row of rows) {
    const key = isLeaseRow(row) ? bedKeyOf(row) : null;
    if (key == null) {
      out.push(row);
      continue;
    }
    const at = winnerAt.get(key);
    if (at === undefined) {
      winnerAt.set(key, out.length);
      out.push(row);
      continue;
    }
    const incumbent = out[at];
    if (rentRollRowSupersedes(row, incumbent)) {
      superseded.push(incumbent);
      out[at] = row;
    } else {
      superseded.push(row);
    }
  }

  Object.defineProperty(out, RENT_ROLL_SUPERSEDED_ROWS_KEY, {
    value: superseded,
    enumerable: false,
  });
  return out;
}
