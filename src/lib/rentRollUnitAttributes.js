export function indexUnitAttributes(entrataUnitRows) {
  const rows = Array.isArray(entrataUnitRows) ? entrataUnitRows : [];
  const byUnitId = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.unit_id == null) continue;
    if (byUnitId.has(row.unit_id)) continue;

    byUnitId.set(row.unit_id, {
      unit_type_name: blankToNull(row.unit_type_name),
      unit_sqft: toFiniteNumber(row.sqft),
      unit_label: blankToNull(row.unit_number),
    });
  }

  return byUnitId;
}

export function attachUnitAttributesToRows(rows, attributesByUnitId) {
  const list = Array.isArray(rows) ? rows : [];
  const index =
    attributesByUnitId instanceof Map ? attributesByUnitId : new Map();
  if (!index.size) return list;

  return list.map((row) => {
    if (!row || typeof row !== "object") return row;
    if (row.unit_id == null) return row;
    const attrs = index.get(row.unit_id);
    if (!attrs) return row;
    return {
      ...row,
      unit_type_name: attrs.unit_type_name,
      unit_sqft: attrs.unit_sqft,
      unit_label: attrs.unit_label,
    };
  });
}

export function unitAttributeCoverage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  let withType = 0;
  let withSqft = 0;

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    total += 1;
    if (blankToNull(row.unit_type_name) != null) withType += 1;
    if (toFiniteNumber(row.unit_sqft) != null) withSqft += 1;
  }

  return { total, withType, withSqft };
}

function blankToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toFiniteNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
