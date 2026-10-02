import React, { useEffect, useMemo, useState } from "react";
import {
  fetchProperties,
  fetchEntrataRentRoll,
  fetchEntrataRentRollChargeMatrix,
  fetchLeaseAdjustments,
  insertLeaseAdjustment,
  updateLeaseAdjustment,
  deleteLeaseAdjustment,
} from "../../lib/supabaseClient.js";
import { logAction } from "../../lib/usage/usageClient.js";
import { SURFACE_KEYS, ACTION_KEYS } from "../../lib/usage/usageKeys.js";
import {
  ADJUSTMENT_TYPES,
  getAdjustmentTypeMeta,
  adjustmentTypeLabel,
  validateAdjustment,
  overlayAdjustments,
  masterLeaseGroupRentPreview,
  chargeOverrideFormRows,
  summarizeChargeOverride,
  fieldOverrideFormRows,
  summarizeFieldOverride,
  normalizeUnitKey,
} from "../../lib/rentRollAdjustments.js";
import {
  ENTERABLE_FIELDS,
  OVERRIDABLE_FIELD_MAP,
  applyFieldOverridesToRows,
} from "../../lib/rentRollFieldOverrides.js";
import { bedOptions, bedMatchMessage } from "../../lib/rentRollBedOptions.js";
import {
  MONEY_MODES,
  MONEY_MODE_ENTRATA,
  MONEY_MODE_OVERRIDE,
  MONEY_MODE_FORMULA,
  moneyModeOf,
  moneyModeLabel,
  moneyValueForMode,
  formatMoneyForCaption,
  isUtilityFormulaValue,
} from "../../lib/rentRollMoneyOverride.js";
import {
  MARKET_UTILITY_CHARGE_CODE,
  deriveChargeColumns,
  indexChargesByLease,
  normalizeChargeCode,
  previewMarketUtility,
  titleCaseChargeCode,
} from "../../lib/rentRollChargeColumns.js";
import { fetchPropertyMarketUtility } from "../../lib/rentRollMarketUtility.js";
import { RENT_PLAUSIBLE_MIN } from "../../lib/rentRollView.js";
import RentOverrideWorkbookIntake from "../RentOverrideIntake/RentOverrideWorkbookIntake.jsx";
import { SkeletonTable } from "../Skeletons/ContentSkeleton.jsx";
import { T } from "../../lib/theme.js";
import EditNoteField, {
  EDIT_NOTE_REQUIRED_MESSAGE,
  normalizeEditNote,
} from "../shared/EditNoteField.jsx";

const WRITE_ROLES = new Set(["gp", "gp_admin"]);

const OTHER_CHARGE_CODE = "__other__";

function money(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function BedPicker({
  value,
  onChange,
  rows,
  inputStyle,
  subColor,
  warnColor,
  okColor,
  label,
}) {
  const options = useMemo(() => bedOptions(rows), [rows]);
  const known = options.some((o) => o.unit_number === normalizeUnitKey(value));
  const [byHand, setByHand] = useState(
    () => !!normalizeUnitKey(value) && !known,
  );

  useEffect(() => {
    if (normalizeUnitKey(value) && !known) setByHand(true);
  }, [value, known]);

  const note = bedMatchMessage(value, rows);
  const noteColor =
    note && note.tone === "warn"
      ? warnColor
      : note && note.tone === "ok"
        ? okColor
        : subColor;

  return (
    <div>
      {options.length > 0 && !byHand ? (
        <select
          value={known ? normalizeUnitKey(value) : ""}
          onChange={(e) => {
            if (e.target.value === "__hand__") {
              setByHand(true);
              onChange("");
              return;
            }
            onChange(e.target.value);
          }}
          style={inputStyle}
          aria-label={label}
        >
          <option value="">Select a bed…</option>
          {options.map((o) => (
            <option key={o.unit_number} value={o.unit_number}>
              {o.label}
            </option>
          ))}
          <option value="__hand__">Not on this roll — type the label…</option>
        </select>
      ) : (
        <input
          type="text"
          value={value ?? ""}
          placeholder="1001-1001-A"
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
          aria-label={label}
        />
      )}
      {byHand && options.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setByHand(false);
            onChange("");
          }}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            marginTop: 3,
            fontSize: 11,
            color: subColor,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Pick a bed off this roll instead
        </button>
      )}
      {note && (
        <div
          style={{
            fontSize: 11,
            color: noteColor,
            marginTop: 3,
            lineHeight: 1.4,
          }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}

export function MoneyOverrideInput({
  value,
  onChange,
  entrataValue = undefined,
  currentValue = undefined,
  formulaEnabled = false,
  formulaValue = undefined,
  initialMode = undefined,
  label,
  inputStyle,
  subColor,
  disabled = false,
}) {
  const [mode, setMode] = useState(() => initialMode || moneyModeOf(value));

  useEffect(() => {
    if (value === undefined) return;
    setMode((cur) =>
      cur === MONEY_MODE_OVERRIDE && (value == null || value === "")
        ? cur
        : moneyModeOf(value),
    );
  }, [value]);

  const pick = (next) => {
    setMode(next);
    onChange(moneyValueForMode(next, ""), next);
  };

  const placeholder =
    currentValue === undefined
      ? "Amount ($)"
      : `Currently ${formatMoneyForCaption(currentValue)}`;

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <select
        value={mode}
        disabled={disabled}
        onChange={(e) => pick(e.target.value)}
        style={{ ...inputStyle, flex: 2, minWidth: 170 }}
        aria-label={`${label} — what this adjustment says`}
      >
        {MONEY_MODES.map((m) => (
          <option
            key={m.value}
            value={m.value}
            disabled={m.value === MONEY_MODE_FORMULA && !formulaEnabled}
            title={
              m.value === MONEY_MODE_FORMULA && !formulaEnabled
                ? "Utility Flat Fee only"
                : m.help
            }
          >
            {moneyModeLabel(m.value, { entrataValue, formulaValue })}
            {m.value === MONEY_MODE_FORMULA && !formulaEnabled
              ? " (Utility Flat Fee only)"
              : ""}
          </option>
        ))}
      </select>
      {mode === MONEY_MODE_OVERRIDE && (
        <input
          type="number"
          value={value ?? ""}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value, MONEY_MODE_OVERRIDE)}
          style={{ ...inputStyle, flex: 1, minWidth: 110 }}
          aria-label={`${label} — amount`}
        />
      )}
      {entrataValue !== undefined && (
        <span style={{ fontSize: 11, color: subColor, whiteSpace: "nowrap" }}>
          Entrata says {formatMoneyForCaption(entrataValue)}
          {mode === MONEY_MODE_ENTRATA ? " — kept" : ""}
        </span>
      )}
      {mode === MONEY_MODE_FORMULA &&
        formulaEnabled &&
        formulaValue === undefined && (
          <span style={{ fontSize: 11, color: subColor, whiteSpace: "nowrap" }}>
            Formula result unknown here — the roll decides.
          </span>
        )}
    </div>
  );
}

