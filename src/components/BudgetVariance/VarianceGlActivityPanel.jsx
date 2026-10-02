import React from "react";
import { formatCurrencyFull, EMPTY } from "../../lib/numberFormat.js";
import {
  GL_ACTIVITY_COVERAGE,
  GL_ACTIVITY_EXCLUSION_COPY,
  GL_ACTIVITY_RECONCILIATION,
} from "../../lib/varianceGlActivity.js";

const COVERAGE_COPY = {
  [GL_ACTIVITY_COVERAGE.UNKNOWN]:
    "Detailed GL coverage has not been confirmed for this period.",
  [GL_ACTIVITY_COVERAGE.NOT_LOADED]:
    "Detailed GL activity has not been loaded for this period.",
  [GL_ACTIVITY_COVERAGE.PARTIAL]:
    "Only part of the requested detailed GL activity is loaded.",
  [GL_ACTIVITY_COVERAGE.OUTSIDE_HELD_WINDOW]:
    "This period is outside the detailed GL history currently held.",
  [GL_ACTIVITY_COVERAGE.DEFERRED]:
    "GL account membership is still being resolved for this figure.",
  [GL_ACTIVITY_COVERAGE.UNRESOLVABLE]:
    "This figure cannot be resolved to GL accounts.",
  [GL_ACTIVITY_COVERAGE.UNSUPPORTED]:
    "This figure does not have a live GL side.",
  [GL_ACTIVITY_COVERAGE.ERROR]: "Detailed GL coverage could not be confirmed.",
  [GL_ACTIVITY_COVERAGE.COMPLETE_EMPTY]:
    "The detailed GL pull completed and returned no activity.",
};

function valueOrEmpty(value) {
  return value == null || value === "" ? EMPTY : String(value);
}

function money(value) {
  return value == null
    ? EMPTY
    : formatCurrencyFull(Number(value), { fullDecimals: 2 });
}

function Reconciliation({ entry, theme }) {
  const { sub, green, red, amber } = theme;
  const recon = entry.reconciliation;
  if (!recon) return null;

  if (recon.state === GL_ACTIVITY_RECONCILIATION.MATCHED) {
    return (
      <div style={{ color: green }}>
        Detailed GL activity matches the selected Actual.
      </div>
    );
  }
  if (recon.state === GL_ACTIVITY_RECONCILIATION.MISMATCHED) {
    return (
      <div style={{ color: red }}>
        Detailed GL activity differs from the selected Actual by{" "}
        {money(recon.delta)}.
      </div>
    );
  }
  if (recon.state === GL_ACTIVITY_RECONCILIATION.NOT_COMPARABLE) {
    const reason = GL_ACTIVITY_EXCLUSION_COPY[recon.excludedReason];
    return (
      <div style={{ color: sub }}>
        Detailed GL activity cannot be compared to the selected Actual
        {reason ? ` because ${reason}` : ""}.
      </div>
    );
  }
  if (recon.state === GL_ACTIVITY_RECONCILIATION.PARTIAL) {
    return (
      <div style={{ color: amber }}>
        Only the account-backed portion can be reconciled.
      </div>
    );
  }
  if (recon.state === GL_ACTIVITY_RECONCILIATION.UNTESTED) {
    return (
      <div style={{ color: sub }}>
        Reconciliation is not available for this figure.
      </div>
    );
  }
  return null;
}

