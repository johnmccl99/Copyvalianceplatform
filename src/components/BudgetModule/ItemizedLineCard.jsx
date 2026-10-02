import React from "react";
import ItemizedDerivationPanel from "./ItemizedDerivationPanel.jsx";
import ItemizedRunRateRecompute from "./ItemizedRunRateRecompute.jsx";
import {
  describeItemizedField,
  isReinterpretedField,
  prettifyFieldName,
  asPercentHint,
  describesARate,
  isPlausibleRate,
} from "../../lib/itemizedFieldSemantics.js";
import {
  ITEMIZED_EDITOR_COLUMNS,
  FREQUENCY_VALUES,
  INCREASE_FREQUENCY_VALUES,
  prettyItemizedCategory,
  validateItemizedRow,
} from "../../lib/budgetItemized.js";

const PRIMARY_FIELDS = [
  "account_number",
  "line_description",
  "first_month",
  "frequency",
  "last_month",
  "amount",
  "growth",
  "increase_frequency",
  "increase_interval_months",
];

const EDITABLE_FIELDS = new Set([
  "line_description",
  "frequency",
  "first_month",
  "last_month",
  "amount",
  "growth",
  "increase_frequency",
  "increase_interval_months",
]);

const NEW_ROW_FIELDS = new Set(["account_number"]);

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const SECONDARY_FIELDS = ITEMIZED_EDITOR_COLUMNS.map((c) => c.field).filter(
  (f) => !PRIMARY_FIELDS.includes(f),
);

const FIELD_TYPE = Object.fromEntries(
  ITEMIZED_EDITOR_COLUMNS.map((c) => [c.field, c.type]),
);

function displayFor(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function Field({
  row,
  category,
  field,
  C,
  editable,
  disabled,
  onCell,
  errMsg,
  warnMsg,
}) {
  const raw = row[field];
  const desc = describeItemizedField({
    category,
    account_number: row.account_number,
    field,
    value: raw,
  });
  const reinterpreted = isReinterpretedField({
    category,
    account_number: row.account_number,
    field,
    value: raw,
  });
  const shown = displayFor(raw);
  const type = FIELD_TYPE[field] || "text";
  const rateEquivalent = describesARate({
    category,
    account_number: row.account_number,
    field,
    value: raw,
  })
    ? asPercentHint(raw)
    : "";
  const notARate =
    desc.semantic === "growth_rate" &&
    raw !== null &&
    raw !== undefined &&
    raw !== "" &&
    !isPlausibleRate(raw);

  const borderColor = errMsg
    ? "var(--ds-danger-text)"
    : warnMsg
      ? "var(--ds-warning-dot)"
      : C.border;
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "5px 7px",
    border: `1px solid ${borderColor}`,
    borderRadius: 3,
    fontSize: 12.5,
    background: disabled ? C.subtleBg : C.inputBg,
    color: C.textPrimary,
    textAlign: type === "number" ? "right" : "left",
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}
    >
      <label
        style={{
          fontSize: 9.5,
          fontWeight: 800,
          color: C.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {desc.label}
        {reinterpreted && (
          <span
            title={`On this account this field means: ${desc.hint}`}
            style={{
              marginLeft: 6,
              fontSize: 9,
              fontWeight: 800,
              padding: "1px 5px",
              borderRadius: 3,
              background: C.subtleBg,
              color: "var(--ds-warning-text)",
              letterSpacing: 0.2,
            }}
          >
            NOT A RATE
          </span>
        )}
      </label>

      {editable && (type === "frequency" || type === "increaseFrequency") && (
        <select
          disabled={disabled}
          value={raw == null ? "" : raw}
          onChange={(e) => onCell(field, e.target.value)}
          style={inputStyle}
        >
          <option value="">—</option>
          {[
            ...(type === "increaseFrequency"
              ? INCREASE_FREQUENCY_VALUES
              : FREQUENCY_VALUES),
          ].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}

      {editable && type !== "frequency" && type !== "increaseFrequency" && (
        <input
          type="text"
          disabled={disabled}
          value={raw == null ? "" : raw}
          placeholder={type === "date" ? "YYYY-MM-DD" : ""}
          onChange={(e) => onCell(field, e.target.value)}
          style={inputStyle}
        />
      )}

      {!editable && (
        <div
          style={{
            fontSize: 13,
            color: shown === null ? C.textSecondary : C.textPrimary,
            fontWeight: shown === null ? 400 : 700,
            wordBreak: "break-word",
            fontFamily: MONO,
            fontVariantNumeric: "tabular-nums",
            padding: "5px 0",
          }}
        >
          {shown === null ? "—" : shown}
        </div>
      )}

      {errMsg && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--ds-danger-text)",
            lineHeight: 1.4,
          }}
        >
          {errMsg}
        </div>
      )}
      {!errMsg && warnMsg && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ds-warning-text)",
            lineHeight: 1.4,
          }}
        >
          {warnMsg}
        </div>
      )}
      {!errMsg && rateEquivalent && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.accent,
            lineHeight: 1.4,
          }}
        >
          {rateEquivalent}
        </div>
      )}
      {!errMsg && !warnMsg && reinterpreted && desc.hint && (
        <div
          style={{ fontSize: 10.5, color: C.textSecondary, lineHeight: 1.35 }}
        >
          {desc.hint}
        </div>
      )}
      {notARate && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--ds-warning-text)",
            lineHeight: 1.35,
          }}
        >
          Too large to be a rate, so no percentage is shown. Stored as-is.
        </div>
      )}
    </div>
  );
}

