export const CRON_SLOT_HOURS_UTC = Object.freeze([0, 6, 12, 18]);
export const CRON_SLOT_MINUTE_UTC = 15;

export const DAILY_GATE_HOURS = 23;

export const SCHEDULER_ELIGIBLE_STATUSES = Object.freeze([
  "connected",
  "error",
]);

export function isSchedulerEligibleStatus(connector) {
  return SCHEDULER_ELIGIBLE_STATUSES.includes(connector?.status);
}

export const CRON_INTERVAL_HOURS = 6;
export const OVERDUE_GRACE_HOURS = 1;

export const SCHEDULER_TRIGGER = "scheduler";
export const MANUAL_TRIGGERS = Object.freeze([
  "manual",
  "sync_bg",
  "drain_bg",
  "backfill",
  "webhook",
]);

export const FAILED_RUN_STATUS = "error";
export const DEGRADED_RUN_STATUS = "partial";

export function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function humanizeDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function agoPhrase(ms) {
  const d = humanizeDuration(ms);
  return d === "just now" ? "just now" : `${d} ago`;
}

export function nextCronSlotAfter(fromMs) {
  if (!Number.isFinite(fromMs)) return null;
  const d = new Date(fromMs);
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of CRON_SLOT_HOURS_UTC) {
      const slot = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + dayOffset,
        hour,
        CRON_SLOT_MINUTE_UTC,
        0,
        0,
      );
      if (slot >= fromMs) return slot;
    }
  }
  return null;
}

export function resolveCadence(connector) {
  const raw = connector?.config?.schedule;
  if (!raw) return "daily";
  if (raw === "manual") return "manual";
  if (raw === "daily") return "daily";
  return "every-tick";
}

export function cadenceLabel(
  cadence,
  { statusEligible = true, status = null } = {},
) {
  if (!statusEligible) {
    return `Off — the scheduler only runs connectors that are connected or in error, and this one is "${status || "unknown"}"`;
  }
  if (cadence === "manual")
    return "Off — this connector only syncs when someone runs it";
  if (cadence === "every-tick") return "About every 6 hours";
  return "About once a day";
}

export function cadenceDetail(
  cadence,
  { statusEligible = true, status = null } = {},
) {
  if (!statusEligible) {
    return `The scheduler only looks at connectors whose status is connected or error. This one is "${status || "unknown"}", so it will not be picked up until the connection is restored. Use Sync now to pull fresh data in the meantime.`;
  }
  if (cadence === "manual") {
    return "This connector is set to manual only, so the scheduler never runs it. Use Sync now to pull fresh data.";
  }
  if (cadence === "every-tick") {
    return "The scheduler checks four times a day (00:15, 06:15, 12:15 and 18:15 UTC) and starts a run at every check.";
  }
  return "The scheduler checks four times a day (00:15, 06:15, 12:15 and 18:15 UTC) and starts a run at the first check that falls at least 23 hours after the last sync of any kind. Running Sync now refreshes the data immediately but pushes the next automatic sync out by another 23 hours.";
}

export function readBackoff(connector, nowMs = Date.now()) {
  const inactive = { active: false, until: null, consecutiveErrorTicks: null };
  if (!connector || connector.status !== "error") return inactive;
  const until = toMs(connector?.config?.error_backoff_until);
  if (until == null || until <= nowMs) return inactive;
  const ticks = connector?.config?.consecutive_error_ticks;
  return {
    active: true,
    until: new Date(until).toISOString(),
    consecutiveErrorTicks:
      Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks) : null,
  };
}

function normalizeRun(run) {
  if (!run) return null;
  const at = toMs(run.startedAt ?? run.started_at);
  if (at == null) return null;
  return {
    at: new Date(at).toISOString(),
    atMs: at,
    status: run.status ?? null,
    resourceType: run.resourceType ?? run.resource_type ?? null,
  };
}

function newestRunMs(runs) {
  let best = null;
  for (const r of runs) {
    if (!r) continue;
    const at = toMs(r.startedAt ?? r.started_at);
    if (at == null) continue;
    if (best == null || at > best) best = at;
  }
  return best;
}

