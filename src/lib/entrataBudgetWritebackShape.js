export const MONTH_COUNT = 60;
export const FISCAL_YEAR_COUNT = 5;
export const MONTHS_PER_FISCAL_YEAR = 12;

export const BUDGET_YEAR_ANCHOR = 2024;

export function filterForwardBudgetCells(coaRows) {
  if (!Array.isArray(coaRows)) return [];
  return coaRows.filter((r) => r && r.is_actual !== true);
}

export function buildPriorMonthCells(itemizedRows, forwardRows) {
  if (!Array.isArray(itemizedRows)) return [];
  const meta = new Map();
  for (const r of Array.isArray(forwardRows) ? forwardRows : []) {
    const key = r && r.account_number != null ? String(r.account_number) : null;
    if (key && !meta.has(key)) {
      meta.set(key, {
        account_name: r.account_name ?? null,
        noi_build_bucket: r.noi_build_bucket ?? null,
        noi_section: r.noi_section ?? null,
      });
    }
  }
  const out = [];
  for (const r of itemizedRows) {
    if (!r || r.is_actual !== true) continue;
    const m = meta.get(String(r.account_number)) || {};
    out.push({
      account_number: r.account_number,
      account_name: m.account_name ?? null,
      noi_build_bucket: m.noi_build_bucket ?? null,
      noi_section: m.noi_section ?? null,
      month_index: r.month_index,
      month_end: r.month_end,
      amount: r.amount,
      is_actual: r.is_actual,
      prior_month: true,
    });
  }
  return out;
}

export function realizedMonthSlots(sliceRows, fiscalYearIndex) {
  const i = Number(fiscalYearIndex);
  const realized = new Array(MONTHS_PER_FISCAL_YEAR).fill(false);
  const forward = new Array(MONTHS_PER_FISCAL_YEAR).fill(false);
  if (!Array.isArray(sliceRows) || !Number.isFinite(i)) {
    return { realized, mixed: [] };
  }
  const lo = i * MONTHS_PER_FISCAL_YEAR;
  for (const row of sliceRows) {
    if (!row) continue;
    const slot = Number(row.month_index) - lo;
    if (!Number.isFinite(slot) || slot < 0 || slot >= MONTHS_PER_FISCAL_YEAR)
      continue;
    if (row.is_actual === true) realized[slot] = true;
    else forward[slot] = true;
  }
  const mixed = [];
  for (let s = 0; s < MONTHS_PER_FISCAL_YEAR; s += 1) {
    if (realized[s] && forward[s]) mixed.push(s);
  }
  return { realized, mixed };
}

export function fiscalYearIndexForMonth(monthIndex) {
  const i = Number(monthIndex);
  if (!Number.isFinite(i) || i < 0 || i >= MONTH_COUNT) return -1;
  return Math.floor(i / MONTHS_PER_FISCAL_YEAR);
}

export function sliceFiscalYear(rows, fiscalYearIndex) {
  if (!Array.isArray(rows)) return [];
  const i = Number(fiscalYearIndex);
  if (!Number.isFinite(i) || i < 0 || i >= FISCAL_YEAR_COUNT) return [];
  const lo = i * MONTHS_PER_FISCAL_YEAR;
  const hi = lo + MONTHS_PER_FISCAL_YEAR;
  return rows.filter((r) => {
    const m = Number(r && r.month_index);
    return Number.isFinite(m) && m >= lo && m < hi;
  });
}

export function inferBudgetYearFromSlice(sliceRows, fiscalYearIndex) {
  void sliceRows;
  const i = Number(fiscalYearIndex);
  if (!Number.isFinite(i) || i < 0 || i >= FISCAL_YEAR_COUNT) return null;
  return BUDGET_YEAR_ANCHOR + i;
}

