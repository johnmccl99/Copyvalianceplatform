import React, { useEffect, useMemo, useState } from "react";
import { T } from "../../lib/theme.js";
import {
  fetchGlReconciliationSummary,
  fetchRentRollDrift,
  fetchUnitLeaseMatch,
  glStateTone,
  classifyDriftProminence,
  describeDrift,
  deriveGlRowMeta,
  isStaleSource,
  GL_TOLERANCES,
  UNIT_LEASE_THRESHOLDS,
} from "../../lib/dataHealthChecks.js";
import { computeUnitLeaseMatchSummary } from "../../lib/entrataBI.js";
import { fetchProperties } from "../../lib/supabaseClient.js";

function fmtMoney(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtMonth(v) {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})/);
  const d = m
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function fmtAsOf(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATE_LABEL = {
  agree: "Agree",
  diverge: "Diverge",
  partial: "Partial comparison",
  explained: "Explained",
  not_comparable: "Not comparable",
  no_data: "No data",
};

export default function DataHealthPanel({ C = {} } = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;
  const amber = C.amber || C.warning || T.warningText;

  const [gl, setGl] = useState({ loading: true, error: null, rows: [] });
  const [drift, setDrift] = useState({ loading: true, error: null, rows: [] });
  const [unitLease, setUnitLease] = useState({
    loading: true,
    error: null,
    rows: [],
  });
  const [propNames, setPropNames] = useState({});
  const [openProperty, setOpenProperty] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchGlReconciliationSummary()
      .then(
        ({ data, error }) =>
          alive && setGl({ loading: false, error, rows: data || [] }),
      )
      .catch((error) => alive && setGl({ loading: false, error, rows: [] }));
    fetchRentRollDrift(null)
      .then(
        ({ data, error }) =>
          alive && setDrift({ loading: false, error, rows: data || [] }),
      )
      .catch((error) => alive && setDrift({ loading: false, error, rows: [] }));
    fetchUnitLeaseMatch()
      .then(
        ({ data, error }) =>
          alive && setUnitLease({ loading: false, error, rows: data || [] }),
      )
      .catch(
        (error) => alive && setUnitLease({ loading: false, error, rows: [] }),
      );
    fetchProperties()
      .then((all) => {
        if (!alive) return;
        const names = {};
        for (const p of all || []) {
          if (p.entrataPropertyId) names[p.entrataPropertyId] = p.name;
        }
        setPropNames(names);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const glByProperty = useMemo(() => {
    const by = new Map();
    for (const r of gl.rows) {
      const p = by.get(r.property_code) || {
        propertyCode: r.property_code,
        months: [],
      };
      p.months.push(r);
      by.set(r.property_code, p);
    }
    const out = [...by.values()];
    for (const p of out) {
      p.months.sort((a, b) => (a.month_end < b.month_end ? -1 : 1));
      p.diverged = p.months.filter((m) => glStateTone(m.state) === "diverge");
      p.explained = p.months.filter(
        (m) => glStateTone(m.state) === "explained",
      );
      p.latest = p.months[p.months.length - 1] || null;
      p.state = p.diverged.length
        ? "diverge"
        : p.months.every((m) => m.state === "explained")
          ? "explained"
          : p.explained.length
            ? "partial"
            : p.months.every((m) => m.state === "no_data")
              ? "no_data"
              : "agree";
      p.grossDelta = p.diverged.reduce(
        (acc, m) => acc + (Number(m.gross_delta) || 0),
        0,
      );
      p.reason = p.months.find((m) => m.reason)?.reason || null;
    }
    return out.sort((a, b) => a.propertyCode.localeCompare(b.propertyCode));
  }, [gl.rows]);

  const allAgree =
    !gl.loading &&
    !gl.error &&
    glByProperty.length > 0 &&
    glByProperty.every((p) => p.state === "agree" || p.state === "explained");

  const stateColor = (state) => {
    const tone = state === "agree" ? "agree" : glStateTone(state);
    if (tone === "agree") return green;
    if (tone === "diverge") return red;
    if (tone === "explained") return amber;
    return sub;
  };

  const statePill = (state, reason) => (
    <span
      title={reason || undefined}
      style={{
        display: "inline-block",
        padding: "1px 8px",
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        color: stateColor(state),
        border: `1px solid ${stateColor(state)}`,
        whiteSpace: "nowrap",
      }}
    >
      {STATE_LABEL[state] || state}
    </span>
  );

  const unitLeaseSummary = useMemo(
    () =>
      computeUnitLeaseMatchSummary(unitLease.rows, {
        floorPct: UNIT_LEASE_THRESHOLDS.matchFloorPct,
      }),
    [unitLease.rows],
  );

  const noLeaseRowProperties = useMemo(
    () =>
      unitLease.rows.filter(
        (r) => Number(r.active_units) > 0 && Number(r.lease_rows) === 0,
      ),
    [unitLease.rows],
  );

  const th = {
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: sub,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const td = {
    padding: "6px 10px",
    fontSize: 12.5,
    borderBottom: `1px solid ${border}`,
    verticalAlign: "top",
  };
  const num = { ...td, fontVariantNumeric: "tabular-nums", textAlign: "right" };

  return (
    <div style={{ padding: 20, color: text }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Data Health</h1>
      <p
        style={{
          fontSize: 13,
          color: sub,
          margin: "4px 0 16px",
          maxWidth: 760,
        }}
      >
        Cross-source disagreement checks: the budget substrate&apos;s GL actuals
        against Entrata&apos;s general ledger (per property and closed month),
        and how far each live rent roll has moved since its signed version.
        Every verdict names both sources and when each was last updated.
        Thresholds are to-validate defaults pending calibration — treat them as
        starting guesses, not truth.
      </p>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>
        GL reconciliation
      </h2>
      <div
        style={{
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 14,
          marginBottom: 24,
        }}
      >
        {gl.loading && (
          <div style={{ color: sub, fontSize: 13 }} role="status">
            Running checks…
          </div>
        )}
        {!gl.loading && gl.error && (
          <div style={{ color: sub, fontSize: 13 }}>
            Check unavailable — the GL reconciliation query failed. Nothing is
            asserted about agreement; the numbers on property surfaces are
            unaffected.
          </div>
        )}
        {!gl.loading && !gl.error && glByProperty.length === 0 && (
          <div style={{ color: sub, fontSize: 13 }}>
            No closed months to compare yet. This check fills in once GL actuals
            exist for at least one closed month on a mapped property.
          </div>
        )}
        {!gl.loading && !gl.error && glByProperty.length > 0 && (
          <>
            {allAgree && (
              <div
                style={{
                  color: green,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                Budget actuals match Entrata GL within tolerance on every
                comparable property-month — checked just now.
              </div>
            )}
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {[
                    "Property",
                    "Verdict",
                    "Months",
                    "Diverging",
                    "Dollars in dispute",
                    "Coverage",
                    "Substrate as of",
                    "Entrata as of",
                    "",
                  ].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {glByProperty.map((p) => {
                  const isOpen = openProperty === p.propertyCode;
                  const coverage = p.latest?.coverage_pct;
                  return (
                    <React.Fragment key={p.propertyCode}>
                      <tr>
                        <td style={{ ...td, fontWeight: 600 }}>
                          {p.propertyCode}
                        </td>
                        <td style={td}>{statePill(p.state, p.reason)}</td>
                        <td style={num}>{p.months.length}</td>
                        <td
                          style={{
                            ...num,
                            color: p.diverged.length ? red : sub,
                          }}
                        >
                          {p.diverged.length}
                        </td>
                        <td style={{ ...num, color: p.grossDelta ? red : sub }}>
                          {p.grossDelta ? fmtMoney(p.grossDelta) : "—"}
                        </td>
                        <td style={num}>
                          {coverage == null ? "—" : `${coverage}%`}
                        </td>
                        <td style={td}>{fmtAsOf(p.latest?.substrate_as_of)}</td>
                        <td style={td}>{fmtAsOf(p.latest?.entrata_as_of)}</td>
                        <td style={td}>
                          <button
                            type="button"
                            onClick={() =>
                              setOpenProperty(isOpen ? null : p.propertyCode)
                            }
                            aria-expanded={isOpen}
                            style={{
                              background: "none",
                              border: "none",
                              color: sub,
                              cursor: "pointer",
                              fontSize: 12,
                              padding: 0,
                              font: "inherit",
                            }}
                          >
                            {isOpen ? "Hide months" : "Months"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={9} style={{ ...td, background: subtle }}>
                            <table
                              style={{
                                borderCollapse: "collapse",
                                width: "100%",
                              }}
                            >
                              <thead>
                                <tr>
                                  {[
                                    "Month",
                                    "Check",
                                    "Verdict",
                                    "Substrate",
                                    "Entrata",
                                    "Net delta",
                                    "In dispute",
                                    "Accounts off",
                                    "Coverage",
                                  ].map((h) => (
                                    <th key={h} style={th}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {p.months.map((m) => {
                                  const meta = deriveGlRowMeta(m);
                                  return (
                                    <tr
                                      key={`${p.propertyCode}-${m.month_end}`}
                                    >
                                      <td style={td}>
                                        {fmtMonth(m.month_end)}
                                      </td>
                                      <td style={td}>
                                        {m.check_type === "pipeline"
                                          ? "Pipeline (exact)"
                                          : m.check_type === "reconciliation"
                                            ? "Workbook vs Entrata"
                                            : "Explained"}
                                        {meta.refreshPending
                                          ? " · refresh pending"
                                          : ""}
                                        {meta.staleSource
                                          ? " · stale source"
                                          : ""}
                                        {Number(m.window_edge_accounts) > 0
                                          ? ` · ${m.window_edge_accounts} account(s) at the data-window edge, not compared`
                                          : ""}
                                      </td>
                                      <td style={td}>
                                        {statePill(m.state, m.reason)}
                                      </td>
                                      <td style={num}>
                                        {fmtMoney(m.substrate_total)}
                                      </td>
                                      <td style={num}>
                                        {m.entrata_total == null
                                          ? "—"
                                          : fmtMoney(m.entrata_total)}
                                      </td>
                                      <td style={num}>
                                        {m.net_delta == null
                                          ? "—"
                                          : fmtMoney(m.net_delta)}
                                      </td>
                                      <td
                                        style={{
                                          ...num,
                                          color: Number(m.gross_delta)
                                            ? red
                                            : sub,
                                        }}
                                      >
                                        {m.gross_delta == null
                                          ? "—"
                                          : fmtMoney(m.gross_delta)}
                                      </td>
                                      <td style={num}>
                                        {m.diverged_accounts ?? "—"}
                                      </td>
                                      <td style={num}>
                                        {m.coverage_pct == null
                                          ? "—"
                                          : `${m.coverage_pct}%`}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {p.reason && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: sub,
                                  marginTop: 6,
                                }}
                              >
                                {p.reason}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, color: sub, marginTop: 10 }}>
              Sources: budget substrate (workbook + API-projected actuals) vs
              Entrata GL (first-differenced transaction balances). Pipeline
              months compare exactly (±${GL_TOLERANCES.pipelineTol}); workbook
              months flag an account when it is off by at least $
              {GL_TOLERANCES.acctAbsTol} and {GL_TOLERANCES.acctRelTol * 100}%.
              Coverage below {GL_TOLERANCES.coverageFloorPct}% of substrate
              dollars renders as partial comparison. All thresholds to-validate.
            </div>
          </>
        )}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>
        Signed rent-roll drift
      </h2>
      <div
        style={{
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 14,
        }}
      >
        {drift.loading && (
          <div style={{ color: sub, fontSize: 13 }} role="status">
            Running checks…
          </div>
        )}
        {!drift.loading && drift.error && (
          <div style={{ color: sub, fontSize: 13 }}>
            Check unavailable — the drift query failed. Nothing is asserted
            about how current the signed rolls are.
          </div>
        )}
        {!drift.loading && !drift.error && drift.rows.length === 0 && (
          <div style={{ color: sub, fontSize: 13 }}>
            No property has a current signed rent-roll version yet. Capture and
            sign a version on the rent-roll surface; this meter then tracks how
            far the live roll moves from it.
          </div>
        )}
        {!drift.loading && !drift.error && drift.rows.length > 0 && (
          <>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {[
                    "Property",
                    "Version",
                    "Signed as of",
                    "Frozen occupied",
                    "Frozen eff. rent",
                    "Drift since signing",
                    "Live as of",
                  ].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drift.rows.map((d) => {
                  const notable = classifyDriftProminence(d) === "notable";
                  return (
                    <tr key={d.version_id}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {propNames[d.property_id] ||
                          `Property ${d.property_id}`}
                      </td>
                      <td style={td}>
                        {d.version_label} ({d.version_status})
                      </td>
                      <td style={td}>{fmtAsOf(d.version_as_of)}</td>
                      <td style={num}>{d.frozen_occupied}</td>
                      <td style={num}>{fmtMoney(d.frozen_effective_rent)}</td>
                      <td
                        style={{
                          ...td,
                          color: notable ? amber : sub,
                          fontWeight: notable ? 600 : 400,
                        }}
                      >
                        {describeDrift(d)}
                      </td>
                      <td style={td}>{fmtAsOf(d.live_as_of)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, color: sub, marginTop: 10 }}>
              Post-signature lease churn is legitimate — drift measures how
              stale the signed roll is, not wrongness. Sources: the frozen
              version lines vs the live Entrata roll plus adjustment-layer
              churn. The exact overlaid effective-rent delta lives on the
              rent-roll surface, computed by the same overlay that froze the
              version.
            </div>
          </>
        )}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "24px 0 8px" }}>
        Unit / lease keyspace match
      </h2>
      <div
        style={{
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 14,
        }}
      >
        {unitLease.loading && (
          <div style={{ color: sub, fontSize: 13 }} role="status">
            Running checks…
          </div>
        )}
        {!unitLease.loading && unitLease.error && (
          <div style={{ color: sub, fontSize: 13 }}>
            Check unavailable — the unit/lease match query failed. Nothing is
            asserted about whether occupancy is resolving every lease to a unit.
          </div>
        )}
        {!unitLease.loading &&
          !unitLease.error &&
          unitLease.rows.length === 0 && (
            <div style={{ color: sub, fontSize: 13 }}>
              No property has both synced units and Current/Notice leases yet.
              This check fills in once an Entrata connector has pulled both
              sides for at least one property.
            </div>
          )}
        {!unitLease.loading &&
          !unitLease.error &&
          unitLease.rows.length > 0 && (
            <>
              {unitLeaseSummary.evaluatedCount > 0 &&
                unitLeaseSummary.atFullMatch ===
                  unitLeaseSummary.evaluatedCount && (
                  <div
                    style={{
                      color: green,
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Every lease resolves to a unit on all{" "}
                    {unitLeaseSummary.evaluatedCount} properties with lease data
                    — occupancy is not dropping anyone.
                  </div>
                )}
              {unitLeaseSummary.evaluatedCount > 0 &&
                unitLeaseSummary.belowFloor === 0 &&
                unitLeaseSummary.atFullMatch <
                  unitLeaseSummary.evaluatedCount && (
                  <div
                    style={{
                      color: amber,
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    No property is below the{" "}
                    {UNIT_LEASE_THRESHOLDS.matchFloorPct}% floor, but{" "}
                    {unitLeaseSummary.evaluatedCount -
                      unitLeaseSummary.atFullMatch}{" "}
                    of {unitLeaseSummary.evaluatedCount} still have leases that
                    do not resolve to a unit. Those units are counted in the
                    denominator and not the numerator.
                  </div>
                )}
              {noLeaseRowProperties.length > 0 && (
                <div style={{ color: amber, fontSize: 12.5, marginBottom: 10 }}>
                  {noLeaseRowProperties.length}{" "}
                  {noLeaseRowProperties.length === 1
                    ? "property has"
                    : "properties have"}{" "}
                  synced units but no Current/Notice leases at all, so there is
                  no resolution rate to judge and they are excluded from the
                  counts above:{" "}
                  {noLeaseRowProperties.map((r) => r.property_name).join(", ")}.
                  Their occupancy reads 0% because the lease sync returned
                  nothing, not because this join broke.
                </div>
              )}
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {[
                      "Property",
                      "Units",
                      "Lease rows",
                      "Resolved by id",
                      "Recovered by unit no.",
                      "Unresolved",
                      "Units missing",
                      "Match",
                      "Legacy",
                      "Leases as of",
                      "Units as of",
                      "State",
                    ].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unitLease.rows.map((r) => {
                    const bad = r.state === "diverge";
                    const leaseStale = isStaleSource(r.leases_as_of);
                    const unitStale = isStaleSource(r.units_as_of);
                    return (
                      <tr key={r.property_id}>
                        <td style={{ ...td, fontWeight: 600 }}>
                          {r.property_name || `Property ${r.property_id}`}
                        </td>
                        <td style={num}>{r.active_units}</td>
                        <td style={num}>{r.lease_rows}</td>
                        <td style={num}>{r.resolved_by_unit_id}</td>
                        <td style={num}>{r.resolved_by_unit_number}</td>
                        <td
                          style={{
                            ...num,
                            color: r.unresolved_rows > 0 ? amber : undefined,
                          }}
                        >
                          {r.unresolved_rows}
                        </td>
                        <td
                          style={{
                            ...num,
                            color:
                              r.units_missing_from_inventory > 0
                                ? amber
                                : undefined,
                          }}
                        >
                          {r.units_missing_from_inventory}
                        </td>
                        <td
                          style={{
                            ...num,
                            color: bad ? red : undefined,
                            fontWeight: bad ? 700 : 400,
                          }}
                        >
                          {r.match_pct == null ? "—" : `${r.match_pct}%`}
                        </td>
                        <td style={{ ...num, color: sub }}>
                          {r.legacy_match_pct == null
                            ? "—"
                            : `${r.legacy_match_pct}%`}
                        </td>
                        <td
                          style={{
                            ...td,
                            color: leaseStale ? amber : sub,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtAsOf(r.leases_as_of)}
                          {leaseStale ? " (stale)" : ""}
                        </td>
                        <td
                          style={{
                            ...td,
                            color: unitStale ? amber : sub,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtAsOf(r.units_as_of)}
                          {unitStale ? " (stale)" : ""}
                        </td>
                        <td style={td}>{statePill(r.state, r.reason)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 11.5, color: sub, marginTop: 10 }}>
                A lease resolves to its unit by (org, property, unit id),
                falling back to the longest matching unit number within the same
                property — Entrata returns lease unit ids that its own unit
                roster omits on some properties, and an unresolved lease is
                silently dropped from occupancy while its unit still counts in
                the denominator. Below {UNIT_LEASE_THRESHOLDS.matchFloorPct}%
                resolved reads &quot;diverge&quot;: that property&apos;s
                occupancy is understated, not vacant. &quot;Legacy&quot; is the
                rate without the unit-number fallback, shown so a regression of
                the fallback is visible rather than silent. &quot;Units
                missing&quot; are units Entrata leases but never returns from
                its unit roster — no join can recover those; they need an ingest
                fix. Sources: entrata_units and entrata_leases.
              </div>
            </>
          )}
      </div>
    </div>
  );
}
