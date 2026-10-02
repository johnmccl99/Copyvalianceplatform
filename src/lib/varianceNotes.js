import { supabase } from "./supabaseClient.js";

export const VARIANCE_NOTE_ROLES = Object.freeze(["admin", "gp", "gp_admin"]);

const NOTE_COLUMNS =
  "id, property_code, month_start, month_end, group_key, account_number, account_name, " +
  "note_text, created_by, created_at, updated_by, updated_at, " +
  "thread_id, version, superseded_at, superseded_by";

export const NOTE_FETCH_LIMIT = 2000;

export const NOTE_TEXT_MAX = 4000;

export function noteKey(n) {
  const end = n?.month_end || "";
  const start = n?.month_start || end;
  const range = `${start}..${end}`;
  if (n?.account_number != null) return `acct:${n.account_number}|${range}`;
  return `group:${n?.group_key ?? ""}|${range}`;
}

export function noteCoversMonth(n, monthEnd) {
  if (!n?.month_end || !monthEnd) return false;
  const start = n.month_start || n.month_end;
  return (
    String(start) <= String(monthEnd) && String(monthEnd) <= String(n.month_end)
  );
}

export async function fetchVarianceNoteAccess() {
  const denied = (error = null) => ({
    permitted: false,
    role: null,
    isAdmin: false,
    error,
  });
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const authId = userData?.user?.id;
    if (userErr || !authId) return denied(userErr || null);
    const { data, error } = await supabase
      .from("user_profiles")
      .select("role, is_admin")
      .eq("auth_id", authId)
      .maybeSingle();
    if (error || !data) return denied(error || null);
    const role = data.role || null;
    const isAdmin = data.is_admin === true;
    return {
      permitted: isAdmin || VARIANCE_NOTE_ROLES.includes(role),
      role,
      isAdmin,
      error: null,
    };
  } catch (e) {
    return denied(e);
  }
}

export async function fetchVarianceNotes(propertyCode, period = null) {
  if (!propertyCode) return { data: [], truncated: false, error: null };
  try {
    let query = supabase
      .from("variance_notes")
      .select(NOTE_COLUMNS)
      .eq("property_code", String(propertyCode));
    const start = monthBound(period?.start, "start");
    const end = monthBound(period?.end, "end");
    if (start) query = query.gte("month_end", start);
    if (end) query = query.lte("month_start", end);
    const { data, error } = await query
      .order("month_end", { ascending: false })
      .limit(NOTE_FETCH_LIMIT + 1);
    if (error) return { data: [], truncated: false, error };
    const rows = Array.isArray(data) ? data : [];
    return {
      data: rows.slice(0, NOTE_FETCH_LIMIT),
      truncated: rows.length > NOTE_FETCH_LIMIT,
      error: null,
    };
  } catch (e) {
    return { data: [], truncated: false, error: e };
  }
}

export function validateNoteText(noteText) {
  const text = typeof noteText === "string" ? noteText.trim() : "";
  if (text.length === 0) return { ok: false, text, reason: "empty" };
  if (text.length > NOTE_TEXT_MAX)
    return { ok: false, text, reason: "too_long" };
  return { ok: true, text, reason: null };
}

export async function createVarianceNote({
  propertyCode,
  monthStart = null,
  monthEnd,
  accountNumber,
  accountName = null,
  noteText,
} = {}) {
  const { ok, text, reason } = validateNoteText(noteText);
  if (!ok) return { data: null, error: null, reason };
  if (!propertyCode || accountNumber == null || accountNumber === "") {
    return { data: null, error: null, reason: "invalid_grain" };
  }
  const start = monthStart == null ? String(monthEnd) : String(monthStart);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(monthEnd)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start)
  ) {
    return { data: null, error: null, reason: "invalid_month" };
  }
  if (start > String(monthEnd))
    return { data: null, error: null, reason: "invalid_range" };
  try {
    const { data, error } = await supabase
      .from("variance_notes")
      .insert({
        property_code: String(propertyCode),
        month_start: start,
        month_end: String(monthEnd),
        account_number: String(accountNumber),
        account_name: accountName || null,
        note_text: text,
      })
      .select(NOTE_COLUMNS)
      .single();
    if (error) return { data: null, error, reason: writeFailureReason(error) };
    return { data, error: null, reason: null };
  } catch (e) {
    return { data: null, error: e, reason: "failed" };
  }
}

