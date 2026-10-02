import { getCurrentAccessToken } from "./supabaseClient.js";

const MS_WEB_PLATFORM_REDIRECT_SUFFIX = "/auth/microsoft/callback-web";

if (!import.meta.env.VITE_MS_CLIENT_ID || !import.meta.env.VITE_MS_TENANT_ID) {
  console.warn(
    "[microsoftGraph] VITE_MS_CLIENT_ID / VITE_MS_TENANT_ID not set in env; using fallback constants.",
  );
}
if (
  import.meta.env.VITE_MS_REDIRECT_URI &&
  !import.meta.env.VITE_MS_REDIRECT_URI.endsWith(
    MS_WEB_PLATFORM_REDIRECT_SUFFIX,
  )
) {
  console.warn(
    "[microsoftGraph] VITE_MS_REDIRECT_URI is set but does not end with " +
      `"${MS_WEB_PLATFORM_REDIRECT_SUFFIX}". The Netlify function allowlist ` +
      "only accepts Web-platform URIs; Connect Microsoft will fail with " +
      '"Invalid redirect URI". Current value: ' +
      JSON.stringify(import.meta.env.VITE_MS_REDIRECT_URI),
  );
}
const MS_CONFIG = {
  clientId:
    import.meta.env.VITE_MS_CLIENT_ID || "3acf08d4-96db-4658-a210-8378a4b509ea",
  tenantId: import.meta.env.VITE_MS_TENANT_ID || "organizations",
  redirectUri:
    import.meta.env.VITE_MS_REDIRECT_URI ||
    "https://credashboardproperty.netlify.app/auth/microsoft/callback-web",
  scopes: [
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Mail.ReadWrite",
    "Mail.Send",
    "Calendars.Read",
    "Calendars.ReadWrite",
    "Files.Read",
    "Files.ReadWrite",
    "Sites.Read.All",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "ChannelMessage.Send",
    "Chat.Read",
    "Chat.ReadWrite",
    "OnlineMeetings.ReadWrite",
  ],
  authority: "",
  graphBaseUrl: "https://graph.microsoft.com/v1.0",
};

MS_CONFIG.authority = `https://login.microsoftonline.com/${MS_CONFIG.tenantId || "common"}`;

let accessToken = null;
let tokenExpiry = null;

function isAuthenticated() {
  if (!accessToken || !tokenExpiry) {
    getStoredToken();
  }
  return accessToken && tokenExpiry && Date.now() < tokenExpiry;
}

const MS_TOKEN_STORAGE_KEY = "ms_graph_token";

function getStoredToken() {
  try {
    const stored = localStorage.getItem(MS_TOKEN_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.expiry > Date.now()) {
        accessToken = parsed.token;
        tokenExpiry = parsed.expiry;
        return true;
      }
    }
  } catch (e) {
    console.warn("Failed to restore MS token:", e);
  }
  return false;
}

function storeToken(token, expiresIn) {
  accessToken = token;
  tokenExpiry = Date.now() + expiresIn * 1000 - 60000;
  try {
    localStorage.setItem(
      MS_TOKEN_STORAGE_KEY,
      JSON.stringify({
        token: accessToken,
        expiry: tokenExpiry,
      }),
    );
  } catch (e) {
    console.warn("Failed to store MS token:", e);
  }
  _emitConnectionStatus("Connected", { reason: "stored" });
}

