export const MAX_DRILL_DEPTH = 5;

export const NESTED_ROW_CAP = 200;

export const ARRAY_PRIMITIVES_PREVIEW_LIMIT = 10;

export function unwrapEntrataKeyedArray(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  if (keys.length !== 1) return value;
  const inner = value[keys[0]];
  return Array.isArray(inner) ? inner : value;
}

export function classifyValue(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array-empty";
    const hasObject = value.some((v) => v !== null && typeof v === "object");
    return hasObject ? "array-objects" : "array-primitives";
  }
  if (typeof value === "object") return "object";
  return "primitive";
}

export function isDrillable(mode) {
  return mode === "array-objects" || mode === "object";
}

export function getColumnHeaders(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const seen = new Set();
  const headers = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return headers;
}

export function objectToKeyValueRows(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

export function describeDrillDownValue(value) {
  const unwrapped = unwrapEntrataKeyedArray(value);
  const mode = classifyValue(unwrapped);

  if (mode === "array-empty") {
    return { mode, label: "0 items", count: 0, value: unwrapped };
  }
  if (mode === "array-objects" || mode === "array-primitives") {
    const count = unwrapped.length;
    return {
      mode,
      label: `${count} ${count === 1 ? "item" : "items"}`,
      count,
      value: unwrapped,
    };
  }
  if (mode === "object") {
    const count = Object.keys(unwrapped).length;
    return {
      mode,
      label: `${count} ${count === 1 ? "key" : "keys"}`,
      count,
      value: unwrapped,
    };
  }
  return { mode, label: null, count: 0, value: unwrapped };
}

export function formatPrimitiveCell(value) {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export function formatPrimitivesArrayPreview(
  arr,
  limit = ARRAY_PRIMITIVES_PREVIEW_LIMIT,
) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const slice = arr
    .slice(0, limit)
    .map((v) => (v === null || v === undefined ? "—" : String(v)));
  if (arr.length > limit) {
    return `${slice.join(", ")}, +${arr.length - limit} more`;
  }
  return slice.join(", ");
}
