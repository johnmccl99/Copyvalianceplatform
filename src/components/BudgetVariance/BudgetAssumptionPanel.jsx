import React from "react";
import {
  RULE_LABELS,
  KIND_LABELS,
} from "../../lib/budgetAssumptionExplanations.js";
import {
  resolveAssumptionPresentation,
  RECORD_SCOPE_UNSCOPED,
  ANALYSIS_MODE_VARIANCE,
  ANALYSIS_MODE_GROUP,
} from "../../lib/budgetAssumptionDrill.js";
import { formatStatementMoney } from "../../lib/statementPresentation.js";
import { formatMonthLabel } from "../../lib/dateFormat.js";

function fmtWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function Section({ title, badge, children, theme }) {
  return (
    <section style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {title}
        </div>
        {badge ? (
          <span
            style={{
              fontSize: 11,
              color: theme.sub,
              border: `1px solid ${theme.border}`,
              borderRadius: 4,
              padding: "0 6px",
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div style={{ marginTop: 6 }}>{children}</div>
    </section>
  );
}

function inputsSentence(inputs) {
  if (!inputs) return null;
  if (inputs.mode === ANALYSIS_MODE_GROUP) {
    return `Inputs supplied: ${inputs.budget_months || 0} sealed budget month${inputs.budget_months === 1 ? "" : "s"}${inputs.period_label ? ` (${inputs.period_label})` : ""}; ${inputs.actual_months || 0} actual month${inputs.actual_months === 1 ? "" : "s"}; ${inputs.member_accounts || 0} member account${inputs.member_accounts === 1 ? "" : "s"} (${inputs.members || 0} listed with period figures).`;
  }
  const parts = [];
  const variance = inputs.mode === ANALYSIS_MODE_VARIANCE;
  if (inputs.budget_months)
    parts.push(
      `${inputs.budget_months} sealed budget month${inputs.budget_months === 1 ? "" : "s"}${inputs.period_label ? ` (${inputs.period_label})` : ""}`,
    );
  if (variance && inputs.actual_months)
    parts.push(
      `${inputs.actual_months} actual month${inputs.actual_months === 1 ? "" : "s"}`,
    );
  parts.push(
    inputs.gl_history_months
      ? `${inputs.gl_history_months} months of ${variance ? "" : "pre-budget "}GL actuals${inputs.gl_history_from ? ` (${inputs.gl_history_from} to ${inputs.gl_history_to})` : ""}${inputs.gl_history_truncated ? ", capped" : ""}`
      : "no GL history",
  );
  parts.push(
    inputs.itemized_lines
      ? `${inputs.itemized_lines} itemized workbook line${inputs.itemized_lines === 1 ? "" : "s"}${inputs.itemized_truncated ? " (more exist; evidence is partial)" : ""}`
      : "no itemized lines",
  );
  parts.push(
    inputs.stored_records
      ? `${inputs.stored_records} stored explanation record${inputs.stored_records === 1 ? "" : "s"}`
      : "no stored explanation",
  );
  parts.push(
    inputs.derivation_rule
      ? `derivation engine result ${RULE_LABELS[inputs.derivation_rule] || inputs.derivation_rule} (${inputs.derivation_confidence || "ungraded"})`
      : "no derivation engine result",
  );
  const unavailable =
    Array.isArray(inputs.reads_unavailable) && inputs.reads_unavailable.length
      ? ` Unavailable to the analysis: ${inputs.reads_unavailable.join(", ").replace(/_/g, " ")}.`
      : "";
  return `Inputs supplied: ${parts.join("; ")}.${unavailable}`;
}

export const STORED_ANALYSIS_LABEL =
  "Stored copy — generated once and served since";
export const REFRESH_ANALYSIS_LABEL = "Refresh";

function GeneratedAnalysis({
  analysis,
  inputs,
  model,
  generatedAt,
  stored = false,
  onRefresh,
  refreshing = false,
  theme,
  variance = false,
  group = false,
}) {
  return (
    <Section
      title={variance || group ? "Generated explanation" : "Generated analysis"}
      badge={
        variance || group
          ? "AI-generated · not a recorded finding"
          : "AI-generated · not a recorded assumption"
      }
      theme={theme}
    >
      <p style={{ margin: 0 }}>{analysis.summary}</p>
      {group ? (
        <>
          {[
            ["Budget", analysis.budget],
            ["Actual", analysis.actual],
            ["Variance", analysis.variance],
          ].map(([title, lines]) =>
            lines?.length ? (
              <div key={title} style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                  {lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </>
      ) : null}
      {!group && analysis.reasoning?.length ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {analysis.reasoning.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      {analysis.caveats?.length ? (
        <div style={{ marginTop: 6, color: theme.sub }}>
          <div style={{ fontWeight: 600 }}>What the data cannot show</div>
          <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
            {analysis.caveats.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div style={{ marginTop: 8, color: theme.sub, fontSize: 11 }}>
        {inputsSentence(inputs)}
        {model ? ` Model: ${model}.` : ""}
        {fmtWhen(generatedAt) ? ` Generated ${fmtWhen(generatedAt)}.` : ""}
        {stored ? ` ${STORED_ANALYSIS_LABEL}.` : ""}
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Regenerate this explanation"
            title="Ask the model again for this figure only and replace the stored copy"
            style={{
              marginLeft: 8,
              border: `1px solid ${theme.border}`,
              background: "transparent",
              color: "inherit",
              borderRadius: 4,
              padding: "1px 6px",
              cursor: refreshing ? "default" : "pointer",
              font: "inherit",
              fontSize: 11,
            }}
          >
            {refreshing ? "Refreshing…" : REFRESH_ANALYSIS_LABEL}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

export const UNSCOPED_RECORD_LABEL = "Recorded before baseline scoping";
export const UNSCOPED_RECORD_NOTE =
  "This explanation carries no budget type, so it cannot be tied to the selected budget alone. It is shown because the selected budget has no explanation of its own for this account.";

function StoredRecord({ record, recordScope, theme }) {
  const unscoped = recordScope === RECORD_SCOPE_UNSCOPED;
  return (
    <Section
      title={unscoped ? "Stored explanation (unscoped)" : "Stored explanation"}
      badge={`${KIND_LABELS[record.record_kind] || record.record_kind} · FY ${record.fiscal_year}`}
      theme={theme}
    >
      {unscoped ? (
        <div
          role="note"
          style={{
            marginBottom: 6,
            padding: "4px 8px",
            borderLeft: `3px solid ${theme.amber || theme.border}`,
            fontSize: 12,
          }}
        >
          <strong>{UNSCOPED_RECORD_LABEL}.</strong> {UNSCOPED_RECORD_NOTE}
        </div>
      ) : null}
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{record.narrative}</p>
    </Section>
  );
}

export function BudgetYearStrip({ months, focusMonth, theme }) {
  if (!Array.isArray(months) || months.length === 0) return null;
  const focused = months.find((m) => m.month === focusMonth) || null;
  return (
    <Section
      title={
        focused
          ? `Budget \u00b7 ${formatMonthLabel(focused.month)}`
          : "Budget by month"
      }
      badge={
        focused
          ? "selected month \u00b7 full year shown for context"
          : "full year"
      }
      theme={theme}
    >
      {focused ? (
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatStatementMoney(focused.amount)}
        </div>
      ) : null}
      <ol
        aria-label="Budget by month for the fiscal year"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          listStyle: "none",
          margin: "6px 0 0",
          padding: 0,
        }}
      >
        {months.map((m) => {
          const isFocus = m.month === focusMonth;
          return (
            <li
              key={m.month}
              aria-current={isFocus ? "true" : undefined}
              style={{
                border: `${isFocus ? 2 : 1}px solid ${isFocus ? "currentColor" : theme.border}`,
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 12,
                fontWeight: isFocus ? 700 : 400,
                color: isFocus ? "inherit" : theme.sub,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.3,
                }}
              >
                {formatMonthLabel(m.month)}
              </span>
              {formatStatementMoney(m.amount)}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

export function VarianceFigures({ figures, focusMonth, theme }) {
  if (!figures) return null;
  const cells = [
    ["Budgeted", figures.budget],
    ["Actual", figures.actual],
    ["Variance", figures.variance],
  ];
  return (
    <Section
      title={
        focusMonth
          ? `Variance \u00b7 ${formatMonthLabel(focusMonth)}`
          : "Variance \u00b7 selected period"
      }
      theme={theme}
    >
      <dl style={{ display: "flex", gap: 18, margin: 0, flexWrap: "wrap" }}>
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 0.3,
                color: theme.sub,
              }}
            >
              {label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value === null || value === undefined
                ? "\u2014"
                : formatStatementMoney(value)}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export const ANALYSIS_LOADING_COPY = "Analysing the budgeting logic…";
export const VARIANCE_LOADING_COPY =
  "Explaining budgeted vs actual vs variance…";
export const GROUP_LOADING_COPY =
  "Summarising the group's budget, actual and variance…";
export const ANALYSIS_RETRYING_COPY =
  "The first attempt did not complete — retrying…";

export default function BudgetAssumptionPanel({
  accountLabel,
  groupKey = null,
  fiscalYear,
  budgetDisplay,
  focusMonth = null,
  yearMonths = [],
  mode = null,
  varianceFigures = null,
  loading,
  analysis,
  analysisInputs,
  analysisModel,
  analysisGeneratedAt,
  analysisStored = false,
  onRefreshAnalysis,
  analysisError,
  analysisRetrying = false,
  onRetryAnalysis,
  record,
  recordScope,
  recordError,
  onClose,
  theme,
}) {
  const presentation = resolveAssumptionPresentation({
    loading,
    analysis,
    analysisError,
    record,
    recordError,
  });
  const isVariance = mode === ANALYSIS_MODE_VARIANCE;
  const isGroup = mode === ANALYSIS_MODE_GROUP;
  const analysingCopy = analysisRetrying
    ? ANALYSIS_RETRYING_COPY
    : isGroup
      ? GROUP_LOADING_COPY
      : isVariance
        ? VARIANCE_LOADING_COPY
        : ANALYSIS_LOADING_COPY;
  return (
    <div style={{ fontSize: 13 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {isGroup
              ? "Group summary"
              : isVariance
                ? "Variance explanation"
                : "Budget assumption"}{" "}
            — {accountLabel}
          </div>
          <div style={{ color: theme.sub, marginTop: 2 }}>
            {fiscalYear ? `Sealed budget FY ${fiscalYear}` : "Sealed budget"}
            {budgetDisplay ? ` · budget ${budgetDisplay}` : ""}
            {focusMonth ? ` · ${formatMonthLabel(focusMonth)} selected` : ""}
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${theme.border}`,
              background: "transparent",
              color: "inherit",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Close
          </button>
        ) : null}
      </div>

      {isVariance || isGroup ? (
        <VarianceFigures
          figures={varianceFigures}
          focusMonth={focusMonth}
          theme={theme}
        />
      ) : (
        <BudgetYearStrip
          months={yearMonths}
          focusMonth={focusMonth}
          theme={theme}
        />
      )}

      {presentation === "loading" ? (
        <div aria-live="polite" style={{ color: theme.sub, marginTop: 10 }}>
          {analysingCopy}
        </div>
      ) : null}

      {analysis ? (
        <GeneratedAnalysis
          analysis={analysis}
          inputs={analysisInputs}
          model={analysisModel}
          generatedAt={analysisGeneratedAt}
          stored={analysisStored}
          onRefresh={onRefreshAnalysis}
          refreshing={loading}
          theme={theme}
          variance={isVariance}
          group={isGroup}
        />
      ) : analysisError ? (
        <div role="alert" style={{ color: theme.red, marginTop: 10 }}>
          Generated analysis unavailable: {analysisError}
          {onRetryAnalysis ? (
            <button
              type="button"
              onClick={onRetryAnalysis}
              style={{
                marginLeft: 8,
                border: `1px solid ${theme.border}`,
                background: "transparent",
                color: "inherit",
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                font: "inherit",
                fontSize: 12,
              }}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : loading && (record || recordError) ? (
        <div aria-live="polite" style={{ color: theme.sub, marginTop: 10 }}>
          {analysingCopy}
        </div>
      ) : null}

      {record ? (
        <StoredRecord record={record} recordScope={recordScope} theme={theme} />
      ) : null}
      {!record && recordError ? (
        <div role="alert" style={{ color: theme.red, marginTop: 10 }}>
          Stored explanation could not be read: {recordError}
        </div>
      ) : null}
      {!isGroup && !record && !recordError && analysis && !loading ? (
        <div style={{ color: theme.sub, marginTop: 10 }}>
          No stored explanation record for this account and fiscal year.
        </div>
      ) : null}

      {presentation === "none" ? (
        <div style={{ color: theme.sub, marginTop: 10 }}>
          No assumption found for this account and fiscal year.
        </div>
      ) : null}
    </div>
  );
}
