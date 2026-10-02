import {
  computeAllDerived,
  sourcesUsesLedger,
  COMPUTE_FUNCTIONS,
} from "./underwriting-compute-engine.js";
import { FIELD_CATALOG } from "./underwriting-field-catalog.js";

const FIELD_TOLERANCE = {
  all_in_basis: 0.001,
  equity_required: 0.001,
  equity_required_total: 0.001,
  units_pro_forma: 0,
  units_rent_controlled: 0,
  vacancy_pct: 0.005,

  price_per_unit: 0.005,
  price_per_rsf: 0.005,
  price_per_gsf: 0.005,
  going_in_cap_rate_y1: 0.01,
  stabilized_yield_on_cost: 0.01,
  senior_loan_ltv: 0.01,

  gpr_annual: 0.05,
  noi_year_1: 0.03,
  debt_service_annual: 0.005,
  capex_budget_total: 0.005,

  __default: 0.01,
};

const FIELD_TOLERANCE_ABS = {
  units_pro_forma: 1,
  units_rent_controlled: 0,
};

function getFieldTolerances(fieldKey) {
  return {
    rel: FIELD_TOLERANCE[fieldKey] ?? FIELD_TOLERANCE.__default,
    abs: FIELD_TOLERANCE_ABS[fieldKey] ?? 0,
  };
}

const CRITICAL_FIELDS = new Set([
  "all_in_basis",
  "equity_required",
  "equity_required_total",
  "units_pro_forma",
  "units_rent_controlled",
]);

function coerceNumeric(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "value" in v) return coerceNumeric(v.value);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function runAudit(canonicalMap, tabular) {
  if (!canonicalMap) canonicalMap = {};

  const flatMap = {};
  for (const [k, v] of Object.entries(canonicalMap)) {
    const n = coerceNumeric(v);
    flatMap[k] =
      n != null ? n : typeof v === "object" && v && "value" in v ? v.value : v;
  }

  const computed = computeAllDerived(flatMap, tabular);

  const groupedByTarget = new Map();
  for (const [computeKey, fn] of Object.entries(COMPUTE_FUNCTIONS)) {
    const targetKey = fn.canonicalKey || computeKey;
    const tag = fn.canonicalKey ? `${targetKey}::${computeKey}` : targetKey;
    const computedValue =
      typeof computed[tag] === "number" && Number.isFinite(computed[tag])
        ? computed[tag]
        : null;
    if (!groupedByTarget.has(targetKey)) groupedByTarget.set(targetKey, []);
    groupedByTarget.get(targetKey).push({ computeKey, fn, computedValue });
  }

  const findings = [];
  for (const [targetKey, group] of groupedByTarget.entries()) {
    const modelValue = coerceNumeric(canonicalMap[targetKey]);

    let best;
    if (modelValue != null) {
      const candidates = group.filter((g) => g.computedValue != null);
      if (candidates.length === 0) {
        best = group[0];
      } else {
        candidates.sort(
          (a, b) =>
            Math.abs(a.computedValue - modelValue) -
            Math.abs(b.computedValue - modelValue),
        );
        best = candidates[0];
      }
    } else {
      const primary = group.find((g) => !g.fn.canonicalKey);
      best = primary || group[0];
    }

    const fn = best.fn;
    const computeKey = best.computeKey;
    const platformValue = best.computedValue;
    const tol = getFieldTolerances(targetKey);
    const severity = CRITICAL_FIELDS.has(targetKey) ? "critical" : "warning";

    if (platformValue == null) {
      findings.push({
        field: targetKey,
        computeKey,
        description: fn.description,
        status: "skip",
        platformValue: null,
        modelValue,
        absoluteDrift: null,
        relativeDrift: null,
        tolerance: tol,
        reason: "cannot recompute — required inputs missing",
        severity,
      });
      continue;
    }

    if (modelValue == null) {
      findings.push({
        field: targetKey,
        computeKey,
        description: fn.description,
        status: "skip",
        platformValue,
        modelValue: null,
        absoluteDrift: null,
        relativeDrift: null,
        tolerance: tol,
        reason: `model did not extract a value for ${targetKey}; platform recomputed = ${platformValue}`,
        severity,
      });
      continue;
    }

    const absDrift = Math.abs(platformValue - modelValue);
    const relDrift =
      modelValue !== 0
        ? absDrift / Math.abs(modelValue)
        : platformValue === 0
          ? 0
          : Infinity;

    let pass;
    if (tol.abs > 0 && absDrift <= tol.abs) {
      pass = true;
    } else if (modelValue !== 0 && relDrift <= tol.rel) {
      pass = true;
    } else if (modelValue === 0 && platformValue === 0) {
      pass = true;
    } else {
      pass = false;
    }

    findings.push({
      field: targetKey,
      computeKey,
      description: fn.description,
      status: pass ? "verified" : "mismatch",
      platformValue,
      modelValue,
      absoluteDrift: absDrift,
      relativeDrift: modelValue !== 0 ? relDrift : null,
      tolerance: tol,
      severity,
    });
  }

  const verified = findings.filter((f) => f.status === "verified");
  const mismatched = findings.filter((f) => f.status === "mismatch");
  const skipped = findings.filter((f) => f.status === "skip");

  return {
    findings,
    summary: {
      total: findings.length,
      verified: verified.length,
      mismatched: mismatched.length,
      skipped: skipped.length,
      criticalMismatches: mismatched.filter((f) => f.severity === "critical"),
      warningMismatches: mismatched.filter((f) => f.severity === "warning"),
    },
    sourcesUsesLedger: sourcesUsesLedger(flatMap),
  };
}

export function findingForField(findings, fieldKey) {
  return findings.find((f) => f.field === fieldKey) || null;
}

export function formatAuditFinding(f) {
  if (f.status === "skip") return `skip — ${f.reason}`;
  if (f.status === "verified") {
    return `✓ verified: model=${fmt(f.modelValue)} platform=${fmt(f.platformValue)}`;
  }
  const pct =
    f.relativeDrift != null
      ? ` (${(f.relativeDrift * 100).toFixed(1)}% off)`
      : "";
  return `✗ mismatch${pct}: model=${fmt(f.modelValue)} platform=${fmt(f.platformValue)} — ${f.description}`;
}

function fmt(v) {
  if (v == null) return "—";
  if (Math.abs(v) < 1) return v.toFixed(4);
  if (Math.abs(v) < 100) return v.toFixed(2);
  return Math.round(v).toLocaleString();
}
