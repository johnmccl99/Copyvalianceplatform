import { budgetCellIsDash } from "./budgetCellFormat.js";

export const COA_STATEMENT_SECTIONS = [
  "revenue",
  "operating_expense",
  "below_noi",
];

const SUM_RANGE_RE = /SUM\(C(\d+):C(\d+)\)/g;

export function parseSubtotalFormula(formula) {
  const src = String(formula || "");
  const rowsRef = new Set();
  const tokens = [];
  for (const m of src.matchAll(SUM_RANGE_RE)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    tokens.push(`SUM(C${m[1]}:C${m[2]})`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
    for (let r = from; r <= to; r += 1) rowsRef.add(r);
  }
  const complete = tokens.length > 0 && `=${tokens.join("+")}` === src.trim();
  return { rows: rowsRef, complete, termCount: tokens.length };
}

function isStrictSuperset(a, b) {
  if (a.size <= b.size) return false;
  for (const x of b) if (!a.has(x)) return false;
  return true;
}

export function compileCoaTemplate(specRows) {
  const all = Array.isArray(specRows) ? specRows.filter(Boolean) : [];
  const ordered = [...all].sort((a, b) => Number(a.row) - Number(b.row));

  const columnHeader = ordered.find(
    (r) => r.kind === "header" && r.label != null,
  );
  const bodyFrom = columnHeader ? Number(columnHeader.row) : -Infinity;
  const body = ordered.filter((r) => Number(r.row) > bodyFrom);

  const subtotals = body
    .filter((r) => r.kind === "subtotal")
    .map((r) => {
      const parsed = parseSubtotalFormula(r.formula);
      return {
        spec: r,
        leaves: parsed.rows,
        complete: parsed.complete,
        termCount: parsed.termCount,
      };
    });
  for (const s of subtotals) {
    s.depth = subtotals.filter((o) =>
      isStrictSuperset(o.leaves, s.leaves),
    ).length;
  }
  const subtotalByLabel = new Map(
    subtotals.map((s) => [String(s.spec.label || "").trim(), s]),
  );

  const ownerByRow = new Map();
  for (const s of subtotals) {
    for (const r of s.leaves) {
      const prev = ownerByRow.get(r);
      if (!prev || s.leaves.size < prev.leaves.size) ownerByRow.set(r, s);
    }
  }

  const lines = [];
  const accountRows = new Map();
  const unparseable = [];

  for (let i = 0; i < body.length; i += 1) {
    const r = body[i];
    if (r.kind === "header") {
      const label = String(r.account || "").trim();
      const next = body[i + 1];
      const isSubgroup = !!next && next.kind === "account";
      const boundLabel = `Total ${label}`;
      const bound = subtotalByLabel.get(boundLabel);
      lines.push({
        kind: "header",
        headerKind: isSubgroup ? "subgroup" : "section",
        specRow: Number(r.row),
        label,
        depth: bound ? bound.depth : 0,
        boundSubtotalLabel: bound ? boundLabel : null,
        accountNumber: null,
      });
    } else if (r.kind === "account") {
      const owner = ownerByRow.get(Number(r.row));
      const line = {
        kind: "account",
        specRow: Number(r.row),
        label: String(r.label || "").trim(),
        accountNumber: String(r.account),
        depth: owner ? owner.depth + 1 : 1,
        ownerSpecRow: owner ? Number(owner.spec.row) : null,
      };
      lines.push(line);
      accountRows.set(line.accountNumber, line);
    } else if (r.kind === "subtotal") {
      const s = subtotals.find((x) => x.spec.row === r.row);
      if (s && !s.complete)
        unparseable.push({ specRow: Number(r.row), formula: r.formula });
      lines.push({
        kind: "subtotal",
        specRow: Number(r.row),
        label: String(r.label || "").trim(),
        formula: r.formula,
        depth: s ? s.depth : 0,
        leafSpecRows: s ? [...s.leaves] : [],
        isGrandTotal: !!s && s.termCount > 1,
        accountNumber: null,
      });
    }
  }

  const bandByAccount = new Map();
  const BANDS = [
    ["Total Operating Income", "revenue"],
    ["Total Operating Expenses", "operating_expense"],
    ["Total Other Expenses", "below_noi"],
    ["Total Adjustments", "below_noi"],
  ];
  for (const [label, band] of BANDS) {
    const s = subtotalByLabel.get(label);
    if (!s) continue;
    for (const specRow of s.leaves) {
      const line = lines.find(
        (l) => l.kind === "account" && l.specRow === specRow,
      );
      if (line) bandByAccount.set(line.accountNumber, band);
    }
  }

  return {
    lines,
    accountRows,
    bandByAccount,
    unparseable,
    subtotalCount: subtotals.length,
  };
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildAxis(rows, monthCount) {
  const seen = new Map();
  for (const r of rows) {
    const mi = Number(r.month_index);
    if (!Number.isFinite(mi)) continue;
    if (!seen.has(mi))
      seen.set(mi, { month_index: mi, month_end: r.month_end ?? null });
  }
  let axis = [...seen.values()].sort((a, b) => a.month_index - b.month_index);
  if (Number.isFinite(monthCount) && monthCount > 0)
    axis = axis.slice(0, monthCount);
  return axis;
}

function normalizeMeasures(measures) {
  if (measures == null) return null;
  if (!Array.isArray(measures) || measures.length === 0) {
    throw new TypeError(
      "buildCoaStatementLayout: `measures` must be a non-empty array when provided.",
    );
  }
  const seen = new Set();
  return measures.map((m, i) => {
    if (!m || typeof m.key !== "string" || !m.key) {
      throw new TypeError(
        `buildCoaStatementLayout: measures[${i}].key must be a non-empty string.`,
      );
    }
    if (typeof m.field !== "string" || !m.field) {
      throw new TypeError(
        `buildCoaStatementLayout: measures[${i}].field must be a non-empty string.`,
      );
    }
    if (seen.has(m.key)) {
      throw new TypeError(
        `buildCoaStatementLayout: duplicate measure key "${m.key}".`,
      );
    }
    seen.add(m.key);
    return { key: m.key, field: m.field };
  });
}

function blankMeasureAcc(measureSpecs, len) {
  const out = {};
  for (const m of measureSpecs) out[m.key] = new Array(len).fill(0);
  return out;
}

function measureValueCovered(v) {
  if (v === null || v === undefined || v === "") return false;
  return Number.isFinite(Number(v));
}

function emitMeasures(measureSpecs, acc, len, fill, coverage = null) {
  if (!measureSpecs) return undefined;
  const out = {};
  for (const m of measureSpecs) {
    const sums = acc ? acc[m.key] : null;
    if (!coverage) {
      const monthly = sums || new Array(len).fill(fill);
      out[m.key] = {
        monthly,
        total: sums ? monthly.reduce((s, v) => s + toNumber(v), 0) : fill,
      };
      continue;
    }
    const covered = sums ? coverage.covered[m.key] : null;
    const uncovered = sums ? coverage.uncovered[m.key] : null;
    const monthly = new Array(len).fill(sums ? null : fill);
    let total = null;
    let coveredMonths = 0;
    let uncoveredMonths = 0;
    let coveredContributions = 0;
    let uncoveredContributions = 0;
    for (let i = 0; i < len; i += 1) {
      coveredContributions += covered ? covered[i] : 0;
      uncoveredContributions += uncovered ? uncovered[i] : 0;
      if (covered && covered[i] > 0) {
        monthly[i] = sums[i];
        total = (total === null ? 0 : total) + sums[i];
        coveredMonths += 1;
      } else if (uncovered && uncovered[i] > 0) {
        uncoveredMonths += 1;
      }
    }
    out[m.key] = {
      monthly,
      total,
      coveredMonths,
      uncoveredMonths,
      coveredContributions,
      uncoveredContributions,
    };
  }
  return out;
}

function cellAbsent(amountPresent, accountPresent) {
  if (amountPresent === true) return false;
  if (amountPresent === false) return true;
  return accountPresent === false;
}

function absentByMonthFor(acc, len) {
  const out = new Array(len).fill(false);
  for (let i = 0; i < len; i += 1) {
    out[i] = cellAbsent(
      acc.amountPresentByMonth ? acc.amountPresentByMonth[i] : undefined,
      acc.isActualByMonth[i]
        ? acc.actualsSourcePresent
        : acc.budgetSourcePresent,
    );
  }
  return out;
}

function isDisplayZero(v) {
  return budgetCellIsDash(v);
}

function foldPresence(prev, next) {
  if (next === true) return true;
  if (next === false) return prev === true ? true : false;
  return prev === undefined ? null : prev;
}

export function coaAccountsWithBalance(rows) {
  const withBalance = new Set();
  for (const r of rows || []) {
    if (!r || r.account_number == null) continue;
    const figure = r.amount !== undefined ? r.amount : r.running_balance;
    if (!isDisplayZero(figure)) withBalance.add(String(r.account_number));
  }
  return withBalance;
}

export function coaFilterZeroBalanceAccounts(rows, hide) {
  if (!hide) return rows;
  const keep = coaAccountsWithBalance(rows);
  return (rows || []).filter((r) => r && keep.has(String(r.account_number)));
}

export function coaPresenceByAccount(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || r.account_number == null) continue;
    const k = String(r.account_number);
    const cur = by.get(k) || { budget: undefined, actuals: undefined };
    cur.budget = foldPresence(cur.budget, r.budget_source_present);
    cur.actuals = foldPresence(cur.actuals, r.actuals_source_present);
    by.set(k, cur);
  }
  for (const v of by.values()) {
    if (v.budget === undefined) v.budget = null;
    if (v.actuals === undefined) v.actuals = null;
  }
  return by;
}

