import React, { useEffect, useMemo, useState } from "react";
import { fetchEntrataPortfolioOccupancy } from "../../lib/supabaseClient.js";
import { filterRowsToSet } from "../../lib/unifiedViewLoaders.js";
import { computePortfolioOccupancyTotals } from "../../lib/entrataBI.js";
import {
  formatPercent,
  formatNumber,
  formatCurrencyFull,
  EMPTY,
} from "../../lib/numberFormat.js";
import { T } from "../../lib/theme.js";

export default function SetOccupancyView({
  selectedProperties = [],
  scopeVersion = 0,
  C = {},
  userProfile: _userProfile = null,
  onOpenProperty,
} = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allRows, setAllRows] = useState([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchEntrataPortfolioOccupancy()
      .then((rows) => {
        if (!alive) return;
        setAllRows(Array.isArray(rows) ? rows : []);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || "Could not load portfolio occupancy.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(
    () => filterRowsToSet(allRows, selectedProperties, (r) => r.propertyId),
    [allRows, selectedProperties, scopeVersion],
  );

  const totals = useMemo(
    () => computePortfolioOccupancyTotals(filtered),
    [filtered],
  );

  const propPct = (occ, tot) => (tot > 0 ? (occ / tot) * 100 : null);

  const th = {
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 12,
    color: sub,
    fontWeight: 600,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const thNum = { ...th, textAlign: "right" };
  const td = {
    padding: "7px 10px",
    fontSize: 13,
    color: text,
    borderBottom: `1px solid ${border}`,
  };
  const tdNum = {
    ...td,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };

  if (!selectedProperties.length) {
    return (
      <div
        style={{
          padding: 20,
          border: `1px dashed ${border}`,
          borderRadius: 8,
          color: sub,
          fontSize: 13,
          maxWidth: 560,
        }}
      >
        No properties selected. Choose a set with the scope picker above —
        occupancy for the selected properties rolls up here using the same
        method as the Portfolio Occupancy dashboard.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: sub, fontSize: 14 }} role="status">
        Loading occupancy for {selectedProperties.length}{" "}
        {selectedProperties.length === 1 ? "property" : "properties"}…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          border: `1px solid ${red}`,
          borderRadius: 8,
          fontSize: 13,
          maxWidth: 640,
        }}
      >
        <div style={{ color: red, fontWeight: 600, marginBottom: 4 }}>
          Couldn't load set occupancy.
        </div>
        <div style={{ color: sub }}>{String(error)}</div>
      </div>
    );
  }

  if (allRows.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 8,
          maxWidth: 620,
        }}
      >
        <div
          style={{
            color: text,
            fontWeight: 600,
            fontSize: 15,
            marginBottom: 8,
          }}
        >
          No Entrata property data yet
        </div>
        <div style={{ color: sub, fontSize: 13, lineHeight: 1.6 }}>
          Set occupancy is built from the properties, units, and leases synced
          from Entrata. Connect an Entrata account under Admin Console →
          Integrations and run a sync; once those resources have synced,
          occupancy for the selected set appears here.
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          border: `1px dashed ${border}`,
          borderRadius: 8,
          color: sub,
          fontSize: 14,
          maxWidth: 620,
        }}
      >
        None of the selected properties have Entrata occupancy data synced yet.
        The org-wide occupancy feed is live, but it carries no rows for this
        set.
      </div>
    );
  }

  const kpis = [
    {
      label: "Set Occupancy",
      value: formatPercent(totals.physicalOccupancyPct),
      sub: `${formatNumber(totals.occupiedUnits)} of ${formatNumber(totals.totalUnits)} units occupied`,
    },
    {
      label: "Leased",
      value: formatPercent(totals.leasedPct),
      sub: `${formatNumber(totals.leasedUnits)} units leased`,
    },
    {
      label: "Properties in Set",
      value: formatNumber(totals.propertyCount),
      sub: `${formatNumber(totals.vacantUnits)} vacant units`,
    },
    {
      label: "Avg In-Place Rent",
      value:
        totals.avgInPlaceRent == null
          ? EMPTY
          : formatCurrencyFull(totals.avgInPlaceRent),
      sub: "per occupied unit",
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: card,
              border: `1px solid ${border}`,
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 12, color: sub }}>{k.label}</div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 700,
                marginTop: 4,
                color: text,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {k.value}
            </div>
            <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          overflowX: "auto",
          border: `1px solid ${border}`,
          borderRadius: 8,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: card,
          }}
        >
          <thead style={{ background: subtle }}>
            <tr>
              <th style={th}>Property</th>
              <th style={thNum}>Units</th>
              <th style={thNum}>Occupied</th>
              <th style={thNum}>Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const name =
                r.propertyName ||
                selectedProperties.find(
                  (p) => String(p.entrataId) === String(r.propertyId),
                )?.name ||
                String(r.propertyId);
              return (
                <tr key={String(r.propertyId)}>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => onOpenProperty && onOpenProperty(name)}
                      title={`Open ${name}`}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontSize: 13,
                        color: text,
                        textAlign: "left",
                      }}
                    >
                      {name}
                    </button>
                  </td>
                  <td style={tdNum}>{formatNumber(r.totalUnits)}</td>
                  <td style={tdNum}>{formatNumber(r.occupiedUnits)}</td>
                  <td style={tdNum}>
                    {formatPercent(propPct(r.occupiedUnits, r.totalUnits))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
