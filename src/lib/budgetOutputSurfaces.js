export const MONTH_COUNT = 60;

export const COA_SECTION_ORDER = [
  "revenue",
  "operating_expense",
  "below_noi",
  "asset",
  "liability",
  "equity",
];
export const BALANCE_SECTION_ORDER = ["asset", "liability", "equity"];
export const NOI_SECTION_LABELS = Object.freeze({
  revenue: "Revenue",
  operating_expense: "Operating Expense",
  below_noi: "Below NOI",
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
});

export const UNMAPPED_BUCKET_KEY = "(unmapped)";
export const UNMAPPED_BUCKET_LABEL = "No NOI category assigned";
export const UNMAPPED_BUCKET_SUBTOTAL_LABEL = "Total, no NOI category assigned";

export function bucketDisplayLabel(bucket) {
  return bucket === UNMAPPED_BUCKET_KEY ? UNMAPPED_BUCKET_LABEL : bucket;
}

function bucketSubtotalLabel(bucket) {
  if (bucket === UNMAPPED_BUCKET_KEY) return UNMAPPED_BUCKET_SUBTOTAL_LABEL;
  if (!bucket) return "Total";
  const trimmed = String(bucket).trim();
  if (!trimmed) return "Total";
  if (/^total\b/i.test(trimmed)) return trimmed;
  return `Total ${trimmed}`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function toNumber(v) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function foldPresence(previous, next) {
  if (next === true) return true;
  if (next === false) return previous === true ? true : false;
  return previous === undefined ? null : previous;
}

export function buildMonthAxis(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const idx = Number(r.month_index);
    if (!Number.isFinite(idx) || idx < 0) continue;
    if (!seen.has(idx)) seen.set(idx, r.month_end ?? null);
  }
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month_index, month_end]) => ({ month_index, month_end }));
}

