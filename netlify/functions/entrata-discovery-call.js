import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const ENTRATA_BASE = {
  us: "https://apis.entrata.com/ext/orgs",
  eu: "https://apis.entrata.global/ext/orgs",
};

const ENTRATA_CALL_TIMEOUT_MS = 30_000;
const MAX_EXCERPT_BYTES = 8 * 1024;
const MAX_FIELD_KEYS = 200;

const ALLOWED_GATEWAY_PATHS = new Set([
  "/status",
  "/properties",
  "/propertyunits",
  "/leases",
  "/customers",
  "/communications",
  "/financial",
  "/artransactions",
  "/arpayments",
  "/vendors",
  "/maintenance",
  "/leads",
  "/leasingcenter",
  "/applications",
]);

const VENDOR_METHOD_RE = /^[a-z][a-zA-Z0-9]{2,63}$/;

const METHOD_VERSION_RE = /^r[0-9]{1,2}$/;

const PII_KEY_DENYLIST = new Set([
  "firstname",
  "lastname",
  "middlename",
  "nameprefix",
  "fullname",
  "name",
  "email",
  "additionalemail",
  "phonenumber",
  "phone",
  "cellphone",
  "homephone",
  "workphone",
  "dob",
  "dateofbirth",
  "birthdate",
  "address",
  "addressline1",
  "addressline2",
  "street",
  "city",
  "ssn",
  "taxid",
  "tax_id",
  "bankaccount",
  "routingnumber",
  "accountnumber",
  "cardnumber",
  "cardlast4",
  "paymentmethod",
]);

