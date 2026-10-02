import { supabase } from "./supabaseClient.js";

export function resolveMarketUtility(logRows) {
  if (!Array.isArray(logRows)) return null;
  const counts = new Map();
  for (const row of logRows) {
    if (!row) continue;
    const n = Number(row.utilities);
    if (!Number.isFinite(n) || n <= 0) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  if (!counts.size) return null;
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export async function fetchPropertyMarketUtility(propertyId) {
  if (!propertyId) return null;
  if (!supabase || typeof supabase.from !== "function") return null;

  const { data: mapRows, error: mapErr } = await supabase
    .from("budget_property_code_map")
    .select("property_code")
    .eq("property_id", propertyId);
  if (mapErr) throw mapErr;
  const codes = (mapRows || [])
    .map((r) => (r.property_code == null ? "" : String(r.property_code).trim()))
    .filter(Boolean);
  if (!codes.length) return null;

  const { data, error } = await supabase
    .schema("raw")
    .from("budget_lease_log")
    .select("property_code, utilities")
    .in("property_code", codes)
    .not("utilities", "is", null);
  if (error) throw error;
  return resolveMarketUtility(data || []);
}
