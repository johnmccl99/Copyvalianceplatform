export const SNAPSHOT_NOISE_KEYS = new Set([
  "id",
  "org_id",
  "property_code",
  "property_id",
  "itemized_id",
  "adjustment_id",
  "created_at",
  "updated_at",
  "changed_at",
  "created_by",
  "updated_by",
  "changed_by",
  "row_hash",
  "prev_hash",
  "origin",
  "source",
  "source_file",
  "source_row",
  "sheet_name",
  "ingest_run_id",
  "sync_run_id",
  "parser_version",
  "schema_version",
  "content_signature",
  "batch_id",
  "import_id",
  "external_id",
  "raw_payload",
]);

export function humanizeField(k) {
  return String(k)
    .replace(/^payload\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function fieldTokens(key) {
  return String(key)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const DATE_TAIL = new Set([
  "date",
  "dt",
  "start",
  "end",
  "expiry",
  "expires",
  "from",
  "thru",
  "through",
]);
const JOINED_DATE_TAILS = new Set(["asof", "movein", "moveout"]);

function isDateField(key) {
  if (!key) return false;
  const toks = fieldTokens(key);
  if (!toks.length) return false;
  if (DATE_TAIL.has(toks[toks.length - 1])) return true;
  return JOINED_DATE_TAILS.has(toks.slice(-2).join(""));
}

const ID_TAIL = new Set([
  "id",
  "ids",
  "no",
  "num",
  "number",
  "code",
  "zip",
  "year",
  "ref",
]);

function isIdentifierField(key) {
  if (!key) return false;
  const toks = fieldTokens(key);
  return toks.length > 0 && ID_TAIL.has(toks[toks.length - 1]);
}

const EXCEL_SERIAL_MIN = 20000;
const EXCEL_SERIAL_MAX = 80000;

export function excelSerialToISODate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < EXCEL_SERIAL_MIN || n > EXCEL_SERIAL_MAX)
    return null;
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function displayNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  const dp = Math.abs(v) < 1 ? 4 : 2;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

const INTERNAL_VOCAB_RES = [
  /\bchip\s*#?\s*\d+\b/gi,
  /\bchip-\d+\b/gi,
  /\bWS\d+\b/g,
  /\bparity[-\s]?harness\b/gi,
  /\bhub[-\s]?(?:session|chip)\b/gi,
];

export function scrubInternalVocabulary(val) {
  let s = val == null ? "" : String(val);
  if (!s) return "";
  for (const re of INTERNAL_VOCAB_RES) s = s.replace(re, " ");
  s = s
    .replace(/\s+/g, " ")
    .replace(/\s*([—–·|,;:-])\s*(?=[—–·|,;:-]|$)/g, "")
    .replace(/^[\s—–·|,;:-]+/, "")
    .replace(/[\s—–·|,;:-]+$/, "")
    .trim();
  return s;
}

export function hasInternalVocabulary(val) {
  const s = val == null ? "" : String(val);
  return INTERNAL_VOCAB_RES.some((re) => {
    re.lastIndex = 0;
    return re.test(s);
  });
}

export function displayVal(v, key) {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (isDateField(key)) {
      const iso = excelSerialToISODate(v);
      if (iso) return iso;
    }
    if (isIdentifierField(key)) return String(v);
    return displayNumber(v);
  }
  if (typeof v === "string") {
    if (isDateField(key) && /^\d+(\.\d+)?$/.test(v.trim())) {
      const iso = excelSerialToISODate(v.trim());
      if (iso) return iso;
    }
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch (_e) {
    return String(v);
  }
}

function exactVal(v) {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "number") return String(v);
  return displayVal(v);
}

export function diffPair(pre, post, key) {
  let old_value = displayVal(pre, key);
  let new_value = displayVal(post, key);
  if (old_value === new_value && !valuesEqual(pre, post)) {
    old_value = exactVal(pre);
    new_value = exactVal(post);
  }
  return { old_value, new_value };
}

export function valuesEqual(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch (_e) {
    return false;
  }
}

export function flattenSnapshot(snap) {
  const out = {};
  if (!snap || typeof snap !== "object") return out;
  for (const [k, v] of Object.entries(snap)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [ik, iv] of Object.entries(v)) out[`${k}.${ik}`] = iv;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function diffSnapshots(prev, next) {
  const a = flattenSnapshot(prev);
  const b = flattenSnapshot(next);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) {
    const base = k.split(".")[0];
    if (SNAPSHOT_NOISE_KEYS.has(base)) continue;
    if (!valuesEqual(a[k], b[k])) {
      const { old_value, new_value } = diffPair(a[k], b[k], k);
      out.push({ field: humanizeField(k), old: old_value, new: new_value });
    }
  }
  return out;
}

export function summarizeSnapshot(snap, maxFields = 5) {
  const flat = flattenSnapshot(snap);
  const parts = [];
  for (const [k, v] of Object.entries(flat)) {
    const base = k.split(".")[0];
    if (SNAPSHOT_NOISE_KEYS.has(base)) continue;
    if (v === null || v === undefined || v === "") continue;
    parts.push(`${humanizeField(k)}: ${displayVal(v, k)}`);
    if (parts.length >= maxFields) break;
  }
  return parts.join(" · ") || "(no detail captured)";
}

export function diffVersionSeries(versions, idKey, mkRow) {
  const groups = new Map();
  for (const v of versions) {
    const key = v[idKey];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  const rows = [];
  const KIND_ORDER = { INSERT: 0, UPDATE: 1, DELETE: 2 };
  for (const series of groups.values()) {
    series.sort((x, y) => {
      const dt = new Date(x.changed_at) - new Date(y.changed_at);
      if (dt !== 0) return dt;
      return (
        (KIND_ORDER[x.change_kind] ?? 1) - (KIND_ORDER[y.change_kind] ?? 1)
      );
    });
    let prev;
    for (const v of series) {
      const snap = v.row_snapshot || {};
      if (v.change_kind === "DELETE") {
        rows.push(
          mkRow(v, "(record deleted)", summarizeSnapshot(snap), "(deleted)"),
        );
        prev = undefined;
        continue;
      }
      if (v.change_kind === "INSERT") {
        const diffs = diffSnapshots(undefined, snap).filter(
          (d) => d.new !== "(empty)",
        );
        if (diffs.length) {
          for (const d of diffs) rows.push(mkRow(v, d.field, "(empty)", d.new));
        } else {
          rows.push(
            mkRow(v, "(record created)", "(empty)", summarizeSnapshot(snap)),
          );
        }
        prev = snap;
        continue;
      }
      if (prev === undefined) {
        rows.push(
          mkRow(
            v,
            "(record updated)",
            "(prior state predates selected range)",
            summarizeSnapshot(snap),
          ),
        );
      } else {
        for (const d of diffSnapshots(prev, snap))
          rows.push(mkRow(v, d.field, d.old, d.new));
      }
      prev = snap;
    }
  }
  return rows;
}

export function escapeHtml(val) {
  const s = val == null ? "" : String(val);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isNumberLike(s) {
  return /^[-+]?\$?[\d,]+(\.\d+)?%?$/.test(String(s).trim());
}

export function csvGuard(val) {
  const s = val == null ? "" : String(val);
  if (s === "") return s;
  if (/^[=@\t\r]/.test(s)) return "'" + s;
  if (/^[-+]/.test(s) && !isNumberLike(s)) return "'" + s;
  return s;
}

export function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(val) {
  return UUID_RE.test(String(val == null ? "" : val).trim());
}

export function namedEntity(kind, label) {
  const s = String(label == null ? "" : label).trim();
  if (s && !isUuidLike(s)) return `${kind} — ${s}`;
  return `${kind} (unnamed)`;
}

export function sourceRef(kind, id) {
  const s = String(id == null ? "" : id).trim();
  if (!s) return kind;
  return `${kind} (ref ${s.slice(0, 8)})`;
}
