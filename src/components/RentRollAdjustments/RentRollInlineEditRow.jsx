import React, { useMemo, useState } from "react";
import {
  insertLeaseAdjustment,
  updateLeaseAdjustment,
} from "../../lib/supabaseClient.js";
import { logAction } from "../../lib/usage/usageClient.js";
import { SURFACE_KEYS, ACTION_KEYS } from "../../lib/usage/usageKeys.js";
import {
  INLINE_KIND_CHARGE,
  INLINE_KIND_RENT,
  INLINE_MODE_OFF_ENTRATA,
  inlineEditInitialValues,
  inlineEditableColumn,
  inlineRowMode,
  planInlineEdit,
} from "../../lib/rentRollInlineEdit.js";
import { MoneyOverrideInput } from "./RentRollAdjustmentsPage.jsx";
import {
  MONEY_MODE_OVERRIDE,
  moneyModeOf,
} from "../../lib/rentRollMoneyOverride.js";
import {
  MARKET_UTILITY_CHARGE_CODE,
  previewMarketUtility,
} from "../../lib/rentRollChargeColumns.js";
import { RENT_PLAUSIBLE_MIN } from "../../lib/rentRollView.js";
import EditNoteField, {
  EDIT_NOTE_REQUIRED_MESSAGE,
  normalizeEditNote,
} from "../shared/EditNoteField.jsx";

function entrataFigureFor(row, spec, mode, column = null) {
  if (mode === INLINE_MODE_OFF_ENTRATA) return undefined;
  const original = (row && row.entrata_values) || {};
  if (spec.kind === INLINE_KIND_RENT) return row.rent == null ? null : row.rent;
  if (spec.kind === INLINE_KIND_CHARGE) {
    const overrides = (row && row.charge_overrides) || {};
    if (Object.prototype.hasOwnProperty.call(overrides, spec.code))
      return undefined;
    if (typeof column?.get === "function") {
      const v = column.get(row);
      return v == null ? undefined : v;
    }
    const charges = (row && row.charges) || {};
    const v = charges[spec.code];
    return v == null ? undefined : v;
  }
  if (
    spec.field &&
    Object.prototype.hasOwnProperty.call(original, spec.field)
  ) {
    return original[spec.field];
  }
  if (
    spec.field &&
    row &&
    Object.prototype.hasOwnProperty.call(row, spec.field)
  ) {
    return row[spec.field] == null ? null : row[spec.field];
  }
  return undefined;
}

function utilityFormulaFigureFor(row, marketUtility) {
  if (marketUtility == null || !row) return undefined;
  const overrides = row.charge_overrides || {};
  if (
    Object.prototype.hasOwnProperty.call(overrides, MARKET_UTILITY_CHARGE_CODE)
  )
    return undefined;
  const charges = row.charges || {};
  const billed = charges[MARKET_UTILITY_CHARGE_CODE];
  return previewMarketUtility({
    billed: billed == null ? null : billed,
    rent: row.rent_charges == null ? null : row.rent_charges,
    marketUtility,
    plausibleMin: RENT_PLAUSIBLE_MIN,
  });
}

