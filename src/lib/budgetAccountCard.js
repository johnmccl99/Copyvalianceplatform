export const NO_METHOD_KEY = "\u0000no-source";
export const NO_METHOD_LABEL = "No source stated";

export const ACCOUNT_CARD_FIELDS = [
  { field: "amount", label: "Amount", type: "number" },
  { field: "growth", label: "Increase", type: "number" },
  {
    field: "increase_frequency",
    label: "Increase every",
    type: "increaseFrequency",
  },
  { field: "increase_interval_months", label: "Custom months", type: "number" },
  { field: "frequency", label: "Frequency", type: "frequency" },
];

export function itemizedMonthKey(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  const month = Number(m[2]);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}`;
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export function formatMonthKey(key) {
  const k = itemizedMonthKey(key);
  if (!k) return null;
  return `${MONTH_ABBR[Number(k.slice(5, 7)) - 1]} '${k.slice(2, 4)}`;
}

export function lineMethodKey(line) {
  const s = String((line && line.data_source) || "").trim();
  return s || NO_METHOD_KEY;
}

export function methodLabel(key) {
  return key === NO_METHOD_KEY ? NO_METHOD_LABEL : key;
}

export function groupLinesByMethod(lines) {
  const byKey = new Map();
  for (const line of lines || []) {
    if (!line) continue;
    const key = lineMethodKey(line);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(line);
  }
  const groups = [];
  for (const [key, groupLines] of byKey) {
    const sorted = [...groupLines].sort((a, b) => {
      const ai =
        a.source_row_index == null
          ? Number.MAX_SAFE_INTEGER
          : Number(a.source_row_index);
      const bi =
        b.source_row_index == null
          ? Number.MAX_SAFE_INTEGER
          : Number(b.source_row_index);
      if (ai !== bi) return ai - bi;
      return String(a.first_month || "").localeCompare(
        String(b.first_month || ""),
      );
    });
    const months = sorted
      .map((l) => itemizedMonthKey(l.first_month))
      .filter(Boolean)
      .sort();
    groups.push({
      key,
      label: methodLabel(key),
      stated: key !== NO_METHOD_KEY,
      lines: sorted,
      lineCount: sorted.length,
      months,
      firstMonth: months.length ? months[0] : null,
      lastMonth: months.length ? months[months.length - 1] : null,
    });
  }
  groups.sort(
    (a, b) => b.lineCount - a.lineCount || a.label.localeCompare(b.label),
  );
  return groups;
}

