import { supabase } from "./supabaseClient.js";

export function isMatsTenant(name) {
  if (name == null) return false;
  return /\bmats\b/i.test(String(name));
}

export function normalizeBedLabel(v) {
  if (v == null) return "";
  return String(v).replace(/\s+/g, "").toUpperCase();
}

export function seasonTagForAsOf(asOf) {
  const s = asOf == null ? "" : String(asOf).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const season = month <= 5 ? "Spring" : month <= 7 ? "Summer" : "Fall";
  return `${season}${String(year % 100).padStart(2, "0")}`;
}

export function resolveWorkbookMatsRents(logRows, seasonTag) {
  const out = new Map();
  if (!Array.isArray(logRows) || !seasonTag) return out;
  const seen = new Map();
  for (const row of logRows) {
    if (!row) continue;
    if (String(row.season_tag || "") !== seasonTag) continue;
    const label = normalizeBedLabel(row.old_unit_bedspace);
    if (!label) continue;
    const rent = Number(row.signed_full_rate);
    if (!Number.isFinite(rent) || rent <= 0) continue;
    if (!seen.has(label)) seen.set(label, new Set());
    seen.get(label).add(rent);
  }
  for (const [label, values] of seen) {
    if (values.size !== 1) continue;
    out.set(label, values.values().next().value);
  }
  return out;
}

export function matchWorkbookMatsRent(unitLabel, rentsByBed) {
  const label = normalizeBedLabel(unitLabel);
  if (!label || !rentsByBed || typeof rentsByBed.get !== "function")
    return null;
  const exact = rentsByBed.get(label);
  if (exact != null) return exact;
  let hit = null;
  for (const [key, rent] of rentsByBed) {
    if (!label.endsWith(`-${key}`)) continue;
    if (hit != null && hit !== rent) return null;
    hit = rent;
  }
  return hit;
}

export function applyMatsWorkbookRents(rows, rentsByBed) {
  const list = Array.isArray(rows) ? rows : [];
  if (!rentsByBed || rentsByBed.size === 0) return list;
  return list.map((row) => {
    if (!row || row.occupied !== true) return row;
    if (!isMatsTenant(row.tenant_name)) return row;
    const rent = matchWorkbookMatsRent(row.unit_number, rentsByBed);
    if (rent == null) return row;
    return { ...row, effective_rent: rent, mats_workbook_rent: true };
  });
}

export async function fetchPropertyMatsWorkbookRents(propertyId, asOf) {
  const seasonTag = seasonTagForAsOf(asOf);
  if (!propertyId || !seasonTag) return new Map();
  if (!supabase || typeof supabase.from !== "function") return new Map();

  const { data: mapRows, error: mapErr } = await supabase
    .from("budget_property_code_map")
    .select("property_code")
    .eq("property_id", propertyId);
  if (mapErr) throw mapErr;
  const codes = (mapRows || [])
    .map((r) => (r.property_code == null ? "" : String(r.property_code).trim()))
    .filter(Boolean);
  if (!codes.length) return new Map();

  const { data, error } = await supabase
    .schema("raw")
    .from("budget_lease_log")
    .select("property_code, season_tag, old_unit_bedspace, signed_full_rate")
    .in("property_code", codes)
    .eq("season_tag", seasonTag);
  if (error) throw error;
  return resolveWorkbookMatsRents(data || [], seasonTag);
}
