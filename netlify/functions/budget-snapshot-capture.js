import { applySecurity, jsonResponse } from "./_security.js";

const getSupabaseUrl = () =>
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const getAnonKey = () =>
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const getServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const WRITE_ROLES = new Set(["admin", "gp"]);

async function pg(
  path,
  { bearer, method = "GET", body = null, prefer = null } = {},
) {
  const headers = {
    apikey: getAnonKey(),
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${getSupabaseUrl()}/rest/v1${path}`, {
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

export function canWriteBudget(profile) {
  if (!profile) return false;
  if (profile.isAdmin || profile.is_admin) return true;
  const role = (profile.role || "").toLowerCase();
  return WRITE_ROLES.has(role);
}

async function resolveCallerProfile(userJwt, authId) {
  const r = await pg(
    `/user_profiles?auth_id=eq.${encodeURIComponent(authId)}&select=id,org_id,role,email,is_admin&limit=1`,
    { bearer: userJwt },
  );
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    return { error: `Failed to load caller profile [${r.status}]` };
  }
  const p = r.body[0];
  return {
    authId,
    orgId: p.org_id,
    role: p.role,
    email: p.email,
    isAdmin: !!p.is_admin,
  };
}

async function writeAudit({
  userJwt,
  orgId,
  authId,
  userEmail,
  role,
  outcome,
  propertyCode,
  metadata,
}) {
  try {
    const r = await pg("/audit_log", {
      bearer: userJwt,
      method: "POST",
      prefer: "return=minimal",
      body: {
        org_id: orgId,
        user_id: authId,
        user_email: userEmail || null,
        action: "budget.snapshot.capture",
        resource_type: "budget_snapshots",
        resource_id: propertyCode,
        outcome,
        metadata: { actor_role: role || null, ...(metadata || {}) },
      },
    });
    if (!r.ok) {
      console.error(
        "[budget-snapshot-capture] audit_log insert failed",
        r.status,
        (r.raw || "").slice(0, 200),
      );
    }
  } catch (e) {
    console.error(
      "[budget-snapshot-capture] audit_log insert threw",
      e?.message || e,
    );
  }
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 10 },
    maxBodyBytes: 50_000,
  });
  if (gate.error) return gate.error;
  const { user, body } = gate;

  const propertyCode =
    body && typeof body.property_code === "string"
      ? body.property_code.trim()
      : "";
  const label = body && typeof body.label === "string" ? body.label.trim() : "";
  const makeCurrent = !(body && body.make_current === false);

  if (!propertyCode)
    return jsonResponse(400, { error: "property_code is required" });
  if (!label)
    return jsonResponse(400, {
      error: "label is required (a human name for the sealed snapshot)",
    });

  const userJwt = (
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ""
  ).replace(/^Bearer\s+/i, "");
  const profile = await resolveCallerProfile(userJwt, user.id);
  if (profile.error) return jsonResponse(403, { error: profile.error });
  if (!canWriteBudget(profile)) {
    return jsonResponse(403, {
      error:
        "Insufficient role for budget snapshot capture (need admin, am, or gp).",
    });
  }

  const serviceKey = getServiceRoleKey();
  if (!serviceKey) {
    console.error(
      "[budget-snapshot-capture] SUPABASE_SERVICE_ROLE_KEY not configured",
    );
    return jsonResponse(500, { error: "Snapshot capture is not configured." });
  }

  const rpc = await pg("/rpc/capture_budget_snapshot", {
    bearer: serviceKey,
    method: "POST",
    body: {
      p_org: profile.orgId,
      p_property_code: propertyCode,
      p_label: label,
      p_sealed_by: profile.authId,
      p_make_current: makeCurrent,
    },
  });

  if (!rpc.ok) {
    const msg =
      (rpc.body && (rpc.body.message || rpc.body.error)) ||
      rpc.raw ||
      `Snapshot capture failed [${rpc.status}]`;
    const noData = /nothing to seal/i.test(String(msg));
    await writeAudit({
      userJwt,
      orgId: profile.orgId,
      authId: profile.authId,
      userEmail: profile.email,
      role: profile.role,
      outcome: "error",
      propertyCode,
      metadata: { status: rpc.status, message: String(msg).slice(0, 300) },
    });
    return jsonResponse(noData ? 422 : 502, {
      error: String(msg).slice(0, 300),
    });
  }

  const snap = Array.isArray(rpc.body) ? rpc.body[0] : rpc.body;

  await writeAudit({
    userJwt,
    orgId: profile.orgId,
    authId: profile.authId,
    userEmail: profile.email,
    role: profile.role,
    outcome: "success",
    propertyCode,
    metadata: {
      snapshot_id: snap?.id,
      line_count: snap?.line_count,
      made_current: makeCurrent,
    },
  });

  return jsonResponse(200, {
    snapshot_id: snap?.id,
    property_code: propertyCode,
    label,
    line_count: snap?.line_count,
    content_signature: snap?.content_signature,
    month_end_min: snap?.month_end_min,
    month_end_max: snap?.month_end_max,
    made_current: makeCurrent,
  });
};
