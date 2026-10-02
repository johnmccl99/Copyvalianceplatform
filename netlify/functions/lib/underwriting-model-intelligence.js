export function classifyInputs(graph) {
  const inputs = new Map();
  for (const node of graph.nodes || []) {
    if (node.formula) continue;
    const sheet = node.sheet;
    const cell = node.cell?.toUpperCase();
    if (!sheet || !cell) continue;

    let kind = null;
    let value = null;
    if (typeof node.value_num === "number" && Number.isFinite(node.value_num)) {
      kind = "number";
      value = node.value_num;
    } else if (node.value_date) {
      kind = "date";
      value = node.value_date;
    } else if (typeof node.value_text === "string" && node.value_text.trim()) {
      const text = node.value_text.trim();
      if (looksLikeLabelText(text)) continue;
      kind = "text";
      value = text;
    } else {
      continue;
    }

    inputs.set(`${sheet}\x00${cell}`, {
      sheet,
      cell,
      kind,
      value,
      label_hint: node.label_hint || null,
    });
  }
  return inputs;
}

const LABEL_PATTERNS = [
  /^(unit\s*type|unit\s*mix|count|total|subtotal|wtd\s*avg|grand\s*total)$/i,
  /^(sheet|column|row|header|label|description|notes?)$/i,
  /^(yes|no|true|false|n\/a|tbd|tba|see\s*notes?)$/i,
  /^[-–—]+$/,
  /^(rc|rtl|bmr|adu|market|existing|stabilized|renovated)$/i,
];

function looksLikeLabelText(text) {
  if (text.length > 100) return false;
  return LABEL_PATTERNS.some((p) => p.test(text));
}

export function buildIncomingEdgeIndex(graph) {
  const index = new Map();
  for (const edge of graph.edges || []) {
    const targetSheet = edge.to_sheet || edge.target_sheet || edge.dst_sheet;
    const targetCell = (
      edge.to_cell ||
      edge.target_cell ||
      edge.dst_cell
    )?.toUpperCase();
    if (!targetSheet || !targetCell) continue;
    const key = `${targetSheet}\x00${targetCell}`;
    index.set(key, (index.get(key) || 0) + 1);
  }
  return index;
}

export function findCanonicalRanges(graph, options = {}) {
  const {
    sheet = null,
    minIncoming = 2,
    minCellCount = 3,
    maxRowGap = 1,
    maxColGap = 0,
  } = options;

  const incoming = buildIncomingEdgeIndex(graph);

  const popular = [];
  for (const node of graph.nodes || []) {
    if (sheet && node.sheet !== sheet) continue;
    const key = `${node.sheet}\x00${node.cell?.toUpperCase()}`;
    const count = incoming.get(key) || 0;
    if (count < minIncoming) continue;
    const parsed = parseCellRef(node.cell);
    if (!parsed) continue;
    popular.push({
      sheet: node.sheet,
      cell: node.cell.toUpperCase(),
      col: parsed.col,
      row: parsed.row,
      colNum: colToNumber(parsed.col),
      incoming: count,
      label_hint: node.label_hint || null,
      value_text: node.value_text || null,
    });
  }

  const clusters = unionFindCluster(popular, maxRowGap, maxColGap);

  const ranges = [];
  for (const cluster of clusters) {
    if (cluster.length < minCellCount) continue;
    let minCol = Infinity,
      maxCol = -Infinity,
      minRow = Infinity,
      maxRow = -Infinity;
    let totalIncoming = 0;
    for (const c of cluster) {
      if (c.colNum < minCol) minCol = c.colNum;
      if (c.colNum > maxCol) maxCol = c.colNum;
      if (c.row < minRow) minRow = c.row;
      if (c.row > maxRow) maxRow = c.row;
      totalIncoming += c.incoming;
    }
    const startCol = numberToCol(minCol);
    const endCol = numberToCol(maxCol);
    const headerCell = cluster.find((c) => c.label_hint || c.value_text);
    ranges.push({
      sheet: cluster[0].sheet,
      startCell: `${startCol}${minRow}`,
      endCell: `${endCol}${maxRow}`,
      startCol,
      endCol,
      startRow: minRow,
      endRow: maxRow,
      totalIncoming,
      cellCount: cluster.length,
      headerLabel: headerCell?.label_hint || headerCell?.value_text || null,
    });
  }

  ranges.sort((a, b) => b.totalIncoming - a.totalIncoming);
  return ranges;
}