export function groupByGlAccount(sliceRows, fiscalYearIndex) {
  const i = Number(fiscalYearIndex);
  if (!Array.isArray(sliceRows) || !Number.isFinite(i)) return [];
  const lo = i * MONTHS_PER_FISCAL_YEAR;

  const byAccount = new Map();
  for (const row of sliceRows) {
    if (!row || row.account_number == null) continue;
    const acctNum = String(row.account_number);
    const slot = Number(row.month_index) - lo;
    if (!Number.isFinite(slot) || slot < 0 || slot >= MONTHS_PER_FISCAL_YEAR)
      continue;

    let entry = byAccount.get(acctNum);
    if (!entry) {
      entry = {
        glAccountNumber: acctNum,
        glAccountName: row.account_name == null ? "" : String(row.account_name),
        noiSection: row.noi_section == null ? null : String(row.noi_section),
        noiBuildBucket:
          row.noi_build_bucket == null ? null : String(row.noi_build_bucket),
        monthlyAmounts: new Array(MONTHS_PER_FISCAL_YEAR).fill(0),
        monthsPresent: new Array(MONTHS_PER_FISCAL_YEAR).fill(false),
        monthsRealized: new Array(MONTHS_PER_FISCAL_YEAR).fill(false),
        monthEnds: new Array(MONTHS_PER_FISCAL_YEAR).fill(null),
        totalAmount: 0,
      };
      byAccount.set(acctNum, entry);
    }
    const amt = Number(row.amount);
    if (Number.isFinite(amt)) {
      entry.monthlyAmounts[slot] = amt;
      entry.monthsPresent[slot] = true;
      entry.monthsRealized[slot] = row.is_actual === true;
      entry.monthEnds[slot] =
        row.month_end == null ? null : String(row.month_end);
    }
  }

  for (const entry of byAccount.values()) {
    let sum = 0;
    for (const v of entry.monthlyAmounts) sum += Number.isFinite(v) ? v : 0;
    entry.totalAmount = sum;
  }

  return [...byAccount.values()].sort((a, b) =>
    a.glAccountNumber.localeCompare(b.glAccountNumber, undefined, {
      numeric: true,
    }),
  );
}

export function attachEntrataGlAccountIds(groups, glAccountIdByNumber) {
  if (!Array.isArray(groups)) return [];
  const map =
    glAccountIdByNumber && typeof glAccountIdByNumber === "object"
      ? glAccountIdByNumber
      : {};
  return groups.map((g) => {
    const id =
      g && g.glAccountNumber != null ? map[g.glAccountNumber] : undefined;
    return {
      ...g,
      glAccountId: id == null || id === "" ? null : id,
    };
  });
}

export function toEntrataMonthToken(monthEnd) {
  if (monthEnd == null) return null;
  const m = /^(\d{4})-(\d{2})/.exec(String(monthEnd));
  if (!m) return null;
  return `${m[2]}/${m[1]}`;
}

export function formatEntrataAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 100) / 100);
}

export function entrataSignedAmount(amount, glAccountNumber) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  const acctNum = Number(glAccountNumber);
  const flip =
    Number.isFinite(acctNum) &&
    acctNum >= 50000 &&
    String(glAccountNumber) !== "80013";
  return flip ? -n : n;
}

function toEntrataIntId(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

export function buildEntrataBudgetEnvelope({
  entrataPropertyId,
  budgetId,
  groups,
  requestId,
}) {
  const glAccount = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || g.glAccountId == null) continue;
    const idInt = toEntrataIntId(g.glAccountId);
    const amounts = Array.isArray(g.monthlyAmounts) ? g.monthlyAmounts : [];
    const present = Array.isArray(g.monthsPresent) ? g.monthsPresent : [];
    const monthEnds = Array.isArray(g.monthEnds) ? g.monthEnds : [];
    for (let s = 0; s < MONTHS_PER_FISCAL_YEAR; s += 1) {
      if (!present[s]) continue;
      const month = toEntrataMonthToken(monthEnds[s]);
      if (month == null) continue;
      glAccount.push({
        id: idInt,
        budgetMonths: {
          budgetMonth: [
            {
              month,
              amount: formatEntrataAmount(
                entrataSignedAmount(amounts[s], g.glAccountNumber),
              ),
            },
          ],
        },
      });
    }
  }

  return {
    requestId:
      requestId == null ? `cre-writeback-${Date.now()}` : String(requestId),
    auth: { type: "apikey" },
    method: {
      name: "updateBudgets",
      params: {
        propertyId: toEntrataIntId(entrataPropertyId),
        budgets: {
          budget: [
            {
              budgetId: toEntrataIntId(budgetId),
              glAccounts: { glAccount },
            },
          ],
        },
      },
    },
  };
}

