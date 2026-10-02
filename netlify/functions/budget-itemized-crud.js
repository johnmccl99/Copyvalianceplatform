import { applySecurity, jsonResponse } from "./_security.js";
import {
  ITEMIZED_CATEGORIES,
  FREQUENCY_VALUES,
  INCREASE_FREQUENCY_VALUES,
  frequencyMonths,
} from "./_budget-workbook-parser.js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const CATEGORY_SET = new Set(ITEMIZED_CATEGORIES);

const WRITE_ROLES = new Set(["admin", "gp"]);

const MAX_ROWS_PER_CALL = 1000;
const UPDATE_MANY_ID_CHUNK = 100;
const TEXT_MAX = 2000;
const GROWTH_MIN = -100;
const GROWTH_MAX = 1000;

const FIELD_TYPES = {
  line_description: "text",
  data_source: "text",
  reference: "text",
  frequency: "frequency",
  first_month: "date",
  amount: "number",
  last_month: "date",
  adjustments: "number",
  function_2: "text",
  growth: "growth",
  active_beds_pct: "number",
  category_label: "text",
  account_number: "text",
  noi_build_bucket: "text",
  increase_frequency: "increaseFrequency",
  increase_interval_months: "integer",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s) {
  return typeof s === "string" && UUID_RE.test(s);
}

async function pg(
  path,
  {
    bearer,
    method = "GET",
    body = null,
    prefer = null,
    schema = "public",
  } = {},
) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (schema && schema !== "public") {
    if (method === "GET") headers["Accept-Profile"] = schema;
    else headers["Content-Profile"] = schema;
  }
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

async function resolveProfile(userJwt, authId) {
  const r = await pg(
    `/user_profiles?auth_id=eq.${encodeURIComponent(authId)}&select=org_id,is_admin,role&limit=1`,
    { bearer: userJwt },
  );
  if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) return null;
  const p = r.body[0];
  return {
    orgId: p.org_id,
    role: String(p.role || "").toLowerCase(),
    isAdmin: p.is_admin === true || p.is_admin === "t" || p.is_admin === 1,
  };
}

export function planUpdateMany(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: "ids must be a non-empty array" };
  }
  if (ids.length > MAX_ROWS_PER_CALL) {
    return {
      ok: false,
      error: `Too many ids in one call (max ${MAX_ROWS_PER_CALL})`,
    };
  }
  const clean = [];
  for (const raw of ids) {
    const s = String(raw || "");
    if (!isUuid(s)) return { ok: false, error: "every id must be a UUID" };
    clean.push(s);
  }
  const unique = [...new Set(clean)];
  const chunks = [];
  for (let i = 0; i < unique.length; i += UPDATE_MANY_ID_CHUNK) {
    chunks.push(unique.slice(i, i + UPDATE_MANY_ID_CHUNK));
  }
  return { ok: true, unique, chunks };
}

export function buildNumericBulkPayload(rawField, rawChanges) {
  const field = String(rawField || "");
  if (field !== "amount" && field !== "growth") {
    return { ok: false, error: "field must be 'amount' or 'growth'" };
  }
  const changes = Array.isArray(rawChanges) ? rawChanges : null;
  if (!changes || changes.length === 0) {
    return { ok: false, error: "changes must be a non-empty array" };
  }
  if (changes.length > MAX_ROWS_PER_CALL) {
    return {
      ok: false,
      error: `Too many rows in one call (max ${MAX_ROWS_PER_CALL})`,
    };
  }
  const payload = [];
  for (const c of changes) {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      return { ok: false, error: "each change must be an object" };
    }
    const cid = String(c.id || "");
    if (!isUuid(cid))
      return { ok: false, error: "every change id must be a UUID" };
    if (
      c.new_value === "" ||
      c.new_value === null ||
      c.new_value === undefined
    ) {
      return { ok: false, error: "every new_value must be a number" };
    }
    const nv = Number(c.new_value);
    if (!Number.isFinite(nv))
      return { ok: false, error: "every new_value must be a number" };
    if (field === "growth" && (nv < GROWTH_MIN || nv > GROWTH_MAX)) {
      return {
        ok: false,
        error: `growth must be between ${GROWTH_MIN} and ${GROWTH_MAX}`,
      };
    }
    const el = { id: cid, new_value: nv };
    if (c.expected !== undefined && c.expected !== null && c.expected !== "") {
      const ev = Number(c.expected);
      if (!Number.isFinite(ev))
        return { ok: false, error: "expected must be a number when present" };
      el.expected = ev;
    }
    payload.push(el);
  }
  return { ok: true, field, payload };
}

