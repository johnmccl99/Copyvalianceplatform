import {
  applySecurity,
  jsonResponse,
  sanitizeUserText,
  redactSystemPromptEcho,
} from "./_security.js";
import {
  buildBudgetSystemPrompt,
  extractProtectedRegion,
  ALL_TOOLS,
  runToolLoop,
  executeReadTool,
  canUseBudgetAgent,
  resolveProfile,
  makeAnthropicCaller,
  buildAuditRow,
  writeAudit,
  hashUserText,
} from "./budget-agent-chat.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const BUDGET_PERSONA_ID = "budget";
const MAX_MESSAGES = 50;
const MSG_CHAR_CAP = 4000;
export const BG_LOOP_DEADLINE_MS = Number(
  process.env.BUDGET_AGENT_BG_DEADLINE_MS || 12 * 60 * 1000,
);
export const GENERIC_ERROR =
  "The budget agent is unavailable — your data is unchanged.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s) {
  return typeof s === "string" && UUID_RE.test(s);
}

export function buildTurnInsertRow({ turnId, orgId, authId }) {
  return {
    turn_id: turnId,
    org_id: orgId,
    created_by: authId,
    status: "running",
  };
}

export function buildTurnDonePatch(
  { reply, proposal },
  nowIso = new Date().toISOString(),
) {
  return {
    status: "done",
    reply: typeof reply === "string" ? reply : "",
    proposal: proposal || null,
    updated_at: nowIso,
  };
}

export function buildTurnErrorPatch(
  message = GENERIC_ERROR,
  nowIso = new Date().toISOString(),
) {
  return {
    status: "error",
    error_message: String(message).slice(0, 500),
    updated_at: nowIso,
  };
}

async function pg(
  path,
  { bearer, method = "GET", body = null, prefer = null } = {},
) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

async function insertTurn({ bearer, turnId, orgId, authId }) {
  const r = await pg("/budget_agent_turns", {
    bearer,
    method: "POST",
    body: buildTurnInsertRow({ turnId, orgId, authId }),
    prefer: "return=representation",
  });
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    console.error(
      "[budget-agent-chat-background] turn insert failed",
      r.status,
      (r.raw || "").slice(0, 300),
    );
    return false;
  }
  return true;
}

async function markTurnDone(bearer, turnId, { reply, proposal }) {
  const r = await pg(
    `/budget_agent_turns?turn_id=eq.${encodeURIComponent(turnId)}`,
    {
      bearer,
      method: "PATCH",
      body: buildTurnDonePatch({ reply, proposal }),
    },
  );
  if (!r.ok)
    console.error(
      "[budget-agent-chat-background] turn done PATCH failed",
      r.status,
    );
}