export function summarizeEnvelope(envelope, groups) {
  const groupsArr = Array.isArray(groups) ? groups : [];
  const accountsTotal = groupsArr.length;
  const accountsWithId = groupsArr.filter(
    (g) => g && g.glAccountId != null,
  ).length;
  const accountsMissingId = accountsTotal - accountsWithId;
  let monthsCovered = 0;
  let totalAbsAmount = 0;
  for (const g of groupsArr) {
    if (Array.isArray(g.monthsPresent)) {
      for (const present of g.monthsPresent) if (present) monthsCovered += 1;
    }
    if (Array.isArray(g.monthlyAmounts)) {
      for (const v of g.monthlyAmounts)
        totalAbsAmount += Math.abs(Number.isFinite(v) ? v : 0);
    }
  }
  const params =
    envelope && envelope.method && envelope.method.params
      ? envelope.method.params
      : null;
  const budget =
    params && params.budgets && Array.isArray(params.budgets.budget)
      ? params.budgets.budget[0]
      : null;
  return {
    propertyId: params ? (params.propertyId ?? null) : null,
    budgetId: budget ? (budget.budgetId ?? null) : null,
    accountsTotal,
    accountsWithId,
    accountsMissingId,
    monthsCovered,
    totalAbsAmount,
  };
}

export function summarizeAvailableFiscalYears(coaRows) {
  const out = [];
  const forward = filterForwardBudgetCells(coaRows);
  const realized = Array.isArray(coaRows)
    ? coaRows.filter((r) => r && r.is_actual === true)
    : [];
  for (let fy = 0; fy < FISCAL_YEAR_COUNT; fy += 1) {
    const slice = sliceFiscalYear(forward, fy);
    const realizedSlice = sliceFiscalYear(realized, fy);
    const budgetYear = inferBudgetYearFromSlice(slice, fy);
    out.push({
      fiscalYearIndex: fy,
      budgetYear,
      forwardRowCount: slice.length,
      hasForwardBudget: slice.length > 0,
      realizedRowCount: realizedSlice.length,
      hasRealizedMonths: realizedSlice.length > 0,
    });
  }
  return out;
}

export function fiscalYearSelectionState({
  availability = [],
  priorAvailability = [],
  includePriorMonths = false,
} = {}) {
  const byFy = (list, fy) =>
    (Array.isArray(list)
      ? list.find((x) => x && x.fiscalYearIndex === fy)
      : null) || {};
  const out = [];
  for (let fy = 0; fy < FISCAL_YEAR_COUNT; fy += 1) {
    const a = byFy(availability, fy);
    const p = byFy(priorAvailability, fy);
    const hasForward = a.hasForwardBudget === true;
    const hasPrior = p.hasRealizedMonths === true;
    const optedIn = includePriorMonths === true;
    out.push({
      fiscalYearIndex: fy,
      budgetYear: a.budgetYear ?? p.budgetYear ?? null,
      hasForward,
      hasPrior,
      forwardRowCount: a.forwardRowCount || 0,
      priorRowCount: p.realizedRowCount || 0,
      selectable: hasForward || (optedIn && hasPrior),
      priorOnly: !hasForward && optedIn && hasPrior,
    });
  }
  return out;
}
