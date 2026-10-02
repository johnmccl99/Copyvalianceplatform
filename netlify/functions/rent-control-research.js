import { applySecurity, jsonResponse } from "./_security.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-4-6";

const POLICY_URLS = {
  berkeley: "https://rentboard.cityofberkeley.info/ordinance/",
  oakland: "https://www.oaklandca.gov/topics/residential-rent-adjustments",
  sf: "https://sfrb.org/our-services/ordinances",
  sanjose:
    "https://www.sanjoseca.gov/your-government/departments-offices/housing/rent-stabilization",
  la: "https://housing.lacity.org/rental-property-owners/rac",
  california_costa_hawkins:
    "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1954.52",
};

const BERKELEY_CUTOFF_DATE = new Date("1980-06-30");

const CALIFORNIA_CH_CUTOFF_DATE = new Date("1995-02-01");

async function sr(path, { method = "GET", body = null, prefer = null } = {}) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
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

function decodeJwtSub(jwt) {
  try {
    const [, payloadB64] = jwt.split(".");
    return (
      JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")).sub || null
    );
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
  const adminTrue =
    p.is_admin === true || p.is_admin === "t" || p.is_admin === 1;
  const adminRole = ["admin", "gp_admin", "gp-admin"].includes(
    String(p.role || "").toLowerCase(),
  );
  return { userId: p.id, orgId: p.org_id, isAdmin: adminTrue || adminRole };
}

function applyDeterministicRules(unit, property) {
  const notes = [];
  const jurisdiction = (property.rent_control_jurisdiction || "").toLowerCase();
  const yearBuilt = property.year_built;
  const unitType = (unit.unit_type || "").toLowerCase();
  const isBmr = !!unit.is_bmr;

  let coverage = "unknown";
  let policyUrl = null;
  let confidence = 0.3;

  if (/retail|rtl|commercial/i.test(unit.unit_type || "")) {
    coverage = "not_covered";
    notes.push(
      "Retail/commercial unit — residential rent stabilization does not apply.",
    );
    confidence = 1.0;
    return {
      coverage,
      notes: notes.join(" "),
      policy_url: policyUrl,
      confidence,
    };
  }

  if (isBmr) {
    coverage = "not_covered";
    notes.push(
      "Below-Market-Rate (BMR) unit — rent governed by the jurisdiction's inclusionary-housing / BMR program rather than the rent stabilization ordinance.",
    );
    confidence = 0.95;
    return {
      coverage,
      notes: notes.join(" "),
      policy_url: policyUrl,
      confidence,
    };
  }

  if (/berkeley/i.test(jurisdiction)) {
    policyUrl = POLICY_URLS.berkeley;

    if (yearBuilt && yearBuilt > BERKELEY_CUTOFF_DATE.getFullYear()) {
      coverage = "not_covered";
      notes.push(
        `Built ${yearBuilt}; Berkeley Rent Stabilization Ordinance exempts post-1980 construction (Costa-Hawkins).`,
      );
      confidence = 0.95;
    } else if (yearBuilt && yearBuilt <= BERKELEY_CUTOFF_DATE.getFullYear()) {
      coverage = "fully_covered";
      notes.push(
        `Built ${yearBuilt}; subject to Berkeley Rent Stabilization Ordinance (BMC §13.76).`,
      );
      confidence = 0.9;
    }
    if (/adu/i.test(unit.unit_type || "") && yearBuilt && yearBuilt >= 2017) {
      coverage = "not_covered";
      notes.push(
        "ADU constructed post-2016 — generally exempt from rent stabilization under state ADU laws.",
      );
      confidence = 0.9;
    }
    return {
      coverage,
      notes: notes.join(" "),
      policy_url: policyUrl,
      confidence,
    };
  }

  if (
    /california|oakland|sf|san\s*francisco|san\s*jose|los\s*angeles|santa\s*monica/i.test(
      jurisdiction,
    )
  ) {
    policyUrl = POLICY_URLS.california_costa_hawkins;
    if (yearBuilt && yearBuilt >= CALIFORNIA_CH_CUTOFF_DATE.getFullYear()) {
      coverage = "not_covered";
      notes.push(
        `Built ${yearBuilt}; Costa-Hawkins exempts post-1995 construction from rent stabilization.`,
      );
      confidence = 0.85;
    } else {
      coverage = "partially_covered";
      notes.push(
        "Pre-1995 construction in CA; coverage depends on local ordinance specifics — flagged for LLM review.",
      );
      confidence = 0.5;
    }
    return {
      coverage,
      notes: notes.join(" "),
      policy_url: policyUrl,
      confidence,
    };
  }

  if (!jurisdiction) {
    notes.push(
      "No rent-control jurisdiction set on property — cannot determine coverage.",
    );
    confidence = 0.1;
  }

  return {
    coverage,
    notes: notes.join(" "),
    policy_url: policyUrl,
    confidence,
  };
}

function buildOpusPrompt(property, units, preliminary) {
  const unitBlock = units
    .map((u, i) => {
      const prelim = preliminary[i];
      return `${i + 1}. unit_type="${u.unit_type || "?"}" beds=${u.beds_per_unit ?? "?"} sf=${u.sf_per_unit ?? "?"} is_bmr=${!!u.is_bmr} section=${u.section || "?"} rent_control_tier=${u.rent_control_tier || "none"} | preliminary=${prelim.coverage} (confidence ${prelim.confidence.toFixed(2)})`;
    })
    .join("\n");

  return `You are classifying rent-control coverage for individual units in a multifamily property. Coverage is REGULATORY (jurisdictional), independent of any current tenant's rent-control status.

**Property:**
- Name: ${property.name || "?"}
- Address: ${property.model_street_address || property.address || "?"}
- City/State: ${property.model_city || property.city || "?"}, ${property.model_state || property.state || "?"}
- Year built: ${property.year_built || "unknown"}
- Jurisdiction: ${property.rent_control_jurisdiction || "unknown"}

**Units** (${units.length} total) with preliminary rule-based classification:
${unitBlock}

**Your job:** For each unit, return its final classification and a 1-2 sentence rationale. Allowed values:
- \`fully_covered\` — unit is subject to the jurisdiction's rent stabilization ordinance with full price + eviction protections
- \`partially_covered\` — some protections apply but not full rent stabilization (e.g. SFR/condo with vacancy decontrol, units in just-cause eviction zones)
- \`not_covered\` — no rent stabilization applies (Costa-Hawkins exempt, retail, BMR program, ADU exemption, new construction)
- \`unknown\` — genuinely cannot determine from available info

**Key rules (Berkeley):**
- BMC §13.76: Buildings constructed ON OR BEFORE June 30, 1980 are covered by rent stabilization.
- Post-1980 construction: exempt via Costa-Hawkins (1995 state override).
- ADUs built post-2016: exempt under state ADU streamlining laws.
- BMR units: not RSO — separate inclusionary-housing price controls apply.
- Retail/commercial: never RSO.

**Output format:** JSON array with one object per unit, in the same order as input:
\`\`\`json
[
  {"unit_index": 1, "coverage": "fully_covered", "notes": "Built pre-1980 in Berkeley; subject to BMC §13.76 rent stabilization.", "confidence": 0.95},
  ...
]
\`\`\`

Return ONLY the JSON array, no prose.`;
}

function parseOpusResponse(text) {
  let t = String(text || "").trim();
  if (t.startsWith("```"))
    t = t
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  const firstBracket = t.indexOf("[");
  const lastBracket = t.lastIndexOf("]");
  if (firstBracket < 0 || lastBracket < firstBracket) {
    return {
      error: "No JSON array found in response",
      raw: text.slice(0, 400),
    };
  }
  try {
    return { array: JSON.parse(t.slice(firstBracket, lastBracket + 1)) };
  } catch (e) {
    return {
      error: `JSON parse failed: ${e.message}`,
      raw: text.slice(0, 400),
    };
  }
}

export const handler = async (event) => {
  const gate = await applySecurity(event, {
    methods: ["POST"],
    requireAuth: true,
    maxBodyBytes: 5_000,
    rateLimit: { maxPerMinute: 5 },
  });
  if (gate.error) return gate.error;

  try {
    if (!ANTHROPIC_API_KEY)
      return jsonResponse(500, { error: "ANTHROPIC_API_KEY not set" });

    const { property_id, unit_mix_ids } = JSON.parse(event.body || "{}");
    if (!property_id)
      return jsonResponse(400, { error: "property_id required" });

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const profile = await resolveAdminProfile(userJwt);
    if (!profile) return jsonResponse(401, { error: "Profile not found" });
    if (!profile.isAdmin) return jsonResponse(403, { error: "Admin required" });

    const propRes = await sr(
      `/properties?id=eq.${property_id}&org_id=eq.${profile.orgId}&select=id,name,city,state,address,year_built&limit=1`,
    );
    if (!propRes.ok || !propRes.body?.length)
      return jsonResponse(404, { error: "Property not found in your org" });
    const property = propRes.body[0];

    let unitQuery = `/property_underwriting_unit_mix?property_id=eq.${property_id}&org_id=eq.${profile.orgId}&select=*&order=created_at.desc`;
    if (Array.isArray(unit_mix_ids) && unit_mix_ids.length) {
      unitQuery += `&id=in.(${unit_mix_ids.join(",")})`;
    }
    const unitRes = await sr(unitQuery);
    if (!unitRes.ok)
      return jsonResponse(500, {
        error: "Failed to load unit mix rows",
        detail: unitRes.raw?.slice(0, 300),
      });
    const allUnits = unitRes.body || [];
    if (!allUnits.length)
      return jsonResponse(200, {
        updated: 0,
        classifications: {},
        warnings: ["No unit_mix rows found for property — run ingest first"],
      });

    const seen = new Set();
    const units = [];
    for (const section of ["stabilized", "existing", null]) {
      for (const u of allUnits) {
        if (section !== null && u.section !== section) continue;
        if (section === null && u.section != null) continue;
        if (seen.has(u.unit_type)) continue;
        seen.add(u.unit_type);
        units.push(u);
      }
    }

    property.rent_control_jurisdiction =
      units.find((u) => u.rent_control_jurisdiction)
        ?.rent_control_jurisdiction ||
      (/berkeley/i.test(property.city || "") ? "berkeley" : null);
    property.model_city = property.city;
    property.model_state = property.state;
    property.model_street_address = property.address;

    const preliminary = units.map((u) => applyDeterministicRules(u, property));

    const prompt = buildOpusPrompt(property, units, preliminary);
    let classifications = preliminary.map((p) => ({
      coverage: p.coverage,
      notes: p.notes,
      confidence: p.confidence,
    }));
    let opusWarning = null;

    try {
      const anthRes = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const anthBody = await anthRes.json().catch(() => ({}));
      if (!anthRes.ok) {
        opusWarning = `Opus HTTP ${anthRes.status}: ${(anthBody?.error?.message || "").slice(0, 200)}`;
      } else {
        const text = (anthBody.content || [])
          .map((c) => c.text || "")
          .join("")
          .trim();
        const parsed = parseOpusResponse(text);
        if (parsed.error) {
          opusWarning = parsed.error;
        } else if (Array.isArray(parsed.array)) {
          for (const item of parsed.array) {
            const idx = (item.unit_index ?? 0) - 1;
            if (idx < 0 || idx >= classifications.length) continue;
            if (typeof item.coverage !== "string") continue;
            const opusConf =
              typeof item.confidence === "number" ? item.confidence : 0.6;
            if (opusConf >= (preliminary[idx].confidence || 0)) {
              classifications[idx] = {
                coverage: item.coverage,
                notes: item.notes || preliminary[idx].notes,
                confidence: opusConf,
              };
            }
          }
        }
      }
    } catch (e) {
      opusWarning = `Opus request failed: ${e.message || String(e)}`;
    }

    const coverageByType = new Map();
    const notesByType = new Map();
    units.forEach((u, i) => {
      coverageByType.set(u.unit_type, classifications[i].coverage);
      notesByType.set(u.unit_type, classifications[i].notes);
    });

    const updatePromises = allUnits
      .filter((u) => coverageByType.has(u.unit_type))
      .map((u) =>
        sr(`/property_underwriting_unit_mix?id=eq.${u.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: {
            rent_control_coverage: coverageByType.get(u.unit_type),
            rent_control_research_notes: notesByType.get(u.unit_type),
            rent_control_policy_url:
              property.rent_control_jurisdiction === "berkeley"
                ? POLICY_URLS.berkeley
                : POLICY_URLS.california_costa_hawkins,
          },
        }),
      );
    const updateResults = await Promise.all(updatePromises);
    const updated = updateResults.filter((r) => r.ok).length;

    const counts = {
      fully_covered: 0,
      partially_covered: 0,
      not_covered: 0,
      unknown: 0,
    };
    classifications.forEach((c) => {
      if (counts[c.coverage] != null) counts[c.coverage] += 1;
    });

    const warnings = [];
    if (opusWarning) warnings.push(`Opus pass: ${opusWarning}`);
    const writeErrors = updateResults.filter((r) => !r.ok).length;
    if (writeErrors > 0)
      warnings.push(`${writeErrors} row(s) failed to update`);

    return jsonResponse(200, {
      updated,
      units_total: allUnits.length,
      classifications: counts,
      warnings,
      property_name: property.name,
    });
  } catch (e) {
    console.error("[rent-control-research] exception:", e);
    return jsonResponse(500, { error: "Internal error", message: e?.message });
  }
};