function readOnlyText(column, row) {
  const v = typeof column.get === "function" ? column.get(row) : null;
  if (v == null || v === "") return "—";
  if (column.type === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(v);
}

export default function RentRollInlineEditRow({
  row,
  columns,
  C,
  propertyId,
  onCancel,
  onSaved,
  onRefresh = null,
  onOpenFullEditor = null,
  marketUtility = null,
}) {
  const mode = inlineRowMode(row);
  const [values, setValues] = useState({});
  const stated = useMemo(
    () => inlineEditInitialValues(row, columns),
    [row, columns],
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const noteValue = normalizeEditNote(note);

  const specs = useMemo(() => {
    const map = {};
    for (const col of columns || []) {
      const spec = inlineEditableColumn(col, mode);
      if (spec) map[col.key] = spec;
    }
    return map;
  }, [columns, mode]);

  const dangerColor = C.red || C.dangerText || "#b42318";

  const inputStyle = {
    font: "inherit",
    fontSize: 11,
    padding: "3px 5px",
    width: "100%",
    minWidth: 72,
    color: C.textPrimary,
    background: C.cardBg || "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 4,
  };

  const set = (key, value) => {
    setValues((v) => {
      if (value === undefined) {
        if (!(key in v)) return v;
        const rest = { ...v };
        delete rest[key];
        return rest;
      }
      return { ...v, [key]: value };
    });
    setErrors((e) => (e[key] == null ? e : { ...e, [key]: null }));
  };

  const save = async () => {
    if (saving) return;
    const plan = planInlineEdit({ row, columns, values });
    if (!plan.changed) {
      onCancel();
      return;
    }
    if (Object.keys(plan.errors).length > 0) {
      setErrors(plan.errors);
      return;
    }
    if (noteValue == null) {
      setErrors({ _note: EDIT_NOTE_REQUIRED_MESSAGE });
      return;
    }

    setSaving(true);
    setErrors({});
    let applied = 0;
    try {
      for (const w of plan.writes) {
        if (w.action === "insert") {
          await insertLeaseAdjustment(propertyId, {
            adjustment_type: w.adjustmentType,
            lease_id: w.leaseId,
            payload: w.payload,
            note: noteValue,
          });
          logAction(
            SURFACE_KEYS.PROPERTY_LIVE_RENT_ROLL,
            ACTION_KEYS.APPLY_ADJUSTMENT,
            { propertyId },
          );
        } else if (w.action === "update") {
          await updateLeaseAdjustment(w.adjustmentId, {
            adjustment_type: w.adjustmentType,
            payload: w.payload,
            note: noteValue,
          });
          logAction(
            SURFACE_KEYS.PROPERTY_LIVE_RENT_ROLL,
            ACTION_KEYS.EDIT_ADJUSTMENT,
            { propertyId },
          );
        } else {
          await updateLeaseAdjustment(w.adjustmentId, {
            is_active: false,
            note: noteValue,
          });
          logAction(
            SURFACE_KEYS.PROPERTY_LIVE_RENT_ROLL,
            ACTION_KEYS.EDIT_ADJUSTMENT,
            { propertyId },
          );
        }
        applied += 1;
      }
      onSaved();
    } catch (e) {
      const reason = e?.message || "the write was refused";
      if (applied > 0) {
        setErrors({
          _row:
            "Part of this row was saved before the rest was refused (" +
            reason +
            "). The roll below now shows what was applied — check it and finish the" +
            " remaining change, or reverse it in the Rent Roll Adjustments editor.",
        });
        if (typeof onRefresh === "function") onRefresh();
        return;
      }
      setErrors({
        _row: e?.message || "Save failed. Your change was not applied.",
      });
    } finally {
      setSaving(false);
    }
  };

  const cellStyle = { padding: "5px 6px", verticalAlign: "top" };

  const editorFor = (column) => {
    const spec = specs[column.key];
    const value = values[column.key] ?? "";
    const current = readOnlyText(column, row);
    const isLeaseRent =
      spec.kind === INLINE_KIND_RENT && mode !== INLINE_MODE_OFF_ENTRATA;
    const label = isLeaseRent
      ? `${column.label} — lease rent, before charges`
      : column.label;

    if (spec.type === "money") {
      const isUtilityFee =
        spec.kind === INLINE_KIND_CHARGE &&
        spec.code === MARKET_UTILITY_CHARGE_CODE;
      const current =
        typeof column.get === "function" ? column.get(row) : undefined;
      return (
        <>
          <MoneyOverrideInput
            value={values[column.key]}
            onChange={(v, m) =>
              set(
                column.key,
                m === MONEY_MODE_OVERRIDE && v === "" ? undefined : v,
              )
            }
            initialMode={moneyModeOf(stated[column.key])}
            entrataValue={entrataFigureFor(row, spec, mode, column)}
            currentValue={current == null ? undefined : current}
            formulaEnabled={isUtilityFee}
            formulaValue={
              isUtilityFee
                ? utilityFormulaFigureFor(row, marketUtility)
                : undefined
            }
            label={label}
            inputStyle={{ ...inputStyle, fontSize: 10, minWidth: 0 }}
            subColor={C.textSecondary}
            disabled={saving}
          />
          {isLeaseRent && (
            <div
              style={{
                fontSize: 10,
                color: C.textSecondary,
                marginTop: 3,
                lineHeight: 1.4,
              }}
            >
              Lease rent, before charges — this column shows it net of charges,
              so the figure here and the figure above it can differ.
            </div>
          )}
        </>
      );
    }
    return (
      <input
        type={
          spec.type === "date"
            ? "date"
            : spec.type === "number"
              ? "number"
              : "text"
        }
        value={value}
        disabled={saving}
        placeholder={current === "—" ? "" : current}
        onChange={(e) => set(column.key, e.target.value)}
        style={inputStyle}
        aria-label={label}
      />
    );
  };

  return (
    <tr
      style={{ borderBottom: `1px solid ${C.border}`, background: C.subtleBg }}
    >
      {(columns || []).map((column) => {
        const spec = specs[column.key];
        const error = errors[column.key];
        return (
          <td key={column.key} style={cellStyle}>
            {spec ? (
              editorFor(column)
            ) : (
              <span style={{ fontSize: 11, color: C.textSecondary }}>
                {readOnlyText(column, row)}
              </span>
            )}
            {error ? (
              <div
                style={{
                  fontSize: 10,
                  color: dangerColor,
                  marginTop: 3,
                  lineHeight: 1.35,
                }}
              >
                {error}
              </div>
            ) : null}
          </td>
        );
      })}
      <td style={{ ...cellStyle, textAlign: "right", whiteSpace: "nowrap" }}>
        <EditNoteField
          compact
          value={note}
          onChange={(v) => {
            setNote(v);
            setErrors((e) => (e._note == null ? e : { ...e, _note: null }));
          }}
          disabled={saving}
          showError={errors._note != null}
          label={null}
          placeholder="Note (required): why is this changing?"
          C={{ ...C, red: dangerColor }}
          style={{ minWidth: 180, marginBottom: 4, textAlign: "left" }}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || noteValue == null}
          aria-disabled={saving || noteValue == null}
          style={{
            font: "inherit",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            color: "#fff",
            background: C.accent,
            border: "none",
            borderRadius: 6,
            opacity: noteValue == null ? 0.55 : 1,
            cursor: saving || noteValue == null ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            font: "inherit",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            marginLeft: 6,
            color: C.textSecondary,
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        {errors._row ? (
          <div
            style={{
              fontSize: 10,
              color: dangerColor,
              marginTop: 4,
              maxWidth: 220,
              whiteSpace: "normal",
              textAlign: "left",
            }}
          >
            {errors._row}
          </div>
        ) : null}
        {onOpenFullEditor ? (
          <div style={{ marginTop: 4 }}>
            <button
              type="button"
              onClick={onOpenFullEditor}
              style={{
                font: "inherit",
                fontSize: 10,
                padding: 0,
                color: C.textSecondary,
                background: "none",
                border: "none",
                textDecoration: "underline",
                cursor: "pointer",
                whiteSpace: "normal",
                textAlign: "right",
              }}
            >
              More options — full editor
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
