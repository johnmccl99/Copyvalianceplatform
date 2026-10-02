import React, { useEffect, useMemo, useRef, useState } from "react";
import { T } from "../../lib/theme.js";
import {
  supabase,
  fetchBudgetPropertyCodes,
  fetchItemizedLines,
  getCurrentAccessToken,
} from "../../lib/supabaseClient.js";
import {
  ITEMIZED_CATEGORIES,
  FREQUENCY_VALUES,
  prettyItemizedCategory,
} from "../../lib/budgetItemized.js";
import {
  ITEMIZED_FIELD_ELIGIBILITY,
  PROPAGATABLE_FIELDS,
  validateChangeSet,
  changeSetTouchesDollarAmount,
  changeScopesCollide,
} from "../../../netlify/functions/_assumption-eligibility.js";
import {
  analyzeDryRun,
  rowFlags,
  scopeLabel,
  isAccountWildcard,
} from "./budgetAgentAnalysis.js";
import { Pill, FlagPills, AnomaliesBanner } from "./BudgetAgentCards.jsx";

const FIELD_LABELS = {
  amount: "Amount",
  frequency: "Frequency",
  first_month: "First Month",
  last_month: "Last Month",
  assumption_value: "Assumption value",
};

const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 5 * 60 * 1000;
const JOB_APPEAR_DEADLINE_MS = 12 * 1000;

const NULL_DESC_SENTINEL = "__NULL_DESC__";