function clearToken() {
  accessToken = null;
  tokenExpiry = null;
  try {
    localStorage.removeItem(MS_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(MS_TOKEN_STORAGE_KEY);
  } catch (e) {}
  _emitConnectionStatus(getMicrosoftConnectionStatus(), { reason: "cleared" });
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
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function initiateLogin() {
  if (!MS_CONFIG.clientId) {
    console.error(
      "Microsoft client ID not configured. Set VITE_MS_CLIENT_ID in .env",
    );
    return {
      error:
        "Microsoft integration not configured. Add VITE_MS_CLIENT_ID to your environment.",
    };
  }
  if (
    !MS_CONFIG.redirectUri ||
    !MS_CONFIG.redirectUri.endsWith(MS_WEB_PLATFORM_REDIRECT_SUFFIX)
  ) {
    console.error(
      "[microsoftGraph] Refusing to initiate OAuth: MS_CONFIG.redirectUri " +
        `does not end with "${MS_WEB_PLATFORM_REDIRECT_SUFFIX}". ` +
        "Current value: " +
        JSON.stringify(MS_CONFIG.redirectUri) +
        ". Fix VITE_MS_REDIRECT_URI on Netlify (or unset it to use the correct fallback) and redeploy.",
    );
    return {
      error:
        "Microsoft OAuth is misconfigured: the redirect URI on this deploy does not end with /auth/microsoft/callback-web, so the Netlify function will reject the token exchange. An admin must update VITE_MS_REDIRECT_URI on Netlify and redeploy before Connect Microsoft can proceed.",
    };
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  sessionStorage.setItem("ms_code_verifier", codeVerifier);
  sessionStorage.setItem("ms_auth_state", crypto.randomUUID());

  const state = sessionStorage.getItem("ms_auth_state");
  const params = new URLSearchParams({
    client_id: MS_CONFIG.clientId,
    response_type: "code",
    redirect_uri: MS_CONFIG.redirectUri,
    scope: MS_CONFIG.scopes.join(" "),
    response_mode: "query",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${MS_CONFIG.authority}/oauth2/v2.0/authorize?${params}`;
  try {
    const u = new URL(authUrl);
    if (u.protocol !== "https:" || u.hostname !== "login.microsoftonline.com") {
      console.error(
        "Refusing to redirect: auth URL host is not login.microsoftonline.com",
        u.hostname,
      );
      return { error: "Authentication configuration invalid." };
    }
  } catch (e) {
    console.error("Refusing to redirect: auth URL not parseable", e);
    return { error: "Authentication configuration invalid." };
  }
  window.location.href = authUrl;
}

export async function handleAuthCallback(searchParams) {
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = sessionStorage.getItem("ms_auth_state");
  const codeVerifier = sessionStorage.getItem("ms_code_verifier");

  if (!code || state !== storedState || !codeVerifier) {
    return { error: "Invalid auth callback — state mismatch or missing code" };
  }

  sessionStorage.removeItem("ms_code_verifier");
  sessionStorage.removeItem("ms_auth_state");

  try {
    const supaJwt = await getCurrentAccessToken();
    if (!supaJwt) {
      return { error: "Sign in to the platform before connecting Microsoft." };
    }
    const res = await fetch("/.netlify/functions/microsoft-oauth-callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supaJwt}`,
      },
      body: JSON.stringify({
        code,
        codeVerifier,
        redirectUri: MS_CONFIG.redirectUri,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("MS token exchange error response:", res.status, data);
      return { error: data?.error || `Token exchange failed: ${res.status}` };
    }

    storeToken(data.access_token, data.expires_in);

    if (!data.persisted) {
      console.warn(
        "[microsoftGraph] Connected, but refresh token not persisted. " +
          "Add offline_access to the Azure AD app registration API permissions.",
      );
    }

    return { success: true };
  } catch (err) {
    console.error("MS token exchange error:", err);
    return { error: err.message };
  }
}

const _msSubscribers = new Set();
let _lastEmittedStatus = null;
let _lastCheckedAt = 0;

function _emitConnectionStatus(status, opts = {}) {
  _lastEmittedStatus = status;
  _lastCheckedAt = Date.now();
  const detail = {
    status,
    lastCheckedAt: _lastCheckedAt,
    reason: opts.reason || null,
  };
  for (const fn of _msSubscribers) {
    try {
      fn(detail);
    } catch (e) {
      console.warn("[microsoftGraph] subscriber error:", e);
    }
  }
}

export function subscribeMicrosoftConnectionStatus(listener) {
  if (typeof listener !== "function") return () => {};
  _msSubscribers.add(listener);
  try {
    const current = _lastEmittedStatus || getMicrosoftConnectionStatus();
    listener({
      status: current,
      lastCheckedAt: _lastCheckedAt,
      reason: "subscribe",
    });
  } catch {}
  return () => {
    _msSubscribers.delete(listener);
  };
}

export function getLastEmittedMicrosoftConnectionStatus() {
  return { status: _lastEmittedStatus, lastCheckedAt: _lastCheckedAt };
}

async function _refreshAccessTokenInternal() {
  let supaJwt;
  try {
    supaJwt = await getCurrentAccessToken();
  } catch (err) {
    return {
      ok: false,
      hard: false,
      reason: `supabase-jwt-exception:${err?.message || "unknown"}`,
    };
  }
  if (!supaJwt) {
    return { ok: false, hard: false, reason: "no-supabase-jwt" };
  }
  let res;
  try {
    res = await fetch("/.netlify/functions/microsoft-token-refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supaJwt}`,
      },
    });
  } catch (err) {
    return {
      ok: false,
      hard: false,
      reason: `network:${err?.message || "fetch-failed"}`,
    };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    if (data?.reauth) {
      clearToken();
      return {
        ok: false,
        hard: true,
        reason: data?.error || "reauth-required",
      };
    }
    const soft = res.status >= 500 || res.status === 429 || res.status === 0;
    return { ok: false, hard: !soft, reason: `http-${res.status}` };
  }
  storeToken(data.access_token, data.expires_in);
  return { ok: true };
}

async function refreshAccessToken() {
  const result = await _refreshAccessTokenInternal();
  if (result.ok) return true;
  if (result.hard) {
    _emitConnectionStatus("Setup Required", {
      reason: `refresh-hard:${result.reason || "unknown"}`,
    });
  } else {
    console.warn(
      "[microsoftGraph] refreshAccessToken soft-failed:",
      result.reason,
    );
  }
  return false;
}

export async function recheckMicrosoftConnection({ reason = "recheck" } = {}) {
  if (isAuthenticated() || getStoredToken()) {
    _emitConnectionStatus("Connected", { reason });
    return "Connected";
  }
  const result = await _refreshAccessTokenInternal();
  if (result.ok) {
    _emitConnectionStatus("Connected", { reason: `${reason}+refreshed` });
    return "Connected";
  }
  if (result.hard) {
    _emitConnectionStatus("Setup Required", {
      reason: `${reason}+hard:${result.reason}`,
    });
    return "Setup Required";
  }
  if (_lastEmittedStatus === "Connected") {
    _emitConnectionStatus("Connected", {
      reason: `${reason}+soft-keep:${result.reason}`,
    });
    return "Connected";
  }
  const fallback = getMicrosoftConnectionStatus();
  _emitConnectionStatus(fallback, {
    reason: `${reason}+soft-initial:${result.reason}`,
  });
  return fallback;
}

let _focusRecheckTimer = null;
function _scheduleFocusRecheck() {
  if (_focusRecheckTimer) return;
  _focusRecheckTimer = setTimeout(() => {
    _focusRecheckTimer = null;
    recheckMicrosoftConnection({ reason: "visibilityOrFocus" }).catch(() => {});
  }, 1500);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") _scheduleFocusRecheck();
    });
    window.addEventListener("focus", _scheduleFocusRecheck);
    window.addEventListener("storage", (e) => {
      if (e.key !== MS_TOKEN_STORAGE_KEY) return;
      if (e.newValue === null) {
        accessToken = null;
        tokenExpiry = null;
        _emitConnectionStatus(getMicrosoftConnectionStatus(), {
          reason: "storage-cleared",
        });
      } else {
        getStoredToken();
        _emitConnectionStatus("Connected", { reason: "storage-updated" });
      }
    });
  } catch (e) {
    console.warn(
      "[microsoftGraph] could not install visibility/focus/storage listeners:",
      e?.message || e,
    );
  }
}

