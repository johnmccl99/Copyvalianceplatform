export const ENTRATA_BUDGET_STATUS_TYPES = {
  2: {
    id: "2",
    name: "Alternate Quarterly Projections",
    role: "Working",
    writeTarget: true,
  },
  3: {
    id: "3",
    name: "Operating Budget",
    role: "Default / annual",
    writeTarget: false,
  },
  4: {
    id: "4",
    name: "Current Quarterly Projections",
    role: "Current",
    writeTarget: false,
  },
};

export const WRITEBACK_TARGET_STATUS_TYPE_ID = "2";

export function entrataBudgetStatusType(statusTypeId) {
  if (statusTypeId == null || statusTypeId === "") return null;
  const key = String(statusTypeId).trim();
  return ENTRATA_BUDGET_STATUS_TYPES[key] || null;
}

export function entrataBudgetStatusTypeClause(statusTypeId) {
  const t = entrataBudgetStatusType(statusTypeId);
  if (!t) return null;
  return `status type ${t.id} — ${t.role}`;
}

export const WRITEBACK_SINGLE_TARGET_NOTE =
  "One target per period, not a choice: this push only ever updates the Working " +
  `budget (status type ${WRITEBACK_TARGET_STATUS_TYPE_ID}), resolved live and by type id — never by name. ` +
  "The Operating and Current Quarterly budgets are not written by it.";

export const SUBSTRATE_DISCLOSURE = {
  analysis: {
    title: "Reading from",
    note:
      "These figures come from this property\u2019s v26 budget workbook (raw.itemized), " +
      "not from an Entrata budget. The workbook substrate carries no budget-status-type " +
      "and no fiscal-year dimension, so this surface is not reading any one of the three " +
      "Entrata budgets and there is nothing here to choose between. The Entrata write-back " +
      "targets a different object \u2014 the Working budget for the period you push, shown in " +
      "the Entrata send drawer on Budget & Forecast.",
  },
  editor: {
    title: "Editing",
    note:
      "These lines are this property\u2019s v26 budget workbook substrate (raw.itemized), " +
      "not an Entrata budget. It carries no budget-status-type and no fiscal-year dimension, " +
      "so an edit here is not an edit to one of the three Entrata budgets and there is nothing " +
      "here to choose between. Nothing reaches Entrata until someone opens the Entrata send " +
      "drawer on Budget & Forecast and pushes, which writes to the Working budget for the " +
      "period pushed.",
  },
  statement: {
    title: "Reading and editing",
    note:
      "These figures come from this property\u2019s v26 budget workbook (raw.itemized), " +
      "not from an Entrata budget, and the account cards on this page edit that same workbook " +
      "substrate. It carries no budget-status-type and no fiscal-year dimension, so this page is " +
      "neither reading nor writing any one of the three Entrata budgets and there is nothing here " +
      "to choose between. Nothing reaches Entrata until someone opens the Entrata send drawer on " +
      "this page and pushes, which targets a different object \u2014 the Working budget for the " +
      "period pushed.",
  },
};

export function summarizeSubstrateFiles(files) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  const contributing = list
    .filter((f) => Number(f.lineCount) > 0)
    .sort((a, b) => Number(b.lineCount) - Number(a.lineCount));
  const idle = list.filter((f) => !(Number(f.lineCount) > 0));
  const totalLines = contributing.reduce(
    (sum, f) => sum + Number(f.lineCount),
    0,
  );
  return {
    contributing,
    idle,
    totalLines,
    mixedSources: contributing.length > 1,
  };
}

export function formatSubstrateLineCount(n) {
  if (n == null || n === "" || typeof n === "boolean") return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v.toLocaleString("en-US")} line${v === 1 ? "" : "s"}`;
}

export function formatParseState({ lastParseStatus, lastParsedAt } = {}) {
  if (!lastParseStatus) return null;
  const when = lastParsedAt ? new Date(lastParsedAt) : null;
  const stamp =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
  const label =
    {
      success: "parsed",
      error: "last parse failed",
      running: "parse running",
      queued: "parse queued",
    }[String(lastParseStatus)] || String(lastParseStatus);
  return stamp ? `${label} ${stamp}` : label;
}

export function substrateFileLabel(file) {
  if (!file) return null;
  const name =
    typeof file.displayName === "string" ? file.displayName.trim() : "";
  if (name) return name;
  const path =
    typeof file.sourcePath === "string" ? file.sourcePath.trim() : "";
  if (path) {
    const seg = path.split("/").filter(Boolean).pop();
    if (seg) return seg;
  }
  return null;
}
