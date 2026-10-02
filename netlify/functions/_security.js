const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "https://credashboardproperty.netlify.app";
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://mxyrienplzkxuadnkwba.supabase.co";

const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXJpZW5wbHpreHVhZG5rd2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTQ5NDUsImV4cCI6MjA5MTQzMDk0NX0.83NSAZEXc4HjzRm66eBcT5kB0EYbCBtnn1NP1d6X4eA";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  FALLBACK_ANON_KEY;

export const securityHeaders = () => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  Vary: "Origin",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
});

export function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...securityHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
  };
}

const rateBuckets = new Map();
function rateLimitCheck(key, maxPerMinute) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > 60_000) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.windowStart > 120_000) rateBuckets.delete(k);
    }
  }
  return bucket.count <= maxPerMinute;
}

async function verifyJwt(bearer) {
  if (!bearer) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) {
      console.warn(
        `[_security] verifyJwt: Supabase returned ${res.status} — apikey or JWT problem`,
      );
      return null;
    }
    const user = await res.json();
    return user?.id ? user : null;
  } catch (e) {
    console.warn("[_security] verifyJwt: fetch failed:", e.message);
    return null;
  }
}

export async function applySecurity(event, opts = {}) {
  const {
    methods = ["POST"],
    requireAuth = true,
    maxBodyBytes = 50_000,
    rateLimit = { maxPerMinute: 30 },
    parseBody = true,
  } = opts;

  if (event.httpMethod === "OPTIONS") {
    return { error: { statusCode: 204, headers: securityHeaders(), body: "" } };
  }

  if (!methods.includes(event.httpMethod)) {
    return { error: jsonResponse(405, { error: "Method not allowed" }) };
  }

  const rawBody = event.body || "";
  if (rawBody.length > maxBodyBytes) {
    return { error: jsonResponse(413, { error: "Payload too large" }) };
  }

  let user = null;
  if (requireAuth) {
    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) {
      return { error: jsonResponse(401, { error: "Authentication required" }) };
    }
    user = await verifyJwt(bearer);
    if (!user) {
      return {
        error: jsonResponse(401, { error: "Invalid or expired session" }),
      };
    }
  }

  const rateKey =
    user?.id ||
    event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers?.["client-ip"] ||
    "anon";
  if (!rateLimitCheck(rateKey, rateLimit.maxPerMinute)) {
    return { error: jsonResponse(429, { error: "Rate limit exceeded" }) };
  }

  let body = null;
  if (parseBody && rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      return { error: jsonResponse(400, { error: "Invalid JSON body" }) };
    }
  }

  return { user, body, rateKey };
}

export function safeTruncate(s, maxChars = 3000) {
  if (typeof s !== "string") return "";
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitizeUserText(s, maxChars = 4000) {
  if (typeof s !== "string") return "";
  let out = s.normalize("NFKC");
  out = out.replace(LONE_SURROGATE, "");
  out = out.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu,
    "",
  );
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).replace(/[\uD800-\uDBFF]$/, "");
  }
  return out;
}

export function redactSystemPromptEcho(text, systemPrompt, minMatchLen = 40) {
  if (typeof text !== "string" || typeof systemPrompt !== "string") return text;
  if (text.length < minMatchLen || systemPrompt.length < minMatchLen)
    return text;
  const sysChunks = new Set();
  for (let i = 0; i <= systemPrompt.length - minMatchLen; i++) {
    sysChunks.add(systemPrompt.slice(i, i + minMatchLen));
  }
  for (let i = 0; i <= text.length - minMatchLen; i++) {
    if (sysChunks.has(text.slice(i, i + minMatchLen))) {
      return "I can't share my configuration or system instructions. Let me know what you'd actually like to discuss.";
    }
  }
  return text;
}
