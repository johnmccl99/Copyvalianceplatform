import React from "react";
import VarianceNoteCard from "./VarianceNoteCard.jsx";
import VarianceNoteComposer from "./VarianceNoteComposer.jsx";
import { noteCoversMonth, rangeLabel } from "../../lib/varianceNotes.js";

export default function VarianceNotePanel({
  notes = [],
  authors = {},
  loading = false,
  error = null,
  truncated = false,
  windowLabel = "",
  leadingMonthEnd = null,
  monthOptions = [],
  fixedRange = null,
  onSaveNote = null,
  onDraftDirtyChange = null,
  onEditNote = null,
  onDeleteNote = null,
  onLoadHistory = null,
  theme = {},
}) {
  const text = theme.text || "inherit";
  const sub = theme.sub || "inherit";
  const border = theme.border || "currentColor";
  const card = theme.card || "transparent";
  const red = theme.red || "inherit";

  const heading = (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        marginBottom: notes.length ? 8 : 0,
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
        Commentary
      </span>
      <span style={{ fontSize: 11, color: sub }}>
        why this account's variance happened — recorded by your team, not by
        Entrata
      </span>
    </div>
  );

  if (loading) {
    return (
      <div>
        {heading}
        <div style={{ fontSize: 12, color: sub }}>Loading commentary…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {heading}
        <div style={{ fontSize: 12, color: red }}>
          Commentary could not be loaded, so this account may carry a note that
          is not shown.
        </div>
      </div>
    );
  }

  const chains = (notes || [])
    .filter(Boolean)
    .map((c) =>
      c.note
        ? c
        : { id: c.id, note: c, current: !c.superseded_at, priorVersions: [] },
    );

  const composer =
    onSaveNote && !truncated ? (
      <VarianceNoteComposer
        monthOptions={monthOptions}
        existingChains={chains}
        fixedRange={fixedRange}
        onSave={onSaveNote}
        onDirtyChange={onDraftDirtyChange}
        theme={{ text, sub, border, card, red }}
      />
    ) : null;

  const capNotice = truncated ? (
    <div style={{ fontSize: 11, color: red, marginTop: 6 }}>
      This window holds more commentary than was loaded, so some notes are not
      shown.
    </div>
  ) : null;

  if (notes.length === 0) {
    return (
      <div>
        {heading}
        <div style={{ fontSize: 12, color: sub }}>
          {truncated
            ? "Commentary for this account was not loaded."
            : `No commentary recorded for this account${fixedRange ? ` in ${rangeLabel(fixedRange.monthStart, fixedRange.monthEnd)}` : windowLabel ? ` in ${windowLabel}` : ""}.`}
        </div>
        {capNotice}
        {composer}
      </div>
    );
  }

  return (
    <div>
      {heading}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {chains.map((c) => (
          <VarianceNoteCard
            key={c.id}
            note={c.note}
            priorVersions={c.priorVersions || []}
            current={c.current !== false}
            authors={authors}
            leading={
              leadingMonthEnd != null &&
              noteCoversMonth(c.note, leadingMonthEnd)
            }
            onEdit={onEditNote}
            onDelete={onDeleteNote}
            onLoadHistory={onLoadHistory}
            theme={{
              text,
              sub,
              border,
              card,
              red,
              leadingBg: theme.leadingBg,
              leadingFg: theme.leadingFg,
            }}
          />
        ))}
      </div>
      {capNotice}
      {composer}
    </div>
  );
}