function blankPayload(type) {
  const meta = getAdjustmentTypeMeta(type);
  const p = {};
  if (!meta) return p;
  for (const f of meta.fields) {
    if (f.type === "lease_id_list") p[f.name] = [];
    else if (f.type === "charge_override_list")
      p[f.name] = [{ charge_code: "", amount: "" }];
    else if (f.type === "field_override_list")
      p[f.name] = [{ field: "", value: null }];
    else p[f.name] = "";
  }
  return p;
}

export function AdjustmentsIntro({ C = {} }) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  return (
    <div style={{ marginBottom: 16 }}>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: text,
          margin: "0 0 4px",
        }}
      >
        Rent Roll Adjustments
      </h2>
      <p style={{ fontSize: 13, color: sub, lineHeight: 1.6, margin: 0 }}>
        Record the rent-roll nuance Entrata can't track on its own —
        rent-controlled month-to-month tenants treated as occupied, master-lease
        groups, and off-Entrata third-party-managed leases. Entrata stays the
        default for every other lease; these overrides apply only where you set
        them. Each adjustment is org-scoped, audited, and signed off by your
        Director of Asset Management.
      </p>
    </div>
  );
}

export function RentRollAdjustmentsInner({
  propertyId,
  propertyEntrataId = null,
  propertyName = null,
  C = {},
  userProfile,
  showOverlayPreview = true,
  newAdjustmentSeed = null,
  onAdjustmentsChanged = null,
  reloadToken = 0,
} = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const accent = C.accent || T.accent;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;

  const canEdit =
    !!userProfile &&
    (userProfile.is_admin === true || WRITE_ROLES.has(userProfile.role));

  const [baseRows, setBaseRows] = useState(null);
  const [adjustments, setAdjustments] = useState(null);
  const [chargeRows, setChargeRows] = useState(null);
  const [marketUtility, setMarketUtility] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(null);
  const [formType, setFormType] = useState(ADJUSTMENT_TYPES[0].key);
  const [formLeaseId, setFormLeaseId] = useState("");
  const [formPayload, setFormPayload] = useState(() =>
    blankPayload(ADJUSTMENT_TYPES[0].key),
  );
  const [formNote, setFormNote] = useState("");
  const [formSignedBy, setFormSignedBy] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const reload = React.useCallback(async (id) => {
    if (!id) {
      setBaseRows(null);
      setAdjustments(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [rows, adj, charges, market] = await Promise.all([
        fetchEntrataRentRoll(id),
        fetchLeaseAdjustments(id),
        fetchEntrataRentRollChargeMatrix(id).catch(() => []),
        fetchPropertyMarketUtility(id).catch(() => null),
      ]);
      setBaseRows(rows || []);
      setAdjustments(adj || []);
      setChargeRows(charges || []);
      setMarketUtility(market == null ? null : market);
    } catch (e) {
      setError(e?.message || "Failed to load the rent roll.");
      setBaseRows([]);
      setAdjustments([]);
      setChargeRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload(propertyId);
  }, [propertyId, reload, reloadToken]);
  useEffect(() => {
    setEditing(null);
    setFormErrors({});
  }, [propertyId]);

  const overlay = useMemo(() => {
    const out = overlayAdjustments(baseRows || [], adjustments || []);
    return { ...out, rows: applyFieldOverridesToRows(out.rows) };
  }, [baseRows, adjustments]);

  const leaseOptions = useMemo(
    () =>
      (baseRows || []).map((r) => ({
        lease_id: r.lease_id,
        label: `${r.unit_number || "—"} · ${r.tenant_name || "—"} (lease ${r.lease_id})`,
      })),
    [baseRows],
  );

  const groupRentPreview = useMemo(
    () =>
      getAdjustmentTypeMeta(formType)?.fields.some(
        (f) => f.preview === "master_lease_group_rent",
      )
        ? masterLeaseGroupRentPreview(
            formPayload,
            (baseRows || []).map((r) => r.lease_id),
          )
        : null,
    [formType, formPayload, baseRows],
  );

  const chargeCodeOptions = useMemo(() => {
    const cols = deriveChargeColumns(
      chargeRows || [],
      (baseRows || []).length || 1,
    );
    return cols.map((c) => ({
      code: c.code,
      label: c.label || titleCaseChargeCode(c.code),
    }));
  }, [chargeRows, baseRows]);

  const chargeIndex = useMemo(
    () => indexChargesByLease(chargeRows || [], { recurringOnly: true }),
    [chargeRows],
  );

  const entrataBedRow = useMemo(() => {
    const key = normalizeUnitKey(formPayload.unit_number);
    if (!key || !Array.isArray(baseRows)) return undefined;
    return (baseRows || []).find(
      (r) => normalizeUnitKey(r.unit_number) === key,
    );
  }, [formPayload.unit_number, baseRows]);

  const entrataLeaseRow = useMemo(() => {
    if (formLeaseId === "" || !Array.isArray(baseRows)) return undefined;
    return (baseRows || []).find(
      (r) => String(r.lease_id) === String(formLeaseId),
    );
  }, [formLeaseId, baseRows]);

  const entrataFigureForField = (f) => {
    if (!f.entrataFrom) return undefined;
    const row = f.entrataKey === "lease_id" ? entrataLeaseRow : entrataBedRow;
    if (!row) return undefined;
    return row[f.entrataFrom] ?? null;
  };

  const entrataFigureForRowField = (fieldKey) => {
    const meta = OVERRIDABLE_FIELD_MAP[fieldKey];
    if (!meta || !entrataBedRow) return undefined;
    return Object.prototype.hasOwnProperty.call(entrataBedRow, meta.key)
      ? (entrataBedRow[meta.key] ?? null)
      : undefined;
  };

  const entrataChargeAmount = (code) => {
    const normalized = normalizeChargeCode(code);
    if (!normalized || !entrataBedRow || !chargeRows) return undefined;
    if (entrataBedRow.lease_id == null) return null;
    const byCode = chargeIndex.get(String(entrataBedRow.lease_id));
    const amount = byCode ? byCode.get(normalized) : undefined;
    return amount == null ? null : amount;
  };

  const utilityFormulaFigure = (code) => {
    if (normalizeChargeCode(code) !== MARKET_UTILITY_CHARGE_CODE)
      return undefined;
    const billed = entrataChargeAmount(code);
    if (billed === undefined || marketUtility == null) return undefined;
    return previewMarketUtility({
      billed,
      rent: entrataBedRow ? entrataBedRow.rent : null,
      marketUtility,
      plausibleMin: RENT_PLAUSIBLE_MIN,
    });
  };

  const resetForm = (type = ADJUSTMENT_TYPES[0].key) => {
    setFormType(type);
    setFormLeaseId("");
    setFormPayload(blankPayload(type));
    setFormNote("");
    setFormSignedBy("");
    setFormErrors({});
  };

  const startNew = () => {
    resetForm();
    setEditing("new");
  };

  const startEdit = (adj) => {
    setEditing(adj.id);
    setFormType(adj.adjustment_type);
    setFormLeaseId(adj.lease_id == null ? "" : String(adj.lease_id));
    const payload = {
      ...blankPayload(adj.adjustment_type),
      ...(adj.payload || {}),
    };
    if (adj.adjustment_type === "charge_override") {
      payload.charges = chargeOverrideFormRows(adj.payload || {});
    }
    if (adj.adjustment_type === "field_override") {
      payload.fields = fieldOverrideFormRows(adj.payload || {});
    }
    setFormPayload(payload);
    setFormNote(adj.note || "");
    setFormSignedBy(adj.signed_off_by || "");
    setFormErrors({});
  };

  const cancelEdit = () => {
    setEditing(null);
    setFormErrors({});
  };

  const announceChange = React.useCallback(() => {
    if (typeof onAdjustmentsChanged === "function") onAdjustmentsChanged();
  }, [onAdjustmentsChanged]);

  const seedToken = newAdjustmentSeed ? newAdjustmentSeed.token : null;
  const seedLeaseId = newAdjustmentSeed ? newAdjustmentSeed.leaseId : null;
  const seedAdjustmentId =
    newAdjustmentSeed && newAdjustmentSeed.adjustmentId != null
      ? newAdjustmentSeed.adjustmentId
      : null;
  const [pendingEditId, setPendingEditId] = useState(null);
  useEffect(() => {
    if (seedToken == null || !canEdit) return;
    if (seedAdjustmentId != null) {
      setPendingEditId(seedAdjustmentId);
      return;
    }
    setPendingEditId(null);
    resetForm();
    setFormLeaseId(seedLeaseId == null ? "" : String(seedLeaseId));
    setEditing("new");
  }, [seedToken]);

  useEffect(() => {
    if (pendingEditId == null) return;
    const adj = (adjustments || []).find(
      (a) => String(a.id) === String(pendingEditId),
    );
    if (!adj) return;
    setPendingEditId(null);
    startEdit(adj);
  }, [pendingEditId, adjustments]);

  const onTypeChange = (type) => {
    setFormType(type);
    setFormPayload(blankPayload(type));
    setFormLeaseId("");
    setFormErrors({});
  };

  const setField = (name, value) =>
    setFormPayload((p) => ({ ...p, [name]: value }));

  const setChargeRow = (name, i, patch) =>
    setFormPayload((p) => {
      const cur = Array.isArray(p[name]) ? p[name] : [];
      return {
        ...p,
        [name]: cur.map((row, j) => (j === i ? { ...row, ...patch } : row)),
      };
    });

  const addChargeRow = (name) =>
    setFormPayload((p) => {
      const cur = Array.isArray(p[name]) ? p[name] : [];
      return { ...p, [name]: cur.concat({ charge_code: "", amount: "" }) };
    });

  const removeChargeRow = (name, i) =>
    setFormPayload((p) => {
      const cur = Array.isArray(p[name]) ? p[name] : [];
      const next = cur.filter((_, j) => j !== i);
      return {
        ...p,
        [name]: next.length > 0 ? next : [{ charge_code: "", amount: "" }],
      };
    });

  const setFieldRow = (name, i, patch) =>
    setFormPayload((p) => {
      const cur = Array.isArray(p[name]) ? p[name] : [];
      return {
        ...p,
        [name]: cur.map((row, j) => (j === i ? { ...row, ...patch } : row)),
      };
    });

  const addFieldRow = (name) =>
    setFormPayload((p) => {
      const cur = Array.isArray(p[name]) ? p[name] : [];
      return { ...p, [name]: cur.concat({ field: "", value: null }) };
    });

  const removeFieldRow = (name, i) =>
    setFormPayload((p) => {
      const cur = Array.isArray(p[name]) ? p[name] : [];
      const next = cur.filter((_, j) => j !== i);
      return {
        ...p,
        [name]: next.length > 0 ? next : [{ field: "", value: null }],
      };
    });

  const toggleMember = (name, leaseId) =>
    setFormPayload((p) => {
      const cur = Array.isArray(p[name]) ? p[name] : [];
      const exists = cur.some((x) => String(x) === String(leaseId));
      const next = exists
        ? cur.filter((x) => String(x) !== String(leaseId))
        : cur.concat(leaseId);
      return { ...p, [name]: next };
    });

  const onSave = async () => {
    const meta = getAdjustmentTypeMeta(formType);
    const leaseIdNum = formLeaseId === "" ? null : Number(formLeaseId);
    const payload = { ...formPayload };
    for (const f of meta.fields) {
      if (
        f.type === "number" &&
        payload[f.name] !== "" &&
        payload[f.name] != null
      ) {
        payload[f.name] = Number(payload[f.name]);
      }
      if (f.type === "lease_id_list" && Array.isArray(payload[f.name])) {
        payload[f.name] = payload[f.name].map((x) => Number(x));
      }
      if (f.type === "charge_override_list" && Array.isArray(payload[f.name])) {
        payload[f.name] = payload[f.name]
          .filter(
            (row) =>
              row &&
              (String(row.charge_code || "").trim() !== "" ||
                (row.amount !== "" && row.amount != null)),
          )
          .map((row) => ({
            charge_code: String(row.charge_code || "").trim(),
            amount:
              row.amount === "" ||
              row.amount == null ||
              isUtilityFormulaValue(row.amount)
                ? row.amount
                : Number(row.amount),
          }));
      }
      if (f.type === "field_override_list" && Array.isArray(payload[f.name])) {
        payload[f.name] = payload[f.name]
          .filter(
            (row) =>
              row &&
              (String(row.field || "").trim() !== "" ||
                String(row.value || "") !== ""),
          )
          .map((row) => {
            const key = String(row.field || "").trim();
            const fieldMeta = OVERRIDABLE_FIELD_MAP[key];
            if (fieldMeta && fieldMeta.type === "money") {
              const raw = row.value;
              const blank = raw == null || String(raw).trim() === "";
              return { field: key, value: blank ? "" : Number(raw) };
            }
            return {
              field: key,
              value: row.value == null ? "" : String(row.value),
            };
          });
      }
    }
    if (formType === "charge_override") {
      delete payload.charge_code;
      delete payload.amount;
    }
    const { ok, errors } = validateAdjustment(formType, payload, {
      leaseId: leaseIdNum,
    });
    const noteValue = normalizeEditNote(formNote);
    if (noteValue == null) errors._note = EDIT_NOTE_REQUIRED_MESSAGE;
    if (!ok || noteValue == null) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const signed_off_by = formSignedBy.trim() || null;
      const fields = {
        adjustment_type: meta.writesAs || formType,
        lease_id: meta.requiresLeaseId ? leaseIdNum : null,
        payload,
        note: noteValue,
        signed_off_by,
        signed_off_at: signed_off_by ? new Date().toISOString() : null,
      };
      if (editing === "new") {
        await insertLeaseAdjustment(propertyId, fields);
        logAction(
          SURFACE_KEYS.RENT_ROLL_ADJUSTMENTS,
          ACTION_KEYS.APPLY_ADJUSTMENT,
          { propertyId },
        );
      } else {
        await updateLeaseAdjustment(editing, fields);
        logAction(
          SURFACE_KEYS.RENT_ROLL_ADJUSTMENTS,
          ACTION_KEYS.EDIT_ADJUSTMENT,
          { propertyId },
        );
      }
      setEditing(null);
      await reload(propertyId);
      announceChange();
    } catch (e) {
      setError(e?.message || "Save failed. Your change was not applied.");
    } finally {
      setSaving(false);
    }
  };

  const onWorkbookApplyComplete = React.useCallback(
    async ({ overridesApplied }) => {
      logAction(
        SURFACE_KEYS.RENT_ROLL_ADJUSTMENTS,
        ACTION_KEYS.APPLY_ADJUSTMENT,
        {
          propertyId,
          propertyName,
          entrataPropertyId: propertyEntrataId,
          overridesApplied,
        },
      );
      await reload(propertyId);
      announceChange();
    },
    [propertyId, propertyName, propertyEntrataId, reload, announceChange],
  );

  const onToggleActive = async (adj) => {
    setError(null);
    try {
      await updateLeaseAdjustment(adj.id, { is_active: !adj.is_active });
      await reload(propertyId);
      announceChange();
    } catch (e) {
      setError(e?.message || "Could not change the adjustment's active state.");
    }
  };

  const onDelete = async (adj) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this adjustment? This cannot be undone.")
    )
      return;
    setError(null);
    try {
      await deleteLeaseAdjustment(adj.id);
      logAction(
        SURFACE_KEYS.RENT_ROLL_ADJUSTMENTS,
        ACTION_KEYS.DELETE_ADJUSTMENT,
        { propertyId },
      );
      await reload(propertyId);
      announceChange();
    } catch (e) {
      setError(e?.message || "Delete failed.");
    }
  };

  const boxStyle = {
    border: `1px solid ${border}`,
    borderRadius: 10,
    background: card,
    marginBottom: 14,
    overflow: "hidden",
  };
  const headRow = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: `1px solid ${border}`,
    background: subtle,
  };
  const th = {
    padding: "8px 10px",
    fontWeight: 600,
    textAlign: "left",
    color: sub,
  };
  const td = { padding: "8px 10px", color: text };
  const labelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: sub,
    display: "block",
    marginBottom: 4,
  };
  const inputStyle = {
    width: "100%",
    padding: "7px 9px",
    fontSize: 13,
    border: `1px solid ${border}`,
    borderRadius: 6,
    color: text,
    background: "#fff",
    boxSizing: "border-box",
  };
  const btn = (kind) => ({
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    border: `1px solid ${kind === "primary" ? accent : border}`,
    background: kind === "primary" ? accent : "#fff",
    color: kind === "primary" ? "#fff" : kind === "danger" ? red : accent,
  });
  const badge = (color, bg) => ({
    fontSize: 10,
    fontWeight: 700,
    color,
    background: bg,
    borderRadius: 4,
    padding: "2px 6px",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  });

  return (
    <>
      {!canEdit && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: "var(--ds-warning-bg)",
            border:
              "1px solid color-mix(in srgb, var(--ds-warning-dot) 45.1%, transparent)",
            borderRadius: 8,
            color: "var(--ds-warning-text)",
            fontSize: 13,
          }}
        >
          You have read-only access to rent-roll adjustments. Creating or
          editing an adjustment requires an asset-management or admin role; the
          controls below are hidden for your role. (Server-side RLS enforces
          this regardless of the UI.)
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: "var(--ds-danger-bg)",
            border:
              "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
            borderRadius: 8,
            color: "var(--ds-danger-text)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {!propertyId ? null : (
        <>
          <div style={boxStyle}>
            <div style={headRow}>
              <div style={{ fontSize: 13, fontWeight: 700, color: text }}>
                Adjustments{" "}
                {!loading && adjustments && adjustments.length > 0
                  ? `(${adjustments.length})`
                  : ""}
              </div>
              {canEdit && editing == null && (
                <button type="button" style={btn("primary")} onClick={startNew}>
                  Add adjustment
                </button>
              )}
            </div>

            {canEdit && editing != null && (
              <div
                style={{
                  padding: "14px",
                  borderBottom: `1px solid ${border}`,
                  background: "var(--ds-inset)",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: text,
                    marginBottom: 10,
                  }}
                >
                  {editing === "new" ? "New adjustment" : "Edit adjustment"}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select
                      value={formType}
                      onChange={(e) => onTypeChange(e.target.value)}
                      style={inputStyle}
                      disabled={editing !== "new"}
                    >
                      {ADJUSTMENT_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {getAdjustmentTypeMeta(formType)?.requiresLeaseId && (
                    <div>
                      <label style={labelStyle}>Lease</label>
                      <select
                        value={formLeaseId}
                        onChange={(e) => setFormLeaseId(e.target.value)}
                        style={inputStyle}
                      >
                        <option value="">Select a lease…</option>
                        {leaseOptions.map((o) => (
                          <option key={o.lease_id} value={o.lease_id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {formErrors._leaseId && (
                        <div style={{ color: red, fontSize: 11, marginTop: 3 }}>
                          {formErrors._leaseId}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: sub,
                    lineHeight: 1.5,
                    margin: "10px 0",
                  }}
                >
                  {getAdjustmentTypeMeta(formType)?.description}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  {getAdjustmentTypeMeta(formType)?.fields.map((f) => (
                    <div
                      key={f.name}
                      style={
                        f.type === "lease_id_list" || f.fullWidth
                          ? { gridColumn: "1 / -1" }
                          : undefined
                      }
                    >
                      <label style={labelStyle}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </label>
                      {f.type === "lease_id_list" ? (
                        <div
                          style={{
                            border: `1px solid ${border}`,
                            borderRadius: 6,
                            padding: 8,
                            maxHeight: 160,
                            overflowY: "auto",
                          }}
                        >
                          {leaseOptions.length === 0 ? (
                            <div style={{ fontSize: 12, color: sub }}>
                              No leases on this roll to group.
                            </div>
                          ) : (
                            leaseOptions.map((o) => {
                              const checked = (formPayload[f.name] || []).some(
                                (x) => String(x) === String(o.lease_id),
                              );
                              return (
                                <label
                                  key={o.lease_id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    fontSize: 12,
                                    color: text,
                                    padding: "2px 0",
                                    cursor: "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      toggleMember(f.name, o.lease_id)
                                    }
                                  />
                                  {o.label}
                                </label>
                              );
                            })
                          )}
                        </div>
                      ) : f.type === "charge_override_list" ? (
                        <div
                          style={{
                            border: `1px solid ${border}`,
                            borderRadius: 6,
                            padding: 8,
                          }}
                        >
                          {(Array.isArray(formPayload[f.name])
                            ? formPayload[f.name]
                            : []
                          ).map((row, i) => {
                            const code = normalizeChargeCode(row.charge_code);
                            const known =
                              code != null &&
                              chargeCodeOptions.some((o) => o.code === code);
                            const rowError =
                              formErrors.charges_rows &&
                              formErrors.charges_rows[i];
                            const picker =
                              chargeCodeOptions.length > 0 &&
                              !row.custom &&
                              (known || !row.charge_code);
                            return (
                              <div key={i} style={{ marginBottom: 6 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                  }}
                                >
                                  {picker ? (
                                    <select
                                      value={known ? code : ""}
                                      onChange={(e) =>
                                        setChargeRow(
                                          f.name,
                                          i,
                                          e.target.value === OTHER_CHARGE_CODE
                                            ? { charge_code: "", custom: true }
                                            : {
                                                charge_code: e.target.value,
                                                custom: false,
                                              },
                                        )
                                      }
                                      style={{ ...inputStyle, flex: 2 }}
                                      aria-label={`Charge column, row ${i + 1}`}
                                    >
                                      <option value="">
                                        Select a charge column…
                                      </option>
                                      {chargeCodeOptions.map((o) => (
                                        <option key={o.code} value={o.code}>
                                          {o.label}
                                        </option>
                                      ))}
                                      <option value={OTHER_CHARGE_CODE}>
                                        Another charge column…
                                      </option>
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      value={row.charge_code ?? ""}
                                      placeholder="parking rent"
                                      onChange={(e) =>
                                        setChargeRow(f.name, i, {
                                          charge_code: e.target.value,
                                        })
                                      }
                                      style={{ ...inputStyle, flex: 2 }}
                                      aria-label={`Charge column, row ${i + 1}`}
                                    />
                                  )}
                                  <div style={{ flex: 3 }}>
                                    <MoneyOverrideInput
                                      value={row.amount ?? ""}
                                      onChange={(next) =>
                                        setChargeRow(f.name, i, {
                                          amount: next,
                                        })
                                      }
                                      entrataValue={entrataChargeAmount(
                                        row.charge_code,
                                      )}
                                      currentValue={entrataChargeAmount(
                                        row.charge_code,
                                      )}
                                      formulaEnabled={
                                        normalizeChargeCode(row.charge_code) ===
                                        MARKET_UTILITY_CHARGE_CODE
                                      }
                                      formulaValue={utilityFormulaFigure(
                                        row.charge_code,
                                      )}
                                      label={`Amount for row ${i + 1}`}
                                      inputStyle={inputStyle}
                                      subColor={sub}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    style={btn()}
                                    onClick={() => removeChargeRow(f.name, i)}
                                  >
                                    Remove
                                  </button>
                                </div>
                                {rowError && (
                                  <div
                                    style={{
                                      color: red,
                                      fontSize: 11,
                                      marginTop: 3,
                                    }}
                                  >
                                    {rowError}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            style={btn()}
                            onClick={() => addChargeRow(f.name)}
                          >
                            Add another charge column
                          </button>
                          {chargeCodeOptions.length === 0 && (
                            <div
                              style={{ fontSize: 11, color: sub, marginTop: 6 }}
                            >
                              No charge codes were read for this property, so
                              the code is typed. It is matched on the roll's own
                              normalization (case and spacing), and a code the
                              property bills nobody earns a column of its own.
                            </div>
                          )}
                        </div>
                      ) : f.type === "field_override_list" ? (
                        <div
                          style={{
                            border: `1px solid ${border}`,
                            borderRadius: 6,
                            padding: 8,
                          }}
                        >
                          {(Array.isArray(formPayload[f.name])
                            ? formPayload[f.name]
                            : []
                          ).map((row, i) => {
                            const rowError =
                              formErrors.fields_rows &&
                              formErrors.fields_rows[i];
                            const chosen =
                              OVERRIDABLE_FIELD_MAP[row.field] || null;
                            const fieldOptions =
                              chosen && !ENTERABLE_FIELDS.includes(chosen)
                                ? [...ENTERABLE_FIELDS, chosen]
                                : ENTERABLE_FIELDS;
                            return (
                              <div key={i} style={{ marginBottom: 6 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                  }}
                                >
                                  <select
                                    value={row.field ?? ""}
                                    onChange={(e) =>
                                      setFieldRow(f.name, i, {
                                        field: e.target.value,
                                      })
                                    }
                                    style={{ ...inputStyle, flex: 1 }}
                                    aria-label={`Column, row ${i + 1}`}
                                  >
                                    <option value="">Select a column…</option>
                                    {fieldOptions.map((o) => (
                                      <option key={o.key} value={o.key}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                  {chosen && chosen.type === "money" ? (
                                    <div style={{ flex: 2 }}>
                                      <MoneyOverrideInput
                                        value={row.value ?? ""}
                                        onChange={(next) =>
                                          setFieldRow(f.name, i, {
                                            value: next,
                                          })
                                        }
                                        entrataValue={entrataFigureForRowField(
                                          row.field,
                                        )}
                                        currentValue={entrataFigureForRowField(
                                          row.field,
                                        )}
                                        label={`Value for row ${i + 1}`}
                                        inputStyle={inputStyle}
                                        subColor={sub}
                                      />
                                    </div>
                                  ) : chosen && chosen.type === "date" ? (
                                    <div
                                      style={{
                                        flex: 2,
                                        display: "flex",
                                        gap: 6,
                                        alignItems: "center",
                                      }}
                                    >
                                      <input
                                        type="date"
                                        value={row.value ?? ""}
                                        disabled={
                                          chosen.allowsEmpty && row.value === ""
                                        }
                                        onChange={(e) =>
                                          setFieldRow(f.name, i, {
                                            value: e.target.value,
                                          })
                                        }
                                        style={{ ...inputStyle, flex: 1 }}
                                        aria-label={`Value for row ${i + 1}`}
                                      />
                                      {chosen.allowsEmpty ? (
                                        <label
                                          style={{
                                            fontSize: 11,
                                            color: sub,
                                            display: "flex",
                                            gap: 4,
                                            alignItems: "center",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={row.value === ""}
                                            onChange={(e) =>
                                              setFieldRow(f.name, i, {
                                                value: e.target.checked
                                                  ? ""
                                                  : null,
                                              })
                                            }
                                          />
                                          No end date
                                        </label>
                                      ) : null}
                                    </div>
                                  ) : chosen && chosen.type === "number" ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={row.value ?? ""}
                                      placeholder="Square feet"
                                      onChange={(e) =>
                                        setFieldRow(f.name, i, {
                                          value: e.target.value,
                                        })
                                      }
                                      style={{ ...inputStyle, flex: 2 }}
                                      aria-label={`Value for row ${i + 1}`}
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      value={row.value ?? ""}
                                      placeholder="Value to show"
                                      onChange={(e) =>
                                        setFieldRow(f.name, i, {
                                          value: e.target.value,
                                        })
                                      }
                                      style={{ ...inputStyle, flex: 2 }}
                                      aria-label={`Value for row ${i + 1}`}
                                    />
                                  )}
                                  <button
                                    type="button"
                                    style={btn()}
                                    onClick={() => removeFieldRow(f.name, i)}
                                  >
                                    Remove
                                  </button>
                                </div>
                                {chosen && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: sub,
                                      marginTop: 3,
                                    }}
                                  >
                                    {chosen.help}
                                  </div>
                                )}
                                {rowError && (
                                  <div
                                    style={{
                                      color: red,
                                      fontSize: 11,
                                      marginTop: 3,
                                    }}
                                  >
                                    {rowError}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            style={btn()}
                            onClick={() => addFieldRow(f.name)}
                          >
                            Add another column
                          </button>
                          <div
                            style={{ fontSize: 11, color: sub, marginTop: 6 }}
                          >
                            GPR, Net Effective and Total Charges are computed
                            from the cells beside them and are not on this list.
                            Unit SF is read-only until its source of truth is
                            settled. Rent and the charge columns have their own
                            override types above.
                          </div>
                        </div>
                      ) : f.type === "workbook" ? (
                        propertyEntrataId == null ? (
                          <div
                            style={{
                              fontSize: 12.5,
                              color: red,
                              lineHeight: 1.5,
                            }}
                          >
                            This property is not mapped to an Entrata property
                            ID, so workbook upload is unavailable.
                          </div>
                        ) : (
                          <RentOverrideWorkbookIntake
                            C={C}
                            userProfile={userProfile}
                            scopePropertyId={propertyEntrataId}
                            scopePropertyName={propertyName}
                            writeAdjustmentType={
                              getAdjustmentTypeMeta(formType)?.writesAs
                            }
                            onApplyComplete={onWorkbookApplyComplete}
                          />
                        )
                      ) : f.bedPicker ? (
                        <BedPicker
                          value={formPayload[f.name] ?? ""}
                          onChange={(next) => setField(f.name, next)}
                          rows={baseRows}
                          inputStyle={inputStyle}
                          subColor={sub}
                          warnColor={red}
                          okColor={sub}
                          label={f.label}
                        />
                      ) : f.money ? (
                        <MoneyOverrideInput
                          value={formPayload[f.name] ?? ""}
                          onChange={(next) => setField(f.name, next)}
                          entrataValue={entrataFigureForField(f)}
                          currentValue={entrataFigureForField(f)}
                          label={f.label}
                          inputStyle={inputStyle}
                          subColor={sub}
                        />
                      ) : (
                        <input
                          type={
                            f.type === "number"
                              ? "number"
                              : f.type === "date"
                                ? "date"
                                : "text"
                          }
                          value={formPayload[f.name] ?? ""}
                          placeholder={f.placeholder || ""}
                          onChange={(e) => setField(f.name, e.target.value)}
                          style={inputStyle}
                        />
                      )}
                      {f.help && (
                        <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>
                          {f.help}
                        </div>
                      )}
                      {f.preview === "master_lease_group_rent" &&
                        groupRentPreview && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: "7px 9px",
                              borderRadius: 6,
                              border: `1px solid ${border}`,
                              background: subtle,
                              fontSize: 12,
                              color: text,
                              lineHeight: 1.5,
                            }}
                          >
                            {groupRentPreview.members === 0 ? (
                              "Select the member leases above to see the group total this override produces."
                            ) : (
                              <>
                                <strong>
                                  {money(groupRentPreview.perUnit)}
                                </strong>{" "}
                                per member unit × {groupRentPreview.members}
                                {groupRentPreview.members === 1
                                  ? " unit"
                                  : " units"}{" "}
                                ={" "}
                                <strong>{money(groupRentPreview.total)}</strong>{" "}
                                per month across the group. Each member lease's
                                rent becomes {money(groupRentPreview.perUnit)}.
                              </>
                            )}
                          </div>
                        )}
                      {formErrors[f.name] && (
                        <div style={{ color: red, fontSize: 11, marginTop: 3 }}>
                          {formErrors[f.name]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {!getAdjustmentTypeMeta(formType)?.entryMode && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <div>
                      <EditNoteField
                        compact
                        value={formNote}
                        onChange={(v) => {
                          setFormNote(v);
                          setFormErrors((e) =>
                            e._note == null ? e : { ...e, _note: null },
                          );
                        }}
                        disabled={saving}
                        showError={formErrors._note != null}
                        placeholder="Why this adjustment exists"
                        C={{
                          ...C,
                          red,
                          textPrimary: text,
                          textSecondary: sub,
                          border,
                        }}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>
                        Signed off by (Director of Asset Management)
                      </label>
                      <input
                        type="text"
                        value={formSignedBy}
                        onChange={(e) => setFormSignedBy(e.target.value)}
                        placeholder="Name or email"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                )}
                {formErrors._type && (
                  <div style={{ color: red, fontSize: 12, marginTop: 8 }}>
                    {formErrors._type}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  {!getAdjustmentTypeMeta(formType)?.entryMode && (
                    <button
                      type="button"
                      style={{
                        ...btn("primary"),
                        opacity: normalizeEditNote(formNote) == null ? 0.55 : 1,
                      }}
                      disabled={saving || normalizeEditNote(formNote) == null}
                      onClick={onSave}
                    >
                      {saving
                        ? "Saving…"
                        : editing === "new"
                          ? "Create adjustment"
                          : "Save changes"}
                    </button>
                  )}
                  <button
                    type="button"
                    style={btn()}
                    disabled={saving}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div style={{ padding: "8px 0" }}>
                <SkeletonTable C={C} rows={8} cols={5} />
              </div>
            ) : adjustments && adjustments.length === 0 && editing == null ? (
              <div
                style={{
                  padding: 20,
                  fontSize: 13,
                  color: sub,
                  lineHeight: 1.6,
                }}
              >
                No adjustments on this property yet. The rendered roll below is
                exactly the Entrata-synced data.
                {canEdit
                  ? " Use Add adjustment to record a rent-controlled MTM override, a master-lease group, an off-Entrata lease, or workbook rent overrides."
                  : ""}
              </div>
            ) : adjustments && adjustments.length > 0 ? (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: `1px solid ${border}` }}>
                    {[
                      "Type",
                      "Lease / Unit",
                      "Summary",
                      "Signed off",
                      "State",
                      canEdit ? "Actions" : "",
                    ]
                      .filter(Boolean)
                      .map((h) => (
                        <th key={h} style={th}>
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((adj) => (
                    <tr
                      key={adj.id}
                      style={{
                        borderBottom: `1px solid ${border}`,
                        opacity: adj.is_active ? 1 : 0.55,
                      }}
                    >
                      <td style={td}>
                        {adjustmentTypeLabel(adj.adjustment_type)}
                      </td>
                      <td style={{ ...td, color: sub }}>
                        {adj.lease_id != null
                          ? `lease ${adj.lease_id}`
                          : adj.payload?.unit_number ||
                            adj.payload?.group_name ||
                            "—"}
                      </td>
                      <td style={{ ...td, color: sub }}>
                        {summarizeAdjustment(adj)}
                      </td>
                      <td style={{ ...td, color: sub }}>
                        {adj.signed_off_by || "—"}
                      </td>
                      <td style={td}>
                        <span
                          style={
                            adj.is_active
                              ? badge(green, "var(--ds-success-bg)")
                              : badge(sub, "var(--ds-inset)")
                          }
                        >
                          {adj.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      {canEdit && (
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              style={btn()}
                              onClick={() => startEdit(adj)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              style={btn()}
                              onClick={() => onToggleActive(adj)}
                            >
                              {adj.is_active ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              type="button"
                              style={btn("danger")}
                              onClick={() => onDelete(adj)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>

          {!loading && showOverlayPreview && (
            <div style={boxStyle}>
              <div style={headRow}>
                <div style={{ fontSize: 13, fontWeight: 700, color: text }}>
                  Rendered rent roll (Entrata + adjustments)
                </div>
                <div style={{ fontSize: 11, color: sub }}>
                  {overlay.summary.entrataRows} from Entrata
                  {overlay.summary.adjustedEntrataRows > 0
                    ? ` · ${overlay.summary.adjustedEntrataRows} adjusted`
                    : ""}
                  {overlay.summary.addedRows > 0
                    ? ` · ${overlay.summary.addedRows} off-Entrata`
                    : ""}
                </div>
              </div>
              {overlay.rows.length === 0 ? (
                <div
                  style={{
                    padding: 20,
                    fontSize: 13,
                    color: sub,
                    lineHeight: 1.6,
                  }}
                >
                  No rent-roll rows for this property yet. Run an Entrata sync
                  from the Connectors panel, or add an off-Entrata lease above.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${border}` }}>
                        {[
                          "Unit",
                          "Tenant",
                          "Lease End",
                          "Monthly Rent",
                          "Status",
                          "Source",
                        ].map((h) => (
                          <th key={h} style={th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {overlay.rows.map((r, i) => (
                        <tr
                          key={
                            r.lease_id != null
                              ? `l${r.lease_id}`
                              : `a${r.adjustment_id || i}`
                          }
                          style={{
                            borderBottom: `1px solid ${border}`,
                            background: r.adjusted
                              ? "var(--ds-warning-bg)"
                              : undefined,
                          }}
                        >
                          <td style={{ ...td, fontWeight: 600 }}>
                            {r.unit_number || "—"}
                            {r.group && (
                              <span
                                style={{
                                  ...badge(accent, "var(--ds-info-bg)"),
                                  marginLeft: 6,
                                }}
                                title={r.group.group_name}
                              >
                                Group
                              </span>
                            )}
                          </td>
                          <td style={td}>{r.tenant_name || "—"}</td>
                          <td style={{ ...td, color: sub }}>
                            {r.lease_end || "—"}
                          </td>
                          <td style={td}>{money(r.effective_rent)}</td>
                          <td style={{ ...td, color: sub }}>
                            {r.effective_status || "—"}
                            {r.adjusted && r.source === "entrata" && (
                              <span
                                style={{
                                  ...badge(
                                    "var(--ds-warning-text)",
                                    "var(--ds-warning-bg)",
                                  ),
                                  marginLeft: 6,
                                }}
                              >
                                Adjusted
                              </span>
                            )}
                          </td>
                          <td style={td}>
                            {r.source === "adjustment" ? (
                              <span
                                style={badge(
                                  "var(--ds-warning-text)",
                                  "var(--ds-warning-bg)",
                                )}
                              >
                                Off-Entrata
                              </span>
                            ) : (
                              <span style={badge(sub, "var(--ds-inset)")}>
                                Entrata
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {overlay.summary.skippedUnknownTypes > 0 && (
                <div
                  style={{
                    padding: "8px 14px",
                    fontSize: 11,
                    color: sub,
                    borderTop: `1px solid ${border}`,
                  }}
                >
                  {overlay.summary.skippedUnknownTypes} adjustment(s) of an
                  unrecognized type were not applied. Update the app to render
                  them.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function RentRollAdjustmentsPage({ C = {}, userProfile } = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;

  const [properties, setProperties] = useState(null);
  const [propsErr, setPropsErr] = useState(null);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchProperties();
        if (cancelled) return;
        const mapped = (all || []).filter((p) => p.entrataPropertyId);
        setProperties(mapped);
      } catch (e) {
        if (!cancelled) setPropsErr(e?.message || "Failed to load properties.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const labelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: sub,
    display: "block",
    marginBottom: 4,
  };
  const inputStyle = {
    width: "100%",
    padding: "7px 9px",
    fontSize: 13,
    border: `1px solid ${border}`,
    borderRadius: 6,
    color: text,
    background: "#fff",
    boxSizing: "border-box",
  };
  const boxStyle = {
    border: `1px solid ${border}`,
    borderRadius: 10,
    background: card,
    marginBottom: 14,
    overflow: "hidden",
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "8px 4px" }}>
      <AdjustmentsIntro C={C} />

      {propsErr && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: "var(--ds-danger-bg)",
            border:
              "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
            borderRadius: 8,
            color: "var(--ds-danger-text)",
            fontSize: 13,
          }}
        >
          {propsErr}
        </div>
      )}

      <div style={boxStyle}>
        <div style={{ padding: "12px 14px" }}>
          <label style={labelStyle} htmlFor="rra-property">
            Property
          </label>
          {properties == null ? (
            <div style={{ fontSize: 13, color: sub }}>Loading properties…</div>
          ) : properties.length === 0 ? (
            <div style={{ fontSize: 13, color: sub, lineHeight: 1.6 }}>
              No Entrata-mapped properties found. Map a property to its Entrata
              Property ID in Property Settings, run an Entrata sync, then return
              here to layer adjustments on its rent roll.
            </div>
          ) : (
            <select
              id="rra-property"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ ...inputStyle, maxWidth: 420 }}
            >
              <option value="">Select a property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {selectedId && (
        <RentRollAdjustmentsInner
          propertyId={selectedId}
          propertyEntrataId={
            properties?.find((p) => String(p.id) === String(selectedId))
              ?.entrataPropertyId
          }
          propertyName={
            properties?.find((p) => String(p.id) === String(selectedId))?.name
          }
          C={C}
          userProfile={userProfile}
        />
      )}
    </div>
  );
}

function summarizeAdjustment(adj) {
  const p = adj.payload || {};
  switch (adj.adjustment_type) {
    case "mtm_occupied":
      return [
        "Treated as occupied",
        p.override_status ? `status "${p.override_status}"` : null,
        p.rent_override != null && p.rent_override !== ""
          ? `rent $${Number(p.rent_override).toLocaleString()}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "master_lease_group":
      return [
        `${p.group_name || "Group"} · ${Array.isArray(p.member_lease_ids) ? p.member_lease_ids.length : 0} leases`,
        p.rent_override != null && p.rent_override !== ""
          ? `rent $${Number(p.rent_override).toLocaleString()}/unit`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "off_entrata_lease":
      return [
        p.tenant_name,
        p.rent != null && p.rent !== ""
          ? `$${Number(p.rent).toLocaleString()}/mo`
          : null,
        p.managed_by,
      ]
        .filter(Boolean)
        .join(" · ");
    case "lease_rent_override":
      return [
        p.unit_number ? `Unit ${p.unit_number}` : "Bed override",
        p.rent_override != null && p.rent_override !== ""
          ? `rent $${Number(p.rent_override).toLocaleString()}/mo`
          : null,
        p.tenant_name || null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "charge_override":
      return [
        p.unit_number ? `Unit ${p.unit_number}` : "Bed override",
        summarizeChargeOverride(p),
      ]
        .filter(Boolean)
        .join(" · ");
    case "field_override":
      return [
        p.unit_number ? `Unit ${p.unit_number}` : "Bed override",
        summarizeFieldOverride(p),
      ]
        .filter(Boolean)
        .join(" · ");
    default:
      return adj.note || "—";
  }
}
