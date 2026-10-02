const isUnsaved = (row) => Boolean(row && (row._isNew || row._dirty));

const haystackFor = (row) => {
  const account =
    row && row.account_number != null ? String(row.account_number) : "";
  const description =
    row && row.line_description != null ? String(row.line_description) : "";
  return `${account} ${description}`.toLowerCase();
};

export const tokenizeItemizedQuery = (query) =>
  String(query == null ? "" : query)
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

export function applyItemizedFilter(rows, query) {
  const all = Array.isArray(rows) ? rows : [];
  const tokens = tokenizeItemizedQuery(query);

  if (tokens.length === 0) {
    return {
      rows: all,
      total: all.length,
      matched: all.length,
      unsavedKept: 0,
      hidden: 0,
      active: false,
    };
  }

  const visible = [];
  let matched = 0;
  let unsavedKept = 0;

  for (const row of all) {
    const hay = haystackFor(row);
    const hit = tokens.every((t) => hay.includes(t));
    if (hit) {
      matched += 1;
      visible.push(row);
    } else if (isUnsaved(row)) {
      unsavedKept += 1;
      visible.push(row);
    }
  }

  return {
    rows: visible,
    total: all.length,
    matched,
    unsavedKept,
    hidden: all.length - visible.length,
    active: true,
  };
}

export function itemizedFilterSummary(result) {
  if (!result || !result.active) return "";
  const noun = result.matched === 1 ? "line" : "lines";
  let text = `${result.matched} of ${result.total} ${noun} match.`;
  if (result.unsavedKept > 0) {
    const s = result.unsavedKept === 1 ? "" : "s";
    text += ` ${result.unsavedKept} unsaved line${s} shown regardless so no pending edit is hidden.`;
  }
  if (result.matched === 0 && result.unsavedKept === 0) {
    text = `No lines match. ${result.total} loaded.`;
  }
  return text;
}
