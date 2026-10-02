import { applySecurity, jsonResponse } from "./_security.js";
import { freezeEffectiveRoll } from "../../src/lib/rentRollVersions.js";
import {
  materializeEffectiveRoll,
  startOfDayInstant,
} from "./_rent-roll-materialize.js";
import {
  PORTFOLIO_TIME_ZONE,
  todayIso,
} from "../../src/lib/entrataLeaseStatus.js";

const getSupabaseUrl = () =>
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const getAnonKey = () =>
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const getServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const WRITE_ROLES = new Set(["admin", "gp", "gp_admin"]);
const STATUSES = new Set(["draft", "signed", "locked"]);

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

export function canWriteRentRoll(profile) {
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
  propertyId,
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
        action: "rent_roll.version.capture",
        resource_type: "rent_roll_versions",
        resource_id: String(propertyId),
        outcome,
        metadata: { actor_role: role || null, ...(metadata || {}) },
      },
    });
    if (!r.ok) {
      console.error(
        "[rent-roll-version-capture] audit_log insert failed",
        r.status,
        (r.raw || "").slice(0, 200),
      );
    }
  } catch (e) {
    console.error(
      "[rent-roll-version-capture] audit_log insert threw",
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

  const propertyId = body && (body.property_id ?? body.propertyId);
  const label = body && typeof body.label === "string" ? body.label.trim() : "";
  const status =
    body && typeof body.status === "string" ? body.status.trim() : "draft";
  const signedOffBy =
    body && typeof body.signed_off_by === "string"
      ? body.signed_off_by.trim()
      : "";
  const makeCurrent = !!(body && body.make_current === true);

  if (!propertyId)
    return jsonResponse(400, { error: "property_id is required" });
  if (!label)
    return jsonResponse(400, {
      error: "label is required (a human name for the version)",
    });
  if (!STATUSES.has(status))
    return jsonResponse(400, {
      error: "status must be draft, signed, or locked",
    });

  const userJwt = (
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ""
  ).replace(/^Bearer\s+/i, "");
  const profile = await resolveCallerProfile(userJwt, user.id);
  if (profile.error) return jsonResponse(403, { error: profile.error });
  if (!canWriteRentRoll(profile)) {
    return jsonResponse(403, {
      error:
        "Insufficient role to capture a rent-roll version (need admin, gp, gp_admin, or am).",
    });
  }

  const propRes = await pg(
    `/properties?id=eq.${encodeURIComponent(propertyId)}&select=id,org_id,entrata_property_id&limit=1`,
    { bearer: userJwt },
  );
  if (
    !propRes.ok ||
    !Array.isArray(propRes.body) ||
    propRes.body.length === 0
  ) {
    return jsonResponse(404, {
      error: "Property not found or not accessible.",
    });
  }
  const prop = propRes.body[0];
  if (prop.org_id !== profile.orgId) {
    return jsonResponse(403, {
      error: "Property does not belong to your organization.",
    });
  }
  if (!prop.entrata_property_id) {
    return jsonResponse(422, {
      error:
        "Property is not mapped to Entrata; there is no rent roll to freeze.",
    });
  }
  const entrataPropertyId = prop.entrata_property_id;

  const serviceKey = getServiceRoleKey();
  if (!serviceKey) {
    console.error(
      "[rent-roll-version-capture] SUPABASE_SERVICE_ROLE_KEY not configured",
    );
    return jsonResponse(500, {
      error: "Rent-roll version capture is not configured.",
    });
  }

  const captureAsOf = todayIso(PORTFOLIO_TIME_ZONE);
  const { effectiveRows, error: materializeErr } =
    await materializeEffectiveRoll({
      pg,
      bearer: userJwt,
      entrataPropertyId,
      asOf: captureAsOf,
    });
  if (materializeErr) {
    const what =
      materializeErr.stage === "base"
        ? "the Entrata rent roll"
        : "the adjustment overlay";
    return jsonResponse(502, {
      error: `Failed to load ${what} [${materializeErr.status}].`,
    });
  }
  if (!effectiveRows.length) {
    return jsonResponse(422, {
      error: "The effective rent roll is empty; there is nothing to freeze.",
    });
  }

  const frozen = freezeEffectiveRoll(
    { rows: effectiveRows },
    {
      property_id: entrataPropertyId,
      label,
      status,
      signed_off_by:
        signedOffBy || (status !== "draft" ? profile.email || null : null),
      created_by: profile.authId,
    },
  );

  const rpc = await pg("/rpc/capture_rent_roll_version", {
    bearer: serviceKey,
    method: "POST",
    body: {
      p_org: profile.orgId,
      p_property_id: entrataPropertyId,
      p_label: label,
      p_lines: frozen.lines,
      p_as_of: startOfDayInstant(captureAsOf, PORTFOLIO_TIME_ZONE),
      p_status: status,
      p_signed_off_by: frozen.header.signed_off_by,
      p_content_signature: frozen.content_signature,
      p_summary: frozen.header.summary,
      p_created_by: profile.authId,
      p_make_current: makeCurrent,
    },
  });

  if (!rpc.ok) {
    const msg =
      (rpc.body && (rpc.body.message || rpc.body.error)) ||
      rpc.raw ||
      `Version capture failed [${rpc.status}]`;
    const noData = /nothing to (freeze|seal)|empty/i.test(String(msg));
    await writeAudit({
      userJwt,
      orgId: profile.orgId,
      authId: profile.authId,
      userEmail: profile.email,
      role: profile.role,
      outcome: "error",
      propertyId: entrataPropertyId,
      metadata: { status: rpc.status, message: String(msg).slice(0, 300) },
    });
    return jsonResponse(noData ? 422 : 502, {
      error: String(msg).slice(0, 300),
    });
  }

  const version = Array.isArray(rpc.body) ? rpc.body[0] : rpc.body;

  await writeAudit({
    userJwt,
    orgId: profile.orgId,
    authId: profile.authId,
    userEmail: profile.email,
    role: profile.role,
    outcome: "success",
    propertyId: entrataPropertyId,
    metadata: {
      version_id: version?.id,
      line_count: version?.line_count,
      status,
      made_current: makeCurrent,
    },
  });

  return jsonResponse(200, {
    version_id: version?.id,
    property_id: entrataPropertyId,
    label,
    status: version?.status,
    line_count: version?.line_count,
    content_signature: version?.content_signature,
    as_of: version?.as_of,
    made_current: makeCurrent,
  });
};