async function graphFetch(endpoint, options = {}) {
  if (!isAuthenticated()) {
    if (!getStoredToken()) {
      const ok = await refreshAccessToken();
      if (!ok) {
        return { error: "Not authenticated. Call initiateLogin() first." };
      }
    }
  }

  const doFetch = () =>
    fetch(`${MS_CONFIG.graphBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

  try {
    let res = await doFetch();

    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        res = await doFetch();
      }
    }

    if (res.status === 401) {
      clearToken();
      return { error: "Token expired. Re-authentication required." };
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        errBody?.error?.message || `Graph API error: ${res.status}`,
      );
    }

    if (res.status === 204 || res.status === 202) {
      return { success: true };
    }

    const text = await res.text();
    if (!text || text.trim().length === 0) {
      return { success: true };
    }

    return JSON.parse(text);
  } catch (err) {
    console.error(`Graph API error (${endpoint}):`, err);
    return { error: err.message };
  }
}

export async function fetchRecentEmails(count = 20) {
  return graphFetch(
    `/me/messages?$top=${count}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,importance`,
  );
}

export async function fetchEmailsByFolder(folderId = "inbox", count = 20) {
  return graphFetch(
    `/me/mailFolders/${folderId}/messages?$top=${count}&$orderby=receivedDateTime desc`,
  );
}

export async function searchEmails(query, count = 20) {
  return graphFetch(
    `/me/messages?$search="${encodeURIComponent(query)}"&$top=${count}`,
  );
}

export async function fetchUpcomingEvents(days = 7) {
  const now = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();
  return graphFetch(
    `/me/calendarView?startDateTime=${now}&endDateTime=${end}&$orderby=start/dateTime&$select=id,subject,start,end,location,organizer,attendees,isOnlineMeeting,onlineMeetingUrl`,
  );
}

export async function fetchCalendars() {
  return graphFetch("/me/calendars?$select=id,name,color,isDefaultCalendar");
}

export async function fetchJoinedTeams() {
  return graphFetch("/me/joinedTeams?$select=id,displayName,description");
}

export async function fetchTeamChannels(teamId) {
  return graphFetch(
    `/teams/${teamId}/channels?$select=id,displayName,description,membershipType`,
  );
}

export async function fetchChannelMessages(teamId, channelId, count = 20) {
  return graphFetch(
    `/teams/${teamId}/channels/${channelId}/messages?$top=${count}`,
  );
}

export async function fetchRecentChats(count = 20) {
  return graphFetch(
    `/me/chats?$top=${count}&$orderby=lastMessagePreview/createdDateTime desc&$expand=lastMessagePreview`,
  );
}

export async function fetchSharePointSites(query) {
  if (query) {
    return graphFetch(`/sites?search=${encodeURIComponent(query)}`);
  }
  return graphFetch("/sites?search=*");
}

export async function fetchSiteDocumentLibraries(siteId) {
  return graphFetch(`/sites/${siteId}/drives`);
}

export async function fetchDriveItems(driveId, folderId = "root", count = 50) {
  return graphFetch(
    `/drives/${driveId}/items/${folderId}/children?$top=${count}&$select=id,name,size,lastModifiedDateTime,webUrl,file,folder`,
  );
}

export async function searchSharePointDocuments(siteId, query) {
  return graphFetch(
    `/sites/${siteId}/drive/root/search(q='${encodeURIComponent(query)}')`,
  );
}

export async function fetchOneDriveRoot(count = 50) {
  return graphFetch(
    `/me/drive/root/children?$top=${count}&$select=id,name,size,lastModifiedDateTime,webUrl,file,folder`,
  );
}

export async function fetchOneDriveFolder(folderId, count = 50) {
  return graphFetch(
    `/me/drive/items/${folderId}/children?$top=${count}&$select=id,name,size,lastModifiedDateTime,webUrl,file,folder`,
  );
}

export async function searchOneDrive(query) {
  return graphFetch(`/me/drive/root/search(q='${encodeURIComponent(query)}')`);
}

export async function getOneDriveFileContent(itemId) {
  if (!isAuthenticated() && !getStoredToken()) {
    return { error: "Not authenticated" };
  }
  const res = await fetch(
    `${MS_CONFIG.graphBaseUrl}/me/drive/items/${itemId}/content`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) return { error: `Failed to download: ${res.status}` };
  return res.blob();
}

export async function fetchCurrentUser() {
  return graphFetch(
    "/me?$select=displayName,mail,jobTitle,department,officeLocation",
  );
}

export async function sendEmail({ to, cc, bcc, subject, body, isHtml = true }) {
  const toRecipients = (Array.isArray(to) ? to : [to]).map((addr) => ({
    emailAddress: { address: addr },
  }));
  const ccRecipients = cc
    ? (Array.isArray(cc) ? cc : [cc]).map((addr) => ({
        emailAddress: { address: addr },
      }))
    : [];
  const bccRecipients = bcc
    ? (Array.isArray(bcc) ? bcc : [bcc]).map((addr) => ({
        emailAddress: { address: addr },
      }))
    : [];

  return graphFetch("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: isHtml ? "HTML" : "Text", content: body },
        toRecipients,
        ccRecipients,
        bccRecipients,
      },
      saveToSentItems: true,
    }),
  });
}

export async function replyToEmail(messageId, comment, replyAll = false) {
  const endpoint = replyAll
    ? `/me/messages/${messageId}/replyAll`
    : `/me/messages/${messageId}/reply`;
  return graphFetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function forwardEmail(messageId, to, comment = "") {
  const toRecipients = (Array.isArray(to) ? to : [to]).map((addr) => ({
    emailAddress: { address: addr },
  }));
  return graphFetch(`/me/messages/${messageId}/forward`, {
    method: "POST",
    body: JSON.stringify({ comment, toRecipients }),
  });
}

export async function createDraftEmail({
  to,
  cc,
  subject,
  body,
  isHtml = true,
}) {
  const toRecipients = (Array.isArray(to) ? to : [to]).map((addr) => ({
    emailAddress: { address: addr },
  }));
  const ccRecipients = cc
    ? (Array.isArray(cc) ? cc : [cc]).map((addr) => ({
        emailAddress: { address: addr },
      }))
    : [];
  return graphFetch("/me/messages", {
    method: "POST",
    body: JSON.stringify({
      subject,
      body: { contentType: isHtml ? "HTML" : "Text", content: body },
      toRecipients,
      ccRecipients,
    }),
  });
}

export async function deleteEmail(messageId) {
  return graphFetch(`/me/messages/${messageId}`, { method: "DELETE" });
}

export async function markEmailRead(messageId, isRead = true) {
  return graphFetch(`/me/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

export async function fetchMailFolders() {
  return graphFetch(
    "/me/mailFolders?$select=id,displayName,totalItemCount,unreadItemCount",
  );
}

export async function fetchEmailDetail(messageId) {
  return graphFetch(
    `/me/messages/${messageId}?$select=id,subject,from,toRecipients,ccRecipients,body,receivedDateTime,isRead,importance,hasAttachments,attachments&$expand=attachments`,
  );
}

export async function createCalendarEvent({
  subject,
  body,
  start,
  end,
  location,
  attendees,
  isOnlineMeeting = false,
  timeZone = "America/New_York",
}) {
  const attendeeList = attendees
    ? (Array.isArray(attendees) ? attendees : [attendees]).map((a) => ({
        emailAddress: {
          address: typeof a === "string" ? a : a.email,
          name: typeof a === "string" ? "" : a.name || "",
        },
        type: "required",
      }))
    : [];

  return graphFetch("/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject,
      body: body ? { contentType: "HTML", content: body } : undefined,
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
      location: location ? { displayName: location } : undefined,
      attendees: attendeeList,
      isOnlineMeeting,
      onlineMeetingProvider: isOnlineMeeting ? "teamsForBusiness" : undefined,
    }),
  });
}

