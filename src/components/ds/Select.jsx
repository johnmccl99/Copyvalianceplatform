import React from "react";
import { T } from "../../lib/theme.js";
import { fieldStyle, fieldLabelStyle } from "./fieldStyles.js";

function normalizeOption(o) {
  if (o !== null && typeof o === "object") {
    return {
      value: o.value,
      label: o.label ?? String(o.value),
      disabled: !!o.disabled,
    };
  }
  return { value: o, label: String(o), disabled: false };
}

export default function Select({
  value,
  onChange,
  options,
  children,
  placeholder,
  disabled = false,
  size = "md",
  label,
  fullWidth = false,
  id,
  style,
  ...rest
}) {
  const autoId = React.useId();
  const selectId = id || autoId;
  const normalized = Array.isArray(options) ? options.map(normalizeOption) : [];

  const selectStyle = {
    ...fieldStyle({ size, disabled, fullWidth }),
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    paddingRight: 30,
    ...style,
  };

  return (
    <div
      style={{
        display: fullWidth ? "block" : "inline-block",
        width: fullWidth ? "100%" : undefined,
      }}
    >
      {label ? (
        <label htmlFor={selectId} style={fieldLabelStyle()}>
          {label}
        </label>
      ) : null}
      <div
        style={{
          position: "relative",
          display: fullWidth ? "block" : "inline-block",
          width: fullWidth ? "100%" : undefined,
        }}
      >
        <select
          id={selectId}
          value={value}
          onChange={onChange}
          disabled={disabled}
          style={selectStyle}
          {...rest}
        >
          {placeholder != null ? <option value="">{placeholder}</option> : null}
          {normalized.map((o, i) => (
            <option
              key={`${String(o.value)}-${i}`}
              value={o.value}
              disabled={o.disabled}
            >
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <Chevron disabled={disabled} />
      </div>
    </div>
  );
}

function Chevron({ disabled }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: 10,
        top: "50%",
        transform: "translateY(-50%)",
        pointerEvents: "none",
        display: "inline-flex",
        color: T.textSecondary,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 3.5L5 6.5L8 3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
