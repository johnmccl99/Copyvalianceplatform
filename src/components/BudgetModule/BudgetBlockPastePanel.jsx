import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BLOCK_REFUSAL_TEXT,
  DUPLICATE_NOTE,
  accountsInBlock,
  buildBlockInsertBatches,
  buildBlockPasteContext,
  describeBlockPastePlan,
  describeBlockWriteOutcome,
  planFingerprint,
  planPastedBlock,
} from "../../lib/budgetBlockPaste.js";
import {
  fetchItemizedLinesByAccount,
  insertItemizedLines,
} from "../../lib/supabaseClient.js";
import { formatItemizedAmountForDisplay } from "../../lib/budgetItemized.js";

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const MAX_ACCOUNTS = 60;

export default function BudgetBlockPastePanel({
  propertyCode,
  coaRows,
  C,
  onClose,
  onCreated,
}) {
  const [text, setText] = useState("");
  const [linesByAccount, setLinesByAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tooWide, setTooWide] = useState(0);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [creating, setCreating] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const areaRef = useRef(null);
  const readToken = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readAccounts = useCallback(
    async (accounts) => {
      const results = await Promise.all(
        accounts.map(async (accountNumber) => {
          const res = await fetchItemizedLinesByAccount({
            propertyCode,
            accountNumber,
          });
          if (res && res.error)
            throw new Error(
              `account ${accountNumber}: ${res.error.message || String(res.error)}`,
            );
          return [accountNumber, (res && res.data) || []];
        }),
      );
      return new Map(results);
    },
    [propertyCode],
  );

  const readAndPlan = useCallback(
    async (pasted) => {
      const token = readToken.current + 1;
      readToken.current = token;
      const current = () => readToken.current === token;

      setText(pasted);
      setError("");
      setTooWide(0);
      setOutcome(null);
      setLinesByAccount(null);
      const accounts = accountsInBlock(pasted);
      if (accounts.length === 0) {
        setLoading(false);
        return;
      }
      if (accounts.length > MAX_ACCOUNTS) {
        setTooWide(accounts.length);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const results = await readAccounts(accounts);
        if (!current()) return;
        setLinesByAccount(results);
      } catch (e) {
        if (!current()) return;
        setError(
          `The stored lines for this block could not be read, so nothing can be planned: ${e && e.message ? e.message : String(e)}`,
        );
      } finally {
        if (current()) setLoading(false);
      }
    },
    [readAccounts],
  );

  const onEdit = useCallback((next) => {
    readToken.current += 1;
    setText(next);
    setError("");
    setTooWide(0);
    setOutcome(null);
    setLinesByAccount(null);
    setLoading(false);
  }, []);

  const ctx = useMemo(
    () =>
      linesByAccount ? buildBlockPasteContext(coaRows, linesByAccount) : null,
    [coaRows, linesByAccount],
  );
  const plan = useMemo(
    () =>
      ctx
        ? planPastedBlock(text, { axis: ctx.axis, accounts: ctx.accounts })
        : null,
    [ctx, text],
  );
  const summary = useMemo(() => describeBlockPastePlan(plan), [plan]);

  const onPaste = (e) => {
    const pasted = (e.clipboardData && e.clipboardData.getData("text")) || "";
    if (!pasted) return;
    e.preventDefault();
    readAndPlan(pasted);
  };

  const batches = useMemo(
    () => buildBlockInsertBatches(plan, { includeDuplicates }),
    [plan, includeDuplicates],
  );

  const onCreate = async () => {
    if (creating || !plan || !summary.ready) return;
    setCreating(true);
    setOutcome(null);
    try {
      let fresh;
      try {
        fresh = await readAccounts(accountsInBlock(text));
      } catch (e) {
        if (!mounted.current) return;
        setOutcome({
          ok: false,
          partial: false,
          message:
            "The stored lines could not be read again, so nothing was created: " +
            `${e && e.message ? e.message : String(e)}`,
        });
        return;
      }
      if (!mounted.current) return;

      const freshCtx = buildBlockPasteContext(coaRows, fresh);
      const freshPlan = planPastedBlock(text, {
        axis: freshCtx.axis,
        accounts: freshCtx.accounts,
      });
      if (planFingerprint(freshPlan) !== planFingerprint(plan)) {
        readToken.current += 1;
        setLinesByAccount(fresh);
        setOutcome({
          ok: false,
          partial: false,
          message:
            "The stored lines moved between the paste and the press, so nothing was created. " +
            "The plan below is the re-read one \u2014 check it and press Create again if it still says what you mean.",
        });
        return;
      }

      const send = buildBlockInsertBatches(freshPlan, { includeDuplicates });
      if (send.unsendable.length) {
        setOutcome({
          ok: false,
          partial: false,
          message:
            `Row ${send.unsendable.join(", ")} carries no workbook category, so nothing was created. ` +
            "Add the line from its account card instead.",
        });
        return;
      }
      if (send.rowCount === 0) {
        setOutcome(describeBlockWriteOutcome({ requested: 0 }));
        return;
      }

      let inserted = 0;
      let failure = null;
      let failedCategory = null;
      for (const b of send.batches) {
        const { data, error: err } = await insertItemizedLines({
          propertyCode,
          category: b.category,
          rows: b.rows,
        });
        inserted += (data || []).length;
        if (err) {
          failure = err.message || "The create was refused.";
          failedCategory = b.category;
          break;
        }
      }
      if (!mounted.current) return;

      setOutcome(
        describeBlockWriteOutcome({
          requested: send.rowCount,
          inserted,
          skippedDuplicates: send.skippedDuplicates,
          error: failure,
          failedCategory,
        }),
      );
      if (!failure && inserted === send.rowCount) {
        readToken.current += 1;
        setText("");
        setLinesByAccount(null);
        setIncludeDuplicates(false);
      }
      if (inserted > 0 && onCreated) onCreated();
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  const cell = {
    padding: "4px 8px",
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

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: C.cardBg,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.textPrimary }}>
          Paste a workbook block
        </div>
        <div style={{ fontSize: 11.5, color: C.textSecondary }}>
          Reads the block, shows what it would create, and creates it only when
          you press Create.
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.textSecondary,
              cursor: "pointer",
              fontSize: 12,
              padding: "4px 10px",
            }}
          >
            Close
          </button>
        ) : null}
      </div>

      <textarea
        ref={areaRef}
        value={text}
        onPaste={onPaste}
        onChange={(e) => onEdit(e.target.value)}
        placeholder={
          "Paste the 13 columns of the workbook\u2019s *_Itemized block here \u2014 Line Description through Account Number."
        }
        rows={4}
        spellCheck={false}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontFamily: MONO,
          fontSize: 11.5,
          padding: 8,
          borderRadius: 6,
          border: `1px solid ${C.border}`,
          background: C.subtleBg,
          color: C.textPrimary,
          resize: "vertical",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      />

      {error ? (
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--ds-danger-text)",
          }}
        >
          {error}
        </div>
      ) : null}
      {tooWide ? (
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--ds-warning-text)",
          }}
        >
          {`That block names ${tooWide} accounts, past the ${MAX_ACCOUNTS} this panel reads at once. Paste one section of the workbook at a time.`}
        </div>
      ) : null}
      {loading ? (
        <div style={{ fontSize: 11.5, color: C.textSecondary }}>
          {"Reading the stored lines for these accounts\u2026"}
        </div>
      ) : null}

      <div
        style={{
          fontSize: 11.5,
          fontWeight: plan && plan.creates && plan.creates.length ? 700 : 400,
          color: C.textSecondary,
        }}
      >
        {summary.message}
      </div>
      {plan && plan.skippedHeader ? (
        <div style={{ fontSize: 11.5, color: C.textSecondary }}>
          The workbook header row was skipped.
        </div>
      ) : null}

      {outcome ? (
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            lineHeight: 1.5,
            color: outcome.ok
              ? "var(--ds-success-text)"
              : "var(--ds-warning-text)",
          }}
        >
          {outcome.message}
        </div>
      ) : null}

      {plan && plan.creates.length ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onCreate}
            disabled={!summary.ready || creating || batches.rowCount === 0}
            style={{
              background:
                summary.ready && !creating && batches.rowCount > 0
                  ? C.accent
                  : C.subtleBg,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color:
                summary.ready && !creating && batches.rowCount > 0
                  ? "#fff"
                  : C.textSecondary,
              cursor:
                summary.ready && !creating && batches.rowCount > 0
                  ? "pointer"
                  : "not-allowed",
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 14px",
            }}
          >
            {(() => {
              if (creating) return "Creating\u2026";
              if (batches.rowCount === 0) return "Nothing left to create";
              return `Create ${batches.rowCount} line${batches.rowCount === 1 ? "" : "s"}`;
            })()}
          </button>
          {plan.duplicates.length ? (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: C.textSecondary,
              }}
            >
              <input
                type="checkbox"
                checked={includeDuplicates}
                disabled={creating}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              {`Create the ${plan.duplicates.length} row${plan.duplicates.length === 1 ? "" : "s"} that would sit beside an identical stored line too`}
            </label>
          ) : null}
          {!summary.ready ? (
            <span style={{ fontSize: 11.5, color: C.textSecondary }}>
              {`${plan.refused.length} refused row${plan.refused.length === 1 ? "" : "s"} below \u2014 fix the block in the workbook and paste it again.`}
            </span>
          ) : null}
        </div>
      ) : null}

      {plan && plan.entries.length ? (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontSize: 11.5,
            }}
          >
            <thead>
              <tr>
                <th style={head}>Account</th>
                <th style={head}>Line</th>
                <th style={head}>Month</th>
                <th style={{ ...head, textAlign: "right" }}>Amount</th>
                <th style={head}>What would happen</th>
              </tr>
            </thead>
            <tbody>
              {plan.byAccount.map((group) => (
                <React.Fragment key={`grp-${group.account || "none"}`}>
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        ...cell,
                        background: C.subtleBg,
                        fontWeight: 800,
                        color: C.textPrimary,
                      }}
                    >
                      {group.account || "No account number"}
                      {" \u00b7 "}
                      {`${group.creates} to create`}
                      {group.refused ? ` \u00b7 ${group.refused} refused` : ""}
                      {group.duplicates
                        ? ` \u00b7 ${group.duplicates} beside a stored line`
                        : ""}
                    </td>
                  </tr>
                  {group.entries.map((e) => {
                    const refusal = BLOCK_REFUSAL_TEXT[e.status];
                    return (
                      <tr key={`row-${e.index}`}>
                        <td style={cell}>{e.account || "\u2014"}</td>
                        <td style={cell}>
                          {e.row.line_description || "\u2014"}
                        </td>
                        <td style={{ ...cell, fontFamily: MONO }}>
                          {e.monthLabel || "\u2014"}
                        </td>
                        <td
                          style={{
                            ...cell,
                            fontFamily: MONO,
                            textAlign: "right",
                          }}
                        >
                          {e.row.amount === "" ||
                          e.row.amount === null ||
                          e.row.amount === undefined
                            ? "\u2014"
                            : formatItemizedAmountForDisplay(e.row.amount)}
                        </td>
                        <td
                          style={{
                            ...cell,
                            color: refusal
                              ? "var(--ds-warning-text)"
                              : C.textPrimary,
                            fontWeight: refusal ? 700 : 400,
                          }}
                        >
                          {refusal
                            ? `Refused \u2014 ${refusal}${e.detail ? ` (${e.detail})` : ""}`
                            : e.duplicate
                              ? `Would create \u2014 ${DUPLICATE_NOTE}`
                              : "Would create"}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.5 }}>
        Lines are created, never matched to a stored line and updated. To change
        a line that already exists, or to undo one created here, open its
        account card on this page: each stored line has a History with every
        version of it.
      </div>
    </div>
  );
}