export function monthEndDate(key) {
  const k = itemizedMonthKey(key);
  if (!k) return null;
  const year = Number(k.slice(0, 4));
  const month = Number(k.slice(5, 7));
  return `${k}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function lineSpansBeyondItsMonth(line) {
  const first = itemizedMonthKey(line && line.first_month);
  if (!first) return true;
  const last = itemizedMonthKey(line && line.last_month);
  return !last || last !== first;
}

export function newLineCategoryFor(groupLines) {
  const seen = new Set();
  for (const line of groupLines || []) {
    const c = String((line && line.category) || "").trim();
    if (c) seen.add(c);
  }
  if (seen.size === 1) return { ok: true, category: [...seen][0], distinct: 1 };
  return { ok: false, category: null, distinct: seen.size };
}

export function buildNewLineRow({
  month,
  fields,
  representative,
  accountNumber,
} = {}) {
  const key = itemizedMonthKey(month);
  const errors = [];
  if (!key) errors.push("Choose the month this line is for.");
  const typed = fields
    ? String(fields.amount == null ? "" : fields.amount).trim()
    : "";
  const read = parseAmountCell(typed);
  let amount = typed;
  if (read.blank) errors.push("Enter an amount for the new line.");
  else if (read.value === null)
    errors.push(`"${typed}" is not an amount this card can store.`);
  else amount = String(read.value);
  const rep = representative || {};
  const acct = String(
    accountNumber == null ? rep.account_number || "" : accountNumber,
  ).trim();
  if (!acct)
    errors.push(
      "This account has no account number to file the new line under.",
    );
  const cadence = String((fields && fields.increase_frequency) || "").trim();
  const interval = String(
    (fields && fields.increase_interval_months) || "",
  ).trim();
  if (cadence === "Custom" && interval === "") {
    errors.push('An increase every "Custom" needs the number of months.');
  }
  if (cadence !== "Custom" && interval !== "") {
    errors.push(
      'Custom months only applies when the increase cadence is "Custom".',
    );
  }
  if (errors.length) return { ok: false, errors, row: null };
  const date = monthEndDate(key);
  const row = {
    account_number: acct,
    data_source: String(rep.data_source || "").trim() || null,
    line_description: rep.line_description || null,
    category_label: rep.category_label || null,
    noi_build_bucket: rep.noi_build_bucket || null,
    first_month: date,
    last_month: date,
    amount,
    frequency: (fields && fields.frequency) || "Monthly",
  };
  for (const f of [
    "growth",
    "increase_frequency",
    "increase_interval_months",
  ]) {
    const v = fields ? fields[f] : "";
    if (v !== undefined && v !== null && String(v).trim() !== "")
      row[f] = String(v).trim();
  }
  return { ok: true, errors: [], row };
}

export function parseAmountCell(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (s === "") return { blank: true, value: null };
  let t = s.replace(/[$\u00a0\s,]/g, "");
  let negative = false;
  const paren = /^\((.*)\)$/.exec(t);
  if (paren) {
    negative = true;
    t = paren[1];
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t))
    return { blank: false, value: null, unparseable: true };
  const n = Number(t);
  if (!Number.isFinite(n))
    return { blank: false, value: null, unparseable: true };
  return { blank: false, value: negative ? -n : n };
}

export const PASTE_REFUSAL_TEXT = Object.freeze({
  unparseable: "not a number this card can read",
  closed: "closed month — realized in the GL",
  "no-line": "no stored line for this month in this method",
  ambiguous: "more than one stored line for this month",
  spanning: "the line for this month also lands on other months",
  "past-axis": "past the last month on the statement",
});

export function planPastedColumn(
  text,
  { axis, closedMonths, lines, startMonth } = {},
) {
  const rows = String(text == null ? "" : text).split(/\r?\n/);
  while (rows.length && rows[rows.length - 1].trim() === "") rows.pop();
  const empty = rows.length === 0;
  const wide = rows.length === 1 && rows[0].indexOf("\t") !== -1;
  if (empty || wide) {
    return {
      entries: [],
      changes: [],
      refused: [],
      blanks: 0,
      unchanged: 0,
      empty,
      wide,
    };
  }

  const axisMonths = [];
  for (const m of axis || []) {
    const k = itemizedMonthKey(m && m.month_end);
    if (k) axisMonths.push(k);
  }
  const start = itemizedMonthKey(startMonth);
  const targets = start ? axisMonths.filter((k) => k >= start) : axisMonths;

  const byMonth = new Map();
  for (const line of lines || []) {
    const k = itemizedMonthKey(line && line.first_month);
    if (!k) continue;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(line);
  }
  const closed = closedMonths || new Set();

  const entries = [];
  for (let i = 0; i < rows.length; i += 1) {
    const cell = rows[i].split("\t")[0];
    const month = targets[i] || null;
    const parsed = parseAmountCell(cell);
    const base = {
      index: i,
      cell: String(cell).trim(),
      month,
      value: parsed.value,
    };
    if (parsed.blank) {
      entries.push({ ...base, status: "blank" });
      continue;
    }
    if (parsed.unparseable) {
      entries.push({ ...base, status: "unparseable" });
      continue;
    }
    if (!month) {
      entries.push({ ...base, status: "past-axis" });
      continue;
    }
    if (closed.has(month)) {
      entries.push({ ...base, status: "closed" });
      continue;
    }
    const group = byMonth.get(month) || [];
    if (group.length === 0) {
      entries.push({ ...base, status: "no-line" });
      continue;
    }
    if (group.length > 1) {
      entries.push({ ...base, status: "ambiguous" });
      continue;
    }
    const line = group[0];
    if (lineSpansBeyondItsMonth(line)) {
      entries.push({ ...base, status: "spanning", line });
      continue;
    }
    const stored =
      line.amount === null || line.amount === undefined
        ? ""
        : String(line.amount);
    entries.push({
      ...base,
      status: Number(stored) === parsed.value ? "same" : "ok",
      line,
      stored,
    });
  }

  const changes = entries
    .filter((e) => e.status === "ok")
    .map((e) => ({ id: e.line.id, new_value: e.value, expected: e.stored }));
  const refused = entries.filter((e) => PASTE_REFUSAL_TEXT[e.status]);
  return {
    entries,
    changes,
    refused,
    blanks: entries.filter((e) => e.status === "blank").length,
    unchanged: entries.filter((e) => e.status === "same").length,
    empty,
    wide,
  };
}

export function describePastePlan(plan) {
  if (!plan || plan.empty)
    return {
      ready: false,
      message: "Paste a column of monthly amounts to see what it would change.",
    };
  if (plan.wide) {
    return {
      ready: false,
      message:
        "That looks like one row across, not a column down. Copy a single column of monthly amounts — " +
        "one month per row, in statement order — and paste it again.",
    };
  }
  const parts = [];
  parts.push(
    `${plan.changes.length} month${plan.changes.length === 1 ? "" : "s"} would change`,
  );
  if (plan.unchanged)
    parts.push(
      `${plan.unchanged} already hold${plan.unchanged === 1 ? "s" : ""} the pasted amount`,
    );
  if (plan.blanks)
    parts.push(
      `${plan.blanks} blank cell${plan.blanks === 1 ? "" : "s"} left alone`,
    );
  if (plan.refused.length)
    parts.push(`${plan.refused.length} refused and named below`);
  return {
    ready: plan.changes.length > 0 && plan.refused.length === 0,
    message: `${parts.join(" · ")}. Nothing is written until you apply it.`,
  };
}

export function describePasteOutcome({
  requested,
  updated,
  unchanged,
  skipped,
  missing,
}) {
  const req = Number(requested) || 0;
  const upd = Number(updated) || 0;
  const skip = Number(skipped) || 0;
  const miss = Number(missing) || 0;
  const same = Number(unchanged) || 0;
  if (upd + same === req && skip === 0 && miss === 0) {
    return {
      ok: true,
      partial: false,
      message:
        `Pasted ${upd} month amount${upd === 1 ? "" : "s"}` +
        `${same ? ` (${same} already held the pasted amount)` : ""}. The line count did not change.`,
    };
  }
  const tail = [];
  if (skip)
    tail.push(
      `${skip} skipped because the stored amount moved after the preview`,
    );
  if (miss) tail.push(`${miss} could not be found`);
  return {
    ok: false,
    partial: true,
    message:
      `Only ${upd} of ${req} month amounts were written` +
      `${tail.length ? ` — ${tail.join(", ")}` : ""}. Reload the card and check before repeating the paste.`,
  };
}

export function summarizeAccountMethods(lines) {
  const groups = groupLinesByMethod(lines);
  const months = (lines || [])
    .map((l) => itemizedMonthKey(l && l.first_month))
    .filter(Boolean)
    .sort();
  return {
    groups,
    lineCount: (lines || []).length,
    methodCount: groups.length,
    mixed: groups.length > 1,
    firstMonth: months.length ? months[0] : null,
    lastMonth: months.length ? months[months.length - 1] : null,
  };
}

export function uniformFieldValue(lines, field) {
  const seen = new Set();
  let value = "";
  for (const line of lines || []) {
    const raw = line ? line[field] : null;
    const norm = raw === null || raw === undefined ? "" : String(raw);
    if (!seen.has(norm)) {
      seen.add(norm);
      if (seen.size === 1) value = norm;
    }
  }
  if (seen.size === 0) return { uniform: true, value: "", distinct: 0 };
  if (seen.size === 1) return { uniform: true, value, distinct: 1 };
  return { uniform: false, value: "", distinct: seen.size };
}

export function closedMonthKeySet(axis, isActualByMonth) {
  const set = new Set();
  for (let i = 0; i < (axis || []).length; i += 1) {
    if (!isActualByMonth || !isActualByMonth[i]) continue;
    const key = itemizedMonthKey(axis[i] && axis[i].month_end);
    if (key) set.add(key);
  }
  return set;
}

export function partitionEditableLines(
  lines,
  { closedMonths, from = null, to = null } = {},
) {
  const closed = closedMonths || new Set();
  const lo = itemizedMonthKey(from);
  const hi = itemizedMonthKey(to);
  const editable = [];
  const held = [];
  for (const line of lines || []) {
    const key = itemizedMonthKey(line && line.first_month);
    if (!key) {
      held.push({ line, reason: "no-month" });
      continue;
    }
    if (closed.has(key)) {
      held.push({ line, reason: "closed" });
      continue;
    }
    if (lo && key < lo) {
      held.push({ line, reason: "outside-window" });
      continue;
    }
    if (hi && key > hi) {
      held.push({ line, reason: "outside-window" });
      continue;
    }
    editable.push(line);
  }
  return { editable, held };
}

export function buildAccountCardPatch(draft, current) {
  const patch = {};
  for (const { field } of ACCOUNT_CARD_FIELDS) {
    if (!(field in (draft || {}))) continue;
    const next = draft[field];
    if (next === null || next === undefined) continue;
    const cur = current && current[field];
    if (String(next) === "") continue;
    if (cur && cur.uniform && String(cur.value) === String(next)) continue;
    patch[field] = next;
  }
  return patch;
}

export function describeBulkOutcome({ requested, updated }) {
  const req = Number.isFinite(Number(requested)) ? Number(requested) : 0;
  const upd = Number.isFinite(Number(updated)) ? Number(updated) : 0;
  if (req === 0) {
    return {
      ok: false,
      partial: false,
      message: "Nothing was sent, so nothing changed.",
    };
  }
  if (upd === req) {
    return {
      ok: true,
      partial: false,
      message: `Saved to ${upd} stored line${upd === 1 ? "" : "s"}. The line count did not change.`,
    };
  }
  return {
    ok: false,
    partial: true,
    message:
      `Only ${upd} of ${req} stored lines were written. This is a partial save, not a save: ` +
      "the lines that did not update may belong to another organization or may have moved since this card loaded. " +
      "Reload the card and check before repeating the change.",
  };
}

export function coaBasisByMonth(rows, accountNumber) {
  const acct = String(accountNumber == null ? "" : accountNumber).trim();
  const map = new Map();
  for (const r of rows || []) {
    if (!r || String(r.account_number || "").trim() !== acct) continue;
    if (r.month_index == null) continue;
    map.set(
      Number(r.month_index),
      r.amount_basis == null ? null : String(r.amount_basis),
    );
  }
  return map;
}

export const BASIS_LABELS = Object.freeze({
  actual: "realized GL actual",
  recomputed: "platform recompute",
  workbook: "workbook amount",
});

export function summarizeBasis(basisByMonth, axis) {
  const counts = new Map();
  let unknown = 0;
  for (const m of axis || []) {
    const basis = basisByMonth
      ? basisByMonth.get(Number(m.month_index))
      : undefined;
    if (basis === undefined || basis === null) {
      unknown += 1;
      continue;
    }
    counts.set(basis, (counts.get(basis) || 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([basis, n]) => ({
      basis,
      label: BASIS_LABELS[basis] || basis,
      months: n,
    }));
  return { parts, unknown, mixed: parts.length > 1 };
}
