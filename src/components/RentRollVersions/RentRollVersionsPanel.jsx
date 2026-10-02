import React, { useEffect, useState } from "react";
import {
  fetchProperties,
  logExportEvent,
  getCurrentOrgName,
} from "../../lib/supabaseClient.js";
import { loadLiveRentRollOverlay } from "../../lib/liveRentRoll.js";
import { downloadPdf } from "../../lib/pdf/pdfEngine.js";
import { buildRentRollDocDefinition } from "../../lib/pdf/rentRollPdf.js";
import {
  captureRentRollVersion,
  fetchRentRollVersions,
  fetchRentRollVersionLines,
  fetchCurrentRentRollVersion,
  setCurrentRentRollVersion,
} from "../../lib/rentRollVersionsClient.js";
import {
  VERSION_STATUS,
  diffVersions,
  pickVersionAtMonth,
  earliestCapture,
  capturedMonths,
  versionRentCoverage,
  COVERAGE_NOT_RECORDED,
} from "../../lib/rentRollVersions.js";
import {
  rentCoverage,
  rentCoverageHeadline,
  rentCoverageCompact,
  RENT_PLAUSIBLE_MIN,
} from "../../lib/rentRollView.js";
import {
  deriveChargeColumnsFromFrozenLines,
  frozenChargesRecorded,
  attachRentChargesToFrozenLines,
} from "../../lib/rentRollChargeColumns.js";
import { SkeletonTable } from "../Skeletons/ContentSkeleton.jsx";
import RentRollDriftMeter from "../DataHealth/RentRollDriftMeter.jsx";
import { T } from "../../lib/theme.js";
import { PORTFOLIO_TIME_ZONE, todayIso } from "../../lib/entrataLeaseStatus.js";
import { formatAsOf } from "../../lib/rentRollAsOfView.js";
import { logAction } from "../../lib/usage/usageClient.js";
import { SURFACE_KEYS, ACTION_KEYS } from "../../lib/usage/usageKeys.js";

const WRITE_ROLES = new Set(["gp", "gp_admin"]);

