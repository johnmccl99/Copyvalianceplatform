const BOUNDARY_CHARS = new Set(["-", ",", " ", "."]);

export function normalizeLabel(v) {
  return String(v == null ? "" : v).trim();
}

export function isBoundaryPrefix(full, prefix) {
  if (!full || !prefix) return false;
  if (!full.startsWith(prefix)) return false;
  if (full.length === prefix.length) return true;
  return BOUNDARY_CHARS.has(full.charAt(prefix.length));
}

export function normalizeRent(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const cleaned = String(v).replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const COLUMN_ALIASES = {
  entrataPropertyId: [
    /^entrata\s*property\s*id$/,
    /^property\s*id$/,
    /^entrata\s*id$/,
  ],
  property: [/property/, /community/, /building/, /asset/],
  unitSpaceId: [/^unit\s*space\s*id$/, /^space\s*id$/, /unitspaceid/],
  unit: [
    /unit\s*number/,
    /unit\s*\/?\s*space/,
    /\bunit\b/,
    /\bspace\b/,
    /\bbed\b/,
  ],
  rent: [
    /economic\s*rent/,
    /rent\s*override/,
    /override/,
    /monthly\s*rent/,
    /\brent\b/,
    /amount/,
  ],
  tenant: [/tenant/, /resident/, /lessee/, /customer/, /occupant/, /\bname\b/],
};

function headerKey(h) {
  return String(h == null ? "" : h)
    .trim()
    .toLowerCase();
}

export function detectColumns(headers = []) {
  const list = (headers || []).map((h) => String(h == null ? "" : h));
  const columns = {};
  const used = new Set();
  for (const [field, patterns] of Object.entries(COLUMN_ALIASES)) {
    for (const pat of patterns) {
      const hit = list.find((h) => !used.has(h) && pat.test(headerKey(h)));
      if (hit != null) {
        columns[field] = hit;
        used.add(hit);
        break;
      }
    }
  }
  const hasProperty =
    columns.property != null || columns.entrataPropertyId != null;
  const missing = [];
  if (!hasProperty) missing.push("property");
  if (columns.unit == null) missing.push("unit");
  if (columns.rent == null) missing.push("rent");
  return { columns, missing };
}

export function normalizeParsedRows(rawRows = [], columns = {}) {
  const pick = (obj, header) => (header == null ? undefined : obj[header]);
  return (rawRows || []).map((raw, i) => {
    const propertyName = normalizeLabel(pick(raw, columns.property));
    const propertyId = normalizeLabel(pick(raw, columns.entrataPropertyId));
    const unit = normalizeLabel(pick(raw, columns.unit));
    const unitSpaceId = normalizeLabel(pick(raw, columns.unitSpaceId));
    const tenant = normalizeLabel(pick(raw, columns.tenant));
    const rentRaw = pick(raw, columns.rent);
    const rent = normalizeRent(rentRaw);
    const property = propertyId || propertyName;
    return {
      rowIndex: i,
      property,
      propertyName: propertyName || null,
      propertyId: propertyId || null,
      unit,
      unitSpaceId: unitSpaceId || null,
      tenant: tenant || null,
      rent,
      rentRaw: rentRaw == null ? null : String(rentRaw),
      raw,
    };
  });
}

function normName(s) {
  return normalizeLabel(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolvePropertyId(propertyCell, propertyRoster = []) {
  const cell = normalizeLabel(propertyCell);
  if (!cell) return { status: "unmatched", reason: "blank-property" };
  const roster = propertyRoster || [];

  if (/^\d+$/.test(cell)) {
    const byId = roster.filter((p) => String(p.entrata_property_id) === cell);
    if (byId.length === 1)
      return {
        status: "matched",
        entrataPropertyId: byId[0].entrata_property_id,
        matchKind: "id",
      };
    if (byId.length === 0)
      return { status: "unmatched", reason: "unknown-property-id" };
    return {
      status: "ambiguous",
      reason: "duplicate-property-id",
      candidates: byId,
    };
  }

  const lc = cell.toLowerCase();
  const exact = roster.filter(
    (p) => normalizeLabel(p.name).toLowerCase() === lc,
  );
  if (exact.length === 1)
    return {
      status: "matched",
      entrataPropertyId: exact[0].entrata_property_id,
      matchKind: "name",
    };
  if (exact.length > 1)
    return {
      status: "ambiguous",
      reason: "duplicate-property-name",
      candidates: exact,
    };

  const target = normName(cell);
  const norm = roster.filter((p) => normName(p.name) === target);
  if (norm.length === 1)
    return {
      status: "matched",
      entrataPropertyId: norm[0].entrata_property_id,
      matchKind: "name-normalized",
    };
  if (norm.length > 1)
    return {
      status: "ambiguous",
      reason: "duplicate-property-name-normalized",
      candidates: norm,
    };

  return { status: "unmatched", reason: "unknown-property" };
}

export function resolveBed(unitLabel, beds = []) {
  const label = normalizeLabel(unitLabel);
  if (!label)
    return { status: "unmatched", reason: "blank-unit", candidates: [] };
  const rows = beds || [];
  const unitOf = (b) => normalizeLabel(b.unit_number);

  const exact = rows.filter((b) => unitOf(b) === label);
  if (exact.length === 1)
    return {
      status: "matched",
      matchKind: "exact",
      bed: exact[0],
      unitNumber: unitOf(exact[0]),
    };
  if (exact.length > 1)
    return {
      status: "ambiguous",
      reason: "duplicate-exact-bed",
      candidates: exact,
    };

  const underUnit = rows.filter((b) => isBoundaryPrefix(unitOf(b), label));
  if (underUnit.length === 1)
    return {
      status: "matched",
      matchKind: "unit-prefix",
      bed: underUnit[0],
      unitNumber: unitOf(underUnit[0]),
    };
  if (underUnit.length > 1)
    return {
      status: "ambiguous",
      reason: "multiple-beds-under-unit",
      candidates: underUnit,
    };

  const rollCoarser = rows.filter((b) => isBoundaryPrefix(label, unitOf(b)));
  if (rollCoarser.length > 0)
    return {
      status: "unmatched",
      reason: "roll-coarser-than-sheet",
      candidates: rollCoarser,
    };

  return { status: "unmatched", reason: "no-matching-bed", candidates: [] };
}

export function buildOverridePreview(
  rows = [],
  { propertyRoster = [], bedsByPropertyId = {}, scopePropertyId = null } = {},
) {
  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  const invalid = [];
  const outOfScope = [];
  const scoped = scopePropertyId != null && scopePropertyId !== "";
  const scopeId = scoped ? String(scopePropertyId) : null;

  (rows || []).forEach((row, i) => {
    const rowIndex = row.rowIndex == null ? i : row.rowIndex;
    const base = { row, rowIndex };

    if (scoped) {
      const scopedProp = resolvePropertyId(row.property, propertyRoster);
      if (
        scopedProp.status === "matched" &&
        String(scopedProp.entrataPropertyId) !== scopeId
      ) {
        const resolved = (propertyRoster || []).find(
          (p) =>
            String(p.entrata_property_id) ===
            String(scopedProp.entrataPropertyId),
        );
        outOfScope.push({
          ...base,
          stage: "property",
          reason: "out-of-scope",
          entrataPropertyId: scopedProp.entrataPropertyId,
          propertyName: resolved ? resolved.name : null,
        });
        return;
      }
    }

    if (row.rent == null) {
      invalid.push({ ...base, stage: "value", reason: "bad-rent" });
      return;
    }
    if (!normalizeLabel(row.unit)) {
      invalid.push({ ...base, stage: "value", reason: "blank-unit" });
      return;
    }

    const prop = resolvePropertyId(row.property, propertyRoster);
    if (prop.status !== "matched") {
      const entry = { ...base, stage: "property", ...prop };
      (prop.status === "ambiguous" ? ambiguous : unmatched).push(entry);
      return;
    }

    const beds = bedsByPropertyId[String(prop.entrataPropertyId)] || [];
    const bed = resolveBed(row.unit, beds);
    const entry = {
      ...base,
      stage: "bed",
      entrataPropertyId: prop.entrataPropertyId,
      ...bed,
    };
    if (bed.status === "matched") matched.push(entry);
    else if (bed.status === "ambiguous") ambiguous.push(entry);
    else unmatched.push(entry);
  });

  const result = {
    matched,
    unmatched,
    ambiguous,
    invalid,
    summary: {
      total: (rows || []).length,
      matched: matched.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      invalid: invalid.length,
    },
  };
  if (scoped) {
    result.outOfScope = outOfScope;
    result.summary.outOfScope = outOfScope.length;
  }
  return result;
}
