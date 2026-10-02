import { formatMonthKey, itemizedMonthKey } from "./budgetAccountCard.js";
import { formatItemizedAmountForDisplay } from "./budgetItemized.js";

const NOT_RECORDED = "Not recorded";

const TRACKED_FIELDS = [
  {
    field: "amount",
    label: null,
    format: (v) =>
      v === null || v === undefined || v === ""
        ? null
        : formatItemizedAmountForDisplay(v),
  },
  {
    field: "growth",
    label: "Increase",
    format: (v) => (v === null || v === undefined || v === "" ? null : `${v}%`),
  },
  {
    field: "increase_frequency",
    label: "Increase every",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "increase_interval_months",
    label: "Custom months",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "frequency",
    label: "Frequency",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "last_month",
    label: "Last month",
    format: (v) => formatMonthKey(v),
  },
  {
    field: "data_source",
    label: "Method",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "line_description",
    label: "Description",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "adjustments",
    label: "Adjustments",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "active_beds_pct",
    label: "Active beds %",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "reference",
    label: "Reference",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
  {
    field: "function_2",
    label: "Function",
    format: (v) => (v == null || v === "" ? null : String(v)),
  },
];

function snapshotMonth(snap) {
  return snap && typeof snap === "object"
    ? itemizedMonthKey(snap.first_month)
    : null;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null)
    return (a == null || a === "") && (b == null || b === "");
  const na = Number(a);
  const nb = Number(b);
  if (
    Number.isFinite(na) &&
    Number.isFinite(nb) &&
    String(a).trim() !== "" &&
    String(b).trim() !== ""
  ) {
    return Math.abs(na - nb) <= 1e-6;
  }
  return String(a) === String(b);
}

function amountText(snap) {
  if (!snap || typeof snap !== "object") return null;
  return TRACKED_FIELDS[0].format(snap.amount);
}

function describeFieldChange(prev, next) {
  for (const t of TRACKED_FIELDS) {
    if (sameValue(prev[t.field], next[t.field])) continue;
    return {
      valueLabel: t.label,
      before: t.format(prev[t.field]) ?? "—",
      after: t.format(next[t.field]) ?? "—",
    };
  }
  return null;
}

function baseEntry(version, authors) {
  const id = version.changed_by ? String(version.changed_by) : "";
  return {
    author: (authors && id && authors[id]) || null,
    at: version.changed_at || null,
    note:
      version.note == null || String(version.note).trim() === ""
        ? null
        : String(version.note),
    versionId: version.id,
    itemizedId: version.itemized_id,
  };
}

export function buildMonthTrackedChanges(versions, { authors = {} } = {}) {
  const byMonth = new Map();
  const push = (month, entry) => {
    if (!month) return;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(entry);
  };

  for (const v of Array.isArray(versions) ? versions : []) {
    if (!v || !v.changed_by) continue;
    const kind = String(v.change_kind || "").toUpperCase();
    const next =
      v.row_snapshot && typeof v.row_snapshot === "object"
        ? v.row_snapshot
        : null;
    const prev =
      v.prev_snapshot && typeof v.prev_snapshot === "object"
        ? v.prev_snapshot
        : null;
    const base = baseEntry(v, authors);

    if (kind === "INSERT") {
      push(snapshotMonth(next), {
        ...base,
        before: null,
        after: amountText(next) ?? "—",
      });
      continue;
    }

    if (kind === "DELETE") {
      const gone = prev || next;
      push(snapshotMonth(gone), {
        ...base,
        before: amountText(gone) ?? "—",
        after: null,
        valueLabel: "Line deleted",
      });
      continue;
    }

    if (kind !== "UPDATE" || !next) continue;

    if (!prev) {
      push(snapshotMonth(next), {
        ...base,
        before: NOT_RECORDED,
        after: amountText(next) ?? "—",
      });
      continue;
    }

    const fromMonth = snapshotMonth(prev);
    const toMonth = snapshotMonth(next);
    if (fromMonth && toMonth && fromMonth !== toMonth) {
      push(fromMonth, {
        ...base,
        before: amountText(prev) ?? "—",
        after: null,
        valueLabel: `Moved to ${formatMonthKey(toMonth)}`,
      });
      push(toMonth, {
        ...base,
        before: null,
        after: amountText(next) ?? "—",
        valueLabel: `Moved from ${formatMonthKey(fromMonth)}`,
      });
      continue;
    }

    const change = describeFieldChange(prev, next);
    if (!change) continue;
    push(toMonth || fromMonth, { ...base, ...change });
  }

  const byTime = (a, b) => String(b.at || "").localeCompare(String(a.at || ""));
  for (const entries of byMonth.values()) entries.sort(byTime);
  return byMonth;
}

export function trackedChangesForMonth(byMonth, monthValue) {
  const key = itemizedMonthKey(monthValue);
  if (!key || !byMonth || typeof byMonth.get !== "function") return [];
  return byMonth.get(key) || [];
}
