import { supabase } from "../supabaseClient.js";

export async function fetchTimeSavedSummary({ from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc("usage_time_saved_summary", {
    p_from: from || null,
    p_to: to || null,
  });
  if (error) {
    console.error("fetchTimeSavedSummary error:", error);
    return { rows: [], error };
  }
  return {
    rows: (Array.isArray(data) ? data : []).map(mapSummaryRow),
    error: null,
  };
}

export function mapSummaryRow(row) {
  if (!row) return null;
  const num = (v) => (v == null || v === "" ? null : Number(v));
  return {
    surfaceKey: row.surface_key ?? null,
    actionKey: row.action_key ?? null,
    eventCount: row.event_count == null ? 0 : Number(row.event_count),
    manualMinutes: num(row.manual_minutes),
    minutesSaved: row.minutes_saved == null ? 0 : Number(row.minutes_saved),
    calibrated: !!row.calibrated,
  };
}

export function splitMeasuredEstimated(rows) {
  const out = {
    measuredMinutes: 0,
    estimatedMinutes: 0,
    measuredRows: [],
    estimatedRows: [],
    unvaluedRows: [],
  };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const mapped = r.surfaceKey !== undefined ? r : mapSummaryRow(r);
    if (mapped.manualMinutes == null) {
      out.unvaluedRows.push(mapped);
      continue;
    }
    if (mapped.calibrated) {
      out.measuredMinutes += mapped.minutesSaved || 0;
      out.measuredRows.push(mapped);
    } else {
      out.estimatedMinutes += mapped.minutesSaved || 0;
      out.estimatedRows.push(mapped);
    }
  }
  return out;
}

export function formatMinutes(minutes) {
  if (minutes == null || minutes === "") return "—";
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) return "—";
  if (m < 1) return "0m";
  const totalMin = Math.round(m);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export async function fetchAdoption({
  from = null,
  to = null,
  limit = 5000,
} = {}) {
  let q = supabase
    .from("usage_events")
    .select("user_id, actor_role, surface_key, action_key, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (from) q = q.gte("occurred_at", from);
  if (to) q = q.lt("occurred_at", to);

  const { data, error } = await q;
  if (error) {
    console.error("fetchAdoption error:", error);
    return { events: [], agg: aggregateAdoption([]), error };
  }
  const events = Array.isArray(data) ? data : [];
  return { events, agg: aggregateAdoption(events), error: null };
}

export function aggregateAdoption(events) {
  const list = Array.isArray(events) ? events : [];
  const byRole = {};
  const bySurface = {};
  const perUser = {};

  for (const e of list) {
    if (!e) continue;
    const role = e.actor_role || "(unknown)";
    byRole[role] = (byRole[role] || 0) + 1;

    const surface = e.surface_key || "(unknown)";
    bySurface[surface] = (bySurface[surface] || 0) + 1;

    const uid = e.user_id;
    if (uid) {
      const ts = e.occurred_at || null;
      if (!perUser[uid]) {
        perUser[uid] = { userId: uid, count: 0, lastActive: ts, role };
      }
      perUser[uid].count += 1;
      if (ts && (!perUser[uid].lastActive || ts > perUser[uid].lastActive)) {
        perUser[uid].lastActive = ts;
      }
    }
  }

  return {
    totalEvents: list.length,
    byRole: sortCountMap(byRole),
    bySurface: sortCountMap(bySurface),
    activeUsers: Object.keys(perUser).length,
    perUser: Object.values(perUser).sort(
      (a, b) => (b.count || 0) - (a.count || 0),
    ),
  };
}

function sortCountMap(map) {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}