const HISTORY_PAGE_SIZE = 20;

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${v < 0 ? "-" : v > 0 ? "+" : ""}$${s}`;
}

function fmtValue(v) {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "number")
    return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(v);
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

async function fetchJob(jobId) {
  const { data, error } = await supabase
    .from("assumption_propagation_jobs")
    .select("id, mode, status, result_summary, error_message, completed_at")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export default function PortfolioAssumptionsPage({ C = {}, userProfile } = {}) {
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
    error: null,
    codes: [],
  });
  const [repProperty, setRepProperty] = useState("");
  const [targetKind, setTargetKind] = useState("itemized");
  const [category, setCategory] = useState("");
  const [repRows, setRepRows] = useState({
    loading: false,
    error: null,
    rows: [],
  });
  const [pdpqKeys, setPdpqKeys] = useState({
    loading: false,
    error: null,
    keys: [],
  });
  const [selAccount, setSelAccount] = useState("");
  const [selLineDesc, setSelLineDesc] = useState("");
  const [selPdpqKey, setSelPdpqKey] = useState("");
  const [selField, setSelField] = useState("amount");
  const [newValue, setNewValue] = useState("");
  const [clearLastMonth, setClearLastMonth] = useState(false);
  const [changeSetName, setChangeSetName] = useState("");
  const [changes, setChanges] = useState([]);
  const [authorError, setAuthorError] = useState("");

  const [scoped, setScoped] = useState(() => new Set());
  const [scopeTouched, setScopeTouched] = useState(false);

  const [dryRun, setDryRun] = useState({
    running: false,
    error: null,
    result: null,
  });
  const [applyState, setApplyState] = useState({
    running: false,
    error: null,
    result: null,
  });
  const [confirmText, setConfirmText] = useState("");
  const [parityRunning, setParityRunning] = useState(false);
  const [jobNotice, setJobNotice] = useState("");

  const [history, setHistory] = useState({
    loading: true,
    error: null,
    rows: [],
    hasMore: false,
  });
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyMoreError, setHistoryMoreError] = useState("");
  const [expandedApply, setExpandedApply] = useState(null);
  const [undoArm, setUndoArm] = useState(null);
  const [undoState, setUndoState] = useState({
    running: false,
    error: null,
    result: null,
    applyId: null,
  });

  const pollTimerRef = useRef(null);
  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };
  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await fetchBudgetPropertyCodes();
      if (!alive) return;
      if (error) {
        setPropertyCodes({
          loading: false,
          error: String(error.message || error),
          codes: [],
        });
        return;
      }
      setPropertyCodes({ loading: false, error: null, codes: data || [] });
      if ((data || []).length > 0) setRepProperty(data[0]);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!repProperty || !category || targetKind !== "itemized") {
      setRepRows({ loading: false, error: null, rows: [] });
      return;
    }
    let alive = true;
    setRepRows({ loading: true, error: null, rows: [] });
    (async () => {
      const { data, error } = await fetchItemizedLines({
        propertyCode: repProperty,
        category,
      });
      if (!alive) return;
      if (error) {
        setRepRows({
          loading: false,
          error: String(error.message || error),
          rows: [],
        });
        return;
      }
      setRepRows({ loading: false, error: null, rows: data || [] });
    })();
    return () => {
      alive = false;
    };
  }, [repProperty, category, targetKind]);

  useEffect(() => {
    if (!repProperty || targetKind !== "pdpq") {
      setPdpqKeys({ loading: false, error: null, keys: [] });
      return;
    }
    let alive = true;
    setPdpqKeys({ loading: true, error: null, keys: [] });
    (async () => {
      const { data, error } = await supabase
        .schema("raw")
        .from("pdpq")
        .select("assumption_key")
        .eq("property_code", repProperty);
      if (!alive) return;
      if (error) {
        setPdpqKeys({ loading: false, error: error.message, keys: [] });
        return;
      }
      const keys = [
        ...new Set((data || []).map((r) => r.assumption_key).filter(Boolean)),
      ].sort();
      setPdpqKeys({ loading: false, error: null, keys });
    })();
    return () => {
      alive = false;
    };
  }, [repProperty, targetKind]);

  const loadHistory = async ({ append = false } = {}) => {
    const from = append ? history.rows.length : 0;
    if (append) {
      setHistoryLoadingMore(true);
      setHistoryMoreError("");
    }
    const { data, error } = await supabase
      .from("assumption_propagation_applies")
      .select(
        "id, change_set_name, change_set, property_codes, rows_updated, result_summary, row_images, applied_by, applied_at, undone_at, undo_result",
      )
      .order("applied_at", { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE - 1);
    if (error) {
      if (append) {
        setHistoryMoreError(error.message);
        setHistoryLoadingMore(false);
      } else
        setHistory({
          loading: false,
          error: error.message,
          rows: [],
          hasMore: false,
        });
      return;
    }
    const batch = data || [];
    const hasMore = batch.length === HISTORY_PAGE_SIZE;
    setHistory((prev) =>
      append
        ? {
            loading: false,
            error: null,
            rows: [...prev.rows, ...batch],
            hasMore,
          }
        : { loading: false, error: null, rows: batch, hasMore },
    );
    if (append) setHistoryLoadingMore(false);
  };
  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("budget_parity_runs")
        .select("id")
        .eq("status", "running")
        .limit(1);
      if (alive && !error) setParityRunning((data || []).length > 0);
    })();
    return () => {
      alive = false;
    };
  }, [dryRun.result]);

  const changeSet = useMemo(() => {
    const cs = { changes };
    if (changeSetName.trim()) cs.name = changeSetName.trim();
    return cs;
  }, [changes, changeSetName]);

  const touchesDollar = changeSetTouchesDollarAmount(changeSet);

  const invalidatePreview = () => {
    setDryRun({ running: false, error: null, result: null });
    setApplyState({ running: false, error: null, result: null });
    setConfirmText("");
    setJobNotice("");
    stopPolling();
  };

  useEffect(() => {
    if (scopeTouched) return;
    if (touchesDollar) setScoped(new Set());
    else setScoped(new Set(propertyCodes.codes));
  }, [propertyCodes.codes, touchesDollar, scopeTouched]);

  const accountOptions = useMemo(() => {
    const seen = new Map();
    for (const r of repRows.rows) {
      const acct = (r.account_number || "").trim();
      if (!acct) continue;
      if (!seen.has(acct)) seen.set(acct, []);
      seen.get(acct).push(r);
    }
    return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [repRows.rows]);

  const linesForAccount = useMemo(() => {
    const found = accountOptions.find(([acct]) => acct === selAccount);
    return found ? found[1] : [];
  }, [accountOptions, selAccount]);

  const lineScopeOptions = useMemo(() => {
    const seen = new Map();
    for (const r of linesForAccount) {
      const desc = (r.line_description || "").trim();
      const value = desc ? r.line_description : NULL_DESC_SENTINEL;
      if (!seen.has(value)) seen.set(value, desc || "(no description)");
    }
    return [...seen.entries()];
  }, [linesForAccount]);

  const addChange = () => {
    setAuthorError("");
    let chg;
    if (targetKind === "itemized") {
      if (!category || !selAccount) {
        setAuthorError("Pick a category and an account first.");
        return;
      }
      let value;
      if (selField === "amount") {
        const n = Number(String(newValue).replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n)) {
          setAuthorError("Amount must be a number.");
          return;
        }
        value = n;
      } else if (selField === "frequency") {
        if (!FREQUENCY_VALUES.has(newValue)) {
          setAuthorError("Pick a canonical frequency.");
          return;
        }
        value = newValue;
      } else if (selField === "last_month" && clearLastMonth) {
        value = null;
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newValue)) {
          setAuthorError("Pick a date.");
          return;
        }
        value = newValue;
      }
      const match = { account_number: selAccount };
      if (selLineDesc === NULL_DESC_SENTINEL) match.line_description = null;
      else if (selLineDesc) match.line_description = selLineDesc;
      chg = {
        target: "itemized",
        category,
        match,
        field: selField,
        new_value: value,
      };
    } else {
      if (!selPdpqKey) {
        setAuthorError("Pick a PDPQ assumption key first.");
        return;
      }
      const n = Number(String(newValue).replace(/[$,%\s]/g, ""));
      if (!Number.isFinite(n)) {
        setAuthorError("PDPQ value must be a number.");
        return;
      }
      chg = {
        target: "pdpq",
        match: { assumption_key: selPdpqKey },
        field: "assumption_value",
        new_value: n,
      };
    }
    const v = validateChangeSet({ changes: [chg] });
    if (!v.ok) {
      setAuthorError(v.errors.join("; "));
      return;
    }
    const clashIdx = changes.findIndex((existing) =>
      changeScopesCollide(chg, existing),
    );
    if (clashIdx >= 0) {
      setAuthorError(
        `This change targets the same rows as change #${clashIdx + 1}. One change-set may touch each row set once — apply them as separate propagations.`,
      );
      return;
    }
    setChanges((prev) => [...prev, chg]);
    setNewValue("");
    setClearLastMonth(false);
    invalidatePreview();
  };

  const removeChange = (idx) => {
    setChanges((prev) => prev.filter((_, i) => i !== idx));
    invalidatePreview();
  };

  const toggleProperty = (code) => {
    setScopeTouched(true);
    setScoped((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    invalidatePreview();
  };
  const setAllProperties = (on) => {
    setScopeTouched(true);
    setScoped(on ? new Set(propertyCodes.codes) : new Set());
    invalidatePreview();
  };

  const anyJobRunning =
    dryRun.running || applyState.running || undoState.running;

  const runJob = (payload, onDone, onFail, opts = {}) => {
    const { fastFailAppear = true, onSlowStart = null } = opts;
    const jobId = newUuid();
    const startedAt = Date.now();
    let seen = false;
    let warned = false;
    setJobNotice("");
    stopPolling();
    callPropagateFunction({ ...payload, job_id: jobId }).catch((e) => {
      stopPolling();
      onFail(e?.message || "Request failed");
    });
    pollTimerRef.current = setInterval(async () => {
      try {
        const job = await fetchJob(jobId);
        if (!job) {
          if (!seen && Date.now() - startedAt > JOB_APPEAR_DEADLINE_MS) {
            if (fastFailAppear) {
              stopPolling();
              onFail(
                "The request was rejected before it started — check that your role allows propagation and the change-set is valid.",
              );
            } else if (!warned) {
              warned = true;
              if (onSlowStart) onSlowStart();
            } else if (Date.now() - startedAt > POLL_DEADLINE_MS) {
              stopPolling();
              onFail(
                "The job never registered. Check the History panel and the version history before retrying — do not assume nothing was written.",
              );
            }
          }
          return;
        }
        seen = true;
        setJobNotice("");
        if (job.status === "complete") {
          stopPolling();
          onDone(job.result_summary);
        } else if (job.status === "error") {
          stopPolling();
          onFail(job.error_message || "Job failed");
        } else if (Date.now() - startedAt > POLL_DEADLINE_MS) {
          stopPolling();
          onFail(
            "Timed out waiting for the job to finish. Check the job history and retry.",
          );
        }
      } catch (e) {
        console.warn("[assumption-propagation poll]", e?.message || e);
      }
    }, POLL_INTERVAL_MS);
  };

  const runDryRun = () => {
    if (anyJobRunning) return;
    const v = validateChangeSet(changeSet);
    if (!v.ok) {
      setDryRun({ running: false, error: v.errors.join("; "), result: null });
      return;
    }
    if (scoped.size === 0) {
      setDryRun({
        running: false,
        error: "Select at least one property.",
        result: null,
      });
      return;
    }
    setApplyState({ running: false, error: null, result: null });
    setConfirmText("");
    setDryRun({ running: true, error: null, result: null });
    runJob(
      {
        mode: "dry-run",
        change_set: changeSet,
        property_codes: [...scoped].sort(),
      },
      (result) => setDryRun({ running: false, error: null, result }),
      (err) => setDryRun({ running: false, error: err, result: null }),
    );
  };

  const tokenExpired = dryRun.result?.expires_at
    ? new Date(dryRun.result.expires_at).getTime() < Date.now()
    : false;
  const rowsMatchedTotal = dryRun.result?.rows_matched_total ?? 0;
  const analysis = useMemo(
    () => (dryRun.result ? analyzeDryRun(dryRun.result) : null),
    [dryRun.result],
  );
  const confirmReady =
    !!dryRun.result &&
    !applyState.result &&
    !tokenExpired &&
    rowsMatchedTotal > 0 &&
    confirmText.trim() === String(rowsMatchedTotal);

  const runApply = () => {
    if (!confirmReady || anyJobRunning) return;
    setApplyState({ running: true, error: null, result: null });
    runJob(
      {
        mode: "apply",
        approval_token: dryRun.result.approval_token,
        change_set: changeSet,
      },
      (result) => {
        setApplyState({ running: false, error: null, result });
        loadHistory();
      },
      (err) => setApplyState({ running: false, error: err, result: null }),
      {
        fastFailAppear: false,
        onSlowStart: () =>
          setJobNotice(
            "The apply is taking longer than usual to register — still waiting. It may still complete and move values.",
          ),
      },
    );
  };

  const runUndo = (applyId) => {
    if (anyJobRunning) return;
    setUndoArm(null);
    setUndoState({ running: true, error: null, result: null, applyId });
    runJob(
      { mode: "undo", apply_id: applyId },
      (result) => {
        setUndoState({ running: false, error: null, result, applyId });
        loadHistory();
      },
      (err) =>
        setUndoState({ running: false, error: err, result: null, applyId }),
      {
        fastFailAppear: false,
        onSlowStart: () =>
          setJobNotice(
            "The undo is taking longer than usual to register — still waiting. It may still complete and restore values.",
          ),
      },
    );
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
  const quietBtn = {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: "transparent",
    color: text,
    cursor: "pointer",
  };

  const metadataBadge = (
    <span
      style={{
        display: "inline-block",
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: T.warningBg,
        color: T.warningText,
        whiteSpace: "nowrap",
      }}
    >
      records the assumption — forecast unchanged
    </span>
  );

  const describeChange = (chg) => {
    if (chg.target === "itemized") {
      const line = !("line_description" in chg.match)
        ? " · all lines"
        : chg.match.line_description === null
          ? " · lines with no description"
          : ` · line "${chg.match.line_description}"`;
      return `${prettyItemizedCategory(chg.category)} · account ${chg.match.account_number}${line} — set ${FIELD_LABELS[chg.field] || chg.field} to ${chg.new_value === null ? "(cleared)" : fmtValue(chg.new_value)}`;
    }
    return `PDPQ · ${chg.match.assumption_key} — set value to ${fmtValue(chg.new_value)}`;
  };

  return (
    <div style={{ padding: 24, maxWidth: 1080 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: text, margin: 0 }}>
          Portfolio Assumptions
        </h1>
        <p style={{ ...helpStyle, maxWidth: 760, marginTop: 6 }}>
          Author a budget assumption change once and apply it across selected
          properties as ordinary, fully-versioned per-property edits. Every
          apply requires a dry-run blast radius and a typed confirmation, and
          can be undone as a batch. V1 moves real dollars on the direct-amount
          fields only — Amount, Frequency, First/Last Month. PDPQ rate changes
          are recorded but do not move the forecast yet. The named workbook
          toggles (vacancy factor, loss-to-lease, renewal %, concessions) become
          platform-native in the method-native calc arc and are not selectable
          here.
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>1 · Author the change-set</h2>
        <p style={helpStyle}>
          Pick a representative property to browse its rows; the change applies
          by account match on every scoped property, not just this one.
        </p>

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
              Representative property
              <br />
              <select
                style={inputStyle}
                value={repProperty}
                onChange={(e) => setRepProperty(e.target.value)}
              >
                {propertyCodes.codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: sub }}>
              Target
              <br />
              <select
                style={inputStyle}
                value={targetKind}
                onChange={(e) => {
                  setTargetKind(e.target.value);
                  setAuthorError("");
                }}
              >
                <option value="itemized">Itemized line field</option>
                <option value="pdpq">PDPQ rate (records only)</option>
              </select>
            </label>

            {targetKind === "itemized" && (
              <>
                <label style={{ fontSize: 12, color: sub }}>
                  Category
                  <br />
                  <select
                    style={inputStyle}
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setSelAccount("");
                      setSelLineDesc("");
                    }}
                  >
                    <option value="">Select…</option>
                    {ITEMIZED_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {prettyItemizedCategory(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: sub }}>
                  Account
                  <br />
                  <select
                    style={inputStyle}
                    value={selAccount}
                    disabled={repRows.loading || !category}
                    onChange={(e) => {
                      setSelAccount(e.target.value);
                      setSelLineDesc("");
                    }}
                  >
                    <option value="">
                      {repRows.loading ? "Loading…" : "Select…"}
                    </option>
                    {accountOptions.map(([acct, rows]) => (
                      <option key={acct} value={acct}>
                        {acct} ({rows.length} line{rows.length === 1 ? "" : "s"}
                        )
                      </option>
                    ))}
                  </select>
                </label>
                {linesForAccount.length > 1 && (
                  <label style={{ fontSize: 12, color: sub }}>
                    Line match
                    <br />
                    <select
                      style={inputStyle}
                      value={selLineDesc}
                      onChange={(e) => setSelLineDesc(e.target.value)}
                    >
                      <option value="">All lines on this account</option>
                      {lineScopeOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label style={{ fontSize: 12, color: sub }}>
                  Field
                  <br />
                  <select
                    style={inputStyle}
                    value={selField}
                    onChange={(e) => {
                      setSelField(e.target.value);
                      setNewValue("");
                      setClearLastMonth(false);
                    }}
                  >
                    {PROPAGATABLE_FIELDS.itemized.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f] || f}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: sub }}>
                  New value
                  <br />
                  {selField === "frequency" ? (
                    <select
                      style={inputStyle}
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {[...FREQUENCY_VALUES].map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  ) : selField === "amount" ? (
                    <input
                      style={inputStyle}
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 1250"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                    />
                  ) : (
                    <input
                      style={{
                        ...inputStyle,
                        opacity: clearLastMonth ? 0.5 : 1,
                      }}
                      type="date"
                      disabled={clearLastMonth}
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                    />
                  )}
                </label>
                {selField === "last_month" && (
                  <label style={{ fontSize: 12, color: sub, paddingBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={clearLastMonth}
                      onChange={(e) => setClearLastMonth(e.target.checked)}
                    />{" "}
                    clear (open-ended)
                  </label>
                )}
              </>
            )}

            {targetKind === "pdpq" && (
              <>
                <label style={{ fontSize: 12, color: sub }}>
                  Assumption key
                  <br />
                  <select
                    style={inputStyle}
                    value={selPdpqKey}
                    disabled={pdpqKeys.loading}
                    onChange={(e) => setSelPdpqKey(e.target.value)}
                  >
                    <option value="">
                      {pdpqKeys.loading
                        ? "Loading…"
                        : pdpqKeys.keys.length === 0
                          ? "No PDPQ rows on this property"
                          : "Select…"}
                    </option>
                    {pdpqKeys.keys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: sub }}>
                  New value
                  <br />
                  <input
                    style={inputStyle}
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 0.045"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                  />
                </label>
                <div style={{ paddingBottom: 8 }}>{metadataBadge}</div>
              </>
            )}

            <button type="button" style={btnStyle(true)} onClick={addChange}>
              Add to change-set
            </button>
          </div>
        )}

        {authorError && (
          <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 8 }}>
            {authorError}
          </div>
        )}
        {repRows.error && (
          <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 8 }}>
            Could not load rows — {repRows.error}
          </div>
        )}
        {pdpqKeys.error && (
          <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 8 }}>
            Could not load PDPQ keys — {pdpqKeys.error}
          </div>
        )}
        {!repRows.loading &&
          targetKind === "itemized" &&
          category &&
          repRows.rows.length === 0 &&
          !repRows.error && (
            <div style={{ color: sub, fontSize: 12.5, marginTop: 8 }}>
              No {prettyItemizedCategory(category)} rows on {repProperty}. Pick
              another category or representative property.
            </div>
          )}

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, color: sub }}>
            Change-set name (shown in history)
            <br />
            <input
              style={{ ...inputStyle, width: 320 }}
              type="text"
              maxLength={200}
              placeholder="e.g. Q3 insurance rate reset"
              value={changeSetName}
              onChange={(e) => {
                setChangeSetName(e.target.value);
                invalidatePreview();
              }}
            />
          </label>
        </div>

        {changes.length > 0 && (
          <table
            style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}
          >
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Change</th>
                <th style={th}>Effect</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {changes.map((chg, i) => (
                <tr key={i}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}>{describeChange(chg)}</td>
                  <td style={td}>
                    {chg.target === "pdpq" ? (
                      metadataBadge
                    ) : (
                      <span
                        style={{
                          fontSize: 11.5,
                          color: T.successText,
                          fontWeight: 600,
                        }}
                      >
                        moves the forecast
                        {ITEMIZED_FIELD_ELIGIBILITY[chg.field]?.dollar
                          ? " · dollar amount"
                          : ""}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button
                      type="button"
                      style={quietBtn}
                      onClick={() => removeChange(i)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {changes.length === 0 && (
          <div style={{ color: sub, fontSize: 12.5, marginTop: 12 }}>
            No changes yet. A change-set can carry up to 50 field edits; each is
            matched by account across every scoped property.
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>2 · Scope properties</h2>
        <p style={helpStyle}>
          {touchesDollar
            ? "This change-set edits a dollar amount. Dollar values are usually property-shaped (a number that is right for a 40-bed property is wrong for a 200-bed one), so no properties are pre-selected — opt in deliberately."
            : "All budget-registered properties are pre-selected. Deselect any property that should keep its current values."}
        </p>
        {touchesDollar && (
          <div
            style={{
              background: T.warningBg,
              color: T.warningText,
              fontSize: 12.5,
              padding: "8px 12px",
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            Broadcasting a fixed dollar amount portfolio-wide is the
            highest-blast-radius edit this page can make. Review the dry-run
            per-property $ impact carefully before applying.
          </div>
        )}
        <div style={{ marginBottom: 8 }}>
          <button
            type="button"
            style={quietBtn}
            onClick={() => setAllProperties(true)}
          >
            Select all
          </button>{" "}
          <button
            type="button"
            style={quietBtn}
            onClick={() => setAllProperties(false)}
          >
            Select none
          </button>{" "}
          <span style={{ fontSize: 12, color: sub }}>
            {scoped.size} of {propertyCodes.codes.length} selected
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
          {propertyCodes.codes.map((code) => (
            <label
              key={code}
              style={{ fontSize: 12.5, color: text, minWidth: 110 }}
            >
              <input
                type="checkbox"
                checked={scoped.has(code)}
                onChange={() => toggleProperty(code)}
              />{" "}
              {code}
            </label>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>3 · Dry-run the blast radius</h2>
        <p style={helpStyle}>
          Resolves the change-set against every scoped property and shows rows
          matched, old → new values, and the forward-month $ delta — before
          anything is written. The dry-run also issues the approval token (valid
          1 hour, single use, bound to this exact change-set). Runs are capped
          at 500 matched rows — narrow the property scope or split the
          change-set if you hit the cap.
        </p>
        {parityRunning && (
          <div
            style={{
              background: T.warningBg,
              color: T.warningText,
              fontSize: 12.5,
              padding: "8px 12px",
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            A budget parity run is currently in progress. Hold applies until it
            completes — propagation writes intentionally diverge from the
            workbook baseline and would muddy the parity verdict.
          </div>
        )}
        <button
          type="button"
          style={btnStyle(
            changes.length > 0 && scoped.size > 0 && !anyJobRunning,
          )}
          disabled={changes.length === 0 || scoped.size === 0 || anyJobRunning}
          onClick={runDryRun}
        >
          {dryRun.running ? "Running dry-run…" : "Run dry-run"}
        </button>
        {dryRun.error && (
          <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 10 }}>
            {dryRun.error}
          </div>
        )}

        {dryRun.result && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12.5, color: text, marginBottom: 8 }}>
              <strong>{rowsMatchedTotal}</strong> row
              {rowsMatchedTotal === 1 ? "" : "s"} matched across{" "}
              <strong>{(dryRun.result.properties || []).length}</strong> propert
              {(dryRun.result.properties || []).length === 1 ? "y" : "ies"}.{" "}
              Token expires{" "}
              {dryRun.result.expires_at
                ? new Date(dryRun.result.expires_at).toLocaleTimeString()
                : "—"}
              .
              {tokenExpired && (
                <span style={{ color: T.dangerText, fontWeight: 600 }}>
                  {" "}
                  Token expired — re-run the dry-run.
                </span>
              )}
            </div>

            {analysis && rowsMatchedTotal > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 12, color: sub }}>
                  Net forecast impact
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: text }}>
                  {fmtMoney(analysis.crossPropertyTotal)}
                </span>
                <span style={{ fontSize: 12, color: sub }}>
                  over {analysis.rowCount} matched row
                  {analysis.rowCount === 1 ? "" : "s"}
                </span>
                {analysis.hasAnomalies && (
                  <Pill t={agentTheme} tone="danger">
                    {analysis.anomalies.length} anomal
                    {analysis.anomalies.length === 1 ? "y" : "ies"} — verify
                    below
                  </Pill>
                )}
              </div>
            )}

            {analysis && analysis.hasAnomalies && (
              <AnomaliesBanner t={agentTheme} anomalies={analysis.anomalies} />
            )}
            {analysis && rowsMatchedTotal > 0 && (
              <div
                style={{
                  fontSize: 11.5,
                  color: sub,
                  margin: "0 0 8px",
                  lineHeight: 1.5,
                }}
              >
                Flags catch large jumps, sign flips, and dollar outliers — a
                scan aid, not a completeness check. Read every row before you
                apply.
              </div>
            )}

            {(dryRun.result.unmatched_properties || []).length > 0 && (
              <div
                style={{
                  background: T.warningBg,
                  color: T.warningText,
                  fontSize: 12.5,
                  padding: "8px 12px",
                  borderRadius: 6,
                  marginBottom: 10,
                }}
              >
                No matching rows on:{" "}
                {(dryRun.result.unmatched_properties || []).join(", ")}. An
                unmatched property usually means its row structure has drifted
                from the representative property — worth a look before assuming
                the change doesn't apply there.
              </div>
            )}
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Property</th>
                  <th style={th}>Status</th>
                  <th style={th}>Rows</th>
                  <th style={th}>Forward $ delta</th>
                  <th style={th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {(dryRun.result.properties || []).map((p) => {
                  const pRows = Array.isArray(p.rows) ? p.rows : [];
                  const pRowFlags = pRows.map((r) =>
                    analysis ? rowFlags(r, analysis.ctx) : [],
                  );
                  const pFlaggedCount = pRowFlags.filter(
                    (f) => f.length > 0,
                  ).length;
                  return (
                    <React.Fragment key={p.property_code}>
                      <tr
                        style={
                          pFlaggedCount > 0
                            ? { background: T.dangerBg }
                            : undefined
                        }
                      >
                        <td style={td}>{p.property_code}</td>
                        <td
                          style={{
                            ...td,
                            color:
                              p.status === "no_matches"
                                ? T.warningText
                                : T.successText,
                            fontWeight: 600,
                          }}
                        >
                          {p.status === "no_matches" ? "no matches" : "ok"}
                          {pFlaggedCount > 0 && (
                            <span style={{ marginLeft: 6 }}>
                              <Pill
                                t={agentTheme}
                                tone="danger"
                                title="This property holds one or more figures flagged as anomalous — expand the rows to review before you apply."
                              >
                                {pFlaggedCount} flagged
                              </Pill>
                            </span>
                          )}
                        </td>
                        <td style={td}>{p.rows_matched}</td>
                        <td style={td}>{fmtMoney(p.delta_total)}</td>
                        <td style={td}>
                          {pRows.length > 0 && (
                            <button
                              type="button"
                              style={{
                                background: "none",
                                border: "none",
                                color: sub,
                                cursor: "pointer",
                                fontSize: 12,
                                padding: 0,
                                font: "inherit",
                              }}
                              onClick={() =>
                                setExpandedApply(
                                  expandedApply === `dry:${p.property_code}`
                                    ? null
                                    : `dry:${p.property_code}`,
                                )
                              }
                            >
                              {expandedApply === `dry:${p.property_code}`
                                ? "hide"
                                : "show"}{" "}
                              rows
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedApply === `dry:${p.property_code}` && (
                        <tr>
                          <td
                            style={{ ...td, background: T.inset }}
                            colSpan={5}
                          >
                            <table
                              style={{
                                borderCollapse: "collapse",
                                width: "100%",
                              }}
                            >
                              <thead>
                                <tr>
                                  <th style={th}>Row</th>
                                  <th style={th}>Scope</th>
                                  <th style={th}>Field</th>
                                  <th style={th}>Old</th>
                                  <th style={th}>New</th>
                                  <th style={th}>$ delta</th>
                                  <th style={th}>Flags</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pRows.map((r, i) => {
                                  const flags = pRowFlags[i];
                                  const change = changes[r.change_index];
                                  const wildcard = change
                                    ? isAccountWildcard(change)
                                    : false;
                                  return (
                                    <tr
                                      key={i}
                                      style={
                                        flags.length > 0
                                          ? { background: T.dangerBg }
                                          : undefined
                                      }
                                    >
                                      <td style={td}>
                                        {r.target === "pdpq"
                                          ? `PDPQ ${r.assumption_key}`
                                          : `${r.account_number}${r.line_description ? ` · ${r.line_description}` : ""}`}
                                      </td>
                                      <td style={td}>
                                        {wildcard ? (
                                          <Pill
                                            t={agentTheme}
                                            tone="warn"
                                            title="An absent line description matches EVERY line under this account — the widest possible scope."
                                          >
                                            {scopeLabel(change)}
                                          </Pill>
                                        ) : (
                                          <span
                                            style={{ fontSize: 12, color: sub }}
                                          >
                                            {change
                                              ? scopeLabel(change)
                                              : r.target === "pdpq"
                                                ? "Assumption key"
                                                : "Single line"}
                                          </span>
                                        )}
                                      </td>
                                      <td style={td}>
                                        {FIELD_LABELS[r.field] || r.field}
                                      </td>
                                      <td style={td}>
                                        {fmtValue(r.old_value)}
                                      </td>
                                      <td style={td}>
                                        {fmtValue(r.new_value)}
                                        {r.already_equal ? (
                                          <span style={{ color: sub }}>
                                            {" "}
                                            (unchanged)
                                          </span>
                                        ) : null}
                                      </td>
                                      <td style={td}>
                                        {r.numeric_effect ===
                                        "metadata_only" ? (
                                          <span style={{ color: sub }}>
                                            $0 — records only
                                          </span>
                                        ) : (
                                          fmtMoney(r.delta_total)
                                        )}
                                      </td>
                                      <td style={td}>
                                        <FlagPills
                                          t={agentTheme}
                                          flags={flags}
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>4 · Approve + apply</h2>
        <p style={helpStyle}>
          Type the matched-row count from the dry-run to confirm. Every written
          row is snapshotted to the version history automatically; the batch is
          undoable below.
        </p>
        {!dryRun.result && (
          <div style={{ color: sub, fontSize: 12.5 }}>
            Run a dry-run first — apply is gated on a fresh approval token.
          </div>
        )}
        {dryRun.result && (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <label style={{ fontSize: 12, color: sub }}>
              Type <strong>{rowsMatchedTotal}</strong> to confirm
              <br />
              <input
                style={inputStyle}
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={!!applyState.result}
              />
            </label>
            <button
              type="button"
              style={btnStyle(confirmReady && !anyJobRunning)}
              disabled={!confirmReady || anyJobRunning}
              onClick={runApply}
            >
              {applyState.running
                ? "Applying…"
                : `Apply to ${(dryRun.result.property_codes || []).length} properties`}
            </button>
          </div>
        )}
        {applyState.running && jobNotice && (
          <div
            style={{
              background: T.warningBg,
              color: T.warningText,
              fontSize: 12.5,
              padding: "8px 12px",
              borderRadius: 6,
              marginTop: 10,
            }}
          >
            {jobNotice}
          </div>
        )}
        {applyState.error && (
          <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 10 }}>
            {applyState.error}
          </div>
        )}
        {applyState.result && (
          <div style={{ marginTop: 12 }}>
            {Number(applyState.result.rows_updated_total || 0) > 0 ? (
              <div
                style={{
                  color: T.successText,
                  fontSize: 12.5,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Applied — {applyState.result.rows_updated_total} row
                {applyState.result.rows_updated_total === 1 ? "" : "s"} updated.
                The portfolio cache refresh has been kicked off (~35s).
              </div>
            ) : (
              <div
                style={{
                  background: T.warningBg,
                  color: T.warningText,
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "8px 12px",
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                0 rows updated — nothing changed (no matching rows, or every
                property failed; see the per-property results below — rows
                already at the target value are skipped so their edit history
                stays clean). No cache refresh was fired. The approval token was
                consumed — run a fresh dry-run before retrying.
              </div>
            )}
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Property</th>
                  <th style={th}>Status</th>
                  <th style={th}>Rows updated</th>
                  <th style={th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {(applyState.result.properties || []).map((p, i) => (
                  <tr key={i}>
                    <td style={td}>{p.property_code}</td>
                    <td
                      style={{
                        ...td,
                        color:
                          p.status === "failed"
                            ? T.dangerText
                            : p.status === "no_matches"
                              ? T.warningText
                              : p.status === "already_equal"
                                ? sub
                                : T.successText,
                        fontWeight: 600,
                      }}
                    >
                      {p.status === "already_equal"
                        ? "already at value"
                        : p.status}
                    </td>
                    <td style={td}>{p.rows_updated ?? 0}</td>
                    <td style={td}>{p.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>5 · History + undo</h2>
        <p style={helpStyle}>
          Every apply batch, newest first. Undo replays the batch's pre-images;
          rows manually edited since the apply are skipped and reported, never
          overwritten.
        </p>
        {history.loading && (
          <div style={{ color: sub, fontSize: 13 }} role="status">
            Loading history…
          </div>
        )}
        {!history.loading && history.error && (
          <div style={{ color: T.dangerText, fontSize: 13 }}>
            Could not load history — {history.error}
          </div>
        )}
        {!history.loading && !history.error && history.rows.length === 0 && (
          <div style={{ color: sub, fontSize: 12.5 }}>
            No propagation batches yet. The first apply will appear here with
            its full row-level record.
          </div>
        )}
        {history.rows.length > 0 && (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Applied</th>
                <th style={th}>Name</th>
                <th style={th}>Properties</th>
                <th style={th}>Rows</th>
                <th style={th}>Status</th>
                <th style={th}>Detail</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {history.rows.map((b) => (
                <React.Fragment key={b.id}>
                  <tr>
                    <td style={td}>
                      {b.applied_at
                        ? new Date(b.applied_at).toLocaleString()
                        : "—"}
                    </td>
                    <td style={td}>{b.change_set_name || "(unnamed)"}</td>
                    <td style={td}>{(b.property_codes || []).length}</td>
                    <td style={td}>{b.rows_updated}</td>
                    <td style={td}>
                      {b.undone_at ? (
                        <span style={{ color: sub }}>
                          undone {new Date(b.undone_at).toLocaleString()}
                        </span>
                      ) : (
                        <span style={{ color: T.successText, fontWeight: 600 }}>
                          applied
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        style={{
                          background: "none",
                          border: "none",
                          color: sub,
                          cursor: "pointer",
                          fontSize: 12,
                          padding: 0,
                          font: "inherit",
                        }}
                        onClick={() =>
                          setExpandedApply(expandedApply === b.id ? null : b.id)
                        }
                      >
                        {expandedApply === b.id ? "hide" : "show"} rows
                      </button>
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {!b.undone_at &&
                        (undoArm === b.id ? (
                          <>
                            <button
                              type="button"
                              style={{
                                ...quietBtn,
                                color: T.dangerText,
                                fontWeight: 700,
                              }}
                              disabled={anyJobRunning}
                              onClick={() => runUndo(b.id)}
                            >
                              {undoState.running && undoState.applyId === b.id
                                ? "Undoing…"
                                : "Confirm undo"}
                            </button>{" "}
                            <button
                              type="button"
                              style={quietBtn}
                              onClick={() => setUndoArm(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            style={quietBtn}
                            disabled={anyJobRunning}
                            onClick={() => setUndoArm(b.id)}
                          >
                            Undo batch
                          </button>
                        ))}
                    </td>
                  </tr>
                  {expandedApply === b.id && (
                    <tr>
                      <td style={{ ...td, background: T.inset }} colSpan={7}>
                        <table
                          style={{ borderCollapse: "collapse", width: "100%" }}
                        >
                          <thead>
                            <tr>
                              <th style={th}>Property</th>
                              <th style={th}>Target</th>
                              <th style={th}>Field</th>
                              <th style={th}>Before</th>
                              <th style={th}>After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(b.row_images || []).map((img, i) => (
                              <tr key={i}>
                                <td style={td}>{img.property_code}</td>
                                <td style={td}>{img.target}</td>
                                <td style={td}>
                                  {FIELD_LABELS[img.field] || img.field}
                                </td>
                                <td style={td}>{fmtValue(img.pre)}</td>
                                <td style={td}>{fmtValue(img.post)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {history.hasMore && (
          <button
            type="button"
            style={{ ...quietBtn, marginTop: 10 }}
            disabled={historyLoadingMore}
            onClick={() => loadHistory({ append: true })}
          >
            {historyLoadingMore ? "Loading…" : "Load older batches"}
          </button>
        )}
        {historyMoreError && (
          <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 8 }}>
            Could not load older batches — {historyMoreError}. The batches
            already shown are unaffected.
          </div>
        )}
        {undoState.running && jobNotice && (
          <div
            style={{
              background: T.warningBg,
              color: T.warningText,
              fontSize: 12.5,
              padding: "8px 12px",
              borderRadius: 6,
              marginTop: 10,
            }}
          >
            {jobNotice}
          </div>
        )}
        {undoState.error && (
          <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 10 }}>
            Undo failed — {undoState.error}
          </div>
        )}
        {undoState.result && (
          <div style={{ color: text, fontSize: 12.5, marginTop: 10 }}>
            Undo complete: <strong>{undoState.result.restored}</strong>{" "}
            restored, <strong>{undoState.result.skipped_modified}</strong>{" "}
            skipped (edited since apply),{" "}
            <strong>{undoState.result.failed}</strong> failed.
          </div>
        )}
      </div>
    </div>
  );
}