export async function updateCalendarEvent(eventId, updates) {
  const body = {};
  if (updates.subject) body.subject = updates.subject;
  if (updates.body) body.body = { contentType: "HTML", content: updates.body };
  if (updates.start)
    body.start = {
      dateTime: updates.start,
      timeZone: updates.timeZone || "America/New_York",
    };
  if (updates.end)
    body.end = {
      dateTime: updates.end,
      timeZone: updates.timeZone || "America/New_York",
    };
  if (updates.location) body.location = { displayName: updates.location };
  return graphFetch(`/me/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteCalendarEvent(eventId) {
  return graphFetch(`/me/events/${eventId}`, { method: "DELETE" });
}

export async function respondToEvent(eventId, response, comment = "") {
  return graphFetch(`/me/events/${eventId}/${response}`, {
    method: "POST",
    body: JSON.stringify({ comment, sendResponse: true }),
  });
}

export async function fetchEventDetail(eventId) {
  return graphFetch(
    `/me/events/${eventId}?$select=id,subject,body,start,end,location,organizer,attendees,isOnlineMeeting,onlineMeetingUrl,recurrence,importance,sensitivity`,
  );
}

export async function sendChannelMessage(
  teamId,
  channelId,
  content,
  contentType = "text",
) {
  return graphFetch(`/teams/${teamId}/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      body: { contentType, content },
    }),
  });
}

