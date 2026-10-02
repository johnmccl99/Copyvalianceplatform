export function countRows(source) {
  if (Array.isArray(source)) return source.length;
  if (source && typeof source === "object") return Object.keys(source).length;
  return null;
}

export function acqFolderCounts(sources) {
  const out = {};
  if (!sources || typeof sources !== "object") return out;
  for (const [key, source] of Object.entries(sources)) {
    out[key] = countRows(source);
  }
  return out;
}

export function closingSoonCount(
  rows,
  { now = new Date(), withinDays = 90 } = {},
) {
  if (!Array.isArray(rows)) return 0;
  const start = now.getTime();
  const end = start + withinDays * 24 * 60 * 60 * 1000;
  return rows.filter((r) => {
    const t = Date.parse(r?.closeDate);
    return Number.isFinite(t) && t >= start && t <= end;
  }).length;
}
