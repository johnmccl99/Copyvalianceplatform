import { applySecurity, jsonResponse } from "./_security.js";
import { CLAUDE_SONNET_MODEL } from "./_model-config.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const REVIEWER_VOICE = `You are the firm's Director of Risk, Compliance & Legal.

Documentary and precise. You own enterprise risk, regulatory filings, insurance, cyber, and all LPA/PSA/loan doc review. You quote clauses from memory and spot issues others haven't seen yet, and you are protective of the firm's regulatory posture because preventable issues turn into seven-figure penalties.

Communication style: Crisp and clause-specific. Never uses five words where three will do. Not legalistic for its own sake — the point is to protect the downside.`;

function buildReviewSystemPrompt() {
  return `${REVIEWER_VOICE}

You are performing a DESK REVIEW of a third-party vendor as part of the firm's annual SOC 2 CC9.2 vendor risk management cadence. Your review is a DRAFT for the human risk officer to review and accept — you are not approving the vendor yourself.

Your task: Given the vendor's record (name, category, services, data classification, compliance posture, prior notes), produce a structured review. Focus on what a human reviewer would want flagged before they sign the annual attestation.

Rubric — for each review cover these five dimensions:
1. SOC 2 / compliance posture: Is the report current? Are the claimed certifications plausible for a vendor of this type?
2. Data handling alignment: Does the described data flow match the data classification? Any signs of scope creep?
3. Subprocessor chain: If marked as a subprocessor, is the DPA current? Any cross-border data issues?
4. Control gaps: What's missing that a mature vendor of this type should have?
5. Recent events / recommendations: Known breaches, leadership changes, product pivots that might affect risk posture.

IMPORTANT — hard constraints:
- Base your review ONLY on the provided vendor record. Do NOT invent current events, breaches, or executive changes unless you are certain from general knowledge.
- If you don't have enough information to judge a dimension, say so explicitly in that dimension's finding ("insufficient information to assess").
- Flag anything that should BLOCK the annual re-certification separately in the recommendations array with priority "critical".

Return ONLY valid JSON matching this schema exactly (no prose outside the JSON):
{
  "summary": "2-3 sentence executive summary of the review outcome",
  "risk_level": "low" | "medium" | "high" | "critical",
  "confidence": "low" | "medium" | "high",
  "findings": [
    {
      "dimension": "soc2_compliance" | "data_handling" | "subprocessor_chain" | "control_gaps" | "recent_events",
      "status": "ok" | "attention" | "blocker" | "insufficient_info",
      "finding": "one-paragraph description in the reviewer's voice — clause-precise, downside-focused"
    }
  ],
  "recommendations": [
    {
      "priority": "low" | "medium" | "high" | "critical",
      "action": "specific action the reviewer should take"
    }
  ]
}`;
}

function buildVendorContext(vendor) {
  const list = (arr) =>
    Array.isArray(arr) && arr.length ? arr.join(", ") : "—";
  return `Vendor to review:

Name: ${vendor.name}
Website: ${vendor.website || "—"}
Category: ${vendor.category || "—"}
Services provided: ${vendor.services_provided || "—"}
Our owner: ${vendor.our_owner || "—"}

