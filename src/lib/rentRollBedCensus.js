export function bedKeyOf(row) {
  if (!row || typeof row !== "object") return null;
  if (row.unit_space_id != null) return `s:${row.unit_space_id}`;
  const label = row.unit_number;
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  return trimmed ? `u:${trimmed}` : null;
}

export function bedCensus(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map();
  let counted = 0;

  for (const row of list) {
    const key = bedKeyOf(row);
    if (key == null) continue;
    counted += 1;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const duplicates = [];
  for (const [key, count] of counts) {
    if (count > 1) duplicates.push({ key, count });
  }
  duplicates.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return { beds: counts.size, rows: counted, duplicates };
}

const reported = new Set();

export function reportDuplicateBeds(rows, label) {
  const census = bedCensus(rows);
  if (!census.duplicates.length) return census;

  const name = label == null ? "rent roll" : String(label);
  const worst = census.duplicates
    .slice(0, 5)
    .map((d) => `${d.key} x${d.count}`)
    .join(", ");
  const key = `${name}|${census.duplicates.map((d) => `${d.key}:${d.count}`).join(",")}`;
  if (reported.has(key)) return census;
  reported.add(key);

  console.error(
    `${name}: the bed-renders-exactly-once invariant is broken — ` +
      `${census.duplicates.length} bed(s) render more than once ` +
      `(${census.rows} rows for ${census.beds} beds): ${worst}` +
      (census.duplicates.length > 5 ? ", …" : "") +
      ". The roll still renders; the duplicate rows are NOT removed, " +
      "because choosing which of a bed's two rows to drop can print a vacancy " +
      "over a real tenancy.",
  );
  return census;
}

export function resetDuplicateBedReports() {
  reported.clear();
}
