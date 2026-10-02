export const PARITY_STATUS = Object.freeze({
  MATCH: "match",
  DRIFT_MINOR: "drift_minor",
  DRIFT_MAJOR: "drift_major",
  EVALUATOR_SKIP: "evaluator_skip",
  EVALUATOR_ERROR: "evaluator_error",
  MISSING_REFERENCE: "missing_reference",
});

export const PARITY_DATA_TYPES = Object.freeze([
  "numeric_currency",
  "numeric_percent",
  "numeric_count",
  "text",
  "date",
  "boolean",
]);

export const parityToleranceConfig = Object.freeze({
  numeric_currency: { match_abs: 0.005, match_rel: 1e-9, minor_rel: 1e-3 },
  numeric_percent: { match_abs: 1e-6, match_rel: 1e-9, minor_rel: 1e-4 },
  numeric_count: { mode: "exact_integer" },
  text: { mode: "exact" },
  date: { mode: "exact" },
  boolean: { mode: "exact" },
});

function unwrapValue(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v)
    return v.value;
  return v;
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function classifyNumeric(platformVal, excelVal, cfg) {
  if (!isFiniteNumber(platformVal) || !isFiniteNumber(excelVal)) {
    return PARITY_STATUS.DRIFT_MAJOR;
  }
  const absDelta = Math.abs(platformVal - excelVal);
  if (excelVal === 0) {
    if (absDelta < cfg.match_abs) return PARITY_STATUS.MATCH;
    return PARITY_STATUS.DRIFT_MAJOR;
  }
  const relDelta = Math.abs((platformVal - excelVal) / excelVal);
  if (relDelta < cfg.match_rel || absDelta < cfg.match_abs)
    return PARITY_STATUS.MATCH;
  if (relDelta < cfg.minor_rel) return PARITY_STATUS.DRIFT_MINOR;
  return PARITY_STATUS.DRIFT_MAJOR;
}

function classifyCount(platformVal, excelVal) {
  if (!isFiniteNumber(platformVal) || !isFiniteNumber(excelVal)) {
    return PARITY_STATUS.DRIFT_MAJOR;
  }
  if (platformVal === excelVal) return PARITY_STATUS.MATCH;
  return PARITY_STATUS.DRIFT_MAJOR;
}

function classifyExact(platformVal, excelVal) {
  if (platformVal === excelVal) return PARITY_STATUS.MATCH;
  return PARITY_STATUS.DRIFT_MAJOR;
}

export function classifyParityCell({ platform_value, excel_value, data_type }) {
  if (!PARITY_DATA_TYPES.includes(data_type)) {
    throw new Error(`classifyParityCell: unknown data_type "${data_type}"`);
  }
  const platformVal = unwrapValue(platform_value);
  const excelVal = unwrapValue(excel_value);

  switch (data_type) {
    case "numeric_currency":
    case "numeric_percent": {
      const cfg = parityToleranceConfig[data_type];
      const status = classifyNumeric(platformVal, excelVal, cfg);
      const absDelta =
        isFiniteNumber(platformVal) && isFiniteNumber(excelVal)
          ? platformVal - excelVal
          : null;
      const relDelta =
        isFiniteNumber(platformVal) &&
        isFiniteNumber(excelVal) &&
        excelVal !== 0
          ? (platformVal - excelVal) / excelVal
          : null;
      return { status, abs_delta: absDelta, rel_delta: relDelta };
    }
    case "numeric_count": {
      const status = classifyCount(platformVal, excelVal);
      const absDelta =
        isFiniteNumber(platformVal) && isFiniteNumber(excelVal)
          ? platformVal - excelVal
          : null;
      return { status, abs_delta: absDelta, rel_delta: null };
    }
    case "text":
    case "date":
    case "boolean": {
      return {
        status: classifyExact(platformVal, excelVal),
        abs_delta: null,
        rel_delta: null,
      };
    }
    default:
      throw new Error(`classifyParityCell: unhandled data_type "${data_type}"`);
  }
}

