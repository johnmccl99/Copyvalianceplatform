export const WATERFALL_EXAMPLE_SEED = Object.freeze({
  exitPrice: 100000000,
  equityBasis: 40000000,
  prefRatePct: 8,
  catchUpSplitPct: 80,
  promoteRatePct: 20,
  holdYears: 5,
});

export const GP_EQUITY_SHARE_OF_BASIS = 0.05;

export const WATERFALL_EXAMPLE_BANNER =
  "Example scenario. These slider positions are illustrative defaults, not a deal " +
  "of yours — no figure below is drawn from your portfolio. Move any slider to model " +
  "your own terms.";

export const WATERFALL_INPUT_BANNER =
  "Hypothetical scenario, computed from the slider assumptions below. Nothing here " +
  "is read from your portfolio or from an ingested model.";

export const WATERFALL_EXAMPLE_TAG = "EXAMPLE";

export const WATERFALL_ASSUMPTION_NOTE =
  `GP multiple and GP IRR assume GP co-invest at ${(GP_EQUITY_SHARE_OF_BASIS * 100).toFixed(0)}% ` +
  "of the equity basis; the modeller has no deal document to read it from.";

export function isWaterfallExampleState(state) {
  if (!state || typeof state !== "object") return false;
  return Object.keys(WATERFALL_EXAMPLE_SEED).every(
    (k) => state[k] === WATERFALL_EXAMPLE_SEED[k],
  );
}

export function waterfallBannerCopy(state) {
  return isWaterfallExampleState(state)
    ? WATERFALL_EXAMPLE_BANNER
    : WATERFALL_INPUT_BANNER;
}
