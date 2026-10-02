import { traceDependencies } from "./underwriting-model-intelligence.js";
import { FIELD_CATALOG } from "./underwriting-field-catalog.js";

function collectAllCellsInClosure(graph, sheet, cell) {
  const visited = new Set();
  const queue = [{ sheet, cell: String(cell).toUpperCase() }];

  const refs = new Map();
  for (const edge of graph.edges || []) {
    const fromKey = `${edge.from_sheet || edge.src_sheet}\x00${(edge.from_cell || edge.src_cell)?.toUpperCase()}`;
    const toSheet = edge.to_sheet || edge.target_sheet || edge.dst_sheet;
    const toCell = (
      edge.to_cell ||
      edge.target_cell ||
      edge.dst_cell
    )?.toUpperCase();
    if (!toSheet || !toCell) continue;
    if (!refs.has(fromKey)) refs.set(fromKey, []);
    refs.get(fromKey).push({ sheet: toSheet, cell: toCell });
  }

  while (queue.length) {
    const { sheet: s, cell: c } = queue.shift();
    const key = `${s}\x00${c}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const next = refs.get(key);
    if (next) for (const n of next) queue.push(n);
  }

  visited.delete(`${sheet}\x00${String(cell).toUpperCase()}`);
  return visited;
}

export function runTraceValidation(graph, canonicalMap) {
  if (!canonicalMap || typeof canonicalMap !== "object") return [];
  if (!graph || !Array.isArray(graph.nodes)) return [];

  const cellToField = new Map();
  for (const [fieldKey, entry] of Object.entries(canonicalMap)) {
    if (!entry || !entry.sheet || !entry.cell) continue;
    const k = `${entry.sheet}\x00${String(entry.cell).toUpperCase()}`;
    cellToField.set(k, fieldKey);
  }

  const findings = [];

  for (const [fieldKey, entry] of Object.entries(canonicalMap)) {
    const meta = FIELD_CATALOG[fieldKey];
    if (!meta) continue;

    if (meta.units === "text" || meta.units === "date") continue;

    if (!entry || !entry.sheet || !entry.cell) {
      findings.push({
        field: fieldKey,
        sourceCell: null,
        status: "skip",
        foundDependencies: [],
        expectedDependencies: meta.dependsOn || [],
        missingDependencies: [],
        forbiddenDependencies: [],
        traceInputCount: 0,
        reason: "no source cell on extracted value",
      });
      continue;
    }

    let trace;
    try {
      trace = traceDependencies(graph, entry.sheet, entry.cell);
    } catch (e) {
      findings.push({
        field: fieldKey,
        sourceCell: `${entry.sheet}!${entry.cell}`,
        status: "skip",
        foundDependencies: [],
        expectedDependencies: meta.dependsOn || [],
        missingDependencies: [],
        forbiddenDependencies: [],
        traceInputCount: 0,
        reason: `traceDependencies threw: ${e?.message || String(e)}`,
      });
      continue;
    }

    if (!trace || trace.notFound) {
      findings.push({
        field: fieldKey,
        sourceCell: `${entry.sheet}!${entry.cell}`,
        status: "skip",
        foundDependencies: [],
        expectedDependencies: meta.dependsOn || [],
        missingDependencies: [],
        forbiddenDependencies: [],
        traceInputCount: 0,
        reason: "source cell not found in graph",
      });
      continue;
    }

    if (!trace.formula) {
      findings.push({
        field: fieldKey,
        sourceCell: `${entry.sheet}!${entry.cell}`,
        status: "pass",
        foundDependencies: [],
        expectedDependencies: meta.dependsOn || [],
        missingDependencies: [],
        forbiddenDependencies: [],
        traceInputCount: 0,
        reason: "source cell is an input (no formula); trace not applicable",
      });
      continue;
    }

    const closureKeys = collectAllCellsInClosure(
      graph,
      entry.sheet,
      entry.cell,
    );
    const foundDeps = new Set();
    for (const k of closureKeys) {
      const field = cellToField.get(k);
      if (field) foundDeps.add(field);
    }

    const expected = new Set(meta.dependsOn || []);
    expected.delete(fieldKey);

    const forbidden = new Set(meta.shouldNotDependOn || []);
    forbidden.delete(fieldKey);

    const missing = Array.from(expected).filter((d) => !foundDeps.has(d));
    const violatedForbidden = Array.from(forbidden).filter((d) =>
      foundDeps.has(d),
    );

    let status;
    if (violatedForbidden.length > 0) {
      status = "fail";
    } else if (expected.size > 0 && missing.length === expected.size) {
      status = "fail";
    } else if (expected.size > 0 && missing.length > 0) {
      status = "pass";
    } else {
      status = "pass";
    }

    findings.push({
      field: fieldKey,
      sourceCell: `${entry.sheet}!${entry.cell}`,
      status,
      foundDependencies: Array.from(foundDeps).sort(),
      expectedDependencies: Array.from(expected).sort(),
      missingDependencies: missing.sort(),
      forbiddenDependencies: violatedForbidden.sort(),
      traceInputCount: trace.transitiveInputs?.length || 0,
    });
  }

  return findings;
}

export function findingForField(findings, fieldKey) {
  return findings.find((f) => f.field === fieldKey) || null;
}

export function summarizeTraceFindings(findings) {
  const passes = findings.filter((f) => f.status === "pass");
  const fails = findings.filter((f) => f.status === "fail");
  const skips = findings.filter((f) => f.status === "skip");
  return {
    total: findings.length,
    passed: passes.length,
    failed: fails.length,
    skipped: skips.length,
    failures: fails,
    forbiddenViolations: fails.filter(
      (f) => f.forbiddenDependencies.length > 0,
    ),
  };
}

export function formatTraceFinding(f) {
  if (f.status === "skip") return `skip — ${f.reason}`;
  if (f.status === "pass") {
    if (f.foundDependencies.length === 0) {
      return `✓ trace OK (${f.reason || "no expected deps"})`;
    }
    return `✓ trace OK (${f.traceInputCount} inputs, ${f.foundDependencies.length} matched expected)`;
  }
  if (f.forbiddenDependencies.length > 0) {
    return `✗ source cell depends on forbidden field(s): ${f.forbiddenDependencies.join(", ")}`;
  }
  return `✗ source cell missing all expected dependencies: ${f.missingDependencies.join(", ")}`;
}