export function coaAmountPresenceByCell(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || r.account_number == null) continue;
    const mi = Number(r.month_index);
    if (!Number.isFinite(mi)) continue;
    const k = String(r.account_number);
    let months = by.get(k);
    if (!months) {
      months = new Map();
      by.set(k, months);
    }
    months.set(mi, foldPresence(months.get(mi), r.amount_source_present));
  }
  for (const months of by.values()) {
    for (const [mi, v] of months) if (v === undefined) months.set(mi, null);
  }
  return by;
}

export function coaCellPresenceVector(byCell, accountNumber, axis) {
  const months = byCell && byCell.get(String(accountNumber));
  return (axis || []).map((m) => {
    if (!months) return undefined;
    const v = months.get(Number(m.month_index));
    return v === null ? undefined : v;
  });
}

export function coaAbsentVector(
  presence,
  isActualByMonth,
  len,
  amountPresentByMonth,
) {
  const n = Number.isFinite(len) ? len : (isActualByMonth || []).length;
  const out = new Array(n).fill(false);
  for (let i = 0; i < n; i += 1) {
    const accountPresent = presence
      ? isActualByMonth && isActualByMonth[i]
        ? presence.actuals
        : presence.budget
      : undefined;
    out[i] = cellAbsent(
      amountPresentByMonth ? amountPresentByMonth[i] : undefined,
      accountPresent,
    );
  }
  return out;
}

