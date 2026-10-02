const ENTRY_ASSET_RE = /assets\/index-([A-Za-z0-9_-]+)\.js(?:[?#"'\s]|$)/i;
const CHUNK_FAILURE_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed|Loading CSS chunk/i;
const chunkFailureSubscribers = new Set();

export function reportChunkFailure() {
  for (const subscriber of chunkFailureSubscribers) subscriber();
}

function defaultDocument() {
  return typeof document !== "undefined" ? document : null;
}

function defaultWindow() {
  return typeof window !== "undefined" ? window : null;
}

export function parseAssetHash(html) {
  if (typeof html !== "string") return null;
  return html.match(ENTRY_ASSET_RE)?.[1] || null;
}

export function getRunningVersion(doc = defaultDocument()) {
  const script = doc?.querySelector?.('script[src*="/assets/index-"]');
  return parseAssetHash(script?.getAttribute?.("src") || script?.src || "");
}

export async function fetchServedVersion(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") return null;
  try {
    const response = await fetchImpl("/", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response?.ok) return null;
    return parseAssetHash(await response.text());
  } catch {
    return null;
  }
}

export function isChunkLoadFailure(input) {
  let message = input;
  if (typeof input !== "string") {
    message = input?.message;
  }
  return typeof message === "string" && CHUNK_FAILURE_RE.test(message);
}

function defaultAddFocusListener(onFocus) {
  const cleanups = [];
  const doc = defaultDocument();
  const win = defaultWindow();
  if (doc?.addEventListener) {
    const onVisibilityChange = () => {
      if (doc.visibilityState === "visible") onFocus();
    };
    doc.addEventListener("visibilitychange", onVisibilityChange);
    cleanups.push(() =>
      doc.removeEventListener("visibilitychange", onVisibilityChange),
    );
  }
  if (win?.addEventListener) {
    win.addEventListener("focus", onFocus);
    cleanups.push(() => win.removeEventListener("focus", onFocus));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

export function createVersionWatcher({
  runningVersion,
  fetchImpl = globalThis.fetch,
  onStale,
  intervalMs = 5 * 60 * 1000,
  minGapMs = 60 * 1000,
  now = () => Date.now(),
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  addFocusListener = defaultAddFocusListener,
} = {}) {
  let started = false;
  let timer = null;
  let removeFocusListener = null;
  let stopped = false;
  let lastCheckAt = null;
  let staleNotified = false;
  let requestGeneration = 0;

  const stop = () => {
    started = false;
    stopped = true;
    requestGeneration += 1;
    if (timer !== null && typeof clearIntervalImpl === "function") {
      clearIntervalImpl(timer);
      timer = null;
    }
    removeFocusListener?.();
    removeFocusListener = null;
  };

  const checkNow = async () => {
    if (runningVersion == null || stopped || staleNotified) return null;
    const checkedAt = now();
    if (lastCheckAt !== null && checkedAt - lastCheckAt < minGapMs) return null;
    lastCheckAt = checkedAt;
    const generation = requestGeneration;
    const wasStarted = started;
    const servedHash = await fetchServedVersion(fetchImpl);
    if (
      (wasStarted && !started) ||
      generation !== requestGeneration ||
      staleNotified
    )
      return null;
    if (servedHash && servedHash !== runningVersion) {
      staleNotified = true;
      stop();
      onStale?.(servedHash);
    }
    return servedHash;
  };

  const start = () => {
    if (runningVersion == null || started) return;
    stopped = false;
    started = true;
    requestGeneration += 1;
    if (typeof setIntervalImpl === "function") {
      timer = setIntervalImpl(checkNow, intervalMs);
    }
    removeFocusListener =
      addFocusListener?.(() => {
        void checkNow();
      }) || null;
  };

  return { start, stop, checkNow };
}

function isAssetResourceError(event) {
  const element = event?.target;
  if (!element) return false;
  const tagName = String(element.tagName || "").toUpperCase();
  if (tagName !== "SCRIPT" && tagName !== "LINK") return false;
  const url = element.src || element.href;
  return typeof url === "string" && url.includes("/assets/");
}

export function installChunkFailureListener({
  onBroken,
  target = defaultWindow(),
} = {}) {
  if (!target?.addEventListener) return () => {};
  let notified = false;
  const notify = async () => {
    if (notified) return;
    notified = true;
    try {
      const consumed = await onBroken?.();
      if (consumed === false) notified = false;
    } catch {
      notified = false;
    }
  };
  const onError = (event) => {
    if (isChunkLoadFailure(event) || isAssetResourceError(event)) notify();
  };
  const onUnhandledRejection = (event) => {
    if (isChunkLoadFailure(event?.reason)) notify();
  };
  target.addEventListener("error", onError, true);
  target.addEventListener("unhandledrejection", onUnhandledRejection);
  chunkFailureSubscribers.add(notify);
  return () => {
    target.removeEventListener("error", onError, true);
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
    chunkFailureSubscribers.delete(notify);
  };
}
