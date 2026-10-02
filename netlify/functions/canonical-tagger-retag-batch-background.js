import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const CANONICAL_KEYS = [
  "terminal_cap_rate",
  "going_in_cap_rate_y1",
  "equity_multiple_levered",
  "noi_t12",
  "noi_y1",
  "noi_stabilized",
  "noi_peak",
];

const CANONICAL_REFERENCE_ROLE = new Set([
  "equity_multiple_levered",
  "going_in_cap_rate_y1",
  "noi_y1",
  "noi_stabilized",
  "noi_t12",
  "noi_peak",
  "equity_required_total",
]);

const CANONICAL_VALUE_KIND = {
  terminal_cap_rate: "percent",
  going_in_cap_rate_y1: "percent",
  equity_multiple_levered: "multiple",
  noi_t12: "money",
  noi_y1: "money",
  noi_stabilized: "money",
  noi_peak: "money",
  equity_required_total: "money",
};

const CANONICAL_KEY_MATCHERS = {
  terminal_cap_rate: {
    labels: /terminal\s*cap|exit\s*cap|reversion\s*cap|disposition\s*cap/i,
    not_labels: /tax.*adj|display|secondary|header|projection/i,
    prefer_sheets: /assumption|summary|return|exit/i,
  },
  going_in_cap_rate_y1: {
    labels:
      /(going[\s-]?in|year\s*1|yr\s*1|y1).*cap|cap.*(year\s*1|yr\s*1|y1)|cap\s*rate.*y1|pp.*all[\s-]?in.*y1/i,
    not_labels:
      /t[-_\s]?12|year\s*[23]|yr\s*[23]|y[23]|sizing|display|secondary/i,
    prefer_sheets: /summary|return|basis|assumption/i,
  },
  equity_multiple_levered: {
    labels:
      /lev(er)?(ed|aged)?\s*(em|equity\s*multiple|multiple)|(em|equity\s*multiple|multiple)\s*\(?\s*lev(er)?(ed|aged)?/i,
    not_labels:
      /\bun[\s-]?lev|\blp\b|\bgp\b|investor|sponsor|teaser|marketing|summary[\s-]?card/i,
    prefer_sheets: /summary|return/i,
  },
  noi_t12: {
    labels: /noi.*t[-\s_]?12|t[-\s_]?12.*noi|trailing.*noi/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
    prefer_sheets: /noi|financial|budget|historicals|summary/i,
  },
  noi_y1: {
    labels: /noi.*(year\s*1|yr\s*1|y1)|(year\s*1|yr\s*1|y1).*noi/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
    prefer_sheets: /noi|financial|budget|summary|assumption/i,
  },
  noi_stabilized: {
    labels: /stabiliz(ed|ation)\s*noi|noi.*stabiliz/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
    prefer_sheets: /noi|financial|summary|budget/i,
  },
  noi_peak: {
    labels: /peak\s*noi|noi\s*\(?\s*peak/i,
    not_labels: /sizing|display|secondary|header|projection|estimate/i,
    prefer_sheets: /noi|financial|summary/i,
  },
  equity_required_total: {
    labels:
      /(total\s*)?equity\s*(required|investment)|initial\s*equity|total\s*(lp\s*\+\s*gp|partnership)\s*equity/i,
    not_labels:
      /\blp\s*only\b|\bgp\s*only\b|coinvest|common\s*equity\s*(contribution|distribution)|total\s*common\s*equity|per\s*unit|vc\s*structure|average|cash\s*flow|yield|follow[\s-]*on/i,
    prefer_sheets: /^assumption|^returns?\s*summary$|^partner/i,
    not_formula_regex: /\/\s*TOTALUnits/i,
  },
};

const EXCLUDED_SHEET_RE = /^claude\b|\bclaude\s*\(|^cim\s*uw$|\(cim\s*uw\)$/i;
const PRIOR_VERSION_SHEET_RE =
  /\(\s*prior\s*q\s*\)|\(\s*cim\s*uw\s*\)|\(\s*lender\s*\)|\bv2\b|\(\s*v2\s*\)|\bold\b|\bprior\b/i;

const NON_CANONICAL_NOISE_PATTERNS = [
  /^total\s*\/\s*wtd\s*avg$/i,
  /^rental\s*income\s*and\s*unit\s*mix\s*summary$/i,
  /^unit\s*config$/i,
  /^stabilized\s*expense\s*detail(\s*yr\s*1)?$/i,
  /^sponsor\s*accounting$/i,
  /^interest\s*rate\s*hedge\s*comparison$/i,
  /^yield\s*summary$/i,
  /^rent\s*registtry$/i,
  /^rent\s*registry$/i,
  /^ownership\s*assumptions$/i,
  /^acquisitions?\s*assumptions$/i,
  /^pro\s*forma\s*assumptions$/i,
  /^disposition\s*assumptions$/i,
  /^growth\s*rates\s*\(?\s*annual\s*\)?$/i,
  /^operating\s*assumptions$/i,
  /^property\s*tax\s*assumptions$/i,
  /^miscellaneous\s*assumptions$/i,
  /^renewal\s*probability$/i,
  /^unit\s*breakdown\s*[-–]\s*(existing|stabilized)$/i,
];
const ANNOTATION_PATTERNS = [
  /^note\s*\d+\/\d+\/\d+/i,
  /^as\s*of\s+\w+\s+\d+/i,
  /^\w+\s+\d+\s+t\d+$/i,
  /^revised\b/i,
  /^previous\b/i,
  /^delta\b/i,
  /^key:/i,
  /^update\s*made/i,
  /^updated?$/i,
  /^status:/i,
  /^\*+\s*footnote\b/i,
];
const PARTNERSHIP_FLOW_PATTERNS = [
  /^residual\s*cf\s*after\s*hurdle\s*\d+/i,
  /^ending\s*capital\s*after\s*catchup\s*distribution/i,
  /^hurdle\s*\d+\s*distributions?\s*\(/i,
  /^cash\s*flow\s*from\s*operations\s*\(net\s*cash\)/i,
  /^cash\s*flow\s*from\s*financing/i,
  /^total\s*cash\s*flow\s*from\s*operations/i,
  /^cash\s*available\s*for\s*distributions/i,
  /^ending\s*balance/i,
  /^beginning\s*balance/i,
  /^catchup\s+investor\s*[ab]/i,
  /^preferred\s*due\s*to\s*investor\s*[ab]/i,
  /^investor\s*[ab]\s*capital\s*balance/i,
];

export function isNoiseLabel(label) {
  if (!label) return false;
  for (const re of NON_CANONICAL_NOISE_PATTERNS)
    if (re.test(label)) return true;
  for (const re of ANNOTATION_PATTERNS) if (re.test(label)) return true;
  for (const re of PARTNERSHIP_FLOW_PATTERNS) if (re.test(label)) return true;
  return false;
}

function pgServiceRole(
  path,
  { method = "GET", body = null, prefer = null } = {},
) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function pgServiceRoleJson(path, opts) {
  const res = await pgServiceRole(path, opts);
  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }
  return { ok: res.ok, status: res.status, body: parsed, raw };
}

const _rpcImpl = pgServiceRoleJson;

export function scoreCandidate(candidate, key) {
  const matcher = CANONICAL_KEY_MATCHERS[key] || {};
  const kind = CANONICAL_VALUE_KIND[key];
  const isRef = CANONICAL_REFERENCE_ROLE.has(key);

  if (EXCLUDED_SHEET_RE.test(candidate.sheet || "")) {
    return { hardRejected: "excluded_sheet" };
  }
  if (isNoiseLabel(candidate.label_hint)) {
    return { hardRejected: "noise_label" };
  }
  if (isRef && candidate.is_formula !== true) {
    return { hardRejected: "reference_role_not_formula" };
  }
  if (
    typeof candidate.value_num !== "number" ||
    !Number.isFinite(candidate.value_num)
  ) {
    return { hardRejected: "value_num_missing" };
  }
  const label = candidate.label_hint || "";
  const signals = String(candidate.match_signal || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const matchedNonStrict =
    signals.includes("self_label+anchor") ||
    signals.includes("formula_regex") ||
    signals.includes("period_column");
  if (matcher.labels && !matchedNonStrict) {
    if (!matcher.labels.test(label)) {
      return { hardRejected: "label_not_match" };
    }
  }
  if (matcher.not_labels && matcher.not_labels.test(label)) {
    return { hardRejected: "not_labels_match" };
  }
  if (
    matcher.not_formula_regex &&
    candidate.is_formula === true &&
    candidate.formula
  ) {
    if (matcher.not_formula_regex.test(String(candidate.formula))) {
      return { hardRejected: "not_formula_regex_match" };
    }
  }

  let score = 0;
  if (matcher.labels) score += 5;
  if (
    matcher.prefer_sheets &&
    matcher.prefer_sheets.test(candidate.sheet || "")
  )
    score += 3;
  if (candidate.is_formula) score += 1;
  if (PRIOR_VERSION_SHEET_RE.test(candidate.sheet || "")) score -= 4;
  if (kind === "percent" && Math.abs(candidate.value_num) < 0.5) score += 0.5;
  if (kind === "money" && candidate.value_num > 100_000) score += 0.5;
  return { score };
}

function compareForTieBreak(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aFormula = a.candidate.is_formula === true ? 1 : 0;
  const bFormula = b.candidate.is_formula === true ? 1 : 0;
  if (bFormula !== aFormula) return bFormula - aFormula;
  const aCell = String(a.candidate.cell || "");
  const bCell = String(b.candidate.cell || "");
  if (aCell.length !== bCell.length) return aCell.length - bCell.length;
  if (aCell < bCell) return -1;
  if (aCell > bCell) return 1;
  const aId = String(a.candidate.candidate_node_id || "");
  const bId = String(b.candidate.candidate_node_id || "");
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function pickBest(candidates, key) {
  const scored = [];
  for (const c of candidates) {
    const r = scoreCandidate(c, key);
    if (r.hardRejected) continue;
    scored.push({ score: r.score, candidate: c });
  }
  if (scored.length === 0) return null;
  scored.sort(compareForTieBreak);
  return scored[0];
}

function buildDecision({
  graph_id,
  canonical_key,
  pick,
  existing_tag_node_id,
}) {
  if (!pick) {
    return {
      graph_id,
      canonical_key,
      action: "no_candidate",
      old_node_id: existing_tag_node_id || null,
      new_node_id: null,
    };
  }
  const new_node_id = pick.candidate.candidate_node_id;
  if (!existing_tag_node_id) {
    return {
      graph_id,
      canonical_key,
      action: "add_tag",
      old_node_id: null,
      new_node_id,
    };
  }
  if (existing_tag_node_id === new_node_id) {
    return {
      graph_id,
      canonical_key,
      action: "no_change",
      old_node_id: existing_tag_node_id,
      new_node_id,
    };
  }
  return {
    graph_id,
    canonical_key,
    action: "move_tag",
    old_node_id: existing_tag_node_id,
    new_node_id,
  };
}

export function partitionByGraph(rows) {
  const byGraph = new Map();
  for (const row of rows) {
    const gid = row.graph_id;
    if (!gid) continue;
    if (!byGraph.has(gid)) byGraph.set(gid, []);
    byGraph.get(gid).push(row);
  }
  return byGraph;
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    maxBodyBytes: 8192,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  const body = gate.body || {};
  const mode = body.mode;
  if (mode !== "dry-run" && mode !== "apply") {
    return jsonResponse(400, { error: 'mode must be "dry-run" or "apply"' });
  }

  const keys =
    Array.isArray(body.keys) && body.keys.length ? body.keys : CANONICAL_KEYS;
  for (const k of keys) {
    if (typeof k !== "string" || !CANONICAL_KEY_MATCHERS[k]) {
      return jsonResponse(400, {
        error: `unsupported canonical_key: ${k}`,
        detail:
          "Only the 8 supported canonical keys are accepted by this orchestrator.",
      });
    }
  }

  if (mode === "apply") {
    const tok = body.approval_token;
    if (typeof tok !== "string" || !/^[0-9a-f-]{32,36}$/i.test(tok)) {
      return jsonResponse(400, {
        error: "approval_token required for mode=apply",
      });
    }
  }

  let requestedGraphIds = null;
  if (Array.isArray(body.graph_ids) && body.graph_ids.length) {
    requestedGraphIds = body.graph_ids;
    for (const g of requestedGraphIds) {
      if (typeof g !== "string" || !/^[0-9a-f-]{32,36}$/i.test(g)) {
        return jsonResponse(400, { error: `invalid graph_id: ${g}` });
      }
    }
  }

  let jobId = body.job_id;
  if (jobId !== undefined && jobId !== null) {
    if (typeof jobId !== "string" || !/^[0-9a-f-]{32,36}$/i.test(jobId)) {
      return jsonResponse(400, {
        error: "job_id must be a valid UUID string when provided",
      });
    }
  }

  const orgRes = await _rpcImpl(
    `/user_profiles?auth_id=eq.${gate.user.id}&select=org_id&limit=1`,
    { method: "GET" },
  );
  if (!orgRes.ok || !Array.isArray(orgRes.body) || !orgRes.body[0]?.org_id) {
    console.error(
      "canonical-tagger-retag-batch-background: org_id lookup failed",
      orgRes.status,
      orgRes.raw,
    );
    return jsonResponse(502, { error: "failed to resolve user org_id" });
  }
  const orgId = orgRes.body[0].org_id;

  const insertBody = {
    mode,
    keys,
    graph_ids: requestedGraphIds,
    request_body: body,
    org_id: orgId,
    triggered_by: gate.user.id,
    status: "running",
  };
  if (jobId) insertBody.id = jobId;

  const insertRes = await _rpcImpl("/retag_jobs", {
    method: "POST",
    prefer: "return=representation",
    body: [insertBody],
  });
  if (!insertRes.ok || !Array.isArray(insertRes.body) || !insertRes.body[0]) {
    console.error(
      "canonical-tagger-retag-batch-background: retag_jobs insert failed",
      insertRes.status,
      insertRes.raw,
    );
    return jsonResponse(500, {
      error: "failed to create job row",
      detail: insertRes.raw?.slice(0, 200),
    });
  }
  jobId = insertRes.body[0].id;

  try {
    const result = await runRetagBatch({
      mode,
      keys,
      requestedGraphIds,
      body,
      user: gate.user,
    });
    await markJobComplete({ jobId, result });
    return jsonResponse(202, { ok: true, job_id: jobId, status: "complete" });
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 2000);
    console.error(
      "canonical-tagger-retag-batch-background: job",
      jobId,
      "failed:",
      msg,
      e?.stack?.slice(0, 500),
    );
    await markJobError({ jobId, message: msg });
    return jsonResponse(202, {
      ok: true,
      job_id: jobId,
      status: "error",
      error_message: msg,
    });
  }
};

async function markJobComplete({ jobId, result }) {
  const r = await _rpcImpl(`/retag_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      status: "complete",
      result_summary: result,
      completed_at: new Date().toISOString(),
    },
  });
  if (!r.ok) {
    console.warn(
      "canonical-tagger-retag-batch-background: retag_jobs complete-patch failed",
      r.status,
      r.raw?.slice(0, 200),
    );
  }
}

async function markJobError({ jobId, message }) {
  const r = await _rpcImpl(`/retag_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      status: "error",
      error_message: message,
      completed_at: new Date().toISOString(),
    },
  });
  if (!r.ok) {
    console.warn(
      "canonical-tagger-retag-batch-background: retag_jobs error-patch failed",
      r.status,
      r.raw?.slice(0, 200),
    );
  }
}

async function runRetagBatch({ mode, keys, requestedGraphIds, body, user }) {
  const picks = [];
  const decisions = [];
  let wouldChangeCount = 0;
  let skippedNoCandidateCount = 0;
  const seenGraphs = new Set();

  for (const canonical_key of keys) {
    const r = await _rpcImpl("/rpc/retag_value_candidates_label_anchored_v2", {
      method: "POST",
      body: { p_keys: [canonical_key], p_graph_id: null },
    });
    if (!r.ok) {
      console.error(
        "canonical-tagger-retag-batch-background: rpc retag_value_candidates_label_anchored_v2 failed",
        { canonical_key, status: r.status, raw: r.raw },
      );
      throw new Error(
        `candidate emitter RPC failed for key=${canonical_key}: status=${r.status}`,
      );
    }
    const rows = Array.isArray(r.body) ? r.body : [];
    const byGraph = partitionByGraph(rows);

    for (const g of byGraph.keys()) seenGraphs.add(g);

    const graphsForKey = requestedGraphIds
      ? requestedGraphIds.filter((g) => byGraph.has(g) || true)
      : Array.from(byGraph.keys());

    for (const graph_id of graphsForKey) {
      const partition = byGraph.get(graph_id) || [];

      const nodes = partition.map((row) => ({
        candidate_node_id: row.candidate_node_id,
        cell: row.candidate_cell,
        sheet: row.candidate_sheet,
        label_hint: row.candidate_label_hint,
        value_num: row.candidate_value_num,
        value_text: row.candidate_value_text,
        is_formula: row.candidate_is_formula,
        node_kind: row.candidate_node_kind,
        formula: row.candidate_formula,
        match_signal: row.match_signal,
      }));
      const property_id = partition[0]?.property_id || null;
      const existing_tag_node_id = partition[0]?.existing_tag_node_id || null;

      const pick = pickBest(nodes, canonical_key);
      const decision = buildDecision({
        graph_id,
        canonical_key,
        pick,
        existing_tag_node_id,
      });
      decisions.push(decision);

      let existing = null;
      if (existing_tag_node_id) {
        const match = nodes.find(
          (n) => n.candidate_node_id === existing_tag_node_id,
        );
        existing = match
          ? {
              cell: match.cell,
              sheet: match.sheet,
              value: match.value_num,
            }
          : { cell: null, sheet: null, value: null };
      }

      const wouldChange =
        decision.action === "add_tag" || decision.action === "move_tag";
      if (wouldChange) wouldChangeCount += 1;
      if (decision.action === "no_candidate") skippedNoCandidateCount += 1;

      picks.push({
        graph_id,
        property_id,
        canonical_key,
        picked_node_id: pick?.candidate?.candidate_node_id || null,
        picked_cell: pick?.candidate?.cell || null,
        picked_sheet: pick?.candidate?.sheet || null,
        picked_value: pick?.candidate?.value_num ?? null,
        score: pick?.score ?? null,
        match_signals: (pick?.candidate?.match_signal || "")
          .split(",")
          .filter(Boolean),
        existing_tag_node_id,
        existing_cell: existing?.cell || null,
        existing_sheet: existing?.sheet || null,
        existing_value: existing?.value ?? null,
        would_change: wouldChange,
        action: decision.action,
      });
    }
  }

  decisions.sort((a, b) => {
    if (a.graph_id !== b.graph_id) return a.graph_id < b.graph_id ? -1 : 1;
    if (a.canonical_key !== b.canonical_key) {
      return a.canonical_key < b.canonical_key ? -1 : 1;
    }
    if (a.action !== b.action) return a.action < b.action ? -1 : 1;
    const an = a.new_node_id || "";
    const bn = b.new_node_id || "";
    if (an !== bn) return an < bn ? -1 : 1;
    const ao = a.old_node_id || "";
    const bo = b.old_node_id || "";
    if (ao !== bo) return ao < bo ? -1 : 1;
    return 0;
  });

  const responseGraphIds = requestedGraphIds
    ? requestedGraphIds.slice()
    : Array.from(seenGraphs);

  const summary = {
    graphs: responseGraphIds.length,
    keys: keys.length,
    pairs_attempted: responseGraphIds.length * keys.length,
    picks_count: picks.filter((p) => p.picked_node_id).length,
    would_change_count: wouldChangeCount,
    skipped_no_candidate_count: skippedNoCandidateCount,
  };

  if (mode === "dry-run") {
    const tok = await _rpcImpl("/rpc/create_retag_approval_token", {
      method: "POST",
      body: { p_decisions: decisions, p_requested_by: user.id },
    });
    if (!tok.ok) {
      console.error(
        "canonical-tagger-retag-batch-background: create_retag_approval_token rpc failed",
        tok.status,
        tok.raw,
      );
      throw new Error(`approval-token RPC failed: status=${tok.status}`);
    }
    const tokRow = Array.isArray(tok.body) ? tok.body[0] : tok.body;
    return {
      mode: "dry-run",
      picks,
      summary,
      decisions,
      approval_token: tokRow?.token,
      expires_at: tokRow?.expires_at,
    };
  }

  const applyRes = await _rpcImpl("/rpc/retag_apply_decisions", {
    method: "POST",
    body: { p_approval_token: body.approval_token, p_decisions: decisions },
  });
  if (!applyRes.ok) {
    console.error(
      "canonical-tagger-retag-batch-background: retag_apply_decisions rpc failed",
      applyRes.status,
      applyRes.raw,
    );
    throw new Error(`apply RPC failed: status=${applyRes.status}`);
  }
  const results = Array.isArray(applyRes.body) ? applyRes.body : [];

  const auditQuery = `/audit_log?resource_id=eq.${encodeURIComponent(body.approval_token)}&select=id&order=created_at.desc`;
  const auditRes = await _rpcImpl(auditQuery, { method: "GET" });
  const auditIds =
    auditRes.ok && Array.isArray(auditRes.body)
      ? auditRes.body.map((r) => r.id)
      : [];

  return {
    mode: "apply",
    applied: true,
    picks,
    summary,
    results,
    audit_log_ids: auditIds,
  };
}
