import React from "react";
import {
  RULE_LABELS,
  KIND_LABELS,
} from "../../lib/budgetAssumptionExplanations.js";

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CONFIDENCE_COLOR = {
  high: "var(--ds-success-text)",
  medium: "var(--ds-warning-text)",
  low: "var(--ds-danger-text)",
  manual: "var(--ds-warning-text)",
};

function Chip({ children, C, color, title }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 3,
        background: C.subtleBg,
        color: color || C.textSecondary,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Stat({ label, value, C, mono = true }) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          color: C.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: C.textPrimary,
          wordBreak: "break-word",
          fontFamily: mono ? MONO : "inherit",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ProvenanceStrip({ row, C }) {
  if (!row) return null;
  const stated = String(row.data_source ?? "").trim();
  const reference = String(row.reference ?? "").trim();
  return (
    <div
      style={{
        marginBottom: 10,
        paddingBottom: 10,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: C.textSecondary,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          Stated source
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: stated ? C.textPrimary : C.textSecondary,
            fontFamily: MONO,
          }}
        >
          {stated || "none stated"}
        </span>
        {reference && (
          <>
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: C.textSecondary,
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              Reference
            </span>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: C.textPrimary,
                fontFamily: MONO,
              }}
            >
              {reference}
            </span>
          </>
        )}
      </div>
      <div
        style={{
          fontSize: 10.5,
          color: C.textSecondary,
          lineHeight: 1.4,
          marginTop: 3,
        }}
      >
        {stated
          ? "A label the workbook carried, not a live link — nothing re-reads this source, so the amount is only as current as the last time someone checked it."
          : "Nothing on this line records where its amount came from."}
      </div>
    </div>
  );
}

function Shell({ C, children, right, row }) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        background: C.subtleBg,
        padding: 14,
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
          Where this number came from
        </span>
        <span style={{ flex: 1 }} />
        {right}
      </div>
      <ProvenanceStrip row={row} C={C} />
      {children}
    </div>
  );
}

export default function ItemizedDerivationPanel({
  match,
  loading = false,
  error = "",
  C,
  row = null,
}) {
  const note = (t) => (
    <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.45 }}>
      {t}
    </div>
  );

  if (loading)
    return (
      <Shell C={C} row={row}>
        {note("Loading the derivation record…")}
      </Shell>
    );

  if (error) {
    return (
      <Shell C={C} row={row}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--ds-danger-text)",
            lineHeight: 1.45,
          }}
        >
          The derivation record could not be loaded, so this line's provenance
          is unknown rather than absent: {error}
        </div>
      </Shell>
    );
  }

  const record = match && match.record;
  if (!record) {
    return (
      <Shell C={C} row={row}>
        {note(
          match && match.scope === "no_account"
            ? "This line has no account number yet, so there is nothing to look a derivation up by."
            : "No derivation record exists for this account. This amount was typed here or carried in from the sealed workbook — nothing on file explains how it was produced.",
        )}
      </Shell>
    );
  }

  const body = record.explanation || {};
  const computed = body.computed || null;
  const stats = (body.inputs && body.inputs.stats) || {};
  const win = (body.inputs && body.inputs.window) || {};
  const comparator = (computed && computed.comparator) || null;
  const caveats = Array.isArray(body.caveats) ? body.caveats : [];
  const checks = body.checks || {};
  const flagged = Object.entries(checks).filter(([, v]) => v && v.flag);
  const basis = comparator && comparator.basis === "annual" ? "/yr" : "/mo";
  const otherYear = match.scope === "other_fiscal_year";

  return (
    <Shell
      C={C}
      row={row}
      right={
        <>
          <Chip C={C} title={record.rule_id}>
            {RULE_LABELS[record.rule_id] || record.rule_id}
          </Chip>
          <Chip C={C}>
            {KIND_LABELS[record.record_kind] || record.record_kind}
          </Chip>
          <Chip
            C={C}
            color={CONFIDENCE_COLOR[record.confidence]}
            title={(body.confidence && body.confidence.basis) || ""}
          >
            {record.confidence} confidence
          </Chip>
        </>
      }
    >
      {otherYear && (
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--ds-warning-text)",
            lineHeight: 1.45,
            marginBottom: 8,
          }}
        >
          Derived for FY {record.fiscal_year}, not for this line
          {match.lineFiscalYear ? ` (FY ${match.lineFiscalYear})` : ""}. It is
          the most recent derivation on this account and explains how the
          account was set, not how this line's amount was produced.
        </div>
      )}

      {record.narrative && (
        <div
          style={{
            fontSize: 12.5,
            color: C.textPrimary,
            lineHeight: 1.5,
            marginBottom: 10,
          }}
        >
          {record.narrative}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "10px 16px",
        }}
      >
        {record.derived_value !== null &&
          record.derived_value !== undefined && (
            <Stat
              C={C}
              label={`Derived${basis}`}
              value={fmtMoney(record.derived_value)}
            />
          )}
        {comparator &&
          comparator.workbook_value !== null &&
          comparator.workbook_value !== undefined && (
            <Stat
              C={C}
              label={`Sealed workbook${basis}`}
              value={fmtMoney(comparator.workbook_value)}
            />
          )}
        {stats.t12_mean !== null && stats.t12_mean !== undefined && (
          <Stat C={C} label="T12 mean/mo" value={fmtMoney(stats.t12_mean)} />
        )}
        {computed &&
          computed.stated_growth !== null &&
          computed.stated_growth !== undefined && (
            <Stat
              C={C}
              label="Stated increase"
              value={`${(Number(computed.stated_growth) * 100).toFixed(2)}%`}
            />
          )}
        {(win.from || win.to) && (
          <Stat
            C={C}
            label="GL window"
            value={`${win.from || "?"} → ${win.to || "?"}`}
          />
        )}
        {win.months_used !== null && win.months_used !== undefined && (
          <Stat C={C} label="Months used" value={String(win.months_used)} />
        )}
        <Stat C={C} label="Derived FY" value={record.fiscal_year || "—"} />
        <Stat
          C={C}
          label="Explains field"
          value={record.itemized_field || "—"}
        />
      </div>

      {flagged.length > 0 && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {flagged.map(([name, v]) => (
            <div
              key={name}
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: "var(--ds-warning-text)",
                lineHeight: 1.4,
              }}
            >
              {v.note || `${name} check flagged.`}
            </div>
          ))}
        </div>
      )}

      {caveats.length > 0 && (
        <ul
          style={{
            margin: "10px 0 0",
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {caveats.map((c, i) => (
            <li
              key={i}
              style={{
                fontSize: 11.5,
                color: C.textSecondary,
                lineHeight: 1.45,
              }}
            >
              {c}
            </li>
          ))}
        </ul>
      )}

      <div
        style={{
          fontSize: 10.5,
          color: C.textSecondary,
          marginTop: 10,
          lineHeight: 1.4,
        }}
      >
        {record.engine_version || "engine"} ·{" "}
        {record.derived_by || "unknown author"}
        {record.created_at
          ? ` · recorded ${String(record.created_at).slice(0, 10)}`
          : ""}
        {match.alsoCount > 0
          ? ` · ${match.alsoCount} other record${match.alsoCount === 1 ? "" : "s"} on this account`
          : ""}
        {" · source of truth: budget_assumption_explanations"}
      </div>
    </Shell>
  );
}