function money(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMonth(v) {
  if (!v) return "—";
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})/);
  const d = m
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function RentRollVersionsPanel({
  C = {},
  userProfile,
  propertyId = null,
  propertyName = null,
} = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const accent = C.accent || T.accent;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;

  const canEdit =
    !!userProfile &&
    (userProfile.is_admin === true || WRITE_ROLES.has(userProfile.role));

  const [properties, setProperties] = useState(null);
  const [propsErr, setPropsErr] = useState(null);
  const [pickedId, setPickedId] = useState("");
  const activeId = propertyId || pickedId;

  const [versions, setVersions] = useState(null);
  const [current, setCurrent] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [label, setLabel] = useState("");
  const [makeCurrent, setMakeCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportingId, setExportingId] = useState(null);

  const [compareId, setCompareId] = useState(null);
  const [compareResult, setCompareResult] = useState(null);

  const [lookupMonth, setLookupMonth] = useState("");

  useEffect(() => {
    if (propertyId) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchProperties();
        if (cancelled) return;
        setProperties((all || []).filter((p) => p.entrataPropertyId));
      } catch (e) {
        if (!cancelled) setPropsErr(e?.message || "Failed to load properties.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const [currentCoverage, setCurrentCoverage] = useState(null);

  const coverageToken = React.useRef(0);

  const reload = React.useCallback(async (pid) => {
    coverageToken.current += 1;
    const token = coverageToken.current;
    if (!pid) {
      setVersions(null);
      setCurrent(null);
      setOverlay(null);
      setCurrentCoverage(null);
      return;
    }
    setLoading(true);
    setError(null);
    setCompareId(null);
    setCompareResult(null);
    setCurrentCoverage(null);
    try {
      const [vs, cur, live] = await Promise.all([
        fetchRentRollVersions(pid),
        fetchCurrentRentRollVersion(pid),
        loadLiveRentRollOverlay(pid),
      ]);
      setVersions(vs || []);
      setCurrent(cur || null);
      setOverlay(live || null);

      const fromSummary = versionRentCoverage(cur);
      if (fromSummary) {
        if (token === coverageToken.current) setCurrentCoverage(fromSummary);
      } else if (cur?.id) {
        try {
          const lines = await fetchRentRollVersionLines(cur.id);
          if (token === coverageToken.current)
            setCurrentCoverage(rentCoverage(lines || []));
        } catch {
          if (token === coverageToken.current) setCurrentCoverage(null);
        }
      }
    } catch (e) {
      setError(e?.message || "Failed to load rent-roll versions.");
      setVersions([]);
      setCurrent(null);
      setOverlay(null);
      setCurrentCoverage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload(activeId);
  }, [activeId, reload]);

  const liveSummary = overlay?.summary || null;

  const captureDateLabel = formatAsOf(todayIso(PORTFOLIO_TIME_ZONE));

  const liveCoverage = overlay?.rows ? rentCoverage(overlay.rows) : null;

  const liveCoverageText = (() => {
    const head = rentCoverageHeadline(liveCoverage);
    if (!head) return null;
    const gaps = (liveCoverage.missing || 0) + (liveCoverage.implausible || 0);
    if (!gaps) return head;
    return (
      head +
      " The effective-rent total beside this sums every value as synced, including the other " +
      gaps +
      (gaps === 1 ? " lease." : " leases.")
    );
  })();

  const lookupResult = lookupMonth
    ? pickVersionAtMonth(versions || [], lookupMonth)
    : null;
  const earliestMonth = earliestCapture(versions || []);

  const months = capturedMonths(versions || []);
  const latestMonth = months.length ? months[months.length - 1] : "";

  useEffect(() => {
    setLookupMonth(latestMonth);
  }, [activeId, latestMonth]);

  async function onCapture() {
    if (!activeId || !label.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: err } = await captureRentRollVersion(activeId, {
        label: label.trim(),
        makeCurrent,
      });
      if (err) {
        setError(err.message || "Capture failed.");
        return;
      }
      logAction(SURFACE_KEYS.RENT_ROLL_SIGNOFF, ACTION_KEYS.CAPTURE_VERSION, {
        propertyId: activeId,
      });
      setNotice(
        `Captured "${label.trim()}" (${data?.line_count ?? 0} lines)${data?.made_current ? " — set as current" : ""}.`,
      );
      setLabel("");
      setMakeCurrent(false);
      await reload(activeId);
    } catch (e) {
      setError(e?.message || "Capture failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onSetCurrent(id) {
    setBusy(true);
    setError(null);
    try {
      await setCurrentRentRollVersion(activeId, id);
      await reload(activeId);
    } catch (e) {
      setError(e?.message || "Set-current failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onCompare(id) {
    if (compareId === id) {
      setCompareId(null);
      setCompareResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const target = current?.id;
      if (!target) {
        setError("No current version to compare against.");
        return;
      }
      const [aLines, bLines] = await Promise.all([
        fetchRentRollVersionLines(id),
        fetchRentRollVersionLines(target),
      ]);
      setCompareId(id);
      setCompareResult(diffVersions(aLines, bLines));
    } catch (e) {
      setError(e?.message || "Compare failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onExportVersion(v) {
    setExportingId(v.id);
    setError(null);
    try {
      const lines = await fetchRentRollVersionLines(v.id);
      const propName =
        propertyName ||
        (properties || []).find((p) => p.id === activeId)?.name ||
        "";
      const chargeColumns = deriveChargeColumnsFromFrozenLines(lines || []);
      const chargesRecorded = frozenChargesRecorded(lines || []);
      const exportRows = attachRentChargesToFrozenLines(
        lines || [],
        RENT_PLAUSIBLE_MIN,
      );
      const doc = buildRentRollDocDefinition({
        generatedAt: new Date(),
        rows: exportRows,
        summary: v.summary || null,
        capturedRentTotal: v.summary?.totalEffectiveRent ?? null,
        property: { name: propName },
        title: "Rent Roll — Captured Version",
        chargeColumns,
        columnOptions: { netEffective: false, gpr: false, totalCharges: false },
        orgName: getCurrentOrgName(),
        subtitle:
          `${v.label} · as of ${fmtDate(v.as_of)}${v.signed_off_by ? ` · signed off by ${v.signed_off_by}` : ""}` +
          (chargesRecorded
            ? ""
            : " · charge detail not captured at this version"),
      });
      const safe = (s) => String(s || "").replace(/[^a-z0-9]+/gi, "-");
      const fname = `RentRoll-${safe(propName || "property")}-${safe(v.label || v.id)}.pdf`;
      logExportEvent({
        datasetKey: `rent-roll-version:${propName}:${v.label || v.id}`,
        format: "pdf",
        rowCount: (lines || []).length,
        action: "completed",
      }).catch(() => {});
      await downloadPdf(doc, fname);
    } catch (e) {
      setError(e?.message || "Export failed.");
    } finally {
      setExportingId(null);
    }
  }

  const boxStyle = {
    border: `1px solid ${border}`,
    borderRadius: 10,
    background: card,
    marginBottom: 14,
    overflow: "hidden",
  };
  const headRow = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: `1px solid ${border}`,
    background: subtle,
  };
  const th = {
    padding: "8px 10px",
    fontWeight: 600,
    textAlign: "left",
    color: sub,
  };
  const td = { padding: "8px 10px", color: text, verticalAlign: "top" };
  const labelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: sub,
    display: "block",
    marginBottom: 4,
  };
  const inputStyle = {
    width: "100%",
    padding: "7px 9px",
    fontSize: 13,
    border: `1px solid ${border}`,
    borderRadius: 6,
    color: text,
    background: "#fff",
    boxSizing: "border-box",
  };
  const btn = (kind) => ({
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    border: `1px solid ${kind === "primary" ? accent : border}`,
    background: kind === "primary" ? accent : "#fff",
    color: kind === "primary" ? "#fff" : kind === "danger" ? red : accent,
    opacity: busy ? 0.6 : 1,
  });
  const badge = (color, bg) => ({
    fontSize: 10,
    fontWeight: 700,
    color,
    background: bg,
    borderRadius: 4,
    padding: "2px 6px",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  });

  function statusBadge(status) {
    if (status === VERSION_STATUS.LOCKED)
      return (
        <span style={badge("var(--ds-info-text)", "var(--ds-info-bg)")}>
          Locked
        </span>
      );
    if (status === VERSION_STATUS.SIGNED)
      return <span style={badge(green, "var(--ds-success-bg)")}>Signed</span>;
    return (
      <span style={badge("var(--ds-warning-text)", "var(--ds-warning-bg)")}>
        Draft
      </span>
    );
  }

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "8px 4px" }}>
      <div style={{ marginBottom: 12 }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: text,
            margin: "0 0 4px",
          }}
        >
          Rent-Roll Version History{propertyName ? ` — ${propertyName}` : ""}
        </h2>
        <p style={{ fontSize: 13, color: sub, margin: 0 }}>
          Freeze the effective rent roll (Entrata plus the active adjustment
          overlay) as a named, dated version you can export as a PDF to send on.
          A captured version is permanent and never changes afterwards; set one
          as current and it becomes the as-of snapshot downstream surfaces read
          from. New changes start a new version.
        </p>
      </div>

      {!canEdit && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: "var(--ds-warning-bg)",
            border:
              "1px solid color-mix(in srgb, var(--ds-warning-dot) 45.1%, transparent)",
            borderRadius: 8,
            color: "var(--ds-warning-text)",
            fontSize: 13,
          }}
        >
          You have read-only access. Capturing a rent-roll version requires an
          asset-management or admin role; those controls are hidden for your
          role. You can still export any captured version as a PDF. (Server-side
          RLS enforces this regardless of the UI.)
        </div>
      )}

      {!propertyId && (
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Property</label>
          {propsErr && (
            <div style={{ color: red, fontSize: 13, marginBottom: 6 }}>
              {propsErr}
            </div>
          )}
          {properties == null ? (
            <SkeletonTable C={C} rows={1} cols={1} />
          ) : properties.length === 0 ? (
            <div style={{ fontSize: 13, color: sub }}>
              No Entrata-mapped properties found. Map a property to its Entrata
              Property ID on the property page first.
            </div>
          ) : (
            <select
              style={{ ...inputStyle, maxWidth: 420 }}
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
            >
              <option value="">Select a property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: "var(--ds-danger-bg)",
            border:
              "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
            borderRadius: 8,
            color: "var(--ds-danger-text)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: "var(--ds-success-bg)",
            border:
              "1px solid color-mix(in srgb, var(--ds-success-dot) 34.9%, transparent)",
            borderRadius: 8,
            color: "var(--ds-success-text)",
            fontSize: 13,
          }}
        >
          {notice}
        </div>
      )}

      {!activeId ? (
        <div style={{ fontSize: 13, color: sub, padding: "8px 2px" }}>
          Select a property above to view and capture rent-roll versions.
        </div>
      ) : loading ? (
        <SkeletonTable C={C} rows={8} cols={5} />
      ) : (
        <>
          <div style={boxStyle}>
            <div style={headRow}>
              <strong style={{ color: text, fontSize: 13 }}>
                Current version
              </strong>
              {liveSummary && liveSummary.totalRows > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    color: sub,
                    textAlign: "right",
                    maxWidth: 620,
                  }}
                  title="The live roll moves with Entrata and adjustments, so this total will differ from captured versions below as the roll changes."
                >
                  Live roll (today, uncaptured): {liveSummary.totalRows} rows ·{" "}
                  {money(liveSummary.totalEffectiveRent)} effective rent ·{" "}
                  {liveSummary.occupiedRows} occupied
                  {liveCoverageText && (
                    <span style={{ display: "block", marginTop: 3 }}>
                      {liveCoverageText}
                    </span>
                  )}
                </span>
              )}
            </div>
            <div style={{ padding: "12px 14px" }}>
              {current ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 16,
                    alignItems: "center",
                    fontSize: 13,
                    color: text,
                  }}
                >
                  {statusBadge(current.status)}
                  <strong>{current.label}</strong>
                  <span style={{ color: sub }}>
                    as of {fmtDate(current.as_of)}
                  </span>
                  <span style={{ color: sub }}>{current.line_count} lines</span>
                  <span style={{ color: sub }}>
                    {money(current.summary?.totalEffectiveRent)} effective rent
                    at capture
                    {" · "}
                    {currentCoverage
                      ? rentCoverageCompact(currentCoverage)
                      : COVERAGE_NOT_RECORDED}
                  </span>
                  {current.signed_off_by && (
                    <span style={{ color: sub }}>
                      signed off by {current.signed_off_by}
                    </span>
                  )}
                  <RentRollDriftMeter propertyId={activeId} C={C} />
                </div>
              ) : (
                <div style={{ fontSize: 13, color: sub }}>
                  No current version set for this property yet. Capture and lock
                  a version below, or set an existing version as current. Until
                  then, downstream surfaces read the live Entrata-plus-overlay
                  roll directly.
                </div>
              )}
            </div>
          </div>

          <div style={boxStyle}>
            <div style={headRow}>
              <strong style={{ color: text, fontSize: 13 }}>
                Point-in-time effective rent
              </strong>
              <span style={{ fontSize: 12, color: sub }}>
                The building's total effective rent as captured at a past month
              </span>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 16,
                  alignItems: "end",
                }}
              >
                <div>
                  <label style={labelStyle}>Month</label>
                  {months.length === 0 ? (
                    <select
                      style={{ ...inputStyle, maxWidth: 200 }}
                      value=""
                      disabled
                    >
                      <option value="">No snapshots captured</option>
                    </select>
                  ) : (
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <select
                        style={{ ...inputStyle, maxWidth: 200 }}
                        value={lookupMonth}
                        onChange={(e) => setLookupMonth(e.target.value)}
                      >
                        {[...months].reverse().map((m) => (
                          <option key={m} value={m}>
                            {fmtMonth(m)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        style={btn()}
                        disabled={!latestMonth || lookupMonth === latestMonth}
                        onClick={() => setLookupMonth(latestMonth)}
                        title={`Jump to the most recent snapshot (${fmtMonth(latestMonth)})`}
                      >
                        Latest
                      </button>
                    </div>
                  )}
                  {months.length > 0 && (
                    <div style={{ fontSize: 11, color: sub, marginTop: 6 }}>
                      {months.length === 1
                        ? `One snapshot available: ${fmtMonth(latestMonth)}.`
                        : `Snapshots available ${fmtMonth(months[0])} – ${fmtMonth(latestMonth)} (${months.length} months).`}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                {!lookupMonth ? (
                  <div style={{ fontSize: 13, color: sub }}>
                    Pick a month to see the building's total effective rent from
                    the rent-roll version captured on or before it.
                    {earliestMonth
                      ? ` Point-in-time data is available from ${fmtMonth(earliestMonth)} onward.`
                      : " No versions have been captured yet, so there is no point-in-time history to read."}
                  </div>
                ) : lookupResult ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 14,
                      alignItems: "center",
                      fontSize: 13,
                      color: text,
                    }}
                  >
                    <span style={{ fontSize: 20, fontWeight: 700 }}>
                      {money(lookupResult.total_effective_rent)}
                    </span>
                    <span style={{ color: sub }}>
                      total effective rent at capture
                    </span>
                    <span style={{ color: sub }}>
                      · {lookupResult.line_count} lines ·{" "}
                      {lookupResult.occupied_rows} occupied
                    </span>
                    <span style={{ color: sub }}>
                      ·{" "}
                      {lookupResult.coverage
                        ? rentCoverageCompact(lookupResult.coverage)
                        : COVERAGE_NOT_RECORDED}
                    </span>
                    <span style={{ color: sub }}>
                      · from "{lookupResult.label}", as of{" "}
                      {fmtDate(lookupResult.as_of)}
                    </span>
                    {statusBadge(lookupResult.status)}
                    {lookupResult.status === VERSION_STATUS.DRAFT ? (
                      <span style={{ color: sub }}>auto-captured snapshot</span>
                    ) : lookupResult.signed_off_by ? (
                      <span style={{ color: sub }}>
                        signed off by {lookupResult.signed_off_by}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: sub }}>
                    No rent-roll version was captured on or before{" "}
                    {fmtMonth(lookupMonth)}.{" "}
                    {earliestMonth
                      ? `Point-in-time data is available from ${fmtMonth(earliestMonth)} onward; earlier months were not captured.`
                      : "No versions have been captured for this property yet."}
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11, color: sub, margin: "10px 0 0" }}>
                This is the captured total, not a forecast. Rent growth is yours
                to compute from the months you pick; the platform does not
                derive it. Captured totals and the live-roll total above are the
                same measure — the sum of every line's effective rent — read at
                different times: a capture is frozen as of its date, while the
                live roll keeps moving with Entrata and adjustments. When the
                two differ, the roll has changed since that capture (the drift
                meter in Current version tracks how far).
              </p>
              <p style={{ fontSize: 11, color: sub, margin: "8px 0 0" }}>
                Every total on this panel is stated with the share of the roll
                carrying a recorded rent, because a rent roll can be complete in
                leases and incomplete in rents — a building mid-turnover
                routinely is. The total always sums every value as synced; the
                coverage figure tells you how many leases contributed one.
                Versions captured before coverage was recorded read "
                {COVERAGE_NOT_RECORDED}"; that is a real gap in the frozen
                record, not a loading state, and it cannot be filled in after
                the fact without re-capturing.
              </p>
            </div>
          </div>

          {canEdit && (
            <div style={boxStyle}>
              <div style={headRow}>
                <strong style={{ color: text, fontSize: 13 }}>
                  Capture a new version
                </strong>
              </div>
              <div style={{ padding: "12px 14px" }}>
                <div
                  style={{
                    fontSize: 12,
                    color: sub,
                    lineHeight: 1.6,
                    marginBottom: 12,
                  }}
                >
                  Capture freezes the roll as it stands{" "}
                  <strong style={{ color: text }}>
                    today, {captureDateLabel}
                  </strong>
                  , whatever date the Live Rent Roll tab is showing. A captured
                  version cannot be edited or re-dated afterwards — to capture a
                  different date, capture again on that date.
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label style={labelStyle}>Version name</label>
                    <input
                      style={inputStyle}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. June 2026 rent roll — for the lender"
                    />
                  </div>
                  <button
                    style={btn("primary")}
                    disabled={busy || !label.trim()}
                    onClick={onCapture}
                  >
                    {busy ? "Working…" : "Capture version"}
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 18,
                    marginTop: 10,
                    alignItems: "center",
                    fontSize: 13,
                    color: text,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={makeCurrent}
                      onChange={(e) => setMakeCurrent(e.target.checked)}
                    />
                    <span>
                      Set as current
                      <span style={{ color: sub, fontSize: 11, marginLeft: 6 }}>
                        (downstream surfaces switch to reading this version)
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          <div style={boxStyle}>
            <div style={headRow}>
              <strong style={{ color: text, fontSize: 13 }}>
                Version history
              </strong>
            </div>
            {versions == null ? (
              <div style={{ padding: 12 }}>
                <SkeletonTable C={C} rows={4} cols={5} />
              </div>
            ) : versions.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 13, color: sub }}>
                No versions captured yet. Capture a version above to freeze the
                current effective roll as a named, dated record you can export
                as a PDF. Set a version as current and it becomes the as-of
                snapshot downstream surfaces read from.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}` }}>
                      {[
                        "Version",
                        "Status",
                        "As of",
                        "Lines",
                        "Effective rent at capture",
                        "Actions",
                      ].map((h) => (
                        <th key={h} style={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => {
                      const isCurrent = current?.id === v.id;
                      const rowCoverage = versionRentCoverage(v);
                      return (
                        <tr
                          key={v.id}
                          style={{ borderBottom: `1px solid ${border}` }}
                        >
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{v.label}</div>
                            {isCurrent && (
                              <span
                                style={{
                                  ...badge(accent, "var(--ds-info-bg)"),
                                  marginTop: 4,
                                  display: "inline-block",
                                }}
                              >
                                Current
                              </span>
                            )}
                          </td>
                          <td style={td}>{statusBadge(v.status)}</td>
                          <td style={td}>{fmtDate(v.as_of)}</td>
                          <td style={td}>{v.line_count}</td>
                          <td style={td}>
                            {money(v.summary?.totalEffectiveRent)}
                            <div
                              style={{ color: sub, fontSize: 11, marginTop: 2 }}
                            >
                              {rowCoverage
                                ? rentCoverageCompact(rowCoverage)
                                : COVERAGE_NOT_RECORDED}
                            </div>
                          </td>
                          <td style={td}>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 6,
                              }}
                            >
                              <button
                                style={btn()}
                                disabled={busy || exportingId === v.id}
                                onClick={() => onExportVersion(v)}
                              >
                                {exportingId === v.id
                                  ? "Exporting…"
                                  : "Export PDF"}
                              </button>
                              {current?.id && !isCurrent && (
                                <button
                                  style={btn()}
                                  disabled={busy}
                                  onClick={() => onCompare(v.id)}
                                >
                                  {compareId === v.id
                                    ? "Hide diff"
                                    : "Compare to current"}
                                </button>
                              )}
                              {canEdit && !isCurrent && (
                                <button
                                  style={btn()}
                                  disabled={busy}
                                  onClick={() => onSetCurrent(v.id)}
                                >
                                  Set current
                                </button>
                              )}
                            </div>
                            {compareId === v.id && compareResult && (
                              <div
                                style={{
                                  marginTop: 6,
                                  fontSize: 11,
                                  color: sub,
                                }}
                              >
                                vs current:{" "}
                                <strong style={{ color: green }}>
                                  {compareResult.added.length} added
                                </strong>
                                ,{" "}
                                <strong style={{ color: red }}>
                                  {compareResult.removed.length} removed
                                </strong>
                                ,{" "}
                                <strong
                                  style={{ color: "var(--ds-warning-text)" }}
                                >
                                  {compareResult.changed.length} changed
                                </strong>
                                , {compareResult.unchanged.length} unchanged
                                {compareResult.signatureMatch && (
                                  <span> · identical content</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
