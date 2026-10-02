import { getCurrentAccessToken } from "./supabaseClient.js";

export async function syncEntrataBackground(connectorId) {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch("/.netlify/functions/entrata-sync-background", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connector_id: connectorId }),
  });
  if (res.status === 202) return { ok: true, accepted: true };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function connectEntrata({ subdomain, api_key, region = "us" }) {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch("/.netlify/functions/entrata-connect", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subdomain, api_key, region }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error || `HTTP ${res.status}`;
    const detail = body?.details ? ` — ${body.details}` : "";
    const err = new Error(msg + detail);
    err.status = res.status;
    throw err;
  }
  return body;
}
