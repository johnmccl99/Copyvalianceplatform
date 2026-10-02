import {
  BULK_FIELDS,
  BULK_OPS,
  computeBulkPreview,
  displayFieldValue,
} from "./budgetItemizedBulk.js";
import { itemizedMonthKey } from "./budgetAccountCard.js";
import { buildBlockPasteContext } from "./budgetBlockPaste.js";

export const CROSS_ACCOUNT_FIELDS = Object.freeze(
  ["amount", "growth", "frequency"]
    .filter((f) => BULK_FIELDS[f])
    .map((field) => ({ field, ...BULK_FIELDS[field] })),
);

export const CROSS_ACCOUNT_FIELD_SET = new Set(
  CROSS_ACCOUNT_FIELDS.map((f) => f.field),
);

export const CROSS_ACCOUNT_HELD_TEXT = Object.freeze({
  closed: "closed month — realized in the GL",
  "no-month": "no readable month on the stored line",
  "outside-window": "outside the months selected",
  unsaved: "the stored line carries no id",
});

export const MAX_LINES_PER_APPLY = 1000;

export function statementAccountList(coaRows) {
  const seen = new Map();
  for (const r of coaRows || []) {
    const account = String(
      (r && r.account_number) == null ? "" : r.account_number,
    ).trim();
    if (!account || seen.has(account)) continue;
    seen.set(account, {
      account,
      name: r && r.account_name ? String(r.account_name) : "",
    });
  }
  return [...seen.values()];
}

export function buildCrossAccountContext(coaRows) {
  const { axis, closedMonths } = buildBlockPasteContext(coaRows, new Map());
  const accounts = statementAccountList(coaRows);
  return {
    axis,
    closedMonths,
    accounts,
    closedByAccount: new Map(accounts.map((a) => [a.account, closedMonths])),
  };
}

export function buildCrossAccountScope({
  accounts,
  linesByAccount,
  closedByAccount,
  from = null,
  to = null,
} = {}) {
  const lo = itemizedMonthKey(from);
  const hi = itemizedMonthKey(to);
  const perAccount = [];
  const editable = [];
  let heldCount = 0;

  for (const account of accounts || []) {
    const lines = (linesByAccount && linesByAccount.get(account)) || [];
    const closed =
      (closedByAccount && closedByAccount.get(account)) || new Set();
    const held = [];
    const mine = [];

    for (const line of lines) {
      const key = itemizedMonthKey(line && line.first_month);
      if (!line || !line.id) {
        held.push({ line, reason: "unsaved" });
        continue;
      }
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
      const withAccount = {
        ...line,
        _account: account,
        _key: `${account}:${line.id}`,
      };
      mine.push(withAccount);
      editable.push(withAccount);
    }

    heldCount += held.length;
    perAccount.push({
      account,
      total: lines.length,
      editable: mine,
      held,
      reasons: [...new Set(held.map((h) => h.reason))],
    });
  }

  return {
    perAccount,
    editable,
    heldCount,
    accountCount: (accounts || []).length,
  };
}

export function planCrossAccountBulk({
  scope,
  field,
  op,
  value,
  coaAccounts,
} = {}) {
  const rows = (scope && scope.editable) || [];
  const spec = BULK_FIELDS[field];

  if (!spec || !CROSS_ACCOUNT_FIELD_SET.has(field)) {
    return {
      error: `${field ? `"${field}"` : "That field"} cannot be changed across accounts from here.`,
    };
  }
  if (!spec.ops.includes(op)) {
    return {
      error: `${spec.label} does not support “${(BULK_OPS[op] && BULK_OPS[op].label) || op}”.`,
    };
  }

  const preview = computeBulkPreview({ rows, field, op, value, coaAccounts });
  const byAccount = new Map();
  for (const c of preview.changes) {
    const account = (c.row && c.row._account) || "";
    if (!byAccount.has(account)) {
      byAccount.set(account, {
        account,
        changed: 0,
        unchanged: 0,
        errored: 0,
        invalid: 0,
        changes: [],
      });
    }
    const g = byAccount.get(account);
    g.changes.push(c);
    if (c.state === "changed") g.changed += 1;
    else if (c.state === "unchanged") g.unchanged += 1;
    else if (c.state === "error") g.errored += 1;
    else if (c.state === "invalid") g.invalid += 1;
  }

  const mode = op === "set" ? "uniform" : "per-row";
  const changed = preview.changes.filter((c) => c.state === "changed");
  const overCap = changed.length > MAX_LINES_PER_APPLY;

  return {
    field,
    op,
    value,
    mode,
    preview,
    byAccount: [...byAccount.values()],
    changed,
    overCap,
    ok: preview.ok && !overCap,
  };
}

