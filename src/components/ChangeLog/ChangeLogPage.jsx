import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { T } from "../../lib/theme.js";
import {
  buildChangeLog,
  loadPropertyLabelMaps,
  CHANGE_TYPES,
  CHANGE_TYPE_LABELS,
  UNIDENTIFIED_ACTOR,
} from "../../lib/changeLog/changeLogQueries.js";
import { fmtWhen } from "../../lib/changeLog/changeLogFormat.js";
import {
  exportChangeLogCSV,
  exportChangeLogXLSX,
  exportChangeLogPDF,
  CHANGE_LOG_HEADERS,
} from "../../lib/changeLog/changeLogExport.js";

const EM_DASH = "—";

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function whenCell(iso) {
  return fmtWhen(iso) || EM_DASH;
}

export default function ChangeLogPage({ C = {}, userProfile = null } = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const accent = C.accent || C.primary || T.accent;
  const red = C.red || T.dangerText;

  const isAdmin = !!(
    userProfile &&
    (userProfile.is_admin || userProfile.role === "admin")
  );

  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(
    isoDay(new Date(today.getTime() - 90 * 864e5)),
  );
  const [endDate, setEndDate] = useState(isoDay(today));
  const [selectedTypes, setSelectedTypes] = useState(
    () => new Set(CHANGE_TYPES),
  );
  const [selectedProperty, setSelectedProperty] = useState("");

  const [labelMaps, setLabelMaps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [loadedContext, setLoadedContext] = useState(null);
  const [exportBusy, setExportBusy] = useState(null);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadPropertyLabelMaps()
      .then((m) => {
        if (alive) setLabelMaps(m);
      })
      .catch(() => {
        if (alive)
          setLabelMaps({ codeToKey: {}, entrataIdToKey: {}, keyToLabel: {} });
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggleType = (t) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setExportError(null);
    try {
      const types = CHANGE_TYPES.filter((t) => selectedTypes.has(t));
      const res = await buildChangeLog({
        startDate,
        endDate,
        changeTypes: types,
        labelMaps,
        isAdmin,
      });
      setResult(res);
      setLoadedContext({ startDate, endDate, changeTypes: types });
      setSelectedProperty("");
    } catch (e) {
      setError(e?.message || "Failed to load the change log.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const propertyOptions = useMemo(() => {
    if (!result) return [];
    const byKey = new Map();
    for (const r of result.rows) {
      if (!r.property_key || !r.property_label || r.property_label === EM_DASH)
        continue;
      if (!byKey.has(r.property_key))
        byKey.set(r.property_key, {
          key: r.property_key,
          label: r.property_label,
          count: 0,
        });
      byKey.get(r.property_key).count += 1;
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [result]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    if (!selectedProperty) return result.rows;
    return result.rows.filter((r) => r.property_key === selectedProperty);
  }, [result, selectedProperty]);

  const selectedPropertyLabel = useMemo(
    () => propertyOptions.find((p) => p.key === selectedProperty)?.label || "",
    [propertyOptions, selectedProperty],
  );

  const displayEntries = useMemo(() => {
    const out = [];
    const byBatch = new Map();
    for (const row of filteredRows) {
      if (!row.batch_key) {
        out.push({ kind: "row", row });
        continue;
      }
      let group = byBatch.get(row.batch_key);
      if (!group) {
        group = { kind: "batch", key: row.batch_key, rows: [] };
        byBatch.set(row.batch_key, group);
        out.push(group);
      }
      group.rows.push(row);
    }
    return out.map((e) =>
      e.kind === "batch" && e.rows.length === 1
        ? { kind: "row", row: e.rows[0] }
        : e,
    );
  }, [filteredRows]);

  const [expandedBatches, setExpandedBatches] = useState(() => new Set());
  useEffect(() => {
    setExpandedBatches(new Set());
  }, [result, selectedProperty]);
  const toggleBatch = (key) =>
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const scrollBoxRef = useRef(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });
  const syncScrollState = useCallback(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = {
      left: el.scrollLeft > 1,
      right: max > 1 && el.scrollLeft < max - 1,
    };
    setScrollState((prev) =>
      prev.left === next.left && prev.right === next.right ? prev : next,
    );
  }, []);
  useEffect(() => {
    syncScrollState();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("resize", syncScrollState);
    return () => window.removeEventListener("resize", syncScrollState);
  }, [syncScrollState, displayEntries]);

  const typeCounts = useMemo(() => {
    const counts = {};
    for (const r of filteredRows)
      counts[r.change_type] = (counts[r.change_type] || 0) + 1;
    return counts;
  }, [filteredRows]);

  const exportMeta = () => ({
    propertyLabel: selectedPropertyLabel,
    startDate: loadedContext?.startDate ?? startDate,
    endDate: loadedContext?.endDate ?? endDate,
    changeTypes:
      loadedContext?.changeTypes ??
      CHANGE_TYPES.filter((t) => selectedTypes.has(t)),
  });

  const doExport = async (kind) => {
    setExportBusy(kind);
    setExportError(null);
    try {
      const meta = exportMeta();
      if (kind === "csv") await exportChangeLogCSV(filteredRows, meta);
      else if (kind === "xlsx") await exportChangeLogXLSX(filteredRows, meta);
      else if (kind === "pdf") await exportChangeLogPDF(filteredRows, meta);
    } catch (e) {
      setExportError(e?.message || "Export failed.");
    } finally {
      setExportBusy(null);
    }
  };

  const selectStyle = {
    padding: "8px 12px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: C.white || card,
    color: text,
    fontSize: 14,
    minWidth: 180,
  };
  const dateStyle = { ...selectStyle, minWidth: 150 };
  const labelStyle = {
    fontSize: 11,
    fontWeight: 600,
    color: sub,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    display: "block",
  };
  const btn = (primary) => ({
    padding: "8px 16px",
    borderRadius: 6,
    border: `1px solid ${primary ? accent : border}`,
    background: primary ? accent : "transparent",
    color: primary ? C.white || "#fff" : text,
    fontSize: 13,
    fontWeight: 600,
    cursor: loading ? "default" : "pointer",
    opacity: loading ? 0.6 : 1,
  });
  const th = {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: `2px solid ${border}`,
    color: sub,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    background: card,
  };
  const td = {
    padding: "7px 10px",
    borderBottom: `1px solid ${border}`,
    color: text,
    fontSize: 12,
    verticalAlign: "top",
  };

  const isDim = (v) =>
    v === "not captured" ||
    v === "(empty)" ||
    v === UNIDENTIFIED_ACTOR ||
    v === "(history not captured)" ||
    v === "(prior state predates selected range)";

  const edgeFade = (side) => ({
    position: "absolute",
    top: 1,
    bottom: 1,
    [side]: 1,
    width: 36,
    pointerEvents: "none",
    borderTopRightRadius: side === "right" ? 8 : 0,
    borderBottomRightRadius: side === "right" ? 8 : 0,
    borderTopLeftRadius: side === "left" ? 8 : 0,
    borderBottomLeftRadius: side === "left" ? 8 : 0,
    background: `linear-gradient(to ${side}, transparent, ${card})`,
  });

  const renderRow = (r, key, { child = false } = {}) => (
    <tr key={key}>
      <td
        style={{
          ...td,
          paddingLeft: child ? 30 : 10,
          color: child ? sub : text,
        }}
      >
        {child ? "" : r.change_type_label}
      </td>
      <td style={td}>{r.property_label}</td>
      <td style={td}>{r.entity}</td>
      <td style={td}>{r.field}</td>
      <td style={{ ...td, color: isDim(r.old_value) ? sub : text }}>
        {r.old_value || ""}
      </td>
      <td style={{ ...td, color: isDim(r.new_value) ? sub : text }}>
        {r.new_value || ""}
      </td>
      <td
        style={{
          ...td,
          color: isDim(r.changed_by_label) ? sub : text,
          whiteSpace: "nowrap",
        }}
      >
        {r.changed_by_label}
      </td>
      <td
        style={{
          ...td,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {whenCell(r.changed_at)}
      </td>
      <td style={{ ...td, color: sub, whiteSpace: "nowrap" }}>
        {r.source_ref}
      </td>
      <td style={{ ...td, color: sub }}>{r.why}</td>
    </tr>
  );

  const renderBatch = (entry, i) => {
    const rows = entry.rows;
    const first = rows[0];
    const open = expandedBatches.has(entry.key);
    const propLabels = [
      ...new Set(rows.map((r) => r.property_label).filter(Boolean)),
    ];
    const propertyCell =
      propLabels.length === 1
        ? propLabels[0]
        : `${propLabels.length} properties`;
    const n = rows.length;
    const summary = `${first.batch_label || "Bulk change"} · ${n} change${n === 1 ? "" : "s"}`;
    return (
      <React.Fragment key={`b|${entry.key}|${i}`}>
        <tr>
          <td style={{ ...td, whiteSpace: "nowrap" }}>
            <button
              type="button"
              onClick={() => toggleBatch(entry.key)}
              aria-expanded={open}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                marginRight: 6,
                cursor: "pointer",
                color: accent,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "inherit",
              }}
            >
              {open ? "−" : "+"}
            </button>
            {first.change_type_label}
          </td>
          <td style={td}>{propertyCell}</td>
          <td style={{ ...td, fontWeight: 600 }}>{summary}</td>
          <td style={{ ...td, color: sub }}>
            {open ? "" : "expand to see each change"}
          </td>
          <td style={td} />
          <td style={td} />
          <td
            style={{
              ...td,
              color: isDim(first.changed_by_label) ? sub : text,
              whiteSpace: "nowrap",
            }}
          >
            {first.changed_by_label}
          </td>
          <td
            style={{
              ...td,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {whenCell(first.changed_at)}
          </td>
          <td style={{ ...td, color: sub, whiteSpace: "nowrap" }}>
            {first.source_ref}
          </td>
          <td style={{ ...td, color: sub }}>{first.why}</td>
        </tr>
        {open &&
          rows.map((r, j) =>
            renderRow(r, `b|${entry.key}|${j}`, { child: true }),
          )}
      </React.Fragment>
    );
  };

  return (
    <div style={{ padding: 24, color: text, maxWidth: 1400 }}>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: text }}>
          Change Log
        </h1>
        <p
          style={{
            fontSize: 13,
            color: sub,
            margin: "6px 0 0",
            maxWidth: 780,
            lineHeight: 1.5,
          }}
        >
          Every change made in the platform on top of Entrata — entity, field,
          old value, new value, who, and when. Filter by date range, change
          type, and property, then export to Excel, CSV, or PDF for the sign-off
          record. Values that were never captured are shown as blanks, never
          guessed.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "flex-end",
          background: subtle,
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
        }}
      >
        <div>
          <label style={labelStyle}>Start date</label>
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={dateStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>End date</label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={dateStyle}
          />
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <label style={labelStyle}>Change types</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {CHANGE_TYPES.map((t) => (
              <label
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 12,
                  color: text,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTypes.has(t)}
                  onChange={() => toggleType(t)}
                />
                {CHANGE_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading || selectedTypes.size === 0}
          style={btn(true)}
        >
          {loading ? "Loading…" : "Load changes"}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 6,
            border: `1px solid ${red}`,
            color: red,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <>
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                alignItems: "flex-end",
              }}
            >
              <div>
                <label style={labelStyle}>Property</label>
                <select
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">
                    All properties ({result.rows.length} change
                    {result.rows.length === 1 ? "" : "s"})
                  </option>
                  {propertyOptions.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} ({p.count})
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: 13, color: sub, paddingBottom: 8 }}>
                <strong style={{ color: text }}>{filteredRows.length}</strong>{" "}
                change{filteredRows.length === 1 ? "" : "s"}
                {Object.keys(typeCounts).length > 0 && (
                  <span>
                    {" — "}
                    {CHANGE_TYPES.filter((t) => typeCounts[t]).map((t, i) => (
                      <span key={t}>
                        {i > 0 ? " · " : ""}
                        {CHANGE_TYPE_LABELS[t]}: {typeCounts[t]}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => doExport("xlsx")}
                disabled={!!exportBusy}
                style={btn(false)}
              >
                {exportBusy === "xlsx" ? "…" : "Export Excel"}
              </button>
              <button
                onClick={() => doExport("csv")}
                disabled={!!exportBusy}
                style={btn(false)}
              >
                {exportBusy === "csv" ? "…" : "Export CSV"}
              </button>
              <button
                onClick={() => doExport("pdf")}
                disabled={!!exportBusy}
                style={btn(false)}
              >
                {exportBusy === "pdf" ? "…" : "Export PDF"}
              </button>
            </div>
          </div>

          {exportError && (
            <div style={{ marginTop: 10, color: red, fontSize: 12 }}>
              {exportError}
            </div>
          )}

          {result.notes && result.notes.length > 0 && (
            <ul
              style={{
                marginTop: 12,
                paddingLeft: 18,
                color: sub,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}

          {scrollState.right && (
            <div style={{ marginTop: 12, fontSize: 12, color: sub }}>
              Scroll the table sideways to see Changed By, When, Source and Why.
            </div>
          )}

          <div
            style={{
              position: "relative",
              marginTop: scrollState.right ? 6 : 14,
            }}
          >
            <div
              ref={scrollBoxRef}
              onScroll={syncScrollState}
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                overflow: "auto",
                maxHeight: "62vh",
                background: card,
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 1100,
                }}
              >
                <thead>
                  <tr>
                    {CHANGE_LOG_HEADERS.map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayEntries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={CHANGE_LOG_HEADERS.length}
                        style={{
                          ...td,
                          textAlign: "center",
                          color: sub,
                          padding: 28,
                        }}
                      >
                        No platform changes recorded in this range. An export
                        will still produce a valid "no changes" document.
                      </td>
                    </tr>
                  ) : (
                    displayEntries.map((entry, i) =>
                      entry.kind === "batch"
                        ? renderBatch(entry, i)
                        : renderRow(entry.row, `r|${i}`),
                    )
                  )}
                </tbody>
              </table>
            </div>
            {scrollState.right && (
              <div aria-hidden="true" style={edgeFade("right")} />
            )}
            {scrollState.left && (
              <div aria-hidden="true" style={edgeFade("left")} />
            )}
          </div>
        </>
      )}

      {!result && !error && !loading && (
        <div style={{ marginTop: 20, color: sub, fontSize: 13 }}>
          Choose a date range and change types, then{" "}
          <strong style={{ color: text }}>Load changes</strong> to build the
          audit trail.
        </div>
      )}
    </div>
  );
}
