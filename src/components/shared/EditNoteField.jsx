import React, { useEffect, useId } from "react";

export const EDIT_NOTE_REQUIRED_MESSAGE =
  "Add a note explaining this change before saving.";

export function isEditNoteValid(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeEditNote(value) {
  return isEditNoteValid(value) ? value.trim() : null;
}

export default function EditNoteField({
  value,
  onChange,
  onValidity = null,
  label = "Note (required)",
  placeholder = "Why is this figure changing?",
  disabled = false,
  showError = false,
  compact = false,
  C = {},
  style = {},
}) {
  const id = useId();
  const valid = isEditNoteValid(value);

  useEffect(() => {
    if (typeof onValidity === "function") onValidity(valid);
  }, [valid, onValidity]);

  const border = C.border || "#d0d5dd";
  const text = C.textPrimary || "inherit";
  const sub = C.textSecondary || "inherit";
  const danger = C.red || "#b42318";
  const invalidShown = showError && !valid;

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: compact ? "4px 6px" : "8px 10px",
    fontSize: compact ? 11 : 12,
    color: text,
    background: C.card || "transparent",
    border: `1px solid ${invalidShown ? danger : border}`,
    borderRadius: 6,
    fontFamily: "inherit",
    resize: compact ? "none" : "vertical",
  };

  const control = compact
    ? React.createElement("input", {
        id,
        type: "text",
        value: value ?? "",
        placeholder,
        disabled,
        required: true,
        "aria-required": "true",
        "aria-invalid": valid ? "false" : "true",
        "data-edit-note": "true",
        onChange: (e) => onChange(e.target.value),
        style: inputStyle,
      })
    : React.createElement("textarea", {
        id,
        value: value ?? "",
        placeholder,
        disabled,
        required: true,
        rows: 2,
        "aria-required": "true",
        "aria-invalid": valid ? "false" : "true",
        "data-edit-note": "true",
        onChange: (e) => onChange(e.target.value),
        style: inputStyle,
      });

  return React.createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 4, ...style } },
    label
      ? React.createElement(
          "label",
          { htmlFor: id, style: { fontSize: 11, fontWeight: 600, color: sub } },
          label,
        )
      : null,
    control,
    invalidShown
      ? React.createElement(
          "div",
          { role: "alert", style: { fontSize: 11, color: danger } },
          EDIT_NOTE_REQUIRED_MESSAGE,
        )
      : null,
  );
}