function pgUser(path, jwt, { method = "GET", body = null } = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function pgServiceRole(path, { method = "GET", body = null } = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function decodeJwtSub(jwt) {
  try {
    const [, payloadB64] = jwt.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf8"),
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}

async function resolveAdminProfile(userJwt) {
  const sub = decodeJwtSub(userJwt);
  if (!sub) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?auth_id=eq.${encodeURIComponent(sub)}&select=id,org_id,is_admin,role&limit=1`,
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        Accept: "application/json",
      },
    },
  );
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || !rows.length) return null;
  const p = rows[0];
  const truthyAdmin =
    p.is_admin === true ||
    p.is_admin === "t" ||
    p.is_admin === "true" ||
    p.is_admin === 1;
  const adminRole = ["admin", "gp_admin", "gp-admin"].includes(
    String(p.role || "").toLowerCase(),
  );
  return { userId: p.id, orgId: p.org_id, isAdmin: truthyAdmin || adminRole };
}

function entrataRpcBody(methodName, params, pageNo, perPage, version) {
  const method = { name: methodName, params: params || {} };
  if (version) method.version = version;
  const envelope = {
    auth: { type: "apikey" },
    requestId: Math.floor(Math.random() * 1_000_000),
    method,
  };
  if (typeof pageNo === "number") envelope.page_no = pageNo;
  if (typeof perPage === "number") envelope.per_page = perPage;
  return envelope;
}

function readRateLimitHeaders(res) {
  return {
    minute_remaining: res.headers.get("X-RateLimit-Minute-Remaining"),
    hour_remaining: res.headers.get("X-RateLimit-Hour-Remaining"),
    day_remaining: res.headers.get("X-RateLimit-Day-Remaining"),
  };
}

function keyIsPii(key) {
  const k = String(key).toLowerCase();
  for (const token of PII_KEY_DENYLIST) {
    if (k.includes(token)) return true;
  }
  return false;
}

function scrubPii(value, depth = 0) {
  if (depth > 12) return "<truncated-depth>";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => scrubPii(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (keyIsPii(k)) {
        out[k] = v === null || v === undefined || v === "" ? v : "<scrubbed>";
      } else {
        out[k] = scrubPii(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function inventoryFields(result, maxKeys = MAX_FIELD_KEYS) {
  const out = [];
  if (result == null || typeof result !== "object") {
    return [{ path: "$", type: result === null ? "null" : typeof result }];
  }
  const visit = (node, prefix, depth) => {
    if (out.length >= maxKeys) return;
    if (node == null) {
      out.push({ path: prefix, type: "null" });
      return;
    }
    if (Array.isArray(node)) {
      out.push({ path: prefix, type: "array", length: node.length });
      if (depth < 2 && node.length) visit(node[0], `${prefix}[0]`, depth + 1);
      return;
    }
    if (typeof node !== "object") {
      out.push({ path: prefix, type: typeof node });
      return;
    }
    out.push({
      path: prefix,
      type: "object",
      keys: Object.keys(node).slice(0, 20),
    });
    if (depth < 2) {
      for (const k of Object.keys(node).slice(0, 30)) {
        if (out.length >= maxKeys) break;
        visit(node[k], `${prefix}.${k}`, depth + 1);
      }
    }
  };
  visit(result, "$", 0);
  return out;
}

function trimToBytes(value, maxBytes) {
  const json = JSON.stringify(value);
  if (json.length <= maxBytes) return value;
  return {
    truncated: true,
    original_bytes: json.length,
    sample: json.slice(0, maxBytes - 200),
  };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
    maxBodyBytes: 50_000,
  });
  if (gate.error) return gate.error;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return jsonResponse(500, { error: "Server not configured" });
  }

  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!userJwt) return jsonResponse(401, { error: "Missing JWT" });

  const profile = await resolveAdminProfile(userJwt);
  if (!profile) return jsonResponse(401, { error: "Profile not found" });
  if (!profile.isAdmin)
    return jsonResponse(403, { error: "Admin required for discovery calls" });

  let parsed;
  try {
    parsed = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const propertyId = String(parsed.property_id || "").trim();
  const vendorMethod = String(parsed.vendor_method || "").trim();
  const gatewayPath = String(parsed.gateway_path_template || "").trim();
  const methodVersion =
    parsed.method_version != null ? String(parsed.method_version).trim() : "";
  const endpointName = String(parsed.endpoint_name || "unknown").slice(0, 64);
  const params =
    parsed.params &&
    typeof parsed.params === "object" &&
    !Array.isArray(parsed.params)
      ? parsed.params
      : {};
  const pageNo = Number.isInteger(parsed.page_no) ? parsed.page_no : undefined;
  const perPage = Number.isInteger(parsed.per_page)
    ? parsed.per_page
    : undefined;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      propertyId,
    )
  ) {
    return jsonResponse(400, { error: "property_id (UUID) required" });
  }
  if (!VENDOR_METHOD_RE.test(vendorMethod)) {
    return jsonResponse(400, {
      error: "vendor_method must be a camelCase identifier (3-64 chars)",
    });
  }
  if (!ALLOWED_GATEWAY_PATHS.has(gatewayPath)) {
    return jsonResponse(400, {
      error: `gateway_path_template not in allowlist (got: ${gatewayPath})`,
    });
  }
  if (methodVersion && !METHOD_VERSION_RE.test(methodVersion)) {
    return jsonResponse(400, {
      error: "method_version must match r<digits> (e.g. r1, r2)",
    });
  }

  const propRes = await pgUser(
    `/properties?id=eq.${propertyId}&select=id,org_id,entrata_property_id&limit=1`,
    userJwt,
  );
  if (!propRes.ok)
    return jsonResponse(propRes.status, { error: "Property fetch failed" });
  const propRows = await propRes.json().catch(() => null);
  if (!Array.isArray(propRows) || !propRows.length) {
    return jsonResponse(404, { error: "Property not found or not accessible" });
  }
  const property = propRows[0];

  if (property.org_id !== profile.orgId) {
    return jsonResponse(403, { error: "Property does not belong to your org" });
  }
  if (!property.entrata_property_id) {
    return jsonResponse(409, {
      error:
        "Property is not mapped to Entrata. Set entrata_property_id on the property first.",
    });
  }
  const entrataPropertyId = property.entrata_property_id;

  const acctRes = await pgServiceRole(
    `/org_entrata_accounts?org_id=eq.${property.org_id}&select=id,subdomain,region,api_key_encrypted&limit=1`,
  );
  if (!acctRes.ok)
    return jsonResponse(500, { error: "Entrata account fetch failed" });
  const acctRows = await acctRes.json().catch(() => null);
  if (
    !Array.isArray(acctRows) ||
    !acctRows.length ||
    !acctRows[0].api_key_encrypted
  ) {
    return jsonResponse(409, {
      error: "No Entrata account connected for this org.",
    });
  }
  const acct = acctRows[0];

  const decRes = await pgServiceRole("/rpc/entrata_decrypt_api_key", {
    method: "POST",
    body: { p_ciphertext: acct.api_key_encrypted },
  });
  if (!decRes.ok)
    return jsonResponse(500, { error: "Credential decrypt failed" });
  const decTxt = await decRes.text();
  let apiKey = null;
  try {
    apiKey = JSON.parse(decTxt);
  } catch {
    apiKey = decTxt;
  }
  apiKey = typeof apiKey === "string" ? apiKey.replace(/^"|"$/g, "") : null;
  if (!apiKey)
    return jsonResponse(500, {
      error: "Credential decrypt produced empty key",
    });

  const baseUrl = ENTRATA_BASE[acct.region === "eu" ? "eu" : "us"];

  const resolvedParams = JSON.parse(
    JSON.stringify(params).replace(
      /\$\{entrata_property_id\}/g,
      String(entrataPropertyId),
    ),
  );

  const url = `${baseUrl}/${encodeURIComponent(acct.subdomain)}${gatewayPath}`;
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENTRATA_CALL_TIMEOUT_MS);

  let entrataRes, text, duration;
  try {
    entrataRes = await fetch(url, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(
        entrataRpcBody(
          vendorMethod,
          resolvedParams,
          pageNo,
          perPage,
          methodVersion,
        ),
      ),
      signal: controller.signal,
    });
    text = await entrataRes.text();
    duration = Date.now() - t0;
  } catch (err) {
    clearTimeout(timer);
    const msg =
      err?.name === "AbortError"
        ? "Entrata call timed out"
        : err?.message || String(err);
    console.error("[entrata-discovery-call] fetch failed:", endpointName, msg);
    return jsonResponse(502, {
      ok: false,
      endpoint_name: endpointName,
      vendor_method: vendorMethod,
      gateway_path: gatewayPath,
      duration_ms: Date.now() - t0,
      error: msg,
    });
  }
  clearTimeout(timer);

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}

  const rateLimit = readRateLimitHeaders(entrataRes);
  const result = body?.response?.result ?? null;
  const scrubbed = scrubPii(result);
  const excerpt = trimToBytes(scrubbed, MAX_EXCERPT_BYTES);
  const fieldInventory = inventoryFields(result);

  if (!entrataRes.ok) {
    console.warn(
      "[entrata-discovery-call] upstream non-2xx:",
      endpointName,
      entrataRes.status,
    );
    return jsonResponse(200, {
      ok: false,
      endpoint_name: endpointName,
      vendor_method: vendorMethod,
      gateway_path: gatewayPath,
      http_status: entrataRes.status,
      duration_ms: duration,
      rate_limit: rateLimit,
      error:
        body?.response?.error?.message ||
        body?.error ||
        text.slice(0, 300) ||
        `HTTP ${entrataRes.status}`,
      response_excerpt: excerpt,
      field_inventory: fieldInventory,
    });
  }

  return jsonResponse(200, {
    ok: true,
    endpoint_name: endpointName,
    vendor_method: vendorMethod,
    gateway_path: gatewayPath,
    http_status: entrataRes.status,
    duration_ms: duration,
    rate_limit: rateLimit,
    response_excerpt: excerpt,
    field_inventory: fieldInventory,
  });
};

export { scrubPii, keyIsPii };
