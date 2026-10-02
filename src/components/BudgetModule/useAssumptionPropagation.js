import { useEffect, useRef, useState } from "react";
import { supabase, getCurrentAccessToken } from "../../lib/supabaseClient.js";
import { validateChangeSet } from "../../../netlify/functions/_assumption-eligibility.js";

export const POLL_INTERVAL_MS = 2000;
export const POLL_DEADLINE_MS = 5 * 60 * 1000;
export const JOB_APPEAR_DEADLINE_MS = 12 * 1000;

const IDLE = { running: false, error: null, result: null };

export function newUuid() {
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

export default function useAssumptionPropagation() {
  const [dryRun, setDryRun] = useState(IDLE);
  const [applyState, setApplyState] = useState(IDLE);
  const [undoState, setUndoState] = useState({ ...IDLE, applyId: null });
  const [confirmText, setConfirmText] = useState("");
  const [jobNotice, setJobNotice] = useState("");
  const pollTimerRef = useRef(null);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };
  useEffect(
    () => () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    },
    [],
  );

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
                "The job never registered. Check the History panel (Portfolio Assumptions → History + undo) and the version history before retrying — do not assume nothing was written.",
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
        console.warn("[useAssumptionPropagation poll]", e?.message || e);
      }
    }, POLL_INTERVAL_MS);
  };

  const runDryRun = (changeSet, propertyCodes) => {
    if (anyJobRunning) return;
    const v = validateChangeSet(changeSet);
    if (!v.ok) {
      setDryRun({ running: false, error: v.errors.join("; "), result: null });
      return;
    }
    const codes = Array.isArray(propertyCodes)
      ? [
          ...new Set(
            propertyCodes
              .map((c) => (typeof c === "string" ? c.trim() : ""))
              .filter(Boolean),
          ),
        ].sort()
      : [];
    if (codes.length === 0) {
      setDryRun({
        running: false,
        error: "No properties in scope for this proposal.",
        result: null,
      });
      return;
    }
    setApplyState(IDLE);
    setUndoState({ ...IDLE, applyId: null });
    setConfirmText("");
    setDryRun({ running: true, error: null, result: null });
    runJob(
      { mode: "dry-run", change_set: changeSet, property_codes: codes },
      (result) => setDryRun({ running: false, error: null, result }),
      (err) => setDryRun({ running: false, error: err, result: null }),
    );
  };

  const tokenExpired = dryRun.result?.expires_at
    ? new Date(dryRun.result.expires_at).getTime() < Date.now()
    : false;
  const rowsMatchedTotal = dryRun.result?.rows_matched_total ?? 0;
  const confirmReady =
    !!dryRun.result &&
    !applyState.result &&
    !tokenExpired &&
    rowsMatchedTotal > 0 &&
    confirmText.trim() === String(rowsMatchedTotal);

  const runApply = (changeSet) => {
    if (!confirmReady || anyJobRunning) return;
    setApplyState({ running: true, error: null, result: null });
    runJob(
      {
        mode: "apply",
        approval_token: dryRun.result.approval_token,
        change_set: changeSet,
      },
      (result) => setApplyState({ running: false, error: null, result }),
      (err) => {
        setApplyState({ running: false, error: err, result: null });
        setConfirmText("");
      },
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
    if (anyJobRunning || !applyId) return;
    setUndoState({ running: true, error: null, result: null, applyId });
    runJob(
      { mode: "undo", apply_id: applyId },
      (result) =>
        setUndoState({ running: false, error: null, result, applyId }),
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

  const invalidate = () => {
    stopPolling();
    setDryRun(IDLE);
    setApplyState(IDLE);
    setUndoState({ ...IDLE, applyId: null });
    setConfirmText("");
    setJobNotice("");
  };

  return {
    dryRun,
    applyState,
    undoState,
    confirmText,
    setConfirmText,
    jobNotice,
    anyJobRunning,
    tokenExpired,
    rowsMatchedTotal,
    confirmReady,
    runDryRun,
    runApply,
    runUndo,
    invalidate,
  };
}
