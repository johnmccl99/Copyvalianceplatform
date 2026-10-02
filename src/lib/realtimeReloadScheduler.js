export function createReloadScheduler({
  onReload,
  quietMs = 1000,
  maxWaitMs = 10000,
  doc = typeof document !== "undefined" ? document : null,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (id) => clearTimeout(id),
} = {}) {
  if (typeof onReload !== "function") {
    throw new TypeError("createReloadScheduler requires an onReload function");
  }

  let disposed = false;
  let debounceTimer = null;
  let maxWaitTimer = null;
  let inFlight = false;
  let dirty = false;
  let pendingHidden = false;

  const clearTimers = () => {
    if (debounceTimer !== null) {
      clearTimeoutFn(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimeoutFn(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const run = async () => {
    if (disposed) return;
    if (inFlight) {
      dirty = true;
      return;
    }
    inFlight = true;
    try {
      await onReload();
    } catch (err) {
      console.error("[realtimeReloadScheduler] reload failed:", err);
    } finally {
      inFlight = false;
      if (!disposed && dirty) {
        dirty = false;
        schedule();
      }
    }
  };

  const fire = () => {
    if (maxWaitTimer !== null) {
      clearTimeoutFn(maxWaitTimer);
      maxWaitTimer = null;
    }
    debounceTimer = null;
    if (disposed) return;
    if (doc && doc.hidden) {
      pendingHidden = true;
      return;
    }
    run();
  };

  function schedule() {
    if (disposed) return;
    if (debounceTimer !== null) clearTimeoutFn(debounceTimer);
    debounceTimer = setTimeoutFn(fire, quietMs);
    if (maxWaitTimer === null) maxWaitTimer = setTimeoutFn(fire, maxWaitMs);
  }

  const onVisibilityChange = () => {
    if (disposed || !doc || doc.hidden || !pendingHidden) return;
    pendingHidden = false;
    run();
  };

  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", onVisibilityChange);
  }

  const dispose = () => {
    disposed = true;
    dirty = false;
    pendingHidden = false;
    clearTimers();
    if (doc && typeof doc.removeEventListener === "function") {
      doc.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };

  return { schedule, dispose };
}
