import { applySecurity, jsonResponse } from "./_security.js";
import { validateChangeSet } from "./_assumption-eligibility.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const PROPAGATE_ROLES = new Set(["admin", "gp", "gp_admin"]);

const MAX_PROPERTY_CODES = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s) {
  return typeof s === "string" && UUID_RE.test(s);
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

async function resolveProfile(userJwt, authId) {
  const r = await pg(
    `/user_profiles?auth_id=eq.${encodeURIComponent(authId)}&select=org_id,is_admin,role&limit=1`,
    { bearer: userJwt },
  );
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) return null;
  const p = r.body[0];
  return {
    orgId: p.org_id,
    role: String(p.role || "").toLowerCase(),
    isAdmin: p.is_admin === true || p.is_admin === "t" || p.is_admin === 1,
  };
}

export function canPropagate(profile) {
  return !!profile && (profile.isAdmin || PROPAGATE_ROLES.has(profile.role));
}

export function canonicalizeChangeSet(changeSet) {
  const changes = [...(changeSet?.changes || [])];
  const key = (c) => [
    c?.target || "",
    c?.category || "",
    c?.match?.account_number || "",
    c?.match?.assumption_key || "",
    c?.match?.line_description || "",
    c?.field || "",
    JSON.stringify(c?.new_value === undefined ? null : c.new_value),
  ];
  changes.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });
  const out = { changes };
  if (changeSet?.name != null) out.name = changeSet.name;
  return out;
}

export function validateRequest(body) {
  const mode = body?.mode;
  if (mode !== "dry-run" && mode !== "apply" && mode !== "undo") {
    return { ok: false, error: "mode must be 'dry-run', 'apply', or 'undo'" };
  }
  if (body.job_id != null && !isUuid(body.job_id)) {
    return { ok: false, error: "job_id must be a UUID" };
  }
  if (mode === "dry-run") {
    const v = validateChangeSet(body.change_set);
    if (!v.ok)
      return { ok: false, error: `change_set invalid: ${v.errors.join("; ")}` };
    const codes = body.property_codes;
    if (!Array.isArray(codes) || codes.length === 0) {
      return {
        ok: false,
        error: "property_codes (a non-empty array) is required",
      };
    }
    if (codes.length > MAX_PROPERTY_CODES) {
      return {
        ok: false,
        error: `Too many property codes (max ${MAX_PROPERTY_CODES})`,
      };
    }
    if (codes.some((c) => typeof c !== "string" || !c.trim())) {
      return { ok: false, error: "property_codes must be non-empty strings" };
    }
    return { ok: true };
  }
  if (mode === "apply") {
    if (!isUuid(body.approval_token)) {
      return {
        ok: false,
        error: "approval_token (a UUID from the dry-run) is required",
      };
    }
    const v = validateChangeSet(body.change_set);
    if (!v.ok)
      return { ok: false, error: `change_set invalid: ${v.errors.join("; ")}` };
    return { ok: true };
  }
  if (!isUuid(body.apply_id)) {
    return {
      ok: false,
      error: "apply_id (a UUID from the apply history) is required",
    };
  }
  return { ok: true };
}

