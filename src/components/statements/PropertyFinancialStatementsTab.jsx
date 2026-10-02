import { useEffect, useState } from "react";
import { T } from "../../lib/theme.js";
import { fetchStatementProperties } from "../../lib/financialStatements.js";
import FinancialStatementsInner from "./FinancialStatementsInner.jsx";

export default function PropertyFinancialStatementsTab({
  C = {},
  propertyCode = null,
  propertyCodeLoading = false,
  propertyCodeError = null,
  initialAsOfYm = "",
  initialFromYm = "",
  initialToYm = "",
  onSeedConsumed,
} = {}) {
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;

  const [eligible, setEligible] = useState({
    loading: true,
    error: null,
    ok: false,
  });

  useEffect(() => {
    if (!propertyCode) {
      setEligible({ loading: false, error: null, ok: false });
      return undefined;
    }
    let alive = true;
    setEligible({ loading: true, error: null, ok: false });
    fetchStatementProperties().then((r) => {
      if (!alive) return;
      const list = Array.isArray(r.data) ? r.data : [];
      setEligible({
        loading: false,
        error: r.error || null,
        ok: list.some((p) => p.property_code === propertyCode),
      });
    });
    return () => {
      alive = false;
    };
  }, [propertyCode]);

  const pad = { padding: "18px 22px" };
  const note = (children) => (
    <div style={pad}>
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
        {children}
      </div>
    </div>
  );
  const danger = (children) => (
    <div style={pad}>
      <div
        style={{
          fontSize: 13,
          padding: 16,
          maxWidth: 640,
          borderRadius: 6,
          background: "var(--ds-danger-bg)",
          border:
            "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
          color: "var(--ds-danger-text)",
        }}
      >
        {children}
      </div>
    </div>
  );

  if (propertyCodeLoading) {
    return (
      <div role="status" style={{ ...pad, fontSize: 12, color: sub }}>
        Loading this property&rsquo;s statement mapping&hellip;
      </div>
    );
  }

  if (propertyCodeError) {
    return danger(
      <>
        Could not resolve this property&rsquo;s statement mapping:{" "}
        {propertyCodeError}
      </>,
    );
  }

  if (!propertyCode) {
    return note(
      <>
        No GL code is registered for this property, so its statements cannot be
        assembled. An admin can register the mapping by uploading this
        property&rsquo;s budget workbook from Admin Console &rarr; Platform
        &rarr; Budget Workbook Intake.
      </>,
    );
  }

  if (eligible.loading) {
    return (
      <div role="status" style={{ ...pad, fontSize: 12, color: sub }}>
        Checking this property&rsquo;s Entrata connection&hellip;
      </div>
    );
  }

  if (eligible.error) {
    return danger(
      <>
        Could not check this property&rsquo;s Entrata connection:{" "}
        {eligible.error?.message || "unknown error"}
      </>,
    );
  }

  if (!eligible.ok) {
    return note(
      <>
        This property is not connected to Entrata, and these statements are
        rendered from the synced Entrata GL. Properties whose ledger lives
        outside Entrata report through the budget and variance surfaces instead.
        An admin can review the connection under Admin Console &rarr;
        Integrations.
      </>,
    );
  }

  return (
    <FinancialStatementsInner
      C={C}
      propertyCode={propertyCode}
      initialAsOfYm={initialAsOfYm}
      initialFromYm={initialFromYm}
      initialToYm={initialToYm}
      onSeedConsumed={onSeedConsumed}
    />
  );
}
