import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  buildVersionEntries,
  describeRestoreOutcome,
} from "../../lib/itemizedLineHistory.js";
import {
  fetchItemizedLineHistory,
  restoreItemizedVersion,
} from "../../lib/supabaseClient.js";

export default function ItemizedLineHistoryModal({
  line,
  canWrite = false,
  C,
  onClose,
  onRestored,
}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [restoringId, setRestoringId] = useState("");
  const [outcome, setOutcome] = useState(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const lineId = line ? line.id : null;

  const load = useCallback(async () => {
    if (!lineId) return;
    setLoading(true);
    setLoadError("");
    const { data, error } = await fetchItemizedLineHistory(lineId);
    if (!mounted.current) return;
    if (error) {
      setLoadError(
        error.message || "The version history for this line could not be read.",
      );
      setEntries([]);
      setLoading(false);
      return;
    }
    setEntries(buildVersionEntries(data));
    setLoading(false);
  }, [lineId]);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (versionId) => {
    if (!versionId || restoringId) return;
    setRestoringId(versionId);
    setOutcome(null);
    const res = await restoreItemizedVersion(versionId);
    if (!mounted.current) return;
    const said = describeRestoreOutcome(res);
    setRestoringId("");
    setOutcome(said);
    await load();
    if (said.ok && onRestored) onRestored(res.data || null);
  };

  const kindColor = (kind) =>
    kind === "DELETE"
      ? "var(--ds-danger-text)"
      : kind === "INSERT"
        ? "var(--ds-success-text)"
        : C.accent;

  let body;
  if (loading) {
    body = (
      <div style={{ padding: 20, fontSize: 12.5, color: C.textSecondary }}>
        Reading this line’s version history…
      </div>
    );
  } else if (loadError) {
    body = (
      <div
        style={{ padding: 20, fontSize: 12.5, color: "var(--ds-danger-text)" }}
      >
        {loadError}
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <div style={{ padding: 20, fontSize: 12.5, color: C.textSecondary }}>
        No version has been recorded for this line yet. Every change made from
        here on is recorded.
      </div>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {entries.map((e) => (
          <div
            key={e.id}
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  color: kindColor(e.kind),
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {e.kind}
              </span>
              <span style={{ fontSize: 12, color: C.textPrimary }}>
                {e.changedAt
                  ? new Date(e.changedAt).toLocaleString()
                  : "no time recorded"}
              </span>
              <span style={{ fontSize: 11, color: C.textSecondary }}>
                {e.author}
              </span>
              <button
                type="button"
                disabled={!canWrite || !!restoringId}
                onClick={() => restore(e.id)}
                title={
                  canWrite
                    ? e.intent.explain
                    : "Your role cannot change budget lines."
                }
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: !canWrite || restoringId ? "not-allowed" : "pointer",
                  color: !canWrite || restoringId ? C.textSecondary : C.accent,
                }}
              >
                {restoringId === e.id ? "Restoring…" : e.intent.label}
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: C.textSecondary,
                marginTop: 3,
                lineHeight: 1.45,
              }}
            >
              {e.intent.explain}
            </div>
            {e.kind === "DELETE" ? (
              <div
                style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}
              >
                The line was deleted.
              </div>
            ) : e.diff.length === 0 ? (
              <div
                style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}
              >
                {e.isOldest
                  ? "The oldest recorded version — there is nothing before it to compare against."
                  : "No field change was recorded against the version before it."}
              </div>
            ) : (
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {e.diff.map((d) => (
                  <div
                    key={d.field}
                    style={{ fontSize: 12, color: C.textPrimary }}
                  >
                    <span style={{ fontWeight: 700 }}>{`${d.field}: `}</span>
                    <span
                      style={{ color: C.textSecondary }}
                    >{`${d.from || "(empty)"}  →  `}</span>
                    <span>{d.to || "(empty)"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        style={{
          background: C.cardBg,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          width: "min(640px, 96vw)",
          maxHeight: "82vh",
          overflowY: "auto",
          padding: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <div>
            <div
              style={{ fontSize: 15, fontWeight: 800, color: C.textPrimary }}
            >
              Version history
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
              {(line && line.line_description) || "(no description)"}
            </div>
            <div
              style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}
            >{`Line ${lineId || "—"}`}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: "inherit",
              color: C.textPrimary,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        {outcome && (
          <div
            style={{
              fontSize: 12,
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 6,
              lineHeight: 1.45,
              border: `1px solid ${outcome.ok ? C.border : "var(--ds-danger-text)"}`,
              color: outcome.ok ? C.textPrimary : "var(--ds-danger-text)",
            }}
          >
            {outcome.message}
          </div>
        )}
        {body}
      </div>
    </div>
  );
}
