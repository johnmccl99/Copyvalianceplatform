import { evaluateFormula } from "./excel-formula-evaluator.js";

const KEY_SEP = "\x00";
const keyOf = (sheet, cell) =>
  `${sheet}${KEY_SEP}${String(cell).toUpperCase()}`;
const splitKey = (k) => {
  const idx = k.indexOf(KEY_SEP);
  return [k.slice(0, idx), k.slice(idx + 1)];
};

function groupBySheet(cellKeys) {
  const m = new Map();
  for (const k of cellKeys) {
    const [s, c] = splitKey(k);
    if (!m.has(s)) m.set(s, new Set());
    m.get(s).add(c);
  }
  return m;
}

export async function findDependents(dirtyCells, dataSource, opts = {}) {
  const maxCells = opts.maxCells ?? 200_000;

  if (typeof dataSource.findDependentsRPC === "function") {
    const rows = await dataSource.findDependentsRPC(dirtyCells);
    const visited = new Set();
    for (const r of rows) {
      visited.add(keyOf(r.sheet, r.cell));
      if (visited.size > maxCells) {
        throw new Error(
          `recompute: dependency closure exceeded maxCells=${maxCells} (RPC)`,
        );
      }
    }
    for (const dc of dirtyCells) visited.add(keyOf(dc.sheet, dc.cell));
    return visited;
  }

  const maxRounds = opts.maxRounds ?? 30;
  const visited = new Set();
  let frontier = new Set();
  for (const dc of dirtyCells) {
    const k = keyOf(dc.sheet, dc.cell);
    visited.add(k);
    frontier.add(k);
  }

  let rounds = 0;
  while (frontier.size > 0 && rounds < maxRounds) {
    rounds += 1;
    const grouped = groupBySheet(frontier);
    const edges = await dataSource.fetchEdgesByTo(grouped);
    const newFrontier = new Set();
    for (const e of edges) {
      const fk = keyOf(e.from_sheet, e.from_cell);
      if (!visited.has(fk)) {
        visited.add(fk);
        newFrontier.add(fk);
        if (visited.size > maxCells) {
          throw new Error(
            `recompute: dependency closure exceeded maxCells=${maxCells} after ${rounds} rounds`,
          );
        }
      }
    }
    frontier = newFrontier;
  }

  return visited;
}

function buildAdjacency(nodes, parseFormula, namedRanges = null) {
  const formulaKeys = new Set();
  const adj = new Map();
  const reverseAdj = new Map();
  const inDegree = new Map();
  for (const n of nodes) {
    if (n.formula) {
      const k = keyOf(n.sheet, n.cell);
      formulaKeys.add(k);
      adj.set(k, new Set());
      reverseAdj.set(k, new Set());
      inDegree.set(k, 0);
    }
  }
  for (const n of nodes) {
    if (!n.formula) continue;
    const k = keyOf(n.sheet, n.cell);
    let ast;
    try {
      ast = parseFormula(n.formula, n.sheet);
    } catch {
      continue;
    }
    visit(
      ast,
      n.sheet,
      (depKey) => {
        if (
          formulaKeys.has(depKey) &&
          depKey !== k &&
          !adj.get(k).has(depKey)
        ) {
          adj.get(k).add(depKey);
          reverseAdj.get(depKey).add(k);
          inDegree.set(k, inDegree.get(k) + 1);
        }
      },
      namedRanges,
    );
  }
  return { formulaKeys, adj, reverseAdj, inDegree };
}

