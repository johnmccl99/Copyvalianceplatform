import React, { useEffect, useMemo, useState } from "react";
import { T } from "../../lib/theme.js";
import {
  supabase,
  fetchBudgetPropertyCodes,
  fetchItemizedLines,
  getCurrentAccessToken,
} from "../../lib/supabaseClient.js";
import { prettyItemizedCategory } from "../../lib/budgetItemized.js";
import {
  fetchAssumptionExplanations,
  recordAssumptionExplanations,
  groupExplanationsByAccount,
  summarizeExplanations,
  suggestionAcceptability,
  buildAcceptChangeSet,
  buildAcceptanceRecord,
  buildOverrideRecord,
  RULE_LABELS,
  KIND_LABELS,
} from "../../lib/budgetAssumptionExplanations.js";
import { analyzeDryRun } from "./budgetAgentAnalysis.js";
import { AnomaliesBanner } from "./BudgetAgentCards.jsx";

const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 5 * 60 * 1000;

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function newUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function callPropagateFunction(payload) {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error("Not signed in");
  await fetch("/.netlify/functions/budget-assumption-propagate-background", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

async function fetchPropagationJob(jobId) {
  const { data, error } = await supabase
    .from("assumption_propagation_jobs")
    .select("id, mode, status, result_summary, error_message")
    .eq("id", jobId)
    .maybeSingle();
  return { data, error };
}

export default function AssumptionExplanationsPage({ C = {} }) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const agentTheme = {
    text,
    sub,
    border,
    card,
    inset: T.inset,
    accent: T.accent,
    ok: T.successText,
    warn: T.warningText,
    danger: T.dangerText,
  };

  const [propertyCodes, setPropertyCodes] = useState({
    loading: true,
    codes: [],
    error: null,
  });
  const [property, setProperty] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [view, setView] = useState("explanations");
  const [records, setRecords] = useState({
    loading: false,
    rows: [],
    error: null,
  });
  const [expanded, setExpanded] = useState(null);
  const [history, setHistory] = useState({
    forId: null,
    rows: [],
    loading: false,
    error: null,
  });
  const [itemized, setItemized] = useState({ rows: [], error: null });
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [accept, setAccept] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await fetchBudgetPropertyCodes();
      if (!alive) return;
      if (error)
        setPropertyCodes({
          loading: false,
          codes: [],
          error: error.message || String(error),
        });
      else {
        const codes = data || [];
        setPropertyCodes({ loading: false, codes, error: null });
        if (codes.length > 0) setProperty((p) => p || codes[0]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!property) return;
    let alive = true;
    setRecords({ loading: true, rows: [], error: null });
    setExpanded(null);
    setHistory({ forId: null, rows: [], loading: false, error: null });
    (async () => {
      const [exp, item] = await Promise.all([
        fetchAssumptionExplanations(property, {
          fiscalYear: fiscalYear || null,
        }),
        fetchItemizedLines({ propertyCode: property }),
      ]);
      if (!alive) return;
      setRecords({ loading: false, rows: exp.data, error: exp.error });
      setItemized({
        rows: item.data || [],
        error: item.error ? String(item.error.message || item.error) : null,
      });
    })();
    return () => {
      alive = false;
    };
  }, [property, fiscalYear]);

  const groups = useMemo(
    () => groupExplanationsByAccount(records.rows),
    [records.rows],
  );
  const summary = useMemo(
    () => summarizeExplanations(records.rows),
    [records.rows],
  );
  const reviewRows = useMemo(
    () =>
      (records.rows || []).filter((r) => {
        const checks = (r.explanation && r.explanation.checks) || {};
        return (
          r.confidence === "manual" ||
          (checks.growth && checks.growth.flag) ||
          (checks.contract_rate && checks.contract_rate.flag)
        );
      }),
    [records.rows],
  );

  const loadHistory = async (rec) => {
    setHistory({ forId: rec.id, rows: [], loading: true, error: null });
    const { data, error } = await fetchAssumptionExplanations(
      rec.property_code,
      {
        fiscalYear: rec.fiscal_year,
        accountNumber: rec.account_number,
        includeHistory: true,
      },
    );
    setHistory({
      forId: rec.id,
      rows: (data || []).filter(
        (r) =>
          r.category === rec.category &&
          r.itemized_field === rec.itemized_field,
      ),
      loading: false,
      error,
    });
  };

  const refresh = async () => {
    const { data, error } = await fetchAssumptionExplanations(property, {
      fiscalYear: fiscalYear || null,
    });
    setRecords({ loading: false, rows: data, error });
  };

  const submitNote = async (rec) => {
    const clean = noteText.trim();
    if (clean.length < 5) {
      setNoteError("Write the rationale first (at least a sentence).");
      return;
    }
    setNoteBusy(true);
    setNoteError("");
    const payload = buildOverrideRecord(
      {
        property_code: rec.property_code,
        category: rec.category,
        account_number: rec.account_number,
        itemized_field: rec.itemized_field,
        fiscal_year: rec.fiscal_year,
      },
      clean,
      rec,
    );
    const { error } = await recordAssumptionExplanations([payload]);
    setNoteBusy(false);
    if (error) {
      setNoteError(error);
      return;
    }
    setNoteFor(null);
    setNoteText("");
    await refresh();
  };

  const pollJob = async (jobId, { deadlineMs = POLL_DEADLINE_MS } = {}) => {
    const start = Date.now();
    for (;;) {
      if (Date.now() - start > deadlineMs)
        throw new Error("Timed out waiting for the propagation job.");
      const { data, error } = await fetchPropagationJob(jobId);
      if (error) throw new Error(error.message || String(error));
      if (data && data.status === "complete") return data;
      if (data && data.status === "error")
        throw new Error(data.error_message || "Propagation job failed.");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  };

  const startAccept = async (rec) => {
    setAccept({
      record: rec,
      stage: "dry-run",
      dryRun: null,
      confirmText: "",
      error: null,
      applyResult: null,
    });
    try {
      const jobId = newUuid();
      const changeSet = buildAcceptChangeSet(rec);
      await callPropagateFunction({
        mode: "dry-run",
        job_id: jobId,
        change_set: changeSet,
        property_codes: [rec.property_code],
      });
      const job = await pollJob(jobId);
      setAccept((a) =>
        a && a.record.id === rec.id
          ? {
              ...a,
              stage: "confirm",
              dryRun: { changeSet, result: job.result_summary },
            }
          : a,
      );
    } catch (e) {
      setAccept((a) =>
        a && a.record.id === rec.id
          ? { ...a, stage: "error", error: String(e.message || e) }
          : a,
      );
    }
  };

  const confirmAccept = async () => {
    if (!accept || accept.stage !== "confirm") return;
    const { record, dryRun, confirmText } = accept;
    const rowsMatched = Number(dryRun.result?.rows_matched_total || 0);
    if (confirmText.trim() !== String(rowsMatched)) {
      setAccept({
        ...accept,
        error: `Type the matched-row count (${rowsMatched}) to confirm.`,
      });
      return;
    }
    setAccept({ ...accept, stage: "applying", error: null });
    try {
      const jobId = newUuid();
      await callPropagateFunction({
        mode: "apply",
        job_id: jobId,
        approval_token: dryRun.result.approval_token,
        change_set: dryRun.changeSet,
      });
      const job = await pollJob(jobId);
      const applyResult = job.result_summary || {};
      const { error: recErr } = await recordAssumptionExplanations([
        buildAcceptanceRecord(record, {
          applyId: applyResult.apply_id || null,
          approvalToken: dryRun.result.approval_token,
          rowsUpdated: applyResult.rows_updated_total ?? null,
        }),
      ]);
      setAccept((a) =>
        a && a.record.id === record.id
          ? {
              ...a,
              stage: "done",
              applyResult,
              error: recErr
                ? `Applied, but recording the acceptance failed: ${recErr}`
                : null,
            }
          : a,
      );
      await refresh();
    } catch (e) {
      setAccept((a) =>
        a && a.record.id === record.id
          ? { ...a, stage: "error", error: String(e.message || e) }
          : a,
      );
    }
  };

  const th = {
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: sub,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const td = {
    padding: "6px 10px",
    fontSize: 12.5,
    borderBottom: `1px solid ${border}`,
    verticalAlign: "top",
    color: text,
  };
  const sectionStyle = {
    background: card,
    border: `1px solid ${border}`,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  };
  const h2Style = {
    fontSize: 14,
    fontWeight: 700,
    color: text,
    margin: "0 0 4px 0",
  };
  const helpStyle = {
    fontSize: 12,
    color: sub,
    margin: "0 0 12px 0",
    lineHeight: 1.5,
  };
  const inputStyle = {
    fontSize: 13,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: T.inset,
    color: text,
  };
  const quietBtn = {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: "transparent",
    color: text,
    cursor: "pointer",
  };
  const btnStyle = (enabled) => ({
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 14px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.5,
    background: T.accentFill,
    color: T.accentFillText,
  });

  const confidenceChip = (grade) => {
    const palette = {
      high: { bg: T.successBg, fg: T.successText },
      medium: { bg: T.warningBg, fg: T.warningText },
      low: { bg: T.warningBg, fg: T.warningText },
      manual: { bg: T.dangerBg, fg: T.dangerText },
    }[grade] || { bg: T.inset, fg: sub };
    return (
      <span
        style={{
          display: "inline-block",
          fontSize: 10.5,
          fontWeight: 700,
          padding: "2px 8px",
          borderRadius: 999,
          background: palette.bg,
          color: palette.fg,
          whiteSpace: "nowrap",
        }}
      >
        {grade}
      </span>
    );
  };

  const kindChip = (kind) => (
    <span
      style={{
        display: "inline-block",
        fontSize: 10.5,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        background: T.inset,
        color: sub,
        whiteSpace: "nowrap",
      }}
    >
      {KIND_LABELS[kind] || kind}
    </span>
  );

  const recordDetail = (rec) => {
    const stats =
      (rec.explanation &&
        rec.explanation.inputs &&
        rec.explanation.inputs.stats) ||
      {};
    const computed = (rec.explanation && rec.explanation.computed) || {};
    const caveats = (rec.explanation && rec.explanation.caveats) || [];
    const comparator = computed.comparator || {};
    return (
      <tr key={`${rec.id}-detail`}>
        <td colSpan={7} style={{ ...td, background: T.inset }}>
          <div
            style={{
              fontSize: 12.5,
              color: text,
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          >
            <p style={{ margin: "4px 0 10px 0" }}>{rec.narrative}</p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 18,
                fontSize: 11.5,
                color: sub,
              }}
            >
              {stats.t12_mean !== null && stats.t12_mean !== undefined && (
                <span>T12 mean {fmtMoney(stats.t12_mean)}</span>
              )}
              {stats.cov12 !== null && stats.cov12 !== undefined && (
                <span>CoV {stats.cov12}</span>
              )}
              {stats.cross_window_agreement_pct !== null &&
                stats.cross_window_agreement_pct !== undefined && (
                  <span>
                    window agreement {stats.cross_window_agreement_pct}%
                  </span>
                )}
              {computed.chosen_window && (
                <span>window {computed.chosen_window}</span>
              )}
              {computed.spread && <span>spread {computed.spread}</span>}
              {comparator.workbook_value !== null &&
                comparator.workbook_value !== undefined && (
                  <span>
                    sealed {fmtMoney(comparator.workbook_value)}
                    {comparator.basis === "annual" ? "/yr" : "/mo"}
                  </span>
                )}
              <span>engine {rec.engine_version}</span>
              <span>by {rec.derived_by}</span>
              <span>{String(rec.created_at).slice(0, 10)}</span>
            </div>
            {caveats.length > 0 && (
              <ul
                style={{
                  margin: "10px 0 0 0",
                  paddingLeft: 18,
                  color: T.warningText,
                  fontSize: 12,
                }}
              >
                {caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button style={quietBtn} onClick={() => loadHistory(rec)}>
                {history.forId === rec.id && history.loading
                  ? "Loading history…"
                  : "Show append history"}
              </button>
              <button
                style={quietBtn}
                onClick={() => {
                  setNoteFor(noteFor === rec.id ? null : rec.id);
                  setNoteText("");
                  setNoteError("");
                }}
              >
                Add analyst note
              </button>
              {(() => {
                const acc = suggestionAcceptability(rec, itemized.rows);
                if (acc.ok) {
                  return (
                    <button
                      style={btnStyle(true)}
                      onClick={() => startAccept(rec)}
                    >
                      Accept via propagation…
                    </button>
                  );
                }
                return rec.record_kind === "suggestion" ? (
                  <span
                    style={{ fontSize: 11.5, color: sub, alignSelf: "center" }}
                  >
                    {acc.reason}
                  </span>
                ) : null;
              })()}
            </div>

            {noteFor === rec.id && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  style={{
                    ...inputStyle,
                    width: "100%",
                    minHeight: 60,
                    boxSizing: "border-box",
                  }}
                  placeholder="Why this assumption is what it is — the record is append-only and attributed to you."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <button
                    style={btnStyle(!noteBusy)}
                    disabled={noteBusy}
                    onClick={() => submitNote(rec)}
                  >
                    {noteBusy ? "Appending…" : "Append note"}
                  </button>
                  {noteError && (
                    <span style={{ color: T.dangerText, fontSize: 12 }}>
                      {noteError}
                    </span>
                  )}
                </div>
              </div>
            )}

            {history.forId === rec.id &&
              !history.loading &&
              (history.error ? (
                <div
                  style={{ color: T.dangerText, fontSize: 12, marginTop: 10 }}
                >
                  Could not load history — {history.error}
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  {history.rows.map((h) => (
                    <div
                      key={h.id}
                      style={{
                        fontSize: 11.5,
                        color: sub,
                        padding: "4px 0",
                        borderTop: `1px dashed ${border}`,
                      }}
                    >
                      {String(h.created_at).slice(0, 16).replace("T", " ")} ·{" "}
                      {KIND_LABELS[h.record_kind] || h.record_kind} ·{" "}
                      {RULE_LABELS[h.rule_id] || h.rule_id} · {h.confidence} ·{" "}
                      {h.derived_by}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </td>
      </tr>
    );
  };

  const recordRow = (rec) => (
    <React.Fragment key={rec.id}>
      <tr
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded(expanded === rec.id ? null : rec.id)}
      >
        <td style={td}>{prettyItemizedCategory(rec.category)}</td>
        <td style={td}>{rec.account_number}</td>
        <td style={td}>
          {rec.itemized_field}
          {rec.field_semantic ? (
            <span style={{ color: sub }}> · {rec.field_semantic}</span>
          ) : null}
        </td>
        <td style={td}>{RULE_LABELS[rec.rule_id] || rec.rule_id}</td>
        <td style={td}>{kindChip(rec.record_kind)}</td>
        <td style={{ ...td, textAlign: "right" }}>
          {fmtMoney(rec.derived_value)}
        </td>
        <td style={td}>{confidenceChip(rec.confidence)}</td>
      </tr>
      {expanded === rec.id && recordDetail(rec)}
    </React.Fragment>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1080 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: text, margin: 0 }}>
          Assumption Explanations
        </h1>
        <p style={{ ...helpStyle, maxWidth: 780, marginTop: 6 }}>
          Every stored record answers "how was this budget assumption derived" —
          the rule that produced it (stable run-rate, seasonal level, revenue
          annualization, salvage, contractual verification), the GL window and
          statistics behind it, a confidence grade, and a plain-prose narrative.
          Records are append-only and survive workbook re-parses. Derived values
          are suggestions: nothing is applied to the budget until it goes
          through the propagation flow's dry-run and token-gated apply.
        </p>
      </div>

      <div style={sectionStyle}>
        {propertyCodes.loading && (
          <div style={{ color: sub, fontSize: 13 }} role="status">
            Loading properties…
          </div>
        )}
        {!propertyCodes.loading && propertyCodes.error && (
          <div style={{ color: T.dangerText, fontSize: 13 }}>
            Could not load properties — {propertyCodes.error}
          </div>
        )}
        {!propertyCodes.loading &&
          !propertyCodes.error &&
          propertyCodes.codes.length === 0 && (
            <div style={{ color: sub, fontSize: 13 }}>
              No properties are registered in the Budget &amp; Forecast Module
              yet. Register a v26 workbook on the Budget Workbook Intake page
              first.
            </div>
          )}
        {propertyCodes.codes.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "flex-end",
            }}
          >
            <label style={{ fontSize: 12, color: sub }}>
              Property
              <br />
              <select
                style={inputStyle}
                value={property}
                onChange={(e) => setProperty(e.target.value)}
              >
                {propertyCodes.codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: sub }}>
              Fiscal year (blank = all)
              <br />
              <input
                style={inputStyle}
                placeholder="2025-2026"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value.trim())}
              />
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                ["explanations", "Explanations"],
                ["review", `Review queue (${reviewRows.length})`],
              ].map(([k, label]) => (
                <button
                  key={k}
                  style={{
                    ...quietBtn,
                    fontWeight: view === k ? 700 : 400,
                    borderColor: view === k ? T.accentFill : border,
                  }}
                  onClick={() => setView(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {records.rows.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          {[
            ["records", summary.total],
            ["high", summary.by_confidence.high],
            ["medium", summary.by_confidence.medium],
            ["low", summary.by_confidence.low],
            ["manual review", summary.manual_review],
            ["flagged checks", summary.flagged_checks],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                ...sectionStyle,
                marginBottom: 0,
                padding: "10px 16px",
                minWidth: 110,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, color: text }}>
                {value}
              </div>
              <div style={{ fontSize: 11, color: sub }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={h2Style}>
          {view === "review"
            ? "Review queue"
            : "Latest explanation per assumption"}
        </h2>
        <p style={helpStyle}>
          {view === "review"
            ? "Lines the engine routed to judgment (short history, regime breaks, lumpy accounts without a salvage rule) plus flagged growth/contract-rate checks. The engine does not invent numbers here — the history is the context."
            : "Click a row for the full derivation record: narrative, window statistics, caveats, append history, notes, and (for monthly amount suggestions) the token-gated apply path."}
        </p>

        {records.loading && (
          <div style={{ color: sub, fontSize: 13 }} role="status">
            Loading explanation records…
          </div>
        )}
        {!records.loading && records.error && (
          <div style={{ color: T.dangerText, fontSize: 13 }}>
            Could not load explanation records — {records.error}
          </div>
        )}
        {!records.loading &&
          !records.error &&
          records.rows.length === 0 &&
          property && (
            <div style={{ color: sub, fontSize: 13 }}>
              No derivation records exist for {property}
              {fiscalYear ? ` in FY ${fiscalYear}` : ""} yet — this property
              predates explanation records. Once engine records are written,
              analyst notes and acceptances append here afterward.
            </div>
          )}

        {!records.loading && !records.error && records.rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Category</th>
                  <th style={th}>Account</th>
                  <th style={th}>Field</th>
                  <th style={th}>Rule</th>
                  <th style={th}>Kind</th>
                  <th style={{ ...th, textAlign: "right" }}>Derived</th>
                  <th style={th}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {(view === "review"
                  ? reviewRows
                  : groups.flatMap((g) => g.records)
                ).map(recordRow)}
              </tbody>
            </table>
          </div>
        )}
        {itemized.error && (
          <div style={{ color: T.warningText, fontSize: 12, marginTop: 8 }}>
            Itemized lines could not be loaded ({itemized.error}) — accept
            gating falls back to read-only.
          </div>
        )}
      </div>

      {accept && (
        <div style={{ ...sectionStyle, borderColor: T.accentFill }}>
          <h2 style={h2Style}>
            Accept suggestion — {prettyItemizedCategory(accept.record.category)}{" "}
            · {accept.record.account_number} · {accept.record.property_code}
          </h2>
          {accept.stage === "dry-run" && (
            <div style={{ color: sub, fontSize: 13 }} role="status">
              Running the propagation dry-run (blast radius on{" "}
              {accept.record.property_code})…
            </div>
          )}
          {accept.stage === "confirm" &&
            accept.dryRun &&
            (() => {
              const analysis = analyzeDryRun(accept.dryRun.result);
              return (
                <div>
                  <p style={helpStyle}>
                    Dry-run matched{" "}
                    {Number(accept.dryRun.result?.rows_matched_total || 0)}{" "}
                    row(s); forward-month delta{" "}
                    {fmtMoney(analysis.crossPropertyTotal)}. This accepts the
                    suggestion across every line under the account. The apply is
                    token-gated and undoable as a batch on the Portfolio
                    Assumptions page.
                  </p>
                  {analysis.hasAnomalies && (
                    <AnomaliesBanner
                      t={agentTheme}
                      anomalies={analysis.anomalies}
                    />
                  )}
                  {analysis.hasAnomalies && (
                    <p style={{ ...helpStyle, marginTop: 0 }}>
                      Flags catch large jumps, sign flips, and dollar outliers —
                      a scan aid, not a completeness check. Verify the figure
                      before you apply.
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <label style={{ fontSize: 12, color: sub }}>
                      Type the matched-row count to confirm
                      <br />
                      <input
                        style={inputStyle}
                        value={accept.confirmText}
                        onChange={(e) =>
                          setAccept({ ...accept, confirmText: e.target.value })
                        }
                      />
                    </label>
                    <button style={btnStyle(true)} onClick={confirmAccept}>
                      Apply via propagation
                    </button>
                    <button style={quietBtn} onClick={() => setAccept(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}
          {accept.stage === "applying" && (
            <div style={{ color: sub, fontSize: 13 }} role="status">
              Applying (token-gated) and appending the acceptance record…
            </div>
          )}
          {accept.stage === "done" && (
            <div style={{ color: T.successText, fontSize: 13 }}>
              Applied. {accept.applyResult?.rows_updated_total ?? "?"} row(s)
              updated; the acceptance record is appended to the explanation
              history. Undo lives on the Portfolio Assumptions history panel.
              <button
                style={{ ...quietBtn, marginLeft: 10 }}
                onClick={() => setAccept(null)}
              >
                Close
              </button>
            </div>
          )}
          {accept.error && (
            <div style={{ color: T.dangerText, fontSize: 13, marginTop: 8 }}>
              {accept.error}
            </div>
          )}
          {accept.stage === "error" && (
            <button
              style={{ ...quietBtn, marginTop: 8 }}
              onClick={() => setAccept(null)}
            >
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
