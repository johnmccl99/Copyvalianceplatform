import {
  ITEMIZED_PASTE_FIELD_ORDER,
  parsePastedItemized,
  validateItemizedRow,
} from "./budgetItemized.js";
import { itemizedMonthKey, formatMonthKey } from "./budgetAccountCard.js";

export const BLOCK_REFUSAL_TEXT = Object.freeze({
  unreadable: "a cell could not be read as the column it landed in",
  "no-account": "no account number in the pasted row",
  "unknown-account": "not an account on this property\u2019s statement",
  "no-category":
    "this account has no stored lines, so the workbook block it belongs to is unknown",
  "no-month": "no first month in the pasted row",
  "bad-month": "the first month could not be read as a date",
  closed: "closed month — realized in the GL",
  "past-axis": "past the last month on the statement",
  invalid: "the line would not pass the same checks the editor applies",
});

export const DUPLICATE_NOTE =
  "a stored line already states this account, source, description and month";

export function blockLineIdentity(row) {
  const part = (v) =>
    String(v == null ? "" : v)
      .trim()
      .toLowerCase();
  return [
    part(row && row.account_number),
    part(row && row.data_source),
    part(row && row.line_description),
    itemizedMonthKey(row && row.first_month) || "",
  ].join("\u0000");
}

export function accountCategory(lines) {
  const seen = new Set();
  for (const line of lines || []) {
    const c = String((line && line.category) || "").trim();
    if (c) seen.add(c);
  }
  if (seen.size === 1) return { ok: true, category: [...seen][0], distinct: 1 };
  return { ok: false, category: null, distinct: seen.size };
}

export function parseBlock(text) {
  return parsePastedItemized(text);
}

export function planPastedBlock(text, { axis, accounts } = {}) {
  const parsed = parseBlock(text);
  if (parsed.error) {
    return {
      entries: [],
      creates: [],
      refused: [],
      duplicates: [],
      byAccount: [],
      empty: true,
      single: false,
      skippedHeader: false,
      error: parsed.error,
    };
  }

  const single =
    parsed.rows.length === 1 &&
    ITEMIZED_PASTE_FIELD_ORDER.slice(1).every((f) => {
      const v = parsed.rows[0][f];
      return v === "" || v === null || v === undefined;
    });
  if (single) {
    return {
      entries: [],
      creates: [],
      refused: [],
      duplicates: [],
      byAccount: [],
      empty: false,
      single: true,
      skippedHeader: parsed.skippedHeader,
      error: null,
    };
  }

  const axisMonths = new Set();
  let lastAxisMonth = null;
  for (const m of axis || []) {
    const k = itemizedMonthKey(m && m.month_end);
    if (!k) continue;
    axisMonths.add(k);
    if (!lastAxisMonth || k > lastAxisMonth) lastAxisMonth = k;
  }

  const accountMap = accounts instanceof Map ? accounts : new Map();
  const storedIdentities = new Map();
  const categoryFor = new Map();
  for (const [acct, ctx] of accountMap) {
    const set = new Set();
    for (const line of (ctx && ctx.lines) || [])
      set.add(blockLineIdentity(line));
    storedIdentities.set(acct, set);
    categoryFor.set(acct, accountCategory((ctx && ctx.lines) || []));
  }

  const entries = [];
  for (let i = 0; i < parsed.rows.length; i += 1) {
    const row = parsed.rows[i];
    const account = String(
      row.account_number == null ? "" : row.account_number,
    ).trim();
    const monthKey = itemizedMonthKey(row.first_month);
    const base = {
      index: i,
      row,
      account,
      month: monthKey,
      monthLabel: monthKey ? formatMonthKey(monthKey) : null,
      duplicate: false,
    };
    const refuse = (status, detail) =>
      entries.push({ ...base, status, detail: detail || "" });

    const cellErrors = Object.keys((row && row._cellErrors) || {}).filter(
      (f) => f !== "first_month",
    );
    if (cellErrors.length > 0) {
      refuse("unreadable", cellErrors.join(", "));
      continue;
    }
    if (!account) {
      refuse("no-account");
      continue;
    }

    const ctx = accountMap.get(account);
    if (!ctx || !ctx.onStatement) {
      refuse("unknown-account");
      continue;
    }

    const cat = categoryFor.get(account);
    if (!cat || !cat.ok) {
      refuse("no-category");
      continue;
    }

    const rawMonth = String(
      row.first_month == null ? "" : row.first_month,
    ).trim();
    if (!rawMonth) {
      refuse("no-month");
      continue;
    }
    if (!monthKey) {
      refuse("bad-month");
      continue;
    }
    if ((ctx.closedMonths || new Set()).has(monthKey)) {
      refuse("closed");
      continue;
    }
    if (!axisMonths.has(monthKey)) {
      refuse("past-axis");
      continue;
    }

    const v = validateItemizedRow(row);
    if (!v.ok) {
      refuse(
        "invalid",
        Object.entries(v.errors)
          .map(([f, m]) => `${f}: ${m}`)
          .join("; "),
      );
      continue;
    }

    entries.push({
      ...base,
      status: "create",
      category: cat.category,
      duplicate: (storedIdentities.get(account) || new Set()).has(
        blockLineIdentity(row),
      ),
      detail: "",
    });
  }

  const creates = entries.filter((e) => e.status === "create");
  const refused = entries.filter((e) => BLOCK_REFUSAL_TEXT[e.status]);
  const duplicates = creates.filter((e) => e.duplicate);

  return {
    entries,
    creates,
    refused,
    duplicates,
    byAccount: groupEntriesByAccount(entries),
    empty: false,
    single: false,
    skippedHeader: parsed.skippedHeader,
    lastAxisMonth,
    error: null,
  };
}

