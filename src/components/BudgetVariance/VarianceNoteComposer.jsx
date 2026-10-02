import React, { useEffect, useMemo, useState } from "react";
import {
  NOTE_RANGE_PRESETS,
  NOTE_TEXT_MAX,
  monthsInRange,
  rangeLabel,
  resolvePresetRange,
} from "../../lib/varianceNotes.js";

function monthLabel(monthEnd) {
  if (typeof monthEnd !== "string") return monthEnd || "";
  const d = new Date(`${monthEnd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthEnd;
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const FAILURE_COPY = {
  empty: "Write the explanation before saving.",
  too_long: `Too long — commentary is capped at ${NOTE_TEXT_MAX.toLocaleString()} characters.`,
  rejected_text: "The text was rejected, so shorten it and try again.",
  conflict:
    "Someone recorded commentary for exactly these months while you were typing. Reopen the account to read theirs before writing again.",
  denied:
    "The database refused this write. Your role may not permit commentary, or your session may have expired — reload and sign in again.",
  invalid_month:
    "That month is not one of this account's months in the selected window.",
  invalid_range:
    "The first month of the range comes after the last one, so nothing was saved.",
  invalid_grain:
    "This note is missing the account it explains, so it was not saved.",
  failed: "The note could not be saved, so nothing was recorded.",
};

export default function VarianceNoteComposer({
  monthOptions = [],
  existingChains = [],
  fixedRange = null,
  onSave,
  onDirtyChange = null,
  theme = {},
}) {
  const text = theme.text || "inherit";
  const sub = theme.sub || "inherit";
  const border = theme.border || "currentColor";
  const card = theme.card || "transparent";
  const red = theme.red || "inherit";

  const months = useMemo(
    () =>
      [
        ...new Set(
          monthOptions
            .map((m) => m?.month_end)
            .filter(Boolean)
            .map(String),
        ),
      ].sort(),
    [monthOptions],
  );

  const newest = months.length ? months[months.length - 1] : "";

  const [preset, setPreset] = useState("month");
  const [anchor, setAnchor] = useState(newest);
  const [fromMonth, setFromMonth] = useState(months[0] || "");
  const [toMonth, setToMonth] = useState(newest);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);
  const [savedLabel, setSavedLabel] = useState(null);

  const anchorMonth = months.includes(anchor) ? anchor : newest;
  const from = months.includes(fromMonth) ? fromMonth : months[0] || "";
  const to = months.includes(toMonth) ? toMonth : newest;

  const range = useMemo(() => {
    if (fixedRange) {
      const lo = String(fixedRange.monthStart || fixedRange.monthEnd);
      const hi = String(fixedRange.monthEnd);
      return months.includes(lo) && months.includes(hi) && lo <= hi
        ? { monthStart: lo, monthEnd: hi }
        : null;
    }
    if (preset === "multi") {
      if (!from || !to) return null;
      const lo = from <= to ? from : to;
      const hi = from <= to ? to : from;
      return { monthStart: lo, monthEnd: hi };
    }
    return resolvePresetRange(preset, anchorMonth, monthOptions);
  }, [fixedRange, months, preset, from, to, anchorMonth, monthOptions]);

  const covered = useMemo(
    () => monthsInRange(range, monthOptions),
    [range, monthOptions],
  );

  const superseding = useMemo(() => {
    if (!range) return [];
    return (existingChains || [])
      .filter((c) => c?.current && c?.note)
      .filter((c) => {
        const start = String(c.note.month_start || c.note.month_end);
        const end = String(c.note.month_end);
        return (
          start <= String(range.monthEnd) && end >= String(range.monthStart)
        );
      })
      .map((c) => c.note);
  }, [existingChains, range]);

  const trimmed = draft.trim();
  const canSave =
    !saving && trimmed.length > 0 && trimmed.length <= NOTE_TEXT_MAX && !!range;

  const dirty = trimmed.length > 0;
  useEffect(() => {
    if (typeof onDirtyChange !== "function") return undefined;
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  if (monthOptions.length === 0) return null;

  const clearStatus = () => {
    setFailure(null);
    setSavedLabel(null);
  };

  const submit = async () => {
    if (!canSave || typeof onSave !== "function") return;
    setSaving(true);
    clearStatus();
    let result;
    try {
      result = await onSave(
        { monthStart: range.monthStart, monthEnd: range.monthEnd },
        trimmed,
      );
    } catch {
      result = { ok: false, reason: "failed" };
    }
    setSaving(false);
    if (result?.ok) {
      setDraft("");
      setSavedLabel(rangeLabel(range.monthStart, range.monthEnd));
      return;
    }
    setFailure(result?.reason || "failed");
  };

  const selectStyle = {
    fontSize: 11,
    color: text,
    background: card,
    border: `1px solid ${border}`,
    borderRadius: 3,
    padding: "2px 4px",
  };

  const presetButton = (p) => {
    const on = preset === p.id;
    return (
      <button
        key={p.id}
        type="button"
        aria-pressed={on}
        onClick={() => {
          setPreset(p.id);
          clearStatus();
        }}
        style={{
          fontSize: 11,
          fontWeight: on ? 700 : 500,
          color: on ? text : sub,
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 3,
          padding: "3px 8px",
          cursor: "pointer",
        }}
      >
        {p.label}
      </button>
    );
  };

  const monthSelect = (label, value, onChange) => (
    <label style={{ fontSize: 11, color: sub }}>
      {label}{" "}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          clearStatus();
        }}
        style={selectStyle}
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      style={{
        marginTop: 10,
        borderTop: `1px solid ${border}`,
        paddingTop: 10,
        maxWidth: 720,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: sub,
          }}
        >
          Add commentary
        </span>
        {fixedRange ? null : NOTE_RANGE_PRESETS.map(presetButton)}
      </div>

      {fixedRange ? null : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 6,
          }}
        >
          {preset === "multi" ? (
            <>
              {monthSelect("From month", from, setFromMonth)}
              {monthSelect("To month", to, setToMonth)}
            </>
          ) : preset === "window" ? (
            <span style={{ fontSize: 11, color: sub }}>
              Every month in the selected reporting window.
            </span>
          ) : (
            monthSelect(
              preset === "quarter"
                ? "Month inside the quarter"
                : "Month this commentary explains",
              anchorMonth,
              setAnchor,
            )
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: sub, marginBottom: 6 }}>
        {range ? (
          <>
            Applies to{" "}
            <span style={{ color: text, fontWeight: 700 }}>
              {rangeLabel(range.monthStart, range.monthEnd)}
            </span>
            {covered.length
              ? ` — ${covered.length} month${covered.length === 1 ? "" : "s"} of this account`
              : ""}
          </>
        ) : (
          "This account has no months in the selected window."
        )}
      </div>

      {superseding.length > 0 && (
        <div style={{ fontSize: 11, color: sub, marginBottom: 6 }}>
          Saving replaces{" "}
          {superseding
            .map((n) => rangeLabel(n.month_start, n.month_end))
            .join(", ")}{" "}
          with a new version. The earlier wording stays readable in that note's
          version list.
        </div>
      )}

      <textarea
        aria-label="Why this account's variance happened"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          clearStatus();
        }}
        placeholder="Why was this account over or under budget in these months?"
        rows={3}
        maxLength={NOTE_TEXT_MAX}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontSize: 13,
          fontFamily: "inherit",
          color: text,
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 4,
          padding: "6px 8px",
          resize: "vertical",
        }}
      />
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}
      >
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: canSave ? text : sub,
            background: card,
            border: `1px solid ${border}`,
            borderRadius: 4,
            padding: "4px 10px",
            cursor: canSave ? "pointer" : "default",
          }}
        >
          {saving ? "Saving…" : "Save commentary"}
        </button>
        {trimmed.length > NOTE_TEXT_MAX - 200 && (
          <span
            style={{
              fontSize: 11,
              color: trimmed.length > NOTE_TEXT_MAX ? red : sub,
            }}
          >
            {trimmed.length.toLocaleString()} / {NOTE_TEXT_MAX.toLocaleString()}
          </span>
        )}
      </div>

      {failure && (
        <div role="alert" style={{ fontSize: 11, color: red, marginTop: 6 }}>
          {FAILURE_COPY[failure] || FAILURE_COPY.failed}
        </div>
      )}
      {savedLabel && !failure && (
        <div style={{ fontSize: 11, color: sub, marginTop: 6 }}>
          Commentary saved for {savedLabel}.
        </div>
      )}
    </div>
  );
}
