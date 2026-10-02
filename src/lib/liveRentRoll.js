import {
  fetchEntrataRentRoll,
  fetchLeaseAdjustments,
  fetchEntrataUnitRoster,
  fetchEntrataLeaseSpaceIds,
  fetchEntrataRentRollChargeMatrix,
  fetchEntrataUnitAttributes,
  fetchWorkbookSpaceSf,
} from "./supabaseClient.js";
import { fetchWorkbookSpaceMarketRent } from "./rentRollWorkbookMarketRent.js";
import {
  indexUnitAttributes,
  attachUnitAttributesToRows,
} from "./rentRollUnitAttributes.js";
import { splitGroupLeaseRows } from "./rentRollBedSplit.js";
import { dedupeRentRollBedRows } from "./rentRollBedDedupe.js";
import { attachGprToRows } from "./rentRollGpr.js";
import { attachBedspaceSfToRows } from "./rentRollBedspaceSf.js";
import { overlayAdjustments } from "./rentRollAdjustments.js";
import { applyFieldOverridesToRows } from "./rentRollFieldOverrides.js";
import { normalizeAsOf } from "./entrataLeaseStatus.js";
import { rentRollPeriod } from "./rentRollPeriod.js";
import {
  attachChargesToRows,
  deriveChargeColumns,
  withMarketUtilityColumn,
  withChargeOverrideColumns,
} from "./rentRollChargeColumns.js";
import { fetchPropertyMarketUtility } from "./rentRollMarketUtility.js";
import {
  applyMatsWorkbookRents,
  fetchPropertyMatsWorkbookRents,
} from "./rentRollMatsWorkbookRent.js";
import { RENT_PLAUSIBLE_MIN, leaseNotMovedIn } from "./rentRollView.js";
import {
  extractUnitSpaces,
  leasedSpaceIdsFrom,
  buildVacancyRows,
  spaceOccupancy,
  expandGroupLeaseSpaceNumbers,
  rosterSpaceNumberSet,
  spaceIdByNumber,
} from "./rentRollSpaces.js";

const NO_ROSTER = Object.freeze({
  spaces: [],
  rosterRows: [],
  leasedSpaceIds: null,
  occupancy: null,
});

const NO_HIDDEN_BED_ROWS = Object.freeze([]);

const NO_LEASED_SPACES = Object.freeze(new Set());

