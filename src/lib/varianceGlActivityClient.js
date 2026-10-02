import { supabase } from "./supabaseClient.js";
import { GL_ACTIVITY_COVERAGE } from "./varianceGlActivity.js";

function emptyResponse(status) {
  return {
    status,
    coverage: [],
    held_window: null,
    lines: [],
    page: {
      returned: 0,
      total_count: 0,
      has_more: false,
      next_cursor: null,
    },
    summary: null,
    source: null,
  };
}

export async function fetchVarianceGlActivity(
  target,
  { limit = 100, cursor = null } = {},
) {
  if (!target?.requestable) {
    return {
      data: emptyResponse(
        target?.detailAvailability ?? GL_ACTIVITY_COVERAGE.UNRESOLVABLE,
      ),
      error: null,
    };
  }

  return supabase.rpc("get_variance_gl_activity", {
    p_property_code: target.propertyCode,
    p_account_numbers: target.accountNumbers,
    p_month_from: target.monthFrom,
    p_month_to: target.monthTo,
    p_limit: Math.min(Math.max(Number(limit) || 100, 1), 200),
    p_cursor: cursor,
  });
}