async function insertJob({ bearer, jobId, orgId, authId, mode, requestBody }) {
  const row = {
    org_id: orgId,
    triggered_by: authId,
    mode,
    status: "running",
    request_body: requestBody,
  };
  if (jobId) row.id = jobId;
  const r = await pg("/assumption_propagation_jobs", {
    bearer,
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    console.error(
      "[budget-assumption-propagate] job insert failed",
      r.status,
      r.raw?.slice(0, 300),
    );
    return null;
  }
  return r.body[0].id;
}

async function markJobComplete(bearer, jobId, resultSummary) {
  const r = await pg(`/assumption_propagation_jobs?id=eq.${jobId}`, {
    bearer,
    method: "PATCH",
    body: {
      status: "complete",
      result_summary: resultSummary,
      completed_at: new Date().toISOString(),
    },
  });
  if (!r.ok)
    console.error(
      "[budget-assumption-propagate] job complete PATCH failed",
      r.status,
    );
}

async function markJobError(bearer, jobId, message) {
  const r = await pg(`/assumption_propagation_jobs?id=eq.${jobId}`, {
    bearer,
    method: "PATCH",
    body: {
      status: "error",
      error_message: String(message).slice(0, 2000),
      completed_at: new Date().toISOString(),
    },
  });
  if (!r.ok)
    console.error(
      "[budget-assumption-propagate] job error PATCH failed",
      r.status,
    );
}

async function firePortfolioCacheRefresh(userJwt) {
  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "";
  if (!base) return;
  try {
    await fetch(
      `${base}/.netlify/functions/portfolio-budget-cache-refresh-background`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userJwt}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
  } catch (e) {
    console.error(
      "[budget-assumption-propagate] portfolio cache refresh fire failed",
      e?.message || e,
    );
  }
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
      "[budget-assumption-propagate] missing SUPABASE_URL / ANON_KEY env",
    );
    return jsonResponse(500, { error: "Server not configured" });
  }

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  const authId = gate.user?.id;
  if (!userJwt || !authId)
    return jsonResponse(401, { error: "Authentication required" });

  const body = gate.body || {};
  const check = validateRequest(body);
  if (!check.ok) return jsonResponse(400, { error: check.error });
  const mode = body.mode;

  const profile = await resolveProfile(userJwt, authId);
  if (!profile) return jsonResponse(401, { error: "Profile not found" });
  if (!canPropagate(profile)) {
    return jsonResponse(403, {
      error: "Assumption propagation is restricted to the GP and admin roles",
    });
  }

  const jobId = await insertJob({
    bearer: userJwt,
    jobId: body.job_id || null,
    orgId: profile.orgId,
    authId,
    mode,
    requestBody: {
      mode,
      change_set: body.change_set ?? null,
      property_codes: body.property_codes ?? null,
      approval_token: body.approval_token ?? null,
      apply_id: body.apply_id ?? null,
    },
  });
  if (!jobId) return jsonResponse(500, { error: "Could not create job row" });

  try {
    let rpc;
    if (mode === "dry-run") {
      rpc = await pg("/rpc/assumption_propagation_dry_run", {
        bearer: userJwt,
        method: "POST",
        body: {
          p_change_set: canonicalizeChangeSet(body.change_set),
          p_property_codes: body.property_codes,
        },
      });
    } else if (mode === "apply") {
      rpc = await pg("/rpc/assumption_propagation_apply", {
        bearer: userJwt,
        method: "POST",
        body: {
          p_approval_token: body.approval_token,
          p_change_set: canonicalizeChangeSet(body.change_set),
        },
      });
    } else {
      rpc = await pg("/rpc/assumption_propagation_undo", {
        bearer: userJwt,
        method: "POST",
        body: { p_apply_id: body.apply_id },
      });
    }

    if (!rpc.ok) {
      const msg =
        rpc.body?.message ||
        rpc.body?.error ||
        `RPC failed (HTTP ${rpc.status})`;
      console.error(
        `[budget-assumption-propagate] ${mode} RPC failed`,
        rpc.status,
        String(rpc.raw || "").slice(0, 500),
      );
      await markJobError(userJwt, jobId, msg);
      return jsonResponse(200, {
        ok: false,
        job_id: jobId,
        status: "error",
        error: msg,
      });
    }

    await markJobComplete(userJwt, jobId, rpc.body);

    const movedRows =
      (mode === "apply" && Number(rpc.body?.rows_updated_total || 0) > 0) ||
      (mode === "undo" && Number(rpc.body?.restored || 0) > 0);
    if (movedRows) {
      await firePortfolioCacheRefresh(userJwt);
    }

    return jsonResponse(200, { ok: true, job_id: jobId, status: "complete" });
  } catch (e) {
    console.error(
      `[budget-assumption-propagate] ${mode} crashed`,
      e?.message || e,
    );
    await markJobError(userJwt, jobId, e?.message || "unexpected error");
    return jsonResponse(200, {
      ok: false,
      job_id: jobId,
      status: "error",
      error: "Propagation failed unexpectedly",
    });
  }
};
