export const DEFAULT_IDLE_TIMEOUT_MIN = 60;
export const IDLE_WARNING_MS = 5 * 60 * 1000;
export const IDLE_CHECK_INTERVAL_MS = 30 * 1000;
export const LAST_ACTIVITY_STORAGE_KEY = "last_activity_at";
export const ACTIVITY_WRITE_THROTTLE_MS = 5000;

export function createIdleTracker({
  timeoutMs,
  warningMs = IDLE_WARNING_MS,
  storage = null,
  now = () => Date.now(),
} = {}) {
  let memoryActivity = Number(now());
  let lastWriteAt = -Infinity;

  const readStorage = () => {
    try {
      const value = Number(storage?.getItem(LAST_ACTIVITY_STORAGE_KEY));
      return Number.isFinite(value) ? value : null;
    } catch (_error) {
      return null;
    }
  };

  const lastActivityAt = () =>
    Math.max(memoryActivity, readStorage() ?? -Infinity);

  const touch = () => {
    const timestamp = Number(now());
    if (!Number.isFinite(timestamp)) return;
    memoryActivity = Math.max(memoryActivity, timestamp);
    if (timestamp - lastWriteAt < ACTIVITY_WRITE_THROTTLE_MS) return;
    try {
      storage?.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
      lastWriteAt = timestamp;
    } catch (_error) {
      lastWriteAt = timestamp;
    }
  };

  const check = () => {
    const idleMs = Math.max(Number(now()) - lastActivityAt(), 0);
    const remainingMs = Number(timeoutMs) - idleMs;
    if (idleMs >= timeoutMs) return { state: "expired", idleMs, remainingMs };
    if (timeoutMs > warningMs && timeoutMs - idleMs <= warningMs) {
      return { state: "warning", idleMs, remainingMs };
    }
    return { state: "active", idleMs, remainingMs };
  };

  const reset = () => {
    lastWriteAt = -Infinity;
    touch();
  };

  return { touch, check, lastActivityAt, reset };
}

export function resolveIdleTimeoutMin(policyMinutes) {
  const minutes = Number(policyMinutes);
  return Number.isFinite(minutes) && minutes >= 5 && minutes <= 1440
    ? minutes
    : DEFAULT_IDLE_TIMEOUT_MIN;
}
