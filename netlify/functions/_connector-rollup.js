import { pg, ensureConnectorVendor } from "./_connector-adapters.js";

export const ROLLUP_OWNED_STATUSES = ["connected", "error"];

export function isDegradedPartial(run) {
  if (!run || run.status !== "partial") return false;
  if (run.errorMessage) return true;
  if (run.benignStop !== true && run.budgetCut !== true) return true;
  const movedNothing =
    (run.rowsRead || 0) === 0 && (run.rowsWritten || 0) === 0;
  return movedNothing && run.budgetCut !== true;
}

export function deriveRollup(runs) {
  const rows = Array.isArray(runs) ? runs.filter(Boolean) : [];

  const anyError = rows.some((r) => r.status === "error");
  const degradedPartials = rows.filter(isDegradedPartial).length;

  const totalRows = rows.reduce((s, r) => s + (r.rowsRead || 0), 0);

  let sweepError = null;
  for (const r of rows) {
    if (r.errorMessage) sweepError = r.errorMessage;
  }

  return {
    summaryStatus: anyError
      ? "error"
      : degradedPartials > 0
        ? "partial"
        : "success",
    newStatus: anyError ? "error" : "connected",
    totalRows,
    sweepError,
    anyError,
    degradedPartials,
  };
}

export const RESOURCE_ERRORS_KEY = "resource_errors";

export function mergeResourceErrors(
  config,
  runs,
  nowIso = new Date().toISOString(),
) {
  const prior =
    (config &&
      typeof config[RESOURCE_ERRORS_KEY] === "object" &&
      config[RESOURCE_ERRORS_KEY]) ||
    {};
  const next = { ...prior };
  let changed = false;
  for (const r of (Array.isArray(runs) ? runs : []).filter(Boolean)) {
    if (!r.resourceType || r.carried || r.budgetCut === true) continue;
    if (r.status === "error") {
      next[r.resourceType] = {
        message: String(r.errorMessage || "error").slice(0, 500),
        at: nowIso,
        ...(r.runId ? { run_id: r.runId } : {}),
      };
      changed = true;
    } else if (r.resourceType in next) {
      delete next[r.resourceType];
      changed = true;
    }
  }
  const attempted = new Set(
    (Array.isArray(runs) ? runs : [])
      .filter((r) => r && !r.carried && r.budgetCut !== true)
      .map((r) => r.resourceType),
  );
  const carried = Object.entries(next)
    .filter(([rt]) => !attempted.has(rt))
    .map(([rt, e]) => ({
      resourceType: rt,
      status: "error",
      errorMessage: `${rt}: still failing since ${e.at} — ${e.message}`,
      rowsRead: 0,
      rowsWritten: 0,
      carried: true,
    }));
  const nextConfig = { ...(config || {}) };
  if (Object.keys(next).length) nextConfig[RESOURCE_ERRORS_KEY] = next;
  else delete nextConfig[RESOURCE_ERRORS_KEY];
  return { config: nextConfig, changed, carried };
}

export async function carryResourceErrors({
  bearer,
  connector,
  runs,
  pgFn = pg,
}) {
  try {
    const fresh = await pgFn({
      bearer,
      path: `/connectors?id=eq.${encodeURIComponent(connector.id)}&select=config`,
    });
    if (!fresh?.ok || !Array.isArray(fresh.body) || !fresh.body.length) {
      console.warn(
        "[carryResourceErrors] live config re-read failed",
        connector?.id,
        fresh?.status ?? null,
      );
      return [];
    }
    const { config, changed, carried } = mergeResourceErrors(
      fresh.body[0]?.config || {},
      runs,
    );
    if (changed) {
      const res = await pgFn({
        bearer,
        path: `/connectors?id=eq.${encodeURIComponent(connector.id)}`,
        method: "PATCH",
        body: { config },
        prefer: "return=minimal",
      });
      if (!res?.ok)
        console.error(
          "[carryResourceErrors] ledger write failed",
          connector?.id,
          res?.status ?? null,
        );
      connector.config = config;
    }
    return carried;
  } catch (e) {
    console.warn("[carryResourceErrors] failed:", e?.message || e);
    return [];
  }
}

export async function rollupConnectorSummary({
  bearer,
  connectorId,
  runs,
  connector = null,
}) {
  const { summaryStatus, newStatus, totalRows, sweepError, anyError } =
    deriveRollup(runs);

  await pg({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connectorId)}`,
    method: "PATCH",
    body: {
      last_sync_at: new Date().toISOString(),
      last_sync_status: summaryStatus,
      last_sync_rows: totalRows,
      last_error_message: sweepError,
    },
  });

  const statusRes = await pg({
    bearer,
    path:
      `/connectors?id=eq.${encodeURIComponent(connectorId)}` +
      `&status=in.(${ROLLUP_OWNED_STATUSES.join(",")})`,
    method: "PATCH",
    body: { status: newStatus },
  });
  if (!statusRes?.ok) {
    console.error(
      "[rollupConnectorSummary] status write failed:",
      statusRes?.status,
      connectorId,
    );
  }

  if (connector && newStatus === "connected") {
    try {
      await ensureConnectorVendor({
        bearer,
        orgId: connector.org_id,
        vendorSlug: connector.vendor,
      });
    } catch (e) {
      console.warn(
        "[rollupConnectorSummary] ensureConnectorVendor failed:",
        e?.message || e,
      );
    }
  }

  return { summaryStatus, totalRows, lastError: sweepError, anyError };
}
