import {
  ADAPTERS,
  resolveAdapter,
  syncOneResource,
  pg,
  claimConnectorLease,
  releaseConnectorLease,
  persistConnectorConfig,
  SCHEDULED_FUNCTION_WALL_CLOCK_MS,
} from "./_connector-adapters.js";
import {
  rollupConnectorSummary,
  carryResourceErrors,
} from "./_connector-rollup.js";
import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const TERMINAL_WRITE_RESERVE_MS = 12_000;
const SOFT_BUDGET_MS = Math.max(
  5_000,
  SCHEDULED_FUNCTION_WALL_CLOCK_MS - TERMINAL_WRITE_RESERVE_MS,
);

const MIN_RESOURCE_SLICE_MS = 6_000;

const LEASE_TTL_MS = SCHEDULED_FUNCTION_WALL_CLOCK_MS + 30_000;

const RESOURCE_CURSOR_KEY = "scheduler_resource_cursor";

const ROTATION_PENDING_KEY = "scheduler_rotation_pending";

export function resolveCursorStartIndex(resources, cursorResource) {
  if (!Array.isArray(resources) || resources.length === 0) return 0;
  if (!cursorResource) return 0;
  const idx = resources.indexOf(cursorResource);
  return idx >= 0 ? idx : 0;
}

export function rotateResources(resources, startIndex) {
  if (!Array.isArray(resources) || resources.length === 0) return [];
  const n = resources.length;
  const start = Number.isInteger(startIndex) ? ((startIndex % n) + n) % n : 0;
  const ordered = [];
  for (let step = 0; step < n; step += 1) {
    ordered.push(resources[(start + step) % n]);
  }
  return ordered;
}

export function nextResourceCursor(resources, lastProcessedResource) {
  if (!Array.isArray(resources) || resources.length === 0) return null;
  if (!lastProcessedResource) return null;
  const idx = resources.indexOf(lastProcessedResource);
  if (idx < 0) return null;
  return resources[(idx + 1) % resources.length];
}

const BACKOFF_BASE_MS = 6 * 3_600_000;
const BACKOFF_MAX_MS = 48 * 3_600_000;

export function backoffWindowMs(consecutiveErrorTicks) {
  const n =
    Number.isFinite(consecutiveErrorTicks) && consecutiveErrorTicks > 0
      ? Math.floor(consecutiveErrorTicks)
      : 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** n, BACKOFF_MAX_MS);
}

export function isRotationPending(connector) {
  return connector?.config?.[ROTATION_PENDING_KEY] === true;
}

export function isConnectorInBackoff(connector, nowMs = Date.now()) {
  if (!connector || connector.status !== "error") return false;
  const until = connector?.config?.error_backoff_until;
  if (!until) return false;
  const t = new Date(until).getTime();
  return Number.isFinite(t) && t > nowMs;
}

export function applyBackoffToConfig(
  config,
  summaryStatus,
  nowMs = Date.now(),
) {
  const base =
    config && typeof config === "object" && !Array.isArray(config)
      ? config
      : {};
  if (summaryStatus === "error") {
    const prior =
      Number.isFinite(base.consecutive_error_ticks) &&
      base.consecutive_error_ticks > 0
        ? Math.floor(base.consecutive_error_ticks)
        : 0;
    const until = new Date(nowMs + backoffWindowMs(prior)).toISOString();
    return {
      config: {
        ...base,
        error_backoff_until: until,
        consecutive_error_ticks: prior + 1,
      },
      changed: true,
    };
  }
  if (
    base.error_backoff_until === undefined &&
    base.consecutive_error_ticks === undefined
  ) {
    return { config: base, changed: false };
  }
  const next = { ...base };
  delete next.error_backoff_until;
  delete next.consecutive_error_ticks;
  return { config: next, changed: true };
}

