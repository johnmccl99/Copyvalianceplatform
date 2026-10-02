import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

export const PASSWORD_LENGTH = 20;
export const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateTempPassword() {
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) {
    out += PASSWORD_ALPHABET[crypto.randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return out;
}

export function classifyConfirmation(result) {
  const user = result?.data?.user;
  if (result?.error || !user) {
    return { disposition: "unknown", confirmedAtBefore: null };
  }
  const confirmedAtBefore = user.email_confirmed_at || null;
  return {
    disposition: confirmedAtBefore ? "already_confirmed" : "newly_confirmed",
    confirmedAtBefore,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    `/user_profiles?auth_id=eq.${encodeURIComponent(callerAuthId)}` +
      `&select=id,org_id,is_admin,role,email,is_active,must_change_password&limit=1`,
    { bearer: userJwt },
  );
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
    return { ok: false, code: 401, error: "Caller profile not found" };
  }
  return { ok: true, profile: r.body[0] };
}

async function isPlatformSuperAdmin(profileId) {
  const r = await pg(
    `/platform_super_admins?user_id=eq.${encodeURIComponent(profileId)}&select=user_id&limit=1`,
    { bearer: SERVICE_ROLE_KEY },
  );
  if (!r.ok || !Array.isArray(r.body)) return null;
  return r.body.length > 0;
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !adminClient) {
    console.error("[admin-issue-temp-password] missing env vars");
    return jsonResponse(500, { error: "Server not configured" });
  }

  const body = gate.body || {};
  const targetProfileId =
    typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!UUID_RE.test(targetProfileId)) {
    return jsonResponse(400, { error: "user_id (uuid) required" });
  }

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  const callerAuthId = gate.user?.id;
  if (!callerAuthId || !userJwt)
    return jsonResponse(401, { error: "Authentication required" });

  const callerRes = await resolveCaller(userJwt, callerAuthId);
  if (!callerRes.ok)
    return jsonResponse(callerRes.code || 401, { error: callerRes.error });
  const caller = callerRes.profile;

  const callerIsAdmin =
    caller.is_admin === true ||
    caller.is_admin === "t" ||
    String(caller.role || "").toLowerCase() === "admin";
  if (!callerIsAdmin) {
    console.warn(
      "[admin-issue-temp-password] non-admin attempt by",
      callerAuthId,
    );
    return jsonResponse(403, { error: "Admin role required" });
  }
  if (!caller.org_id)
    return jsonResponse(403, { error: "Caller has no org assignment" });

  if (!caller.is_active) {
    console.warn(
      "[admin-issue-temp-password] deactivated caller",
      callerAuthId,
    );
    return jsonResponse(403, { error: "Admin role required" });
  }

  if (
    caller.must_change_password === true ||
    caller.must_change_password === "t"
  ) {
    console.warn(
      "[admin-issue-temp-password] caller has an outstanding temporary password",
      callerAuthId,
    );
    return jsonResponse(403, {
      error: "Set your own password before issuing one for someone else.",
    });
  }

  const targetRes = await pg(
    `/user_profiles?id=eq.${encodeURIComponent(targetProfileId)}&select=id,org_id,auth_id,email,display_name,is_admin,role,is_active&limit=1`,
    { bearer: SERVICE_ROLE_KEY },
  );
  if (
    !targetRes.ok ||
    !Array.isArray(targetRes.body) ||
    targetRes.body.length === 0
  ) {
    return jsonResponse(404, { error: "User not found" });
  }
  const target = targetRes.body[0];

  if (target.org_id !== caller.org_id) {
    console.warn(
      "[admin-issue-temp-password] cross-org attempt by",
      callerAuthId,
    );
    return jsonResponse(404, { error: "User not found" });
  }

  if (target.id === caller.id) {
    return jsonResponse(400, {
      error:
        "You cannot issue a temporary password to yourself. Use Change password instead.",
    });
  }

  if (!target.auth_id) {
    return jsonResponse(409, {
      error:
        "This person has not created an account yet, so there is no password to set. " +
        "Invite them first, then issue a temporary password once the account exists.",
    });
  }

  const targetIsSuper = await isPlatformSuperAdmin(target.id);
  if (targetIsSuper === null) {
    console.error(
      "[admin-issue-temp-password] super-admin lookup failed; refusing",
    );
    return jsonResponse(503, {
      error: "Could not verify the target account. Try again.",
    });
  }
  if (targetIsSuper) {
    const callerIsSuper = await isPlatformSuperAdmin(caller.id);
    if (callerIsSuper !== true) {
      console.warn(
        "[admin-issue-temp-password] super-admin target refused for",
        callerAuthId,
      );
      return jsonResponse(403, {
        error:
          "This account is a platform administrator. Only another platform administrator can issue it a temporary password.",
      });
    }
  }

  if (!target.is_active) {
    return jsonResponse(409, {
      error:
        "This account is deactivated. Reactivate it before issuing a temporary password.",
    });
  }

  const tempPassword = generateTempPassword();

  let confirmation = { disposition: "unknown", confirmedAtBefore: null };
  try {
    const beforeRes = await adminClient.auth.admin.getUserById(target.auth_id);
    confirmation = classifyConfirmation(beforeRes);
    if (confirmation.disposition === "unknown") {
      console.error(
        "[admin-issue-temp-password] confirmation pre-read failed",
        beforeRes?.error?.status || "",
        beforeRes?.error?.message || "",
      );
    }
  } catch (e) {
    console.error(
      "[admin-issue-temp-password] confirmation pre-read threw",
      e?.message || e,
    );
  }

  const { error: setErr } = await adminClient.auth.admin.updateUserById(
    target.auth_id,
    {
      password: tempPassword,
      email_confirm: true,
    },
  );
  if (setErr) {
    console.error(
      "[admin-issue-temp-password] updateUserById failed",
      setErr.status || "",
      setErr.message || "",
    );
    return jsonResponse(502, {
      error:
        "Could not set a temporary password for this account. Their existing password may " +
        "no longer work — issue another temporary password to be sure they can get in.",
    });
  }

  const flagRes = await pg(
    `/user_profiles?id=eq.${encodeURIComponent(target.id)}`,
    {
      bearer: SERVICE_ROLE_KEY,
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        must_change_password: true,
        temp_password_issued_at: new Date().toISOString(),
        temp_password_issued_by: caller.id,
      },
    },
  );
  const forcedChange = flagRes.ok;
  if (!forcedChange) {
    console.error(
      "[admin-issue-temp-password] flag write failed",
      flagRes.status,
      (flagRes.raw || "").slice(0, 200),
    );
  }

  const writeAudit = async (action, extraMetadata) => {
    try {
      const audit = await pg("/audit_log", {
        bearer: userJwt,
        method: "POST",
        prefer: "return=minimal",
        body: {
          org_id: caller.org_id,
          user_id: callerAuthId,
          user_email: gate.user?.email || null,
          action,
          resource_type: "user_profiles",
          resource_id: target.id,
          outcome: "success",
          metadata: {
            actor_role: caller.role || null,
            target_email: target.email,
            target_role: target.role || null,
            ...extraMetadata,
          },
        },
      });
      if (!audit.ok) {
        console.error(
          `[admin-issue-temp-password] audit_log insert failed (${action})`,
          audit.status,
          (audit.raw || "").slice(0, 200),
        );
      }
    } catch (e) {
      console.error(
        `[admin-issue-temp-password] audit_log insert threw (${action})`,
        e?.message || e,
      );
    }
  };

  await writeAudit("user.temp_password_issued", {
    password_length: PASSWORD_LENGTH,
    forced_change: forcedChange,
    ...(forcedChange ? {} : { flag_write_status: flagRes.status }),
    email_confirmation: confirmation.disposition,
    ...(confirmation.confirmedAtBefore
      ? { email_confirmed_at_before: confirmation.confirmedAtBefore }
      : {}),
  });

  if (confirmation.disposition === "newly_confirmed") {
    await writeAudit("user.email_confirmed", {
      confirmed_via: "admin_temp_password_issuance",
    });
  }

  if (!forcedChange) {
    return jsonResponse(200, {
      data: {
        password: tempPassword,
        email: target.email,
        display_name: target.display_name || null,
        forced_change: false,
      },
      warning:
        "The temporary password is set and will work, but the forced-change flag could " +
        "not be recorded. They will NOT be prompted to change it — ask them to change it " +
        "from Settings after signing in.",
      error: null,
    });
  }

  return jsonResponse(200, {
    data: {
      password: tempPassword,
      email: target.email,
      display_name: target.display_name || null,
      forced_change: true,
    },
    error: null,
  });
};
