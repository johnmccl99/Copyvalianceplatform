import {
  supabase,
  upsertConnector,
  getCurrentOrgId,
} from "./supabaseClient.js";

const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_REDIRECT =
  (typeof window !== "undefined" ? window.location.origin : "") +
  "/auth/dropbox/callback";
const DROPBOX_CLIENT_ID =
  import.meta.env.VITE_DROPBOX_CLIENT_ID || "6cg2ou6edwamvng";
const DROPBOX_SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.content.read",
  "sharing.read",
].join(" ");

function randHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function pkceChallenge(verifier) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function initiateDropboxLogin({ orgAdmin = false } = {}) {
  if (!DROPBOX_CLIENT_ID) {
    return { error: "Dropbox not configured — VITE_DROPBOX_CLIENT_ID missing" };
  }
  const verifier = randHex(48);
  const challenge = await pkceChallenge(verifier);
  const state = randHex(16);
  sessionStorage.setItem("dropbox_code_verifier", verifier);
  sessionStorage.setItem("dropbox_auth_state", state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: DROPBOX_CLIENT_ID,
    redirect_uri: DROPBOX_REDIRECT,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    scope: DROPBOX_SCOPES,
  });
  window.location.href = `${DROPBOX_AUTH_URL}?${params.toString()}`;
  return { ok: true };
}

export async function handleDropboxCallback({ code, state }) {
  const expectedState = sessionStorage.getItem("dropbox_auth_state");
  const codeVerifier = sessionStorage.getItem("dropbox_code_verifier");
  sessionStorage.removeItem("dropbox_auth_state");
  sessionStorage.removeItem("dropbox_code_verifier");

  if (!code) return { error: "No auth code in callback" };
  if (!expectedState)
    return { error: "No pending auth (perhaps already processed)" };
  if (state !== expectedState)
    return { error: "State mismatch — possible CSRF" };
  if (!codeVerifier) return { error: "Missing PKCE verifier" };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not authenticated" };

  const res = await fetch("/.netlify/functions/dropbox-token-exchange", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: DROPBOX_REDIRECT,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.diagnostic)
      console.error(
        "[dropbox] admin-check diagnostic JSON:",
        JSON.stringify(body.diagnostic),
      );
    console.error("[dropbox] full error body JSON:", JSON.stringify(body));
    return {
      error: body.error || `HTTP ${res.status}`,
      diagnostic: body.diagnostic,
    };
  }

  try {
    await upsertConnector({
      vendor: "dropbox",
      status: "connected",
      connected_by: body.user_profile_id,
    });
  } catch (e) {
    console.warn(
      "[dropbox] upsertConnector failed (non-fatal):",
      e?.message || e,
    );
  }

  return { ok: true, account: body.account };
}

export async function isDropboxConnected() {
  try {
    const { data } = await supabase
      .from("org_dropbox_accounts")
      .select("id, email, display_name, status, last_synced_at")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function getDropboxAccount() {
  const { data, error } = await supabase
    .from("org_dropbox_accounts")
    .select(
      "id, email, display_name, account_type, status, last_synced_at, connected_at, scopes",
    )
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message };
  return { data };
}

export async function disconnectDropbox(accountId) {
  if (!accountId) return { error: "accountId required" };
  const { error } = await supabase
    .from("org_dropbox_accounts")
    .delete()
    .eq("id", accountId);
  if (error) return { error: error.message };
  try {
    await upsertConnector({ vendor: "dropbox", status: "disconnected" });
  } catch {}
  return { ok: true };
}
