import { IN_DEVELOPMENT_LABEL } from "./navSections.js";

export function getInDevelopmentKeys(sections) {
  const keys = new Set();
  if (!Array.isArray(sections)) return keys;
  const bucket = sections.find((s) => s && s.label === IN_DEVELOPMENT_LABEL);
  if (!bucket || !Array.isArray(bucket.items)) return keys;
  for (const item of bucket.items) {
    if (item && typeof item.key === "string" && item.key) keys.add(item.key);
  }
  return keys;
}

export function isInDevelopment(key, keys) {
  return keys instanceof Set && typeof key === "string" && keys.has(key);
}

export const DEV_MARKERS_STORAGE_KEY = "devMarkers";

function devMarkersStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readDevMarkersFlag(storage = devMarkersStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(DEV_MARKERS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDevMarkersFlag(on, storage = devMarkersStorage()) {
  try {
    storage?.setItem(DEV_MARKERS_STORAGE_KEY, on ? "1" : "0");
  } catch {}
  return !!on;
}
