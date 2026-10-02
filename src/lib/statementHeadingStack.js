export const DEFAULT_MAX_STACK_FRACTION = 1 / 3;

export function headingRanges(markers, contentHeight) {
  const list = Array.isArray(markers) ? markers : [];
  const bottom = Number.isFinite(contentHeight) ? contentHeight : Infinity;
  const out = [];
  list.forEach((marker, i) => {
    if (marker.kind === "total") return;
    let end = bottom;
    for (let j = i + 1; j < list.length; j += 1) {
      const next = list[j];
      if (next.kind === "total") {
        if (next.depth < marker.depth) {
          end = next.top;
          break;
        }
        if (next.depth === marker.depth) {
          end = next.top + next.height;
          break;
        }
        continue;
      }
      if (next.depth <= marker.depth) {
        end = next.top;
        break;
      }
    }
    out.push({ ...marker, end });
  });
  return out;
}

export function pinnedHeadingStack({
  markers = [],
  scrollTop = 0,
  headerHeight = 0,
  viewportHeight = 0,
  contentHeight = Infinity,
  maxStackFraction = DEFAULT_MAX_STACK_FRACTION,
} = {}) {
  const cursor = scrollTop + headerHeight;
  const ranges = headingRanges(markers, contentHeight);

  let chain = ranges.filter((h) => h.top < cursor && h.end > cursor);

  const cap = Math.max(0, viewportHeight - headerHeight) * maxStackFraction;
  let stackHeight = chain.reduce((sum, h) => sum + h.height, 0);
  while (chain.length > 1 && stackHeight > cap) {
    stackHeight -= chain[0].height;
    chain = chain.slice(1);
  }

  const placed = chain.map((h) => ({ ...h, top: 0 }));
  let y = headerHeight;
  for (const entry of placed) {
    entry.top = y;
    y += entry.height;
  }

  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const entry = placed[i];
    const groupEndY = entry.end - scrollTop;
    let limit = groupEndY - entry.height;
    if (i < placed.length - 1)
      limit = Math.min(limit, placed[i + 1].top - entry.height);
    if (limit < entry.top) entry.top = limit;
  }

  return placed
    .filter((entry) => entry.top + entry.height > headerHeight)
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      depth: entry.depth,
      height: entry.height,
      top: entry.top,
    }));
}
