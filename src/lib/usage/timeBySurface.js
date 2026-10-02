import { supabase } from "../supabaseClient.js";

export const IDLE_CAP_MINUTES = 30;

export async function fetchTimeBySurface({
  from = null,
  to = null,
  limit = 5000,
} = {}) {
  try {
    let query = supabase
      .from("usage_time_by_surface")
      .select(
        "user_id, actor_role, surface_key, action_key, day, events, minutes",
      )
      .order("day", { ascending: false })
      .limit(limit);
    if (from) query = query.gte("day", from.slice(0, 10));
    if (to) query = query.lte("day", to.slice(0, 10));
    const { data, error } = await query;
    if (error) return { rows: [], error };
    return { rows: Array.isArray(data) ? data : [], error: null };
  } catch (error) {
    return { rows: [], error };
  }
}

export function aggregateTimeBySurface(events) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  const compareIds = (a, b) => {
    const an = Number(a?.id);
    const bn = Number(b?.id);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  };
  const sorted = [...list].sort((a, b) => {
    const at = Date.parse(a?.occurred_at || "");
    const bt = Date.parse(b?.occurred_at || "");
    return (
      (Number.isFinite(at) ? at : Infinity) -
        (Number.isFinite(bt) ? bt : Infinity) || compareIds(a, b)
    );
  });
  const partitions = new Map();
  for (const event of sorted) {
    const key = `${event.user_id ?? ""}\u0000${event.session_id ?? ""}`;
    const partition = partitions.get(key) || [];
    partition.push(event);
    partitions.set(key, partition);
  }
  const acc = new Map();
  for (const partition of partitions.values()) {
    partition.forEach((current, index) => {
      const next = partition[index + 1];
      const currentMs = Date.parse(current.occurred_at || "");
      const nextMs = next ? Date.parse(next.occurred_at || "") : NaN;
      const seconds =
        current.user_id == null ||
        current.session_id == null ||
        !Number.isFinite(nextMs) ||
        !Number.isFinite(currentMs)
          ? 0
          : Math.max(
              Math.min((nextMs - currentMs) / 1000, IDLE_CAP_MINUTES * 60),
              0,
            );
      const day = Number.isFinite(currentMs)
        ? new Date(currentMs).toISOString().slice(0, 10)
        : null;
      if (!day) return;
      const rowKey = [
        current.user_id ?? "",
        current.actor_role ?? "",
        current.surface_key ?? "",
        current.action_key ?? "",
        day,
      ].join("\u0000");
      const row = acc.get(rowKey) || {
        user_id: current.user_id ?? null,
        actor_role: current.actor_role ?? null,
        surface_key: current.surface_key ?? null,
        action_key: current.action_key ?? null,
        day,
        events: 0,
        minutes: 0,
      };
      row.events += 1;
      row.minutes += seconds / 60;
      acc.set(rowKey, row);
    });
  }
  return [...acc.values()]
    .map((row) => ({ ...row, minutes: Math.round(row.minutes * 10) / 10 }))
    .sort(
      (a, b) =>
        String(a.day).localeCompare(String(b.day)) ||
        String(a.user_id ?? "").localeCompare(String(b.user_id ?? "")) ||
        String(a.surface_key ?? "").localeCompare(
          String(b.surface_key ?? ""),
        ) ||
        String(a.action_key ?? "").localeCompare(String(b.action_key ?? "")),
    );
}

export function rollupTimeBySurface(rows, { userId = null } = {}) {
  const surfaces = new Map();
  const users = new Map();
  let totalMinutes = 0;
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw) continue;
    const uid = raw.user_id ?? raw.userId ?? null;
    if (userId != null && uid !== userId) continue;
    const surfaceKey = raw.surface_key ?? raw.surfaceKey ?? null;
    const actionKey = raw.action_key ?? raw.actionKey ?? null;
    const minutes = Number(raw.minutes) || 0;
    const events = Number(raw.events) || 0;
    totalMinutes += minutes;
    const surface = surfaces.get(surfaceKey) || {
      surfaceKey,
      minutes: 0,
      events: 0,
      actions: new Map(),
    };
    surface.minutes += minutes;
    surface.events += events;
    if (actionKey != null)
      surface.actions.set(
        actionKey,
        (surface.actions.get(actionKey) || 0) + events,
      );
    surfaces.set(surfaceKey, surface);
    if (uid != null) {
      const user = users.get(uid) || {
        userId: uid,
        role: raw.actor_role ?? raw.role ?? null,
        minutes: 0,
        events: 0,
      };
      user.minutes += minutes;
      user.events += events;
      users.set(uid, user);
    }
  }
  const surfaceRows = [...surfaces.values()]
    .map((s) => ({
      surfaceKey: s.surfaceKey,
      minutes: Math.round(s.minutes * 10) / 10,
      events: s.events,
      actions: [...s.actions.entries()]
        .map(([actionKey, events]) => ({ actionKey, events }))
        .sort(
          (a, b) =>
            b.events - a.events ||
            String(a.actionKey).localeCompare(String(b.actionKey)),
        )
        .slice(0, 5),
    }))
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        String(a.surfaceKey ?? "").localeCompare(String(b.surfaceKey ?? "")),
    );
  const userRows = [...users.values()]
    .map((u) => ({ ...u, minutes: Math.round(u.minutes * 10) / 10 }))
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        String(a.userId).localeCompare(String(b.userId)),
    );
  return {
    totalMinutes: Math.round(totalMinutes * 10) / 10,
    surfaces: surfaceRows,
    users: userRows,
  };
}
