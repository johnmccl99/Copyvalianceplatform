import { supabase } from "../supabaseClient.js";

export async function fetchQuarterlyPacket(propertyCode, year, quarter) {
  const { data, error } = await supabase.rpc("get_quarterly_packet", {
    p_property_code: propertyCode,
    p_year: year,
    p_quarter: quarter,
  });
  if (error) {
    console.error("fetchQuarterlyPacket error:", error);
    return { data: null, error };
  }
  return { data: data || null, error: null };
}