export function groupEntriesByAccount(entries) {
  const byAccount = new Map();
  for (const e of entries || []) {
    const key = e.account || "";
    if (!byAccount.has(key))
      byAccount.set(key, {
        account: key,
        entries: [],
        creates: 0,
        refused: 0,
        duplicates: 0,
      });
    const g = byAccount.get(key);
    g.entries.push(e);
    if (e.status === "create") g.creates += 1;
    if (BLOCK_REFUSAL_TEXT[e.status]) g.refused += 1;
    if (e.duplicate) g.duplicates += 1;
  }
  return [...byAccount.values()];
}

export function accountsInBlock(text) {
  const parsed = parseBlock(text);
  const seen = [];
  const has = new Set();
  for (const row of parsed.rows || []) {
    const a = String(
      row.account_number == null ? "" : row.account_number,
    ).trim();
    if (!a || has.has(a)) continue;
    has.add(a);
    seen.push(a);
  }
  return seen;
}

export function buildBlockPasteContext(coaRows, linesByAccount) {
  const axisByIndex = new Map();
  const closedMonths = new Set();
  const onStatement = new Set();
  const nameFor = new Map();

  for (const r of coaRows || []) {
    if (!r) continue;
    if (r.month_index != null && r.month_end) {
      axisByIndex.set(Number(r.month_index), {
        month_index: Number(r.month_index),
        month_end: r.month_end,
      });
      if (r.is_actual) {
        const k = itemizedMonthKey(r.month_end);
        if (k) closedMonths.add(k);
      }
    }
    const acct = String(
      r.account_number == null ? "" : r.account_number,
    ).trim();
    if (acct) {
      onStatement.add(acct);
      if (!nameFor.has(acct) && r.account_name)
        nameFor.set(acct, String(r.account_name));
    }
  }

  const axis = [...axisByIndex.values()].sort(
    (a, b) => a.month_index - b.month_index,
  );
  const source =
    linesByAccount instanceof Map
      ? linesByAccount
      : new Map(Object.entries(linesByAccount || {}));
  const accounts = new Map();
  const keys = new Set([...source.keys()].map((k) => String(k).trim()));
  for (const k of keys) {
    accounts.set(k, {
      lines: source.get(k) || source.get(Number(k)) || [],
      closedMonths,
      onStatement: onStatement.has(k),
      accountName: nameFor.get(k) || null,
    });
  }
  return { axis, accounts, closedMonths, onStatement };
}

