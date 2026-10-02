export const WRITEBACK_REASON_LABEL = {
  BUDGET_NONE: "No Working budget in Entrata for this fiscal year",
  BUDGET_AMBIGUOUS:
    "More than one Working budget — cannot choose a write target safely",
  BUDGET_READ_FAILED: "Could not read budgets from Entrata",
  BUDGET_NO_ID: "Working budget found but it has no usable id",
};

export function writebackReasonLabel(reasonCode) {
  if (!reasonCode) return null;
  return WRITEBACK_REASON_LABEL[reasonCode] || null;
}

export function writebackRunReason(run) {
  if (!run) return null;
  const payload = run.payload || {};

  const coded = writebackReasonLabel(payload.reason_code);
  if (coded) return coded;

  const note =
    typeof payload.completeness_note === "string" &&
    payload.completeness_note.trim()
      ? payload.completeness_note.trim()
      : null;
  if (note) return note;

  const read = Number(run.rows_read);
  const written = Number(run.rows_written);

  if (payload.mode === "dry_run") {
    return "Dry run — nothing was written, by design";
  }

  if (!Number.isFinite(read) || !Number.isFinite(written) || written >= read)
    return null;

  const dropped = countDroppedAccounts(payload);
  if (dropped > 0) {
    const shortfall = read - written;
    return (
      `${dropped} ${dropped === 1 ? "account has" : "accounts have"} no Entrata GL id, so ` +
      `${shortfall} of ${read} ${shortfall === 1 ? "row was" : "rows were"} dropped before the push`
    );
  }

  return `${read - written} of ${read} rows were not written; the run did not record a cause`;
}

function countDroppedAccounts(payload) {
  for (const key of [
    "accounts_dropped_unresolved",
    "accounts_missing_entrata_id",
  ]) {
    const v = payload[key];
    if (Array.isArray(v) && v.length > 0) return v.length;
  }
  return 0;
}
