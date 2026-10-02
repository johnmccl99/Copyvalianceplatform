import { createClient } from "@supabase/supabase-js";
import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.URL ||
  "https://credashboardproperty.netlify.app";
const SET_PASSWORD_URL = `${APP_BASE_URL.replace(/\/$/, "")}/auth/set-password`;

const ALLOWED_ROLES = ["gp", "admin"];

const adminClient =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

async function pg(
  path,
  { bearer, method = "GET", body = null, prefer = null } = {},
) {
  const key = bearer === SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY : ANON_KEY;
  const headers = {
    apikey: key,
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

async function resolveCaller(userJwt, callerAuthId) {
  const r = await pg(
    `/user_profiles?auth_id=eq.${encodeURIComponent(callerAuthId)}&select=id,org_id,is_admin&limit=1`,
    { bearer: userJwt },
  );
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    return { ok: false, code: 401, error: "Caller profile not found" };
  }
  return { ok: true, profile: r.body[0] };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 10 },
  });
  if (gate.error) return gate.error;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !adminClient) {
    console.error("[admin-invite-user] missing env vars");
    return jsonResponse(500, { error: "Server not configured" });
  }

  const body = gate.body || {};
  const rawEmail =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName =
    typeof body.display_name === "string"
      ? body.display_name.trim().slice(0, 200)
      : "";
  const role =
    typeof body.role === "string" ? body.role.trim().toLowerCase() : "";

  if (
    !rawEmail ||
    rawEmail.length > 254 ||
    !rawEmail.includes("@") ||
    !rawEmail.includes(".")
  ) {
    return jsonResponse(400, { error: "Valid email required" });
  }
  if (!displayName) {
    return jsonResponse(400, { error: "display_name required" });
  }
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return jsonResponse(400, { error: "Valid role required" });
  }

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  const callerAuthId = gate.user?.id;
  if (!callerAuthId || !userJwt) {
    return jsonResponse(401, { error: "Authentication required" });
  }

  const callerRes = await resolveCaller(userJwt, callerAuthId);
  if (!callerRes.ok) {
    return jsonResponse(callerRes.code || 401, { error: callerRes.error });
  }
  const callerOrgId = callerRes.profile.org_id;
  if (!callerRes.profile.is_admin) {
    console.warn("[admin-invite-user] non-admin attempt by", callerAuthId);
    return jsonResponse(403, { error: "Admin role required" });
  }
  if (!callerOrgId) {
    return jsonResponse(403, { error: "Caller has no org assignment" });
  }

  const existing = await pg(
    `/user_profiles?email=eq.${encodeURIComponent(rawEmail)}&select=id,auth_id,org_id&limit=1`,
    { bearer: SERVICE_ROLE_KEY },
  );
  if (!existing.ok) {
    console.error(
      "[admin-invite-user] existing lookup failed:",
      existing.status,
    );
    return jsonResponse(500, { error: "Lookup failed" });
  }
  const existingRow =
    Array.isArray(existing.body) && existing.body.length
      ? existing.body[0]
      : null;

  if (existingRow) {
    if (existingRow.auth_id) {
      return jsonResponse(409, { error: "User already has an account" });
    }
    if (existingRow.org_id && existingRow.org_id !== callerOrgId) {
      return jsonResponse(409, {
        error: "Email is already invited to a different organization",
      });
    }
  }

  let profileRow = null;
  let didInsert = false;

  if (existingRow) {
    const updated = await pg(
      `/user_profiles?id=eq.${encodeURIComponent(existingRow.id)}`,
      {
        bearer: SERVICE_ROLE_KEY,
        method: "PATCH",
        prefer: "return=representation",
        body: { display_name: displayName, role, org_id: callerOrgId },
      },
    );
    if (!updated.ok) {
      console.error(
        "[admin-invite-user] profile update failed:",
        updated.status,
        updated.raw,
      );
      return jsonResponse(500, { error: "Profile update failed" });
    }
    profileRow = Array.isArray(updated.body) ? updated.body[0] : updated.body;
  } else {
    const inserted = await pg(`/user_profiles`, {
      bearer: SERVICE_ROLE_KEY,
      method: "POST",
      prefer: "return=representation",
      body: {
        email: rawEmail,
        display_name: displayName,
        role,
        is_admin: false,
        org_id: callerOrgId,
      },
    });
    if (!inserted.ok) {
      console.error(
        "[admin-invite-user] profile insert failed:",
        inserted.status,
        inserted.raw,
      );
      return jsonResponse(500, { error: "Profile insert failed" });
    }
    profileRow = Array.isArray(inserted.body)
      ? inserted.body[0]
      : inserted.body;
    didInsert = true;
  }

  let inviteErr = null;
  try {
    const { error } = await adminClient.auth.admin.inviteUserByEmail(rawEmail, {
      data: { org_id: callerOrgId, role, display_name: displayName },
      redirectTo: SET_PASSWORD_URL,
    });
    inviteErr = error;
  } catch (e) {
    inviteErr = e;
  }

  if (inviteErr) {
    if (didInsert && profileRow?.id) {
      const undo = await pg(
        `/user_profiles?id=eq.${encodeURIComponent(profileRow.id)}`,
        { bearer: SERVICE_ROLE_KEY, method: "DELETE" },
      );
      if (!undo.ok) {
        console.error(
          "[admin-invite-user] rollback delete failed:",
          undo.status,
        );
      }
    }
    const msg = (inviteErr.message || "").toString();
    console.error("[admin-invite-user] inviteUserByEmail failed:", msg);
    const safe = /already.*registered|exists/i.test(msg)
      ? "User already has an account"
      : "Invite email could not be sent";
    return jsonResponse(502, { error: safe });
  }

  let actionLink = null;
  try {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: rawEmail,
        options: { redirectTo: SET_PASSWORD_URL },
      });
    if (linkErr) {
      console.warn(
        "[admin-invite-user] generateLink fallback failed:",
        linkErr.message,
      );
    } else {
      actionLink = linkData?.properties?.action_link || null;
    }
  } catch (e) {
    console.warn("[admin-invite-user] generateLink threw:", e?.message || e);
  }

  try {
    const audit = await pg("/audit_log", {
      bearer: userJwt,
      method: "POST",
      prefer: "return=minimal",
      body: {
        org_id: callerOrgId,
        user_id: callerAuthId,
        user_email: gate.user?.email || null,
        action: "user.invited",
        resource_type: "user_profiles",
        resource_id: profileRow?.id || null,
        outcome: "success",
        metadata: { invited_email: rawEmail, role, reinvite: !didInsert },
      },
    });
    if (!audit.ok) {
      console.error(
        "[admin-invite-user] audit_log insert failed",
        audit.status,
      );
    }
  } catch (e) {
    console.error(
      "[admin-invite-user] audit_log insert threw",
      e?.message || e,
    );
  }

  return jsonResponse(200, {
    data: profileRow,
    error: null,
    actionLink,
  });
};
