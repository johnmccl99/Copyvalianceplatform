import React, { useEffect, useRef, useState } from "react";
import {
  createVersionWatcher,
  fetchServedVersion,
  getRunningVersion,
  installChunkFailureListener,
} from "../../lib/appVersionSignal.js";
import { btn } from "../../lib/buttonStyles.js";

export default function AppVersionPrompt({
  C,
  initialState = null,
  fetchImpl,
  runningVersion,
  onReload = () => window.location.reload(),
  intervalMs,
  minGapMs,
  now,
  setIntervalImpl,
  clearIntervalImpl,
  addFocusListener,
}) {
  const [state, setState] = useState(initialState);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const version =
      runningVersion === undefined ? getRunningVersion() : runningVersion;
    let mounted = true;
    const watcher = createVersionWatcher({
      runningVersion: version,
      fetchImpl,
      intervalMs,
      minGapMs,
      now,
      setIntervalImpl,
      clearIntervalImpl,
      addFocusListener,
      onStale: () => {
        if (!dismissedRef.current) {
          setState((current) => (current === "broken" ? current : "update"));
        }
      },
    });
    watcher.start();
    const uninstallChunkListener = installChunkFailureListener({
      onBroken: async () => {
        const servedHash = await fetchServedVersion(fetchImpl);
        if (!mounted) return false;
        if (servedHash && version != null && servedHash === version)
          return false;
        setState("broken");
        return true;
      },
    });
    return () => {
      mounted = false;
      watcher.stop();
      uninstallChunkListener();
    };
  }, [
    addFocusListener,
    clearIntervalImpl,
    fetchImpl,
    intervalMs,
    minGapMs,
    now,
    runningVersion,
    setIntervalImpl,
  ]);

  if (state !== "update" && state !== "broken") return null;
  const broken = state === "broken";
  const heading = broken
    ? "This page is running an old version and stopped working."
    : "A new version is available.";
  const detail = broken
    ? "Reload to continue. Nothing you've entered is lost."
    : "Your work is saved. Reload when you're ready.";

  return (
    <div
      role={broken ? "alert" : "status"}
      aria-label={broken ? "Page stopped working" : "New version available"}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 99998,
        background: broken ? C.badgeAmberBg : C.badgeBlueBg,
        border: `1px solid ${broken ? C.amber : C.blue}`,
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        maxWidth: 380,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            color: broken ? C.badgeAmberText : C.badgeBlueTxt,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {heading}
        </div>
        <div style={{ color: C.textSecondary, fontSize: 12 }}>{detail}</div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={onReload}
          style={btn({ role: "primary", size: "sm" })}
        >
          Reload
        </button>
        {!broken && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              dismissedRef.current = true;
              setState(null);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: C.textSecondary,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "4px 6px",
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
