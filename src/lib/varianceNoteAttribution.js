import { noteCoversMonth, noteWasEdited, rangeLabel } from "./varianceNotes.js";

const nameOf = (authors, id) => {
  if (id == null) return null;
  const n = authors && authors[String(id)];
  return n ? String(n).trim() || null : null;
};

export function noteAttribution(note, authors = {}, historyRows = null) {
  if (!note || note.id == null) return null;
  const edited = noteWasEdited(note);
  let editedBy = edited ? nameOf(authors, note.updated_by) : null;
  let editedAt = edited ? note.updated_at || null : null;

  const updates = (Array.isArray(historyRows) ? historyRows : [])
    .filter(
      (v) =>
        v &&
        v.change_kind === "UPDATE" &&
        String(v.note_id ?? note.id) === String(note.id),
    )
    .sort((a, b) =>
      String(a.changed_at || "").localeCompare(String(b.changed_at || "")),
    );
  const last = updates.length ? updates[updates.length - 1] : null;
  if (last) {
    editedBy = nameOf(authors, last.changed_by);
    editedAt = last.changed_at || null;
  }

  return {
    author: nameOf(authors, note.created_by),
    at: note.created_at || null,
    editedBy,
    editedAt,
    note: note.note_text == null ? null : String(note.note_text),
    months: note.month_end
      ? rangeLabel(note.month_start || note.month_end, note.month_end)
      : null,
  };
}

export function chainsCoveringMonth(chains, monthEnd) {
  if (!monthEnd) return [];
  return (Array.isArray(chains) ? chains : []).filter(
    (c) => c && noteCoversMonth(c.note || c, monthEnd),
  );
}

export function noteMarksForMonth(chains, monthEnd, authors = {}) {
  return chainsCoveringMonth(chains, monthEnd)
    .map((c) => noteAttribution(c.note || c, authors))
    .filter(Boolean);
}

export function attributionLine(a, formatTime) {
  if (!a) return "";
  const who = a.author || "Unidentified user";
  let line = `Written by ${who}, ${formatTime(a.at)}`;
  if (a.editedBy || a.editedAt) {
    line += ` · edited by ${a.editedBy || "Unidentified user"}, ${formatTime(a.editedAt)}`;
  }
  return line;
}
