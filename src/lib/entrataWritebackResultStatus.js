function nodeSucceeded(node) {
  const s = node && (node.status ?? node.Status);
  return (
    String(s ?? "")
      .trim()
      .toLowerCase() === "success"
  );
}

export function describeBudgetResultNode(node) {
  if (!node) return "";
  const id = node.id ?? node.Id ?? null;
  const status = node.status ?? node.Status ?? "—";
  const message = node.message ?? node.Message ?? "";
  return `${id != null ? `#${id} ` : ""}${status}${message ? `: ${message}` : ""}`;
}

export function resolveWritebackRowStatus(row) {
  const reported =
    String((row && row.status) || "").toLowerCase() === "success"
      ? "success"
      : "error";
  if (!row) return { status: "error", innerFailure: false, detail: null };

  const nodes = Array.isArray(row.entrataBudgetResults)
    ? row.entrataBudgetResults
    : null;
  const posted =
    nodes !== null || row.entrataApplied != null || row.entrataStatus != null;
  if (!posted) return { status: reported, innerFailure: false, detail: null };

  const failedNodes = (nodes || []).filter((n) => !nodeSucceeded(n));
  if (failedNodes.length > 0) {
    return {
      status: "error",
      innerFailure: true,
      detail:
        `Entrata reported a per-budget failure inside an HTTP ${row.entrataStatus ?? "200"} response: ` +
        failedNodes.map(describeBudgetResultNode).join("; "),
    };
  }
  if (!nodes || nodes.length === 0) {
    return {
      status: "error",
      innerFailure: true,
      detail:
        `Entrata answered HTTP ${row.entrataStatus ?? "200"} with no per-budget status to confirm the write, ` +
        "so it is reported as not written. A 200 is not evidence a budget was updated.",
    };
  }
  if (row.entrataApplied === false) {
    return {
      status: "error",
      innerFailure: true,
      detail: `Entrata answered HTTP ${row.entrataStatus ?? "200"} but the write was not applied.`,
    };
  }
  return { status: reported, innerFailure: false, detail: null };
}

export function resolveWritebackOverall(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0)
    return { overall: "all_error", okCount: 0, innerFailureCount: 0 };
  const derived = list.map((r) => resolveWritebackRowStatus(r));
  const okCount = derived.filter((d) => d.status === "success").length;
  return {
    overall:
      okCount === list.length
        ? "all_success"
        : okCount === 0
          ? "all_error"
          : "partial",
    okCount,
    innerFailureCount: derived.filter((d) => d.innerFailure).length,
  };
}
