import { rentCoverage } from "./rentRollView.js";

export const VERSION_STATUS = Object.freeze({
  DRAFT: "draft",
  SIGNED: "signed",
  LOCKED: "locked",
});

const STATUSES = [
  VERSION_STATUS.DRAFT,
  VERSION_STATUS.SIGNED,
  VERSION_STATUS.LOCKED,
];
const RANK = { draft: 0, signed: 1, locked: 2 };

export const MATERIAL_FIELDS = [
  "unit_number",
  "effective_status",
  "effective_rent",
  "occupied",
  "tenant_name",
  "lease_start",
  "lease_end",
  "source",
];

export function normalizeLine(row, index) {
  const r = row || {};
  const group = r.group || null;
  return {
    row_index: index,
    source: r.source || "entrata",
    lease_id: r.lease_id ?? null,
    adjustment_id: r.adjustment_id ?? null,
    unit_id: r.unit_id ?? null,
    unit_number: r.unit_number ?? "",
    status: r.status ?? "",
    effective_status: r.effective_status ?? r.status ?? "",
    occupied: !!r.occupied,
    adjusted: !!r.adjusted,
    lease_start: r.lease_start ?? null,
    lease_end: r.lease_end ?? null,
    move_in: r.move_in ?? null,
    move_out: r.move_out ?? null,
    rent: r.rent == null ? null : Number(r.rent),
    effective_rent: r.effective_rent == null ? null : Number(r.effective_rent),
    deposit: r.deposit == null ? null : Number(r.deposit),
    tenant_id: r.tenant_id ?? null,
    tenant_name: r.tenant_name ?? "",
    tenant_email: r.tenant_email ?? "",
    is_mtm: !!r.is_mtm,
    managed_by: r.managed_by ?? null,
    group_name: group ? (group.group_name ?? null) : null,
    group_adjustment_id: group ? (group.adjustment_id ?? null) : null,
    master_tenant_name: group ? (group.master_tenant_name ?? null) : null,
    adjustments: Array.isArray(r.adjustments) ? r.adjustments : [],
    charges: isPlainObject(r.charges) ? { ...r.charges } : null,
    last_seen_at: r.last_seen_at ?? null,
  };
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function summarizeFrozenLines(lines) {
  const arr = lines || [];
  let occupied = 0;
  let totalRent = 0;
  let entrata = 0;
  let added = 0;
  for (const l of arr) {
    if (l.occupied) occupied += 1;
    totalRent += Number(l.effective_rent) || 0;
    if (l.source === "adjustment") added += 1;
    else entrata += 1;
  }
  const coverage = rentCoverage(arr);
  return {
    lineCount: arr.length,
    occupiedRows: occupied,
    totalEffectiveRent: totalRent,
    entrataRows: entrata,
    addedRows: added,
    recordedRents: coverage.recorded,
    missingRents: coverage.missing,
    implausibleRents: coverage.implausible,
  };
}

export function versionRentCoverage(version) {
  const s = (version && version.summary) || {};
  if (s.recordedRents == null) return null;
  const total =
    s.lineCount != null
      ? s.lineCount
      : version && version.line_count != null
        ? version.line_count
        : 0;
  return {
    total,
    recorded: s.recordedRents,
    missing: s.missingRents == null ? 0 : s.missingRents,
    implausible: s.implausibleRents == null ? 0 : s.implausibleRents,
  };
}

export const COVERAGE_NOT_RECORDED = "coverage not recorded at capture";

export function computeContentSignature(lines) {
  const parts = (lines || [])
    .map((l) => `${lineKey(l)}=${materialBody(l)}`)
    .sort();
  return cyrb53(parts.join("\n"));
}

export function freezeEffectiveRoll(effective, meta = {}) {
  const rows = Array.isArray(effective)
    ? effective
    : (effective && effective.rows) || [];
  const lines = rows.map((r, i) => normalizeLine(r, i));
  const content_signature = computeContentSignature(lines);
  const status = meta.status || VERSION_STATUS.DRAFT;
  if (!STATUSES.includes(status)) {
    throw new Error(`invalid rent-roll version status "${status}"`);
  }
  const header = {
    property_id: meta.property_id ?? null,
    label: meta.label || "",
    as_of: meta.as_of ?? null,
    status,
    line_count: lines.length,
    content_signature,
    summary: summarizeFrozenLines(lines),
    signed_off_by: meta.signed_off_by ?? null,
    created_by: meta.created_by ?? null,
  };
  return { header, lines, content_signature };
}

export function statusOf(v) {
  return typeof v === "string" ? v : v && v.status;
}
export function isDraft(v) {
  return statusOf(v) === VERSION_STATUS.DRAFT;
}
export function isSigned(v) {
  return statusOf(v) === VERSION_STATUS.SIGNED;
}
export function isLocked(v) {
  return statusOf(v) === VERSION_STATUS.LOCKED;
}

export function canSign(v) {
  return statusOf(v) === VERSION_STATUS.DRAFT;
}
export function canLock(v) {
  const s = statusOf(v);
  return s === VERSION_STATUS.DRAFT || s === VERSION_STATUS.SIGNED;
}

export function assertMutable(v) {
  if (isLocked(v)) {
    throw new Error(
      "rent-roll version is locked and immutable; create a new version instead",
    );
  }
  return v;
}

export function nextStatus(current, action) {
  if (!STATUSES.includes(current)) {
    throw new Error(`invalid current status "${current}"`);
  }
  if (current === VERSION_STATUS.LOCKED) {
    throw new Error("locked versions are terminal; no transitions allowed");
  }
  if (action === "sign") {
    if (current !== VERSION_STATUS.DRAFT) {
      throw new Error(`cannot sign a version in status "${current}"`);
    }
    return VERSION_STATUS.SIGNED;
  }
  if (action === "lock") {
    return VERSION_STATUS.LOCKED;
  }
  throw new Error(`unknown lifecycle action "${action}"`);
}

export function applyTransition(version, action, meta = {}) {
  assertMutable(version);
  const status = nextStatus(statusOf(version), action);
  const out = { ...version, status };
  if (action === "sign") {
    out.signed_off_by = meta.signed_off_by ?? version.signed_off_by ?? null;
    out.signed_off_at = meta.at ?? version.signed_off_at ?? null;
  }
  if (action === "lock") {
    if (meta.signed_off_by != null) out.signed_off_by = meta.signed_off_by;
    out.signed_off_at = out.signed_off_at ?? meta.at ?? null;
    out.locked_by = meta.locked_by ?? null;
    out.locked_at = meta.at ?? null;
  }
  return out;
}

export function diffVersions(a, b) {
  const aLines = linesOf(a);
  const bLines = linesOf(b);
  const aMap = new Map(aLines.map((l) => [lineKey(l), l]));
  const bMap = new Map(bLines.map((l) => [lineKey(l), l]));
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  for (const [k, bl] of bMap) {
    const al = aMap.get(k);
    if (!al) {
      added.push(bl);
      continue;
    }
    const deltas = materialDeltas(al, bl);
    if (deltas.length) changed.push({ key: k, from: al, to: bl, deltas });
    else unchanged.push(bl);
  }
  for (const [k, al] of aMap) {
    if (!bMap.has(k)) removed.push(al);
  }
  return {
    added,
    removed,
    changed,
    unchanged,
    signatureMatch:
      computeContentSignature(aLines) === computeContentSignature(bLines),
  };
}

export function endOfMonth(month) {
  let y;
  let m;
  if (month instanceof Date && !Number.isNaN(month.getTime())) {
    y = month.getUTCFullYear();
    m = month.getUTCMonth();
  } else if (typeof month === "string") {
    const mt = month.match(/^(\d{4})-(\d{2})/);
    if (!mt) return null;
    y = Number(mt[1]);
    m = Number(mt[2]) - 1;
  } else {
    return null;
  }
  if (!(m >= 0 && m <= 11)) return null;
  return Date.UTC(y, m + 1, 1) - 1;
}

export function earliestCapture(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  let min = null;
  for (const v of versions) {
    const t = new Date(v && v.as_of).getTime();
    if (!Number.isNaN(t) && (min == null || t < min.t))
      min = { t, as_of: v.as_of };
  }
  return min ? min.as_of : null;
}

export function capturedMonths(versions) {
  if (!Array.isArray(versions)) return [];
  const set = new Set();
  for (const v of versions) {
    const key = monthKey(v && v.as_of);
    if (key) set.add(key);
  }
  return [...set].sort();
}

export function pickVersionAtMonth(versions, targetMonth) {
  if (!Array.isArray(versions) || versions.length === 0 || !targetMonth)
    return null;
  const cutoff = endOfMonth(targetMonth);
  if (cutoff == null) return null;
  const sorted = [...versions]
    .filter((v) => v && v.as_of != null)
    .sort((a, b) => new Date(b.as_of).getTime() - new Date(a.as_of).getTime());
  const v = sorted.find((x) => {
    const t = new Date(x.as_of).getTime();
    return !Number.isNaN(t) && t <= cutoff;
  });
  if (!v) return null;
  const summary = v.summary || {};
  return {
    version_id: v.id ?? null,
    label: v.label ?? null,
    as_of: v.as_of,
    status: v.status ?? null,
    line_count: v.line_count ?? null,
    signed_off_by: v.signed_off_by ?? null,
    total_effective_rent: summary.totalEffectiveRent ?? null,
    occupied_rows: summary.occupiedRows ?? null,
    coverage: versionRentCoverage(v),
  };
}

function monthKey(asOf) {
  if (asOf == null) return null;
  if (typeof asOf === "string") {
    const m = asOf.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function linesOf(v) {
  if (Array.isArray(v)) return v;
  return (v && v.lines) || [];
}

function lineKey(l) {
  if (l == null) return "row:?";
  if (l.lease_id != null && l.lease_id !== "") return `entrata:${l.lease_id}`;
  if (l.adjustment_id != null && l.adjustment_id !== "")
    return `adjustment:${l.adjustment_id}`;
  return `content:${cyrb53(materialBody(l))}`;
}

function materialBody(l) {
  return MATERIAL_FIELDS.map((f) => `${f}:${normVal(l[f])}`).join(";");
}

function materialDeltas(a, b) {
  const out = [];
  for (const f of MATERIAL_FIELDS) {
    if (normVal(a[f]) !== normVal(b[f])) {
      out.push({ field: f, from: a[f] ?? null, to: b[f] ?? null });
    }
  }
  return out;
}

function normVal(v) {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const out = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return out.toString(16).padStart(14, "0");
}