export default function ItemizedLineCard({
  row,
  category,
  C,
  onClose,
  canWrite = false,
  coaAccounts,
  onCell,
  onSave,
  onRevert,
  derivation = null,
  derivationLoading = false,
  derivationError = "",
  propertyCode = "",
}) {
  if (!row) return null;

  const v = validateItemizedRow(row, { coaAccounts });
  const title = row.line_description || "(no description)";
  const origin = row._isNew
    ? "new"
    : row.origin === "editor"
      ? "editor"
      : "workbook";
  const canEdit = Boolean(canWrite && onCell);
  const disabled = Boolean(row._saving);

  const setField = (field, value) => onCell(row._key, field, value);

  const fieldProps = (field) => ({
    row,
    category,
    field,
    C,
    editable:
      canEdit &&
      (EDITABLE_FIELDS.has(field) || (row._isNew && NEW_ROW_FIELDS.has(field))),
    disabled,
    onCell: setField,
    errMsg: v.errors[field] || "",
    warnMsg: v.warnings[field] || "",
  });

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.accent}`,
        borderRadius: 8,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        background: C.inputBg,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: C.textPrimary,
              wordBreak: "break-word",
              lineHeight: 1.3,
              fontFamily: MONO,
            }}
          >
            {row.account_number ? `${row.account_number} · ${title}` : title}
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 3 }}>
            {prettyItemizedCategory(category)} · {origin}
            {row._dirty && (
              <span
                style={{ color: "var(--ds-warning-text)", fontWeight: 700 }}
              >
                {" "}
                · unsaved edits
              </span>
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.textSecondary,
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "14px 18px",
        }}
      >
        {PRIMARY_FIELDS.filter(
          (f) =>
            f !== "increase_interval_months" ||
            row.increase_frequency === "Custom",
        ).map((f) => (
          <Field key={f} {...fieldProps(f)} />
        ))}
      </div>

      {!row._isNew && (
        <ItemizedDerivationPanel
          row={row}
          match={derivation}
          loading={derivationLoading}
          error={derivationError}
          C={C}
        />
      )}

      {!row._isNew && (
        <ItemizedRunRateRecompute
          row={row}
          propertyCode={propertyCode}
          C={C}
          canWrite={canEdit}
          onApply={(amount) => setField("amount", String(amount))}
        />
      )}

      <details>
        <summary
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: C.textSecondary,
            cursor: "pointer",
          }}
        >
          Other fields ({SECONDARY_FIELDS.length})
        </summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
            marginTop: 12,
          }}
        >
          {SECONDARY_FIELDS.map((f) => (
            <Field key={f} {...fieldProps(f)} />
          ))}
        </div>
      </details>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderTop: `1px solid ${C.border}`,
          paddingTop: 12,
          flexWrap: "wrap",
        }}
      >
        {canEdit && (row._dirty || row._isNew) && onSave && (
          <button
            type="button"
            disabled={disabled || !v.ok}
            onClick={() => onSave(row)}
            title={v.ok ? "" : "Fix the flagged fields above first."}
            style={{
              border: "none",
              borderRadius: 4,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: disabled || !v.ok ? "not-allowed" : "pointer",
              opacity: disabled || !v.ok ? 0.5 : 1,
              background: C.accent,
              color: "#fff",
            }}
          >
            {disabled ? "Saving..." : row._isNew ? "Create line" : "Save"}
          </button>
        )}
        {canEdit && (row._dirty || row._isNew) && onRevert && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRevert(row._key)}
            style={{
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.textSecondary,
              borderRadius: 4,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {row._isNew ? "Discard" : "Revert"}
          </button>
        )}
        <div
          style={{
            fontSize: 11,
            color: C.textSecondary,
            flex: 1,
            minWidth: 200,
          }}
        >
          {!canEdit
            ? "Read-only. You do not have permission to edit budget lines."
            : !v.ok
              ? "Fix the flagged fields above before saving."
              : row._isNew
                ? "New line. Set at least an account and a description, then Save."
                : row._dirty
                  ? "Unsaved edits on this line."
                  : "No unsaved changes."}
        </div>
      </div>
      {row._error && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--ds-danger-text)",
          }}
        >
          {row._error}
        </div>
      )}
    </div>
  );
}

export {
  PRIMARY_FIELDS,
  SECONDARY_FIELDS,
  EDITABLE_FIELDS,
  NEW_ROW_FIELDS,
  prettifyFieldName,
};