Risk classification:
  Criticality: ${vendor.criticality}
  Data classification: ${vendor.data_classification}
  Subprocessor (flows our customers' data): ${vendor.is_subprocessor ? "Yes" : "No"}
  Data shared description: ${vendor.data_shared_description || "—"}

Compliance posture:
  SOC 2 report available: ${vendor.soc2_report_available ? "Yes" : "No"}
  SOC 2 / trust-center URL: ${vendor.soc2_report_url || "—"}
  Certifications claimed: ${list(vendor.certifications)}
  DPA on file: ${vendor.dpa_on_file ? "Yes" : "No"}
  BAA required: ${vendor.bas_required ? "Yes" : "No"}
  Security contact: ${vendor.security_contact_email || "—"}

Lifecycle:
  Status: ${vendor.status}
  Onboarded: ${vendor.onboarded_at || "—"}
  Contract renewal: ${vendor.contract_renewal_at || "—"}
  Last reviewed: ${vendor.last_reviewed_at || "—"}
  Next review due: ${vendor.next_review_at || "—"}

Prior notes (human-authored, chronological — newest first):
${vendor.notes || "—"}

Produce the structured JSON review now.`;
}

async function fetchVendor(vendorId, { userJwt, useServiceRole }) {
  if (!SUPABASE_URL) return null;
  const url = `${SUPABASE_URL}/rest/v1/security_vendors?id=eq.${encodeURIComponent(vendorId)}&select=*&limit=1`;
  const headers = useServiceRole
    ? {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/json",
      }
    : {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        Accept: "application/json",
      };
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

async function saveDraft(vendorId, draft, { userJwt, useServiceRole }) {
  if (!SUPABASE_URL) return { error: "supabase not configured" };
  const url = `${SUPABASE_URL}/rest/v1/security_vendors?id=eq.${encodeURIComponent(vendorId)}`;
  const headers = useServiceRole
    ? {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      }
    : {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      };
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        ai_review_draft: draft,
        ai_review_generated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok)
      return { error: `save failed ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { error: err?.message || "save failed" };
  }
}

async function callClaude(systemPrompt, userMessage) {
  if (!ANTHROPIC_KEY) return { error: "ANTHROPIC_API_KEY missing" };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_SONNET_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `Claude API ${res.status}: ${text.slice(0, 200)}` };
  }
  const data = await res.json();
  const raw = data.content?.[0]?.text || "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { error: "Claude response was not JSON", raw };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (
      !parsed.summary ||
      !Array.isArray(parsed.findings) ||
      !Array.isArray(parsed.recommendations)
    ) {
      return { error: "Claude response missing required fields", raw };
    }
    return {
      draft: {
        summary: String(parsed.summary).slice(0, 2000),
        risk_level: parsed.risk_level || "medium",
        confidence: parsed.confidence || "medium",
        findings: parsed.findings.slice(0, 10).map((f) => ({
          dimension: String(f.dimension || "").slice(0, 40),
          status: String(f.status || "attention").slice(0, 20),
          finding: String(f.finding || "").slice(0, 2000),
        })),
        recommendations: parsed.recommendations.slice(0, 10).map((r) => ({
          priority: String(r.priority || "medium").slice(0, 20),
          action: String(r.action || "").slice(0, 1000),
        })),
        generated_at: new Date().toISOString(),
        model: CLAUDE_SONNET_MODEL,
      },
    };
  } catch (e) {
    return { error: "Failed to parse Claude JSON: " + (e.message || e), raw };
  }
}

export async function runReview({ vendorId, userJwt, useServiceRole = false }) {
  if (!vendorId) return { error: "vendorId required", status: 400 };
  const vendor = await fetchVendor(vendorId, { userJwt, useServiceRole });
  if (!vendor)
    return { error: "Vendor not found or not accessible", status: 404 };

  const systemPrompt = buildReviewSystemPrompt();
  const userMessage = buildVendorContext(vendor);
  const { draft, error, raw } = await callClaude(systemPrompt, userMessage);
  if (error) {
    console.error(
      "[vendor-review] Claude call failed:",
      error,
      raw?.slice(0, 200),
    );
    return { error: "AI review failed: " + error, status: 502 };
  }
  const save = await saveDraft(vendorId, draft, { userJwt, useServiceRole });
  if (save.error) {
    console.error("[vendor-review] save failed:", save.error);
    return {
      error: "Draft generated but not saved: " + save.error,
      status: 500,
    };
  }
  return { draft, vendor: { id: vendor.id, name: vendor.name }, status: 200 };
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  const body = gate.body || {};
  const vendorId = String(body.vendorId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(vendorId)) {
    return jsonResponse(400, { error: "Invalid vendorId" });
  }

  const authHeader =
    event.headers.authorization || event.headers.Authorization || "";
  const userJwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const { draft, vendor, error, status } = await runReview({
    vendorId,
    userJwt,
  });
  if (error) return jsonResponse(status || 500, { error });
  return jsonResponse(200, {
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    draft,
  });
};