function renderedFigure(row) {
  if (!row) return null;
  const raw =
    row.amount !== undefined && row.amount !== null
      ? row.amount
      : row.running_balance !== undefined && row.running_balance !== null
        ? row.running_balance
        : row.monthly_activity;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

export function firstFiguredMonthIndex(rows) {
  let first = null;
  for (const r of rows || []) {
    if (renderedFigure(r) === null) continue;
    const idx = Number(r.month_index);
    if (!Number.isFinite(idx)) continue;
    if (first === null || idx < first) first = idx;
  }
  return first;
}

export function trimLeadingEmptyMonths(rows, fromMonthIndex) {
  if (fromMonthIndex == null) return rows || [];
  return (rows || []).filter(
    (r) => r && Number(r.month_index) >= fromMonthIndex,
  );
}

export function monthKeyFromEnd(monthEnd) {
  const m = /^(\d{4})-(\d{2})/.exec(String(monthEnd || ""));
  return m ? `${m[1]}-${m[2]}` : null;
}

export function monthRangeOptions(rowSets) {
  const rows = [];
  for (const set of rowSets || []) for (const r of set || []) rows.push(r);
  return buildMonthAxis(rows)
    .map((m) => ({ ...m, key: monthKeyFromEnd(m.month_end) }))
    .filter((m) => m.key);
}

export function filterMonthRange(rows, fromYm, toYm, keyByIndex) {
  if (!fromYm && !toYm) return rows || [];
  return (rows || []).filter((r) => {
    if (!r) return false;
    const key =
      monthKeyFromEnd(r.month_end) ||
      (keyByIndex ? keyByIndex.get(Number(r.month_index)) : null);
    if (!key) return true;
    if (fromYm && key < fromYm) return false;
    if (toYm && key > toYm) return false;
    return true;
  });
}

export function trimmedLeadingMonthsNote(rows, fromMonthIndex) {
  if (fromMonthIndex == null) return null;
  const axis = buildMonthAxis(rows);
  if (axis.length === 0) return null;
  const cut = axis.findIndex((m) => m.month_index === fromMonthIndex);
  if (cut <= 0) return null;
  const windowStart = formatMonthLabel(axis[0].month_end);
  const first = formatMonthLabel(axis[cut].month_end);
  return (
    `The grid starts at ${first}, this property's first month carrying any figure. ` +
    `The ${cut === 1 ? "column" : `${cut} columns`} before it ${cut === 1 ? "belongs" : "belong"} to the v26 model window, ` +
    `which opens at ${windowStart}, and ${cut === 1 ? "is" : "are"} empty because the budget starts later — not because data ` +
    `is missing. Both statements here start at the same month, but that month is this property's own: ` +
    `these columns do not line up with another property's, or with the portfolio rollup, which is not trimmed to this property's start.`
  );
}

export function formatMonthLabel(monthEnd) {
  if (!monthEnd) return "";
  const m = /^(\d{4})-(\d{2})/.exec(String(monthEnd));
  if (!m) return String(monthEnd);
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return String(monthEnd);
  return `${MONTH_NAMES[monthIdx]} ${m[1]}`;
}

export function currentMonthMarkerValue(monthValues, now = new Date()) {
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let latestPast = null;
  let latestPastKey = "";
  for (const value of monthValues || []) {
    const m = /^(\d{4})-(\d{2})/.exec(String(value || ""));
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    if (key === nowKey) return value;
    if (key < nowKey && key > latestPastKey) {
      latestPast = value;
      latestPastKey = key;
    }
  }
  return latestPast;
}

function axisPositionMap(axis) {
  const m = new Map();
  for (let i = 0; i < axis.length; i++) m.set(axis[i].month_index, i);
  return m;
}

function compareAccountNumbers(a, b) {
  const sa = String(a == null ? "" : a);
  const sb = String(b == null ? "" : b);
  return sa.localeCompare(sb, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function synthesizeNoiBuildHierarchy(rows) {
  const axis = buildMonthAxis(rows);
  const len = axis.length;
  if (len === 0) {
    return { axis: [], rows: [], hasData: false };
  }
  const pos = axisPositionMap(axis);

  const byLine = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const col = pos.get(Number(r.month_index));
    if (col == null) continue;
    const lineId = r.line_id;
    if (lineId == null) continue;
    let entry = byLine.get(lineId);
    if (!entry) {
      entry = {
        line_id: lineId,
        display_order: Number(r.display_order ?? lineId),
        line_label: r.line_label || "",
        parent_group_label: r.parent_group_label || null,
        line_type: r.line_type || "detail",
        indent_level: Number(r.indent_level ?? 0),
        placeholder_tooltip: r.placeholder_tooltip || null,
        is_subtotal: Boolean(r.is_subtotal),
        monthly: new Array(len).fill(null),
        hasAmount: false,
      };
      byLine.set(lineId, entry);
    }
    if (r.amount != null) {
      for (let i = 0; i < entry.monthly.length; i++) {
        if (entry.monthly[i] == null) entry.monthly[i] = 0;
      }
      entry.monthly[col] = toNumber(r.amount);
      entry.hasAmount = true;
    }
  }

  const out = [];
  for (const entry of byLine.values()) {
    let total = null;
    if (entry.hasAmount) {
      total = 0;
      for (const v of entry.monthly) total += v == null ? 0 : v;
    }
    entry.total = total;
    out.push(entry);
  }

  out.sort((a, b) => a.display_order - b.display_order);

  return { axis, rows: out, hasData: out.length > 0 };
}

function appendTemplateOnlyAccounts(sectionMap, templateAccounts, makeRow) {
  if (!templateAccounts || templateAccounts.length === 0) return;
  const seen = new Set();
  for (const bucketMap of sectionMap.values()) {
    for (const acctMap of bucketMap.values()) {
      for (const acct of acctMap.keys()) seen.add(acct);
    }
  }
  for (const t of templateAccounts) {
    if (!t || t.account == null) continue;
    const acct = String(t.account);
    if (seen.has(acct)) continue;
    seen.add(acct);
    const section = t.section || "asset";
    if (!sectionMap.has(section)) sectionMap.set(section, new Map());
    const bucketMap = sectionMap.get(section);
    if (!bucketMap.has(UNMAPPED_BUCKET_KEY))
      bucketMap.set(UNMAPPED_BUCKET_KEY, new Map());
    bucketMap.get(UNMAPPED_BUCKET_KEY).set(acct, makeRow(acct, t.name || ""));
  }
}

export function groupCoaForGrid(rows, { templateAccounts = null } = {}) {
  const axis = buildMonthAxis(rows);
  const len = axis.length;
  if (len === 0) {
    return { axis: [], sections: [], hasData: false };
  }
  const pos = axisPositionMap(axis);

  const sectionMap = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const col = pos.get(Number(r.month_index));
    if (col == null) continue;
    const section = r.noi_section || "below_noi";
    const bucket = r.noi_build_bucket || UNMAPPED_BUCKET_KEY;
    const acct = r.account_number == null ? "" : String(r.account_number);
    if (!sectionMap.has(section)) sectionMap.set(section, new Map());
    const bucketMap = sectionMap.get(section);
    if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
    const acctMap = bucketMap.get(bucket);
    let row = acctMap.get(acct);
    if (!row) {
      row = {
        account_number: acct,
        account_name: r.account_name || "",
        monthly: new Array(len).fill(0),
        isActualByMonth: new Array(len).fill(false),
      };
      acctMap.set(acct, row);
    }
    if (!row.account_name && r.account_name) row.account_name = r.account_name;
    row.monthly[col] += toNumber(r.amount);
    if (r.is_actual) row.isActualByMonth[col] = true;
  }
  appendTemplateOnlyAccounts(sectionMap, templateAccounts, (acct, name) => ({
    account_number: acct,
    account_name: name,
    monthly: new Array(len).fill(null),
    isActualByMonth: new Array(len).fill(false),
    templateOnly: true,
  }));

  const sections = [];
  for (const sectionKey of COA_SECTION_ORDER) {
    if (!sectionMap.has(sectionKey)) continue;
    const bucketMap = sectionMap.get(sectionKey);
    const buckets = [...bucketMap.entries()].map(([bucket, acctMap]) => {
      const accounts = [...acctMap.values()]
        .sort((a, b) =>
          compareAccountNumbers(a.account_number, b.account_number),
        )
        .map((a) => ({
          account_number: a.account_number,
          account_name: a.account_name,
          monthly: a.monthly,
          isActualByMonth: a.isActualByMonth,
          total: a.templateOnly ? null : a.monthly.reduce((s, v) => s + v, 0),
          ...(a.templateOnly
            ? { templateOnly: true, absentByMonth: new Array(len).fill(true) }
            : {}),
        }));
      const subMonthly = new Array(len).fill(0);
      for (const a of accounts) {
        if (a.templateOnly) continue;
        for (let i = 0; i < len; i++) subMonthly[i] += a.monthly[i];
      }
      return {
        bucket,
        label: bucketDisplayLabel(bucket),
        accounts,
        subtotal: {
          label: bucketSubtotalLabel(bucket),
          monthly: subMonthly,
          total: subMonthly.reduce((s, v) => s + v, 0),
        },
      };
    });
    sections.push({
      key: sectionKey,
      label: NOI_SECTION_LABELS[sectionKey] || sectionKey,
      buckets,
    });
  }

  return { axis, sections, hasData: sections.length > 0 };
}

export function groupRunningBalancesForGrid(
  rows,
  { templateAccounts = null } = {},
) {
  const axis = buildMonthAxis(rows);
  const len = axis.length;
  if (len === 0) {
    return { axis: [], sections: [], hasData: false };
  }
  const pos = axisPositionMap(axis);

  const sectionMap = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const col = pos.get(Number(r.month_index));
    if (col == null) continue;
    const section = r.noi_section || "asset";
    const bucket = r.noi_build_bucket || UNMAPPED_BUCKET_KEY;
    const acct = r.account_number == null ? "" : String(r.account_number);
    if (!sectionMap.has(section)) sectionMap.set(section, new Map());
    const bucketMap = sectionMap.get(section);
    if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
    const acctMap = bucketMap.get(bucket);
    let row = acctMap.get(acct);
    if (!row) {
      row = {
        account_number: acct,
        account_name: r.account_name || "",
        running: new Array(len).fill(0),
        activity: new Array(len).fill(0),
        isActualByMonth: new Array(len).fill(false),
        activityPresentByMonth: new Array(len).fill(undefined),
      };
      acctMap.set(acct, row);
    }
    if (!row.account_name && r.account_name) row.account_name = r.account_name;
    row.running[col] = toNumber(r.running_balance);
    row.activity[col] = toNumber(r.monthly_activity);
    if (r.is_actual) row.isActualByMonth[col] = true;
    row.activityPresentByMonth[col] = foldPresence(
      row.activityPresentByMonth[col],
      r.monthly_activity_source_present,
    );
  }
  appendTemplateOnlyAccounts(sectionMap, templateAccounts, (acct, name) => ({
    account_number: acct,
    account_name: name,
    running: new Array(len).fill(null),
    activity: new Array(len).fill(null),
    isActualByMonth: new Array(len).fill(false),
    activityPresentByMonth: new Array(len).fill(false),
    templateOnly: true,
  }));

  const sections = [];
  for (const sectionKey of BALANCE_SECTION_ORDER) {
    if (!sectionMap.has(sectionKey)) continue;
    const bucketMap = sectionMap.get(sectionKey);
    const buckets = [...bucketMap.entries()].map(([bucket, acctMap]) => {
      const accounts = [...acctMap.values()]
        .sort((a, b) =>
          compareAccountNumbers(a.account_number, b.account_number),
        )
        .map((a) => ({
          account_number: a.account_number,
          account_name: a.account_name,
          running: a.running,
          activity: a.activity,
          isActualByMonth: a.isActualByMonth,
          activityPresentByMonth: a.activityPresentByMonth.map((present) =>
            present === undefined ? null : present,
          ),
          total: a.templateOnly ? null : a.running[len - 1],
          ...(a.templateOnly
            ? { templateOnly: true, absentByMonth: new Array(len).fill(true) }
            : {}),
        }));
      const subMonthly = new Array(len).fill(0);
      for (const a of accounts) {
        if (a.templateOnly) continue;
        for (let i = 0; i < len; i++) subMonthly[i] += a.running[i];
      }
      return {
        bucket,
        label: bucketDisplayLabel(bucket),
        accounts,
        subtotal: {
          label: bucketSubtotalLabel(bucket),
          monthly: subMonthly,
          total: subMonthly[len - 1],
        },
      };
    });
    sections.push({
      key: sectionKey,
      label: NOI_SECTION_LABELS[sectionKey] || sectionKey,
      buckets,
    });
  }

  return { axis, sections, hasData: sections.length > 0 };
}
