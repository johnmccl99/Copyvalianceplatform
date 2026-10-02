import { supabase } from "./supabaseClient.js";

export async function fetchWorkbookSpaceMarketRent(propertyId) {
  if (!propertyId) return [];
  if (!supabase || typeof supabase.from !== "function") return [];

  const { data: mapRows, error: mapErr } = await supabase
    .from("budget_property_code_map")
    .select("property_code")
    .eq("property_id", propertyId);
  if (mapErr) throw mapErr;
  const codes = (mapRows || [])
    .map((r) => (r.property_code == null ? "" : String(r.property_code).trim()))
    .filter(Boolean);
  if (!codes.length) return [];

  const { data, error } = await supabase
    .schema("raw")
    .from("workbook_space_sf")
    .select("property_code, space_label, market_rent")
    .in("property_code", codes);
  if (error) throw error;
  return data || [];
}
