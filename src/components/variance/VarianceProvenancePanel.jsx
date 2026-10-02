import React from "react";
import { buildGlChain } from "../../lib/varianceProvenance/varianceProvenance.js";
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";

function VarianceFormulaHeader({ header, theme }) {
  const { text, sub } = theme || {};
  if (!header) return null;
  const { formula, value, pct, operands, baselineAvailable } = header;
  const actual = operands?.find((o) => o.role === "actual");
  const baseline = operands?.find((o) => o.role === "baseline");

  const operandStr = (o) => {
    if (!o) return "";
    const val = o.value == null ? EMPTY : formatCurrencyFull(o.value);
    return `${o.label} ${val}`;
  };
  const sourceStr = (o) => {
    if (!o || (!o.source && !o.asOf)) return null;
    const bits = [];
    if (o.source) bits.push(o.source);
    if (o.asOf) bits.push(`as of ${o.asOf}`);
    return `${o.label}: ${bits.join(" · ")}`;
  };
  const sources = [sourceStr(actual), sourceStr(baseline)].filter(Boolean);

  return (
    <div style={{ marginBottom: 8, lineHeight: 1.5 }}>
      <div
        style={{
          fontSize: 12,
          color: text,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {baselineAvailable ? (
          <>
            <span style={{ color: sub, fontWeight: 500 }}>Variance </span>
            {value == null ? EMPTY : formatCurrencyFull(value)}
            {pct != null ? (
              <span style={{ color: sub, fontWeight: 500 }}>
                {" "}
                ({formatPercent(pct, { signed: true })})
              </span>
            ) : null}
            <span style={{ color: sub, fontWeight: 500 }}>{" = "}</span>
            {operandStr(actual)}
            <span style={{ color: sub, fontWeight: 500 }}>{" − "}</span>
            {operandStr(baseline)}
          </>
        ) : (
          <>
            {operandStr(actual)}
            <span style={{ color: sub, fontWeight: 500 }}>
              {" "}
              · no prior-year baseline for this month
            </span>
          </>
        )}
      </div>
      {sources.length > 0 && (
        <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
          {sources.join("  ·  ")}
        </div>
      )}
      <div
        style={{ fontSize: 11, color: sub, marginTop: 1, fontStyle: "italic" }}
      >
        {formula}
      </div>
    </div>
  );
}

function GlChainBody({ chain, theme }) {
  const { text, sub } = theme || {};
  if (!chain || chain.kind !== "gl") return null;
  const recon = chain.reconciliation;
  return (
    <div style={{ fontSize: 12, color: text }}>
      <span style={{ color: sub }}>{chain.caption}:</span>{" "}
      {chain.rows.map((g, i) => (
        <span
          key={i}
          style={{ marginRight: 14, fontVariantNumeric: "tabular-nums" }}
        >
          {g.transaction_date} {formatCurrencyFull(g.amount)}
          {g.balance != null ? ` · bal ${formatCurrencyFull(g.balance)}` : ""}
          {g.source ? ` · ${g.source}` : ""}
        </span>
      ))}
      {recon && recon.target != null && (
        <div
          style={{
            fontSize: 11,
            color: sub,
            marginTop: 6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {recon.ok ? (
            <>
              {chain.rows.length === 1
                ? "GL monthly net change"
                : `Σ ${chain.rows.length} GL monthly rows`}{" "}
              = {recon.label} {formatCurrencyFull(recon.target)}
              <span style={{ marginLeft: 6 }} aria-hidden="true">
                ✓
              </span>
              <span
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                }}
              >
                matches
              </span>
            </>
          ) : (
            <>
              Σ {formatCurrencyFull(recon.sum)} · {recon.label}{" "}
              {formatCurrencyFull(recon.target)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function VarianceProvenancePanel({
  header,
  entry,
  reconcilesTo,
  reconcileLabel = "Actual",
  loadingText = "Loading GL detail…",
  errorText = "Could not load GL detail.",
  emptyText = "No GL detail for this account/month.",
  theme,
}) {
  const { sub, red } = theme || {};

  if (!entry || entry.loading) {
    return <span style={{ color: sub, fontSize: 12 }}>{loadingText}</span>;
  }
  if (entry.error) {
    return (
      <span style={{ color: red, fontSize: 12 }}>
        {errorText} {entry.error?.message ? String(entry.error.message) : ""}
      </span>
    );
  }

  const rows = Array.isArray(entry.rows) ? entry.rows : [];
  const chain = buildGlChain({ rows, reconcilesTo, reconcileLabel });

  return (
    <div>
      <VarianceFormulaHeader header={header} theme={theme} />
      {rows.length === 0 ? (
        <span style={{ color: sub, fontSize: 12 }}>{emptyText}</span>
      ) : (
        <GlChainBody chain={chain} theme={theme} />
      )}
    </div>
  );
}
