import React, { useEffect, useMemo, useRef, useState } from "react";
import { T } from "../../lib/theme.js";
import { callBudgetAgent, PHASE_STARTING } from "./budgetAgentClient.js";
import { fetchBudgetPropertyCodes } from "../../lib/supabaseClient.js";
import useSpeechRecognition from "./useSpeechRecognition.js";
import useAssumptionPropagation from "./useAssumptionPropagation.js";
import {
  ProposalCard,
  BlastRadiusCard,
  ApplyResultCard,
  ApplyRecoveryNote,
  UndoCard,
  ErrorCard,
  Pill,
} from "./BudgetAgentCards.jsx";

function buildExamples(codes) {
  const a = codes[0];
  const b = codes[1];
  if (!a) {
    return [
      "Raise the management fee 3% for next fiscal year",
      "Set the insurance line to a fixed annual amount",
      "Change the payroll frequency to monthly",
    ];
  }
  return [
    `Raise the management fee 3% on ${b ? `${a} and ${b}` : a} for next fiscal year`,
    `Set the insurance line to a fixed annual amount on ${a}`,
    `Change the payroll frequency to monthly on ${b || a}`,
  ];
}

let msgSeq = 0;
const nextMsgId = () => `m${++msgSeq}`;

const EXPECTATION_SEC = 15;
const LONG_TURN_SEC = 180;

