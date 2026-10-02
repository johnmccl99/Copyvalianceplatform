import { FIELD_CATALOG } from "./underwriting-field-catalog.js";
import {
  runCrossChecks,
  summarizeFindings,
  findingsForField as crossFindingsForField,
} from "./underwriting-cross-validator.js";
import {
  runTraceValidation,
  findingForField as traceFindingForField,
  summarizeTraceFindings,
} from "./underwriting-trace-validator.js";

export function runConfidenceScoring(graph, canonicalMap) {
  const valuesOnly = {};
  for (const [k, v] of Object.entries(canonicalMap || {})) {
    if (v && typeof v === "object" && "value" in v) valuesOnly[k] = v.value;
    else valuesOnly[k] = v;
  }
  const crossFindings = runCrossChecks(valuesOnly);
  const crossSummary = summarizeFindings(crossFindings);

  const traceFindings = runTraceValidation(graph, canonicalMap);
  const traceSummary = summarizeTraceFindings(traceFindings);

  const perField = {};
  let high = 0,
    mid = 0,
    low = 0;
  for (const [fieldKey, entry] of Object.entries(canonicalMap || {})) {
    const meta = FIELD_CATALOG[fieldKey];
    if (!meta) continue;

    const value =
      entry && typeof entry === "object" && "value" in entry
        ? entry.value
        : entry;
    const reasons = [];

    let inRange = null;
    if (
      meta.expectedRange &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      const { min, max } = meta.expectedRange;
      inRange = value >= min && value <= max;
      if (!inRange) {
        reasons.push(`value ${value} outside expected range [${min}, ${max}]`);
      }
    }

    const crossFails = crossFindingsForField(crossFindings, fieldKey);
    for (const f of crossFails) {
      reasons.push(
        `cross-check fail: ${f.description}` +
          (f.severity === "critical" ? " (CRITICAL)" : ""),
      );
    }

    const traceFinding = traceFindingForField(traceFindings, fieldKey);
    if (traceFinding && traceFinding.status === "fail") {
      if (traceFinding.forbiddenDependencies.length > 0) {
        reasons.push(
          `trace includes forbidden field(s): ${traceFinding.forbiddenDependencies.join(", ")}`,
        );
      } else if (traceFinding.missingDependencies.length > 0) {
        reasons.push(
          `trace missing all expected: ${traceFinding.missingDependencies.join(", ")}`,
        );
      }
    }

    let level;
    const hasCriticalCross = crossFails.some((f) => f.severity === "critical");
    const hasTraceFail = traceFinding && traceFinding.status === "fail";
    const outOfRange = inRange === false;

    if (outOfRange || hasCriticalCross || hasTraceFail) {
      level = "LOW";
      low += 1;
    } else if (
      crossFindings.some(
        (f) => f.fields.includes(fieldKey) && f.status === "pass",
      ) ||
      (traceFinding &&
        traceFinding.status === "pass" &&
        traceFinding.foundDependencies.length > 0)
    ) {
      level = "HIGH";
      high += 1;
    } else {
      level = "MEDIUM";
      mid += 1;
    }

    perField[fieldKey] = {
      level,
      reasons,
      inRange,
      crossFailures: crossFails,
      traceFinding,
    };
  }

  return {
    perField,
    crossChecks: { findings: crossFindings, summary: crossSummary },
    trace: { findings: traceFindings, summary: traceSummary },
    banner: {
      hasCriticalFailures: crossSummary.criticalFailures.length > 0,
      criticalCount: crossSummary.criticalFailures.length,
      warningCount: crossSummary.warningFailures.length + traceSummary.failed,
      lowConfidenceFieldCount: low,
      mediumConfidenceFieldCount: mid,
      highConfidenceFieldCount: high,
    },
  };
}

export function confidenceChipStyle(level) {
  if (level === "HIGH")
    return { label: "high", color: "#065F46", bg: "#D1FAE5" };
  if (level === "MEDIUM")
    return { label: "medium", color: "#92400E", bg: "#FEF3C7" };
  return { label: "low", color: "#991B1B", bg: "#FEE2E2" };
}
