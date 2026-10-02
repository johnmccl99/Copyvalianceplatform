import { ITEMIZED_EDITOR_COLUMNS } from "./budgetItemized.js";

export function diffItemizedSnapshots(newer, older) {
  const norm = (x) => (x == null || x === "" ? "" : String(x));
  const out = [];
  for (const c of ITEMIZED_EDITOR_COLUMNS) {
    const a = older ? older[c.field] : undefined;
    const b = newer ? newer[c.field] : undefined;
    if (norm(a) !== norm(b))
      out.push({ field: c.label, from: norm(a), to: norm(b) });
  }
  return out;
}

export function describeVersionAuthor(changedBy) {
  return changedBy
    ? `user ${String(changedBy).slice(0, 8)}`
    : "system (workbook ingest)";
}

export function restoreIntent(ver) {
  const kind =
    ver && ver.change_kind ? String(ver.change_kind).toUpperCase() : "";
  if (kind === "DELETE") {
    return {
      label: "Put this line back",
      undoes: true,
      explain: "The line was deleted. Restoring puts it back as it stood.",
    };
  }
  if (ver && ver.prev_snapshot) {
    return {
      label: "Undo this change",
      undoes: true,
      explain:
        "This version records what the line looked like before the change, so restoring undoes it.",
    };
  }
  return {
    label: "Restore to this state",
    undoes: false,
    explain:
      "This version has no before-image, so restoring reinstates the state this change produced — it does not undo it.",
  };
}

export function buildVersionEntries(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const ta = a.changed_at ? Date.parse(a.changed_at) : 0;
      const tb = b.changed_at ? Date.parse(b.changed_at) : 0;
      if (tb !== ta) return tb - ta;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  return list.map((ver, i) => {
    const kind = ver.change_kind ? String(ver.change_kind).toUpperCase() : "";
    const older = list[i + 1];
    return {
      id: ver.id,
      kind,
      changedAt: ver.changed_at || null,
      author: describeVersionAuthor(ver.changed_by),
      intent: restoreIntent(ver),
      diff:
        kind === "DELETE"
          ? []
          : diffItemizedSnapshots(
              ver.row_snapshot,
              older ? older.row_snapshot : null,
            ),
      isOldest: i === list.length - 1,
    };
  });
}

export function describeRestoreOutcome({ data = null, error = null } = {}) {
  if (error) {
    return {
      ok: false,
      message: `${error.message || "The restore could not be applied."} Nothing was changed.`,
    };
  }
  if (!data || data.ok === false) {
    return {
      ok: false,
      message:
        "The server did not confirm the restore, so treat this line as unchanged and read its history again.",
    };
  }
  if (data.action === "reinserted") {
    return {
      ok: true,
      message:
        "The line had been deleted and has been put back as that version recorded it.",
    };
  }
  const from =
    data.restored_from_image === "prev_snapshot"
      ? "the state it was in before that change"
      : "the state that version recorded";
  return { ok: true, message: `The line was restored to ${from}.` };
}
