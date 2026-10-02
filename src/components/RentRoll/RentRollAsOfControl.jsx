import React from "react";
import { T } from "../../lib/theme.js";
import { PORTFOLIO_TIME_ZONE } from "../../lib/entrataLeaseStatus.js";
import {
  asOfPresets,
  asOfBounds,
  asOfPlausibilityMessage,
  defaultAsOf,
  isDefaultAsOf,
} from "../../lib/rentRollAsOfView.js";

export default function RentRollAsOfControl({
  C = {},
  value,
  onChange,
  timeZone = PORTFOLIO_TIME_ZONE,
  disabled = false,
}) {
  const border = C.border || T.border;
  const card = C.card || T.card;
  const textPrimary = C.textPrimary || T.textPrimary;
  const textSecondary = C.textSecondary || T.textSecondary;

  const presets = asOfPresets(timeZone);
  const bounds = asOfBounds(timeZone);
  const offDefault = value && !isDefaultAsOf(value, timeZone);
  const [rejected, setRejected] = React.useState(null);
  const pick = (d) => {
    setRejected(null);
    onChange(d);
  };
  const rejectedMessage = rejected
    ? asOfPlausibilityMessage(rejected, timeZone)
    : null;

  const control = {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: card,
    color: textPrimary,
    cursor: disabled ? "not-allowed" : "pointer",
  };

  const chip = (active) => ({
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 10px",
    borderRadius: 6,
    border: `1px solid ${active ? textPrimary : border}`,
    background: "transparent",
    color: active ? textPrimary : textSecondary,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  const handleInput = (e) => {
    const next = e.target.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    if (asOfPlausibilityMessage(next, timeZone)) {
      setRejected(next);
      return;
    }
    pick(next);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <label
        htmlFor="rent-roll-as-of"
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: textSecondary,
        }}
      >
        As of
      </label>

      <input
        id="rent-roll-as-of"
        type="date"
        value={rejected || value || ""}
        aria-invalid={!!rejectedMessage}
        aria-describedby={rejectedMessage ? "rent-roll-as-of-error" : undefined}
        min={bounds.min}
        max={bounds.max}
        disabled={disabled}
        onChange={handleInput}
        style={control}
      />

      {presets.map((p) => (
        <button
          key={p.key}
          type="button"
          disabled={disabled}
          onClick={() => pick(p.date)}
          aria-pressed={value === p.date}
          title={p.date}
          style={chip(value === p.date)}
        >
          {p.label}
        </button>
      ))}

      {offDefault ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick(defaultAsOf(timeZone))}
          style={{ ...chip(false), borderStyle: "dashed" }}
        >
          Back to the default
        </button>
      ) : null}

      {rejectedMessage ? (
        <span
          id="rent-roll-as-of-error"
          role="alert"
          style={{
            fontSize: 11,
            color: C.danger || T.danger || "#b42318",
            flexBasis: "100%",
          }}
        >
          {rejectedMessage}
        </span>
      ) : null}
    </div>
  );
}