export function deriveErrorCause({
  connector = null,
  runs = [],
  nowMs = Date.now(),
} = {}) {
  const rows = Array.isArray(runs) ? runs.filter(Boolean) : [];
  const connectorMessage =
    connector?.lastErrorMessage ?? connector?.last_error_message ?? null;
  const connectorAtMs = toMs(connector?.lastSyncAt ?? connector?.last_sync_at);

  let freshest = null;
  for (const r of rows) {
    const message = r.errorMessage ?? r.error_message ?? null;
    const at = toMs(r.startedAt ?? r.started_at);
    if (!message || at == null) continue;
    if (!freshest || at > freshest.atMs) {
      freshest = {
        message,
        atMs: at,
        resourceType: r.resourceType ?? r.resource_type ?? null,
      };
    }
  }

  if (freshest && (connectorAtMs == null || freshest.atMs > connectorAtMs)) {
    return {
      message: freshest.message,
      source: "run",
      at: new Date(freshest.atMs).toISOString(),
      ageMs: nowMs - freshest.atMs,
      stale: false,
      resourceType: freshest.resourceType,
      supersedes: !!connectorMessage,
    };
  }

  if (!connectorMessage) return null;
  const newest = newestRunMs(rows);
  return {
    message: connectorMessage,
    source: "connector",
    at: connectorAtMs == null ? null : new Date(connectorAtMs).toISOString(),
    ageMs: connectorAtMs == null ? null : nowMs - connectorAtMs,
    stale: newest != null && connectorAtMs != null && newest > connectorAtMs,
    resourceType: null,
    supersedes: false,
  };
}

export function deriveSyncFreshness({
  connector = null,
  lastAutomaticRun = null,
  lastManualRun = null,
  runsAvailable = true,
  nowMs = Date.now(),
} = {}) {
  const rollupMs = toMs(connector?.lastSyncAt ?? connector?.last_sync_at);
  const rows = runsAvailable
    ? [lastAutomaticRun, lastManualRun].filter(Boolean)
    : [];
  const attemptMs = newestRunMs(rows);
  const automaticMs = toMs(
    lastAutomaticRun?.startedAt ?? lastAutomaticRun?.started_at,
  );
  const lastAttemptTrigger =
    attemptMs == null
      ? null
      : automaticMs != null && automaticMs >= attemptMs
        ? "automatic"
        : "manual";

  const rollupLagsAttempt =
    attemptMs != null && (rollupMs == null || attemptMs > rollupMs);

  return {
    lastRollupAt: rollupMs == null ? null : new Date(rollupMs).toISOString(),
    lastRollupStatus:
      connector?.lastSyncStatus ?? connector?.last_sync_status ?? null,
    lastAttemptAt: attemptMs == null ? null : new Date(attemptMs).toISOString(),
    lastAttemptTrigger,
    rollupLagsAttempt,
    rollupLagMs:
      rollupLagsAttempt && rollupMs != null ? attemptMs - rollupMs : null,
    errorCause: deriveErrorCause({ connector, runs: rows, nowMs }),
  };
}

