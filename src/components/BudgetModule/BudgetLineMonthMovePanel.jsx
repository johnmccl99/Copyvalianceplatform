import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EditNoteField, {
  EDIT_NOTE_REQUIRED_MESSAGE,
  isEditNoteValid,
  normalizeEditNote,
} from "../shared/EditNoteField.jsx";
import {
  describeLineMonthMoveOutcome,
  describeLineMonthMovePlan,
  lineMonthMoveFingerprint,
  lineMonthMovePatch,
  planLineMonthMove,
} from "../../lib/budgetLineMonthMove.js";
import {
  formatMonthKey,
  itemizedMonthKey,
} from "../../lib/budgetAccountCard.js";
import { formatItemizedAmountForDisplay } from "../../lib/budgetItemized.js";
import {
  fetchItemizedLinesByAccount,
  updateItemizedLinesBulk,
} from "../../lib/supabaseClient.js";

function Label({ children, C }) {
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        color: C.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {children}
    </span>
  );
}

function Note({ children, C, tone = "quiet" }) {
  const color =
    tone === "warn"
      ? "var(--ds-warning-text)"
      : tone === "danger"
        ? "var(--ds-danger-text)"
        : tone === "ok"
          ? "var(--ds-success-text)"
          : C.textSecondary;
  return (
    <div
      style={{
        fontSize: 11.5,
        color,
        lineHeight: 1.45,
        fontWeight: tone === "quiet" ? 400 : 700,
      }}
    >
      {children}
    </div>
  );
}

function predecessorText(predecessor) {
  if (!predecessor) return "—";
  return `${predecessor.id} · ${formatMonthKey(predecessor.month)} · ${formatItemizedAmountForDisplay(predecessor.amount) || "—"}`;
}

