import React, { useState } from "react";
import {
  analyzeDryRun,
  oldNewForChange,
  rowFlags,
  matchScope,
  scopeLabel,
  FLAG_META,
} from "./budgetAgentAnalysis.js";

export function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${v < 0 ? "-" : v > 0 ? "+" : ""}$${s}`;
}

export function fmtValue(v) {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "number")
    return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(v);
}

const FIELD_LABELS = {
  amount: "Amount",
  frequency: "Frequency",
  first_month: "First month",
  last_month: "Last month",
  assumption_value: "Assumption value",
};

const PAGINATE_ABOVE_TOTAL = 50;
const ROWS_PER_PROPERTY_DEFAULT = 20;

export function Pill({ t, tone = "neutral", children, title }) {
  const map = {
    neutral: { bg: t.inset, fg: t.sub, bd: t.border },
    ok: { bg: "rgba(34,197,94,0.12)", fg: t.ok, bd: t.ok },
    warn: { bg: "rgba(245,158,11,0.12)", fg: t.warn, bd: t.warn },
    danger: { bg: "rgba(239,68,68,0.12)", fg: t.danger, bd: t.danger },
    accent: { bg: "rgba(59,130,246,0.12)", fg: t.accent, bd: t.accent },
  };
  const c = map[tone] || map.neutral;
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        padding: "1px 7px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function FlagPills({ t, flags }) {
  if (!Array.isArray(flags) || flags.length === 0) return null;
  const order = { danger: 0, warn: 1, neutral: 2 };
  const sorted = [...flags]
    .map((f) => ({ f, meta: FLAG_META[f] }))
    .filter((x) => x.meta)
    .sort((a, b) => (order[a.meta.tone] ?? 3) - (order[b.meta.tone] ?? 3));
  return (
    <>
      {sorted.map(({ f, meta }) => (
        <span key={f} style={{ marginLeft: 4 }}>
          <Pill t={t} tone={meta.tone} title={meta.tip}>
            ⚠ {meta.label}
          </Pill>
        </span>
      ))}
    </>
  );
}

export function OldNew({ t, oldValue, newValue }) {
  const cell = { fontSize: 12.5, fontWeight: 600, color: t.text };
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={cell}>{fmtValue(oldValue)}</span>
      <span style={{ color: t.sub, margin: "0 5px" }}>→</span>
      <span style={cell}>{fmtValue(newValue)}</span>
    </span>
  );
}

function Card({ t, tone, children }) {
  const border =
    tone === "danger"
      ? t.danger
      : tone === "warn"
        ? t.warn
        : tone === "ok"
          ? t.ok
          : t.border;
  return (
    <div
      style={{
        background: t.card,
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${border}`,
        borderRadius: 8,
        padding: 14,
        marginTop: 10,
      }}
    >
      {children}
    </div>
  );
}

const cardH = (t) => ({
  fontSize: 13,
  fontWeight: 700,
  color: t.text,
  margin: "0 0 6px 0",
});
const cardHelp = (t) => ({
  fontSize: 12,
  color: t.sub,
  margin: "0 0 8px 0",
  lineHeight: 1.5,
});
const thStyle = (t) => ({
  textAlign: "left",
  padding: "5px 8px",
  fontSize: 11,
  fontWeight: 700,
  color: t.sub,
  borderBottom: `1px solid ${t.border}`,
  whiteSpace: "nowrap",
});
const tdStyle = (t) => ({
  padding: "5px 8px",
  fontSize: 12.5,
  color: t.text,
  borderBottom: `1px solid ${t.border}`,
});

function lineLabel(ch) {
  if (ch.target === "pdpq")
    return `${ch.category || "pdpq"} · ${ch.match?.assumption_key || "(key)"}`;
  const acct = ch.match?.account_number || "(acct)";
  return `${ch.category || "—"} · ${acct}`;
}