function visit(node, currentSheet, onCellDep, namedRanges = null) {
  if (!node) return;
  if (node.type === "REF") {
    onCellDep(keyOf(node.sheet || currentSheet, `${node.col}${node.row}`));
    return;
  }
  if (node.type === "RANGE") {
    const sheet = node.sheet || currentSheet;
    const colNum = (c) => {
      let n = 0;
      for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n;
    };
    const numToCol = (n) => {
      let s = "";
      while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    const sCol = colNum(node.start.col),
      eCol = colNum(node.end.col);
    const span = (node.end.row - node.start.row + 1) * (eCol - sCol + 1);
    if (span > 5000) return;
    for (let r = node.start.row; r <= node.end.row; r++) {
      for (let c = sCol; c <= eCol; c++)
        onCellDep(keyOf(sheet, `${numToCol(c)}${r}`));
    }
    return;
  }
  if (node.type === "NAMED_REF") {
    if (!namedRanges) return;
    let target = namedRanges[node.name];
    if (!target) {
      const lname = String(node.name).toLowerCase();
      for (const k of Object.keys(namedRanges)) {
        if (k.toLowerCase() === lname) {
          target = namedRanges[k];
          break;
        }
      }
    }
    if (!target) return;
    if (target.isRange) {
      const colNum = (c) => {
        let n = 0;
        for (const ch of String(c).toUpperCase())
          n = n * 26 + (ch.charCodeAt(0) - 64);
        return n;
      };
      const numToCol = (n) => {
        let s = "";
        while (n > 0) {
          const r = (n - 1) % 26;
          s = String.fromCharCode(65 + r) + s;
          n = Math.floor((n - 1) / 26);
        }
        return s;
      };
      const startCol = String(target.start || "").replace(/\d+/g, "");
      const endCol = String(target.end || "").replace(/\d+/g, "");
      const startRow = parseInt(
        String(target.start || "").match(/\d+/)?.[0] || "0",
        10,
      );
      const endRow = parseInt(
        String(target.end || "").match(/\d+/)?.[0] || "0",
        10,
      );
      if (!startCol || !endCol || !startRow || !endRow) return;
      const sCol = colNum(startCol),
        eCol = colNum(endCol);
      const span = (endRow - startRow + 1) * (eCol - sCol + 1);
      if (span > 5000) return;
      for (let r = startRow; r <= endRow; r++) {
        for (let c = sCol; c <= eCol; c++)
          onCellDep(keyOf(target.sheet, `${numToCol(c)}${r}`));
      }
    } else if (target.cell) {
      onCellDep(keyOf(target.sheet, target.cell));
    }
    return;
  }
  if (Array.isArray(node.args))
    for (const a of node.args) visit(a, currentSheet, onCellDep, namedRanges);
  if (node.left) visit(node.left, currentSheet, onCellDep, namedRanges);
  if (node.right) visit(node.right, currentSheet, onCellDep, namedRanges);
  if (node.expr) visit(node.expr, currentSheet, onCellDep, namedRanges);
  if (node.operand) visit(node.operand, currentSheet, onCellDep, namedRanges);
}

function topoSort({ formulaKeys, adj, reverseAdj, inDegree }) {
  const degree = new Map(inDegree);
  const queue = [];
  for (const [k, deg] of degree.entries()) if (deg === 0) queue.push(k);
  const order = [];
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    order.push(k);
    for (const dependent of reverseAdj.get(k) || []) {
      degree.set(dependent, degree.get(dependent) - 1);
      if (degree.get(dependent) === 0) queue.push(dependent);
    }
  }
  for (const k of formulaKeys) if (!order.includes(k)) order.push(k);
  return order;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
function isoDateToExcelSerial(iso) {
  if (typeof iso !== "string" || iso.length < 10) return null;
  const t = Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - EXCEL_EPOCH_MS) / 86_400_000);
}

function nodeValue(n) {
  if (typeof n.value_num === "number" && Number.isFinite(n.value_num))
    return n.value_num;
  if (n.value_date) {
    const s = isoDateToExcelSerial(n.value_date);
    if (s !== null) return s;
  }
  if (n.value_text != null && n.value_text !== "") return String(n.value_text);
  return null;
}