export default function BudgetLineMonthMovePanel({
  line,
  propertyCode,
  accountNumber,
  axis,
  closedMonths,
  accountLines,
  canWrite,
  C,
  onClose,
  onMoved,
  onBusyChange,
}) {
  const currentMonth = itemizedMonthKey(line && line.first_month);
  const openMonths = useMemo(
    () => [
      ...new Set(
        (axis || [])
          .map((entry) => itemizedMonthKey(entry && entry.month_end))
          .filter(
            (key) =>
              key &&
              (key === currentMonth || !(closedMonths || new Set()).has(key)),
          ),
      ),
    ],
    [axis, closedMonths, currentMonth],
  );
  const [targetMonth, setTargetMonth] = useState(
    openMonths.includes(currentMonth) ? currentMonth : openMonths[0] || "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState(null);
  const [previewPlan, setPreviewPlan] = useState(null);
  const [editNote, setEditNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const noteValid = isEditNoteValid(editNote);
  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setPreviewPlan(null);
  }, [line, accountLines]);

  const plan = useMemo(
    () =>
      planLineMonthMove({
        line,
        targetMonth,
        axis,
        closedMonths,
        accountLines,
        canWrite,
      }),
    [line, targetMonth, axis, closedMonths, accountLines, canWrite],
  );
  const shownPlan = previewPlan || plan;
  const planDescription = describeLineMonthMovePlan(shownPlan);

  const setBusyState = (next) => {
    if (!mountedRef.current) return;
    setBusy(next);
    if (onBusyChange) onBusyChange(next);
  };

  const finishAttempt = (attempt) => {
    if (!mountedRef.current || sequenceRef.current !== attempt) return;
    setBusyState(false);
  };

  const apply = async () => {
    const planToApply = shownPlan;
    if (busy || !canWrite || !planToApply.ready) return;
    const note = normalizeEditNote(editNote);
    if (!note) {
      setNoteTouched(true);
      setError(`${EDIT_NOTE_REQUIRED_MESSAGE} Nothing was written.`);
      return;
    }
    const attempt = sequenceRef.current + 1;
    sequenceRef.current = attempt;
    setBusyState(true);
    setError("");
    setOutcome(null);
    const previewFingerprint = lineMonthMoveFingerprint(planToApply);

    let response;
    try {
      response = await fetchItemizedLinesByAccount({
        propertyCode,
        accountNumber,
      });
    } catch (e) {
      if (!mountedRef.current || sequenceRef.current !== attempt) return;
      setError(
        `${e && e.message ? e.message : String(e)} Nothing was written.`,
      );
      finishAttempt(attempt);
      return;
    }
    if (!mountedRef.current || sequenceRef.current !== attempt) return;
    if (response && response.error) {
      setError(
        `${response.error.message || String(response.error)} Nothing was written.`,
      );
      finishAttempt(attempt);
      return;
    }

    const fresh = (response && response.data) || [];
    const freshLine = fresh.find((row) => row.id === line.id);
    if (!freshLine) {
      setError("This stored line is no longer stored, so nothing was written.");
      finishAttempt(attempt);
      return;
    }

    const freshPlan = planLineMonthMove({
      line: freshLine,
      targetMonth,
      axis,
      closedMonths,
      accountLines: fresh,
      canWrite,
    });
    const freshFingerprint = lineMonthMoveFingerprint(freshPlan);
    if (!freshPlan.ready || freshFingerprint !== previewFingerprint) {
      setPreviewPlan(freshPlan);
      setOutcome({
        ok: false,
        message:
          `${!freshPlan.ready ? describeLineMonthMovePlan(freshPlan).message : "What this would write changed since it was read."} ` +
          "Nothing was written. The preview below is the fresh plan; press Apply again if it still says what you mean.",
      });
      finishAttempt(attempt);
      return;
    }

    const patch = lineMonthMovePatch(freshPlan);
    if (!patch) {
      setPreviewPlan(freshPlan);
      setOutcome({
        ok: false,
        message: `${describeLineMonthMovePlan(freshPlan).message} Nothing was written.`,
      });
      finishAttempt(attempt);
      return;
    }

    let result;
    try {
      result = await updateItemizedLinesBulk([freshLine.id], patch, note);
    } catch (e) {
      result = { data: null, error: e };
    }
    if (!mountedRef.current || sequenceRef.current !== attempt) return;
    if (result && result.error) {
      setOutcome({
        ok: false,
        message: `${result.error.message || String(result.error)} Nothing was written.`,
      });
      finishAttempt(attempt);
      return;
    }

    const data = result && result.data ? result.data : {};
    setOutcome(
      describeLineMonthMoveOutcome({
        requested: data.requested ?? 1,
        updated: data.updated ?? 0,
        missing: data.missing ?? 0,
      }),
    );
    try {
      if (onMoved) await onMoved();
    } finally {
      finishAttempt(attempt);
    }
  };

  const cell = {
    padding: "4px 7px",
    borderBottom: `1px solid ${C.border}`,
    verticalAlign: "top",
  };
  const head = {
    ...cell,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: C.textSecondary,
    textAlign: "left",
  };

  return createPortal(
    <div
      onClick={() => {
        if (!busy) onClose();
      }}
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
        aria-label={`${line && line.line_description ? line.line_description : "Stored line"} · ${formatMonthKey(currentMonth) || "month move"}`}
        style={{
          background: C.cardBg,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          width: "min(860px, 96vw)",
          maxHeight: "86vh",
          overflowY: "auto",
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{ fontSize: 15, fontWeight: 800, color: C.textPrimary }}
            >
              Move one stored line
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
              {line && line.line_description
                ? line.line_description
                : "(no description)"}
            </div>
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
              {`Line ${line && line.id ? line.id : "—"} · ${formatMonthKey(currentMonth) || "no readable month"}`}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{
              background: busy ? C.border : "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: "inherit",
              color: busy ? C.textSecondary : C.textPrimary,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 220 }}>
            <Label C={C}>New month</Label>
            <select
              aria-label="New month for this line"
              value={targetMonth}
              onChange={(e) => {
                setTargetMonth(e.target.value);
                setPreviewPlan(null);
                setOutcome(null);
                setError("");
              }}
              disabled={busy}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "5px 7px",
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                fontSize: 12.5,
                background: C.inputBg,
                color: C.textPrimary,
              }}
            >
              {openMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonthKey(month)}
                  {month === currentMonth ? " · current month" : ""}
                </option>
              ))}
            </select>
          </div>
          {line && line.frequency && line.frequency !== "Monthly" && (
            <Note C={C}>
              This {line.frequency} line lands before on{" "}
              {shownPlan.landingsBefore.map(formatMonthKey).join(", ")} and
              after on {shownPlan.landingsAfter.map(formatMonthKey).join(", ")}.
            </Note>
          )}
        </div>

        <Note C={C} tone={planDescription.ready ? "ok" : "warn"}>
          {planDescription.message}
        </Note>

        <EditNoteField
          value={editNote}
          onChange={(v) => {
            setEditNote(v);
            setNoteTouched(true);
          }}
          placeholder="Why is this line moving?"
          disabled={!canWrite || busy}
          showError={noteTouched && !noteValid}
          C={C}
        />

        {shownPlan.refusals.map((refusal) => (
          <Note key={refusal.reason} C={C} tone="danger">
            {refusal.text}
          </Note>
        ))}
        {shownPlan.warnings.map((warning) => (
          <Note key={warning} C={C} tone="warn">
            {warning}
          </Note>
        ))}

        {!!shownPlan.carryImpact.length && (
          <div>
            <Note C={C}>
              This changes which row these lines carry from, not that displayed
              amounts will change.
            </Note>
            <div
              style={{
                overflowX: "auto",
                marginTop: 6,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
              }}
            >
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 11,
                  width: "100%",
                }}
              >
                <caption
                  style={{
                    textAlign: "left",
                    padding: 7,
                    color: C.textSecondary,
                  }}
                >
                  Carry-forward source changes
                </caption>
                <thead>
                  <tr>
                    {[
                      "Line id",
                      "Month",
                      "Source label",
                      "Carries from now",
                      "Would carry from",
                    ].map((heading) => (
                      <th key={heading} style={head}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownPlan.carryImpact.map((row) => (
                    <tr key={row.id}>
                      <td style={cell}>{row.id}</td>
                      <td style={cell}>{formatMonthKey(row.month)}</td>
                      <td style={{ ...cell, fontFamily: "inherit" }}>
                        {row.dataSource || "—"}
                      </td>
                      <td style={cell}>{predecessorText(row.before)}</td>
                      <td style={cell}>{predecessorText(row.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(error || outcome) && (
          <Note C={C} tone={error || !outcome.ok ? "danger" : "ok"}>
            {error || outcome.message}
          </Note>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={!canWrite || !shownPlan.ready || busy || !noteValid}
            title={!noteValid ? EDIT_NOTE_REQUIRED_MESSAGE : undefined}
            onClick={apply}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 12.5,
              fontWeight: 700,
              cursor:
                !canWrite || !shownPlan.ready || busy || !noteValid
                  ? "not-allowed"
                  : "pointer",
              background:
                !canWrite || !shownPlan.ready || busy || !noteValid
                  ? C.border
                  : C.accent,
              color:
                !canWrite || !shownPlan.ready || busy || !noteValid
                  ? C.textSecondary
                  : "#fff",
            }}
          >
            {busy ? "Applying…" : "Apply"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: busy ? C.border : "transparent",
              color: busy ? C.textSecondary : C.textPrimary,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