export async function loadLiveRentRollOverlay(propertyId, options = {}) {
  const asOf = normalizeAsOf(options.asOf);
  const includeRoster = options.includeRoster === true;
  if (!propertyId) {
    const empty = overlayAdjustments([], [], { asOf });
    return {
      rows: empty.rows,
      summary: empty.summary,
      baseRows: [],
      adjustments: [],
      asOf,
      chargeColumns: [],
      hiddenLeaseBedRows: NO_HIDDEN_BED_ROWS,
      ...NO_ROSTER,
    };
  }
  const [
    baseRows,
    adjustments,
    roster,
    spaceIdByLease,
    chargeRows,
    unitAttrRows,
    workbookSfRows,
    workbookMarketRows,
    marketUtility,
    matsWorkbookRents,
  ] = await Promise.all([
    fetchEntrataRentRoll(propertyId, { asOf }),
    fetchLeaseAdjustments(propertyId).catch((e) => {
      console.error(
        "loadLiveRentRollOverlay: adjustments load failed; rendering base roll only",
        e,
      );
      return [];
    }),
    includeRoster
      ? fetchEntrataUnitRoster(propertyId).catch((e) => {
          console.error(
            "loadLiveRentRollOverlay: unit roster load failed; rendering leases only",
            e,
          );
          return [];
        })
      : Promise.resolve([]),
    includeRoster
      ? fetchEntrataLeaseSpaceIds(propertyId).catch((e) => {
          console.error(
            "loadLiveRentRollOverlay: lease space-id load failed; rendering leases only",
            e,
          );
          return new Map();
        })
      : Promise.resolve(new Map()),
    fetchEntrataRentRollChargeMatrix(propertyId, { asOf }).catch((e) => {
      console.error(
        "loadLiveRentRollOverlay: charge matrix load failed; rendering base columns only",
        e,
      );
      return [];
    }),
    fetchEntrataUnitAttributes(propertyId).catch((e) => {
      console.error(
        "loadLiveRentRollOverlay: unit attributes load failed; rendering without Unit Type / Unit SF",
        e,
      );
      return [];
    }),
    fetchWorkbookSpaceSf(propertyId).catch((e) => {
      console.error(
        "loadLiveRentRollOverlay: workbook bedspace SF load failed; falling back to Entrata SquareFeet",
        e,
      );
      return [];
    }),
    fetchWorkbookSpaceMarketRent(propertyId).catch((e) => {
      console.error(
        "loadLiveRentRollOverlay: workbook market rent load failed; weighting the whole-unit split by Entrata market rent instead",
        e,
      );
      return [];
    }),
    fetchPropertyMarketUtility(propertyId).catch((e) => {
      console.error(
        "loadLiveRentRollOverlay: market utility load failed; rendering the roll without the market utility reallocation",
        e,
      );
      return null;
    }),
    fetchPropertyMatsWorkbookRents(propertyId, asOf).catch((e) => {
      console.error(
        "loadLiveRentRollOverlay: workbook MATS rent load failed; rendering those beds on their Entrata rent",
        e,
      );
      return new Map();
    }),
  ]);
  const chargeAsOf = rentRollPeriod(asOf).end;
  const base = baseRows || [];
  const adj = adjustments || [];
  const { rows: overlaidRows, summary: overlaySummary } = overlayAdjustments(
    base,
    adj,
    { asOf },
  );

  const rows = applyMatsWorkbookRents(overlaidRows, matsWorkbookRents);

  const summary = {
    ...overlaySummary,
    totalEffectiveRent: rows.reduce(
      (acc, r) => acc + (Number(r.effective_rent) || 0),
      0,
    ),
  };

  const roll = includeRoster
    ? withRoster(rows, roster, spaceIdByLease)
    : { rows, ...NO_ROSTER };

  const unitAttrIndex = indexUnitAttributes(unitAttrRows || []);

  const spacesForGpr = extractUnitSpaces(unitAttrRows || []);

  const includeOneTime = options.includeOneTime === true;
  const enrich = (rs) =>
    applyFieldOverridesToRows(
      attachChargesToRows(
        attachBedspaceSfToRows(
          attachGprToRows(
            attachUnitAttributesToRows(rs, unitAttrIndex),
            spacesForGpr,
          ),
          spacesForGpr,
          workbookSfRows || [],
        ),
        chargeRows || [],
        RENT_PLAUSIBLE_MIN,
        chargeAsOf,
        { includeOneTime, marketUtility, defaultAbsentDeposit: true },
      ),
    );
  const rowsWithCharges = enrich(roll.rows);

  const hiddenLeaseBedRows = roll.leasedSpaceIds
    ? enrich(
        buildVacancyRows(
          (roll.spaces || []).filter(
            (s) => s && roll.leasedSpaceIds.has(s.unit_space_id),
          ),
          NO_LEASED_SPACES,
        ),
      )
    : NO_HIDDEN_BED_ROWS;

  const finalRows =
    options.splitGroupLeases === true
      ? dedupeRentRollBedRows(
          splitGroupLeaseRows(
            rowsWithCharges,
            spacesForGpr,
            workbookSfRows || [],
            workbookMarketRows || [],
          ),
        )
      : rowsWithCharges;

  const chargeColumns = withChargeOverrideColumns(
    withMarketUtilityColumn(
      deriveChargeColumns(chargeRows || [], finalRows.length, {
        includeOneTime,
        asOf: chargeAsOf,
      }),
      finalRows,
      finalRows.length,
    ),
    finalRows,
    finalRows.length,
  );

  const stampedRows = finalRows.map((r) =>
    leaseNotMovedIn(r, asOf) ? { ...r, not_moved_in: true } : r,
  );

  return {
    rows: stampedRows,
    summary,
    baseRows: base,
    adjustments: adj,
    asOf,
    spaces: roll.spaces,
    rosterRows: roll.rosterRows,
    hiddenLeaseBedRows,
    occupancy: roll.occupancy,
    chargeColumns,
    marketUtility: marketUtility == null ? null : marketUtility,
  };
}

function withRoster(rows, rosterUnitRows, spaceIdByLease) {
  const spaces = extractUnitSpaces(rosterUnitRows);
  if (!spaces.length) return { rows, ...NO_ROSTER };

  const ids = spaceIdByLease instanceof Map ? spaceIdByLease : new Map();
  const statusBySpaceId = new Map();
  for (const sp of spaces) {
    if (sp && sp.unit_space_id != null && sp.availability_status) {
      statusBySpaceId.set(sp.unit_space_id, sp.availability_status);
    }
  }
  const withIds = rows.map((r) => {
    if (!r) return r;
    const spaceId =
      r.unit_space_id != null
        ? r.unit_space_id
        : r.lease_id == null
          ? undefined
          : ids.get(r.lease_id);
    if (spaceId == null) return r;
    const next = r.unit_space_id != null ? r : { ...r, unit_space_id: spaceId };
    if (next.availability_status != null) return next;
    const avail = statusBySpaceId.get(spaceId);
    return avail ? { ...next, availability_status: avail } : next;
  });

  const leasedSpaceIds = leasedSpaceIdsFrom(withIds);
  if (rows.length > 0 && leasedSpaceIds.size === 0) {
    console.error(
      "loadLiveRentRollOverlay: no lease resolved to a unit space id across " +
        rows.length +
        " rows; skipping the bed roster rather than publishing false vacancies",
    );
    return { rows, ...NO_ROSTER };
  }

  const numbers = rosterSpaceNumberSet(spaces);
  const byNumber = spaceIdByNumber(spaces);
  for (const row of withIds) {
    if (!row || typeof row !== "object") continue;
    const unitNumber = row.unit_number;
    if (typeof unitNumber !== "string" || !unitNumber.includes(",")) continue;
    for (const name of expandGroupLeaseSpaceNumbers(unitNumber, numbers)) {
      const id = byNumber.get(name);
      if (id != null) leasedSpaceIds.add(id);
    }
  }

  const rosterRows = buildVacancyRows(spaces, leasedSpaceIds);
  return {
    rows: withIds.concat(rosterRows),
    spaces,
    rosterRows,
    leasedSpaceIds,
    occupancy: spaceOccupancy(spaces, leasedSpaceIds),
  };
}
