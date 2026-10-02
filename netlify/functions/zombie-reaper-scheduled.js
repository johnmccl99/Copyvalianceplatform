import { isNetlifyScheduledEvent } from "./_scheduled-guard.js";
export { isNetlifyScheduledEvent };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ZOMBIE_AGE_MIN = 20;

const MAX_ROWS_PER_TABLE = 100;

export const REAPER_TARGETS = [
  {
    table: "underwriting_discovery_runs",
    cutoffCol: "updated_at",
    hasErrorStage: true,
  },
  {
    table: "property_underwriting_recompute_jobs",
    cutoffCol: "started_at",
    hasErrorStage: false,
  },
  {
    table: "property_underwriting_formula_audit_runs",
    cutoffCol: "updated_at",
    hasErrorStage: false,
  },
  {
    table: "property_underwriting_formula_audit_chunks",
    cutoffCol: "updated_at",
    hasErrorStage: false,
  },
  {
    table: "connector_sync_runs",
    cutoffCol: "started_at",
    hasErrorStage: false,
  },
  {
    table: "budget_workbook_parse_runs",
    cutoffCol: "started_at",
    hasErrorStage: false,
    schema: "raw",
    registryTable: "budget_workbook_file_registry",
    registryFkCol: "file_id",
  },
  {
    table: "reference_workbook_parse_runs",
    cutoffCol: "started_at",
    hasErrorStage: false,
    schema: "raw",
    registryTable: "reference_workbook_file_registry",
    registryFkCol: "file_id",
  },
];

async function pg(path, init = {}) {
  const { schema, ...rest } = init;
  const method = (rest.method || "GET").toUpperCase();
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=representation",
    ...(rest.headers || {}),
  };
  if (schema) {
    if (method === "GET" || method === "HEAD") {
      headers["Accept-Profile"] = schema;
    } else {
      headers["Content-Profile"] = schema;
    }
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...rest,
    headers,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body, raw: text };
}

export function buildReapedErrorMessage(
  existing,
  nowIso,
  thresholdMin = ZOMBIE_AGE_MIN,
) {
  const prior =
    typeof existing === "string" && existing.length > 0 ? existing : "";
  const sep = prior ? " | " : "";
  return (
    prior +
    sep +
    "reaped by zombie-reaper-scheduled at " +
    nowIso +
    " (status was running with no progress for > " +
    thresholdMin +
    " minutes;" +
    " Netlify Background Function cap is 15min)"
  );
}

export async function reapTable(
  target,
  { nowMs = Date.now(), pgClient = pg } = {},
) {
  const cutoffIso = new Date(nowMs - ZOMBIE_AGE_MIN * 60_000).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const fkCol = target.registryFkCol || "file_id";
  const selectColsArr = [
    "id",
    "error_message",
    "completed_at",
    target.cutoffCol,
  ];
  if (target.registryTable) selectColsArr.push(fkCol);
  const selectCols = selectColsArr.join(",");

  const selectPath =
    `/${target.table}` +
    `?status=eq.running` +
    `&${target.cutoffCol}=lt.${encodeURIComponent(cutoffIso)}` +
    `&select=${selectCols}` +
    `&limit=${MAX_ROWS_PER_TABLE}`;
  const selectRes = await pgClient(selectPath, {
    method: "GET",
    schema: target.schema,
  });
  if (!selectRes.ok) {
    console.error(
      `[zombie-reaper-scheduled] ${target.table} select failed`,
      selectRes.status,
    );
    return {
      table: target.table,
      scanned: 0,
      reaped: 0,
      errors: 1,
      registryFlipped: 0,
    };
  }
  const rows = Array.isArray(selectRes.body) ? selectRes.body : [];
  if (rows.length === 0) {
    return {
      table: target.table,
      scanned: 0,
      reaped: 0,
      errors: 0,
      registryFlipped: 0,
    };
  }

  let reaped = 0;
  let errors = 0;
  let registryFlipped = 0;
  for (const row of rows) {
    const newErrorMessage = buildReapedErrorMessage(row.error_message, nowIso);
    const completedAtFallback =
      row.completed_at || row[target.cutoffCol] || nowIso;
    const patchBody = {
      status: "error",
      completed_at: completedAtFallback,
      error_message: newErrorMessage,
    };
    if (target.hasErrorStage) {
      patchBody.error_stage = "zombie_reaped";
    }
    const patchPath =
      `/${target.table}` +
      `?id=eq.${encodeURIComponent(row.id)}` +
      `&status=eq.running` +
      `&select=id`;
    const patchRes = await pgClient(patchPath, {
      method: "PATCH",
      schema: target.schema,
      body: JSON.stringify(patchBody),
    });
    if (!patchRes.ok) {
      console.error(
        `[zombie-reaper-scheduled] ${target.table} patch failed`,
        patchRes.status,
      );
      errors += 1;
      continue;
    }
    const updated = Array.isArray(patchRes.body) ? patchRes.body.length : 0;
    reaped += updated;

    if (updated > 0 && target.registryTable && row[fkCol]) {
      const registryPatchPath =
        `/${target.registryTable}` +
        `?id=eq.${encodeURIComponent(row[fkCol])}` +
        `&last_parse_status=eq.running` +
        `&select=id`;
      const registryPatchRes = await pgClient(registryPatchPath, {
        method: "PATCH",
        schema: target.schema,
        body: JSON.stringify({
          last_parse_status: "error",
          last_parse_error: newErrorMessage,
          updated_at: nowIso,
        }),
      });
      if (!registryPatchRes.ok) {
        console.error(
          `[zombie-reaper-scheduled] ${target.registryTable} registry patch failed`,
          registryPatchRes.status,
        );
        errors += 1;
        continue;
      }
      const flipped = Array.isArray(registryPatchRes.body)
        ? registryPatchRes.body.length
        : 0;
      registryFlipped += flipped;
    }
  }

  return {
    table: target.table,
    scanned: rows.length,
    reaped,
    errors,
    registryFlipped,
  };
}

export const handler = async (event) => {
  const manualSecret = process.env.SCHEDULED_RUN_SECRET || "";
  const provided = event?.headers?.["x-scheduled-secret"] || "";
  const isScheduled = isNetlifyScheduledEvent(event);
  const isAuthorizedManual = manualSecret && provided === manualSecret;
  if (!isScheduled && !isAuthorizedManual) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Scheduled invocation only" }),
    };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[zombie-reaper-scheduled] env not configured");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Not configured" }),
    };
  }

  const startedAt = new Date().toISOString();
  const perTable = [];
  let total = 0;

  for (const target of REAPER_TARGETS) {
    try {
      const r = await reapTable(target);
      perTable.push(r);
      total += r.reaped;
    } catch (e) {
      console.error(
        `[zombie-reaper-scheduled] ${target.table} threw`,
        e?.message || e,
      );
      perTable.push({ table: target.table, scanned: 0, reaped: 0, errors: 1 });
    }
  }

  const summary = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    threshold_minutes: ZOMBIE_AGE_MIN,
    per_table: perTable,
    total_reaped: total,
  };
  console.log("[zombie-reaper-scheduled]", JSON.stringify(summary));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  };
};
