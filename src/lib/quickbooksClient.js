import { getCurrentAccessToken } from "./supabaseClient.js";

const QB_CONFIG = {
  clientId: import.meta.env.VITE_QB_CLIENT_ID || "",
  environment: import.meta.env.VITE_QB_ENVIRONMENT || "production",
  redirectUri:
    import.meta.env.VITE_QB_REDIRECT_URI ||
    "https://credashboardproperty.netlify.app/auth/quickbooks/callback",
  scopes: ["com.intuit.quickbooks.accounting"],
};

const QB_TOKEN_STORAGE_KEY = "qb_access_token";

let accessToken = null;
let tokenExpiry = null;
let realmId = null;
let environment = null;

function getStoredToken() {
  try {
    const stored = localStorage.getItem(QB_TOKEN_STORAGE_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    if (parsed.expiry <= Date.now()) return false;
    accessToken = parsed.token;
    tokenExpiry = parsed.expiry;
    realmId = parsed.realmId || null;
    environment = parsed.environment || null;
    return true;
  } catch {
    return false;
  }
}

function storeToken({ token, expiresIn, realmId: rid, environment: env }) {
  accessToken = token;
  tokenExpiry = Date.now() + expiresIn * 1000 - 60000;
  if (rid) realmId = rid;
  if (env) environment = env;
  try {
    localStorage.setItem(
      QB_TOKEN_STORAGE_KEY,
      JSON.stringify({
        token: accessToken,
        expiry: tokenExpiry,
        realmId,
        environment,
      }),
    );
  } catch (e) {
    console.warn("[quickbooks] Failed to store access token:", e?.message);
  }
}

function clearToken() {
  accessToken = null;
  tokenExpiry = null;
  realmId = null;
  environment = null;
  try {
    localStorage.removeItem(QB_TOKEN_STORAGE_KEY);
  } catch {}
}

function isAuthenticated() {
  if (!accessToken || !tokenExpiry) getStoredToken();
  return !!(accessToken && tokenExpiry && Date.now() < tokenExpiry && realmId);
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function initiateQbLogin() {
  if (!QB_CONFIG.clientId) {
    return {
      error: "QuickBooks not configured. Set VITE_QB_CLIENT_ID in Netlify env.",
    };
  }
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  sessionStorage.setItem("qb_code_verifier", codeVerifier);
  sessionStorage.setItem("qb_auth_state", crypto.randomUUID());
  const state = sessionStorage.getItem("qb_auth_state");
  const params = new URLSearchParams({
    client_id: QB_CONFIG.clientId,
    scope: QB_CONFIG.scopes.join(" "),
    redirect_uri: QB_CONFIG.redirectUri,
    response_type: "code",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
  try {
    const u = new URL(authUrl);
    if (u.protocol !== "https:" || u.hostname !== "appcenter.intuit.com") {
      return {
        error: "QuickBooks auth URL is not Intuit; refusing to redirect.",
      };
    }
  } catch {
    return { error: "QuickBooks auth URL not parseable." };
  }
  window.location.href = authUrl;
  return { redirected: true };
}

export async function handleQbCallback(searchParams) {
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const realm = searchParams.get("realmId");
  const storedState = sessionStorage.getItem("qb_auth_state");
  const codeVerifier = sessionStorage.getItem("qb_code_verifier");

  if (!code || !realm || state !== storedState || !codeVerifier) {
    return {
      error:
        "Invalid QuickBooks callback — state mismatch, missing code, or missing realmId",
    };
  }

  sessionStorage.removeItem("qb_code_verifier");
  sessionStorage.removeItem("qb_auth_state");

  try {
    const supaJwt = await getCurrentAccessToken();
    if (!supaJwt) {
      return { error: "Sign in to the platform before connecting QuickBooks." };
    }
    const res = await fetch("/.netlify/functions/qb-token-exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supaJwt}`,
      },
      body: JSON.stringify({
        code,
        codeVerifier,
        redirectUri: QB_CONFIG.redirectUri,
        realmId: realm,
        environment: QB_CONFIG.environment,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[quickbooks] Token exchange error:", res.status, data);
      return {
        error:
          data?.error || `QuickBooks token exchange failed (${res.status})`,
        detail: data?.detail,
      };
    }
    storeToken({
      token: data.access_token,
      expiresIn: data.expires_in,
      realmId: data.realm_id,
      environment: data.environment,
    });
    return { success: true, realmId: data.realm_id };
  } catch (err) {
    console.error("[quickbooks] OAuth exchange failed:", err);
    return { error: err?.message || "QuickBooks OAuth failed" };
  }
}

async function refreshAccessToken() {
  try {
    const supaJwt = await getCurrentAccessToken();
    if (!supaJwt) return false;
    const res = await fetch("/.netlify/functions/qb-refresh-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supaJwt}`,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data?.reauth) clearToken();
      console.warn("[quickbooks] Refresh failed:", res.status, data?.error);
      return false;
    }
    storeToken({
      token: data.access_token,
      expiresIn: data.expires_in,
      realmId: data.realm_id,
      environment: data.environment,
    });
    return true;
  } catch (e) {
    console.warn("[quickbooks] Refresh error:", e?.message);
    return false;
  }
}

export async function qbFetch(
  path,
  { method = "GET", query = null, body = null } = {},
) {
  if (!isAuthenticated() && !(await refreshAccessToken())) {
    throw new Error("QuickBooks not connected");
  }
  const baseHost =
    environment === "sandbox"
      ? "sandbox-quickbooks.api.intuit.com"
      : "quickbooks.api.intuit.com";
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const url = `https://${baseHost}/v3/company/${realmId}/${path.replace(/^\/+/, "")}${qs}`;

  const doFetch = () =>
    fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch();
  if (res.status === 401) {
    if (await refreshAccessToken()) {
      res = await doFetch();
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QuickBooks API ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

export async function qbQuery(ql) {
  const data = await qbFetch("query", { query: { query: ql } });
  return data?.QueryResponse || {};
}

export async function ensureQuickBooksSession() {
  if (isAuthenticated()) return "Connected";
  const refreshed = await refreshAccessToken();
  return refreshed ? "Connected" : "Setup Required";
}

export async function disconnectQuickBooks() {
  clearToken();
  try {
    const supaJwt = await getCurrentAccessToken();
    if (!supaJwt) return { success: true, cleared: "local-only" };
    const supaUrl =
      import.meta.env.VITE_SUPABASE_URL ||
      "https://mxyrienplzkxuadnkwba.supabase.co";
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
    await fetch(`${supaUrl}/rest/v1/org_qb_integrations`, {
      method: "DELETE",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${supaJwt}`,
        "Content-Type": "application/json",
      },
    });
    await fetch(`${supaUrl}/rest/v1/connectors?vendor=eq.quickbooks`, {
      method: "PATCH",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${supaJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "disconnected" }),
    }).catch((err) => {
      console.warn("[quickbooks] connector flip failed:", err?.message);
    });
    return { success: true, cleared: "local+server" };
  } catch (err) {
    console.warn("[quickbooks] disconnect failed:", err?.message || err);
    return { success: false, error: err?.message || "Disconnect failed" };
  }
}

export { QB_CONFIG, isAuthenticated, clearToken };