function platformValueFromNode(node) {
  if (!node) return null;
  if (node.value_num !== null && node.value_num !== undefined)
    return node.value_num;
  if (node.value_text !== null && node.value_text !== undefined)
    return node.value_text;
  if (node.value_date !== null && node.value_date !== undefined)
    return node.value_date;
  return null;
}

function cellKey(sheet, cell) {
  return `${sheet}${cell}`;
}

export function joinAndClassifyParityRows({
  referenceRows = [],
  nodes = [],
  diffArray = [],
  skippedCells = [],
  erroredCells = [],
} = {}) {
  const nodeByCell = new Map();
  for (const n of nodes) nodeByCell.set(cellKey(n.sheet, n.cell), n);

  const skippedSet = new Set();
  for (const s of skippedCells) {
    if (s?.sheet && s?.cell) skippedSet.add(cellKey(s.sheet, s.cell));
  }
  const erroredSet = new Set();
  for (const e of erroredCells) {
    if (e?.sheet && e?.cell) erroredSet.add(cellKey(e.sheet, e.cell));
  }

  const summary = {
    match: 0,
    drift_minor: 0,
    drift_major: 0,
    evaluator_skip: 0,
    evaluator_error: 0,
    missing_reference: 0,
  };

  const referencedSet = new Set();
  const classified = referenceRows.map((ref) => {
    const k = cellKey(ref.target_sheet, ref.target_cell);
    referencedSet.add(k);
    const node = nodeByCell.get(k) || null;
    let row;
    if (erroredSet.has(k)) {
      row = {
        ref_id: ref.id,
        sheet: ref.target_sheet,
        cell: ref.target_cell,
        formula: node?.formula ?? null,
        platform_value: null,
        excel_value: ref.excel_value,
        data_type: ref.excel_value_type,
        status: PARITY_STATUS.EVALUATOR_ERROR,
        abs_delta: null,
        rel_delta: null,
        target_canonical_key: ref.target_canonical_key || null,
        validation_notes: ref.validation_notes || null,
      };
    } else if (skippedSet.has(k)) {
      row = {
        ref_id: ref.id,
        sheet: ref.target_sheet,
        cell: ref.target_cell,
        formula: node?.formula ?? null,
        platform_value: null,
        excel_value: ref.excel_value,
        data_type: ref.excel_value_type,
        status: PARITY_STATUS.EVALUATOR_SKIP,
        abs_delta: null,
        rel_delta: null,
        target_canonical_key: ref.target_canonical_key || null,
        validation_notes: ref.validation_notes || null,
      };
    } else {
      const platformVal = platformValueFromNode(node);
      const cls = classifyParityCell({
        platform_value: platformVal,
        excel_value: ref.excel_value,
        data_type: ref.excel_value_type,
      });
      row = {
        ref_id: ref.id,
        sheet: ref.target_sheet,
        cell: ref.target_cell,
        formula: node?.formula ?? null,
        platform_value: platformVal,
        excel_value: ref.excel_value,
        data_type: ref.excel_value_type,
        status: cls.status,
        abs_delta: cls.abs_delta,
        rel_delta: cls.rel_delta,
        target_canonical_key: ref.target_canonical_key || null,
        validation_notes: ref.validation_notes || null,
      };
    }
    summary[row.status] += 1;
    return row;
  });

  const missingReferenceRows = [];
  for (const d of diffArray) {
    if (!d?.sheet || !d?.cell) continue;
    const k = cellKey(d.sheet, d.cell);
    if (referencedSet.has(k)) continue;
    missingReferenceRows.push({
      sheet: d.sheet,
      cell: d.cell,
      formula: d.formula ?? null,
      platform_value: d.new_value ?? null,
      old_value: d.old_value ?? null,
      status: PARITY_STATUS.MISSING_REFERENCE,
    });
    summary.missing_reference += 1;
  }

  return { classified, missingReferenceRows, summary };
}