export function describeBlockPastePlan(plan) {
  if (!plan || plan.empty) {
    return {
      ready: false,
      message:
        "Copy a block of lines out of the workbook\u2019s *_Itemized table — 13 columns across, " +
        "starting at Line Description — and paste it here to see what it would create.",
    };
  }
  if (plan.error) return { ready: false, message: plan.error };
  if (plan.single) {
    return {
      ready: false,
      message:
        "That is one cell, not a workbook block. Copy the whole rectangle — 13 columns across, " +
        "one row per line — and paste it again.",
    };
  }
  const parts = [];
  parts.push(
    `${plan.creates.length} line${plan.creates.length === 1 ? "" : "s"} would be created`,
  );
  const accounts = plan.byAccount.filter((g) => g.creates > 0).length;
  if (accounts > 1) parts.push(`across ${accounts} accounts`);
  if (plan.duplicates.length) {
    parts.push(
      `${plan.duplicates.length} would sit beside a stored line stating the same account, source, description and month`,
    );
  }
  if (plan.refused.length)
    parts.push(`${plan.refused.length} refused and named below`);
  const ready = plan.creates.length > 0 && plan.refused.length === 0;
  let tail;
  if (plan.refused.length) {
    tail =
      "Nothing is created while a row is refused \u2014 fix the block in the workbook and paste it again.";
  } else if (plan.creates.length === 0) {
    tail = "There is nothing here to create.";
  } else {
    tail = "Nothing is written until you press Create.";
  }
  return { ready, message: `${parts.join(" \u00b7 ")}. ${tail}` };
}

export function blockInsertPayload(row) {
  const out = {};
  for (const f of ITEMIZED_PASTE_FIELD_ORDER) {
    const v = row ? row[f] : "";
    out[f] = v == null ? "" : v;
  }
  return out;
}

export function buildBlockInsertBatches(
  plan,
  { includeDuplicates = false } = {},
) {
  const byCategory = new Map();
  const unsendable = [];
  let skippedDuplicates = 0;
  let rowCount = 0;

  for (const e of (plan && plan.creates) || []) {
    if (e.duplicate && !includeDuplicates) {
      skippedDuplicates += 1;
      continue;
    }
    const category = e.category || "";
    if (!category) {
      unsendable.push(e.index + 1);
      continue;
    }
    if (!byCategory.has(category))
      byCategory.set(category, { category, rows: [], accounts: [] });
    const b = byCategory.get(category);
    b.rows.push(blockInsertPayload(e.row));
    if (e.account && !b.accounts.includes(e.account))
      b.accounts.push(e.account);
    rowCount += 1;
  }

  return {
    batches: [...byCategory.values()],
    rowCount,
    skippedDuplicates,
    unsendable,
  };
}

export function planFingerprint(plan) {
  if (!plan) return "none";
  if (plan.error) return `error:${plan.error}`;
  return (plan.entries || [])
    .map((e) =>
      [
        e.index,
        e.status,
        e.account || "",
        e.month || "",
        e.duplicate ? "dup" : "",
        e.category || "",
        String((e.row && e.row.amount) == null ? "" : e.row.amount),
        e.detail || "",
      ].join("|"),
    )
    .join("\n");
}

export function describeBlockWriteOutcome({
  requested = 0,
  inserted = 0,
  skippedDuplicates = 0,
  error = null,
  failedCategory = null,
} = {}) {
  if (error) {
    const stored =
      inserted > 0
        ? `${inserted} of ${requested} line${requested === 1 ? "" : "s"} were already stored before it failed` +
          `${failedCategory ? ` (it stopped inside ${failedCategory})` : ""}` +
          " — re-read the accounts below before pasting this block again, or it will be stored twice."
        : "Nothing was stored.";
    return { ok: false, partial: inserted > 0, message: `${error} ${stored}` };
  }
  if (requested === 0) {
    return {
      ok: false,
      partial: false,
      message: "There was nothing to create, so nothing was sent.",
    };
  }
  if (inserted !== requested) {
    return {
      ok: false,
      partial: true,
      message:
        `The create reported ${inserted} stored line${inserted === 1 ? "" : "s"} for ${requested} sent. ` +
        "Reload the statement and check the accounts below before pasting again.",
    };
  }
  const dup = skippedDuplicates
    ? ` ${skippedDuplicates} row${skippedDuplicates === 1 ? "" : "s"} beside an identical stored line ` +
      `${skippedDuplicates === 1 ? "was" : "were"} left out.`
    : "";
  return {
    ok: true,
    partial: false,
    message:
      `Created ${inserted} line${inserted === 1 ? "" : "s"}.${dup}` +
      " Each one is on the statement now, and can be undone from that line\u2019s History on its account card.",
  };
}