function Summary({ entry, theme }) {
  const { text, sub, border, surface } = theme;
  const summary = entry.summary;
  if (!summary) return null;

  const items = [
    ["Beginning balance", summary.beginning_balance],
    ["Raw net change", summary.raw_activity_total],
    ["Actual-sign activity", summary.presentation_activity_total],
    ["Ending balance", summary.ending_balance],
  ].filter(
    ([label, value]) =>
      !label.toLowerCase().includes("balance") || value != null,
  );
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        border: `1px solid ${border}`,
        background: surface,
        borderRadius: 6,
        margin: "10px 0",
      }}
    >
      {items.map(([label, value]) => (
        <div key={label} style={{ padding: "8px 10px", minWidth: 0 }}>
          <div
            style={{
              color: sub,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {label}
          </div>
          <div
            style={{
              color: text,
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {money(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function LedgerTable({ rows, theme }) {
  const { text, sub, border, surface } = theme;
  const columns = [
    [
      "Account",
      (row) =>
        [row.gl_account_number, row.gl_account_name]
          .filter(Boolean)
          .join(" · "),
    ],
    ["Transaction Date", (row) => row.transaction_date],
    ["Post Date", (row) => row.post_date],
    ["Post Month", (row) => row.post_month],
    ["Reference", (row) => row.reference],
    ["Transaction Type", (row) => row.transaction_type],
    ["Memo / Note", (row) => row.memo],
    ["BLDG-Unit", (row) => row.unit_number],
    ["Resident / Vendor", (row) => row.vendor_name],
    ["Net Change", (row) => money(row.net_change)],
    ["Debit", (row) => money(row.debit)],
    ["Credit", (row) => money(row.credit)],
    ["Balance", (row) => money(row.balance)],
    ["Beginning Balance", (row) => money(row.beginning_balance)],
  ];

  return (
    <div
      style={{
        overflowX: "auto",
        border: `1px solid ${border}`,
        borderRadius: 6,
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          minWidth: 1500,
          width: "100%",
          color: text,
          fontSize: 11,
        }}
      >
        <caption
          style={{
            textAlign: "left",
            color: sub,
            padding: "8px 10px",
            background: surface,
          }}
        >
          Entrata GL activity. Credits retain Entrata&apos;s negative sign.
        </caption>
        <thead>
          <tr style={{ background: surface }}>
            {columns.map(([label]) => (
              <th
                key={label}
                scope="col"
                style={{
                  borderTop: `1px solid ${border}`,
                  borderBottom: `1px solid ${border}`,
                  padding: "7px 8px",
                  textAlign: [
                    "Net Change",
                    "Debit",
                    "Credit",
                    "Balance",
                    "Beginning Balance",
                  ].includes(label)
                    ? "right"
                    : "left",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.gl_detail_id}>
              {columns.map(([label, read]) => (
                <td
                  key={label}
                  style={{
                    borderBottom: `1px solid ${border}`,
                    padding: "7px 8px",
                    textAlign: [
                      "Net Change",
                      "Debit",
                      "Credit",
                      "Balance",
                      "Beginning Balance",
                    ].includes(label)
                      ? "right"
                      : "left",
                    whiteSpace: ["Memo / Note", "Account"].includes(label)
                      ? "normal"
                      : "nowrap",
                    fontVariantNumeric: [
                      "Net Change",
                      "Debit",
                      "Credit",
                      "Balance",
                      "Beginning Balance",
                    ].includes(label)
                      ? "tabular-nums"
                      : undefined,
                  }}
                >
                  {valueOrEmpty(read(row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rangeText(target) {
  if (!target?.monthFrom) return "";
  return target.monthTo && target.monthTo !== target.monthFrom
    ? `${target.monthFrom} through ${target.monthTo}`
    : target.monthFrom;
}

function LedgerSide({
  entry,
  colors,
  heading = null,
  hasPrevious = false,
  onPreviousPage,
  onNextPage,
}) {
  if (!entry || entry.loading) {
    return (
      <div>
        {heading}
        <div aria-live="polite" style={{ color: colors.sub, marginTop: 10 }}>
          Loading detailed GL activity…
        </div>
      </div>
    );
  }
  if (entry.error) {
    return (
      <div>
        {heading}
        <div role="alert" style={{ color: colors.red, marginTop: 10 }}>
          Could not load detailed GL activity.{" "}
          {entry.error?.message ? String(entry.error.message) : ""}
        </div>
      </div>
    );
  }

  const rows = Array.isArray(entry.rows) ? entry.rows : [];
  const copy = COVERAGE_COPY[entry.coverage];
  const page = entry.page ?? {};
  const total = Number(page.total_count ?? rows.length);

  return (
    <div style={{ minWidth: 0 }}>
      {heading}

      {copy ? (
        <div
          role={
            entry.coverage === GL_ACTIVITY_COVERAGE.ERROR ? "alert" : "status"
          }
          style={{
            color:
              entry.coverage === GL_ACTIVITY_COVERAGE.ERROR
                ? colors.red
                : colors.sub,
            marginTop: 10,
          }}
        >
          {copy}
        </div>
      ) : null}

      <Summary entry={entry} theme={colors} />
      <Reconciliation entry={entry} theme={colors} />

      {rows.length > 0 ? <LedgerTable rows={rows} theme={colors} /> : null}

      {rows.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 8,
          }}
        >
          <span style={{ color: colors.sub }}>
            Showing {rows.length} of {total} lines.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {hasPrevious && onPreviousPage ? (
              <button type="button" onClick={onPreviousPage}>
                Previous
              </button>
            ) : null}
            {page.has_more && onNextPage ? (
              <button
                type="button"
                onClick={() => onNextPage(page.next_cursor)}
              >
                Next
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SideHeading({ label, target, colors }) {
  return (
    <div
      style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 6 }}
    >
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div style={{ color: colors.sub, marginTop: 2 }}>{rangeText(target)}</div>
    </div>
  );
}

function PanelHeader({ target, onClose, colors }) {
  return (
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
          {target?.label || "GL activity"}
        </div>
        <div style={{ color: colors.sub, marginTop: 2 }}>
          {rangeText(target)}
        </div>
      </div>
      {onClose ? (
        <button type="button" onClick={onClose}>
          Close
        </button>
      ) : null}
    </div>
  );
}

export default function VarianceGlActivityPanel({
  entry,
  onClose,
  onPreviousPage,
  onNextPage,
  hasPrevious = false,
  contextEntry = null,
  onContextPreviousPage,
  onContextNextPage,
  hasContextPrevious = false,
  theme = {},
}) {
  const colors = {
    text: theme.text ?? "#111827",
    sub: theme.sub ?? "#6b7280",
    border: theme.border ?? "#d1d5db",
    surface: theme.surface ?? "#f9fafb",
    green: theme.green ?? "#15803d",
    red: theme.red ?? "#b91c1c",
    amber: theme.amber ?? "#a16207",
  };

  const sectionLabel = entry?.target?.label
    ? `GL activity for ${entry.target.label}`
    : "GL activity";

  if (!contextEntry) {
    return (
      <section
        aria-label={!entry || entry.loading ? "GL activity" : sectionLabel}
        style={{ color: colors.text, fontSize: 12 }}
      >
        <PanelHeader target={entry?.target} onClose={onClose} colors={colors} />
        <LedgerSide
          entry={entry}
          colors={colors}
          hasPrevious={hasPrevious}
          onPreviousPage={onPreviousPage}
          onNextPage={onNextPage}
        />
      </section>
    );
  }

  return (
    <section
      aria-label={sectionLabel}
      style={{ color: colors.text, fontSize: 12 }}
    >
      <PanelHeader target={entry?.target} onClose={onClose} colors={colors} />
      <div style={{ color: colors.sub, marginTop: 4 }}>
        Both selected periods, side by side. Only the comparison side is
        reconciled to the figure you clicked; the other window is the plan
        period it is read against.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginTop: 10,
        }}
      >
        <LedgerSide
          entry={contextEntry}
          colors={colors}
          heading={
            <SideHeading
              label="This side"
              target={contextEntry?.target}
              colors={colors}
            />
          }
          hasPrevious={hasContextPrevious}
          onPreviousPage={onContextPreviousPage}
          onNextPage={onContextNextPage}
        />
        <LedgerSide
          entry={entry}
          colors={colors}
          heading={
            <SideHeading
              label="Against"
              target={entry?.target}
              colors={colors}
            />
          }
          hasPrevious={hasPrevious}
          onPreviousPage={onPreviousPage}
          onNextPage={onNextPage}
        />
      </div>
    </section>
  );
}