export function crossAccountWritePlan(plan) {
  if (!plan || !plan.ok)
    return { mode: "none", rowCount: 0, ids: [], changes: [], patch: null };
  const changed = plan.changed || [];
  if (plan.mode === "uniform") {
    return {
      mode: "uniform",
      rowCount: changed.length,
      ids: changed.map((c) => c.row.id),
      patch: { [plan.field]: changed.length ? changed[0].after : null },
      changes: [],
    };
  }
  return {
    mode: "per-row",
    rowCount: changed.length,
    ids: [],
    patch: null,
    changes: changed.map((c) => ({
      id: c.row.id,
      new_value: c.after,
      expected: c.before === "" || c.before == null ? null : Number(c.before),
    })),
  };
}

export function crossAccountFingerprint(plan) {
  if (!plan) return "none";
  if (plan.error) return `error:${plan.error}`;
  return [
    `${plan.field}|${plan.op}|${plan.value == null ? "" : String(plan.value)}|${plan.mode}`,
    ...((plan.preview && plan.preview.changes) || []).map((c) =>
      [
        (c.row && c.row._account) || "",
        (c.row && c.row.id) || "",
        c.state,
        c.before == null ? "" : String(c.before),
        c.after == null ? "" : String(c.after),
        c.message || "",
      ].join("|"),
    ),
  ].join("\n");
}

export function describeCrossAccountPlan(plan, scope) {
  if (!plan) return { ready: false, message: "" };
  if (plan.error) return { ready: false, message: plan.error };

  const p = plan.preview;
  if (!p || p.total === 0) {
    return {
      ready: false,
      message:
        scope && scope.heldCount
          ? `None of the ${scope.heldCount} stored line${scope.heldCount === 1 ? "" : "s"} on the selected accounts can be changed — see the reasons beside each account.`
          : "No stored line on the selected accounts is inside the months selected.",
    };
  }
  if (p.pending)
    return { ready: false, message: "Enter a value to see what would change." };

  const accountsTouched = (plan.byAccount || []).filter(
    (a) => a.changed > 0,
  ).length;
  const parts = [
    `${p.changed} of ${p.total} line${p.total === 1 ? "" : "s"} on ` +
      `${accountsTouched} account${accountsTouched === 1 ? "" : "s"} would change`,
  ];
  if (p.unchanged)
    parts.push(
      `${p.unchanged} already ${p.unchanged === 1 ? "has" : "have"} that value`,
    );
  if (p.errored) parts.push(`${p.errored} cannot be computed`);
  if (p.invalid) parts.push(`${p.invalid} would become invalid`);
  if (scope && scope.heldCount)
    parts.push(`${scope.heldCount} out of reach and named below`);

  let tail;
  if (plan.overCap) {
    tail = `That is past the ${MAX_LINES_PER_APPLY} lines one change may write at once — narrow the accounts or the months and try again.`;
  } else if (p.errored || p.invalid) {
    tail =
      "Nothing is written while a line cannot be computed or would become invalid — fix or deselect it first.";
  } else if (p.changed === 0) {
    tail = "There is nothing here to change.";
  } else if (plan.mode === "per-row") {
    tail =
      "Nothing is written until you press Apply. A change-by is written as one transaction: it lands whole or not at all.";
  } else {
    tail = "Nothing is written until you press Apply.";
  }
  return {
    ready: Boolean(plan.ok) && p.changed > 0,
    message: `${parts.join(" · ")}. ${tail}`,
  };
}

export function describeCrossAccountOutcome({
  mode = "uniform",
  requested = 0,
  updated = 0,
  unchanged = 0,
  skipped = 0,
  missing = 0,
  error = null,
} = {}) {
  if (error) {
    const after =
      mode === "per-row"
        ? "Nothing was written — a change-by is one transaction, so this can be run again as it stands."
        : "Some of the batch may already be written. Reload the statement before running it again; " +
          "an absolute set repeated is the same set, so finishing it is safe once you can see where it stopped.";
    return {
      ok: false,
      partial: mode !== "per-row",
      message: `${error} ${after}`,
    };
  }
  if (requested === 0)
    return {
      ok: false,
      partial: false,
      message: "Nothing was sent, so nothing changed.",
    };

  const bits = [
    `Applied to ${updated} of ${requested} line${requested === 1 ? "" : "s"}.`,
  ];
  if (unchanged > 0) bits.push(`${unchanged} already held that value.`);
  if (skipped > 0) {
    bits.push(
      `${skipped} ${skipped === 1 ? "was" : "were"} skipped because ${skipped === 1 ? "its" : "their"} ` +
        `stored value moved after the preview — re-run to include ${skipped === 1 ? "it" : "them"}.`,
    );
  }
  if (missing > 0) bits.push(`${missing} could not be found.`);
  if (
    updated < requested &&
    skipped === 0 &&
    missing === 0 &&
    unchanged === 0
  ) {
    bits.push(
      "That gap is unexplained — reload the statement and check these accounts before repeating the change.",
    );
  }
  return {
    ok: updated === requested,
    partial: updated > 0 && updated < requested,
    message: bits.join(" "),
  };
}

export const crossAccountCell = (v, field) => displayFieldValue(v, field);