export default function BudgetAgentPage({ C = {}, userProfile } = {}) {
  const t = useMemo(
    () => ({
      text: C.textPrimary || C.text || T.textPrimary,
      sub: C.textSecondary || T.textSecondary,
      border: C.border || T.border,
      card: C.card || C.cardBg || T.surface,
      inset: T.inset,
      accent: "#3b82f6",
      danger: "#ef4444",
      ok: "#22c55e",
      warn: "#f59e0b",
    }),
    [C],
  );

  const [messages, setMessages] = useState(() => [
    {
      id: nextMsgId(),
      role: "assistant",
      uiOnly: true,
      content:
        "I'm the budget analyst. Tell me a forecast change in plain language and I'll propose a concrete change-set you can review, dry-run, and apply. I only propose; you confirm and apply every change.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [activeProposal, setActiveProposal] = useState(null);
  const [undoArmed, setUndoArmed] = useState(false);
  const [propertyCodes, setPropertyCodes] = useState({
    loading: true,
    error: null,
    codes: [],
  });
  const [turnPhase, setTurnPhase] = useState(PHASE_STARTING);
  const [turnStartedAt, setTurnStartedAt] = useState(null);
  const [nowTs, setNowTs] = useState(null);

  const prop = useAssumptionPropagation();
  const propRef = useRef(prop);
  propRef.current = prop;

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  const speech = useSpeechRecognition({
    onFinal: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text).trim());
      if (taRef.current) taRef.current.focus();
    },
  });

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    messages,
    thinking,
    prop.dryRun,
    prop.applyState,
    prop.undoState,
    activeProposal,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await fetchBudgetPropertyCodes();
        if (cancelled) return;
        if (error) {
          setPropertyCodes({
            loading: false,
            error: String(error.message || error),
            codes: [],
          });
          return;
        }
        setPropertyCodes({
          loading: false,
          error: null,
          codes: Array.isArray(data) ? data : [],
        });
      } catch (e) {
        if (!cancelled)
          setPropertyCodes({
            loading: false,
            error: e?.message || "Could not load properties.",
            codes: [],
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!thinking || turnStartedAt == null) return undefined;
    setNowTs(Date.now());
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [thinking, turnStartedAt]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = thinking || prop.anyJobRunning;

  const elapsedSec =
    thinking && turnStartedAt != null && nowTs != null
      ? Math.max(0, Math.floor((nowTs - turnStartedAt) / 1000))
      : 0;
  const elapsedLabel = elapsedSec >= 3 ? `${elapsedSec}s` : "";

  const examples = useMemo(
    () => buildExamples(propertyCodes.codes),
    [propertyCodes.codes],
  );
  const composerPlaceholder = useMemo(
    () => `e.g. ${buildExamples(propertyCodes.codes)[0]}`,
    [propertyCodes.codes],
  );

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setSendError(null);

    const userMsg = { id: nextMsgId(), role: "user", content: text };
    const priorForApi = messages
      .filter((m) => !m.uiOnly)
      .map((m) => ({ role: m.role, content: m.content }));
    const apiMessages = [...priorForApi, { role: "user", content: text }];

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);
    setTurnPhase(PHASE_STARTING);
    setTurnStartedAt(Date.now());

    const controller = new AbortController();
    abortRef.current = controller;

    const context = {
      currentView: "Budget Agent",
      budgetScope: "portfolio",
      userQuestion: text,
      priorContext: priorForApi
        .slice(-6)
        .map((m) => `${m.role}: ${String(m.content || "").slice(0, 300)}`)
        .join("\n"),
    };

    try {
      const { reply, proposal } = await callBudgetAgent({
        messages: apiMessages,
        context,
        signal: controller.signal,
        onProgress: ({ phase }) => setTurnPhase(phase),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: "assistant",
          content: reply || "(the budget agent returned no text)",
          proposal: proposal || null,
        },
      ]);
      if (
        proposal &&
        Array.isArray(proposal.change_set?.changes) &&
        proposal.change_set.changes.length > 0
      ) {
        setUndoArmed(false);
        propRef.current.invalidate();
        setActiveProposal(proposal);
        propRef.current.runDryRun(proposal.change_set, proposal.property_codes);
      }
    } catch (e) {
      if (e?.name === "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId(),
            role: "assistant",
            uiOnly: true,
            content: "(stopped)",
          },
        ]);
      } else {
        setSendError(
          e?.message ||
            "The budget agent is unavailable — your data is unchanged.",
        );
      }
    } finally {
      setThinking(false);
      setTurnStartedAt(null);
      abortRef.current = null;
    }
  }

  function stop() {
    if (abortRef.current) abortRef.current.abort();
  }

  function onApply() {
    if (!activeProposal) return;
    setUndoArmed(false);
    propRef.current.runApply(activeProposal.change_set);
  }

  function onUndo() {
    const applyId = prop.applyState.result?.apply_id;
    if (!applyId) return;
    if (!undoArmed) {
      setUndoArmed(true);
      return;
    }
    setUndoArmed(false);
    propRef.current.runUndo(applyId);
  }

  function onComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const shell = { maxWidth: 900, margin: "0 auto", padding: "18px 20px 40px" };
  const btn = (enabled, tone = "accent") => ({
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 16px",
    borderRadius: 6,
    border: `1px solid ${enabled ? (tone === "danger" ? t.danger : t.accent) : t.border}`,
    background: enabled ? (tone === "danger" ? t.danger : t.accent) : t.inset,
    color: enabled ? "#fff" : t.sub,
    cursor: enabled ? "pointer" : "not-allowed",
  });
  const ghostBtn = (enabled) => ({
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 12px",
    borderRadius: 6,
    border: `1px solid ${t.border}`,
    background: t.inset,
    color: enabled ? t.text : t.sub,
    cursor: enabled ? "pointer" : "not-allowed",
  });

  const r = prop.dryRun.result;
  const showConfirm =
    !!r &&
    !prop.applyState.result &&
    !prop.applyState.error &&
    !prop.tokenExpired &&
    prop.rowsMatchedTotal > 0 &&
    !prop.applyState.running;

  return (
    <div style={shell}>
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{ fontSize: 20, fontWeight: 700, color: t.text, margin: 0 }}
          >
            Budget Agent
          </h1>
          <Pill t={t} tone="neutral">
            GP / admin
          </Pill>
          <Pill t={t} tone="accent">
            proposal-only · you apply
          </Pill>
        </div>
        <p
          style={{
            fontSize: 12.5,
            color: t.sub,
            margin: "6px 0 0",
            lineHeight: 1.5,
          }}
        >
          Describe a forecast change in plain language. The agent proposes a
          typed change-set; you review the blast radius, confirm the matched-row
          count, and apply. Every applied dollar is human-confirmed and
          reversible.
        </p>
      </div>

      <div
        ref={scrollRef}
        aria-live="polite"
        style={{
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          background: t.card,
          padding: 14,
          maxHeight: 380,
          overflowY: "auto",
          marginBottom: 12,
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: "82%",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                padding: "8px 12px",
                borderRadius: 10,
                background: m.role === "user" ? t.accent : t.inset,
                color: m.role === "user" ? "#fff" : t.text,
                border: m.role === "user" ? "none" : `1px solid ${t.border}`,
                fontStyle: m.uiOnly ? "italic" : "normal",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {thinking ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: t.sub,
              fontSize: 12.5,
              padding: "4px 2px",
            }}
          >
            <span
              className="ba-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: t.sub,
                display: "inline-block",
                animation: "ba-pulse 1s infinite",
              }}
            />
            <span>
              {turnPhase === PHASE_STARTING
                ? "Starting the budget agent…"
                : "The budget agent is working…"}
              {elapsedLabel ? (
                <span aria-hidden="true" style={{ opacity: 0.8 }}>
                  {" "}
                  {elapsedLabel}
                </span>
              ) : null}
              {elapsedSec >= LONG_TURN_SEC ? (
                <span style={{ opacity: 0.8 }}>
                  {" "}
                  · this is taking longer than usual — you can Stop and try
                  again
                </span>
              ) : elapsedSec >= EXPECTATION_SEC ? (
                <span style={{ opacity: 0.8 }}>
                  {" "}
                  · a full answer usually takes about a minute
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={speech.listening ? "Listening…" : composerPlaceholder}
          rows={2}
          disabled={busy}
          style={{
            flex: 1,
            resize: "vertical",
            fontSize: 13,
            lineHeight: 1.5,
            padding: "9px 11px",
            borderRadius: 8,
            border: `1px solid ${speech.listening ? t.accent : t.border}`,
            background: t.inset,
            color: t.text,
            fontFamily: "inherit",
            minHeight: 42,
          }}
        />
        {speech.supported ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (busy) return;
              speech.listening ? speech.stop() : speech.start();
            }}
            title={speech.listening ? "Stop dictation" : "Dictate"}
            aria-pressed={speech.listening}
            style={{
              ...ghostBtn(!busy),
              padding: "8px 12px",
              borderColor: speech.listening ? t.accent : t.border,
              color: speech.listening ? t.accent : t.text,
            }}
            disabled={busy}
          >
            {speech.listening ? "◉ Stop" : "🎤 Speak"}
          </button>
        ) : null}
        {thinking ? (
          <button type="button" onClick={stop} style={btn(true, "danger")}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || busy}
            style={btn(!!input.trim() && !busy)}
          >
            Send
          </button>
        )}
      </div>

      {speech.listening && speech.interim ? (
        <div
          style={{
            fontSize: 12,
            color: t.sub,
            marginTop: 6,
            fontStyle: "italic",
          }}
        >
          Heard: {speech.interim}
        </div>
      ) : null}
      {speech.error ? (
        <div style={{ fontSize: 12, color: t.danger, marginTop: 6 }}>
          {speech.error}
        </div>
      ) : null}
      {speech.unavailableReason === "browser" ? (
        <div style={{ fontSize: 11.5, color: t.sub, marginTop: 6 }}>
          Voice input isn't available in this browser — Chrome or Edge support
          dictation. You can type instead.
        </div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 12, color: t.sub }}>
        {propertyCodes.loading ? (
          "Loading your properties…"
        ) : propertyCodes.error ? (
          "Could not load your property list. You can still name a property in your request."
        ) : propertyCodes.codes.length === 0 ? (
          "No budget properties are registered for your organization yet. An admin can register a budget workbook from Admin Console → Platform → Budget Workbook Intake, and its property code will appear here."
        ) : (
          <>
            <span>
              Registered budget properties ({propertyCodes.codes.length}):{" "}
            </span>
            {propertyCodes.codes.map((code) => (
              <button
                key={code}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setInput((prev) => {
                    const base = String(prev || "").trimEnd();
                    if (
                      new RegExp(
                        `(^|\\s)${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`,
                      ).test(base)
                    )
                      return base;
                    return base ? `${base} ${code}` : code;
                  });
                  if (taRef.current) taRef.current.focus();
                }}
                title={`Add ${code} to your request`}
                style={{
                  ...ghostBtn(!busy),
                  padding: "3px 8px",
                  fontSize: 11.5,
                  marginRight: 6,
                  marginTop: 4,
                  fontWeight: 600,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {code}
              </button>
            ))}
          </>
        )}
      </div>

      {messages.length <= 1 && !activeProposal ? (
        <div style={{ marginTop: 10, fontSize: 12, color: t.sub }}>
          Try:{" "}
          {examples.map((ex, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setInput(ex)}
              style={{
                ...ghostBtn(true),
                padding: "3px 8px",
                fontSize: 11.5,
                marginRight: 6,
                marginTop: 4,
                fontWeight: 500,
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      <ErrorCard t={t} message={sendError} />

      {activeProposal ? (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: t.text,
              marginBottom: 2,
            }}
          >
            Forecast change
          </div>
          <ProposalCard t={t} proposal={activeProposal} dryRun={prop.dryRun} />
          <BlastRadiusCard
            t={t}
            dryRun={prop.dryRun}
            tokenExpired={prop.tokenExpired}
          />

          {prop.jobNotice ? (
            <div style={{ fontSize: 12, color: t.warn, marginTop: 8 }}>
              {prop.jobNotice}
            </div>
          ) : null}

          {showConfirm ? (
            <div
              style={{
                marginTop: 10,
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                padding: 12,
                background: t.card,
              }}
            >
              <div style={{ fontSize: 12.5, color: t.text, marginBottom: 8 }}>
                To apply, type the matched-row count{" "}
                <strong>{prop.rowsMatchedTotal}</strong> to confirm:
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  value={prop.confirmText}
                  onChange={(e) => prop.setConfirmText(e.target.value)}
                  placeholder={String(prop.rowsMatchedTotal)}
                  inputMode="numeric"
                  style={{
                    width: 90,
                    fontSize: 13,
                    padding: "7px 9px",
                    borderRadius: 6,
                    border: `1px solid ${t.border}`,
                    background: t.inset,
                    color: t.text,
                  }}
                />
                <button
                  type="button"
                  onClick={onApply}
                  disabled={!prop.confirmReady || prop.anyJobRunning}
                  style={btn(prop.confirmReady && !prop.anyJobRunning)}
                >
                  Apply to {(activeProposal.property_codes || []).length}{" "}
                  propert
                  {(activeProposal.property_codes || []).length === 1
                    ? "y"
                    : "ies"}
                </button>
              </div>
            </div>
          ) : null}

          {prop.tokenExpired &&
          !prop.applyState.result &&
          !prop.applyState.error ? (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() =>
                  propRef.current.runDryRun(
                    activeProposal.change_set,
                    activeProposal.property_codes,
                  )
                }
                disabled={prop.anyJobRunning}
                style={ghostBtn(!prop.anyJobRunning)}
              >
                Re-run dry-run
              </button>
            </div>
          ) : null}

          <ApplyResultCard t={t} applyState={prop.applyState} />

          {prop.applyState.error ? (
            <ApplyRecoveryNote
              t={t}
              onRerun={() =>
                propRef.current.runDryRun(
                  activeProposal.change_set,
                  activeProposal.property_codes,
                )
              }
              rerunDisabled={prop.anyJobRunning}
            />
          ) : null}

          {prop.applyState.result?.apply_id && !prop.undoState.result ? (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={onUndo}
                disabled={prop.anyJobRunning}
                style={
                  undoArmed
                    ? btn(!prop.anyJobRunning, "danger")
                    : ghostBtn(!prop.anyJobRunning)
                }
              >
                {undoArmed ? "Confirm undo" : "Undo this batch"}
              </button>
              {undoArmed ? (
                <button
                  type="button"
                  onClick={() => setUndoArmed(false)}
                  style={ghostBtn(true)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : null}

          <UndoCard t={t} undoState={prop.undoState} />
        </div>
      ) : null}

      <style>{`@keyframes ba-pulse { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}