async function markTurnError(bearer, turnId, message = GENERIC_ERROR) {
  const r = await pg(
    `/budget_agent_turns?turn_id=eq.${encodeURIComponent(turnId)}`,
    {
      bearer,
      method: "PATCH",
      body: buildTurnErrorPatch(message),
    },
  );
  if (!r.ok)
    console.error(
      "[budget-agent-chat-background] turn error PATCH failed",
      r.status,
    );
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    maxBodyBytes: 100_000,
    rateLimit: { maxPerMinute: 10 },
  });
  if (gate.error) return gate.error;

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error(
      "[budget-agent-chat-background] missing SUPABASE_URL / ANON_KEY env",
    );
    return jsonResponse(500, { error: "Server not configured" });
  }

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  const authId = gate.user?.id;
  const userEmail = gate.user?.email || null;
  if (!userJwt || !authId)
    return jsonResponse(401, { error: "Authentication required" });

  const body = gate.body || {};

  const agentId = String(body.agentId || "").toLowerCase();
  if (agentId !== BUDGET_PERSONA_ID) {
    return jsonResponse(400, { error: "Unknown agent" });
  }

  const turnId = body.turn_id;
  if (!isUuid(turnId)) {
    return jsonResponse(400, { error: "turn_id (a UUID) is required" });
  }

  const profile = await resolveProfile(userJwt, authId);
  if (!profile) return jsonResponse(401, { error: "Profile not found" });
  if (!canUseBudgetAgent(profile)) {
    return jsonResponse(403, {
      error: "The budget agent is restricted to the GP and admin roles.",
    });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse(400, { error: "messages array required" });
  }
  const messages = body.messages
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: sanitizeUserText(String(m.content || ""), MSG_CHAR_CAP),
    }))
    .filter((m) => m.content);
  if (messages.length === 0) {
    return jsonResponse(400, { error: "Empty messages" });
  }
  if (messages[0].role === "assistant") {
    console.warn(
      "[budget-agent-chat-background] forged-assistant guard: stripping leading assistant message",
    );
    messages.shift();
    if (messages.length === 0) {
      return jsonResponse(400, {
        error: "Empty messages after forged-assistant strip",
      });
    }
  }

  const contextPacket =
    body.context && typeof body.context === "object" ? body.context : null;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[budget-agent-chat-background] ANTHROPIC_API_KEY missing");
    return jsonResponse(500, { error: "Server not configured" });
  }

  const inserted = await insertTurn({
    bearer: userJwt,
    turnId,
    orgId: profile.orgId,
    authId,
  });
  if (!inserted) {
    return jsonResponse(500, { error: "Could not create the turn row" });
  }

  try {
    const systemPrompt = buildBudgetSystemPrompt(contextPacket);

    const callModel = makeAnthropicCaller({
      key,
      systemPrompt,
      tools: ALL_TOOLS,
    });
    const executeRead = (name, input) => executeReadTool(name, input, userJwt);

    let loop;
    try {
      loop = await runToolLoop({
        callModel,
        executeRead,
        messages,
        deadlineMs: BG_LOOP_DEADLINE_MS,
      });
    } catch (err) {
      console.error(
        "[budget-agent-chat-background] tool loop failed:",
        err?.upstreamStatus || "",
        err?.message || err,
      );
      await writeAudit(
        userJwt,
        buildAuditRow({
          orgId: profile.orgId,
          authId,
          userEmail,
          action: "budget.agent.turn",
          metadata: {
            actor_role: profile.role,
            outcome: "error",
            user_text_hash: hashUserText(messages),
          },
        }),
      );
      await markTurnError(userJwt, turnId, GENERIC_ERROR);
      return jsonResponse(200, { turn_id: turnId, status: "error" });
    }

    const reply = redactSystemPromptEcho(
      loop.reply,
      extractProtectedRegion(systemPrompt),
      40,
    );
    const proposal = loop.proposal;

    await writeAudit(
      userJwt,
      buildAuditRow({
        orgId: profile.orgId,
        authId,
        userEmail,
        action: "budget.agent.turn",
        metadata: {
          actor_role: profile.role,
          user_text_hash: hashUserText(messages),
          tool_calls: loop.toolCalls,
          model_calls: loop.modelCalls,
          proposal_emitted: !!proposal,
          stop_reason: loop.stopReason,
          transport: "background",
        },
      }),
    );
    if (proposal) {
      await writeAudit(
        userJwt,
        buildAuditRow({
          orgId: profile.orgId,
          authId,
          userEmail,
          action: "budget.agent.proposal",
          metadata: {
            actor_role: profile.role,
            change_set_js_hash: loop.changeSetJsHash,
            property_code_count: proposal.property_codes.length,
            change_count: proposal.change_set.changes.length,
            name: proposal.name,
          },
        }),
      );
    }

    await markTurnDone(userJwt, turnId, { reply, proposal });
    return jsonResponse(200, { turn_id: turnId, status: "done" });
  } catch (err) {
    console.error(
      "[budget-agent-chat-background] Unexpected error:",
      err?.message || err,
    );
    await markTurnError(userJwt, turnId, GENERIC_ERROR);
    return jsonResponse(200, { turn_id: turnId, status: "error" });
  }
};