export function AnomaliesBanner({ t, anomalies }) {
  if (!Array.isArray(anomalies) || anomalies.length === 0) return null;
  return (
    <div
      style={{
        border: `1px solid ${t.danger}`,
        borderLeft: `3px solid ${t.danger}`,
        borderRadius: 6,
        background: "rgba(239,68,68,0.07)",
        padding: "9px 11px",
        margin: "4px 0 10px",
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: t.danger,
          marginBottom: 5,
        }}
      >
        {anomalies.length} figure{anomalies.length === 1 ? "" : "s"} look
        anomalous — verify before you apply
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {anomalies.map(({ row, flags }, i) => {
          const label =
            row.target === "pdpq"
              ? row.assumption_key
              : `${row.account_number || ""}${row.line_description ? ` · ${row.line_description}` : ""}`;
          return (
            <div
              key={i}
              style={{ fontSize: 12, color: t.text, lineHeight: 1.5 }}
            >
              <strong style={{ color: t.text }}>{row.property_code}</strong>
              <span style={{ color: t.sub }}>
                {" "}
                · {label} · {FIELD_LABELS[row.field] || row.field}:{" "}
              </span>
              <OldNew t={t} oldValue={row.old_value} newValue={row.new_value} />
              <FlagPills t={t} flags={flags} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProposalCard({ t, proposal, dryRun }) {
  if (!proposal) return null;
  const changes = Array.isArray(proposal.change_set?.changes)
    ? proposal.change_set.changes
    : [];
  const codes = Array.isArray(proposal.property_codes)
    ? proposal.property_codes
    : [];
  const dryResult = dryRun?.result || null;
  const analysis = dryResult ? analyzeDryRun(dryResult) : null;

  return (
    <Card t={t} tone="accent">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <h4 style={cardH(t)}>{proposal.name || "Proposed forecast change"}</h4>
        <Pill t={t} tone="accent">
          Proposal — nothing applied yet
        </Pill>
      </div>
      {proposal.rationale ? (
        <p style={cardHelp(t)}>{proposal.rationale}</p>
      ) : null}
      <div style={{ fontSize: 12, color: t.sub, marginBottom: 8 }}>
        <strong style={{ color: t.text }}>{codes.length}</strong> propert
        {codes.length === 1 ? "y" : "ies"}: {codes.join(", ")}
      </div>

      {analysis ? (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
            padding: "7px 10px",
            borderRadius: 6,
            marginBottom: 10,
            background: analysis.hasAnomalies
              ? "rgba(239,68,68,0.07)"
              : t.inset,
            border: `1px solid ${analysis.hasAnomalies ? t.danger : t.border}`,
          }}
        >
          <span style={{ fontSize: 12, color: t.sub }}>
            Net forecast impact
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>
            {fmtMoney(analysis.crossPropertyTotal)}
          </span>
          <span style={{ fontSize: 12, color: t.sub }}>
            over {analysis.rowCount} matched row
            {analysis.rowCount === 1 ? "" : "s"}
          </span>
          {analysis.hasAnomalies ? (
            <Pill t={t} tone="danger">
              {analysis.anomalies.length} anomal
              {analysis.anomalies.length === 1 ? "y" : "ies"} — see blast radius
            </Pill>
          ) : null}
        </div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}
        >
          <thead>
            <tr>
              {["Line", "Scope", "Field", "Current → Proposed"].map((h) => (
                <th key={h} style={thStyle(t)}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {changes.map((ch, i) => {
              const scope = matchScope(ch);
              const wildcard = scope === "account";
              const on = analysis
                ? oldNewForChange(i, ch, dryResult, analysis.ctx)
                : { status: "pending", flags: [] };
              const label =
                ch.target === "pdpq"
                  ? lineLabel(ch)
                  : `${lineLabel(ch)}${ch.match?.line_description ? ` · ${ch.match.line_description}` : ""}`;
              return (
                <tr key={i}>
                  <td style={tdStyle(t)}>{label}</td>
                  <td style={{ ...tdStyle(t), whiteSpace: "nowrap" }}>
                    {wildcard ? (
                      <Pill
                        t={t}
                        tone="warn"
                        title="An absent line description matches EVERY line under this account — the widest possible scope."
                      >
                        {scopeLabel(ch)}
                      </Pill>
                    ) : (
                      <span style={{ fontSize: 12, color: t.sub }}>
                        {scopeLabel(ch)}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle(t), whiteSpace: "nowrap" }}>
                    {FIELD_LABELS[ch.field] || ch.field}
                  </td>
                  <td style={{ ...tdStyle(t) }}>
                    {on.status === "pending" ? (
                      <span style={{ whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 12.5, color: t.sub }}>
                          (dry-run pending)
                        </span>
                        <span style={{ color: t.sub, margin: "0 5px" }}>→</span>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: t.text,
                          }}
                        >
                          {fmtValue(ch.new_value)}
                        </span>
                      </span>
                    ) : on.status === "varies" ? (
                      <span style={{ whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: t.text,
                          }}
                          title="Matched rows have different current values — see the blast radius below."
                        >
                          {on.range
                            ? `${fmtValue(on.range.min)}–${fmtValue(on.range.max)}`
                            : `varies (${on.oldValues.length})`}
                        </span>
                        <span style={{ color: t.sub, margin: "0 5px" }}>→</span>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: t.text,
                          }}
                        >
                          {fmtValue(ch.new_value)}
                        </span>
                      </span>
                    ) : (
                      <OldNew
                        t={t}
                        oldValue={on.oldDisplay}
                        newValue={ch.new_value}
                      />
                    )}
                    {ch.target === "pdpq" ? (
                      <span style={{ marginLeft: 4 }}>
                        <Pill t={t} tone="neutral">
                          records only
                        </Pill>
                      </span>
                    ) : null}
                    <FlagPills t={t} flags={on.flags} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {Array.isArray(proposal.citations) && proposal.citations.length > 0 ? (
        <div style={{ fontSize: 11, color: t.sub, marginTop: 8 }}>
          Basis: {proposal.citations.join("; ")}
        </div>
      ) : null}
    </Card>
  );
}

export function BlastRadiusCard({ t, dryRun, tokenExpired }) {
  const [showAll, setShowAll] = useState(false);

  if (dryRun.running) {
    return (
      <Card t={t}>
        <div style={{ fontSize: 12.5, color: t.sub }}>
          Running dry-run — computing the blast radius…
        </div>
      </Card>
    );
  }
  if (dryRun.error) {
    return (
      <Card t={t} tone="danger">
        <div style={{ fontSize: 12.5, color: t.danger }}>{dryRun.error}</div>
      </Card>
    );
  }
  const r = dryRun.result;
  if (!r) return null;
  const props = Array.isArray(r.properties) ? r.properties : [];
  const unmatched = Array.isArray(r.unmatched_properties)
    ? r.unmatched_properties
    : [];
  const total = r.rows_matched_total ?? 0;
  const analysis = analyzeDryRun(r);
  const flagKey = (p, row) =>
    `${p.property_code}|${row.change_index}|${row.row_id ?? ""}|${row.account_number ?? row.assumption_key ?? ""}|${row.line_description ?? ""}`;
  const flagsByKey = new Map();
  for (const p of props) {
    for (const row of Array.isArray(p.rows) ? p.rows : []) {
      flagsByKey.set(flagKey(p, row), rowFlags(row, analysis.ctx));
    }
  }
  const expandAll = showAll || total <= PAGINATE_ABOVE_TOTAL;

  return (
    <Card
      t={t}
      tone={analysis.hasAnomalies ? "danger" : total > 0 ? "ok" : "warn"}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h4 style={cardH(t)}>Blast radius</h4>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {tokenExpired ? (
            <Pill t={t} tone="danger">
              Preview expired — re-run
            </Pill>
          ) : r.expires_at ? (
            <Pill t={t} tone="neutral">
              expires {new Date(r.expires_at).toLocaleTimeString()}
            </Pill>
          ) : null}
          <Pill t={t} tone={total > 0 ? "ok" : "warn"}>
            {total} row{total === 1 ? "" : "s"} matched
          </Pill>
        </div>
      </div>

      {total > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 12, color: t.sub }}>
            Net forecast impact
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: t.text }}>
            {fmtMoney(analysis.crossPropertyTotal)}
          </span>
          <span style={{ fontSize: 12, color: t.sub }}>
            across {props.filter((p) => p.status !== "no_matches").length}{" "}
            propert
            {props.filter((p) => p.status !== "no_matches").length === 1
              ? "y"
              : "ies"}
          </span>
        </div>
      ) : null}

      {analysis.hasAnomalies ? (
        <AnomaliesBanner t={t} anomalies={analysis.anomalies} />
      ) : null}

      {total > 0 ? (
        <div
          style={{
            fontSize: 11.5,
            color: t.sub,
            margin: "0 0 8px",
            lineHeight: 1.5,
          }}
        >
          Flags catch large jumps, sign flips, and dollar outliers — they are a
          scan aid, not a completeness check. Read every line before you apply.
        </div>
      ) : null}

      {unmatched.length > 0 ? (
        <div style={{ fontSize: 12, color: t.warn, margin: "4px 0 8px" }}>
          No matching lines in: {unmatched.join(", ")} — a finding, not a skip
          (row structure may have drifted).
        </div>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}
        >
          <thead>
            <tr>
              {["Property", "Status", "Rows", "Δ forecast"].map((h) => (
                <th key={h} style={thStyle(t)}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.map((p, i) => {
              const ok = p.status !== "no_matches";
              const rows = Array.isArray(p.rows) ? p.rows : [];
              const hasFlaggedRow = rows.some(
                (row) => (flagsByKey.get(flagKey(p, row)) || []).length > 0,
              );
              const visible =
                expandAll || hasFlaggedRow
                  ? rows
                  : rows.slice(0, ROWS_PER_PROPERTY_DEFAULT);
              const hidden = rows.length - visible.length;
              return (
                <React.Fragment key={p.property_code || i}>
                  <tr>
                    <td style={tdStyle(t)}>{p.property_code}</td>
                    <td
                      style={{
                        padding: "5px 8px",
                        borderBottom: `1px solid ${t.border}`,
                      }}
                    >
                      {ok ? (
                        <Pill t={t} tone="ok">
                          matched
                        </Pill>
                      ) : (
                        <Pill t={t} tone="warn">
                          no matches
                        </Pill>
                      )}
                    </td>
                    <td style={tdStyle(t)}>{p.rows_matched ?? 0}</td>
                    <td style={{ ...tdStyle(t), fontWeight: 600 }}>
                      {fmtMoney(p.delta_total)}
                    </td>
                  </tr>
                  {visible.length > 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "0 8px 8px 20px",
                          borderBottom: `1px solid ${t.border}`,
                        }}
                      >
                        {visible.map((row, j) => {
                          const flags = flagsByKey.get(flagKey(p, row)) || [];
                          const anomalous = flags.length > 0;
                          const label =
                            row.target === "pdpq"
                              ? row.assumption_key
                              : `${row.account_number || ""}${row.line_description ? ` · ${row.line_description}` : ""}`;
                          return (
                            <div
                              key={j}
                              style={{
                                fontSize: 12,
                                color: t.sub,
                                padding: "3px 4px",
                                lineHeight: 1.5,
                                borderRadius: 4,
                                background: anomalous
                                  ? "rgba(239,68,68,0.07)"
                                  : "transparent",
                              }}
                            >
                              {label}
                              {" · "}
                              {FIELD_LABELS[row.field] || row.field}:{" "}
                              <OldNew
                                t={t}
                                oldValue={row.old_value}
                                newValue={row.new_value}
                              />
                              {row.already_equal ? (
                                <span style={{ marginLeft: 4 }}>
                                  <Pill t={t} tone="neutral">
                                    unchanged
                                  </Pill>
                                </span>
                              ) : null}
                              {row.numeric_effect === "metadata_only" ? (
                                <span style={{ marginLeft: 4 }}>
                                  <Pill t={t} tone="neutral">
                                    $0 — records only
                                  </Pill>
                                </span>
                              ) : null}
                              <FlagPills t={t} flags={flags} />
                            </div>
                          );
                        })}
                        {hidden > 0 ? (
                          <button
                            type="button"
                            onClick={() => setShowAll(true)}
                            style={{
                              marginTop: 4,
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: t.accent,
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              padding: "2px 0",
                            }}
                          >
                            Show all {rows.length} rows ({hidden} hidden) —
                            flagged anomalies are always shown above
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          style={{
            marginTop: 6,
            fontSize: 11.5,
            fontWeight: 600,
            color: t.sub,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 0",
          }}
        >
          Collapse rows
        </button>
      ) : null}
    </Card>
  );
}

export function ApplyResultCard({ t, applyState }) {
  if (applyState.running) {
    return (
      <Card t={t}>
        <div style={{ fontSize: 12.5, color: t.sub }}>
          Applying the change to your forecast…
        </div>
      </Card>
    );
  }
  if (applyState.error) {
    return (
      <Card t={t} tone="danger">
        <div style={{ fontSize: 12.5, color: t.danger }}>
          {applyState.error}
        </div>
      </Card>
    );
  }
  const r = applyState.result;
  if (!r) return null;
  const props = Array.isArray(r.properties) ? r.properties : [];
  const updated = r.rows_updated_total ?? 0;
  return (
    <Card t={t} tone="ok">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h4 style={cardH(t)}>Applied to your forecast</h4>
        <Pill t={t} tone="ok">
          {updated} row{updated === 1 ? "" : "s"} updated
        </Pill>
      </div>
      <p style={cardHelp(t)}>
        The forecast has been updated. Use Undo below to revert this batch.
      </p>
      {props.length > 0 ? (
        <div style={{ fontSize: 12, color: t.sub }}>
          {props.map((p, i) => (
            <div key={p.property_code || i} style={{ padding: "1px 0" }}>
              {p.property_code}:{" "}
              <span style={{ color: t.text }}>
                {p.rows_updated ?? 0} updated
              </span>
              {p.status && p.status !== "applied" && p.status !== "ok" ? (
                <>
                  {" "}
                  ·{" "}
                  <Pill
                    t={t}
                    tone={p.status === "failed" ? "danger" : "neutral"}
                  >
                    {p.status.replace(/_/g, " ")}
                  </Pill>
                </>
              ) : null}
              {p.error ? (
                <span style={{ color: t.danger }}> · {p.error}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function UndoCard({ t, undoState }) {
  if (undoState.running) {
    return (
      <Card t={t}>
        <div style={{ fontSize: 12.5, color: t.sub }}>
          Undoing the batch — restoring prior values…
        </div>
      </Card>
    );
  }
  if (undoState.error) {
    return (
      <Card t={t} tone="danger">
        <div style={{ fontSize: 12.5, color: t.danger }}>{undoState.error}</div>
      </Card>
    );
  }
  const r = undoState.result;
  if (!r) return null;
  return (
    <Card t={t} tone="ok">
      <h4 style={cardH(t)}>Batch undone</h4>
      <div style={{ fontSize: 12.5, color: t.text }}>
        Restored {r.restored ?? 0} row{(r.restored ?? 0) === 1 ? "" : "s"}
        {r.skipped_modified ? (
          <>
            {" "}
            ·{" "}
            <Pill t={t} tone="warn">
              {r.skipped_modified} skipped (changed since apply)
            </Pill>
          </>
        ) : null}
        {r.failed ? (
          <>
            {" "}
            ·{" "}
            <Pill t={t} tone="danger">
              {r.failed} failed
            </Pill>
          </>
        ) : null}
      </div>
    </Card>
  );
}

export function ErrorCard({ t, message }) {
  if (!message) return null;
  return (
    <Card t={t} tone="danger">
      <div style={{ fontSize: 12.5, color: t.danger }}>{message}</div>
    </Card>
  );
}

export function ApplyRecoveryNote({ t, onRerun, rerunDisabled }) {
  return (
    <Card t={t} tone="warn">
      <h4 style={cardH(t)}>Before you retry</h4>
      <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>
        Do not assume nothing was written. If the apply registered, the batch is
        recorded and reversible from{" "}
        <strong>Portfolio Assumptions → History + undo</strong> — check there
        for a matching batch and undo it if it landed. To try again from here,
        re-run the dry-run first so you re-confirm the exact matched-row count
        against a fresh preview.
      </div>
      {onRerun ? (
        <button
          type="button"
          onClick={onRerun}
          disabled={rerunDisabled}
          style={{
            marginTop: 10,
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${t.border}`,
            background: t.inset,
            color: rerunDisabled ? t.sub : t.text,
            cursor: rerunDisabled ? "not-allowed" : "pointer",
          }}
        >
          Re-run dry-run
        </button>
      ) : null}
    </Card>
  );
}
