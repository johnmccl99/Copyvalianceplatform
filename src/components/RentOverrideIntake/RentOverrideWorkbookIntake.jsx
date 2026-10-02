import { useState, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { T } from "../../lib/theme.js";
import {
  fetchProperties,
  fetchEntrataRentRoll,
  fetchLeaseAdjustments,
  insertLeaseAdjustment,
  updateLeaseAdjustment,
} from "../../lib/supabaseClient.js";
import {
  detectColumns,
  normalizeParsedRows,
  resolvePropertyId,
  buildOverridePreview,
} from "../../lib/rentOverrideWorkbook.js";
import {
  planOverrideWrites,
  detectGroupCollisions,
  OVERRIDE_TYPE,
} from "../../lib/rentOverrideWrite.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function readWorkbookFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error("File is larger than 20 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, {
          type: "array",
          cellFormula: false,
          cellHTML: false,
          sheetRows: 10000,
        });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          reject(new Error("The workbook has no sheets."));
          return;
        }
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          defval: null,
        });
        const headers = rows.length ? Object.keys(rows[0]) : [];
        resolve({ rows, headers });
      } catch (err) {
        reject(
          new Error(`Could not parse the workbook: ${err.message || err}`),
        );
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export default function RentOverrideWorkbookIntake({
  C = {},
  userProfile,
  scopePropertyId = null,
  scopePropertyName = null,
  writeAdjustmentType = OVERRIDE_TYPE,
  onApplyComplete = null,
} = {}) {
  const text = C.text || C.fg || T.textPrimary;
  const sub = C.sub || C.subtext || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const accent = C.accent || T.accent || "#2563eb";
  const danger = C.danger || T.dangerText || "#b91c1c";
  const ok = C.success || T.successText || "#15803d";

  const td = {
    padding: "6px 10px",
    fontSize: 12.5,
    borderBottom: `1px solid ${border}`,
    verticalAlign: "top",
  };
  const num = { ...td, fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const th = {
    ...td,
    fontWeight: 700,
    color: sub,
    borderBottom: `2px solid ${border}`,
  };

  const [roster, setRoster] = useState(null);
  const [rosterError, setRosterError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [result, setResult] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applyReport, setApplyReport] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [ackCollisions, setAckCollisions] = useState(false);

  const asOf = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const props = await fetchProperties();
        if (cancelled) return;
        const mapped = (props || [])
          .filter((p) => p.entrataPropertyId != null)
          .map((p) => ({
            entrata_property_id: p.entrataPropertyId,
            name: p.name,
            platform_id: p.id,
          }));
        setRoster(mapped);
      } catch (err) {
        if (!cancelled) setRosterError(err.message || String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForNewFile = () => {
    setParseError(null);
    setResult(null);
    setApplyReport(null);
    setConfirming(false);
    setAckCollisions(false);
  };

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      resetForNewFile();
      setFileName(file.name);
      setBusy(true);
      try {
        if (!roster)
          throw new Error(
            "Property roster is still loading — try again in a moment.",
          );
        const platformIdByEntrataId = {};
        const rosterForResolver = roster.map((p) => {
          platformIdByEntrataId[String(p.entrata_property_id)] = p.platform_id;
          return { entrata_property_id: p.entrata_property_id, name: p.name };
        });

        const { rows, headers } = await readWorkbookFile(file);
        const { columns, missing } = detectColumns(headers);
        if (missing.length) {
          setResult({ columns, missing, headers, preview: null });
          setBusy(false);
          return;
        }
        const normalized = normalizeParsedRows(rows, columns);

        const referenced = new Set();
        for (const r of normalized) {
          const pr = resolvePropertyId(r.property, rosterForResolver);
          if (pr.status === "matched")
            referenced.add(String(pr.entrataPropertyId));
        }
        const bedsByPropertyId = {};
        const existingByProperty = {};
        await Promise.all(
          Array.from(referenced).map(async (eid) => {
            const platformId = platformIdByEntrataId[eid];
            if (platformId == null) return;
            const [beds, existing] = await Promise.all([
              fetchEntrataRentRoll(platformId, { asOf }),
              fetchLeaseAdjustments(platformId),
            ]);
            bedsByPropertyId[eid] = beds || [];
            existingByProperty[eid] = existing || [];
          }),
        );

        const preview = buildOverridePreview(normalized, {
          propertyRoster: rosterForResolver,
          bedsByPropertyId,
          scopePropertyId,
        });
        const plan = planOverrideWrites(preview.matched, existingByProperty);
        const collisions = detectGroupCollisions(
          preview.matched,
          existingByProperty,
        );
        setResult({
          columns,
          missing: [],
          headers,
          preview,
          plan,
          collisions,
          existingByProperty,
          platformIdByEntrataId,
          asOf,
        });
      } catch (err) {
        setParseError(err.message || String(err));
      } finally {
        setBusy(false);
      }
    },
    [roster, asOf, scopePropertyId],
  );

  const runApply = useCallback(async () => {
    if (!result || !result.plan) return;
    setConfirming(false);
    setApplying(true);
    setApplyReport(null);
    const { plan, platformIdByEntrataId } = result;
    const report = {
      inserted: 0,
      updated: 0,
      unchanged: plan.unchanged.length,
      failed: [],
    };
    try {
      for (const ins of plan.inserts) {
        const platformId = platformIdByEntrataId[String(ins.entrataPropertyId)];
        try {
          await insertLeaseAdjustment(platformId, {
            adjustment_type: writeAdjustmentType,
            payload: ins.payload,
          });
          report.inserted += 1;
        } catch (err) {
          report.failed.push({
            unit: ins.unitNumber,
            op: "insert",
            error: err.message || String(err),
          });
        }
      }
      for (const upd of plan.updates) {
        try {
          await updateLeaseAdjustment(upd.id, { payload: upd.payload });
          report.updated += 1;
        } catch (err) {
          report.failed.push({
            unit: upd.unitNumber,
            op: "update",
            error: err.message || String(err),
          });
        }
      }
      setApplyReport(report);
      if (
        typeof onApplyComplete === "function" &&
        (report.inserted || report.updated)
      ) {
        onApplyComplete({
          propertyId: scopePropertyId,
          propertyName: scopePropertyName,
          overridesApplied: report.inserted + report.updated,
        });
      }
      if (result.preview) {
        const refreshedExisting = {};
        await Promise.all(
          Object.keys(result.existingByProperty).map(async (eid) => {
            const platformId = platformIdByEntrataId[eid];
            refreshedExisting[eid] =
              platformId == null
                ? []
                : (await fetchLeaseAdjustments(platformId)) || [];
          }),
        );
        setResult((prev) =>
          prev
            ? {
                ...prev,
                existingByProperty: refreshedExisting,
                plan: planOverrideWrites(
                  prev.preview.matched,
                  refreshedExisting,
                ),
              }
            : prev,
        );
      }
    } catch (err) {
      setApplyReport({ ...report, fatal: err.message || String(err) });
    } finally {
      setApplying(false);
    }
  }, [
    result,
    writeAdjustmentType,
    onApplyComplete,
    scopePropertyId,
    scopePropertyName,
  ]);

  const cardStyle = {
    background: card,
    border: `1px solid ${border}`,
    borderRadius: 8,
    padding: 14,
    marginBottom: 20,
  };
  const warn = "#b45309";
  const preview = result && result.preview;
  const plan = result && result.plan;
  const collisions = (result && result.collisions) || [];
  const applyBlocked = collisions.length > 0 && !ackCollisions;
  const s = preview && preview.summary;

  return (
    <div style={{ padding: 20, color: text }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>
        Rent Override Workbook Intake
      </h2>
      <p
        style={{ fontSize: 13, color: sub, margin: "0 0 16px", maxWidth: 760 }}
      >
        Upload an .xlsx of per-lease economic rents. Each row is matched to a
        rent-roll bed by its unit/space number (not lease id, so it survives
        Entrata's yearly lease-id rotation). Review the preview, then apply.
        Applied overrides change the live rent roll and are captured into signed
        rolls — treat them with the same care as any client-facing rent figure.
      </p>

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-block",
              padding: "8px 14px",
              borderRadius: 6,
              border: `1px solid ${border}`,
              background: accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: roster ? "pointer" : "not-allowed",
              opacity: roster ? 1 : 0.6,
            }}
          >
            {busy ? "Reading…" : "Choose workbook (.xlsx)"}
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              disabled={!roster || busy}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                e.target.value = "";
                handleFile(f);
              }}
            />
          </label>
          {fileName && (
            <span style={{ fontSize: 12.5, color: sub }}>{fileName}</span>
          )}
          <span style={{ fontSize: 12, color: sub, marginLeft: "auto" }}>
            as of {asOf}
          </span>
        </div>
        {rosterError && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: danger }}>
            Could not load properties: {rosterError}
          </div>
        )}
        {parseError && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: danger }}>
            {parseError}
          </div>
        )}
        {result && result.missing && result.missing.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: danger }}>
            The sheet is missing required column(s): {result.missing.join(", ")}
            . Detected headers: {(result.headers || []).join(", ") || "none"}.
          </div>
        )}
      </div>

      {result && result.columns && !result.missing.length && (
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: sub }}>
            Columns used — property:{" "}
            <b style={{ color: text }}>
              {result.columns.property || result.columns.entrataPropertyId}
            </b>
            {" · "}unit: <b style={{ color: text }}>{result.columns.unit}</b>
            {" · "}rent: <b style={{ color: text }}>{result.columns.rent}</b>
            {result.columns.tenant ? (
              <>
                {" "}
                · tenant: <b style={{ color: text }}>{result.columns.tenant}</b>
              </>
            ) : null}
          </div>
        </div>
      )}

      {s && (
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            <Stat label="Matched" value={s.matched} color={ok} />
            <Stat label="Unmatched" value={s.unmatched} color={sub} />
            <Stat label="Ambiguous" value={s.ambiguous} color="#b45309" />
            <Stat label="Invalid" value={s.invalid} color={danger} />
            {s.outOfScope > 0 && (
              <Stat
                label="Other properties"
                value={s.outOfScope}
                color="#b45309"
              />
            )}
            <Stat label="Rows" value={s.total} color={sub} />
          </div>
          {plan && (
            <div style={{ fontSize: 12.5, color: sub, marginBottom: 12 }}>
              Apply plan: <b style={{ color: text }}>{plan.summary.inserts}</b>{" "}
              new, <b style={{ color: text }}>{plan.summary.updates}</b>{" "}
              changed, {plan.summary.unchanged} unchanged
              {plan.summary.conflicts ? (
                <>
                  ,{" "}
                  <b style={{ color: danger }}>
                    {plan.summary.conflicts} conflict(s)
                  </b>
                </>
              ) : null}
              .
            </div>
          )}
          {collisions.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                border: `1px solid ${warn}`,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: warn,
                  marginBottom: 6,
                }}
              >
                {collisions.length} bed{collisions.length === 1 ? "" : "s"} also
                carry a master-lease group rent
              </div>
              <div style={{ fontSize: 12.5, color: sub, marginBottom: 8 }}>
                Applying makes the per-bed rent take precedence on{" "}
                {collisions.length === 1 ? "this bed" : "these beds"} — the
                group's uniform rent is overwritten on the roll. That's the
                intended per-lease correction, flagged so it's a deliberate
                choice. The group's rent on{" "}
                {collisions.length === 1 ? "this bed" : "these beds"} can be
                retired separately once the real rents are in.
              </div>
              <div
                style={{ maxHeight: 140, overflowY: "auto", marginBottom: 8 }}
              >
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={th}>Unit (bed)</th>
                      <th style={th}>Master-lease group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collisions.map((c, i) => (
                      <tr key={i}>
                        <td style={td}>{c.unitNumber}</td>
                        <td style={{ ...td, color: sub }}>
                          {c.groups.map((g) => g.group_name || g.id).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label
                style={{
                  fontSize: 12.5,
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={ackCollisions}
                  onChange={(e) => setAckCollisions(e.target.checked)}
                />
                I understand the per-bed rent will take precedence on{" "}
                {collisions.length === 1
                  ? "this bed"
                  : `these ${collisions.length} beds`}
                .
              </label>
            </div>
          )}
          {plan && plan.summary.writes > 0 && !confirming && (
            <button
              onClick={() => setConfirming(true)}
              disabled={applying || applyBlocked}
              title={
                applyBlocked
                  ? "Acknowledge the master-lease group warning above to continue."
                  : undefined
              }
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: applyBlocked ? border : accent,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: applyBlocked ? "not-allowed" : "pointer",
              }}
            >
              {applying
                ? "Applying…"
                : `Apply ${plan.summary.writes} override${plan.summary.writes === 1 ? "" : "s"}`}
            </button>
          )}
          {plan && plan.summary.writes === 0 && !applyReport && (
            <div style={{ fontSize: 12.5, color: sub }}>
              Nothing to write — the matched rows already carry these rents (or
              none matched).
            </div>
          )}
          {confirming && (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                border: `1px solid ${danger}`,
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                This writes {plan.summary.inserts} new and{" "}
                {plan.summary.updates} changed override(s) to the live rent
                roll. They will show on the roll immediately and be captured
                into signed rolls.
                {collisions.length > 0
                  ? ` On ${collisions.length} bed${collisions.length === 1 ? "" : "s"} the per-bed rent will take precedence over a master-lease group's rent.`
                  : ""}{" "}
                Continue?
              </div>
              <button
                onClick={runApply}
                style={{
                  padding: "7px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: danger,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  marginRight: 8,
                }}
              >
                Yes, apply
              </button>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: text,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {applyReport && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12.5,
                color:
                  applyReport.failed.length || applyReport.fatal ? danger : ok,
              }}
            >
              Applied: {applyReport.inserted} inserted, {applyReport.updated}{" "}
              updated, {applyReport.unchanged} unchanged.
              {applyReport.failed.length
                ? ` ${applyReport.failed.length} failed (${applyReport.failed.map((f) => `${f.unit}:${f.op}`).join(", ")}).`
                : ""}
              {applyReport.fatal ? ` Error: ${applyReport.fatal}` : ""}
            </div>
          )}
        </div>
      )}

      {plan && plan.conflicts.length > 0 && (
        <Section
          title={`Conflicts (${plan.conflicts.length}) — a bed already has two active overrides`}
          border={border}
          card={card}
          sub={sub}
          danger={danger}
        >
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Unit</th>
                <th style={th}>Sheet rent</th>
                <th style={th}>Existing overrides</th>
              </tr>
            </thead>
            <tbody>
              {plan.conflicts.map((c, i) => (
                <tr key={i}>
                  <td style={td}>{c.unitNumber}</td>
                  <td style={num}>{money(c.row.rent)}</td>
                  <td style={td}>
                    {c.existing
                      .map((e) => money(e.payload && e.payload.rent_override))
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {preview && preview.ambiguous.length > 0 && (
        <Section
          title={`Ambiguous (${preview.ambiguous.length}) — resolve on the sheet, not here`}
          border={border}
          card={card}
          sub={sub}
          danger="#b45309"
        >
          <PreviewTable
            rows={preview.ambiguous}
            td={td}
            num={num}
            th={th}
            money={money}
            candidatesLabel
          />
        </Section>
      )}

      {preview && preview.unmatched.length > 0 && (
        <Section
          title={`Unmatched (${preview.unmatched.length})`}
          border={border}
          card={card}
          sub={sub}
          danger={sub}
        >
          <PreviewTable
            rows={preview.unmatched}
            td={td}
            num={num}
            th={th}
            money={money}
          />
        </Section>
      )}

      {preview && (preview.outOfScope || []).length > 0 && (
        <Section
          title={`Other properties (${preview.outOfScope.length}) — ignored for this property`}
          border={border}
          card={card}
          sub={sub}
          danger="#b45309"
        >
          <div
            style={{
              fontSize: 12.5,
              color: sub,
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            These rows belong to other known properties and were not included in
            this apply plan. Upload them from those properties&apos; Adjustments
            tabs.
          </div>
          <PreviewTable
            rows={preview.outOfScope}
            td={td}
            num={num}
            th={th}
            money={money}
          />
        </Section>
      )}

      {preview && preview.invalid.length > 0 && (
        <Section
          title={`Invalid values (${preview.invalid.length})`}
          border={border}
          card={card}
          sub={sub}
          danger={danger}
        >
          <PreviewTable
            rows={preview.invalid}
            td={td}
            num={num}
            th={th}
            money={money}
          />
        </Section>
      )}

      {preview && preview.matched.length > 0 && (
        <Section
          title={`Matched (${preview.matched.length})`}
          border={border}
          card={card}
          sub={sub}
          danger={ok}
        >
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Unit (bed)</th>
                <th style={th}>Tenant</th>
                <th style={th}>Rent</th>
                <th style={th}>Match</th>
              </tr>
            </thead>
            <tbody>
              {preview.matched.map((m, i) => (
                <tr key={i}>
                  <td style={td}>{m.unitNumber}</td>
                  <td style={td}>{m.row.tenant || "—"}</td>
                  <td style={num}>{money(m.row.rent)}</td>
                  <td style={{ ...td, color: sub }}>{m.matchKind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {!result && !busy && !rosterError && (
        <div style={{ fontSize: 12.5, color: sub }}>
          {roster ? "No workbook loaded yet." : "Loading properties…"}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column" }}>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 }}
      >
        {label}
      </span>
    </span>
  );
}

function Section({ title, children, border, card, sub, danger }) {
  return (
    <div
      style={{
        background: card,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: 14,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: danger,
          margin: "0 0 8px",
        }}
      >
        {title}
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

function PreviewTable({ rows, td, num, th, money, candidatesLabel }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          <th style={th}>Property</th>
          <th style={th}>Unit</th>
          <th style={th}>Rent</th>
          <th style={th}>Reason</th>
          {candidatesLabel ? <th style={th}>Candidates</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={td}>
              {r.propertyName ||
                (r.row && (r.row.propertyName || r.row.property))}
            </td>
            <td style={td}>{r.row && r.row.unit}</td>
            <td style={num}>{r.row ? money(r.row.rent) : "—"}</td>
            <td style={{ ...td, color: "#b45309" }}>
              {r.reason || r.stage || "—"}
            </td>
            {candidatesLabel ? (
              <td style={td}>
                {Array.isArray(r.candidates)
                  ? r.candidates.map((c) => c.unit_number).join(", ")
                  : "—"}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