export async function persistConnectorBackoff({
  connector,
  summaryStatus,
  bearer,
  nowMs = Date.now(),
  pgFn = pg,
}) {
  const freshRes = await pgFn({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connector.id)}&select=config`,
  });
  if (!freshRes?.ok || !Array.isArray(freshRes.body) || !freshRes.body.length) {
    console.warn(
      "[connector-sync-scheduled] backoff write skipped — live config re-read failed",
      JSON.stringify({
        connector_id: connector?.id,
        status: freshRes?.status ?? null,
      }),
    );
    return { changed: false, skipped: "read_failed" };
  }
  const liveConfig = freshRes.body[0]?.config || {};
  const { config, changed } = applyBackoffToConfig(
    liveConfig,
    summaryStatus,
    nowMs,
  );
  if (!changed) return { changed: false };
  const ok = await persistConnectorConfig({ connector, config, bearer, pgFn });
  return { changed: true, ok };
}

export async function persistResourceCursor({
  connector,
  nextCursor,
  bearer,
  pgClient = pg,
  rotationPending = null,
}) {
  const mergedConfig = {
    ...(connector?.config || {}),
    [RESOURCE_CURSOR_KEY]: nextCursor,
  };
  if (rotationPending === true) mergedConfig[ROTATION_PENDING_KEY] = true;
  else if (rotationPending === false) delete mergedConfig[ROTATION_PENDING_KEY];
  const res = await pgClient({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connector.id)}`,
    method: "PATCH",
    body: { config: mergedConfig },
    prefer: "return=representation",
  });
  if (!res || !res.ok) {
    console.error(
      "[connector-sync-scheduled] cursor persist PATCH failed",
      JSON.stringify({
        vendor: connector?.vendor,
        connector_id: connector?.id,
        next_cursor: nextCursor,
        status: res?.status,
        raw: typeof res?.raw === "string" ? res.raw.slice(0, 500) : null,
      }),
    );
    return {
      ok: false,
      verified: false,
      status: res?.status ?? null,
      persisted: null,
    };
  }

  const updatedRow = Array.isArray(res.body) ? res.body[0] : res.body;
  const persistedCursor = updatedRow?.config?.[RESOURCE_CURSOR_KEY] ?? null;
  const verified = persistedCursor === nextCursor;

  if (!verified) {
    console.error(
      "[connector-sync-scheduled] cursor persist verify mismatch",
      JSON.stringify({
        vendor: connector?.vendor,
        connector_id: connector?.id,
        expected_cursor: nextCursor,
        persisted_cursor: persistedCursor,
        persisted_config: updatedRow?.config ?? null,
        status: res.status,
      }),
    );
  } else {
    console.log(
      "[connector-sync-scheduled] cursor persisted",
      JSON.stringify({
        vendor: connector?.vendor,
        next_cursor: nextCursor,
        status: res.status,
      }),
    );
  }

  return { ok: true, verified, status: res.status, persisted: persistedCursor };
}

