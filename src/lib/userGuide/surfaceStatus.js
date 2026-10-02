import manifest from "./statusManifest.json";

const STATUS_BY_KEY = (() => {
  const map = Object.create(null);
  const surfaces =
    manifest && Array.isArray(manifest.surfaces) ? manifest.surfaces : [];
  for (const s of surfaces) {
    if (s && typeof s.key === "string" && s.key.length > 0) {
      map[s.key] = s.status;
    }
  }
  return map;
})();

export function getSurfaceStatus(surfaceKey) {
  if (typeof surfaceKey !== "string" || surfaceKey.length === 0) return null;
  return STATUS_BY_KEY[surfaceKey] ?? null;
}

export function isPreviewLike(status) {
  return status === "Preview" || status === "Planned";
}
