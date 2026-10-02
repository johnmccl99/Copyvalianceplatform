import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

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

async function isSuperAdmin(userJwt) {
  const r = await pg("/rpc/is_platform_super_admin", {
    bearer: userJwt,
    method: "POST",
    body: {},
  });
  return r.ok && r.body === true;
}

function extractAuthIds(rpcRows) {
  const usersRow = (rpcRows || []).find(
    (r) =>
      r.step === "users" &&
      typeof r.notes === "string" &&
      r.notes.startsWith("auth_ids emitted"),
  );
  if (!usersRow) return [];
  const m = usersRow.notes.match(/:\s*(.+)$/);
  if (!m) return [];
  const csv = m[1].trim();
  if (csv === "<none>" || !csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractStoragePaths(rpcRows) {
  const storageRow = (rpcRows || []).find((r) => r.step === "storage");
  if (!storageRow || typeof storageRow.notes !== "string") return [];
  return storageRow.notes
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error("[admin-reset-org] missing env vars");
    return jsonResponse(500, { error: "Server not configured" });
  }

  try {
    const body = gate.body || {};
    const orgId = body.orgId;
    const preserveUsers = body.preserveUsers === true;
    const dryRun = body.dryRun !== false;

    if (
      !orgId ||
      typeof orgId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(orgId)
    ) {
      return jsonResponse(400, { error: "orgId (uuid) required" });
    }

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const isSuper = await isSuperAdmin(userJwt);
    if (!isSuper) {
      console.warn("[admin-reset-org] non-super-admin attempt from JWT");
      return jsonResponse(403, { error: "Platform super-admin required" });
    }

    const rpcRes = await pg("/rpc/reset_client_data_for_org", {
      bearer: SERVICE_ROLE_KEY,
      method: "POST",
      body: {
        p_org_id: orgId,
        p_preserve_users: preserveUsers,
        p_dry_run: dryRun,
      },
    });
    if (!rpcRes.ok) {
      console.error("[admin-reset-org] RPC failed:", rpcRes.status, rpcRes.raw);
      return jsonResponse(500, {
        error: "Reset RPC failed",
        detail: rpcRes.raw,
      });
    }
    const rpcRows = Array.isArray(rpcRes.body) ? rpcRes.body : [];

    if (dryRun) {
      return jsonResponse(200, {
        dryRun: true,
        orgId,
        preserveUsers,
        steps: rpcRows,
      });
    }

    const storagePaths = extractStoragePaths(rpcRows);
    const storageResults = {
      requested: storagePaths.length,
      removed: 0,
      errors: [],
    };
    if (storagePaths.length) {
      const bucket = "documents";
      for (const path of storagePaths) {
        try {
          const r = await fetch(
            `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
            {
              method: "DELETE",
              headers: {
                apikey: SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
              },
            },
          );
          if (r.ok) storageResults.removed++;
          else storageResults.errors.push({ path, status: r.status });
        } catch (e) {
          storageResults.errors.push({ path, message: e.message });
        }
      }
    }

    const authResults = { requested: 0, deleted: 0, errors: [] };
    if (!preserveUsers) {
      const authIds = extractAuthIds(rpcRows);
      authResults.requested = authIds.length;
      for (const authId of authIds) {
        try {
          const r = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(authId)}`,
            {
              method: "DELETE",
              headers: {
                apikey: SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
              },
            },
          );
          if (r.ok) authResults.deleted++;
          else authResults.errors.push({ authId, status: r.status });
        } catch (e) {
          authResults.errors.push({ authId, message: e.message });
        }
      }
    }

    return jsonResponse(200, {
      dryRun: false,
      orgId,
      preserveUsers,
      steps: rpcRows,
      storage: storageResults,
      users: authResults,
    });
  } catch (err) {
    console.error("[admin-reset-org] unexpected:", err);
    return jsonResponse(500, { error: "Internal error", detail: err.message });
  }
};
