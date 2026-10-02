import React, { useMemo, useState } from "react";
import EditNoteField, {
  isEditNoteValid,
  normalizeEditNote,
} from "../shared/EditNoteField.jsx";
import TrackedChangeMark from "../shared/TrackedChangeMark.jsx";
import {
  INTERNAL_ALERT_ROLES,
  VARIANCE_ALERT_BASES,
  VARIANCE_ALERT_CONFIG_FIELDS,
  buildVarianceAlertConfigPatch,
  validateVarianceAlertForm,
} from "../../lib/varianceAlertConfig.js";
import {
  formatVarianceAlertFieldValue,
  varianceAlertFieldChanges,
} from "../../lib/varianceAlertConfigHistory.js";

export const NOTE_REFUSED_MESSAGE =
  "Add a note explaining this change before saving.";
export const NO_CHANGE_MESSAGE =
  "Nothing has changed, so there is nothing to record.";

const CONSUMER_LABEL = {
  dashboard: "Dashboard + nightly evaluator",
  evaluator: "Nightly evaluator only",
};

const inputStyle = (C, invalid) => ({
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 13,
  color: C.textPrimary,
  background: C.inputBg || C.card || "transparent",
  border: `1px solid ${invalid ? C.red || "#b42318" : C.inputBorder || C.border || "#d0d5dd"}`,
  borderRadius: 6,
  fontFamily: "inherit",
});

