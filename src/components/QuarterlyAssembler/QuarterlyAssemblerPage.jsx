import React, { useEffect, useMemo, useState } from "react";
import { T } from "../../lib/theme.js";
import {
  fetchBudgetPropertyCodes,
  fetchEntrataPortfolioOccupancy,
  fetchEntrataDataFreshness,
} from "../../lib/supabaseClient.js";
import { fetchQuarterlyPacket } from "../../lib/quarterlyAssembler/loader.js";
import { formatTimestamp } from "../../lib/dateFormat.js";
import {
  buildQuarterlyPacket,
  packetFilename,
  COVERAGE_AVAILABLE,
  COVERAGE_UNAVAILABLE,
} from "../../lib/quarterlyAssembler/packetBuilder.js";
import {
  resolveQuarter,
  mostRecentClosedQuarter,
  classifyQuarterMonths,
} from "../../lib/quarterlyAssembler/quarterResolver.js";
import {
  isExportBlocked,
  RECON_CLEAN,
  RECON_PARTIAL,
  RECON_STALE,
} from "../../lib/quarterlyAssembler/reconciliation.js";

const EM_DASH = "—";

function fmtMoney(v) {
  if (v == null || v === "") return EM_DASH;
  const n = Number(v);
  if (Number.isNaN(n)) return EM_DASH;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v, dp = 1) {
  if (v == null || v === "") return EM_DASH;
  const n = Number(v);
  if (Number.isNaN(n)) return EM_DASH;
  return `${(n * 100).toFixed(dp)}%`;
}

