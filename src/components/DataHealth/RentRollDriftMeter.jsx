import React, { useEffect, useState } from "react";
import { T } from "../../lib/theme.js";
import {
  fetchRentRollDrift,
  classifyDriftProminence,
  describeDrift,
} from "../../lib/dataHealthChecks.js";

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

export default function RentRollDriftMeter({ propertyId, C = {} } = {}) {
  const sub = C.textSecondary || T.textSecondary;
  const amber = C.amber || C.warning || T.warningText;

  const [state, setState] = useState({
    loading: true,
    error: null,
    drift: null,
  });

  useEffect(() => {
    if (!propertyId) return;
    let alive = true;
    setState({ loading: true, error: null, drift: null });
    fetchRentRollDrift(propertyId)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setState({ loading: false, error, drift: null });
        else
          setState({
            loading: false,
            error: null,
            drift: (data || [])[0] || null,
          });
      })
      .catch((error) => {
        if (alive) setState({ loading: false, error, drift: null });
      });
    return () => {
      alive = false;
    };
  }, [propertyId]);

  if (!propertyId || state.loading) return null;

  if (state.error) {
    return (
      <span style={{ fontSize: 12, color: sub }}>
        Drift check unavailable — nothing is asserted about how current the
        signed roll is.
      </span>
    );
  }

  const d = state.drift;
  if (!d) return null;

  const sentence = describeDrift(d);
  const notable = classifyDriftProminence(d) === "notable";
  return (
    <span
      title={`Signed version as of ${fmtDate(d.version_as_of)} vs live Entrata roll (as of ${fmtDate(d.live_as_of)}): ${d.leases_changed} changed / ${d.leases_added} added / ${d.leases_removed} removed lease(s), ${d.adjustments_changed} adjustment(s) touched. Post-signature churn is legitimate — this measures staleness, not wrongness.`}
      style={{
        fontSize: 12,
        color: notable ? amber : sub,
        fontWeight: notable ? 600 : 400,
      }}
    >
      Signed {fmtDate(d.version_as_of)} · {sentence} · live as of{" "}
      {fmtDate(d.live_as_of)}
    </span>
  );
}
