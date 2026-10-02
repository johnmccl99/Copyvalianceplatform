import React, { useEffect, useMemo, useState } from "react";
import {
  fetchTimeSavedSummary,
  fetchAdoption,
  splitMeasuredEstimated,
  formatMinutes,
} from "../../lib/usage/timeSaved.js";
import { surfaceLabel } from "../../lib/usage/usageKeys.js";
import {
  fetchTimeBySurface,
  rollupTimeBySurface,
} from "../../lib/usage/timeBySurface.js";

const EMPTY = "—";

const RANGES = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
];

function rangeBounds(days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function fmtDateTime(ts) {
  if (!ts) return EMPTY;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function userRef(uid) {
  if (!uid) return EMPTY;
  const s = String(uid);
  return `user…${s.slice(-4)}`;
}

export default function UsageDashboard({ theme = {} } = {}) {
  const text = theme.text || "#0F172A";
  const sub = theme.sub || "#64748B";
  const border = theme.border || "#E2E8F0";
  const card = theme.card || "#FFFFFF";
  const subtle = theme.subtle || "#F8FAFC";
  const red = theme.red || "#DC2626";
  const accent = theme.accent || "#2563EB";

  const [rangeKey, setRangeKey] = useState("30d");
  const [summary, setSummary] = useState([]);
  const [adoption, setAdoption] = useState(null);
  const [timeRows, setTimeRows] = useState([]);
  const [timeUserId, setTimeUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const range = RANGES.find((r) => r.key === rangeKey) || RANGES[1];
    const { from, to } = rangeBounds(range.days);
    setLoading(true);
    setError(null);
    Promise.all([
      fetchTimeSavedSummary({ from, to }),
      fetchAdoption({ from, to }),
      fetchTimeBySurface({ from, to }),
    ])
      .then(([sumRes, adoptRes, timeRes]) => {
        if (!alive) return;
        if (sumRes.error) setError(sumRes.error);
        else if (adoptRes.error) setError(adoptRes.error);
        else if (timeRes.error) setError(timeRes.error);
        setSummary(sumRes.rows || []);
        setAdoption(adoptRes.agg || null);
        setTimeRows(timeRes.rows || []);
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
  }, [rangeKey]);

  const split = useMemo(() => splitMeasuredEstimated(summary), [summary]);
  const allTimeRollup = useMemo(
    () => rollupTimeBySurface(timeRows),
    [timeRows],
  );
  const timeRollup = useMemo(
    () => rollupTimeBySurface(timeRows, { userId: timeUserId }),
    [timeRows, timeUserId],
  );
  const hasAnyEvents = (adoption?.totalEvents || 0) > 0;

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
        Usage & time saved{" "}
        <span style={{ fontSize: 12, fontWeight: 500, color: sub }}>
          (product adoption + measured time saved)
        </span>
      </h2>
      <p style={{ fontSize: 13, color: sub, margin: "0 0 10px" }}>
        What gets used across the platform, and the working time it saves versus
        the by-hand workflow it replaces. Time saved is shown split between{" "}
        <strong>measured</strong> (calibrated against a signed-off manual-time
        equivalent) and <strong>estimated</strong> (pending sign-off). An
        estimate is never reported as a measured fact.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRangeKey(r.key)}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              cursor: "pointer",
              border: `1px solid ${rangeKey === r.key ? accent : border}`,
              background: rangeKey === r.key ? accent : card,
              color: rangeKey === r.key ? "#FFFFFF" : sub,
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ padding: 20, color: sub, fontSize: 14 }} role="status">
          Loading usage…
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
          Could not load usage
          {error?.message ? `. ${String(error.message)}` : "."}
        </div>
      )}

      {!loading && !error && !hasAnyEvents && (
        <div
          style={{
            padding: 20,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 14,
          }}
        >
          No usage recorded in this window yet. Product-usage capture records an
          event when a teammate opens a surface (Home, a property tab, a BI
          dashboard) or takes a tracked action (a rent-roll adjustment, a
          sign-off, an export). Once the team is working in the platform,
          adoption and time-saved figures appear here. Time-saved values stay
          marked "estimated (pending sign-off)" until the manual-time
          equivalents are calibrated.
        </div>
      )}

      {!loading && !error && hasAnyEvents && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>
                Time saved (measured)
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 4,
                  color: text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMinutes(split.measuredMinutes)}
              </div>
              <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                calibrated equivalents only
              </div>
            </div>
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>
                Time saved (estimated)
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 4,
                  color: sub,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMinutes(split.estimatedMinutes)}
              </div>
              <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                pending sign-off
              </div>
            </div>
            <div
              style={{
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, color: sub }}>Active users</div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 4,
                  color: text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {adoption?.activeUsers ?? 0}
              </div>
              <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                {adoption?.totalEvents ?? 0} events
              </div>
            </div>
          </div>

          {split.measuredMinutes === 0 && split.estimatedMinutes === 0 && (
            <p style={{ fontSize: 12, color: sub, margin: "0 0 14px" }}>
              No time-saved value yet: the manual-time equivalents are seeded
              empty and await calibration. Events are still counted for adoption
              below.
            </p>
          )}

          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              margin: "16px 0 6px",
              color: text,
            }}
          >
            Adoption by surface
          </h3>
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
                  <th style={th}>Surface</th>
                  <th style={thNum}>Events</th>
                </tr>
              </thead>
              <tbody>
                {(adoption?.bySurface || []).map((s) => (
                  <tr key={s.key}>
                    <td style={td}>{surfaceLabel(s.key)}</td>
                    <td style={tdNum}>{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              margin: "16px 0 6px",
              color: text,
            }}
          >
            Adoption by role
          </h3>
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
                  <th style={th}>Role</th>
                  <th style={thNum}>Events</th>
                </tr>
              </thead>
              <tbody>
                {(adoption?.byRole || []).map((r) => (
                  <tr key={r.key}>
                    <td style={td}>{r.key}</td>
                    <td style={tdNum}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              margin: "16px 0 6px",
              color: text,
            }}
          >
            Time by module{" "}
            <span style={{ fontSize: 11, fontWeight: 500, color: sub }}>
              (active time per surface, idle gaps capped at 30 min)
            </span>
          </h3>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <label
              htmlFor="usage-time-user"
              style={{ fontSize: 12, color: sub }}
            >
              User
            </label>
            <select
              id="usage-time-user"
              value={timeUserId || ""}
              onChange={(event) => setTimeUserId(event.target.value || null)}
              style={{
                padding: "5px 8px",
                border: `1px solid ${border}`,
                borderRadius: 6,
                background: card,
                color: text,
                fontSize: 12,
              }}
            >
              <option value="">All users (by role)</option>
              {allTimeRollup.users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {userRef(u.userId)} · {u.role || "(unknown)"}
                </option>
              ))}
            </select>
          </div>
          {timeRollup.surfaces.length === 0 ? (
            <p style={{ fontSize: 12, color: sub, margin: "0 0 10px" }}>
              No timed activity in this window.
            </p>
          ) : (
            <>
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
                      <th style={th}>Surface</th>
                      <th style={thNum}>Minutes</th>
                      <th style={thNum}>Events</th>
                      <th style={th}>Top actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeRollup.surfaces.map((surface) => (
                      <tr key={surface.surfaceKey || "(unknown)"}>
                        <td style={td}>{surfaceLabel(surface.surfaceKey)}</td>
                        <td style={tdNum}>{formatMinutes(surface.minutes)}</td>
                        <td style={tdNum}>{surface.events}</td>
                        <td style={td}>
                          {surface.actions.length
                            ? surface.actions
                                .map((a) => `${a.actionKey} ×${a.events}`)
                                .join(", ")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: sub,
                  textAlign: "right",
                  margin: "7px 2px 0",
                }}
              >
                Total active time: {formatMinutes(timeRollup.totalMinutes)}
              </div>
            </>
          )}

          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              margin: "16px 0 6px",
              color: text,
            }}
          >
            Activation{" "}
            <span style={{ fontSize: 11, fontWeight: 500, color: sub }}>
              (gp/admin — per-user last-active)
            </span>
          </h3>
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
                  <th style={th}>User</th>
                  <th style={th}>Role</th>
                  <th style={thNum}>Events</th>
                  <th style={th}>Last active</th>
                </tr>
              </thead>
              <tbody>
                {(adoption?.perUser || []).map((u) => (
                  <tr key={u.userId}>
                    <td style={td}>{userRef(u.userId)}</td>
                    <td style={{ ...td, color: sub }}>{u.role || EMPTY}</td>
                    <td style={tdNum}>{u.count}</td>
                    <td style={{ ...td, color: sub }}>
                      {fmtDateTime(u.lastActive)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 11, color: sub, margin: "10px 2px 0" }}>
            Events carry actions, roles, surface keys and timestamps only — no
            content, no field values, no tenant or financial data. Activation is
            aggregated by role across the platform; the per-user view above
            exists solely to confirm sign-in and return, and is gp/admin-only.
            Adoption figures cover up to the most recent events in the window.
            Time by module is derived from event timestamps only; intervals over
            30 minutes between events are treated as idle and not counted.
          </p>
        </>
      )}
    </div>
  );
}
