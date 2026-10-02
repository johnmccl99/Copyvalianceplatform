const MS_APP_TENANT_ID = process.env.MS_APP_TENANT_ID || "";
const MS_APP_CLIENT_ID = process.env.MS_APP_CLIENT_ID || "";
const MS_APP_CLIENT_SECRET = process.env.MS_APP_CLIENT_SECRET || "";
const MS_APP_SENDER = process.env.MS_APP_SENDER || "";

let _msAppTokenCache = null;
let _msAppTokenExpiresAt = 0;

export function isMsMailConfigured() {
  return Boolean(MS_APP_TENANT_ID && MS_APP_CLIENT_ID && MS_APP_CLIENT_SECRET);
}

export async function getMsAppToken({ onError, timeoutMs } = {}) {
  if (!isMsMailConfigured()) return null;
  if (_msAppTokenCache && Date.now() < _msAppTokenExpiresAt - 60_000)
    return _msAppTokenCache;

  const body = new URLSearchParams({
    client_id: MS_APP_CLIENT_ID,
    client_secret: MS_APP_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(MS_APP_TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    if (onError) onError(res.status, txt);
    return null;
  }
  const data = await res.json();
  _msAppTokenCache = data.access_token;
  _msAppTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return _msAppTokenCache;
}

export function normalizeRecipients(to) {
  const list = Array.isArray(to) ? to : to ? [to] : [];
  return list
    .map((r) => {
      if (typeof r === "string") {
        return r ? { emailAddress: { address: r } } : null;
      }
      if (r && typeof r === "object" && r.address) {
        const emailAddress = { address: r.address };
        if (r.name != null) emailAddress.name = r.name;
        return { emailAddress };
      }
      return null;
    })
    .filter(Boolean);
}

export async function sendMail({
  to,
  subject,
  html,
  text,
  sender = MS_APP_SENDER,
  saveToSentItems = true,
  timeoutMs,
  onTokenError,
} = {}) {
  const toRecipients = normalizeRecipients(to);
  if (!toRecipients.length) return { sent: false, reason: "no_recipients" };

  const token = await getMsAppToken({ onError: onTokenError, timeoutMs });
  if (!token) return { sent: false, reason: "not_configured" };

  const body =
    html != null
      ? { contentType: "HTML", content: html }
      : { contentType: "Text", content: text != null ? text : "" };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: { subject, body, toRecipients },
        saveToSentItems,
      }),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    },
  );
  if (!res.ok) {
    const bodyText = await res.text();
    return {
      sent: false,
      reason: `ms_graph_${res.status}`,
      status: res.status,
      bodyText,
    };
  }
  return {
    sent: true,
    status: res.status,
    recipients: toRecipients.map((r) => r.emailAddress.address),
  };
}
