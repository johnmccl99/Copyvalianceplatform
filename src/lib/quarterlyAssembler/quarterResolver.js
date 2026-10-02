export function monthEndISO(year, month) {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

export function monthStartISO(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toISOString().slice(0, 10);
}

export function resolveQuarter(year, quarter) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error(`resolveQuarter: invalid year ${year}`);
  }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error(
      `resolveQuarter: invalid quarter ${quarter} (expected 1-4)`,
    );
  }
  const firstMonth = (quarter - 1) * 3 + 1;
  const months = [0, 1, 2].map((i) => monthEndISO(year, firstMonth + i));
  return {
    label: `Q${quarter}-${year}`,
    quarter,
    year,
    quarter_start: monthStartISO(year, firstMonth),
    quarter_end: months[2],
    months,
    basis: "calendar",
  };
}

export function mostRecentClosedQuarter(today = new Date()) {
  let year = today.getUTCFullYear();
  let quarter = Math.floor(today.getUTCMonth() / 3) + 1;
  quarter -= 1;
  if (quarter === 0) {
    quarter = 4;
    year -= 1;
  }
  return { year, quarter };
}

export function classifyQuarterMonths(monthEnds, today = new Date()) {
  const curYm = today.getUTCFullYear() * 12 + today.getUTCMonth();
  return monthEnds.map((month_end) => {
    const [y, m] = month_end.split("-").map(Number);
    const ym = y * 12 + (m - 1);
    let state;
    if (ym < curYm) state = "closed";
    else if (ym === curYm) state = "in_progress";
    else state = "future";
    return { month_end, state };
  });
}