export function monthGuardFilter(row) {
  if (!row || typeof row !== "object") return "";
  const hasFirst = row.first_month !== undefined;
  const hasLast = row.last_month !== undefined;
  if (hasFirst === hasLast) return "";
  if (hasFirst) {
    if (row.first_month === null) return "";
    return `&or=(last_month.is.null,last_month.gte.${encodeURIComponent(row.first_month)})`;
  }
  if (row.last_month === null) return "";
  return `&or=(first_month.is.null,first_month.lte.${encodeURIComponent(row.last_month)})`;
}

export const EDIT_NOTE_REQUIRED_ERROR =
  "A note explaining this change is required.";
export function resolveEditNote(body) {
  if (!body || body.note === undefined)
    return { ok: true, note: null, given: false };
  const raw = body.note;
  if (raw === null || typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: EDIT_NOTE_REQUIRED_ERROR };
  }
  return { ok: true, note: raw.trim().slice(0, TEXT_MAX), given: true };
}

export function canWrite(profile) {
  return !!profile && (profile.isAdmin || WRITE_ROLES.has(profile.role));
}

function coerceText(v) {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim().slice(0, TEXT_MAX) || null;
}
function coerceNumber(v) {
  if (v === null || v === undefined || v === "")
    return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}
function coerceDate(v) {
  if (v === null || v === undefined || v === "")
    return { ok: true, value: null };
  const m = String(v)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { ok: false };
  return { ok: true, value: `${m[1]}-${m[2]}-${m[3]}` };
}

export function buildRow(input) {
  const errors = [];
  const row = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, row, errors: ["row must be an object"] };
  }
  for (const [field, type] of Object.entries(FIELD_TYPES)) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (type === "text") {
      row[field] = coerceText(raw);
    } else if (type === "number") {
      const c = coerceNumber(raw);
      if (!c.ok) {
        errors.push(`${field} must be a number`);
        continue;
      }
      row[field] = c.value;
    } else if (type === "growth") {
      const c = coerceNumber(raw);
      if (!c.ok) {
        errors.push("growth must be a number");
        continue;
      }
      if (c.value !== null && (c.value < GROWTH_MIN || c.value > GROWTH_MAX)) {
        errors.push(`growth must be between ${GROWTH_MIN} and ${GROWTH_MAX}`);
        continue;
      }
      row[field] = c.value;
    } else if (type === "date") {
      const c = coerceDate(raw);
      if (!c.ok) {
        errors.push(`${field} must be a YYYY-MM-DD date`);
        continue;
      }
      row[field] = c.value;
    } else if (type === "integer") {
      const c = coerceNumber(raw);
      if (!c.ok) {
        errors.push(`${field} must be a number`);
        continue;
      }
      if (c.value !== null && !Number.isInteger(c.value)) {
        errors.push(`${field} must be a whole number`);
        continue;
      }
      row[field] = c.value;
    } else if (type === "increaseFrequency") {
      if (raw === null || raw === undefined || raw === "") {
        row[field] = null;
      } else if (INCREASE_FREQUENCY_VALUES.has(String(raw))) {
        row[field] = String(raw);
      } else {
        errors.push(
          `increase_frequency must be one of: ${[...INCREASE_FREQUENCY_VALUES].join(", ")}`,
        );
      }
    } else if (type === "frequency") {
      if (raw === null || raw === undefined || raw === "") {
        row[field] = null;
      } else if (FREQUENCY_VALUES.has(String(raw))) {
        row[field] = String(raw);
      } else {
        errors.push(
          `frequency must be one of: ${[...FREQUENCY_VALUES].join(", ")}`,
        );
      }
    }
  }
  if (row.first_month && row.last_month && row.last_month < row.first_month) {
    errors.push("last_month must be on or after first_month");
  }

  if (
    row.increase_frequency === "Custom" &&
    row.increase_interval_months == null
  ) {
    errors.push(
      "increase_interval_months is required when increase_frequency is Custom",
    );
  }
  if (
    row.increase_frequency &&
    row.increase_frequency !== "Custom" &&
    row.increase_interval_months != null
  ) {
    errors.push(
      "increase_interval_months is only valid when increase_frequency is Custom",
    );
  }
  if (
    row.increase_interval_months != null &&
    (row.increase_interval_months < 1 || row.increase_interval_months > 120)
  ) {
    errors.push("increase_interval_months must be between 1 and 120");
  }

  if (row.increase_frequency && row.frequency) {
    const im = frequencyMonths(
      row.increase_frequency,
      row.increase_interval_months,
    );
    const lineM = frequencyMonths(row.frequency);
    if (im !== null && lineM !== null && im < lineM) {
      errors.push(
        `increase_frequency cannot apply more often than the line's ${row.frequency} frequency`,
      );
    }
  }
  return { ok: errors.length === 0, row, errors };
}

