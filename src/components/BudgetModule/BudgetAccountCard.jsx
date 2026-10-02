import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import EditNoteField, {
  EDIT_NOTE_REQUIRED_MESSAGE,
  isEditNoteValid,
  normalizeEditNote,
} from "../shared/EditNoteField.jsx";
import TrackedChangeMark from "../shared/TrackedChangeMark.jsx";
import {
  buildMonthTrackedChanges,
  trackedChangesForMonth,
} from "../../lib/budgetTrackedChanges.js";
import ItemizedDerivationPanel from "./ItemizedDerivationPanel.jsx";
import ItemizedLineHistoryModal from "./ItemizedLineHistoryModal.jsx";
import BudgetLineMonthMovePanel from "./BudgetLineMonthMovePanel.jsx";
import {
  ACCOUNT_CARD_FIELDS,
  PASTE_REFUSAL_TEXT,
  buildAccountCardPatch,
  buildNewLineRow,
  closedMonthKeySet,
  describeBulkOutcome,
  describePasteOutcome,
  describePastePlan,
  formatMonthKey,
  itemizedMonthKey,
  newLineCategoryFor,
  partitionEditableLines,
  planPastedColumn,
  summarizeAccountMethods,
  summarizeBasis,
  uniformFieldValue,
} from "../../lib/budgetAccountCard.js";
import {
  FREQUENCY_VALUES,
  INCREASE_FREQUENCY_VALUES,
  formatItemizedAmountForDisplay,
  prettyItemizedCategory,
} from "../../lib/budgetItemized.js";
import { explanationForLine } from "../../lib/budgetAssumptionExplanations.js";
import {
  applyItemizedNumericBulk,
  deleteItemizedLine,
  fetchItemizedAccountVersions,
  fetchItemizedLinesByAccount,
  insertItemizedLines,
  updateItemizedLinesBulk,
} from "../../lib/supabaseClient.js";
import {
  formatBudgetCell,
  formatBudgetTotal,
} from "../../lib/budgetCellFormat.js";

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

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

