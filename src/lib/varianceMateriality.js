import { pctChange } from "./variancePercent.js";
import { isActivityAmount } from "./varianceRowActivity.js";

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function collapseToAccounts(rows, preserveNulls = false) {
  const covered = (v) =>
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  const byAcct = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const key = r.account_number;
    if (key == null) continue;
    let a = byAcct.get(key);
    if (!a) {
      a = {
        account_number: r.account_number,
        account_name: r.account_name ?? null,
        noi_build_bucket: r.noi_build_bucket ?? null,
        noi_section: r.noi_section ?? null,
        budget: 0,
        actual: 0,
        contributingRows: 0,
      };
      byAcct.set(key, a);
    }
    if (a.noi_build_bucket == null && r.noi_build_bucket != null)
      a.noi_build_bucket = r.noi_build_bucket;
    if (a.account_name == null && r.account_name != null)
      a.account_name = r.account_name;
    if (a.noi_section == null && r.noi_section != null)
      a.noi_section = r.noi_section;
    const rawBudget = r.budget_amount != null ? r.budget_amount : r.budget;
    const rawActual = r.actual_amount != null ? r.actual_amount : r.actual;
    if (preserveNulls && !(covered(rawBudget) && covered(rawActual))) continue;
    a.budget += num(rawBudget);
    a.actual += num(rawActual);
    a.contributingRows += 1;
  }
  return [...byAcct.values()]
    .filter((a) => !preserveNulls || a.contributingRows > 0)
    .map((a) => ({
      ...a,
      variance: a.actual - a.budget,
      pct: pctChange(a.actual, a.budget),
    }));
}

function groupKeyFor(account) {
  const bucket = account.noi_build_bucket;
  if (bucket == null || String(bucket).trim() === "") {
    return `__singleton__:${account.account_number}`;
  }
  return String(bucket);
}

export function classifyMateriality(
  coaRows,
  {
    groupPctThreshold = 5,
    accountPctThreshold = 10,
    preserveNulls = false,
  } = {},
) {
  const byAccount = new Map();
  const byGroup = new Map();
  const groups = [];

  const accounts = collapseToAccounts(coaRows, preserveNulls);

  const grouped = new Map();
  for (const a of accounts) {
    const gk = groupKeyFor(a);
    let g = grouped.get(gk);
    if (!g) {
      g = {
        key: gk,
        bucket:
          a.noi_build_bucket == null || String(a.noi_build_bucket).trim() === ""
            ? null
            : a.noi_build_bucket,
        accounts: [],
      };
      grouped.set(gk, g);
    }
    g.accounts.push(a);
  }

  for (const g of grouped.values()) {
    const gBudget = g.accounts.reduce((s, a) => s + a.budget, 0);
    const gActual = g.accounts.reduce((s, a) => s + a.actual, 0);
    const gVariance = gActual - gBudget;
    const gPct = pctChange(gActual, gBudget);

    const groupRed = isActivityAmount(gBudget)
      ? Math.abs(gPct) > groupPctThreshold
      : isActivityAmount(gActual);

    byGroup.set(g.key, groupRed ? "red" : null);

    const accountFlags = g.accounts.map((a) => {
      let flag = null;
      if (groupRed) {
        flag = "red";
      } else {
        const acctMaterial = isActivityAmount(a.budget)
          ? Math.abs(a.pct) > accountPctThreshold
          : isActivityAmount(a.actual);
        flag = acctMaterial ? "orange" : null;
      }
      byAccount.set(a.account_number, flag);
      return {
        account_number: a.account_number,
        account_name: a.account_name,
        budget: a.budget,
        actual: a.actual,
        variance: a.variance,
        pct: a.pct,
        flag,
      };
    });

    groups.push({
      noi_build_bucket: g.bucket,
      budget: gBudget,
      actual: gActual,
      variance: gVariance,
      pct: gPct,
      flag: groupRed ? "red" : null,
      accounts: accountFlags,
    });
  }

  return { groups, byAccount, byGroup };
}

export default classifyMateriality;
