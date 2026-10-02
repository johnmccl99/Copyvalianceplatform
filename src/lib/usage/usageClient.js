import { supabase } from "../supabaseClient.js";
import {
  ALLOWED_EVENT_TYPES,
  ALLOWED_ACTOR_ROLES,
  EVENT_TYPES,
  isLpSurfaceKey,
} from "./usageKeys.js";

const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const KEY_MAX_LEN = 64;

const FLUSH_INTERVAL_MS = 15000;
const MAX_QUEUE = 100;
const MAX_BATCH = 50;

let _queue = [];
let _actor = { userId: null, role: null, orgId: null };
let _sessionId = null;
let _flushTimer = null;
let _lpCaptureEnabled = false;

const APP_VERSION =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_APP_VERSION) ||
  null;

const SESSION_STORAGE_KEY = "usage_session_id";

function makeUuid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (_e) {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getSessionId() {
  if (_sessionId) return _sessionId;
  try {
    const existing =
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      _sessionId = existing;
      return _sessionId;
    }
  } catch (_e) {}
  _sessionId = makeUuid();
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SESSION_STORAGE_KEY, _sessionId);
    }
  } catch (_e) {}
  return _sessionId;
}

export function setUsageActorContext({
  userId = null,
  role = null,
  orgId = null,
} = {}) {
  _actor = {
    userId: typeof userId === "string" && userId ? userId : null,
    role: ALLOWED_ACTOR_ROLES.includes(role) ? role : null,
    orgId: typeof orgId === "string" && orgId ? orgId : null,
  };
}

export function setLpCaptureEnabled(enabled) {
  _lpCaptureEnabled = !!enabled;
}

export function sanitizeUsageEvent(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return null;

  const eventType = typeof raw.eventType === "string" ? raw.eventType : null;
  if (!ALLOWED_EVENT_TYPES.includes(eventType)) return null;

  const surfaceKey = coerceKey(raw.surfaceKey);
  if (!surfaceKey) return null;

  const actionKey = raw.actionKey == null ? null : coerceKey(raw.actionKey);
  if (raw.actionKey != null && actionKey == null) return null;

  const propertyId = coercePropertyId(raw.propertyId);

  const role = ALLOWED_ACTOR_ROLES.includes(ctx.role) ? ctx.role : null;
  const userId =
    typeof ctx.userId === "string" && ctx.userId ? ctx.userId : null;

  return {
    org_id: ctx.orgId || null,
    user_id: userId,
    actor_role: role,
    event_type: eventType,
    surface_key: surfaceKey,
    action_key: actionKey,
    property_id: propertyId,
    session_id: ctx.sessionId || null,
    app_version: ctx.appVersion || null,
    client_ts: ctx.clientTs || new Date().toISOString(),
  };
}

function coerceKey(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > KEY_MAX_LEN) return null;
  return KEY_PATTERN.test(s) ? s : null;
}

function coercePropertyId(v) {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export function logUsageEvent(evt) {
  try {
    if (evt && isLpSurfaceKey(evt.surfaceKey) && !_lpCaptureEnabled) {
      return;
    }
    const row = sanitizeUsageEvent(evt, {
      userId: _actor.userId,
      role: _actor.role,
      orgId: _actor.orgId,
      sessionId: getSessionId(),
      appVersion: APP_VERSION,
      clientTs: new Date().toISOString(),
    });
    if (!row) return;
    _queue.push(row);
    if (_queue.length >= MAX_QUEUE) {
      _queue = _queue.slice(-MAX_QUEUE);
    }
    if (_queue.length >= MAX_BATCH) {
      void flushUsageEvents();
    }
  } catch (_e) {}
}

export function logSurfaceView(surfaceKey, opts = {}) {
  logUsageEvent({
    eventType: EVENT_TYPES.SURFACE_VIEW,
    surfaceKey,
    actionKey: opts.actionKey || "view",
    propertyId: opts.propertyId,
  });
}

export function logAction(surfaceKey, actionKey, opts = {}) {
  logUsageEvent({
    eventType: opts.eventType || EVENT_TYPES.ACTION,
    surfaceKey,
    actionKey,
    propertyId: opts.propertyId,
  });
}

export async function flushUsageEvents() {
  if (_queue.length === 0) return { ok: true, flushed: 0 };
  if (!_actor.orgId) return { ok: true, flushed: 0, held: _queue.length };
  const batch = _queue.splice(0, MAX_BATCH).map((row) => ({
    ...row,
    org_id: _actor.orgId,
    user_id: _actor.userId,
    actor_role: _actor.role,
  }));
  try {
    const { error } = await supabase.from("usage_events").insert(batch);
    if (error) {
      console.error("[usage] flush failed:", error.message || error);
      return { error, flushed: 0 };
    }
    return { ok: true, flushed: batch.length };
  } catch (e) {
    console.error("[usage] flush unexpected error:", e);
    return { error: e, flushed: 0 };
  }
}

export function startUsageSession() {
  if (_flushTimer) return stopUsageSession;

  getSessionId();
  logUsageEvent({
    eventType: EVENT_TYPES.SESSION_START,
    surfaceKey: "session",
    actionKey: "start",
  });

  if (typeof setInterval !== "undefined") {
    _flushTimer = setInterval(() => {
      void flushUsageEvents();
    }, FLUSH_INTERVAL_MS);
  }

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("beforeunload", _beforeUnloadFlush);
    document.addEventListener("visibilitychange", _visibilityFlush);
  }

  return stopUsageSession;
}

function _beforeUnloadFlush() {
  void flushUsageEvents();
}

function _visibilityFlush() {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    void flushUsageEvents();
  }
}

export function stopUsageSession() {
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  if (typeof window !== "undefined" && window.removeEventListener) {
    window.removeEventListener("beforeunload", _beforeUnloadFlush);
    document.removeEventListener("visibilitychange", _visibilityFlush);
  }
  void flushUsageEvents();
}

export function __getQueueLength() {
  return _queue.length;
}