function MonthStrip({
  axis,
  monthly,
  total,
  isActualByMonth,
  absentByMonth,
  basisByMonth,
  marksByMonth,
  C,
}) {
  return (
    <div
      style={{
        overflowX: "auto",
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        background: C.cardBg,
      }}
    >
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: 0,
          fontSize: 11.5,
          width: "max-content",
          minWidth: "100%",
        }}
      >
        <thead>
          <tr>
            {axis.map((m, i) => (
              <th
                key={`ms-h-${m.month_index}`}
                style={{
                  padding: "5px 10px",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: C.textSecondary,
                  background:
                    isActualByMonth && isActualByMonth[i]
                      ? C.subtleBg
                      : "transparent",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {formatMonthKey(m.month_end) || ""}
              </th>
            ))}
            <th
              style={{
                padding: "5px 10px",
                textAlign: "right",
                whiteSpace: "nowrap",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: C.textSecondary,
                borderBottom: `1px solid ${C.border}`,
                borderLeft: `1px solid ${C.border}`,
              }}
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {axis.map((m, i) => {
              const closed = !!(isActualByMonth && isActualByMonth[i]);
              const absent = !!(absentByMonth && absentByMonth[i]);
              const basis = basisByMonth
                ? basisByMonth.get(Number(m.month_index))
                : undefined;
              return (
                <td
                  key={`ms-v-${m.month_index}`}
                  title={
                    closed
                      ? "Closed month — realized in the GL. Shown here, and not editable from this card."
                      : basis
                        ? `Forward month · ${basis}`
                        : "Forward month"
                  }
                  style={{
                    padding: "6px 10px",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    fontFamily: MONO,
                    fontVariantNumeric: "tabular-nums",
                    color: closed ? C.textSecondary : C.textPrimary,
                    background: closed ? C.subtleBg : "transparent",
                  }}
                >
                  {formatBudgetCell(monthly ? monthly[i] : null, {
                    present: !absent,
                  })}
                  {(() => {
                    const changes = trackedChangesForMonth(
                      marksByMonth,
                      m.month_end,
                    );
                    return changes.length > 0 ? (
                      <TrackedChangeMark
                        changes={changes}
                        label={formatMonthKey(m.month_end) || "Month"}
                        C={C}
                      />
                    ) : null;
                  })()}
                </td>
              );
            })}
            <td
              style={{
                padding: "6px 10px",
                textAlign: "right",
                whiteSpace: "nowrap",
                fontWeight: 800,
                fontFamily: MONO,
                fontVariantNumeric: "tabular-nums",
                color: C.textPrimary,
                borderLeft: `1px solid ${C.border}`,
              }}
            >
              {total === null || total === undefined
                ? ""
                : formatBudgetTotal(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StoredLineList({
  lines,
  closedMonths,
  C,
  canWrite,
  onDelete,
  deletingId,
  onHistory,
  onMove,
  movingId,
}) {
  const [open, setOpen] = useState(false);
  const cell = {
    padding: "4px 8px",
    whiteSpace: "nowrap",
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
  };
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: 11.5,
          fontWeight: 700,
          color: C.accent,
        }}
      >
        {open ? "▾" : "▸"} {lines.length} stored line
        {lines.length === 1 ? "" : "s"}, as stored
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            maxHeight: 260,
            overflow: "auto",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
          }}
        >
          <table
            style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}
          >
            <thead>
              <tr style={{ background: C.subtleBg }}>
                {[
                  "Workbook row",
                  "Month",
                  "Source label",
                  "Description",
                  "Frequency",
                  "Amount",
                  "Line id",
                  "History",
                  "Move",
                  "Delete",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      ...cell,
                      textAlign: "left",
                      fontWeight: 700,
                      color: C.textSecondary,
                      position: "sticky",
                      top: 0,
                      background: C.subtleBg,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const key = itemizedMonthKey(l.first_month);
                const closed = key ? closedMonths.has(key) : false;
                return (
                  <tr
                    key={l.id}
                    style={{
                      borderTop: `1px solid ${C.border}`,
                      color: closed ? C.textSecondary : C.textPrimary,
                      background: closed ? C.subtleBg : "transparent",
                    }}
                  >
                    <td style={cell}>
                      {l.source_row_index == null ? "—" : l.source_row_index}
                    </td>
                    <td style={cell}>
                      {formatMonthKey(l.first_month) || l.first_month || "—"}
                    </td>
                    <td style={{ ...cell, fontFamily: "inherit" }}>
                      {String(l.data_source || "").trim() || "—"}
                    </td>
                    <td
                      style={{
                        ...cell,
                        fontFamily: "inherit",
                        whiteSpace: "normal",
                      }}
                    >
                      {l.line_description || "—"}
                    </td>
                    <td style={{ ...cell, fontFamily: "inherit" }}>
                      {l.frequency || "—"}
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      {formatItemizedAmountForDisplay(l.amount) || "—"}
                    </td>
                    <td style={{ ...cell, color: C.textSecondary }}>{l.id}</td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      {onHistory && (
                        <button
                          type="button"
                          onClick={() => onHistory(l)}
                          title="Every recorded change to this line, and the option to put a version back."
                          aria-label={`Version history for line ${l.id}`}
                          style={{
                            background: "transparent",
                            border: `1px solid ${C.border}`,
                            borderRadius: 4,
                            padding: "1px 6px",
                            fontSize: 10.5,
                            fontWeight: 700,
                            fontFamily: "inherit",
                            cursor: "pointer",
                            color: C.accent,
                          }}
                        >
                          History
                        </button>
                      )}
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      {onMove && (
                        <>
                          <button
                            type="button"
                            disabled={!!movingId}
                            onClick={() => onMove(l)}
                            title="Move this one stored line to another month."
                            aria-label={`Move line ${l.id} to another month`}
                            style={{
                              background: "transparent",
                              border: `1px solid ${C.border}`,
                              borderRadius: 4,
                              padding: "1px 6px",
                              fontSize: 10.5,
                              fontWeight: 700,
                              fontFamily: "inherit",
                              cursor: movingId ? "not-allowed" : "pointer",
                              color: movingId ? C.textSecondary : C.accent,
                            }}
                          >
                            {movingId === l.id ? "Moving…" : "Move"}
                          </button>
                        </>
                      )}
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      {onDelete && (
                        <button
                          type="button"
                          disabled={!canWrite || closed || !!deletingId}
                          onClick={() => onDelete(l)}
                          title={
                            closed
                              ? "Closed month — realized in the GL, so this line is not deletable from here."
                              : "Delete this stored line."
                          }
                          aria-label={`Delete line ${l.id}`}
                          style={{
                            background: "transparent",
                            border: `1px solid ${C.border}`,
                            borderRadius: 4,
                            padding: "1px 6px",
                            fontSize: 10.5,
                            fontWeight: 700,
                            fontFamily: "inherit",
                            cursor:
                              !canWrite || closed || deletingId
                                ? "not-allowed"
                                : "pointer",
                            color:
                              !canWrite || closed || deletingId
                                ? C.textSecondary
                                : "var(--ds-danger-text)",
                          }}
                        >
                          {deletingId === l.id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BudgetAccountCard({
  propertyCode,
  accountNumber,
  accountName,
  axis,
  monthly,
  total,
  isActualByMonth,
  absentByMonth,
  basisByMonth,
  canWrite,
  derivations,
  derivationsLoading,
  derivationsError,
  C,
  onClose,
  onSaved,
}) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [methodKey, setMethodKey] = useState(null);
  const [draft, setDraft] = useState({});
  const [windowFrom, setWindowFrom] = useState("");
  const [windowTo, setWindowTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMonth, setAddMonth] = useState("");
  const [addFields, setAddFields] = useState({});
  const [addBusy, setAddBusy] = useState(false);
  const [addErrors, setAddErrors] = useState([]);
  const [deletingId, setDeletingId] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteStart, setPasteStart] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [historyLine, setHistoryLine] = useState(null);
  const [moveLine, setMoveLine] = useState(null);
  const [moveBusyId, setMoveBusyId] = useState("");
  const [editNote, setEditNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const noteValid = isEditNoteValid(editNote);
  const [marksByMonth, setMarksByMonth] = useState(() => new Map());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadMarks = useCallback(async () => {
    const { versions, authors } = await fetchItemizedAccountVersions({
      propertyCode,
      accountNumber,
    });
    if (!mountedRef.current) return;
    setMarksByMonth(buildMonthTrackedChanges(versions, { authors }));
  }, [propertyCode, accountNumber]);

  const load = useCallback(
    async (expectedCount) => {
      setLoading(true);
      setLoadError("");
      const [{ data, error }] = await Promise.all([
        fetchItemizedLinesByAccount({ propertyCode, accountNumber }),
        loadMarks(),
      ]);
      if (!mountedRef.current) return;
      if (error) {
        setLoadError(
          error.message ||
            "The stored lines for this account could not be loaded.",
        );
        setLines([]);
        setLoading(false);
        return;
      }
      const next = data || [];
      setLines(next);
      setLoading(false);
      if (expectedCount != null && expectedCount !== next.length) {
        setOutcome({
          ok: false,
          partial: false,
          message:
            `This account should hold ${expectedCount} stored line${expectedCount === 1 ? "" : "s"} after that change, ` +
            `and it holds ${next.length}. ` +
            "That is not something this card does \u2014 check the line list below and this account\u2019s version history before trusting these figures.",
        });
      }
    },
    [propertyCode, accountNumber, loadMarks],
  );

  useEffect(() => {
    setOutcome(null);
    setDraft({});
    setEditNote("");
    setNoteTouched(false);
    setMethodKey(null);
    setWindowFrom("");
    setWindowTo("");
    setAddOpen(false);
    setAddMonth("");
    setAddFields({});
    setAddErrors([]);
    setPasteOpen(false);
    setPasteText("");
    setPasteStart("");
    setMoveLine(null);
    setMoveBusyId("");
    load(null);
  }, [load]);

  const summary = useMemo(() => summarizeAccountMethods(lines), [lines]);
  const closedMonths = useMemo(
    () => closedMonthKeySet(axis, isActualByMonth),
    [axis, isActualByMonth],
  );
  const basis = useMemo(
    () => summarizeBasis(basisByMonth, axis),
    [basisByMonth, axis],
  );

  const activeGroup = useMemo(() => {
    if (!summary.groups.length) return null;
    return summary.groups.find((g) => g.key === methodKey) || summary.groups[0];
  }, [summary.groups, methodKey]);

  const openMonths = useMemo(() => {
    if (!activeGroup) return [];
    return [
      ...new Set(activeGroup.months.filter((m) => !closedMonths.has(m))),
    ].sort();
  }, [activeGroup, closedMonths]);

  const scope = useMemo(
    () =>
      partitionEditableLines(activeGroup ? activeGroup.lines : [], {
        closedMonths,
        from: windowFrom || null,
        to: windowTo || null,
      }),
    [activeGroup, closedMonths, windowFrom, windowTo],
  );

  const current = useMemo(() => {
    const out = {};
    for (const { field } of ACCOUNT_CARD_FIELDS)
      out[field] = uniformFieldValue(scope.editable, field);
    return out;
  }, [scope.editable]);

  const openAxisMonths = useMemo(() => {
    const keys = [];
    for (const m of axis || []) {
      const k = itemizedMonthKey(m && m.month_end);
      if (k && !closedMonths.has(k)) keys.push(k);
    }
    return [...new Set(keys)].sort();
  }, [axis, closedMonths]);

  const addCategory = useMemo(
    () => newLineCategoryFor(activeGroup ? activeGroup.lines : []),
    [activeGroup],
  );

  const pastePlan = useMemo(
    () =>
      planPastedColumn(pasteText, {
        axis,
        closedMonths,
        lines: activeGroup ? activeGroup.lines : [],
        startMonth:
          pasteStart || (openAxisMonths.length ? openAxisMonths[0] : null),
      }),
    [pasteText, axis, closedMonths, activeGroup, pasteStart, openAxisMonths],
  );
  const pasteRead = useMemo(() => describePastePlan(pastePlan), [pastePlan]);

  const selectMethod = (key) => {
    setMethodKey(key);
    setDraft({});
    setWindowFrom("");
    setWindowTo("");
    setOutcome(null);
    setAddErrors([]);
    setAddFields({});
    setAddMonth("");
    setPasteText("");
  };

  const requireNote = () => {
    const note = normalizeEditNote(editNote);
    if (!note) {
      setNoteTouched(true);
      setOutcome({
        ok: false,
        partial: false,
        message: `${EDIT_NOTE_REQUIRED_MESSAGE} Nothing was written.`,
      });
    }
    return note;
  };
  const afterWrite = () => {
    setEditNote("");
    setNoteTouched(false);
  };

  const save = async () => {
    const patch = buildAccountCardPatch(draft, current);
    const fields = Object.keys(patch);
    if (fields.length === 0) {
      setOutcome({
        ok: false,
        partial: false,
        message: "No field on this card was changed, so nothing was sent.",
      });
      return;
    }
    if (scope.editable.length === 0) {
      setOutcome({
        ok: false,
        partial: false,
        message:
          "No open month in this method is inside the selected range, so there is nothing to write to.",
      });
      return;
    }
    const note = requireNote();
    if (!note) return;
    const before = lines.length;
    setSaving(true);
    setOutcome(null);
    const { data, error } = await updateItemizedLinesBulk(
      scope.editable.map((l) => l.id),
      patch,
      note,
    );
    setSaving(false);
    if (error) {
      setOutcome({
        ok: false,
        partial: false,
        message: `${error.message || "The change could not be applied."} Nothing was written.`,
      });
      return;
    }
    setOutcome(
      describeBulkOutcome({ requested: data.requested, updated: data.updated }),
    );
    setDraft({});
    afterWrite();
    await load(before);
    if (onSaved) onSaved();
  };

  const addLine = async () => {
    if (!activeGroup) return;
    if (!addCategory.ok) {
      setAddErrors([
        `This method's lines state ${addCategory.distinct} different workbook categories, ` +
          "so the card cannot tell which one a new line belongs to. Add it from the line editor instead.",
      ]);
      return;
    }
    const built = buildNewLineRow({
      month: addMonth,
      fields: addFields,
      representative: activeGroup.lines[0],
      accountNumber,
    });
    if (!built.ok) {
      setAddErrors(built.errors);
      return;
    }
    const note = requireNote();
    if (!note) {
      setAddErrors([EDIT_NOTE_REQUIRED_MESSAGE]);
      return;
    }
    setAddErrors([]);
    const before = lines.length;
    setAddBusy(true);
    setOutcome(null);
    const { data, error } = await insertItemizedLines({
      propertyCode,
      category: addCategory.category,
      rows: [built.row],
      note,
    });
    if (!mountedRef.current) return;
    setAddBusy(false);
    if (error) {
      setAddErrors([
        `${error.message || "The new line could not be stored."} Nothing was written.`,
      ]);
      return;
    }
    const added = (data || []).length;
    setOutcome({
      ok: added === 1,
      partial: false,
      message:
        added === 1
          ? `Added one line to ${activeGroup.label} for ${formatMonthKey(addMonth)}, at ${formatItemizedAmountForDisplay(built.row.amount)}. ` +
            "It lands on that month only."
          : "The insert reported no stored line. Nothing on this card should be trusted until you reload it.",
    });
    setAddFields({});
    setAddMonth("");
    setAddOpen(false);
    afterWrite();
    await load(before + added);
    if (onSaved) onSaved();
  };

  const removeLine = async (line) => {
    if (!line || !line.id) return;
    const note = requireNote();
    if (!note) return;
    const monthText =
      formatMonthKey(line.first_month) ||
      String(line.first_month || "an unread month");
    const confirmed =
      typeof window !== "undefined" && window.confirm
        ? window.confirm(
            `Delete the ${monthText} line of ${String(line.data_source || "").trim() || "this account"} ` +
              `for ${formatItemizedAmountForDisplay(line.amount) || "no amount"}? This cannot be undone, and the statement ` +
              "month above will fall by that amount.",
          )
        : false;
    if (!confirmed) return;
    const before = lines.length;
    setDeletingId(line.id);
    setOutcome(null);
    const { error } = await deleteItemizedLine(line.id, note);
    if (!mountedRef.current) return;
    setDeletingId("");
    if (error) {
      setOutcome({
        ok: false,
        partial: false,
        message: `${error.message || "The line could not be deleted."} Nothing was removed.`,
      });
      return;
    }
    afterWrite();
    setOutcome({
      ok: true,
      partial: false,
      message:
        `Deleted the ${monthText} line. This account now holds ${before - 1} stored line${before - 1 === 1 ? "" : "s"} — ` +
        "one fewer, which is what you asked for.",
    });
    await load(before - 1);
    if (onSaved) onSaved();
  };

  const afterRestore = async () => {
    await load(null);
    if (onSaved) onSaved();
  };

  const afterMove = async () => {
    const before = lines.length;
    await load(before);
    if (onSaved) onSaved();
  };

  const applyPaste = async () => {
    if (!pastePlan.changes.length) return;
    const note = requireNote();
    if (!note) return;
    const before = lines.length;
    setPasteBusy(true);
    setOutcome(null);
    const { data, error } = await applyItemizedNumericBulk(
      "amount",
      pastePlan.changes,
      note,
    );
    if (!mountedRef.current) return;
    setPasteBusy(false);
    if (error) {
      setOutcome({
        ok: false,
        partial: false,
        message: `${error.message || "The pasted amounts could not be applied."} Nothing was written.`,
      });
      return;
    }
    setOutcome(describePasteOutcome(data || {}));
    setPasteText("");
    if (Number(data?.skipped || 0) === 0 && Number(data?.missing || 0) === 0)
      afterWrite();
    await load(before);
    if (onSaved) onSaved();
  };

  const headStyle = {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  };
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "5px 7px",
    border: `1px solid ${C.border}`,
    borderRadius: 3,
    fontSize: 12.5,
    background: C.inputBg,
    color: C.textPrimary,
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
  };

  const representative =
    (activeGroup && activeGroup.lines[0]) || (lines.length ? lines[0] : null);
  const derivationMatch =
    representative && Array.isArray(derivations)
      ? explanationForLine(derivations, representative)
      : null;

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: C.cardBg,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={headStyle}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 700,
            color: C.textPrimary,
          }}
        >
          {accountNumber}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>
          {accountName || "—"}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            color: C.textSecondary,
          }}
        >
          Close card
        </button>
      </div>

      <MonthStrip
        axis={axis}
        monthly={monthly}
        total={total}
        isActualByMonth={isActualByMonth}
        absentByMonth={absentByMonth}
        basisByMonth={basisByMonth}
        marksByMonth={marksByMonth}
        C={C}
      />
      <Note C={C}>
        These are the statement row&rsquo;s own figures, not a second
        calculation of them, so the card and the row above agree to the cent.
        Shaded months are closed: realized in the GL, shown here and not
        editable.
        {marksByMonth.size > 0 &&
          " A dot beside a month is a tracked change — hover it for who, when, before → after and the note."}
        {basis.parts.length > 0 && (
          <>
            {" "}
            {basis.mixed
              ? `The months on this row do not share one basis — ${basis.parts.map((p) => `${p.months} ${p.label}`).join(", ")}.`
              : `Basis: ${basis.parts[0].label} across ${basis.parts[0].months} month${basis.parts[0].months === 1 ? "" : "s"}.`}
            {basis.unknown > 0 &&
              ` ${basis.unknown} month${basis.unknown === 1 ? " carries" : "s carry"} no recorded basis.`}
          </>
        )}
      </Note>

      {loading && <Note C={C}>Loading this account&rsquo;s stored lines…</Note>}

      {!loading && loadError && (
        <Note C={C} tone="danger">
          {loadError} The figures above are the statement&rsquo;s; nothing about
          the stored lines behind them could be read, which is not the same as
          this account having none.
        </Note>
      )}

      {!loading && !loadError && lines.length === 0 && (
        <Note C={C}>
          No itemized line is stored for this account at this property. The
          statement row above is what the substrate holds for it; there is
          nothing here to edit.
        </Note>
      )}

      {!loading && !loadError && lines.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
              alignItems: "baseline",
            }}
          >
            <div>
              <Label C={C}>Stored lines</Label>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: C.textPrimary,
                  fontFamily: MONO,
                }}
              >
                {summary.lineCount}
              </div>
            </div>
            <div>
              <Label C={C}>Workbook methods</Label>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: C.textPrimary,
                  fontFamily: MONO,
                }}
              >
                {summary.methodCount}
              </div>
            </div>
            <div>
              <Label C={C}>Months covered</Label>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: C.textPrimary,
                  fontFamily: MONO,
                }}
              >
                {summary.firstMonth
                  ? `${formatMonthKey(summary.firstMonth)} – ${formatMonthKey(summary.lastMonth)}`
                  : "—"}
              </div>
            </div>
            <div>
              <Label C={C}>Workbook block</Label>
              <div
                style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}
              >
                {prettyItemizedCategory(
                  representative ? representative.category : "",
                ) || "—"}
              </div>
            </div>
          </div>

          {summary.mixed ? (
            <Note C={C} tone="warn">
              This account is computed by {summary.methodCount} workbook
              methods, not one, so it has no single method and no single amount.
              Each method is edited on its own below; a month range spanning
              methods would have to invent a rule for splitting one amount
              across sources, and the stored lines carry no such rule.
            </Note>
          ) : (
            <Note C={C}>
              One workbook method: <b>{summary.groups[0].label}</b>. The method
              itself comes from the workbook and is read-only here.
            </Note>
          )}

          {summary.mixed && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {summary.groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => selectMethod(g.key)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight:
                      activeGroup && activeGroup.key === g.key ? 800 : 600,
                    border: `1px solid ${activeGroup && activeGroup.key === g.key ? C.accent : C.border}`,
                    background:
                      activeGroup && activeGroup.key === g.key
                        ? C.subtleBg
                        : "transparent",
                    color: C.textPrimary,
                  }}
                >
                  {g.label}
                  <span
                    style={{
                      marginLeft: 6,
                      color: C.textSecondary,
                      fontWeight: 600,
                    }}
                  >
                    {g.lineCount} line{g.lineCount === 1 ? "" : "s"}
                    {g.firstMonth
                      ? ` · ${formatMonthKey(g.firstMonth)}–${formatMonthKey(g.lastMonth)}`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          )}

          {activeGroup && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: 12,
                background: C.subtleBg,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={headStyle}>
                <Label C={C}>Editing method</Label>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.textPrimary,
                  }}
                >
                  {activeGroup.label}
                </span>
                <span style={{ fontSize: 11.5, color: C.textSecondary }}>
                  {scope.editable.length} of {activeGroup.lineCount} stored
                  lines in range
                  {scope.held.length > 0 &&
                    ` · ${scope.held.length} held back (closed months or outside the range)`}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "flex-end",
                }}
              >
                <div style={{ minWidth: 150 }}>
                  <Label C={C}>Month range from</Label>
                  <select
                    value={windowFrom}
                    onChange={(e) => setWindowFrom(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">First open month</option>
                    {openMonths.map((m) => (
                      <option key={`f-${m}`} value={m}>
                        {formatMonthKey(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ minWidth: 150 }}>
                  <Label C={C}>Month range to</Label>
                  <select
                    value={windowTo}
                    onChange={(e) => setWindowTo(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">Last open month</option>
                    {openMonths.map((m) => (
                      <option key={`t-${m}`} value={m}>
                        {formatMonthKey(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <Note C={C}>
                  The range picks which of this method&rsquo;s stored lines the
                  change reaches. It is never written to them: each line already
                  stands for its own month.
                </Note>
              </div>

              <EditNoteField
                value={editNote}
                onChange={(v) => {
                  setEditNote(v);
                  setNoteTouched(true);
                }}
                label="Note (required for every save, add, paste or delete on this card)"
                placeholder="Why is this account changing?"
                disabled={
                  !canWrite || saving || addBusy || pasteBusy || !!deletingId
                }
                showError={noteTouched && !noteValid}
                C={C}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                }}
              >
                {ACCOUNT_CARD_FIELDS.map(({ field, label, type }) => {
                  const cur = current[field];
                  const mixedField = cur && !cur.uniform;
                  const value =
                    draft[field] !== undefined
                      ? draft[field]
                      : mixedField
                        ? ""
                        : cur
                          ? cur.value
                          : "";
                  const onChange = (v) =>
                    setDraft((prev) => ({ ...prev, [field]: v }));
                  return (
                    <div
                      key={field}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        minWidth: 0,
                      }}
                    >
                      <Label C={C}>{label}</Label>
                      {type === "frequency" || type === "increaseFrequency" ? (
                        <select
                          disabled={!canWrite || saving}
                          value={value}
                          onChange={(e) => onChange(e.target.value)}
                          style={inputStyle}
                        >
                          <option value="">
                            {mixedField
                              ? `${cur.distinct} different values — leave to keep`
                              : "—"}
                          </option>
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
                      ) : (
                        <input
                          type="text"
                          disabled={!canWrite || saving}
                          value={value}
                          placeholder={
                            mixedField
                              ? `${cur.distinct} different values — leave to keep`
                              : ""
                          }
                          onChange={(e) => onChange(e.target.value)}
                          style={{
                            ...inputStyle,
                            textAlign: type === "number" ? "right" : "left",
                          }}
                        />
                      )}
                      {mixedField && (
                        <Note C={C}>
                          These lines do not share one value, so the card shows
                          none. Typing one sets it on all
                          {` ${scope.editable.length}`} lines in range.
                        </Note>
                      )}
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  disabled={
                    !canWrite ||
                    saving ||
                    scope.editable.length === 0 ||
                    !noteValid
                  }
                  title={!noteValid ? EDIT_NOTE_REQUIRED_MESSAGE : undefined}
                  onClick={save}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "none",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor:
                      !canWrite ||
                      saving ||
                      scope.editable.length === 0 ||
                      !noteValid
                        ? "not-allowed"
                        : "pointer",
                    background:
                      !canWrite ||
                      saving ||
                      scope.editable.length === 0 ||
                      !noteValid
                        ? C.border
                        : C.accent,
                    color:
                      !canWrite ||
                      saving ||
                      scope.editable.length === 0 ||
                      !noteValid
                        ? C.textSecondary
                        : "#fff",
                  }}
                >
                  {saving
                    ? "Saving…"
                    : `Save to ${scope.editable.length} stored line${scope.editable.length === 1 ? "" : "s"}`}
                </button>
                {!canWrite && (
                  <Note C={C} tone="warn">
                    Your role cannot write budget lines, so this card is
                    read-only. The server enforces that gate; the disabled
                    control is only how it reads here.
                  </Note>
                )}
                {outcome && (
                  <Note
                    C={C}
                    tone={
                      outcome.ok ? "ok" : outcome.partial ? "danger" : "warn"
                    }
                  >
                    {outcome.message}
                  </Note>
                )}
              </div>

              <div
                style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen((v) => !v);
                    setAddErrors([]);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: C.accent,
                  }}
                >
                  {addOpen ? "▾" : "▸"} Add a line to this method
                </button>
                {addOpen && (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <Note C={C}>
                      A new line is filed under this method and its workbook
                      block
                      {addCategory.ok ? (
                        <>
                          {" "}
                          (<b>{prettyItemizedCategory(addCategory.category)}</b>
                          )
                        </>
                      ) : (
                        ""
                      )}
                      , for one forward month only: it states that month as both
                      its first and last, so it lands there and nowhere else.
                      Closed months are not offered.
                    </Note>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(150px, 1fr))",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          minWidth: 0,
                        }}
                      >
                        <Label C={C}>Month</Label>
                        <select
                          aria-label="Month for the new line"
                          disabled={!canWrite || addBusy}
                          value={addMonth}
                          onChange={(e) => setAddMonth(e.target.value)}
                          style={inputStyle}
                        >
                          <option value="">Choose an open month</option>
                          {openAxisMonths.map((m) => (
                            <option key={`add-${m}`} value={m}>
                              {formatMonthKey(m)}
                              {activeGroup.months.includes(m)
                                ? " · already has a line"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      {ACCOUNT_CARD_FIELDS.map(({ field, label, type }) => {
                        const value =
                          addFields[field] === undefined
                            ? ""
                            : addFields[field];
                        const onChange = (v) =>
                          setAddFields((prev) => ({ ...prev, [field]: v }));
                        return (
                          <div
                            key={`add-${field}`}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                              minWidth: 0,
                            }}
                          >
                            <Label C={C}>{label}</Label>
                            {type === "frequency" ||
                            type === "increaseFrequency" ? (
                              <select
                                aria-label={`${label} for the new line`}
                                disabled={!canWrite || addBusy}
                                value={value}
                                onChange={(e) => onChange(e.target.value)}
                                style={inputStyle}
                              >
                                <option value="">
                                  {type === "frequency" ? "Monthly" : "—"}
                                </option>
                                {[
                                  ...(type === "increaseFrequency"
                                    ? INCREASE_FREQUENCY_VALUES
                                    : FREQUENCY_VALUES),
                                ].map((f) => (
                                  <option key={`add-${field}-${f}`} value={f}>
                                    {f}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                aria-label={`${label} for the new line`}
                                disabled={!canWrite || addBusy}
                                value={value}
                                onChange={(e) => onChange(e.target.value)}
                                style={{ ...inputStyle, textAlign: "right" }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {addErrors.length > 0 && (
                      <Note C={C} tone="danger">
                        {addErrors.join(" ")}
                      </Note>
                    )}
                    <div>
                      <button
                        type="button"
                        disabled={!canWrite || addBusy}
                        onClick={addLine}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 6,
                          border: "none",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor:
                            !canWrite || addBusy ? "not-allowed" : "pointer",
                          background:
                            !canWrite || addBusy ? C.border : C.accent,
                          color:
                            !canWrite || addBusy ? C.textSecondary : "#fff",
                        }}
                      >
                        {addBusy ? "Adding…" : "Add this line"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}
              >
                <button
                  type="button"
                  onClick={() => setPasteOpen((v) => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: C.accent,
                  }}
                >
                  {pasteOpen ? "▾" : "▸"} Paste a column of monthly amounts
                </button>
                {pasteOpen && (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <Note C={C}>
                      One amount per row, top to bottom, down the
                      statement&rsquo;s own months from the month you pick.
                      Every value is placed against a month before anything is
                      written, and any the card cannot place — a closed month, a
                      month this method has no single line for, a cell that is
                      not a number — is named below and left alone rather than
                      dropped or read as zero.
                    </Note>
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "flex-end",
                      }}
                    >
                      <div style={{ minWidth: 150 }}>
                        <Label C={C}>First month of the column</Label>
                        <select
                          aria-label="First month of the pasted column"
                          disabled={!canWrite || pasteBusy}
                          value={pasteStart}
                          onChange={(e) => setPasteStart(e.target.value)}
                          style={inputStyle}
                        >
                          <option value="">First open month</option>
                          {openAxisMonths.map((m) => (
                            <option key={`p-${m}`} value={m}>
                              {formatMonthKey(m)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <textarea
                      aria-label="Pasted column of monthly amounts"
                      disabled={!canWrite || pasteBusy}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={5}
                      placeholder={"8000\n8250\n8250"}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                    <Note C={C} tone={pasteRead.ready ? "ok" : "warn"}>
                      {pasteRead.message}
                    </Note>
                    {pastePlan.entries.length > 0 && !pastePlan.wide && (
                      <div
                        style={{
                          maxHeight: 220,
                          overflow: "auto",
                          border: `1px solid ${C.border}`,
                          borderRadius: 6,
                          background: C.cardBg,
                        }}
                      >
                        <table
                          style={{
                            borderCollapse: "collapse",
                            fontSize: 11,
                            width: "100%",
                          }}
                        >
                          <thead>
                            <tr style={{ background: C.subtleBg }}>
                              {[
                                "Row",
                                "Month",
                                "Stored amount",
                                "Pasted amount",
                                "What happens",
                              ].map((h) => (
                                <th
                                  key={h}
                                  style={{
                                    padding: "4px 8px",
                                    textAlign: "left",
                                    fontWeight: 700,
                                    color: C.textSecondary,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pastePlan.entries.map((e) => {
                              const refusal = PASTE_REFUSAL_TEXT[e.status];
                              return (
                                <tr
                                  key={`pp-${e.index}`}
                                  style={{ borderTop: `1px solid ${C.border}` }}
                                >
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      fontFamily: MONO,
                                      color: C.textSecondary,
                                    }}
                                  >
                                    {e.index + 1}
                                  </td>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {e.month ? formatMonthKey(e.month) : "—"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      textAlign: "right",
                                      fontFamily: MONO,
                                    }}
                                  >
                                    {e.stored === undefined
                                      ? "—"
                                      : formatItemizedAmountForDisplay(
                                          e.stored,
                                        ) || "—"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      textAlign: "right",
                                      fontFamily: MONO,
                                    }}
                                  >
                                    {e.status === "blank"
                                      ? "—"
                                      : e.value === null
                                        ? e.cell
                                        : formatItemizedAmountForDisplay(
                                            e.value,
                                          )}
                                  </td>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      color: refusal
                                        ? "var(--ds-danger-text)"
                                        : C.textPrimary,
                                      fontWeight: refusal ? 700 : 400,
                                    }}
                                  >
                                    {refusal
                                      ? `Refused — ${refusal}`
                                      : e.status === "same"
                                        ? "Already this amount"
                                        : e.status === "blank"
                                          ? "Blank cell — left alone"
                                          : "Amount set on this month’s line"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div>
                      <button
                        type="button"
                        disabled={
                          !canWrite || pasteBusy || !pastePlan.changes.length
                        }
                        onClick={applyPaste}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 6,
                          border: "none",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor:
                            !canWrite || pasteBusy || !pastePlan.changes.length
                              ? "not-allowed"
                              : "pointer",
                          background:
                            !canWrite || pasteBusy || !pastePlan.changes.length
                              ? C.border
                              : C.accent,
                          color:
                            !canWrite || pasteBusy || !pastePlan.changes.length
                              ? C.textSecondary
                              : "#fff",
                        }}
                      >
                        {pasteBusy
                          ? "Applying…"
                          : `Apply ${pastePlan.changes.length} month amount${pastePlan.changes.length === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <StoredLineList
            lines={lines}
            closedMonths={closedMonths}
            C={C}
            canWrite={canWrite}
            onDelete={removeLine}
            deletingId={deletingId}
            onHistory={setHistoryLine}
            onMove={setMoveLine}
            movingId={moveBusyId}
          />

          {historyLine && (
            <ItemizedLineHistoryModal
              line={historyLine}
              canWrite={canWrite}
              C={C}
              onClose={() => setHistoryLine(null)}
              onRestored={afterRestore}
            />
          )}

          {moveLine && (
            <BudgetLineMonthMovePanel
              line={moveLine}
              propertyCode={propertyCode}
              accountNumber={accountNumber}
              axis={axis}
              closedMonths={closedMonths}
              accountLines={lines}
              canWrite={canWrite}
              C={C}
              onClose={() => {
                setMoveBusyId("");
                setMoveLine(null);
              }}
              onBusyChange={(busy) => setMoveBusyId(busy ? moveLine.id : "")}
              onMoved={afterMove}
            />
          )}

          {summary.mixed && (
            <Note C={C}>
              The provenance below is read for{" "}
              <b>{activeGroup ? activeGroup.label : "\u2014"}</b>, the method
              selected above — not for the account as a whole, which runs{" "}
              {summary.methodCount}.
            </Note>
          )}

          <ItemizedDerivationPanel
            match={derivationMatch}
            loading={!!derivationsLoading}
            error={derivationsError || ""}
            C={C}
            row={representative}
          />
        </>
      )}
    </div>
  );
}
