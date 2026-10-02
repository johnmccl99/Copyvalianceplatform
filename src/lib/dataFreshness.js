export const GL_SYNC_WINDOW_CAPTION =
  "GL sync window: the latest 3 months refresh on every pass; earlier months back to Jul 2023 refresh one per pass, plus up to 6 repair months.";

export function freshnessCaption({ loaded, maxLastSeen, scope = "Data" } = {}) {
  if (!loaded) return "Checking data freshness…";
  if (!maxLastSeen) return `${scope} freshness unknown for this property`;
  return `${scope} current as of ${new Date(maxLastSeen).toLocaleString()}`;
}