export const handler = async (event) => {
  const manualSecret = process.env.SCHEDULED_RUN_SECRET || "";
  const provided = event?.headers?.["x-scheduled-secret"] || "";
  const isScheduled = isNetlifyScheduledEvent(event);
  const isAuthorizedManual = manualSecret && provided === manualSecret;
  if (!isScheduled && !isAuthorizedManual) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Scheduled invocation only" }),
    };
  }

  if (!SERVICE_ROLE_KEY) {
    console.error(
      "[connector-sync-scheduled] SUPABASE_SERVICE_ROLE_KEY missing",
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Service key not configured" }),
    };
  }
  const startedAt = Date.now();
  const installedVendors = Object.keys(ADAPTERS);

  const vendorFilter = `vendor=in.(${installedVendors.map((v) => `"${v}"`).join(",")})`;
  const listRes = await pg({
    bearer: SERVICE_ROLE_KEY,
    path: `/connectors?status=in.(connected,error)&${vendorFilter}&select=id,org_id,vendor,display_name,status,config`,
  });
  if (!listRes.ok || !Array.isArray(listRes.body)) {
    console.error(
      "[connector-sync-scheduled] enumerate failed:",
      listRes.status,
      listRes.raw,
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Enumerate failed" }),
    };
  }

  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    connectorsExamined: listRes.body.length,
    connectorsSynced: 0,
    connectorsSkipped: 0,
    connectorsBackedOff: 0,
    totalRuns: 0,
    totalRowsRead: 0,
    cursorAdvances: 0,
    cursorVerifyMismatches: 0,
    cursorPatchFailures: 0,
    cursorRollbacks: 0,
  };

  for (const connector of listRes.body) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) {
      summary.connectorsSkipped += 1;
      continue;
    }

    const adapter = resolveAdapter(connector.vendor);
    if (!adapter) {
      summary.connectorsSkipped += 1;
      continue;
    }

    if (isConnectorInBackoff(connector, startedAt)) {
      summary.connectorsSkipped += 1;
      summary.connectorsBackedOff += 1;
      continue;
    }

    const cadence = connector?.config?.schedule || "daily";
    if (cadence === "manual") {
      summary.connectorsSkipped += 1;
      continue;
    }
    if (cadence === "daily" && !isRotationPending(connector)) {
      const freshRes = await pg({
        bearer: SERVICE_ROLE_KEY,
        path: `/connectors?id=eq.${encodeURIComponent(connector.id)}&select=last_sync_at`,
      });
      const last = freshRes?.body?.[0]?.last_sync_at;
      if (last) {
        const hoursSince = (Date.now() - new Date(last).getTime()) / 3_600_000;
        if (hoursSince < 23) {
          summary.connectorsSkipped += 1;
          continue;
        }
      }
    }

    const lease = await claimConnectorLease({
      connector,
      bearer: SERVICE_ROLE_KEY,
      ttlMs: LEASE_TTL_MS,
    });
    if (!lease.acquired) {
      summary.connectorsSkipped += 1;
      continue;
    }

    const cursorResource = connector?.config?.[RESOURCE_CURSOR_KEY] || null;
    const startIndex = resolveCursorStartIndex(
      adapter.resources,
      cursorResource,
    );
    const orderedResources = rotateResources(adapter.resources, startIndex);

    const runs = [];
    let lastProcessedResource = null;
    let rollbackCursor = null;
    let rotationComplete = true;
    let resourcesAttempted = 0;
    for (const resourceType of orderedResources) {
      if (startedAt + SOFT_BUDGET_MS - Date.now() < MIN_RESOURCE_SLICE_MS) {
        rotationComplete = false;
        break;
      }

      const preemptiveCursor = nextResourceCursor(
        adapter.resources,
        resourceType,
      );
      if (preemptiveCursor && preemptiveCursor !== cursorResource) {
        const preemptiveResult = await persistResourceCursor({
          connector,
          nextCursor: preemptiveCursor,
          bearer: SERVICE_ROLE_KEY,
          rotationPending: true,
        });
        if (preemptiveResult.ok && preemptiveResult.verified) {
          summary.cursorAdvances += 1;
        } else if (preemptiveResult.ok && !preemptiveResult.verified) {
          summary.cursorVerifyMismatches += 1;
        } else {
          summary.cursorPatchFailures += 1;
        }
      }

      const r = await syncOneResource({
        bearer: SERVICE_ROLE_KEY,
        connector,
        adapter,
        resourceType,
        triggeredBy: "scheduler",
        functionDeadline: startedAt + SOFT_BUDGET_MS,
      });
      runs.push(r);
      lastProcessedResource = resourceType;
      resourcesAttempted += 1;
      summary.totalRuns += 1;
      summary.totalRowsRead += r.rowsRead || 0;

      if (r.budgetCut && (r.rowsRead || 0) === 0 && resourcesAttempted > 1) {
        rollbackCursor = resourceType;
        summary.cursorRollbacks += 1;
      }
      if (r.budgetCut) {
        rotationComplete = false;
        break;
      }
    }

    const nextCursor =
      rollbackCursor ||
      nextResourceCursor(adapter.resources, lastProcessedResource);
    const rotationPending = runs.length ? !rotationComplete : null;
    if (
      nextCursor &&
      (nextCursor !== cursorResource || rotationPending !== null)
    ) {
      const cursorResult = await persistResourceCursor({
        connector,
        nextCursor,
        bearer: SERVICE_ROLE_KEY,
        rotationPending,
      });
      if (cursorResult.ok && cursorResult.verified) {
        summary.cursorAdvances += 1;
      } else if (cursorResult.ok && !cursorResult.verified) {
        summary.cursorVerifyMismatches += 1;
      } else {
        summary.cursorPatchFailures += 1;
      }
    }

    let summaryStatus = null;
    if (runs.length) {
      const carried = await carryResourceErrors({
        bearer: SERVICE_ROLE_KEY,
        connector,
        runs,
      });
      const rollup = await rollupConnectorSummary({
        bearer: SERVICE_ROLE_KEY,
        connectorId: connector.id,
        runs: [...runs, ...carried],
        connector,
      });
      summaryStatus = rollup?.summaryStatus ?? null;
      summary.connectorsSynced += 1;
    } else {
      summary.connectorsSkipped += 1;
    }

    await releaseConnectorLease({
      connector,
      bearer: SERVICE_ROLE_KEY,
      heldUntil: lease.heldUntil,
    });

    if (summaryStatus) {
      await persistConnectorBackoff({
        connector,
        summaryStatus,
        bearer: SERVICE_ROLE_KEY,
      });
    }
  }

  summary.elapsedMs = Date.now() - startedAt;
  console.log("[connector-sync-scheduled] done", JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
