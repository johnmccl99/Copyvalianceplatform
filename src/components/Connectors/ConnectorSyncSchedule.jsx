import React from "react";
import { humanizeDuration } from "../../lib/connectors/syncSchedule.js";

function formatAbsolute(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    const local = d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const utc = d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    return `${local} (${utc} UTC)`;
  } catch {
    return iso;
  }
}

function formatRelative(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const delta = t - nowMs;
  if (delta >= 0) {
    const d = humanizeDuration(delta);
    return d === "just now" ? "any moment" : `in ${d}`;
  }
  const d = humanizeDuration(-delta);
  return d === "just now" ? "just now" : `${d} ago`;
}

const RUN_STATUS_COLORS = {
  success: "var(--ds-success-text)",
  partial: "var(--ds-warning-text)",
  error: "var(--ds-danger-text)",
  running: "var(--ds-text-secondary)",
};

const STALENESS_CHIP = {
  overdue: { text: "Overdue", color: "var(--ds-warning-text)" },
  failing: { text: "Failing", color: "var(--ds-danger-text)" },
  degraded: { text: "Partial", color: "var(--ds-warning-text)" },
  never: { text: "Never run", color: "var(--ds-warning-text)" },
  paused: { text: "Paused", color: "var(--ds-danger-text)" },
  unknown: { text: "Unknown", color: "var(--ds-text-secondary)" },
  disabled: { text: "Off", color: "var(--ds-text-secondary)" },
};

function Row({ label, children }) {
  return (
    <div
      style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 3 }}
    >
      <span style={{ flex: "0 0 96px", color: "var(--ds-text-secondary)" }}>
        {label}
      </span>
      <span style={{ flex: 1, color: "var(--ds-text-primary)", minWidth: 0 }}>
        {children}
      </span>
    </div>
  );
}

export default function ConnectorSyncSchedule({
  derived,
  loading = false,
  error = null,
  manualAvailable = true,
  nowMs = Date.now(),
}) {
  if (!derived) return null;

  const chip = STALENESS_CHIP[derived.staleness.level] || null;
  const nextRel = formatRelative(derived.nextAutomaticAt, nowMs);
  const nextAbs = formatAbsolute(derived.nextAutomaticAt);

  const historyNote = loading
    ? "Checking the sync history…"
    : error
      ? `Sync history unavailable (${error}). The cadence and next-run time below still come from the connector's own settings.`
      : null;

  const renderRun = (at, status, neverText) => {
    if (loading)
      return (
        <span style={{ color: "var(--ds-text-secondary)" }}>checking…</span>
      );
    if (!derived.runsAvailable)
      return (
        <span style={{ color: "var(--ds-text-secondary)" }}>unavailable</span>
      );
    if (!at)
      return (
        <span style={{ color: "var(--ds-text-secondary)" }}>{neverText}</span>
      );
    return (
      <>
        <strong>{formatRelative(at, nowMs)}</strong>
        <span style={{ color: "var(--ds-text-secondary)" }}>
          {" "}
          · {formatAbsolute(at)}
        </span>
        {status && (
          <span
            style={{
              color: RUN_STATUS_COLORS[status] || "var(--ds-text-secondary)",
              fontWeight: 600,
            }}
          >
            {" "}
            · {status}
          </span>
        )}
      </>
    );
  };

  return (
    <div
      style={{
        marginBottom: 12,
        padding: "8px 10px",
        borderRadius: 6,
        background: "var(--ds-inset)",
        border: "1px solid var(--ds-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--ds-text-secondary)",
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          Sync schedule
        </div>
        {chip && (
          <span
            role="status"
            title={derived.staleness.label}
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: chip.color,
              border: `1px solid ${chip.color}`,
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            {chip.text}
          </span>
        )}
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.5 }}>
        <Row label="Automatic">{derived.cadenceLabel}</Row>

        {derived.automaticEnabled && (
          <Row label="Next automatic">
            {nextRel ? (
              <>
                <strong>{nextRel}</strong>
                <span style={{ color: "var(--ds-text-secondary)" }}>
                  {" "}
                  · {nextAbs}
                </span>
              </>
            ) : (
              <span style={{ color: "var(--ds-text-secondary)" }}>unknown</span>
            )}
          </Row>
        )}

        <Row label="Last automatic">
          {renderRun(
            derived.lastAutomaticAt,
            derived.lastAutomaticStatus,
            "never — the scheduler has not run this connector",
          )}
        </Row>
        <Row label="Last manual">
          {renderRun(derived.lastManualAt, derived.lastManualStatus, "never")}
        </Row>
      </div>

      {historyNote && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: error ? "var(--ds-danger-text)" : "var(--ds-text-secondary)",
          }}
        >
          {historyNote}
        </div>
      )}

      {!loading && derived.staleness.level !== "ok" && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: "var(--ds-text-primary)",
          }}
        >
          {derived.staleness.label}
          {derived.backoff.active && derived.backoff.consecutiveErrorTicks
            ? ` (${derived.backoff.consecutiveErrorTicks} failed attempt${derived.backoff.consecutiveErrorTicks === 1 ? "" : "s"} in a row).`
            : "."}
        </div>
      )}

      {derived.backoff.active && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: "var(--ds-text-secondary)",
          }}
        >
          {`Automatic syncs are paused until ${formatAbsolute(derived.backoff.until)} by a retry backoff after repeated failures.`}
          {derived.nextAutomaticGates?.includes("daily-gate") &&
            derived.dailyGateOpensAt &&
            (derived.nextAutomaticBasis === "daily-gate"
              ? ` The 23-hour window since the last sync of any kind runs longer still, to ${formatAbsolute(derived.dailyGateOpensAt)} — that, not the backoff, is what sets the next attempt above.`
              : ` The 23-hour window since the last sync of any kind also has to clear, at ${formatAbsolute(derived.dailyGateOpensAt)}.`)}
        </div>
      )}

      {derived.manualHoldsGate && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: "var(--ds-text-secondary)",
          }}
        >
          The most recent sync was a manual one, and the 23-hour window is
          measured from it — so that click pushed the next automatic sync back.
        </div>
      )}

      <div
        style={{
          marginTop: 6,
          fontSize: 10.5,
          lineHeight: 1.5,
          color: "var(--ds-text-secondary)",
        }}
      >
        {derived.cadenceDetail}
        {manualAvailable && " Sync now, below, runs the connector immediately."}
      </div>
    </div>
  );
}
