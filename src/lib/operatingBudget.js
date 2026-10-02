export const OPERATING_BUDGET_ROLES = {
  "gross revenue": "revenue",
  "vacancy loss": "contraRevenue",
  "effective revenue": "subtotal",
  "property taxes": "opex",
  insurance: "opex",
  utilities: "opex",
  maintenance: "opex",
  management: "opex",
  noi: "subtotal",
  "debt service": "financing",
  "cash flow": "subtotal",
};

export function operatingBudgetRole(item) {
  const byName =
    OPERATING_BUDGET_ROLES[
      String((item && item.lineItem) || "")
        .trim()
        .toLowerCase()
    ];
  if (byName) return byName;
  const category = String((item && item.category) || "")
    .trim()
    .toLowerCase();
  if (category === "noi" || category === "cf") return "subtotal";
  if (category === "revenue") return "revenue";
  return "opex";
}

export function operatingBudgetVariance(item) {
  const budget = Number(item && item.budget) || 0;
  const actual = Number(item && item.actual) || 0;
  const role = operatingBudgetRole(item);
  const higherIsBetter = role === "revenue" || role === "subtotal";
  const delta = higherIsBetter ? actual - budget : budget - actual;
  return {
    delta,
    pct: budget ? (delta / Math.abs(budget)) * 100 : 0,
    favorable: delta >= 0,
  };
}

export function groupOperatingBudgetRows(rows) {
  const byProperty = new Map();
  for (const row of rows) {
    const property = (row && row.property) || "";
    if (!property) continue;
    if (!byProperty.has(property)) byProperty.set(property, []);
    byProperty.get(property).push(row);
  }
  return Array.from(byProperty.entries()).map(([property, propertyRows]) => {
    const latestYear = propertyRows.reduce(
      (max, r) => Math.max(max, Number(r.fiscalYear) || 0),
      0,
    );
    const byLineItem = new Map();
    for (const row of propertyRows) {
      if ((Number(row.fiscalYear) || 0) !== latestYear) continue;
      const key = String(row.lineItem || "")
        .trim()
        .toLowerCase();
      const existing = byLineItem.get(key);
      if (existing) {
        existing.budget += Number(row.budget) || 0;
        existing.actual += Number(row.actual) || 0;
      } else {
        byLineItem.set(key, {
          lineItem: row.lineItem || "",
          category: row.category || "",
          budget: Number(row.budget) || 0,
          actual: Number(row.actual) || 0,
        });
      }
    }
    return {
      property,
      fiscalYear: latestYear,
      items: Array.from(byLineItem.values()),
    };
  });
}

export function normalizeOperatingBudgets(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const first = rows[0];
  if (first && Array.isArray(first.items)) return rows;
  return groupOperatingBudgetRows(rows);
}

export function operatingBudgetRollup(items) {
  const build = (field) => {
    const sumRole = (role) =>
      (items || [])
        .filter((item) => operatingBudgetRole(item) === role)
        .reduce((sum, item) => sum + (Number(item[field]) || 0), 0);
    const revenue = sumRole("revenue");
    const contraRevenue = sumRole("contraRevenue");
    const operatingExpenses = sumRole("opex");
    const financing = sumRole("financing");
    const effectiveRevenue = revenue - contraRevenue;
    const noi = effectiveRevenue - operatingExpenses;
    return {
      effectiveRevenue,
      operatingExpenses,
      noi,
      cashFlow: noi - financing,
    };
  };
  return { budget: build("budget"), actual: build("actual") };
}

export function operatingBudgetNaiveTotal(items, field) {
  return (items || []).reduce(
    (sum, item) => sum + (Number(item[field]) || 0),
    0,
  );
}

export function operatingBudgetReconciliation(items, rollup) {
  const stored = (name) =>
    (items || []).find(
      (item) =>
        String(item.lineItem || "")
          .trim()
          .toLowerCase() === name,
    );
  const checks = [
    ["effective revenue", "effectiveRevenue"],
    ["noi", "noi"],
    ["cash flow", "cashFlow"],
  ];
  const mismatched = [];
  for (const [name, key] of checks) {
    const row = stored(name);
    if (!row) continue;
    for (const field of ["budget", "actual"]) {
      const storedValue = Number(row[field]) || 0;
      const computed = rollup[field][key];
      const scale = Math.max(Math.abs(storedValue), Math.abs(computed), 1);
      if (Math.abs(storedValue - computed) / scale > 0.001) {
        mismatched.push(`${row.lineItem} (${field})`);
        break;
      }
    }
  }
  return mismatched;
}