function fmtDate(v) {
  if (!v) return EM_DASH;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtInt(v) {
  if (v == null || v === "") return EM_DASH;
  const n = Number(v);
  if (Number.isNaN(n)) return EM_DASH;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const STATUS_LABEL = {
  [RECON_CLEAN]: "Clean",
  [RECON_PARTIAL]: "Partial",
  [RECON_STALE]: "Stale budget baseline",
};

function CoverageBadge({ coverage, sub, border }) {
  const label =
    coverage === COVERAGE_AVAILABLE
      ? "live"
      : coverage === COVERAGE_UNAVAILABLE
        ? "unavailable"
        : "n/a";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: sub,
        border: `1px solid ${border}`,
        borderRadius: 4,
        padding: "1px 5px",
        marginLeft: 6,
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      {label}
    </span>
  );
}

function FieldRow({ label, field, fmt, sub, border, text }) {
  const covered = field?.coverage === COVERAGE_AVAILABLE;
  return (
    <tr>
      <td
        style={{
          padding: "4px 10px 4px 0",
          color: sub,
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "4px 0",
          color: text,
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
        }}
        title={field?.source || ""}
      >
        {covered ? fmt(field.value) : EM_DASH}
        <CoverageBadge coverage={field?.coverage} sub={sub} border={border} />
      </td>
    </tr>
  );
}

export default function QuarterlyAssemblerPage({ C = {} } = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;
  const amber = C.amber || C.warning || T.warningText;

  const defaultQ = useMemo(() => mostRecentClosedQuarter(), []);
  const [codes, setCodes] = useState({ loading: true, error: null, list: [] });
  const [propertyCode, setPropertyCode] = useState("");
  const [year, setYear] = useState(defaultQ.year);
  const [quarter, setQuarter] = useState(defaultQ.quarter);
  const [assembling, setAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState(null);
  const [packet, setPacket] = useState(null);
  const [staleAck, setStaleAck] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchBudgetPropertyCodes()
      .then(({ data, error }) => {
        if (!alive) return;
        setCodes({ loading: false, error, list: data || [] });
        if (!error && data && data.length > 0)
          setPropertyCode((c) => c || data[0]);
      })
      .catch((error) => alive && setCodes({ loading: false, error, list: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const yearOptions = useMemo(() => {
    const now = new Date().getUTCFullYear();
    const ys = [];
    for (let y = now + 1; y >= 2023; y -= 1) ys.push(y);
    return ys;
  }, []);

  async function handleAssemble() {
    if (!propertyCode || assembling) return;
    setAssembling(true);
    setAssembleError(null);
    setPacket(null);
    setStaleAck(false);
    try {
      resolveQuarter(Number(year), Number(quarter));
      const [rpcRes, occRes, freshRes] = await Promise.allSettled([
        fetchQuarterlyPacket(propertyCode, Number(year), Number(quarter)),
        fetchEntrataPortfolioOccupancy(),
        fetchEntrataDataFreshness(),
      ]);
      if (
        rpcRes.status !== "fulfilled" ||
        rpcRes.value.error ||
        !rpcRes.value.data
      ) {
        const err =
          rpcRes.status === "fulfilled" ? rpcRes.value.error : rpcRes.reason;
        setAssembleError(err?.message || "get_quarterly_packet failed");
        return;
      }
      const serverSlice = rpcRes.value.data;
      let occupancyRow = null;
      if (occRes.status === "fulfilled" && Array.isArray(occRes.value)) {
        const eid = serverSlice?.bridge?.entrata_property_id;
        occupancyRow =
          eid == null
            ? null
            : occRes.value.find((r) => String(r.propertyId) === String(eid)) ||
              null;
      }
      const rentRollAsof =
        freshRes.status === "fulfilled"
          ? freshRes.value?.maxLastSeen || null
          : null;
      const built = buildQuarterlyPacket({
        serverSlice,
        occupancyRow,
        rentRollAsof,
      });
      if (occRes.status === "rejected") {
        built.reconciliation.warnings.push(
          "Live occupancy fetch failed — Leasing occupancy fields are unavailable this run.",
        );
      }
      setPacket(built);
    } catch (e) {
      setAssembleError(e?.message || String(e));
    } finally {
      setAssembling(false);
    }
  }

  function handleDownload() {
    if (!packet) return;
    if (isExportBlocked(packet.reconciliation.status, staleAck)) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = packetFilename(packet);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const status = packet?.reconciliation?.status || null;
  const statusColor =
    status === RECON_CLEAN ? green : status === RECON_STALE ? red : amber;
  const exportBlocked = packet ? isExportBlocked(status, staleAck) : false;

  const th = {
    textAlign: "left",
    padding: "4px 10px 4px 0",
    color: sub,
    fontSize: 11,
    fontWeight: 600,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const td = {
    padding: "4px 10px 4px 0",
    color: text,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  };
  const blockCard = {
    background: card,
    border: `1px solid ${border}`,
    borderRadius: 8,
    padding: "10px 14px",
  };
  const blockTitle = {
    fontSize: 12,
    fontWeight: 700,
    color: text,
    margin: "0 0 6px",
  };

  const b = packet?.blocks || {};
  const t3 = b.financial_performance_t3 || null;
  const t3Rows = t3
    ? [
        {
          label: "Gross Potential Rent",
          f: t3.gross_potential_rent,
          money: true,
          invert: false,
        },
        {
          label: "Net Operating Income",
          f: t3.net_operating_income,
          money: true,
          invert: false,
        },
        {
          label: "OpEx Ratio (% of revenue)",
          f: t3.opex_ratio,
          money: false,
          invert: true,
        },
        {
          label: "Net Op CF (post-debt)",
          f: t3.net_operating_cf_post_debt,
          money: true,
          invert: false,
        },
      ]
    : [];

  return (
    <div style={{ padding: "18px 22px", maxWidth: 1080 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: text, margin: 0 }}>
        Quarterly Assembler{" "}
        <span style={{ fontSize: 12, fontWeight: 500, color: sub }}>
          (exports a JSON packet for the report flow)
        </span>
      </h2>
      <p
        style={{
          fontSize: 12,
          color: sub,
          margin: "6px 0 14px",
          maxWidth: 760,
        }}
      >
        Assembles one reconciled quarterly packet per property — budget vs GL
        actuals, property details, unit mix, and live leasing — mirroring the
        investor report's seven-block page-2 layout. Preview shows every value
        with its source and coverage; export is gated on the reconciliation
        status.
      </p>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <label style={{ fontSize: 12, color: sub }}>
          Property{" "}
          <select
            value={propertyCode}
            onChange={(e) => setPropertyCode(e.target.value)}
            disabled={codes.loading || codes.list.length === 0}
            style={{
              fontSize: 12,
              padding: "4px 6px",
              background: subtle,
              color: text,
              border: `1px solid ${border}`,
              borderRadius: 6,
            }}
          >
            {codes.list.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: sub }}>
          Year{" "}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{
              fontSize: 12,
              padding: "4px 6px",
              background: subtle,
              color: text,
              border: `1px solid ${border}`,
              borderRadius: 6,
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: sub }}>
          Quarter{" "}
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            style={{
              fontSize: 12,
              padding: "4px 6px",
              background: subtle,
              color: text,
              border: `1px solid ${border}`,
              borderRadius: 6,
            }}
          >
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
        </label>
        {propertyCode ? (
          <button
            onClick={handleAssemble}
            disabled={assembling}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${border}`,
              background: subtle,
              color: text,
              cursor: assembling ? "wait" : "pointer",
            }}
          >
            {assembling ? "Assembling…" : "Assemble"}
          </button>
        ) : null}
      </div>

      {codes.loading ? (
        <div role="status" style={{ fontSize: 12, color: sub }}>
          Loading budget properties…
        </div>
      ) : codes.error ? (
        <div
          style={{
            fontSize: 12,
            color: red,
            border: `1px solid ${red}`,
            borderRadius: 8,
            padding: "8px 12px",
            maxWidth: 640,
          }}
        >
          Could not load the budget property list:{" "}
          {codes.error?.message || "unknown error"}
        </div>
      ) : codes.list.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: sub,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            padding: "10px 14px",
            maxWidth: 640,
          }}
        >
          No budget properties found. The assembler reads properties from the
          Budget Module workbook registry — ingest a budget workbook first
          (Admin Console &gt; Platform &gt; Budget Workbook Intake), then return
          here.
        </div>
      ) : null}

      {assembleError ? (
        <div
          style={{
            fontSize: 12,
            color: red,
            border: `1px solid ${red}`,
            borderRadius: 8,
            padding: "8px 12px",
            maxWidth: 640,
            marginTop: 8,
          }}
        >
          Assembly failed: {assembleError}
        </div>
      ) : null}

      {packet ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 6,
          }}
        >
          <div
            style={{
              border: `1px solid ${statusColor}`,
              borderRadius: 8,
              padding: "10px 14px",
              background: card,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>
              Reconciliation: {STATUS_LABEL[status] || status}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: sub,
                  marginLeft: 10,
                }}
              >
                {packet.property_name || packet.property_code} ·{" "}
                {packet.period?.label} · as of{" "}
                {fmtDate(packet.period?.quarter_end)}
              </span>
            </div>
            {status === RECON_STALE ? (
              <div style={{ fontSize: 12, color: red, marginTop: 6 }}>
                The current budget snapshot was sealed before this quarter began
                — the budget baseline is older than the actuals. Export is
                blocked without an explicit acknowledgement below.
              </div>
            ) : null}
            {(packet.reconciliation.warnings || []).length > 0 ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {packet.reconciliation.warnings.map((w, i) => (
                  <li
                    key={i}
                    style={{ fontSize: 11.5, color: sub, marginBottom: 2 }}
                  >
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 11.5, color: sub, marginTop: 6 }}>
                No warnings.
              </div>
            )}
            <div style={{ fontSize: 11, color: sub, marginTop: 8 }}>
              Sources as of — GL:{" "}
              {fmtDate(packet.reconciliation.sources_asof?.gl)} · Budget
              snapshot sealed:{" "}
              {formatTimestamp(
                packet.reconciliation.sources_asof?.budget_snapshot,
                { style: "date", empty: EM_DASH },
              )}{" "}
              · Rent roll synced:{" "}
              {formatTimestamp(packet.reconciliation.sources_asof?.rent_roll, {
                style: "date",
                empty: EM_DASH,
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {classifyQuarterMonths(packet.period?.months || []).map(
              ({ month_end, state }) => (
                <span
                  key={month_end}
                  style={{
                    fontSize: 11,
                    color: sub,
                    border: `1px solid ${border}`,
                    borderRadius: 6,
                    padding: "3px 8px",
                  }}
                >
                  {fmtDate(month_end)} · {state.replace("_", " ")}
                </span>
              ),
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 12,
            }}
          >
            <div style={blockCard}>
              <p style={blockTitle}>1 · Important Dates</p>
              <table style={{ borderCollapse: "collapse" }}>
                <tbody>
                  <FieldRow
                    label="Initial closing"
                    field={b.important_dates?.initial_closing_date}
                    fmt={fmtDate}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Refinance"
                    field={b.important_dates?.refinance_date}
                    fmt={fmtDate}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Projected sale"
                    field={b.important_dates?.projected_sale_date}
                    fmt={fmtDate}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                </tbody>
              </table>
            </div>

            <div style={blockCard}>
              <p style={blockTitle}>2 · Property Details</p>
              <table style={{ borderCollapse: "collapse" }}>
                <tbody>
                  <FieldRow
                    label="Type"
                    field={b.property_details?.property_type}
                    fmt={(v) => String(v)}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Units"
                    field={b.property_details?.units}
                    fmt={fmtInt}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Beds"
                    field={b.property_details?.beds}
                    fmt={fmtInt}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                </tbody>
              </table>
            </div>

            <div style={blockCard}>
              <p style={blockTitle}>3 · Unit Mix</p>
              {b.unit_mix?.mix?.coverage === COVERAGE_AVAILABLE ? (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={th}>Type</th>
                      <th style={th}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.unit_mix.mix.value.map((r) => (
                      <tr key={r.unit_type}>
                        <td style={td}>{r.unit_type}</td>
                        <td style={td}>{fmtInt(r.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 12, color: sub }}>
                  {EM_DASH} unavailable (no Entrata unit types and no model
                  unit-mix rows)
                </div>
              )}
              <div style={{ fontSize: 10.5, color: sub, marginTop: 6 }}>
                {b.unit_mix?.mix?.source}
              </div>
            </div>

            <div style={blockCard}>
              <p style={blockTitle}>4 · Capital</p>
              <table style={{ borderCollapse: "collapse" }}>
                <tbody>
                  <FieldRow
                    label="Total equity invested"
                    field={b.capital?.total_equity_invested}
                    fmt={fmtMoney}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Capital returned to date"
                    field={b.capital?.capital_returned_to_date}
                    fmt={fmtMoney}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="% capital returned"
                    field={b.capital?.pct_capital_returned}
                    fmt={fmtPct}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Distribution this quarter"
                    field={b.capital?.distribution_this_quarter}
                    fmt={fmtMoney}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                </tbody>
              </table>
              <div style={{ fontSize: 10.5, color: sub, marginTop: 6 }}>
                Pending the distribution engine — never computed here.
              </div>
            </div>

            {b.construction_status ? (
              <div style={blockCard}>
                <p style={blockTitle}>5 · Construction Status</p>
                <table style={{ borderCollapse: "collapse" }}>
                  <tbody>
                    <FieldRow
                      label="Target completion"
                      field={b.construction_status.target_completion_date}
                      fmt={fmtDate}
                      sub={sub}
                      border={border}
                      text={text}
                    />
                    <FieldRow
                      label="Total capex budget"
                      field={b.construction_status.total_capex_budget}
                      fmt={fmtMoney}
                      sub={sub}
                      border={border}
                      text={text}
                    />
                    <FieldRow
                      label="Capex spent to date"
                      field={b.construction_status.capex_spent_to_date}
                      fmt={fmtMoney}
                      sub={sub}
                      border={border}
                      text={text}
                    />
                    <FieldRow
                      label="% complete"
                      field={b.construction_status.pct_complete}
                      fmt={fmtPct}
                      sub={sub}
                      border={border}
                      text={text}
                    />
                  </tbody>
                </table>
              </div>
            ) : null}

            <div style={blockCard}>
              <p style={blockTitle}>6 · Leasing</p>
              <table style={{ borderCollapse: "collapse" }}>
                <tbody>
                  <FieldRow
                    label="Current occupancy"
                    field={b.leasing?.current_occupancy}
                    fmt={fmtPct}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="vs prior year"
                    field={b.leasing?.occupancy_vs_prior_year}
                    fmt={fmtPct}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Next-term pre-lease"
                    field={b.leasing?.next_academic_term_prelease}
                    fmt={fmtPct}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Pre-lease vs prior year"
                    field={b.leasing?.prelease_vs_prior_year}
                    fmt={fmtPct}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="Avg rent / bed"
                    field={b.leasing?.average_rent_per_bed}
                    fmt={fmtMoney}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="vs prior quarter"
                    field={b.leasing?.avg_rent_vs_prior_quarter}
                    fmt={fmtPct}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                  <FieldRow
                    label="YoY rent growth"
                    field={b.leasing?.yoy_rent_growth}
                    fmt={fmtPct}
                    sub={sub}
                    border={border}
                    text={text}
                  />
                </tbody>
              </table>
            </div>
          </div>

          <div style={blockCard}>
            <p style={blockTitle}>
              7 · Financial Performance — trailing 3 months (
              {packet.period?.label}, calendar basis)
            </p>
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                maxWidth: 720,
              }}
            >
              <thead>
                <tr>
                  <th style={th}>Metric</th>
                  <th style={th}>Actual</th>
                  <th style={th}>Variance %</th>
                  <th style={th}>Budget</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {t3Rows.map(({ label, f, money, invert }) => {
                  const covered = f?.coverage === COVERAGE_AVAILABLE;
                  const v = covered ? f.value : {};
                  const fmt = money ? fmtMoney : (x) => fmtPct(x, 1);
                  const vp =
                    covered && v?.variance_pct != null
                      ? Number(v.variance_pct)
                      : null;
                  const varColor =
                    vp == null
                      ? text
                      : (invert ? vp > 0 : vp < 0)
                        ? red
                        : green;
                  return (
                    <tr key={label}>
                      <td style={{ ...td, color: sub }}>{label}</td>
                      <td style={td} title={f?.source || ""}>
                        {covered ? fmt(v.actual) : EM_DASH}
                      </td>
                      <td style={{ ...td, color: varColor }}>
                        {covered ? fmtPct(v.variance_pct, 1) : EM_DASH}
                      </td>
                      <td style={td}>{covered ? fmt(v.budget) : EM_DASH}</td>
                      <td style={td}>
                        <CoverageBadge
                          coverage={f?.coverage}
                          sub={sub}
                          border={border}
                        />
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td
                    style={{
                      ...td,
                      color: sub,
                      borderTop: `1px solid ${border}`,
                    }}
                  >
                    Debt service (context)
                  </td>
                  <td
                    style={{ ...td, borderTop: `1px solid ${border}` }}
                    colSpan={3}
                    title={t3?.debt_service?.source || ""}
                  >
                    {t3?.debt_service?.coverage === COVERAGE_AVAILABLE
                      ? fmtMoney(t3.debt_service.value)
                      : EM_DASH}
                  </td>
                  <td style={{ ...td, borderTop: `1px solid ${border}` }}>
                    <CoverageBadge
                      coverage={t3?.debt_service?.coverage}
                      sub={sub}
                      border={border}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            style={{
              ...blockCard,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <p style={blockTitle}>Export</p>
            {status === RECON_STALE ? (
              <label
                style={{
                  fontSize: 12,
                  color: red,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  maxWidth: 640,
                }}
              >
                <input
                  type="checkbox"
                  checked={staleAck}
                  onChange={(e) => setStaleAck(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                I understand this packet compares against a budget snapshot
                sealed before the quarter began, and I am exporting it anyway.
              </label>
            ) : null}
            {!exportBlocked ? (
              <button
                onClick={handleDownload}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: subtle,
                  color: text,
                  cursor: "pointer",
                  alignSelf: "flex-start",
                }}
              >
                Download JSON ({packetFilename(packet)})
              </button>
            ) : (
              <div style={{ fontSize: 12, color: sub }}>
                Export is blocked while the packet is stale — acknowledge above
                to unlock, or re-seal the budget snapshot in Budget &gt;
                Analysis first.
              </div>
            )}
            <div style={{ fontSize: 10.5, color: sub }}>
              This JSON feeds the report flow. No data leaves the platform
              automatically.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