export function deriveConnectorSchedule({
  connector = null,
  lastAutomaticRun = null,
  lastManualRun = null,
  runsAvailable = true,
  nowMs = Date.now(),
} = {}) {
  const cadence = resolveCadence(connector);
  const statusEligible = isSchedulerEligibleStatus(connector);
  const automaticEnabled = statusEligible && cadence !== "manual";
  const automaticDisabledReason = automaticEnabled
    ? null
    : !statusEligible
      ? "status-not-scheduled"
      : "cadence-manual";
  const backoff = readBackoff(connector, nowMs);
  const lastSyncMs = toMs(connector?.lastSyncAt ?? connector?.last_sync_at);

  const automatic = runsAvailable ? normalizeRun(lastAutomaticRun) : null;
  const manual = runsAvailable ? normalizeRun(lastManualRun) : null;

  const dailyGateOpensMs =
    cadence === "daily" && lastSyncMs != null
      ? lastSyncMs + DAILY_GATE_HOURS * 3_600_000
      : null;
  const backoffUntilMs = toMs(backoff.until);
  const backoffHolds =
    backoff.active && backoffUntilMs != null && backoffUntilMs > nowMs;
  const dailyGateHolds = dailyGateOpensMs != null && dailyGateOpensMs > nowMs;

  let nextAutomaticMs = null;
  let nextAutomaticBasis;
  const nextAutomaticGates = [];
  if (!automaticEnabled) {
    nextAutomaticBasis = "disabled";
  } else {
    if (backoffHolds) nextAutomaticGates.push("backoff");
    if (dailyGateHolds) nextAutomaticGates.push("daily-gate");
    if (!nextAutomaticGates.length) {
      nextAutomaticBasis =
        cadence === "daily" && lastSyncMs == null ? "never-synced" : "due-now";
    } else if (
      backoffHolds &&
      (!dailyGateHolds || backoffUntilMs >= dailyGateOpensMs)
    ) {
      nextAutomaticBasis = "backoff";
    } else {
      nextAutomaticBasis = "daily-gate";
    }
    nextAutomaticMs = nextCronSlotAfter(
      Math.max(
        nowMs,
        backoffHolds ? backoffUntilMs : -Infinity,
        dailyGateHolds ? dailyGateOpensMs : -Infinity,
      ),
    );
  }

  const manualHoldsGate = !!(
    automaticEnabled &&
    cadence === "daily" &&
    !backoff.active &&
    manual &&
    lastSyncMs != null &&
    manual.atMs >= (automatic?.atMs ?? -Infinity) &&
    lastSyncMs + DAILY_GATE_HOURS * 3_600_000 > nowMs
  );

  const overdueAfterHours =
    cadence === "every-tick"
      ? CRON_INTERVAL_HOURS + OVERDUE_GRACE_HOURS
      : DAILY_GATE_HOURS + CRON_INTERVAL_HOURS + OVERDUE_GRACE_HOURS;

  let level;
  let label;
  let hoursSinceAutomatic = null;
  if (!automaticEnabled) {
    level = "disabled";
    label =
      automaticDisabledReason === "status-not-scheduled"
        ? `Automatic sync off — the scheduler does not pick up connectors with status "${connector?.status || "unknown"}"`
        : "Automatic sync off";
  } else if (!runsAvailable) {
    level = "unknown";
    label = "Automatic sync history unavailable";
  } else if (backoff.active) {
    level = "paused";
    label = "Automatic syncs paused by retry backoff";
  } else if (!automatic) {
    level = "never";
    label = "No automatic sync has ever run";
  } else {
    hoursSinceAutomatic = (nowMs - automatic.atMs) / 3_600_000;
    const ago = agoPhrase(nowMs - automatic.atMs);
    const failed = automatic.status === FAILED_RUN_STATUS;
    const rolledUpStatus =
      connector?.lastSyncStatus ?? connector?.last_sync_status ?? null;
    const rollupAtMs = toMs(connector?.lastSyncAt ?? connector?.last_sync_at);
    const rollupCoversRun = rollupAtMs != null && rollupAtMs >= automatic.atMs;
    const degraded =
      automatic.status === DEGRADED_RUN_STATUS &&
      !(rollupCoversRun && rolledUpStatus === "success");
    if (hoursSinceAutomatic > overdueAfterHours) {
      level = "overdue";
      label = failed
        ? `Overdue — no automatic sync in ${humanizeDuration(nowMs - automatic.atMs)}, and that one failed`
        : `Overdue — no automatic sync in ${humanizeDuration(nowMs - automatic.atMs)}`;
    } else if (failed) {
      level = "failing";
      label = `Automatic syncs are running on time but failing — the last one, ${ago}, ended in error`;
    } else if (degraded) {
      level = "degraded";
      label = `Automatic syncs are running on time but only partly succeeding — the last one, ${ago}, was partial`;
    } else {
      level = "ok";
      label = "Automatic sync running on schedule";
    }
  }

  return {
    cadence,
    automaticEnabled,
    automaticDisabledReason,
    statusEligible,
    cadenceLabel: cadenceLabel(cadence, {
      statusEligible,
      status: connector?.status ?? null,
    }),
    cadenceDetail: cadenceDetail(cadence, {
      statusEligible,
      status: connector?.status ?? null,
    }),

    backoff,

    nextAutomaticAt:
      nextAutomaticMs == null ? null : new Date(nextAutomaticMs).toISOString(),
    nextAutomaticInMs: nextAutomaticMs == null ? null : nextAutomaticMs - nowMs,
    nextAutomaticBasis,
    nextAutomaticGates,
    dailyGateOpensAt:
      dailyGateOpensMs == null
        ? null
        : new Date(dailyGateOpensMs).toISOString(),

    runsAvailable,
    lastAutomaticAt: automatic?.at ?? null,
    lastAutomaticStatus: automatic?.status ?? null,
    lastManualAt: manual?.at ?? null,
    lastManualStatus: manual?.status ?? null,

    manualHoldsGate,
    staleness: { level, label, hoursSinceAutomatic, overdueAfterHours },

    freshness: deriveSyncFreshness({
      connector,
      lastAutomaticRun,
      lastManualRun,
      runsAvailable,
      nowMs,
    }),
  };
}

export default deriveConnectorSchedule;
