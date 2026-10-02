import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BULK_OPS } from "../../lib/budgetItemizedBulk.js";
import {
  CROSS_ACCOUNT_FIELDS,
  CROSS_ACCOUNT_HELD_TEXT,
  buildCrossAccountContext,
  buildCrossAccountScope,
  crossAccountCell,
  crossAccountFingerprint,
  crossAccountWritePlan,
  describeCrossAccountOutcome,
  describeCrossAccountPlan,
  planCrossAccountBulk,
} from "../../lib/budgetCrossAccountBulk.js";
import {
  applyItemizedNumericBulk,
  fetchItemizedLinesByAccount,
  updateItemizedLinesBulk,
} from "../../lib/supabaseClient.js";
import {
  formatMonthKey,
  itemizedMonthKey,
} from "../../lib/budgetAccountCard.js";

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export const MAX_SELECTED_ACCOUNTS = 40;

export default function BudgetCrossAccountBulkPanel({
  propertyCode,
  coaRows,
  C,
  onClose,
  onApplied,
}) {
  const ctx = useMemo(() => buildCrossAccountContext(coaRows), [coaRows]);
  const monthKeys = useMemo(
    () => ctx.axis.map((a) => itemizedMonthKey(a.month_end)).filter(Boolean),
    [ctx],
  );

  const [selected, setSelected] = useState(() => new Set());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [field, setField] = useState("amount");
  const [op, setOp] = useState("percent");
  const [value, setValue] = useState("");
  const [linesByAccount, setLinesByAccount] = useState(null);
  const [readAccounts, setReadAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const readToken = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fieldSpec = useMemo(
    () =>
      CROSS_ACCOUNT_FIELDS.find((f) => f.field === field) ||
      CROSS_ACCOUNT_FIELDS[0],
    [field],
  );
  const effectiveOp = fieldSpec.ops.includes(op) ? op : fieldSpec.ops[0];

  const load = useCallback(
    async (accounts, { keepOutcome = false } = {}) => {
      const token = readToken.current + 1;
      readToken.current = token;
      const current = () => readToken.current === token;
      setError("");
      if (!keepOutcome) setOutcome(null);
      setLinesByAccount(null);
      if (accounts.length === 0) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
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
        if (!current()) return;
        setLinesByAccount(new Map(results));
        setReadAccounts(accounts);
      } catch (e) {
        if (!current()) return;
        setError(
          `The stored lines could not be read, so nothing can be planned: ${e && e.message ? e.message : String(e)}`,
        );
      } finally {
        if (current()) setLoading(false);
      }
    },
    [propertyCode],
  );

  const toggleAccount = (account) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
    readToken.current += 1;
    setLinesByAccount(null);
    setOutcome(null);
    setLoading(false);
  };

  const selectedList = useMemo(
    () => ctx.accounts.map((a) => a.account).filter((a) => selected.has(a)),
    [ctx, selected],
  );
  const overSelectionCap = selectedList.length > MAX_SELECTED_ACCOUNTS;

  const scope = useMemo(
    () =>
      linesByAccount
        ? buildCrossAccountScope({
            accounts: readAccounts,
            linesByAccount,
            closedByAccount: ctx.closedByAccount,
            from,
            to,
          })
        : null,
    [linesByAccount, readAccounts, ctx, from, to],
  );

  const plan = useMemo(
    () =>
      scope
        ? planCrossAccountBulk({
            scope,
            field,
            op: effectiveOp,
            value,
          })
        : null,
    [scope, field, effectiveOp, value],
  );

  const summary = useMemo(
    () => describeCrossAccountPlan(plan, scope),
    [plan, scope],
  );
  const write = useMemo(() => crossAccountWritePlan(plan), [plan]);

  const onApply = async () => {
    if (applying || !plan || !summary.ready || write.rowCount === 0) return;
    setApplying(true);
    setOutcome(null);
    try {
      let fresh;
      try {
        fresh = new Map(
          await Promise.all(
            readAccounts.map(async (accountNumber) => {
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
          ),
        );
      } catch (e) {
        if (!mounted.current) return;
        setOutcome({
          ok: false,
          partial: false,
          message: `The stored lines could not be read again, so nothing was changed: ${e && e.message ? e.message : String(e)}`,
        });
        return;
      }
      if (!mounted.current) return;

      const freshScope = buildCrossAccountScope({
        accounts: readAccounts,
        linesByAccount: fresh,
        closedByAccount: ctx.closedByAccount,
        from,
        to,
      });
      const freshPlan = planCrossAccountBulk({
        scope: freshScope,
        field,
        op: effectiveOp,
        value,
      });
      if (
        crossAccountFingerprint(freshPlan) !== crossAccountFingerprint(plan)
      ) {
        readToken.current += 1;
        setLinesByAccount(fresh);
        setOutcome({
          ok: false,
          partial: false,
          message:
            "The stored lines moved between the preview and the press, so nothing was changed. " +
            "The preview below is the re-read one \u2014 check it and press Apply again if it still says what you mean.",
        });
        return;
      }

      const send = crossAccountWritePlan(freshPlan);
      if (send.rowCount === 0) {
        setOutcome(
          describeCrossAccountOutcome({ mode: send.mode, requested: 0 }),
        );
        return;
      }

      const res =
        send.mode === "uniform"
          ? await updateItemizedLinesBulk(send.ids, send.patch)
          : await applyItemizedNumericBulk(field, send.changes);
      if (!mounted.current) return;

      const data = res.data || {};
      setOutcome(
        describeCrossAccountOutcome({
          mode: send.mode,
          requested: res.error
            ? send.rowCount
            : (data.requested ?? send.rowCount),
          updated: data.updated || 0,
          unchanged: data.unchanged || 0,
          skipped: data.skipped || 0,
          missing: data.missing || 0,
          error: res.error
            ? res.error.message || "The change could not be applied."
            : null,
        }),
      );

      readToken.current += 1;
      setLinesByAccount(null);
      load(readAccounts, { keepOutcome: true });
      if (!res.error && onApplied) onApplied();
    } finally {
      if (mounted.current) setApplying(false);
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
  const control = {
    fontSize: 12,
    padding: "4px 6px",
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: C.subtleBg,
    color: C.textPrimary,
  };
  const canApply = Boolean(summary.ready) && !applying && write.rowCount > 0;

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
          Change many accounts at once
        </div>
        <div style={{ fontSize: 11.5, color: C.textSecondary }}>
          Reads the stored lines on the accounts you pick, shows every line the
          change would touch, and writes only when you press Apply.
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

      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: C.textSecondary,
        }}
      >
        {`Accounts \u00b7 ${selectedList.length} selected`}
      </div>
      <div
        style={{
          maxHeight: 150,
          overflowY: "auto",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: 6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          background: C.subtleBg,
        }}
      >
        {ctx.accounts.length === 0 ? (
          <div style={{ fontSize: 11.5, color: C.textSecondary }}>
            This statement carries no accounts to change.
          </div>
        ) : (
          ctx.accounts.map((a) => (
            <label
              key={a.account}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: C.textPrimary,
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(a.account)}
                disabled={applying}
                onChange={() => toggleAccount(a.account)}
              />
              <span style={{ fontFamily: MONO }}>{a.account}</span>
              <span style={{ color: C.textSecondary }}>{a.name}</span>
            </label>
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11.5, color: C.textSecondary }}>Months</span>
        <select
          aria-label="From month"
          value={from}
          disabled={applying}
          onChange={(e) => setFrom(e.target.value)}
          style={control}
        >
          <option value="">First on the statement</option>
          {monthKeys.map((k) => (
            <option key={`f-${k}`} value={k}>
              {formatMonthKey(k)}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: C.textSecondary }}>to</span>
        <select
          aria-label="To month"
          value={to}
          disabled={applying}
          onChange={(e) => setTo(e.target.value)}
          style={control}
        >
          <option value="">Last on the statement</option>
          {monthKeys.map((k) => (
            <option key={`t-${k}`} value={k}>
              {formatMonthKey(k)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => load(selectedList)}
          disabled={
            loading || applying || selectedList.length === 0 || overSelectionCap
          }
          style={{
            background: C.subtleBg,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            color: C.textPrimary,
            fontSize: 12,
            fontWeight: 700,
            padding: "5px 12px",
            cursor:
              loading || selectedList.length === 0 || overSelectionCap
                ? "not-allowed"
                : "pointer",
          }}
        >
          {loading ? "Reading\u2026" : "Read the stored lines"}
        </button>
      </div>

      {overSelectionCap ? (
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--ds-warning-text)",
          }}
        >
          {`${selectedList.length} accounts selected, past the ${MAX_SELECTED_ACCOUNTS} this panel reads at once. Narrow the selection.`}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <select
          aria-label="Field"
          value={field}
          disabled={applying}
          onChange={(e) => {
            setField(e.target.value);
            setOutcome(null);
          }}
          style={control}
        >
          {CROSS_ACCOUNT_FIELDS.map((f) => (
            <option key={f.field} value={f.field}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Operation"
          value={effectiveOp}
          disabled={applying}
          onChange={(e) => {
            setOp(e.target.value);
            setOutcome(null);
          }}
          style={control}
        >
          {fieldSpec.ops.map((o) => (
            <option key={o} value={o}>
              {(BULK_OPS[o] && BULK_OPS[o].label) || o}
            </option>
          ))}
        </select>
        <input
          aria-label="Value"
          value={value}
          disabled={applying}
          placeholder={effectiveOp === "percent" ? "e.g. 3 for +3%" : "value"}
          onChange={(e) => {
            setValue(e.target.value);
            setOutcome(null);
          }}
          style={{ ...control, fontFamily: MONO, width: 140 }}
        />
      </div>

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
      {loading ? (
        <div style={{ fontSize: 11.5, color: C.textSecondary }}>
          {"Reading the stored lines for these accounts\u2026"}
        </div>
      ) : null}

      {plan ? (
        <div
          style={{
            fontSize: 11.5,
            fontWeight: summary.ready ? 700 : 400,
            color: C.textSecondary,
          }}
        >
          {summary.message}
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

      {plan && plan.preview && plan.preview.total > 0 ? (
        <button
          type="button"
          onClick={onApply}
          disabled={!canApply}
          style={{
            alignSelf: "flex-start",
            background: canApply ? C.accent : C.subtleBg,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            color: canApply ? "#fff" : C.textSecondary,
            cursor: canApply ? "pointer" : "not-allowed",
            fontSize: 12,
            fontWeight: 700,
            padding: "6px 14px",
          }}
        >
          {applying
            ? "Applying\u2026"
            : `Apply to ${write.rowCount} line${write.rowCount === 1 ? "" : "s"}`}
        </button>
      ) : null}

      {plan && plan.byAccount && plan.byAccount.length ? (
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
                <th style={head}>Line</th>
                <th style={head}>Month</th>
                <th style={{ ...head, textAlign: "right" }}>Now</th>
                <th style={{ ...head, textAlign: "right" }}>Would be</th>
                <th style={head}>Note</th>
              </tr>
            </thead>
            <tbody>
              {plan.byAccount.map((group) => {
                const held =
                  (
                    scope.perAccount.find((p) => p.account === group.account) ||
                    {}
                  ).held || [];
                return (
                  <React.Fragment key={`grp-${group.account}`}>
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
                        {group.account}
                        {` \u00b7 ${group.changed} would change`}
                        {group.unchanged
                          ? ` \u00b7 ${group.unchanged} already at that value`
                          : ""}
                        {group.errored
                          ? ` \u00b7 ${group.errored} cannot be computed`
                          : ""}
                        {group.invalid
                          ? ` \u00b7 ${group.invalid} would become invalid`
                          : ""}
                        {held.length
                          ? ` \u00b7 ${held.length} out of reach`
                          : ""}
                      </td>
                    </tr>
                    {group.changes.map((c) => (
                      <tr key={`row-${c.key}`}>
                        <td style={cell}>
                          {(c.row && c.row.line_description) || "\u2014"}
                        </td>
                        <td style={{ ...cell, fontFamily: MONO }}>
                          {formatMonthKey(
                            itemizedMonthKey(c.row && c.row.first_month),
                          ) || "\u2014"}
                        </td>
                        <td
                          style={{
                            ...cell,
                            fontFamily: MONO,
                            textAlign: "right",
                          }}
                        >
                          {crossAccountCell(c.before, field)}
                        </td>
                        <td
                          style={{
                            ...cell,
                            fontFamily: MONO,
                            textAlign: "right",
                          }}
                        >
                          {c.state === "error"
                            ? "\u2014"
                            : crossAccountCell(c.after, field)}
                        </td>
                        <td
                          style={{
                            ...cell,
                            color:
                              c.state === "error" || c.state === "invalid"
                                ? "var(--ds-warning-text)"
                                : C.textSecondary,
                            fontWeight:
                              c.state === "error" || c.state === "invalid"
                                ? 700
                                : 400,
                          }}
                        >
                          {c.message ||
                            (c.state === "unchanged"
                              ? "Already at that value"
                              : "")}
                        </td>
                      </tr>
                    ))}
                    {held.map((h, i) => (
                      <tr
                        key={`held-${group.account}-${(h.line && h.line.id) || i}`}
                      >
                        <td style={{ ...cell, color: C.textSecondary }}>
                          {(h.line && h.line.line_description) || "\u2014"}
                        </td>
                        <td
                          style={{
                            ...cell,
                            fontFamily: MONO,
                            color: C.textSecondary,
                          }}
                        >
                          {formatMonthKey(
                            itemizedMonthKey(h.line && h.line.first_month),
                          ) || "\u2014"}
                        </td>
                        <td
                          style={{
                            ...cell,
                            fontFamily: MONO,
                            textAlign: "right",
                            color: C.textSecondary,
                          }}
                        >
                          {crossAccountCell(
                            h.line ? h.line[field] : null,
                            field,
                          )}
                        </td>
                        <td
                          style={{
                            ...cell,
                            textAlign: "right",
                            color: C.textSecondary,
                          }}
                        >
                          {"\u2014"}
                        </td>
                        <td style={{ ...cell, color: C.textSecondary }}>
                          {`Out of reach \u2014 ${CROSS_ACCOUNT_HELD_TEXT[h.reason] || h.reason}`}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.5 }}>
        First Month and Last Month are not offered here: on a stored line those
        are the month the line stands for, so setting them across accounts would
        pile every selected line onto one month. A line that carries the wrong
        month is deleted on its account card and created again for the month you
        mean. A change made here is undone from that line’s History on its
        account card.
      </div>
    </div>
  );
}
