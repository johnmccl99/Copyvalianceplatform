const STORAGE_KEY = "valiance.statementPerf";
const MAX_SAMPLES = 50;

function hasWindow() {
  return typeof window !== "undefined";
}

export function statementPerfEnabled() {
  if (!hasWindow()) return false;
  try {
    if (/[?&]perf=1(&|$)/.test(window.location?.search || "")) return true;
    return window.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function now() {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function mark(name) {
  try {
    performance.mark(name);
  } catch {}
}

function measure(name, startMark, endMark) {
  try {
    performance.measure(name, startMark, endMark);
  } catch {}
}

export function startStatementSample({
  surface,
  view,
  propertyCode,
  params,
} = {}) {
  const enabled = statementPerfEnabled();
  const id = `${surface || "statement"}:${view || "?"}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
  const sample = {
    surface: surface || "statement",
    view: view || null,
    propertyCode: propertyCode || null,
    params: params || null,
    rowCount: null,
    fetchMs: null,
    buildMs: null,
    paintMs: null,
    totalMs: null,
    startedAt: new Date().toISOString(),
  };
  let t0 = null;
  let t1 = null;
  let t2 = null;
  let done = false;

  const noop = () => {};
  if (!enabled) {
    return {
      enabled: false,
      begin: noop,
      fetched: noop,
      built: noop,
      painted: noop,
      abort: noop,
      sample,
    };
  }

  return {
    enabled: true,
    sample,
    begin() {
      t0 = now();
      mark(`${id}:fetch-start`);
    },
    fetched(rowCount) {
      if (t0 == null) return;
      t1 = now();
      sample.rowCount = typeof rowCount === "number" ? rowCount : null;
      sample.fetchMs = Math.round(t1 - t0);
      mark(`${id}:fetch-end`);
      measure("statement:fetch", `${id}:fetch-start`, `${id}:fetch-end`);
    },
    built() {
      if (t1 == null) return;
      t2 = now();
      sample.buildMs = Math.round(t2 - t1);
      mark(`${id}:build-end`);
      measure("statement:build", `${id}:fetch-end`, `${id}:build-end`);
    },
    painted() {
      if (done || t0 == null) return;
      done = true;
      const t3 = now();
      const from = t2 ?? t1 ?? t0;
      sample.paintMs = Math.round(t3 - from);
      sample.totalMs = Math.round(t3 - t0);
      mark(`${id}:paint-end`);
      measure(
        "statement:paint",
        t2 != null ? `${id}:build-end` : `${id}:fetch-end`,
        `${id}:paint-end`,
      );
      publish(sample);
    },
    abort() {
      done = true;
    },
  };
}

function publish(sample) {
  if (!hasWindow()) return;
  try {
    const list = Array.isArray(window.__statementPerf)
      ? window.__statementPerf
      : [];
    list.push(sample);
    while (list.length > MAX_SAMPLES) list.shift();
    window.__statementPerf = list;
  } catch {}
  try {
    console.info(
      `[statement-perf] ${sample.surface} ${sample.view} ${sample.propertyCode || ""}: ` +
        `fetch ${sample.fetchMs}ms · build ${sample.buildMs}ms · paint ${sample.paintMs}ms ` +
        `· total ${sample.totalMs}ms · ${sample.rowCount ?? "?"} rows`,
      sample,
    );
  } catch {}
}

export function formatStatementPerf(sample) {
  if (!sample || sample.totalMs == null) return null;
  return `perf: fetch ${sample.fetchMs} ms · build ${sample.buildMs} ms · paint ${sample.paintMs} ms · total ${sample.totalMs} ms · ${sample.rowCount ?? "?"} rows`;
}
