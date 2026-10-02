export function leadingVisibleColumn({
  columns = [],
  scrollLeft = 0,
  frozenWidth = 0,
  maxScrollLeft = null,
  tolerance = 2,
} = {}) {
  if (!columns.length) return null;
  if (
    maxScrollLeft != null &&
    maxScrollLeft > 0 &&
    scrollLeft >= maxScrollLeft - tolerance
  ) {
    return columns[columns.length - 1].key;
  }
  const edge = frozenWidth - tolerance;
  for (const col of columns) {
    if (col.left - scrollLeft >= edge) return col.key;
  }
  return columns[columns.length - 1].key;
}

export function frozenWidthBefore(target) {
  let width = 0;
  for (const cell of Array.from(target?.parentElement?.children || [])) {
    if (cell === target) break;
    const s = cell.style || {};
    if (s.position !== "sticky" || s.left === "") break;
    width += cell.offsetWidth || 0;
  }
  return width;
}