export default function VarianceAlertConfigCard({
  resolvedConfig,
  storedConfig = null,
  versions = [],
  authorNames = new Map(),
  canEdit = false,
  onSave,
  provenanceText = "",
  C = {},
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState("");
  const [showNoteError, setShowNoteError] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const changes = useMemo(
    () => varianceAlertFieldChanges(versions, authorNames),
    [versions, authorNames],
  );
  const fieldErrors = useMemo(
    () => (form ? validateVarianceAlertForm(form) : {}),
    [form],
  );

  const startEditing = () => {
    setForm({
      groupPctThreshold: resolvedConfig.groupPctThreshold,
      accountPctThreshold: resolvedConfig.accountPctThreshold,
      enabled: resolvedConfig.enabled,
      eligibleRoles: [...resolvedConfig.eligibleRoles],
      alertBasis: resolvedConfig.alertBasis,
      accountDollarFloor: resolvedConfig.accountDollarFloor,
      groupDollarFloor: resolvedConfig.groupDollarFloor,
    });
    setNote("");
    setShowNoteError(false);
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setForm(null);
    setNote("");
    setShowNoteError(false);
    setError(null);
  };

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const toggleRole = (role) =>
    setForm((prev) => ({
      ...prev,
      eligibleRoles: prev.eligibleRoles.includes(role)
        ? prev.eligibleRoles.filter((r) => r !== role)
        : [...prev.eligibleRoles, role],
    }));

  const save = async () => {
    setError(null);
    if (!isEditNoteValid(note)) {
      setShowNoteError(true);
      setError(NOTE_REFUSED_MESSAGE);
      return;
    }
    if (Object.keys(fieldErrors).length) {
      setError("Fix the highlighted values before saving.");
      return;
    }
    const config = buildVarianceAlertConfigPatch(storedConfig, form);
    if (JSON.stringify(config) === JSON.stringify(storedConfig ?? {})) {
      setError(NO_CHANGE_MESSAGE);
      return;
    }
    setSaving(true);
    const result = await onSave({ config, note: normalizeEditNote(note) });
    setSaving(false);
    if (!result?.ok) {
      setError(
        /row-level security|policy|permission denied/i.test(
          String(result?.error),
        )
          ? "You need admin rights to change the variance alert configuration."
          : result?.error || "Save failed",
      );
      return;
    }
    setSaved(true);
    setEditing(false);
    setForm(null);
    setNote("");
  };

  const control = (field) => {
    switch (field.key) {
      case "enabled":
        return React.createElement(
          "label",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: C.textPrimary,
            },
          },
          React.createElement("input", {
            type: "checkbox",
            checked: !!form.enabled,
            "aria-label": field.label,
            onChange: (e) => setField("enabled", e.target.checked),
          }),
          form.enabled ? "Enabled" : "Disabled",
        );
      case "alertBasis":
        return React.createElement(
          "select",
          {
            value: form.alertBasis,
            "aria-label": field.label,
            onChange: (e) => setField("alertBasis", e.target.value),
            style: inputStyle(C, !!fieldErrors.alertBasis),
          },
          VARIANCE_ALERT_BASES.map((basis) =>
            React.createElement(
              "option",
              { key: basis, value: basis },
              basis.toUpperCase(),
            ),
          ),
        );
      case "eligibleRoles":
        return React.createElement(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: 10 } },
          INTERNAL_ALERT_ROLES.map((role) =>
            React.createElement(
              "label",
              {
                key: role,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: C.textPrimary,
                },
              },
              React.createElement("input", {
                type: "checkbox",
                checked: form.eligibleRoles.includes(role),
                "aria-label": `${field.label}: ${role}`,
                onChange: () => toggleRole(role),
              }),
              role,
            ),
          ),
        );
      default:
        return React.createElement("input", {
          type: "number",
          value: form[field.key],
          "aria-label": field.label,
          step: field.key.endsWith("DollarFloor") ? 100 : 0.5,
          min: field.key.endsWith("DollarFloor") ? 0 : undefined,
          onChange: (e) =>
            setField(
              field.key,
              e.target.value === "" ? "" : Number(e.target.value),
            ),
          style: inputStyle(C, !!fieldErrors[field.key]),
        });
    }
  };

  return React.createElement(
    "div",
    {
      "data-testid": "variance-alert-config-card",
      style: { display: "flex", flexDirection: "column", gap: 16, padding: 20 },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        },
      },
      React.createElement(
        "div",
        { style: { fontSize: 12, color: C.textSecondary, lineHeight: 1.5 } },
        "Values used by the dashboard and the nightly alert evaluator. Every change is recorded with the note that explains it.",
      ),
      !editing && canEdit
        ? React.createElement(
            "button",
            {
              type: "button",
              onClick: startEditing,
              style: {
                padding: "8px 14px",
                background: C.gold,
                color: C.navy,
                border: "none",
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                flex: "0 0 auto",
              },
            },
            "Edit configuration",
          )
        : null,
    ),

    error
      ? React.createElement(
          "div",
          {
            role: "alert",
            style: {
              padding: "10px 14px",
              background: "var(--ds-danger-bg)",
              border:
                "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--ds-danger-text)",
              lineHeight: 1.5,
            },
          },
          error,
        )
      : null,

    saved && !editing
      ? React.createElement(
          "div",
          {
            role: "status",
            style: { fontSize: 12, color: C.green || C.textSecondary },
          },
          "Configuration saved with your note.",
        )
      : null,

    React.createElement(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        },
      },
      VARIANCE_ALERT_CONFIG_FIELDS.map((field) => {
        const fieldChanges = changes[field.key] || [];
        const stored =
          storedConfig && typeof storedConfig === "object"
            ? storedConfig[field.key]
            : undefined;
        return React.createElement(
          "div",
          {
            key: field.key,
            "data-field": field.key,
            style: { padding: 12, background: C.subtleBg, borderRadius: 6 },
          },
          React.createElement(
            "div",
            { style: { fontSize: 12, fontWeight: 600, color: C.textPrimary } },
            field.label,
            fieldChanges.length
              ? React.createElement(TrackedChangeMark, {
                  changes: fieldChanges,
                  C,
                  label: field.label,
                })
              : null,
          ),
          editing && form
            ? React.createElement(
                "div",
                { style: { marginTop: 6 } },
                control(field),
                fieldErrors[field.key]
                  ? React.createElement(
                      "div",
                      {
                        role: "alert",
                        style: {
                          marginTop: 4,
                          fontSize: 11,
                          color: C.red || "#b42318",
                        },
                      },
                      fieldErrors[field.key],
                    )
                  : null,
              )
            : React.createElement(
                "div",
                {
                  style: {
                    marginTop: 4,
                    fontSize: 16,
                    fontWeight: 700,
                    color: C.textPrimary,
                    fontVariantNumeric: "tabular-nums",
                  },
                },
                formatVarianceAlertFieldValue(
                  field.key,
                  resolvedConfig[field.key],
                ),
              ),
          React.createElement(
            "div",
            { style: { marginTop: 4, fontSize: 11, color: C.textSecondary } },
            `Read by: ${field.consumers.includes("dashboard") ? CONSUMER_LABEL.dashboard : CONSUMER_LABEL.evaluator}`,
          ),
          !editing
            ? React.createElement(
                "div",
                {
                  style: { marginTop: 2, fontSize: 11, color: C.textSecondary },
                },
                stored === undefined
                  ? "Platform default (not configured)"
                  : "Configured for this org",
              )
            : null,
        );
      }),
    ),

    editing
      ? React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 10 } },
          React.createElement(EditNoteField, {
            value: note,
            onChange: setNote,
            showError: showNoteError,
            label: "Note (required)",
            placeholder: "Why are these thresholds changing?",
            C,
          }),
          React.createElement(
            "div",
            { style: { display: "flex", gap: 8 } },
            React.createElement(
              "button",
              {
                type: "button",
                onClick: save,
                disabled: saving,
                style: {
                  padding: "8px 14px",
                  background: C.gold,
                  color: C.navy,
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                },
              },
              saving ? "Saving…" : "Save configuration",
            ),
            React.createElement(
              "button",
              {
                type: "button",
                onClick: cancel,
                disabled: saving,
                style: {
                  padding: "8px 14px",
                  background: "transparent",
                  color: C.textPrimary,
                  border: `1px solid ${C.border || "#d0d5dd"}`,
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                },
              },
              "Cancel",
            ),
          ),
        )
      : null,

    React.createElement(
      "div",
      { style: { fontSize: 12, color: C.textSecondary, lineHeight: 1.5 } },
      `Provenance: ${provenanceText}.`,
    ),
    !canEdit
      ? React.createElement(
          "div",
          { style: { fontSize: 12, color: C.textSecondary, lineHeight: 1.5 } },
          "Changing these values requires admin rights.",
        )
      : null,
  );
}
