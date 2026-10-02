import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    maxBodyBytes: 4_000,
    rateLimit: { maxPerMinute: 30 },
  });
  if (gate.error) return gate.error;

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("[portfolio-budget-cache-refresh] missing SUPABASE env");
    return jsonResponse(500, { error: "Server not configured" });
  }

  try {
    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const authId = gate.user?.id;
    if (!userJwt || !authId)
      return jsonResponse(401, { error: "Authentication required" });

    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?auth_id=eq.${encodeURIComponent(authId)}&select=org_id&limit=1`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${userJwt}`,
          Accept: "application/json",
        },
      },
    );
    let prof = null;
    try {
      prof = await profRes.json();
    } catch {}
    const orgId = Array.isArray(prof) && prof[0] ? prof[0].org_id : null;
    if (!orgId) return jsonResponse(401, { error: "Profile/org not found" });

    try {
      const coaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/refresh_budget_coa_monthly_cache`,
        {
          method: "POST",
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_org_id: orgId }),
        },
      );
      if (!coaRes.ok) {
        const t = await coaRes.text().catch(() => "");
        console.error(
          "[portfolio-budget-cache-refresh] coa-monthly cache refresh failed",
          coaRes.status,
          t.slice(0, 300),
        );
        try {
          await fetch(
            `${SUPABASE_URL}/rest/v1/portfolio_budget_cache_refresh_log`,
            {
              method: "POST",
              headers: {
                apikey: SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify({
                org_id: orgId,
                source: "budget_mutation_coa_monthly",
                ok: false,
                error_message: `HTTP ${coaRes.status} ${t.slice(0, 300)}`,
              }),
            },
          );
        } catch (logErr) {
          console.error(
            "[portfolio-budget-cache-refresh] coa failure-log write failed",
            logErr?.message || logErr,
          );
        }
      }
    } catch (coaErr) {
      console.error(
        "[portfolio-budget-cache-refresh] coa-monthly cache refresh threw",
        coaErr?.message || coaErr,
      );
    }

    const refreshRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/refresh_portfolio_budget_cache`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_org_id: orgId }),
      },
    );
    if (!refreshRes.ok) {
      const t = await refreshRes.text().catch(() => "");
      console.error(
        "[portfolio-budget-cache-refresh] refresh RPC failed",
        refreshRes.status,
        t.slice(0, 300),
      );
      try {
        await fetch(
          `${SUPABASE_URL}/rest/v1/portfolio_budget_cache_refresh_log`,
          {
            method: "POST",
            headers: {
              apikey: SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              org_id: orgId,
              source: "budget_mutation",
              ok: false,
              error_message: `HTTP ${refreshRes.status} ${t.slice(0, 300)}`,
            }),
          },
        );
      } catch (logErr) {
        console.error(
          "[portfolio-budget-cache-refresh] failure-log write failed",
          logErr?.message || logErr,
        );
      }
      return jsonResponse(502, { error: "Refresh failed" });
    }

    return jsonResponse(200, { ok: true, refreshed_org: orgId });
  } catch (e) {
    console.error(
      "[portfolio-budget-cache-refresh] unhandled error",
      e?.message || e,
    );
    return jsonResponse(500, { error: "Internal error" });
  }
};