export function coaCountStatementAccounts(layout) {
  if (!layout) return 0;
  let n = 0;
  for (const r of layout.rows || []) if (r && r.kind === "account") n += 1;
  return n + (layout.orphans || []).length;
}

export function coaIncomeStatementAccounts(specRows) {
  return new Set(compileCoaTemplate(specRows).accountRows.keys());
}

export function coaCountGridAccounts(sections) {
  let n = 0;
  for (const s of sections || []) {
    for (const b of (s && s.buckets) || [])
      n += ((b && b.accounts) || []).length;
  }
  return n;
}

export function buildCoaStatementLayout({
  specRows,
  rows,
  monthCount,
  includeEmptyAccounts = false,
  hideZeroBalanceAccounts = false,
  balanceSheetAccounts = null,
  respectProductionBand = true,
  measures = null,
  preserveNullMeasures = false,
} = {}) {
  const template = compileCoaTemplate(specRows);
  const measureSpecs = normalizeMeasures(measures);
  const src = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const bsSet =
    balanceSheetAccounts instanceof Set
      ? balanceSheetAccounts
      : Array.isArray(balanceSheetAccounts)
        ? new Set(balanceSheetAccounts.map(String))
        : null;

  const inScope = [];
  const excluded = [];
  for (const r of src) {
    const section = r.noi_section || "below_noi";
    if (!COA_STATEMENT_SECTIONS.includes(section)) {
      excluded.push(r);
      continue;
    }
    if (bsSet && bsSet.has(String(r.account_number))) {
      excluded.push(r);
      continue;
    }
    if (respectProductionBand) {
      const band = template.bandByAccount.get(String(r.account_number));
      if (band && band !== section) {
        excluded.push(r);
        continue;
      }
    }
    inScope.push(r);
  }

  const axis = buildAxis(inScope, monthCount);
  if (axis.length === 0) {
    return {
      axis: [],
      rows: [],
      orphans: [],
      excluded,
      hasData: false,
      unparseable: template.unparseable,
    };
  }
  const pos = new Map(axis.map((m, i) => [m.month_index, i]));
  const len = axis.length;

  const agg = new Map();
  const orphanSet = new Map();
  const newAcc = () => ({
    name: "",
    monthly: new Array(len).fill(0),
    isActualByMonth: new Array(len).fill(false),
    budgetSourcePresent: undefined,
    actualsSourcePresent: undefined,
    amountPresentByMonth: new Array(len).fill(undefined),
    byMeasure: measureSpecs ? blankMeasureAcc(measureSpecs, len) : null,
    measureCovered:
      measureSpecs && preserveNullMeasures
        ? blankMeasureAcc(measureSpecs, len)
        : null,
    measureUncovered:
      measureSpecs && preserveNullMeasures
        ? blankMeasureAcc(measureSpecs, len)
        : null,
  });
  for (const r of inScope) {
    const col = pos.get(Number(r.month_index));
    if (col == null) continue;
    const acct = r.account_number == null ? "" : String(r.account_number);
    const store = template.accountRows.has(acct) ? agg : orphanSet;
    let a = store.get(acct);
    if (!a) {
      a = newAcc();
      if (store === orphanSet) a.noi_section = r.noi_section || null;
      store.set(acct, a);
    }
    if (!a.name && r.account_name) a.name = r.account_name;
    a.monthly[col] += toNumber(r.amount);
    if (measureSpecs && a.byMeasure) {
      for (const m of measureSpecs) {
        const raw = r[m.field];
        const covered = measureValueCovered(raw);
        if (covered) a.byMeasure[m.key][col] += Number(raw);
        if (a.measureCovered) {
          if (covered) a.measureCovered[m.key][col] += 1;
          else a.measureUncovered[m.key][col] += 1;
        }
      }
    }
    if (r.is_actual) a.isActualByMonth[col] = true;
    a.budgetSourcePresent = foldPresence(
      a.budgetSourcePresent,
      r.budget_source_present,
    );
    a.actualsSourcePresent = foldPresence(
      a.actualsSourcePresent,
      r.actuals_source_present,
    );
    a.amountPresentByMonth[col] = foldPresence(
      a.amountPresentByMonth[col],
      r.amount_source_present,
    );
  }
  for (const a of agg.values()) {
    if (a.budgetSourcePresent === undefined) a.budgetSourcePresent = null;
    if (a.actualsSourcePresent === undefined) a.actualsSourcePresent = null;
  }

  const acctBySpecRow = new Map();
  for (const line of template.accountRows.values())
    acctBySpecRow.set(line.specRow, line.accountNumber);

  const visible = (acct) => {
    const a = agg.get(acct);
    if (hideZeroBalanceAccounts)
      return !!a && a.monthly.some((v) => !isDisplayZero(v));
    return !!a || includeEmptyAccounts;
  };
  const liveSpecRows = new Set();
  for (const line of template.accountRows.values()) {
    if (visible(line.accountNumber)) liveSpecRows.add(line.specRow);
  }

  const out = [];
  for (const line of template.lines) {
    if (line.kind === "account") {
      const acct = line.accountNumber;
      const a = agg.get(acct);
      if (!visible(acct)) continue;
      const monthly = a ? a.monthly : new Array(len).fill(null);
      const isActualByMonth = a
        ? a.isActualByMonth
        : new Array(len).fill(false);
      out.push({
        kind: "account",
        label: line.label,
        accountNumber: acct,
        memberAccountNumbers: [acct],
        accountName: a && a.name ? a.name : line.label,
        depth: line.depth,
        specRow: line.specRow,
        monthly,
        isActualByMonth,
        total: a ? monthly.reduce((s, v) => s + toNumber(v), 0) : null,
        hasData: !!a,
        absentByMonth: a ? absentByMonthFor(a, len) : new Array(len).fill(true),
        amountPresentByMonth: a
          ? a.amountPresentByMonth.slice()
          : new Array(len).fill(false),
        budgetSourcePresent: a ? a.budgetSourcePresent : null,
        actualsSourcePresent: a ? a.actualsSourcePresent : null,
        isUnbudgeted: !!a && a.budgetSourcePresent === false,
        ...(measureSpecs
          ? {
              measures: emitMeasures(
                measureSpecs,
                a ? a.byMeasure : null,
                len,
                null,
                a && preserveNullMeasures
                  ? { covered: a.measureCovered, uncovered: a.measureUncovered }
                  : null,
              ),
            }
          : {}),
      });
    } else if (line.kind === "subtotal") {
      const live = line.leafSpecRows.filter((r) => liveSpecRows.has(r));
      if (
        live.length === 0 &&
        (hideZeroBalanceAccounts || !includeEmptyAccounts)
      )
        continue;
      const monthly = new Array(len).fill(0);
      const subMeasures = measureSpecs
        ? blankMeasureAcc(measureSpecs, len)
        : null;
      const subCovered =
        measureSpecs && preserveNullMeasures
          ? blankMeasureAcc(measureSpecs, len)
          : null;
      const subUncovered =
        measureSpecs && preserveNullMeasures
          ? blankMeasureAcc(measureSpecs, len)
          : null;
      const memberAccountNumbers = [];
      for (const specRow of line.leafSpecRows) {
        const acct = acctBySpecRow.get(specRow);
        if (acct == null) continue;
        const a = agg.get(acct);
        if (!a) continue;
        memberAccountNumbers.push(String(acct));
        for (let i = 0; i < len; i += 1) monthly[i] += a.monthly[i];
        if (measureSpecs) {
          for (const m of measureSpecs) {
            const src = a.byMeasure[m.key];
            const dst = subMeasures[m.key];
            for (let i = 0; i < len; i += 1) dst[i] += src[i];
            if (subCovered) {
              for (let i = 0; i < len; i += 1) {
                subCovered[m.key][i] += a.measureCovered[m.key][i];
                subUncovered[m.key][i] += a.measureUncovered[m.key][i];
              }
            }
          }
        }
      }
      out.push({
        kind: "subtotal",
        label: line.label,
        accountNumber: null,
        depth: line.depth,
        specRow: line.specRow,
        isGrandTotal: line.isGrandTotal,
        monthly,
        total: monthly.reduce((s, v) => s + v, 0),
        hasData: true,
        memberAccountNumbers,
        ...(measureSpecs
          ? {
              measures: emitMeasures(
                measureSpecs,
                subMeasures,
                len,
                null,
                subCovered
                  ? { covered: subCovered, uncovered: subUncovered }
                  : null,
              ),
            }
          : {}),
      });
    } else {
      out.push({
        kind: "header",
        headerKind: line.headerKind,
        label: line.label,
        accountNumber: null,
        depth: line.depth,
        specRow: line.specRow,
        boundSubtotalLabel: line.boundSubtotalLabel,
        monthly: new Array(len).fill(null),
        total: null,
        hasData: false,
        ...(measureSpecs
          ? { measures: emitMeasures(measureSpecs, null, len, null) }
          : {}),
      });
    }
  }

  const survivingSubtotals = new Set(
    out.filter((r) => r.kind === "subtotal").map((r) => r.label),
  );
  const pruned = out.filter((row) => {
    if (row.kind !== "header") return true;
    if (!row.boundSubtotalLabel) return true;
    return survivingSubtotals.has(row.boundSubtotalLabel);
  });

  const orphans = [...orphanSet.entries()]
    .filter(
      ([, a]) =>
        !hideZeroBalanceAccounts || a.monthly.some((v) => !isDisplayZero(v)),
    )
    .map(([acct, a]) => ({
      account_number: acct,
      account_name: a.name || "",
      noi_section: a.noi_section || null,
      monthly: a.monthly,
      isActualByMonth: a.isActualByMonth,
      absentByMonth: absentByMonthFor(a, len),
      amountPresentByMonth: a.amountPresentByMonth.slice(),
      total: a.monthly.reduce((s, v) => s + toNumber(v), 0),
      budgetSourcePresent:
        a.budgetSourcePresent === undefined ? null : a.budgetSourcePresent,
      actualsSourcePresent:
        a.actualsSourcePresent === undefined ? null : a.actualsSourcePresent,
      isUnbudgeted: a.budgetSourcePresent === false,
    }))
    .sort((a, b) =>
      String(a.account_number).localeCompare(
        String(b.account_number),
        undefined,
        { numeric: true },
      ),
    );

  return {
    axis,
    rows: pruned,
    orphans,
    excluded,
    hasData: pruned.some((r) => r.kind === "account"),
    unparseable: template.unparseable,
  };
}

