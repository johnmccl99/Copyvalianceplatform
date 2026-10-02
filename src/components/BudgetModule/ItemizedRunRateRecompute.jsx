import React, { useEffect, useState } from "react";
import { fetchAssumptionGlSeries } from "../../lib/budgetAssumptionExplanations.js";
import {
  recomputeStableRunRate,
  refusalText,
  WINDOW_MONTHS,
} from "../../lib/itemizedRunRateRecompute.js";

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const money = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });

export default function ItemizedRunRateRecompute({
  row,
  propertyCode,
  C,
  canWrite = false,
  onApply,
}) {
  const account = String((row && row.account_number) || "").trim();
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!propertyCode || !account) {
      setSeries(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAssumptionGlSeries(propertyCode, account).then(
      ({ data, error: err }) => {
        if (cancelled) return;
        setError(err || "");
        setSeries(err ? null : data || []);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [propertyCode, account]);

  const label = (t) => (
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        color: C.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {t}
    </span>
  );

  const shell = (children) => (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        background: C.inputBg,
        padding: 14,
        marginTop: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: C.textSecondary,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Recompute from the GL · R1 stable run-rate
        </span>
      </div>
      {children}
    </div>
  );

  const note = (t, danger) => (
    <div
      style={{
        fontSize: 12,
        color: danger ? "var(--ds-danger-text)" : C.textSecondary,
        lineHeight: 1.45,
      }}
    >
      {t}
    </div>
  );

  if (loading)
    return shell(note("Reading the account\u2019s GL actuals\u2026"));
  if (error) {
    return shell(
      note(
        `The GL actuals could not be read, so no run-rate can be offered for this line: ${error}`,
        true,
      ),
    );
  }
  if (series === null) return null;

  const result = recomputeStableRunRate({
    series,
    statedGrowth: row.growth,
    currentAmount: row.amount,
    frequency: row.frequency,
    accountNumber: account,
  });

  if (!result.ok) {
    return shell(
      <>
        {note(refusalText(result.refusal, { frequency: row.frequency }))}
        {result.monthsAvailable > 0 && (
          <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 6 }}>
            {result.monthsAvailable} GL month
            {result.monthsAvailable === 1 ? "" : "s"} on file for account{" "}
            {account}.
          </div>
        )}
      </>,
    );
  }

  const pct = (result.statedGrowth * 100).toFixed(2);
  return shell(
    <>
      <div
        style={{
          fontSize: 13,
          fontFamily: MONO,
          color: C.textPrimary,
          lineHeight: 1.6,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {money(result.t12Mean)}{" "}
        <span style={{ color: C.textSecondary }}>
          mean of {result.monthsUsed} GL months
        </span>
        {"  ×  "}
        (1 + {pct}%){" "}
        <span style={{ color: C.textSecondary }}>stated Increase</span>
        {"  =  "}
        <strong>{money(result.proposedAmount)}</strong>
        <span style={{ color: C.textSecondary }}>/mo</span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          marginTop: 8,
          alignItems: "baseline",
        }}
      >
        <span>
          {label("GL window")}{" "}
          <span style={{ fontFamily: MONO, fontSize: 12 }}>
            {result.from} → {result.to}
          </span>
        </span>
        <span>
          {label(row._dirty ? "Amount on the line (unsaved)" : "Stored amount")}{" "}
          <span style={{ fontFamily: MONO, fontSize: 12 }}>
            {money(result.currentAmount)}
          </span>
        </span>
        <span>
          {label("Change")}{" "}
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>
            {result.delta === null
              ? "—"
              : `${result.delta >= 0 ? "+" : ""}${money(result.delta)}`}
            {result.deltaPct === null
              ? ""
              : ` (${result.deltaPct >= 0 ? "+" : ""}${result.deltaPct}%)`}
          </span>
        </span>
        {result.medianVariant !== null &&
          Math.abs(result.medianVariant - result.proposedAmount) >= 0.01 && (
            <span>
              {label("Median variant")}{" "}
              <span style={{ fontFamily: MONO, fontSize: 12 }}>
                {money(result.medianVariant)}
              </span>
            </span>
          )}
      </div>

      <details style={{ marginTop: 8 }}>
        <summary
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.textSecondary,
            cursor: "pointer",
          }}
        >
          The {WINDOW_MONTHS} months this average is over
        </summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 4,
            marginTop: 6,
          }}
        >
          {result.months.map((m) => (
            <div
              key={m.month}
              style={{
                fontSize: 11.5,
                fontFamily: MONO,
                color: C.textPrimary,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ color: C.textSecondary }}>{m.month}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {money(m.amount)}
              </span>
            </div>
          ))}
        </div>
      </details>

      {canWrite && onApply && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => onApply(result.proposedAmount)}
            disabled={!result.changesAmount}
            title={
              result.changesAmount
                ? "Fills the Amount field with the recomputed run-rate. Nothing is written until you save."
                : row._dirty
                  ? "The Amount field already holds the recomputed run-rate, unsaved."
                  : "The stored amount already equals the recomputed run-rate."
            }
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 5,
              border: `1px solid ${C.border}`,
              cursor: result.changesAmount ? "pointer" : "default",
              background: result.changesAmount ? C.accent : C.subtleBg,
              color: result.changesAmount ? "#fff" : C.textSecondary,
            }}
          >
            Use {money(result.proposedAmount)}
          </button>
          <span
            style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.4 }}
          >
            {result.changesAmount
              ? "Fills the Amount field. Nothing is written to the budget until you save the line."
              : row._dirty
                ? "The Amount field already holds this run-rate. It is not written until you save the line."
                : "The stored amount already matches this run-rate."}
          </span>
        </div>
      )}
    </>,
  );
}
