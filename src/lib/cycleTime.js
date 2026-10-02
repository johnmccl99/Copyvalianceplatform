import { supabase } from "./supabaseClient.js";

export function mapCycleDurationRow(row) {
  if (!row) return null;
  const num = (v) => (v == null || v === "" ? null : Number(v));
  return {
    scope: row.scope,
    cycleId: row.cycle_id ?? null,
    propertyCode: row.property_code ?? null,
    fiscalQuarter: row.fiscal_quarter ?? null,
    status: row.status ?? null,
    openedAt: row.opened_at ?? null,
    closedAt: row.closed_at ?? null,
    endToEndSeconds: num(row.end_to_end_seconds),
    parseSeconds: num(row.parse_seconds),
    reviewSeconds: num(row.review_seconds),
    paritySeconds: num(row.parity_seconds),
    writebackSeconds: num(row.writeback_seconds),
    reviewFirstEditAt: row.review_first_edit_at ?? null,
    reviewLastEditAt: row.review_last_edit_at ?? null,
    cycleCount: row.cycle_count == null ? null : Number(row.cycle_count),
  };
}

export function splitCycleResult(rows) {
  const mapped = (Array.isArray(rows) ? rows : [])
    .map(mapCycleDurationRow)
    .filter((r) => r != null);
  const cycles = mapped.filter((r) => r.scope === "cycle");
  const portfolio = mapped.find((r) => r.scope === "portfolio") || null;
  return { cycles, portfolio };
}

const EMPTY_DUR = "—";

export function formatDuration(seconds) {
  if (seconds == null || seconds === "") return EMPTY_DUR;
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return EMPTY_DUR;
  if (s < 60) return `${Math.round(s)}s`;
  const totalMin = Math.floor(s / 60);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export function durationDays(seconds) {
  if (seconds == null || seconds === "") return null;
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return null;
  return s / 86400;
}

export async function fetchCycleDurations({
  propertyCode = null,
  fiscalQuarter = null,
} = {}) {
  const { data, error } = await supabase.rpc(
    "budget_reporting_cycle_durations",
    {
      p_property_code: propertyCode || null,
      p_fiscal_quarter: fiscalQuarter || null,
    },
  );
  if (error) {
    console.error("fetchCycleDurations error:", error);
    return { cycles: [], portfolio: null, error };
  }
  const { cycles, portfolio } = splitCycleResult(data);
  return { cycles, portfolio, error: null };
}
