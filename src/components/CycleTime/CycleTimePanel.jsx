import React, { useEffect, useMemo, useState } from "react";
import {
  fetchCycleDurations,
  formatDuration,
  durationDays,
} from "../../lib/cycleTime.js";

const EMPTY = "—";

function fmtDays(seconds) {
  const d = durationDays(seconds);
  if (d == null) return EMPTY;
  return d < 10 ? `${d.toFixed(1)}d` : `${Math.round(d)}d`;
}

function fmtDate(ts) {
  if (!ts) return EMPTY;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CycleTimePanel({
  propertyCode = null,
  fiscalQuarter = null,
  theme = {},
} = {}) {
  const text = theme.text || "#0F172A";
  const sub = theme.sub || "#64748B";
  const border = theme.border || "#E2E8F0";
  const card = theme.card || "#FFFFFF";
  const subtle = theme.subtle || "#F8FAFC";
  const red = theme.red || "#DC2626";

  const [cycles, setCycles] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setCycles([]);
    setPortfolio(null);
    fetchCycleDurations({ propertyCode, fiscalQuarter })
      .then(({ cycles: cs, portfolio: pf, error: err }) => {
        if (!alive) return;
        if (err) setError(err);
        setCycles(Array.isArray(cs) ? cs : []);
        setPortfolio(pf || null);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [propertyCode, fiscalQuarter]);

  const headline = useMemo(() => {
    if (portfolio) return portfolio;
    if (cycles.length === 1) return cycles[0];
    return null;
  }, [portfolio, cycles]);

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

  return (
    <div style={{ marginTop: 28 }}>
      <h2
        style={{
          fontSize: 15,
          fontWeight: 700,
          margin: "0 0 4px",
          color: text,
        }}
      >
        Cycle time{" "}
        <span style={{ fontSize: 12, fontWeight: 500, color: sub }}>
          (quarterly reporting cycle — SC1)
        </span>
      </h2>
      <p style={{ fontSize: 13, color: sub, margin: "0 0 8px" }}>
        End-to-end span of each quarterly reforecast cycle, from the reforecast
        kicking off through the live Entrata write-back that closes it, broken
        into its phases. The review phase — the human assumptions work — is
        where the cycle spends most of its time, so it is shown separately.
      </p>

      {loading && (
        <div style={{ padding: 20, color: sub, fontSize: 14 }} role="status">
          Loading cycle timing…
        </div>
      )}

      {!loading && error && (
        <div
          style={{
            padding: 16,
            border: `1px solid ${red}`,
            borderRadius: 8,
            color: red,
            fontSize: 13,
          }}
        >
          Could not load cycle timing
          {error?.message ? `. ${String(error.message)}` : "."}
        </div>
      )}

      {!loading && !error && cycles.length === 0 && (
        <div
          style={{
            padding: 20,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 14,
          }}
        >
          Cycle timing begins when a quarterly reforecast runs through the
          platform; no recorded cycles yet. A cycle is recorded automatically
          once a property's reforecast reaches a live Entrata write-back — the
          span and its phase breakdown will appear here then.
        </div>
      )}

      {!loading && !error && cycles.length > 0 && (
        <>
          {headline && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 12,
                marginBottom: 12,
              }}
            >
              {[
                {
                  label:
                    headline.scope === "portfolio"
                      ? "Avg end-to-end"
                      : "End-to-end span",
                  value: fmtDays(headline.endToEndSeconds),
                  color: text,
                },
                {
                  label: "Parse",
                  value: fmtDays(headline.parseSeconds),
                  color: sub,
                },
                {
                  label: "Review (assumptions)",
                  value: fmtDays(headline.reviewSeconds),
                  color: text,
                },
                {
                  label: "Parity",
                  value: fmtDays(headline.paritySeconds),
                  color: sub,
                },
                {
                  label: "Write-back",
                  value: fmtDays(headline.writebackSeconds),
                  color: sub,
                },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: card,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ fontSize: 12, color: sub }}>{s.label}</div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      marginTop: 4,
                      color: s.color,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

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
                  <th style={th}>Quarter</th>
                  <th style={th}>Status</th>
                  <th style={th}>Opened</th>
                  <th style={th}>Closed</th>
                  <th style={thNum}>End-to-end</th>
                  <th style={thNum}>Parse</th>
                  <th style={thNum}>Review</th>
                  <th style={thNum}>Parity</th>
                  <th style={thNum}>Write-back</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.cycleId || `${c.propertyCode}|${c.fiscalQuarter}`}>
                    <td style={td}>{c.propertyCode || EMPTY}</td>
                    <td style={td}>{c.fiscalQuarter || EMPTY}</td>
                    <td
                      style={{
                        ...td,
                        color: c.status === "closed" ? text : sub,
                      }}
                    >
                      {c.status === "closed" ? "Closed" : "Open"}
                    </td>
                    <td style={{ ...td, color: sub }}>{fmtDate(c.openedAt)}</td>
                    <td style={{ ...td, color: sub }}>{fmtDate(c.closedAt)}</td>
                    <td style={tdNum}>{formatDuration(c.endToEndSeconds)}</td>
                    <td style={{ ...tdNum, color: sub }}>
                      {formatDuration(c.parseSeconds)}
                    </td>
                    <td style={tdNum}>{formatDuration(c.reviewSeconds)}</td>
                    <td style={{ ...tdNum, color: sub }}>
                      {formatDuration(c.paritySeconds)}
                    </td>
                    <td style={{ ...tdNum, color: sub }}>
                      {formatDuration(c.writebackSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: sub, margin: "8px 2px 0" }}>
            Spans are wall-clock. A blank phase means the bounding milestones
            for that phase are not both recorded yet for the cycle. The review
            phase is derived from the itemized edit history within the cycle
            window; the write-back phase is the close-approach run into the live
            Entrata push.
          </p>
        </>
      )}
    </div>
  );
}
