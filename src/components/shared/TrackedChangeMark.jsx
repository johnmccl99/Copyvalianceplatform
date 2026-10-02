import React, { useId, useState } from "react";

export const UNIDENTIFIED_AUTHOR = "Unidentified user";
export const TRACKED_CHANGE_MARK_TEST_ID = "tracked-change-mark";

export function formatTrackedChangeTime(at) {
  if (!at) return "Time not recorded";
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "Time not recorded";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const valueText = (v) => (v == null || v === "" ? "—" : String(v));

export default function TrackedChangeMark({
  change,
  changes,
  C = {},
  label = null,
  heading: headingOverride = null,
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const entries = Array.isArray(changes)
    ? changes.filter(Boolean)
    : change
      ? [change]
      : [];
  if (entries.length === 0) return null;

  const accent = C.accent || C.textSecondary || "currentColor";
  const authorOf = (c) => (c.author || "").trim() || UNIDENTIFIED_AUTHOR;
  const hasValues = (c) => c.before !== undefined || c.after !== undefined;
  const hasEdit = (c) => Boolean(c.editedBy || c.editedAt);
  const editorOf = (c) => (c.editedBy || "").trim() || UNIDENTIFIED_AUTHOR;
  const summaryOf = (c) =>
    (c.bed ? `${c.bed}: ` : "") +
    (hasValues(c)
      ? `Changed by ${authorOf(c)}, ${formatTrackedChangeTime(c.at)}: ${valueText(c.before)} → ${valueText(c.after)}`
      : `Written by ${authorOf(c)}, ${formatTrackedChangeTime(c.at)}`) +
    (hasEdit(c)
      ? `; edited by ${editorOf(c)}, ${formatTrackedChangeTime(c.editedAt)}`
      : "") +
    (c.months && !hasValues(c) ? ` (${c.months})` : "") +
    (c.note ? `. ${c.note}` : "");
  const summary =
    entries.length === 1
      ? summaryOf(entries[0])
      : `${entries.length} ${entries.every((c) => !hasValues(c)) ? "notes" : "changes"}. ` +
        entries.map(summaryOf).join(" ");

  const row = (k, v) =>
    React.createElement(
      "div",
      { key: k, style: { display: "flex", gap: 8 } },
      React.createElement(
        "span",
        {
          style: {
            color: C.textSecondary || "inherit",
            minWidth: 48,
            flex: "0 0 auto",
          },
        },
        k,
      ),
      React.createElement(
        "span",
        {
          style: {
            color: C.textPrimary || "inherit",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          },
        },
        v,
      ),
    );
  const valueKey = (c, k) => (c.valueLabel ? `${c.valueLabel} — ${k}` : k);
  const entryRows = (c) => [
    c.bed ? row("Bed", c.bed) : null,
    row("Who", authorOf(c)),
    row("When", formatTrackedChangeTime(c.at)),
    hasEdit(c)
      ? row("Edited", `${editorOf(c)}, ${formatTrackedChangeTime(c.editedAt)}`)
      : null,
    c.months ? row("Months", c.months) : null,
    hasValues(c) ? row(valueKey(c, "Was"), valueText(c.before)) : null,
    hasValues(c) ? row(valueKey(c, "Now"), valueText(c.after)) : null,
    row("Note", c.note && String(c.note).trim() ? c.note : "No note recorded"),
  ];
  const base = label ? `${label} changed` : "Changed";
  const unit = entries.some((c) => c.bed) ? "beds" : "edits";
  const heading = headingOverride
    ? entries.length === 1
      ? headingOverride
      : `${headingOverride} — ${entries.length}`
    : entries.length === 1
      ? base
      : `${base} — ${entries.length} ${unit}`;

  return React.createElement(
    "span",
    {
      style: {
        position: "relative",
        display: "inline-block",
        marginLeft: 4,
        verticalAlign: "middle",
      },
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
    },
    React.createElement("span", {
      role: "img",
      tabIndex: 0,
      "aria-label": summary,
      "aria-describedby": open ? tipId : undefined,
      "data-testid": TRACKED_CHANGE_MARK_TEST_ID,
      "data-tracked-change": "true",
      style: {
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: accent,
        cursor: "help",
        outline: "none",
      },
    }),
    open
      ? React.createElement(
          "div",
          {
            id: tipId,
            role: "tooltip",
            style: {
              position: "absolute",
              zIndex: 40,
              right: 0,
              top: "calc(100% + 6px)",
              minWidth: 220,
              maxWidth: 320,
              padding: "8px 10px",
              fontSize: 11,
              lineHeight: 1.45,
              textAlign: "left",
              fontWeight: 400,
              color: C.textPrimary || "inherit",
              background: C.card || "#fff",
              border: `1px solid ${C.border || "#d0d5dd"}`,
              borderRadius: 8,
              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
              whiteSpace: "normal",
            },
          },
          React.createElement(
            "div",
            { style: { fontWeight: 700, marginBottom: 4 } },
            heading,
          ),
          entries.length === 1
            ? entryRows(entries[0])
            : entries.map((c, i) =>
                React.createElement(
                  "div",
                  {
                    key: i,
                    "data-tracked-entry": "true",
                    style: {
                      marginTop: i === 0 ? 0 : 6,
                      paddingTop: i === 0 ? 0 : 6,
                      borderTop:
                        i === 0 ? "none" : `1px solid ${C.border || "#d0d5dd"}`,
                    },
                  },
                  c.bed
                    ? null
                    : React.createElement(
                        "div",
                        { style: { fontWeight: 600, marginBottom: 2 } },
                        hasValues(c) ? `Change ${i + 1}` : `Note ${i + 1}`,
                      ),
                  entryRows(c),
                ),
              ),
        )
      : null,
  );
}
