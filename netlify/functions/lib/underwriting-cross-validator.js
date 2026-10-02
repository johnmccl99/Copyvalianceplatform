import { CROSS_CHECKS } from "./underwriting-field-catalog.js";

export function runCrossChecks(canonicalMap) {
  if (!canonicalMap || typeof canonicalMap !== "object") return [];
  const findings = [];

  for (const check of CROSS_CHECKS) {
    const missing = check.fields.filter((f) => canonicalMap[f] == null);
    if (missing.length === check.fields.length) {
      findings.push({
        id: check.id,
        description: check.description,
        fields: check.fields,
        severity: check.severity,
        status: "skip",
        lhs: null,
        rhs: null,
        absoluteDrift: null,
        relativeDrift: null,
        tolerance: null,
        reason: `all required fields missing: ${missing.join(", ")}`,
      });
      continue;
    }
    let result;
    try {
      result = check.check(canonicalMap);
    } catch (e) {
      findings.push({
        id: check.id,
        description: check.description,
        fields: check.fields,
        severity: check.severity,
        status: "skip",
        lhs: null,
        rhs: null,
        absoluteDrift: null,
        relativeDrift: null,
        tolerance: null,
        reason: `check threw: ${e?.message || String(e)}`,
      });
      continue;
    }

    const { lhs, rhs, mode = "equal" } = result;
    if (lhs == null || rhs == null) {
      findings.push({
        id: check.id,
        description: check.description,
        fields: check.fields,
        severity: check.severity,
        status: "skip",
        lhs,
        rhs,
        absoluteDrift: null,
        relativeDrift: null,
        tolerance: null,
        reason: "check returned null lhs or rhs (one or more inputs missing)",
      });
      continue;
    }

    const absDrift = Math.abs(lhs - rhs);
    const relDrift =
      rhs !== 0 ? absDrift / Math.abs(rhs) : lhs === 0 ? 0 : Infinity;

    let pass;
    if (mode === "gte") {
      pass = lhs >= rhs;
    } else if (mode === "lte") {
      pass = lhs <= rhs;
    } else {
      const tolerance = check.tolerance != null ? check.tolerance : 0;
      const toleranceAbs = check.toleranceAbs != null ? check.toleranceAbs : 0;
      pass = absDrift <= toleranceAbs || (rhs !== 0 && relDrift <= tolerance);
    }

    findings.push({
      id: check.id,
      description: check.description,
      fields: check.fields,
      severity: check.severity,
      status: pass ? "pass" : "fail",
      lhs,
      rhs,
      absoluteDrift: absDrift,
      relativeDrift: rhs !== 0 ? relDrift : null,
      tolerance: check.tolerance ?? check.toleranceAbs ?? null,
      mode,
    });
  }

  return findings;
}

export function summarizeFindings(findings) {
  const passes = findings.filter((f) => f.status === "pass");
  const skips = findings.filter((f) => f.status === "skip");
  const failures = findings.filter((f) => f.status === "fail");
  return {
    total: findings.length,
    passed: passes.length,
    failed: failures.length,
    skipped: skips.length,
    criticalFailures: failures.filter((f) => f.severity === "critical"),
    warningFailures: failures.filter((f) => f.severity === "warning"),
    passes,
    skips,
  };
}

export function findingsForField(findings, fieldKey) {
  return findings.filter(
    (f) => f.fields.includes(fieldKey) && f.status === "fail",
  );
}

export function formatFinding(f) {
  if (f.status === "skip") return `skip — ${f.reason}`;
  if (f.status === "pass") return `✓ ${f.description}`;
  if (f.mode === "gte" || f.mode === "lte") {
    return `✗ ${f.description}: ${f.lhs?.toLocaleString?.() ?? f.lhs} vs ${f.rhs?.toLocaleString?.() ?? f.rhs}`;
  }
  const pct =
    f.relativeDrift != null
      ? ` (${(f.relativeDrift * 100).toFixed(1)}% off)`
      : "";
  return `✗ ${f.description}${pct}`;
}
