import { supabase } from "./supabaseClient.js";

export async function fetchStatementProperties() {
  const { data, error } = await supabase.rpc("get_statement_properties");
  if (error) {
    console.error("fetchStatementProperties error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchIncomeStatement(propertyCode, monthFrom, monthTo) {
  if (!propertyCode || !monthFrom || !monthTo) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_income_statement", {
    p_property_code: propertyCode,
    p_month_from: monthFrom,
    p_month_to: monthTo,
  });
  if (error) {
    console.error("fetchIncomeStatement error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchBalanceSheet(propertyCode, asOf) {
  if (!propertyCode || !asOf) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_balance_sheet", {
    p_property_code: propertyCode,
    p_as_of: asOf,
  });
  if (error) {
    console.error("fetchBalanceSheet error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchAccountBalanceDetail(propertyCode, accountNumber) {
  if (!propertyCode || !accountNumber) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_account_balance_detail", {
    p_property_code: propertyCode,
    p_account_number: accountNumber,
  });
  if (error) {
    console.error("fetchAccountBalanceDetail error:", error);
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function fetchNoiSectionMap() {
  const { data, error } = await supabase
    .from("noi_build_categories")
    .select("bucket_name, section");
  if (error) {
    console.error("fetchNoiSectionMap error:", error);
    return { data: {}, error };
  }
  const map = {};
  for (const row of data || []) map[row.bucket_name] = row.section;
  return { data: map, error: null };
}

export async function fetchGlTreeAccountCount() {
  const { count, error } = await supabase
    .from("entrata_gl_tree_accounts")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.error("fetchGlTreeAccountCount error:", error);
    return { data: null, error };
  }
  return { data: count ?? 0, error: null };
}

export function monthEndIso(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function lastClosedMonth(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}

export function shiftMonth(ym, n) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

function branchKey(row) {
  return row.branch_id != null
    ? `b${row.branch_id}`
    : `x${row.branch_name || "unassigned"}`;
}

function groupByBranch(rows) {
  const branches = new Map();
  for (const row of rows) {
    const key = branchKey(row);
    if (!branches.has(key)) {
      branches.set(key, {
        key,
        branchId: row.branch_id ?? null,
        branchName: row.branch_name || "Unassigned",
        position: row.branch_position ?? Number.MAX_SAFE_INTEGER,
        showSummaryRow: !!row.show_summary_row,
        summaryRowName: row.summary_row_name || null,
        accounts: new Map(),
      });
    }
    const branch = branches.get(key);
    const acctKey = row.account_number ?? `synthetic:${row.account_name}`;
    if (!branch.accounts.has(acctKey)) {
      branch.accounts.set(acctKey, {
        accountNumber: row.account_number ?? null,
        accountName: row.account_name || row.account_number || "",
        position: row.account_position ?? Number.MAX_SAFE_INTEGER,
        rows: [],
      });
    }
    branch.accounts.get(acctKey).rows.push(row);
  }
  return [...branches.values()]
    .map((b) => ({
      ...b,
      accounts: [...b.accounts.values()].sort(
        (a, z) =>
          a.position - z.position ||
          String(a.accountNumber).localeCompare(String(z.accountNumber)),
      ),
    }))
    .sort((a, z) => a.position - z.position);
}

const zeroByMonth = (months) => Object.fromEntries(months.map((m) => [m, 0]));

export const aboveNoi = (row) => row.above_noi !== false;

export const isAdjustment = (row) => row.is_adjustment === true;

export const OPERATING_INCOME_SECTION = "Operating Income";
export const OPERATING_EXPENSES_SECTION = "Operating Expenses";
export const OTHER_EXPENSES_SECTION = "Other Expenses";
export const ADJUSTMENTS_SECTION = "Adjustments";

export function buildIncomeStatement(rows, noiSectionMap = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const months = [...new Set(safeRows.map((r) => r.month_end))].sort();

  const sectionModel = (name, { sourceSection = name, filter = null } = {}) => {
    let sectionRows = safeRows.filter((r) => r.section === sourceSection);
    if (filter) sectionRows = sectionRows.filter(filter);
    const branches = groupByBranch(sectionRows).map((b) => {
      const accounts = b.accounts.map((a) => {
        const byMonth = zeroByMonth(months);
        const monthsPresent = Object.fromEntries(months.map((m) => [m, false]));
        for (const r of a.rows) {
          byMonth[r.month_end] =
            (byMonth[r.month_end] || 0) + (Number(r.amount) || 0);
          monthsPresent[r.month_end] = true;
        }
        const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
        return { ...a, byMonth, monthsPresent, total };
      });
      const subtotal = zeroByMonth(months);
      for (const a of accounts)
        for (const m of months) subtotal[m] += a.byMonth[m];
      return {
        ...b,
        accounts,
        subtotal: {
          byMonth: subtotal,
          total: Object.values(subtotal).reduce((s, v) => s + v, 0),
        },
      };
    });
    const totalByMonth = zeroByMonth(months);
    for (const b of branches)
      for (const m of months) totalByMonth[m] += b.subtotal.byMonth[m];
    return {
      name,
      branches,
      collapsed: branches.length === 1 && branches[0].branchName === name,
      total: {
        byMonth: totalByMonth,
        total: Object.values(totalByMonth).reduce((s, v) => s + v, 0),
      },
    };
  };

  const income = sectionModel(OPERATING_INCOME_SECTION, {
    sourceSection: "Income",
  });

  const expenses = sectionModel("Expenses");
  const operatingExpenses = sectionModel(OPERATING_EXPENSES_SECTION, {
    sourceSection: "Expenses",
    filter: (r) => !isAdjustment(r) && aboveNoi(r),
  });
  const otherExpenses = sectionModel(OTHER_EXPENSES_SECTION, {
    sourceSection: "Expenses",
    filter: (r) => !isAdjustment(r) && !aboveNoi(r),
  });
  const adjustments = sectionModel(ADJUSTMENTS_SECTION, {
    sourceSection: "Expenses",
    filter: isAdjustment,
  });

  const noiByMonth = zeroByMonth(months);
  const noiMonthsPresent = Object.fromEntries(months.map((m) => [m, false]));
  for (const r of safeRows) {
    const section = noiSectionMap[r.noi_return];
    if (section === "revenue" || section === "operating_expense") {
      noiByMonth[r.month_end] += Number(r.amount) || 0;
      noiMonthsPresent[r.month_end] = true;
    }
  }

  const adjustedNetIncomeByMonth = zeroByMonth(months);
  for (const m of months)
    adjustedNetIncomeByMonth[m] =
      income.total.byMonth[m] + expenses.total.byMonth[m];

  const netIncomeBeforeAdjByMonth = zeroByMonth(months);
  for (const m of months) {
    netIncomeBeforeAdjByMonth[m] =
      income.total.byMonth[m] +
      operatingExpenses.total.byMonth[m] +
      otherExpenses.total.byMonth[m];
  }

  const sumMonths = (byMonth) =>
    Object.values(byMonth).reduce((s, v) => s + v, 0);

  const monthOrigins = {};
  for (const r of safeRows) {
    if (r.origin != null && monthOrigins[r.month_end] == null) {
      monthOrigins[r.month_end] = r.origin === "api" ? "entrata" : "workbook";
    }
  }

  return {
    months,
    income,
    expenses,
    operatingExpenses,
    otherExpenses,
    adjustments,
    noi: {
      byMonth: noiByMonth,
      monthsPresent: noiMonthsPresent,
      total: sumMonths(noiByMonth),
    },
    netIncomeBeforeAdjustments: {
      byMonth: netIncomeBeforeAdjByMonth,
      total: sumMonths(netIncomeBeforeAdjByMonth),
    },
    adjustedNetIncome: {
      byMonth: adjustedNetIncomeByMonth,
      total: sumMonths(adjustedNetIncomeByMonth),
    },
    netIncome: {
      byMonth: adjustedNetIncomeByMonth,
      total: sumMonths(adjustedNetIncomeByMonth),
    },
    monthOrigins,
    hasNoiCoverage: safeRows.some((r) => noiSectionMap[r.noi_return] != null),
  };
}

export function buildBalanceSheet(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const asOf = safeRows.reduce(
    (max, r) =>
      r.balance_month && (!max || r.balance_month > max)
        ? r.balance_month
        : max,
    null,
  );

  const sectionModel = (name, displaySign) => {
    const sectionRows = safeRows.filter((r) => r.section === name);
    const branches = groupByBranch(sectionRows).map((b) => {
      const accounts = b.accounts.map((a) => {
        const wire = a.rows.reduce(
          (s, r) => s + (Number(r.closing_balance) || 0),
          0,
        );
        const missingBalances = a.rows.filter(
          (r) => r.closing_balance == null,
        ).length;
        return {
          accountNumber: a.accountNumber,
          accountName: a.accountName,
          position: a.position,
          wire,
          display: wire * displaySign,
          missingBalances,
          balancePresent: missingBalances === 0 && a.rows.length > 0,
          balanceMonth: a.rows[0]?.balance_month ?? null,
        };
      });
      const wire = accounts.reduce((s, a) => s + a.wire, 0);
      const missingBalances = accounts.reduce(
        (s, a) => s + a.missingBalances,
        0,
      );
      return {
        ...b,
        accounts,
        subtotal: {
          wire,
          display: wire * displaySign,
          missingBalances,
          balancePresent: missingBalances === 0,
        },
      };
    });
    const wire = branches.reduce((s, b) => s + b.subtotal.wire, 0);
    const missingBalances = branches.reduce(
      (s, b) => s + b.subtotal.missingBalances,
      0,
    );
    return {
      name,
      displaySign,
      branches,
      total: {
        wire,
        display: wire * displaySign,
        missingBalances,
        balancePresent: missingBalances === 0,
      },
    };
  };

  const assets = sectionModel("Assets", 1);
  const liabilities = sectionModel("Liabilities", -1);
  const equity = sectionModel("Equity", -1);

  const identityDelta =
    assets.total.wire + liabilities.total.wire + equity.total.wire;

  const missingBalances =
    assets.total.missingBalances +
    liabilities.total.missingBalances +
    equity.total.missingBalances;

  return {
    asOf,
    sections: [assets, liabilities, equity],
    identity: {
      assets: assets.total.wire,
      liabilitiesPlusEquity: -(liabilities.total.wire + equity.total.wire),
      delta: identityDelta,
      balanced: Math.abs(identityDelta) < 0.01,
      missingBalances,
      verifiable: missingBalances === 0,
    },
  };
}