export function traceDependencies(graph, sheet, cell) {
  const upperCell = cell.toUpperCase();
  const memo = new Map();
  const inputsByKey = classifyInputs(graph);

  const nodeByKey = new Map();
  for (const n of graph.nodes || []) {
    nodeByKey.set(`${n.sheet}\x00${n.cell?.toUpperCase()}`, n);
  }

  const outgoing = new Map();
  for (const edge of graph.edges || []) {
    const fromKey = `${edge.from_sheet || edge.src_sheet}\x00${(edge.from_cell || edge.src_cell)?.toUpperCase()}`;
    const target = {
      sheet: edge.to_sheet || edge.target_sheet || edge.dst_sheet,
      cell: (edge.to_cell || edge.target_cell || edge.dst_cell)?.toUpperCase(),
    };
    if (!fromKey || !target.sheet || !target.cell) continue;
    if (!outgoing.has(fromKey)) outgoing.set(fromKey, []);
    outgoing.get(fromKey).push(target);
  }

  function walk(curSheet, curCell, depth = 0) {
    if (depth > 50)
      return {
        formula: null,
        directRefs: [],
        transitiveInputs: [],
        cyclic: true,
      };
    const key = `${curSheet}\x00${curCell.toUpperCase()}`;
    if (memo.has(key)) return memo.get(key);

    const node = nodeByKey.get(key);
    if (!node) {
      const empty = {
        formula: null,
        directRefs: [],
        transitiveInputs: [],
        notFound: true,
      };
      memo.set(key, empty);
      return empty;
    }

    if (!node.formula) {
      const inputEntry = inputsByKey.get(key);
      const result = {
        formula: null,
        directRefs: [],
        transitiveInputs: inputEntry
          ? [
              {
                sheet: curSheet,
                cell: curCell,
                value: inputEntry.value,
                kind: inputEntry.kind,
              },
            ]
          : [],
      };
      memo.set(key, result);
      return result;
    }

    const refs = outgoing.get(key) || [];
    const transitiveInputs = [];
    const seenInputs = new Set();
    for (const ref of refs) {
      const sub = walk(ref.sheet, ref.cell, depth + 1);
      for (const ti of sub.transitiveInputs) {
        const tk = `${ti.sheet}\x00${ti.cell}`;
        if (!seenInputs.has(tk)) {
          seenInputs.add(tk);
          transitiveInputs.push(ti);
        }
      }
    }
    const result = {
      formula: node.formula,
      directRefs: refs,
      transitiveInputs,
    };
    memo.set(key, result);
    return result;
  }

  return walk(sheet, upperCell);
}

export function domainTagsForUnitType(unitType) {
  const tags = {
    is_rent_controlled: false,
    renovation_cycle: null,
    is_adu: false,
    is_bmr: false,
    unit_class: "residential",
  };
  if (!unitType || typeof unitType !== "string") return tags;
  const t = unitType.trim();

  if (/\bRC\d*\b/i.test(t)) {
    tags.is_rent_controlled = true;
  }

  const renoMatch = t.match(/\bR(\d+)(?![a-zA-Z])\b/);
  if (renoMatch) {
    tags.renovation_cycle = parseInt(renoMatch[1], 10);
  }
  const renoLongMatch = t.match(/\bReno\s*(\d+)/i);
  if (renoLongMatch) {
    tags.renovation_cycle = parseInt(renoLongMatch[1], 10);
  }

  if (/\bADU\b/i.test(t)) tags.is_adu = true;
  if (/\bBMR\b/i.test(t)) {
    tags.is_bmr = true;
    tags.unit_class = "affordable";
  }
  if (/\bRTL\b/i.test(t)) tags.unit_class = "retail";

  return tags;
}

function parseCellRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  const m = String(ref)
    .replace(/\$/g, "")
    .match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  return { col: m[1].toUpperCase(), row: parseInt(m[2], 10) };
}

function colToNumber(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function numberToCol(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function unionFindCluster(cells, maxRowGap, maxColGap) {
  const parent = new Map();
  function find(k) {
    if (parent.get(k) === k) return k;
    const root = find(parent.get(k));
    parent.set(k, root);
    return root;
  }
  function union(a, b) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const cellKey = (c) => `${c.sheet}\x00${c.cell}`;
  for (const c of cells) parent.set(cellKey(c), cellKey(c));

  const bySheet = new Map();
  for (const c of cells) {
    if (!bySheet.has(c.sheet)) bySheet.set(c.sheet, []);
    bySheet.get(c.sheet).push(c);
  }

  for (const [_sheet, sheetCells] of bySheet) {
    const sorted = sheetCells
      .slice()
      .sort((a, b) => a.colNum - b.colNum || a.row - b.row);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.colNum - a.colNum > maxColGap + 1) break;
        const colDiff = Math.abs(b.colNum - a.colNum);
        const rowDiff = Math.abs(b.row - a.row);
        if (colDiff <= maxColGap + 1 && rowDiff <= maxRowGap + 1) {
          union(cellKey(a), cellKey(b));
        }
      }
    }
  }

  const clusters = new Map();
  for (const c of cells) {
    const root = find(cellKey(c));
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(c);
  }
  return Array.from(clusters.values());
}

export const _internal = {
  classifyInputs,
  buildIncomingEdgeIndex,
  findCanonicalRanges,
  traceDependencies,
  domainTagsForUnitType,
  parseCellRef,
  colToNumber,
  numberToCol,
  looksLikeLabelText,
  LABEL_PATTERNS,
};
