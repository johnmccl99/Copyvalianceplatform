export function formatMinutes(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return "0m";
  if (m < 1) return "<1m";
  const whole = Math.round(m);
  const h = Math.floor(whole / 60);
  const rem = whole % 60;
  if (h === 0) return `${rem}m`;
  return `${h}h ${String(rem).padStart(2, "0")}m`;
}

export const MAX_MINUTES_PER_DAY = 1440;

export function groupTimeInAppByUser(rows) {
  const byUser = new Map();
  for (const r of rows || []) {
    const email = r.user_email || "(unknown)";
    let u = byUser.get(email);
    if (!u) {
      u = {
        user_email: email,
        totalMinutes: 0,
        sessions: 0,
        estimated: false,
        days: [],
      };
      byUser.set(email, u);
    }
    const minutes = Number(r.minutes) || 0;
    u.totalMinutes += minutes;
    u.sessions += Number(r.sessions) || 0;
    u.estimated = u.estimated || !!r.estimated;
    u.days.push({
      day: r.day,
      minutes,
      sessions: Number(r.sessions) || 0,
      estimated: !!r.estimated,
    });
  }
  const users = [...byUser.values()];
  for (const u of users) {
    u.days.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    u.totalMinutes = Math.round(u.totalMinutes * 10) / 10;
  }
  users.sort(
    (a, b) =>
      b.totalMinutes - a.totalMinutes ||
      a.user_email.localeCompare(b.user_email),
  );
  return users;
}

export function aggregateSessionsByDay(sessions) {
  const acc = new Map();
  for (const s of sessions || []) {
    const started = new Date(s.started_at);
    const endedAt = s.ended_at || s.last_active;
    const ended = new Date(endedAt);
    const startMs = started.getTime();
    const endMs = Math.max(ended.getTime(), startMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const firstDay = Date.UTC(
      started.getUTCFullYear(),
      started.getUTCMonth(),
      started.getUTCDate(),
    );
    const lastDay = Date.UTC(
      ended.getUTCFullYear(),
      ended.getUTCMonth(),
      ended.getUTCDate(),
    );
    for (let dayMs = firstDay; dayMs <= lastDay; dayMs += 86400000) {
      const day = new Date(dayMs).toISOString().slice(0, 10);
      const dayEndMs = dayMs + 86400000;
      const minutes =
        Math.max(Math.min(dayEndMs, endMs) - Math.max(dayMs, startMs), 0) /
        60000;
      const key = `${s.user_email}\u0000${day}`;
      const row = acc.get(key) || {
        user_email: s.user_email,
        day,
        minutes: 0,
        sessions: 0,
        estimated: false,
      };
      row.minutes += minutes;
      row.sessions += 1;
      row.estimated =
        row.estimated || (s.metadata && s.metadata.source === "backfill");
      acc.set(key, row);
    }
  }
  return [...acc.values()].map((r) => ({
    ...r,
    minutes: Math.round(r.minutes * 10) / 10,
  }));
}