async function writeAudit({
  userJwt,
  orgId,
  authId,
  userEmail,
  role,
  op,
  resourceId,
  metadata,
}) {
  try {
    const r = await pg("/audit_log", {
      bearer: userJwt,
      method: "POST",
      prefer: "return=minimal",
      body: {
        org_id: orgId,
        user_id: authId,
        user_email: userEmail || null,
        action: `budget.itemized.${op}`,
        resource_type: "raw.itemized",
        resource_id: resourceId,
        outcome: "success",
        metadata: { actor_role: role || null, ...(metadata || {}) },
      },
    });
    if (!r.ok) {
      console.error(
        "[budget-itemized-crud] audit_log insert failed",
        r.status,
        (r.raw || "").slice(0, 200),
      );
    }
  } catch (e) {
    console.error(
      "[budget-itemized-crud] audit_log insert threw",
      e?.message || e,
    );
  }
}

async function firePortfolioCacheRefresh(userJwt) {
  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "";
  if (!base) return;
  try {
    await fetch(
      `${base}/.netlify/functions/portfolio-budget-cache-refresh-background`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userJwt}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
  } catch (e) {
    console.error(
      "[budget-itemized-crud] portfolio cache refresh fire failed",
      e?.message || e,
    );
  }
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    maxBodyBytes: 1_000_000,
    rateLimit: { maxPerMinute: 60 },
  });
  if (gate.error) return gate.error;

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error("[budget-itemized-crud] missing SUPABASE_URL / ANON_KEY env");
    return jsonResponse(500, { error: "Server not configured" });
  }

  try {
    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const authId = gate.user?.id;
    const userEmail = gate.user?.email || null;
    if (!userJwt || !authId)
      return jsonResponse(401, { error: "Authentication required" });

    const profile = await resolveProfile(userJwt, authId);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (!canWrite(profile)) {
      return jsonResponse(403, {
        error:
          "Budget editing is restricted to the admin, asset-manager, and GP roles",
      });
    }

    const body = gate.body || {};
    const op = body.op;
    if (
      op !== "insert" &&
      op !== "update" &&
      op !== "update_many" &&
      op !== "apply_numeric_bulk" &&
      op !== "delete"
    ) {
      return jsonResponse(400, {
        error:
          "op must be 'insert', 'update', 'update_many', 'apply_numeric_bulk', or 'delete'",
      });
    }

    const noteCheck = resolveEditNote(body);
    if (!noteCheck.ok) return jsonResponse(400, { error: noteCheck.error });
    const editNote = noteCheck.note;

    if (op === "insert") {
      const propertyCode = coerceText(body.property_code);
      const category = String(body.category || "");
      if (!propertyCode)
        return jsonResponse(400, { error: "property_code is required" });
      if (!CATEGORY_SET.has(category)) {
        return jsonResponse(400, {
          error: `Unknown category: ${category || "(empty)"}`,
        });
      }
      const inputRows = Array.isArray(body.rows) ? body.rows : null;
      if (!inputRows || inputRows.length === 0) {
        return jsonResponse(400, {
          error: "rows (a non-empty array) is required",
        });
      }
      if (inputRows.length > MAX_ROWS_PER_CALL) {
        return jsonResponse(400, {
          error: `Too many rows in one call (max ${MAX_ROWS_PER_CALL})`,
        });
      }
      const built = [];
      for (let i = 0; i < inputRows.length; i++) {
        const v = buildRow(inputRows[i]);
        if (!v.ok)
          return jsonResponse(400, {
            error: `Row ${i + 1}: ${v.errors.join("; ")}`,
          });
        built.push({
          ...v.row,
          org_id: profile.orgId,
          property_code: propertyCode,
          category,
          origin: "editor",
          edit_note: editNote,
          created_by: authId,
          updated_by: authId,
        });
      }
      const ins = await pg("/itemized", {
        bearer: userJwt,
        method: "POST",
        body: built,
        prefer: "return=representation",
        schema: "raw",
      });
      if (!ins.ok) {
        console.error(
          "[budget-itemized-crud] insert failed",
          ins.status,
          (ins.raw || "").slice(0, 300),
        );
        return jsonResponse(
          ins.status === 401 || ins.status === 403 ? 403 : 400,
          { error: "Insert was rejected by the database" },
        );
      }
      const rows = Array.isArray(ins.body) ? ins.body : [];
      await writeAudit({
        userJwt,
        orgId: profile.orgId,
        authId,
        userEmail,
        role: profile.role,
        op: "insert",
        resourceId: null,
        metadata: { property_code: propertyCode, category, count: rows.length },
      });
      await firePortfolioCacheRefresh(userJwt);
      return jsonResponse(200, { ok: true, op: "insert", rows });
    }

    if (op === "update") {
      const id = String(body.id || "");
      if (!isUuid(id))
        return jsonResponse(400, { error: "a valid id (UUID) is required" });
      const v = buildRow(body.patch || {});
      if (!v.ok) return jsonResponse(400, { error: v.errors.join("; ") });
      if (Object.keys(v.row).length === 0) {
        return jsonResponse(400, {
          error: "patch contains no editable fields",
        });
      }
      const patch = {
        ...v.row,
        origin: "editor",
        edit_note: editNote,
        updated_by: authId,
        updated_at: new Date().toISOString(),
      };
      const upd = await pg(`/itemized?id=eq.${encodeURIComponent(id)}`, {
        bearer: userJwt,
        method: "PATCH",
        body: patch,
        prefer: "return=representation",
        schema: "raw",
      });
      if (!upd.ok) {
        console.error(
          "[budget-itemized-crud] update failed",
          upd.status,
          (upd.raw || "").slice(0, 300),
        );
        return jsonResponse(
          upd.status === 401 || upd.status === 403 ? 403 : 400,
          { error: "Update was rejected by the database" },
        );
      }
      const rows = Array.isArray(upd.body) ? upd.body : [];
      if (rows.length === 0) {
        return jsonResponse(404, {
          error: "Itemized line not found in your organization",
        });
      }
      await writeAudit({
        userJwt,
        orgId: profile.orgId,
        authId,
        userEmail,
        role: profile.role,
        op: "update",
        resourceId: id,
        metadata: { fields: Object.keys(v.row) },
      });
      await firePortfolioCacheRefresh(userJwt);
      return jsonResponse(200, { ok: true, op: "update", rows });
    }

    if (op === "update_many") {
      const plan = planUpdateMany(body.ids);
      if (!plan.ok) return jsonResponse(400, { error: plan.error });
      const unique = plan.unique;

      const v = buildRow(body.patch || {});
      if (!v.ok) return jsonResponse(400, { error: v.errors.join("; ") });
      if (Object.keys(v.row).length === 0) {
        return jsonResponse(400, {
          error: "patch contains no editable fields",
        });
      }
      const patch = {
        ...v.row,
        origin: "editor",
        edit_note: editNote,
        updated_by: authId,
        updated_at: new Date().toISOString(),
      };

      const guard = monthGuardFilter(v.row);

      const updatedRows = [];
      for (const chunk of plan.chunks) {
        const filter = chunk.map((x) => encodeURIComponent(x)).join(",");
        const upd = await pg(`/itemized?id=in.(${filter})${guard}`, {
          bearer: userJwt,
          method: "PATCH",
          body: patch,
          prefer: "return=representation",
          schema: "raw",
        });
        if (!upd.ok) {
          console.error(
            "[budget-itemized-crud] update_many failed",
            upd.status,
            (upd.raw || "").slice(0, 300),
          );
          if (updatedRows.length > 0) {
            await writeAudit({
              userJwt,
              orgId: profile.orgId,
              authId,
              userEmail,
              role: profile.role,
              op: "update_many",
              resourceId: null,
              metadata: {
                fields: Object.keys(v.row),
                requested: unique.length,
                updated: updatedRows.length,
                partial: true,
              },
            });
            await firePortfolioCacheRefresh(userJwt);
          }
          return jsonResponse(
            upd.status === 401 || upd.status === 403 ? 403 : 400,
            {
              error:
                updatedRows.length > 0
                  ? `Partially applied: ${updatedRows.length} of ${unique.length} lines were updated before the database rejected the rest. Re-running the same change will finish it.`
                  : "Update was rejected by the database",
              updated: updatedRows.length,
              requested: unique.length,
            },
          );
        }
        if (Array.isArray(upd.body)) updatedRows.push(...upd.body);
      }

      await writeAudit({
        userJwt,
        orgId: profile.orgId,
        authId,
        userEmail,
        role: profile.role,
        op: "update_many",
        resourceId: null,
        metadata: {
          fields: Object.keys(v.row),
          requested: unique.length,
          updated: updatedRows.length,
        },
      });
      await firePortfolioCacheRefresh(userJwt);
      return jsonResponse(200, {
        ok: true,
        op: "update_many",
        requested: unique.length,
        updated: updatedRows.length,
        rows: updatedRows,
      });
    }

    if (op === "apply_numeric_bulk") {
      const built = buildNumericBulkPayload(body.field, body.changes);
      if (!built.ok) return jsonResponse(400, { error: built.error });
      const { field, payload } = built;

      const rpc = await pg("/rpc/budget_itemized_apply_numeric_bulk", {
        bearer: userJwt,
        method: "POST",
        body: { p_field: field, p_changes: payload, p_note: editNote },
        schema: "public",
      });
      if (!rpc.ok) {
        console.error(
          "[budget-itemized-crud] apply_numeric_bulk failed",
          rpc.status,
          (rpc.raw || "").slice(0, 300),
        );
        return jsonResponse(
          rpc.status === 401 || rpc.status === 403 ? 403 : 400,
          {
            error:
              "The change was rejected and nothing was written. No lines were modified.",
          },
        );
      }
      const result = rpc.body || {};
      await writeAudit({
        userJwt,
        orgId: profile.orgId,
        authId,
        userEmail,
        role: profile.role,
        op: "apply_numeric_bulk",
        resourceId: null,
        metadata: {
          field,
          requested: result.requested,
          updated: result.updated,
          skipped: result.skipped,
          missing: result.missing,
          unchanged: result.unchanged,
        },
      });
      await firePortfolioCacheRefresh(userJwt);
      return jsonResponse(200, {
        ok: true,
        op: "apply_numeric_bulk",
        ...result,
      });
    }

    const id = String(body.id || "");
    if (!isUuid(id))
      return jsonResponse(400, { error: "a valid id (UUID) is required" });
    const del = await pg("/rpc/budget_itemized_delete_line", {
      bearer: userJwt,
      method: "POST",
      body: { p_id: id, p_note: editNote },
      schema: "public",
    });
    if (!del.ok) {
      console.error(
        "[budget-itemized-crud] delete failed",
        del.status,
        (del.raw || "").slice(0, 300),
      );
      return jsonResponse(
        del.status === 401 || del.status === 403 ? 403 : 400,
        { error: "Delete was rejected by the database" },
      );
    }
    const deleted = del.body && typeof del.body === "object" ? del.body : {};
    if (!deleted.deleted) {
      return jsonResponse(404, {
        error: "Itemized line not found in your organization",
      });
    }
    await writeAudit({
      userJwt,
      orgId: profile.orgId,
      authId,
      userEmail,
      role: profile.role,
      op: "delete",
      resourceId: id,
      metadata: {
        property_code: deleted.property_code,
        category: deleted.category,
      },
    });
    await firePortfolioCacheRefresh(userJwt);
    return jsonResponse(200, { ok: true, op: "delete", id });
  } catch (e) {
    console.error("[budget-itemized-crud] unhandled error", e);
    return jsonResponse(500, { error: "Internal error" });
  }
};