export function layoutWritebackGroups({
  specRows,
  groups,
  balanceSheetAccounts = null,
  respectProductionBand = true,
} = {}) {
  const template = compileCoaTemplate(specRows);
  const src = Array.isArray(groups) ? groups.filter(Boolean) : [];
  const monthCount = src.length ? (src[0].monthlyAmounts || []).length : 0;

  const bsSet =
    balanceSheetAccounts instanceof Set
      ? balanceSheetAccounts
      : Array.isArray(balanceSheetAccounts)
        ? new Set(balanceSheetAccounts.map(String))
        : null;

  const inStatement = new Map();
  const routedOut = [];
  for (const g of src) {
    const acct = String(g.glAccountNumber);
    const section = g.noiSection || "below_noi";
    const templateLine = template.accountRows.get(acct);
    if (
      !templateLine ||
      !COA_STATEMENT_SECTIONS.includes(section) ||
      (bsSet && bsSet.has(acct)) ||
      (respectProductionBand &&
        template.bandByAccount.get(acct) &&
        template.bandByAccount.get(acct) !== section)
    ) {
      routedOut.push(g);
      continue;
    }
    inStatement.set(acct, g);
  }

  const acctBySpecRow = new Map();
  for (const line of template.accountRows.values()) {
    if (inStatement.has(line.accountNumber))
      acctBySpecRow.set(line.specRow, line.accountNumber);
  }

  const out = [];
  for (const line of template.lines) {
    if (line.kind === "account") {
      const g = inStatement.get(line.accountNumber);
      if (!g) continue;
      out.push({
        kind: "account",
        label: line.label,
        depth: line.depth,
        group: g,
      });
    } else if (line.kind === "subtotal") {
      const members = line.leafSpecRows
        .map((r) => acctBySpecRow.get(r))
        .filter(Boolean);
      if (members.length === 0) continue;
      const monthlyAmounts = new Array(monthCount).fill(0);
      let totalAmount = 0;
      for (const acct of members) {
        const g = inStatement.get(acct);
        if (!g) continue;
        for (let i = 0; i < monthCount; i += 1) {
          const v = Number(g.monthlyAmounts[i]);
          if (Number.isFinite(v)) monthlyAmounts[i] += v;
        }
        totalAmount += Number.isFinite(Number(g.totalAmount))
          ? Number(g.totalAmount)
          : 0;
      }
      out.push({
        kind: "subtotal",
        label: line.label,
        depth: line.depth,
        isGrandTotal: line.isGrandTotal,
        monthlyAmounts,
        totalAmount,
      });
    } else {
      out.push({
        kind: "header",
        headerKind: line.headerKind,
        label: line.label,
        depth: line.depth,
        boundSubtotalLabel: line.boundSubtotalLabel,
      });
    }
  }

  const surviving = new Set(
    out.filter((r) => r.kind === "subtotal").map((r) => r.label),
  );
  const rows = out.filter(
    (r) =>
      r.kind !== "header" ||
      !r.boundSubtotalLabel ||
      surviving.has(r.boundSubtotalLabel),
  );

  return { rows, routedOut, monthCount };
}

