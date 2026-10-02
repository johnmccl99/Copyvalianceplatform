export const PROPERTY_TAB_STRUCTURE = [
  {
    key: "overview",
    label: "Overview",
    roles: ["gp"],
    subTabs: [
      { key: "dashboard", label: "Dashboard", roles: ["gp"] },
      { key: "reportingEngine", label: "Reporting Engine", roles: ["gp"] },
    ],
  },
  {
    key: "transactions",
    label: "Transactions",
    roles: ["gp"],
    subTabs: [
      { key: "acquisition", label: "Acquisition", roles: ["gp"] },
      { key: "refinance", label: "Refinance", roles: ["gp"] },
      { key: "recapitalization", label: "Recapitalization", roles: ["gp"] },
      { key: "disposition", label: "Disposition", roles: ["gp"] },
      { key: "fileStorage", label: "File Storage", roles: ["gp"] },
    ],
  },
  {
    key: "assetManagement",
    label: "Asset Management",
    roles: ["gp"],
    subTabs: [
      { key: "leasing", label: "Leasing", roles: ["gp"] },
      { key: "operations", label: "Operations", roles: ["gp"] },
      { key: "incomeExpenses", label: "Income & Expenses", roles: ["gp"] },
      {
        key: "capexConstruction",
        label: "CapEx & Construction",
        roles: ["gp"],
      },
      { key: "fileStorage", label: "File Storage", roles: ["gp"] },
    ],
  },
  {
    key: "capitalStack",
    label: "Capital Stack",
    roles: ["gp"],
    subTabs: [
      { key: "stackOverview", label: "Stack Overview", roles: ["gp"] },
      { key: "debt", label: "Debt", roles: ["gp"] },
      { key: "equity", label: "Equity", roles: ["gp"] },
      { key: "fileStorage", label: "File Storage", roles: ["gp"] },
    ],
  },
  {
    key: "strategy",
    label: "Strategy & Analytics",
    roles: ["gp"],
    subTabs: [
      { key: "scenarioModeling", label: "Scenario Modeling", roles: ["gp"] },
      { key: "risk", label: "Risk Dashboard", roles: ["gp"] },
      { key: "taxStrategy", label: "Tax Strategy", roles: ["gp"] },
      { key: "capMarkets", label: "Capital Markets", roles: ["gp"] },
      { key: "esgGresb", label: "ESG & GRESB", roles: ["gp"] },
      { key: "market", label: "Market & Benchmarking", roles: ["gp"] },
      { key: "fileStorage", label: "File Storage", roles: ["gp"] },
    ],
  },
];

export function getVisiblePropertyTabs(tabs, role) {
  return tabs.filter(
    (t) => !t.roles || role === "admin" || t.roles.includes(role),
  );
}