export async function sendChatMessage(chatId, content, contentType = "text") {
  return graphFetch(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      body: { contentType, content },
    }),
  });
}

export async function fetchChatMessages(chatId, count = 50) {
  return graphFetch(
    `/chats/${chatId}/messages?$top=${count}&$orderby=createdDateTime desc`,
  );
}

export async function fetchChatMembers(chatId) {
  return graphFetch(`/chats/${chatId}/members`);
}

export async function fetchChannelMessageReplies(teamId, channelId, messageId) {
  return graphFetch(
    `/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`,
  );
}

export async function fetchTeamMembers(teamId) {
  return graphFetch(`/teams/${teamId}/members?$top=100`);
}

export async function uploadFileToDrive(fileName, content, folderId = "root") {
  if (!isAuthenticated() && !getStoredToken()) {
    return { error: "Not authenticated" };
  }
  try {
    const res = await fetch(
      `${MS_CONFIG.graphBaseUrl}/me/drive/items/${folderId}:/${encodeURIComponent(fileName)}:/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: content,
      },
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        errBody?.error?.message || `Upload failed: ${res.status}`,
      );
    }
    return await res.json();
  } catch (err) {
    console.error("OneDrive upload error:", err);
    return { error: err.message };
  }
}

export async function fetchContacts(count = 50) {
  return graphFetch(
    `/me/contacts?$top=${count}&$select=id,displayName,emailAddresses,jobTitle,companyName,businessPhones`,
  );
}

export async function searchPeople(query) {
  return graphFetch(
    `/me/people?$search="${encodeURIComponent(query)}"&$top=10&$select=displayName,emailAddresses,jobTitle,department`,
  );
}

export function getMicrosoftConnectionStatus() {
  const configured = !!MS_CONFIG.clientId;
  const authenticated = isAuthenticated() || getStoredToken();

  if (!configured) return "Not Configured";
  if (!authenticated) return "Setup Required";
  return "Connected";
}

export async function ensureMicrosoftSession() {
  if (isAuthenticated() || getStoredToken()) {
    _emitConnectionStatus("Connected", { reason: "ensure-local" });
    return "Connected";
  }
  const result = await _refreshAccessTokenInternal();
  if (result.ok) {
    return "Connected";
  }
  if (result.hard) {
    _emitConnectionStatus("Setup Required", {
      reason: `ensure-hard:${result.reason}`,
    });
    return "Setup Required";
  }
  if (_lastEmittedStatus === "Connected") {
    _emitConnectionStatus("Connected", {
      reason: `ensure-soft-keep:${result.reason}`,
    });
    return "Connected";
  }
  const fallback = getMicrosoftConnectionStatus();
  _emitConnectionStatus(fallback, {
    reason: `ensure-soft-initial:${result.reason}`,
  });
  return fallback;
}

export async function disconnectMicrosoft() {
  clearToken();
  try {
    const supaJwt = await getCurrentAccessToken();
    if (!supaJwt) return { success: true, cleared: "local-only" };
    const supaUrl =
      import.meta.env.VITE_SUPABASE_URL ||
      "https://mxyrienplzkxuadnkwba.supabase.co";
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    await fetch(`${supaUrl}/rest/v1/user_ms_integrations`, {
      method: "DELETE",
      headers: {
        apikey: anon || "",
        Authorization: `Bearer ${supaJwt}`,
        "Content-Type": "application/json",
      },
    });
    return { success: true, cleared: "local+server" };
  } catch (err) {
    console.warn("[microsoftGraph] disconnect failed:", err?.message || err);
    return { success: false, error: err?.message || "Disconnect failed" };
  }
}

export function getMicrosoftRedirectUriDiagnostic() {
  const actual = MS_CONFIG.redirectUri || "";
  const valid = !!actual && actual.endsWith(MS_WEB_PLATFORM_REDIRECT_SUFFIX);
  return {
    valid,
    actualUri: actual,
    expectedSuffix: MS_WEB_PLATFORM_REDIRECT_SUFFIX,
  };
}

export {
  MS_CONFIG,
  isAuthenticated,
  clearToken,
  refreshAccessToken,
  MS_WEB_PLATFORM_REDIRECT_SUFFIX,
};