export async function recompute(dirtyCells, newValues, dataSource, opts = {}) {
  let nodes;
  if (typeof dataSource.fetchSubgraphRPC === "function") {
    nodes = await dataSource.fetchSubgraphRPC(dirtyCells);
  } else {
    const dependents = await findDependents(dirtyCells, dataSource, opts);
    nodes = await dataSource.fetchNodes(groupBySheet(dependents));
  }

  const closureKeys = new Set(nodes.map((n) => keyOf(n.sheet, n.cell)));

  const { _internal } = await import("./excel-formula-evaluator.js");
  const parseFormula = _internal.parseFormula;
  const haveKeys = new Set(nodes.map((n) => keyOf(n.sheet, n.cell)));
  const referencedKeys = new Set();
  for (const n of nodes) {
    if (!n.formula) continue;
    let ast;
    try {
      ast = parseFormula(n.formula, n.sheet);
    } catch {
      continue;
    }
    visit(
      ast,
      n.sheet,
      (depKey) => referencedKeys.add(depKey),
      opts.namedRanges || null,
    );
  }
  const missingRefs = new Set();
  for (const k of referencedKeys) if (!haveKeys.has(k)) missingRefs.add(k);
  if (missingRefs.size > 0) {
    let extra;
    if (typeof dataSource.fetchNodesByKeysRPC === "function") {
      const keys = [];
      for (const k of missingRefs) {
        const [s, c] = splitKey(k);
        keys.push({ sheet: s, cell: c });
      }
      extra = await dataSource.fetchNodesByKeysRPC(keys);
    } else {
      extra = await dataSource.fetchNodes(groupBySheet(missingRefs));
    }
    nodes = nodes.concat(extra);
  }

  const graphInfo = buildAdjacency(
    nodes,
    parseFormula,
    opts.namedRanges || null,
  );
  const order = topoSort(graphInfo);

  const valueMap = new Map();
  const oldValues = new Map();
  for (const n of nodes) {
    const k = keyOf(n.sheet, n.cell);
    const v = nodeValue(n);
    valueMap.set(k, v);
    oldValues.set(k, v);
  }
  for (const [k, v] of newValues) valueMap.set(k, v);

  const nodeByKey = new Map(nodes.map((n) => [keyOf(n.sheet, n.cell), n]));
  const resolveCell = (sheet, cell) => {
    const k = keyOf(sheet, cell);
    return valueMap.has(k) ? valueMap.get(k) : null;
  };

  const diff = [];
  const MAX_DIAG_CELLS = 100;
  const skippedCells = [];
  const erroredCells = [];
  const skipReasonsDist = {};
  const errorReasonsDist = {};
  const recordReason = (dist, reason) => {
    const key = String(reason || "unknown");
    const family = key.split(":")[0];
    dist[family] = (dist[family] || 0) + 1;
  };

  let evaluated = 0,
    skipped = 0,
    errors = 0,
    preservedNullClobbers = 0,
    skippedNonClosure = 0;
  for (const k of order) {
    const node = nodeByKey.get(k);
    if (!node || !node.formula) continue;
    if (!closureKeys.has(k)) {
      skippedNonClosure += 1;
      continue;
    }
    const result = evaluateFormula(node.formula, node.sheet, resolveCell, {
      timeoutMs: opts.perCellTimeoutMs ?? 5000,
      namedRanges: opts.namedRanges || null,
    });
    if (result.skipped) {
      skipped += 1;
      recordReason(skipReasonsDist, result.reason);
      if (skippedCells.length < MAX_DIAG_CELLS) {
        skippedCells.push({
          sheet: node.sheet,
          cell: node.cell,
          reason: result.reason,
        });
      }
      continue;
    }
    if (result.error) {
      errors += 1;
      recordReason(errorReasonsDist, result.error);
      if (erroredCells.length < MAX_DIAG_CELLS) {
        erroredCells.push({
          sheet: node.sheet,
          cell: node.cell,
          reason: String(result.error).slice(0, 200),
        });
      }
      continue;
    }
    evaluated += 1;
    const newVal = result.value;
    const oldVal = oldValues.get(k);

    if (newVal === null || newVal === undefined) {
      if (oldVal !== null && oldVal !== undefined) {
        preservedNullClobbers += 1;
        continue;
      }
      continue;
    }

    valueMap.set(k, newVal);
    const numericMatch =
      typeof oldVal === "number" &&
      typeof newVal === "number" &&
      (Math.abs(newVal - oldVal) < 1e-6 ||
        (oldVal !== 0 && Math.abs((newVal - oldVal) / oldVal) < 1e-9));
    const same = numericMatch || oldVal === newVal;
    if (!same) {
      diff.push({
        sheet: node.sheet,
        cell: node.cell,
        formula: node.formula,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }

  return {
    diff,
    evaluated,
    skipped,
    errors,
    preservedNullClobbers,
    skippedNonClosure,
    skippedCells,
    erroredCells,
    skipReasonsDist,
    errorReasonsDist,
    valueMap,
  };
}

export const _internal = {
  findDependents,
  buildAdjacency,
  topoSort,
  keyOf,
  splitKey,
  groupBySheet,
};