export function monthLabel(monthEnd) {
  if (typeof monthEnd !== "string") return monthEnd || "";
  const d = new Date(`${monthEnd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthEnd;
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function rangeLabel(monthStart, monthEnd) {
  const end = monthLabel(monthEnd);
  if (!monthStart || monthStart === monthEnd) return end;
  const start = monthLabel(monthStart);
  if (start === end) return end;
  const sameYear =
    typeof monthStart === "string" &&
    typeof monthEnd === "string" &&
    monthStart.slice(0, 4) === monthEnd.slice(0, 4);
  return `${sameYear ? start.replace(/\s\d{4}$/, "") : start} – ${end}`;
}

export function stampLabel(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function updateVarianceNote({ id, noteText } = {}) {
  const { ok, text, reason } = validateNoteText(noteText);
  if (!ok) return { data: null, error: null, reason };
  if (!id) return { data: null, error: null, reason: "invalid_grain" };
  try {
    const { data, error } = await supabase
      .from("variance_notes")
      .update({ note_text: text })
      .eq("id", String(id))
      .select(NOTE_COLUMNS);
    if (error) return { data: null, error, reason: writeFailureReason(error) };
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, error: null, reason: "denied" };
    }
    return { data: data[0], error: null, reason: null };
  } catch (e) {
    return { data: null, error: e, reason: "failed" };
  }
}

export async function deleteVarianceNote(id) {
  if (!id) return { data: null, error: null, reason: "invalid_grain" };
  try {
    const { data, error } = await supabase
      .from("variance_notes")
      .delete()
      .eq("id", String(id))
      .select("id");
    if (error) return { data: null, error, reason: writeFailureReason(error) };
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, error: null, reason: "denied" };
    }
    return { data: data[0], error: null, reason: null };
  } catch (e) {
    return { data: null, error: e, reason: "failed" };
  }
}

export async function fetchNoteHistory(noteId) {
  if (!noteId) return { data: [], error: null };
  try {
    const { data, error } = await supabase
      .from("variance_note_versions")
      .select(
        "id, note_id, change_kind, changed_by, changed_at, row_snapshot, prev_snapshot",
      )
      .eq("note_id", String(noteId))
      .order("changed_at", { ascending: true })
      .limit(200);
    if (error) return { data: [], error };
    return { data: Array.isArray(data) ? data : [], error: null };
  } catch (e) {
    return { data: [], error: e };
  }
}

export function historyText(v) {
  const kind = v?.change_kind;
  const row = v?.row_snapshot?.note_text ?? null;
  const prev = v?.prev_snapshot?.note_text ?? null;
  if (kind === "INSERT") return { before: null, after: row };
  if (kind === "DELETE") return { before: row, after: null };
  return { before: prev, after: row };
}

export async function fetchNoteAuthorNames(profileIds = []) {
  const ids = [...new Set((profileIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return { data: {}, error: null };
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, display_name")
      .in("id", ids);
    if (error) return { data: {}, error };
    const byId = {};
    for (const row of Array.isArray(data) ? data : []) {
      if (row?.id) byId[String(row.id)] = row.display_name || null;
    }
    return { data: byId, error: null };
  } catch (e) {
    return { data: {}, error: e };
  }
}

function chainRoots(rows) {
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c);
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const r of rows) parent.set(String(r.id), String(r.id));
  const byThread = new Map();
  for (const r of rows) {
    const id = String(r.id);
    const t = r.thread_id != null ? String(r.thread_id) : id;
    if (byThread.has(t)) union(id, byThread.get(t));
    else byThread.set(t, id);
    const succ = r.superseded_by != null ? String(r.superseded_by) : null;
    if (succ && parent.has(succ)) union(id, succ);
  }
  return { find };
}

function byVersionDesc(a, b) {
  const va = Number.isFinite(a?.version) ? a.version : 1;
  const vb = Number.isFinite(b?.version) ? b.version : 1;
  if (va !== vb) return vb - va;
  return String(b?.created_at || "").localeCompare(String(a?.created_at || ""));
}

export function indexVarianceNotes(rows = []) {
  const clean = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && r.id != null,
  );
  const { find } = chainRoots(clean);

  const grouped = new Map();
  for (const r of clean) {
    const root = find(String(r.id));
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(r);
  }

  const byKey = new Map();
  const byAccount = new Map();
  const byGroup = new Map();
  const byThread = new Map();

  for (const [root, versions] of grouped) {
    versions.sort(byVersionDesc);
    const live = versions.find((v) => !v.superseded_at) || null;
    const note = live || versions[0];
    const chain = {
      id: root,
      note,
      current: !!live,
      versions,
      priorVersions: versions.filter((v) => v !== note),
    };
    byThread.set(root, chain);
    byKey.set(noteKey(note), chain);
    if (note.account_number != null) {
      const k = String(note.account_number);
      if (!byAccount.has(k)) byAccount.set(k, []);
      byAccount.get(k).push(chain);
    } else if (note.group_key != null) {
      const k = String(note.group_key);
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push(chain);
    }
  }

  const byMonthDesc = (a, b) => {
    const end = String(b.note.month_end).localeCompare(
      String(a.note.month_end),
    );
    if (end !== 0) return end;
    return String(a.note.month_start || a.note.month_end).localeCompare(
      String(b.note.month_start || b.note.month_end),
    );
  };
  for (const list of byAccount.values()) list.sort(byMonthDesc);
  for (const list of byGroup.values()) list.sort(byMonthDesc);
  return { byKey, byAccount, byGroup, byThread };
}

export function noteWasEdited(n) {
  if (!n?.created_at || !n?.updated_at) return false;
  const created = new Date(n.created_at).getTime();
  const updated = new Date(n.updated_at).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return false;
  return updated - created > 1000;
}

export const NOTE_RANGE_PRESETS = Object.freeze([
  { id: "month", label: "This month" },
  { id: "multi", label: "Multiple months" },
  { id: "quarter", label: "Quarter" },
  { id: "window", label: "Fiscal year" },
]);

export function resolvePresetRange(preset, anchorMonthEnd, monthOptions = []) {
  const months = [
    ...new Set(
      (monthOptions || [])
        .map((m) => m?.month_end)
        .filter(Boolean)
        .map(String),
    ),
  ].sort();
  if (months.length === 0) return null;
  const anchor = months.includes(String(anchorMonthEnd))
    ? String(anchorMonthEnd)
    : months[months.length - 1];

  let covered;
  if (preset === "window") {
    covered = months;
  } else if (preset === "quarter") {
    const m = Number(anchor.slice(5, 7));
    const qFirst = Math.floor((m - 1) / 3) * 3 + 1;
    const qLast = qFirst + 2;
    const year = anchor.slice(0, 4);
    covered = months.filter((x) => {
      if (x.slice(0, 4) !== year) return false;
      const mm = Number(x.slice(5, 7));
      return mm >= qFirst && mm <= qLast;
    });
  } else {
    covered = [anchor];
  }

  if (covered.length === 0) covered = [anchor];
  return {
    monthStart: covered[0],
    monthEnd: covered[covered.length - 1],
    months: covered,
  };
}

export function monthsInRange(range, monthOptions = []) {
  if (!range?.monthStart || !range?.monthEnd) return [];
  return (monthOptions || [])
    .map((m) => m?.month_end)
    .filter(Boolean)
    .map(String)
    .filter((m) => m >= String(range.monthStart) && m <= String(range.monthEnd))
    .sort();
}

function writeFailureReason(error) {
  const code = error?.code ? String(error.code) : "";
  if (code === "23505") return "conflict";
  if (code === "23P01") return "conflict";
  if (code === "42501") return "denied";
  if (code === "23514") return "rejected_text";
  return "failed";
}

function monthBound(monthKey, edge) {
  if (typeof monthKey !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey))
    return null;
  const [y, m] = monthKey.split("-").map(Number);
  if (edge === "start") return `${monthKey}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(last).padStart(2, "0")}`;
}
