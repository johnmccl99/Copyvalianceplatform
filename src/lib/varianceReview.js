import { supabase, ORG_ID } from "./supabaseClient.js";

const ITEM_COLUMNS =
  "id, property_code, month_end, group_key, account_number, account_name, " +
  "status, flag_at_open, pct_at_open, flag_cleared_at, " +
  "assigned_to, resolved_by, resolved_at, created_at";

export const ITEM_FETCH_LIMIT = 5000;

const EVENT_COLUMNS =
  "id, item_id, event_kind, from_status, to_status, note, created_by, created_at";

export const VARIANCE_REVIEW_ROLES = Object.freeze(["admin", "gp", "gp_admin"]);

export async function fetchVarianceReviewItems({
  statuses,
  propertyCodes,
  assignedTo,
  flag,
  limit = ITEM_FETCH_LIMIT,
} = {}) {
  if (Array.isArray(propertyCodes) && propertyCodes.length === 0) {
    return { data: [], truncated: false, error: null };
  }
  const cap =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : ITEM_FETCH_LIMIT;
  let q = supabase
    .from("variance_review_items")
    .select(ITEM_COLUMNS)
    .order("month_end", { ascending: false })
    .order("property_code", { ascending: true })
    .order("created_at", { ascending: false });
  if (Array.isArray(statuses) && statuses.length > 0)
    q = q.in("status", statuses);
  if (Array.isArray(propertyCodes) && propertyCodes.length > 0)
    q = q.in("property_code", propertyCodes);
  if (assignedTo === "unassigned") q = q.is("assigned_to", null);
  else if (assignedTo) q = q.eq("assigned_to", assignedTo);
  if (flag === "red" || flag === "orange") q = q.eq("flag_at_open", flag);
  q = q.limit(cap + 1);
  const { data, error } = await q;
  const rows = data || [];
  const truncated = rows.length > cap;
  return { data: truncated ? rows.slice(0, cap) : rows, truncated, error };
}

export const EMPTY_SUMMARY = Object.freeze({
  total: 0,
  open: 0,
  closed: 0,
  toReview: 0,
  inReview: 0,
  redOpen: 0,
  orangeOpen: 0,
  propertyCodes: [],
});

export async function fetchVarianceReviewSummary({
  propertyCodes = null,
} = {}) {
  const { data, error } = await supabase.rpc("variance_review_summary", {
    p_property_codes: Array.isArray(propertyCodes) ? propertyCodes : null,
  });
  if (error) {
    console.error("fetchVarianceReviewSummary error:", error);
    return { data: EMPTY_SUMMARY, error };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { data: EMPTY_SUMMARY, error: null };
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    data: {
      total: n(row.total),
      open: n(row.open_count),
      closed: n(row.closed_count),
      toReview: n(row.to_review),
      inReview: n(row.in_review),
      redOpen: n(row.red_open),
      orangeOpen: n(row.orange_open),
      propertyCodes: Array.isArray(row.property_codes)
        ? row.property_codes.filter(Boolean)
        : [],
    },
    error: null,
  };
}

export async function fetchVarianceReviewEvents(itemId) {
  if (!itemId) return { data: [], error: { message: "itemId required" } };
  const { data, error } = await supabase
    .from("variance_review_events")
    .select(EVENT_COLUMNS)
    .eq("item_id", itemId)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

export async function listAssignableUsers() {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, display_name, role")
    .eq("org_id", ORG_ID)
    .eq("is_active", true)
    .in("role", VARIANCE_REVIEW_ROLES)
    .order("display_name", { ascending: true });
  return { data: data || [], error };
}

export async function assignVarianceReviewItem(itemId, assigneeId) {
  if (!itemId) return { data: null, error: { message: "itemId required" } };
  const { data, error } = await supabase.rpc("variance_review_assign", {
    p_item_id: itemId,
    p_assignee: assigneeId ?? null,
  });
  return { data: Array.isArray(data) ? data[0] : data, error };
}

export async function setVarianceReviewStatus(itemId, status, note = null) {
  if (!itemId || !status)
    return { data: null, error: { message: "itemId and status required" } };
  const { data, error } = await supabase.rpc("variance_review_set_status", {
    p_item_id: itemId,
    p_status: status,
    p_note: note ?? null,
  });
  return { data: Array.isArray(data) ? data[0] : data, error };
}

export async function addVarianceReviewNote(itemId, note) {
  if (!itemId) return { data: null, error: { message: "itemId required" } };
  const { data, error } = await supabase.rpc("variance_review_add_note", {
    p_item_id: itemId,
    p_note: note,
  });
  return { data: data ?? null, error };
}

export async function fetchPropertyNameByCode(propertyCode) {
  if (!propertyCode) return { data: null, error: null };
  const { data: mapping, error: mapErr } = await supabase
    .from("budget_property_code_map")
    .select("property_id")
    .eq("property_code", propertyCode)
    .maybeSingle();
  if (mapErr) {
    console.error("fetchPropertyNameByCode step 1 error:", mapErr);
    return { data: null, error: mapErr };
  }
  if (!mapping?.property_id) return { data: null, error: null };
  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("name")
    .eq("id", mapping.property_id)
    .maybeSingle();
  if (propErr) {
    console.error("fetchPropertyNameByCode step 2 error:", propErr);
    return { data: null, error: propErr };
  }
  return { data: prop?.name || null, error: null };
}