export const COA_ABSENCE_LEGEND = Object.freeze({
  caption:
    'Showing the full chart of accounts. Toggle "Hide zero balance accounts" to drop rows with nothing on them.',
  blank: "Blank — no budget or actual row exists for that month.",
  zero: "Dash — a row exists and rounds to zero. A budgeted zero is a fact, not missing data.",
  rounded:
    "Dash — a real amount smaller than half a cent. Too small for the grid to print as a figure, but not a zero and not missing data.",
  unbudgetedChip: "no budget",
  unbudgetedChipTitle:
    "This account has no forward budget rows for this property. Its forward months are blank rather than zero, because nobody budgeted it.",
  subtotalZero:
    "Dash — the accounts in this group sum to zero for that month. A subtotal has no source row of its own, so this is arithmetic, not a missing row.",
});

export function coaAbsenceCellTitle({ absent = false, value = null } = {}) {
  if (absent) return COA_ABSENCE_LEGEND.blank;
  const n = Number(value);
  if (
    value !== null &&
    value !== "" &&
    Number.isFinite(n) &&
    budgetCellIsDash(n)
  ) {
    return n === 0 ? COA_ABSENCE_LEGEND.zero : COA_ABSENCE_LEGEND.rounded;
  }
  return undefined;
}

export function coaSubtotalCellTitle(value) {
  const n = Number(value);
  if (
    value !== null &&
    value !== "" &&
    value !== undefined &&
    Number.isFinite(n) &&
    budgetCellIsDash(n)
  ) {
    return COA_ABSENCE_LEGEND.subtotalZero;
  }
  return undefined;
}

export const COA_ORPHAN_NOTE =
  "In the data, not in the statement template — shown here so a new account code cannot vanish. Not included in any subtotal above.";
