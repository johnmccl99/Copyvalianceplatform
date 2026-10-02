import { applySecurity, jsonResponse } from "./_security.js";
import {
  resolveAdapter,
  syncOneResource,
  pg,
  claimConnectorLease,
  releaseConnectorLease,
} from "./_connector-adapters.js";
import { rollupConnectorSummary } from "./_connector-rollup.js";

const MANUAL_SYNC_WALL_CLOCK_MS =
  Number(process.env.MANUAL_SYNC_WALL_CLOCK_MS) > 0
    ? Number(process.env.MANUAL_SYNC_WALL_CLOCK_MS)
    : 26_000;

const TERMINAL_WRITE_RESERVE_MS = 6_000;
const SOFT_BUDGET_MS = Math.max(
  5_000,
  MANUAL_SYNC_WALL_CLOCK_MS - TERMINAL_WRITE_RESERVE_MS,
);

const MIN_RESOURCE_SLICE_MS = 6_000;

const LEASE_TTL_MS = MANUAL_SYNC_WALL_CLOCK_MS + 30_000;

export const handler = async (event) => {
  const startedAt = Date.now();

  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 30 },
  });
  if (gate.error) return gate.error;

  const body = gate.body || {};
  const connectorId = body.connectorId;
  const onlyResource = body.resourceType || null;
  const triggeredBy = ["manual", "scheduler", "webhook", "bootstrap"].includes(
    body.triggeredBy,
  )
    ? body.triggeredBy
    : "manual";

  if (!connectorId) return jsonResponse(400, { error: "connectorId required" });

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");

  const cGet = await pg({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connectorId)}&select=id,org_id,vendor,display_name,status,config`,
  });
  if (!cGet.ok || !Array.isArray(cGet.body) || !cGet.body.length) {
    return jsonResponse(404, {
      error: "Connector not found or not visible to caller",
    });
  }
  const connector = cGet.body[0];

  const adapter = resolveAdapter(connector.vendor);
  if (!adapter) {
    return jsonResponse(400, {
      error: `No adapter installed for vendor '${connector.vendor}'`,
    });
  }

  const resources = onlyResource
    ? adapter.resources.includes(onlyResource)
      ? [onlyResource]
      : []
    : adapter.resources.slice();
  if (!resources.length) {
    return jsonResponse(400, {
      error: "No matching resources for this sync request",
    });
  }

  const isFullSweep = !onlyResource;
  let lease = { acquired: true, heldUntil: null };
  if (isFullSweep) {
    lease = await claimConnectorLease({
      connector,
      bearer,
      ttlMs: LEASE_TTL_MS,
    });
    if (!lease.acquired) {
      return jsonResponse(200, {
        ok: true,
        connectorId: connector.id,
        skipped: true,
        reason: "sync_in_progress",
        heldUntil: lease.heldUntil,
      });
    }
  }

  const runs = [];
  const skippedResources = [];
  let budgetCut = false;
  for (const resourceType of resources) {
    if (startedAt + SOFT_BUDGET_MS - Date.now() < MIN_RESOURCE_SLICE_MS) {
      skippedResources.push(resourceType);
      budgetCut = true;
      continue;
    }

    const r = await syncOneResource({
      bearer,
      connector,
      adapter,
      resourceType,
      triggeredBy,
      functionDeadline: startedAt + SOFT_BUDGET_MS,
    });
    runs.push(r);

    if (r.budgetCut) budgetCut = true;
  }

  const rollupRuns = runs.concat(
    skippedResources.map((resourceType) => ({
      resourceType,
      runId: null,
      rowsRead: 0,
      rowsWritten: 0,
      status: "partial",
      errorMessage: null,
      budgetCut: true,
    })),
  );

  const summary = runs.length
    ? await rollupConnectorSummary({
        bearer,
        connectorId: connector.id,
        runs: rollupRuns,
        connector,
      })
    : { summaryStatus: "skipped", totalRows: 0, lastError: null };

  if (isFullSweep) {
    await releaseConnectorLease({
      connector,
      bearer,
      heldUntil: lease.heldUntil,
    });
  }

  if (budgetCut) {
    console.warn(
      "[connector-sync] manual sync cut by the function budget",
      JSON.stringify({
        connector_id: connector.id,
        vendor: connector.vendor,
        elapsed_ms: Date.now() - startedAt,
        soft_budget_ms: SOFT_BUDGET_MS,
        resources_run: runs.length,
        resources_skipped: skippedResources.length,
      }),
    );
  }

  return jsonResponse(200, {
    connectorId: connector.id,
    vendor: connector.vendor,
    runs,
    summary: {
      status: summary.summaryStatus,
      totalRowsRead: summary.totalRows,
      budgetCut,
      skippedResources,
    },
  });
};
