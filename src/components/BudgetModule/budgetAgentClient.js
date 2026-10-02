import { supabase, getCurrentAccessToken } from "../../lib/supabaseClient.js";

const AGENT_ENDPOINT = "/.netlify/functions/budget-agent-chat-background";
const AGENT_ID = "budget";

export const POLL_INTERVAL_MS = 2000;
export const POLL_DEADLINE_MS = 13 * 60 * 1000;
export const JOB_APPEAR_DEADLINE_MS = 30 * 1000;

export const PHASE_STARTING = "starting";
export const PHASE_WORKING = "working";

export function newTurnId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function interpretTurn({ turn, seen, elapsedMs }) {
  if (!turn) {
    if (!seen && elapsedMs > JOB_APPEAR_DEADLINE_MS) {
      return {
        action: "reject",
        message:
          "The budget agent didn't start in time. Check that you're signed in with a GP or admin role, then try again.",
      };
    }
    return { action: "wait", phase: seen ? PHASE_WORKING : PHASE_STARTING };
  }
  if (turn.status === "done") {
    return {
      action: "resolve",
      value: {
        reply: typeof turn.reply === "string" ? turn.reply : "",
        proposal: turn.proposal || null,
      },
    };
  }
  if (turn.status === "error") {
    return {
      action: "reject",
      message:
        turn.error_message ||
        "The budget agent is unavailable — your data is unchanged.",
    };
  }
  if (elapsedMs > POLL_DEADLINE_MS) {
    return {
      action: "reject",
      message:
        "The budget agent timed out — your data is unchanged. Please try again.",
    };
  }
  return {
    action: "wait",
    phase: turn.status === "queued" ? PHASE_STARTING : PHASE_WORKING,
  };
}

async function fetchTurn(turnId) {
  const { data, error } = await supabase
    .from("budget_agent_turns")
    .select("turn_id, status, reply, proposal, error_message")
    .eq("turn_id", turnId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function pollTurn(turnId, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let seen = false;
    let timer = null;
    let stopped = false;

    const report = (phase, elapsedMs) => {
      if (stopped || typeof onProgress !== "function") return;
      try {
        onProgress({ phase, elapsedMs });
      } catch {}
    };
    report(PHASE_STARTING, 0);

    const stop = () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      stop();
      const e = new Error("Aborted");
      e.name = "AbortError";
      reject(e);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    }

    timer = setInterval(async () => {
      try {
        const turn = await fetchTurn(turnId);
        if (stopped) return;
        if (turn) seen = true;
        const elapsedMs = Date.now() - startedAt;
        const next = interpretTurn({ turn, seen, elapsedMs });
        if (next.action === "resolve") {
          stop();
          resolve(next.value);
        } else if (next.action === "reject") {
          stop();
          reject(new Error(next.message));
        } else report(next.phase, elapsedMs);
      } catch (e) {
        console.warn("[budgetAgentClient poll]", e?.message || e);
      }
    }, POLL_INTERVAL_MS);
  });
}

export async function callBudgetAgent({
  messages,
  context = null,
  signal,
  onProgress,
} = {}) {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error("You need to sign in to use the budget agent.");

  const turnId = newTurnId();

  try {
    await fetch(AGENT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        agentId: AGENT_ID,
        turn_id: turnId,
        messages,
        ...(context ? { context } : {}),
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error(
      "Could not reach the budget agent — check your connection. Your data is unchanged.",
    );
  }

  return pollTurn(turnId, signal, onProgress);
}
