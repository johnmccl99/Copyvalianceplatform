import React, { useEffect, useRef, useState } from "react";
import {
  NOTE_TEXT_MAX,
  historyText,
  noteWasEdited,
  rangeLabel,
  stampLabel,
} from "../../lib/varianceNotes.js";
import TrackedChangeMark, {
  formatTrackedChangeTime,
} from "../shared/TrackedChangeMark.jsx";
import {
  attributionLine,
  noteAttribution,
} from "../../lib/varianceNoteAttribution.js";

const FAILURE_COPY = {
  denied: "You are not allowed to change this note, so nothing was saved.",
  empty: "A note cannot be blank. Delete it instead if it no longer applies.",
  too_long: `A note cannot be longer than ${NOTE_TEXT_MAX} characters.`,
  rejected_text: "The database rejected this text, so nothing was saved.",
  conflict: "This month already has commentary, so nothing was saved.",
  failed: "The change could not be saved. Nothing was recorded — try again.",
};

const failureCopy = (reason) => FAILURE_COPY[reason] || FAILURE_COPY.failed;

const KIND_LABEL = { INSERT: "Recorded", UPDATE: "Edited", DELETE: "Deleted" };

export default function VarianceNoteCard({
  note,
  priorVersions = [],
  current = true,
  authors = {},
  leading = false,
  onEdit = null,
  onDelete = null,
  onLoadHistory = null,
  theme = {},
}) {
  const text = theme.text || "inherit";
  const sub = theme.sub || "inherit";
  const border = theme.border || "currentColor";
  const card = theme.card || "transparent";
  const red = theme.red || "inherit";
  const leadingBg = theme.leadingBg || card;
  const leadingFg = theme.leadingFg || text;

  const [mode, setMode] = useState("view");
  const [draft, setDraft] = useState(note?.note_text ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState({
    loading: false,
    rows: [],
    error: null,
  });
  const [shownId, setShownId] = useState(null);

  const versions = [note, ...(priorVersions || [])].filter(Boolean);
  const shown = versions.find((v) => String(v.id) === String(shownId)) || note;
  const showingCurrent = String(shown?.id) === String(note?.id);
  const writable = showingCurrent && current;

  const latestNoteId = useRef(note?.id);
  latestNoteId.current = note?.id;

  useEffect(() => {
    setMode("view");
    setFailure(null);
    setDraft(note?.note_text ?? "");
    setHistoryOpen(false);
    setHistory({ loading: false, rows: [], error: null });
  }, [note?.id, writable]);

  const author = shown?.updated_by ? authors[String(shown.updated_by)] : null;
  const stamp = stampLabel(shown?.updated_at);
  const edited = noteWasEdited(shown);
  const attribution = noteAttribution(
    shown,
    authors,
    showingCurrent ? history.rows : null,
  );

  const trimmed = draft.trim();
  const stored = (note?.note_text ?? "").trim();
  const canSaveEdit =
    !busy &&
    trimmed.length > 0 &&
    trimmed.length <= NOTE_TEXT_MAX &&
    trimmed !== stored;

  const beginEdit = () => {
    setDraft(note?.note_text ?? "");
    setFailure(null);
    setMode("edit");
  };

  const cancel = () => {
    setDraft(note?.note_text ?? "");
    setFailure(null);
    setMode("view");
  };

  const saveEdit = async () => {
    if (!writable || !canSaveEdit || typeof onEdit !== "function") return;
    setBusy(true);
    setFailure(null);
    let result;
    try {
      result = await onEdit(note.id, trimmed);
    } catch {
      result = { ok: false, reason: "failed" };
    }
    setBusy(false);
    if (result?.ok) {
      setMode("view");
      if (historyOpen) loadHistory();
      return;
    }
    setFailure(result?.reason || "failed");
  };

  const confirmDelete = async () => {
    if (!writable || busy || typeof onDelete !== "function") return;
    setBusy(true);
    setFailure(null);
    let result;
    try {
      result = await onDelete(note.id);
    } catch {
      result = { ok: false, reason: "failed" };
    }
    setBusy(false);
    if (!result?.ok) setFailure(result?.reason || "failed");
  };

  const loadHistory = async () => {
    if (typeof onLoadHistory !== "function" || !note?.id) return;
    const requestedFor = String(note.id);
    setHistory((h) => ({ ...h, loading: true, error: null }));
    let res;
    try {
      res = await onLoadHistory(note.id);
    } catch (e) {
      res = { data: [], error: e };
    }
    if (String(latestNoteId.current) !== requestedFor) return;
    setHistory({
      loading: false,
      rows: Array.isArray(res?.data) ? res.data : [],
      error: res?.error || null,
    });
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) loadHistory();
  };

  const btn = {
    background: "transparent",
    border: `1px solid ${border}`,
    borderRadius: 3,
    color: sub,
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 8px",
  };

  const failureLine = failure ? (
    <div role="alert" style={{ fontSize: 11, color: red, marginTop: 6 }}>
      {failureCopy(failure)}
      {mode === "edit" ? (
        <div style={{ color: sub, marginTop: 4 }}>
          This note still reads:{" "}
          <span
            style={{
              color: text,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {note?.note_text}
          </span>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      {...(leading ? { "data-variance-note-leading": "" } : null)}
      title={
        attribution
          ? attributionLine(attribution, formatTrackedChangeTime)
          : undefined
      }
      style={{
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${leading ? leadingFg : border}`,
        borderRadius: 4,
        background: leading ? leadingBg : card,
        padding: "8px 10px",
        maxWidth: 720,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: sub }}>
          {rangeLabel(shown?.month_start, shown?.month_end)}
          {attribution ? (
            <TrackedChangeMark
              change={attribution}
              heading="Commentary"
              C={{
                textPrimary: text,
                textSecondary: sub,
                border,
                card,
                accent: leading ? leadingFg : sub,
              }}
            />
          ) : null}
        </span>
        {leading ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: leadingFg,
            }}
          >
            covers the month in view
          </span>
        ) : null}
        {versions.length > 1 ? (
          <select
            aria-label="Version"
            value={String(shown?.id)}
            onChange={(e) => {
              setShownId(e.target.value);
              setFailure(null);
              setMode("view");
            }}
            style={{
              fontSize: 11,
              color: text,
              background: "transparent",
              border: `1px solid ${border}`,
              borderRadius: 3,
              padding: "1px 4px",
            }}
          >
            {versions.map((v, i) => (
              <option key={v.id} value={String(v.id)}>
                {i === 0 && current
                  ? "Latest"
                  : `Version ${v.version ?? versions.length - i}`}
                {" · "}
                {rangeLabel(v.month_start, v.month_end)}
              </option>
            ))}
          </select>
        ) : null}
        {!current && showingCurrent ? (
          <span style={{ fontSize: 11, color: sub }}>
            Superseded — newer commentary is outside this window.
          </span>
        ) : null}
        {!showingCurrent ? (
          <span style={{ fontSize: 11, color: sub }}>
            Earlier version — read only.
          </span>
        ) : null}
      </div>

      {mode === "edit" ? (
        <div>
          <textarea
            aria-label="Edit this commentary"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={NOTE_TEXT_MAX}
            rows={4}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontSize: 13,
              fontFamily: "inherit",
              color: text,
              background: "transparent",
              border: `1px solid ${border}`,
              borderRadius: 3,
              padding: "6px 8px",
              resize: "vertical",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 6,
            }}
          >
            <button
              type="button"
              onClick={saveEdit}
              disabled={!canSaveEdit}
              style={btn}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={cancel} disabled={busy} style={btn}>
              Cancel
            </button>
            {trimmed === stored && trimmed.length > 0 ? (
              <span style={{ fontSize: 11, color: sub }}>No changes yet.</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          style={{
            fontSize: 13,
            color: text,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {shown?.note_text}
        </div>
      )}

      <div style={{ fontSize: 11, color: sub, marginTop: 6 }}>
        {edited ? "Edited" : "Recorded"}
        {author ? ` by ${author}` : ""}
        {stamp ? ` · ${stamp}` : ""}
      </div>

      {mode === "confirmDelete" ? (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 11, color: red }}>
            Delete this commentary? The deletion is recorded in the change
            history, but this release cannot restore the note.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy}
              style={{ ...btn, color: red, borderColor: red }}
            >
              {busy ? "Deleting…" : "Delete commentary"}
            </button>
            <button type="button" onClick={cancel} disabled={busy} style={btn}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      {mode === "view" &&
      showingCurrent &&
      ((writable && (onEdit || onDelete)) || onLoadHistory) ? (
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          {writable && onEdit ? (
            <button type="button" onClick={beginEdit} style={btn}>
              Edit
            </button>
          ) : null}
          {writable && onDelete ? (
            <button
              type="button"
              onClick={() => {
                setFailure(null);
                setMode("confirmDelete");
              }}
              style={btn}
            >
              Delete
            </button>
          ) : null}
          {onLoadHistory ? (
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={historyOpen}
              style={btn}
            >
              {historyOpen ? "Hide change history" : "Change history"}
            </button>
          ) : null}
        </div>
      ) : null}

      {failureLine}

      {historyOpen ? (
        <div
          style={{
            marginTop: 8,
            borderTop: `1px solid ${border}`,
            paddingTop: 6,
          }}
        >
          {history.loading ? (
            <div style={{ fontSize: 11, color: sub }}>
              Loading change history…
            </div>
          ) : history.error ? (
            <div role="alert" style={{ fontSize: 11, color: red }}>
              The change history could not be loaded, so this note may have been
              changed in ways not shown.
            </div>
          ) : history.rows.length === 0 ? (
            <div style={{ fontSize: 11, color: sub }}>
              No change history recorded for this note.
            </div>
          ) : (
            <ol
              style={{
                margin: 0,
                paddingLeft: 16,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {history.rows.map((v) => {
                const { before, after } = historyText(v);
                const who = v.changed_by ? authors[String(v.changed_by)] : null;
                return (
                  <li key={v.id} style={{ fontSize: 11, color: sub }}>
                    <span style={{ fontWeight: 700 }}>
                      {KIND_LABEL[v.change_kind] || v.change_kind}
                    </span>
                    {who ? ` by ${who}` : ""}
                    {stampLabel(v.changed_at)
                      ? ` · ${stampLabel(v.changed_at)}`
                      : ""}
                    {before ? (
                      <div
                        style={{
                          color: sub,
                          textDecoration: after ? "line-through" : "none",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {before}
                      </div>
                    ) : null}
                    {after ? (
                      <div
                        style={{
                          color: text,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {after}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
