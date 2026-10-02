export const rowKey = (row) => (row && row._key != null ? row._key : null);

export function toggleRowSelection(selected, key) {
  const next = new Set(selected || []);
  if (key == null) return next;
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function selectAllVisible(selected, visibleRows) {
  const next = new Set(selected || []);
  for (const row of visibleRows || []) {
    const k = rowKey(row);
    if (k != null) next.add(k);
  }
  return next;
}

export function deselectAllVisible(selected, visibleRows) {
  const next = new Set(selected || []);
  for (const row of visibleRows || []) next.delete(rowKey(row));
  return next;
}

export function pruneSelection(selected, allRows) {
  const live = new Set((allRows || []).map(rowKey));
  const next = new Set();
  for (const k of selected || []) if (live.has(k)) next.add(k);
  return next;
}

export function summarizeSelection(selected, allRows, visibleRows) {
  const pruned = pruneSelection(selected, allRows);
  const visible = visibleRows || [];
  let visibleSelected = 0;
  for (const row of visible) if (pruned.has(rowKey(row))) visibleSelected += 1;
  return {
    selected: pruned.size,
    visibleSelected,
    hiddenSelected: pruned.size - visibleSelected,
    allVisibleSelected:
      visible.length > 0 && visibleSelected === visible.length,
    someVisibleSelected:
      visibleSelected > 0 && visibleSelected < visible.length,
  };
}

export function selectionSummary(stats) {
  if (!stats || stats.selected === 0) return "";
  const noun = stats.selected === 1 ? "line" : "lines";
  let text = `${stats.selected} ${noun} selected.`;
  if (stats.hiddenSelected > 0) {
    const s = stats.hiddenSelected === 1 ? "" : "s";
    text += ` ${stats.hiddenSelected} of them ${stats.hiddenSelected === 1 ? "is" : "are"} hidden by the current filter — clear the filter to see ${s ? "them" : "it"}.`;
  }
  return text;
}

export function selectedRows(selected, allRows) {
  const pruned = pruneSelection(selected, allRows);
  return (allRows || []).filter((r) => pruned.has(rowKey(r)));
}
