import React from "react";

const POS = {
  top: {
    bottom: "calc(100% + 8px)",
    left: "50%",
    transform: "translateX(-50%)",
  },
  bottom: {
    top: "calc(100% + 8px)",
    left: "50%",
    transform: "translateX(-50%)",
  },
  left: {
    right: "calc(100% + 8px)",
    top: "50%",
    transform: "translateY(-50%)",
  },
  right: {
    left: "calc(100% + 8px)",
    top: "50%",
    transform: "translateY(-50%)",
  },
};

function formatAsOf(asOf) {
  if (asOf == null || asOf === "") return null;
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

let _kpiSourceSeq = 0;

export default function KpiSource({
  formula,
  result,
  inputs,
  source = "Entrata",
  asOf,
  label,
  position = "top",
}) {
  const [open, setOpen] = React.useState(false);
  const idRef = React.useRef(null);
  if (idRef.current == null) idRef.current = `kpi-source-${++_kpiSourceSeq}`;

  if (formula == null || String(formula).trim() === "") return null;

  const asOfText = formatAsOf(asOf);
  const headline = result ? `${result} = ${formula}` : formula;
  const items = Array.isArray(inputs)
    ? inputs.filter((i) => i && i.label != null)
    : [];
  const srLabel = `Show how ${label ? `${label} ` : ""}is calculated`;

  const hide = () => setOpen(false);
  const show = () => setOpen(true);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        verticalAlign: "middle",
      }}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        aria-label={srLabel}
        aria-expanded={open}
        aria-describedby={open ? idRef.current : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          padding: 0,
          marginLeft: 5,
          background: "transparent",
          border: "none",
          borderRadius: "50%",
          cursor: "pointer",
          color: "var(--ds-text-secondary)",
          lineHeight: 0,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="8"
            cy="8"
            r="6.75"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <circle cx="8" cy="5.1" r="0.95" fill="currentColor" />
          <rect
            x="7.25"
            y="6.9"
            width="1.5"
            height="4.6"
            rx="0.75"
            fill="currentColor"
          />
        </svg>
      </button>

      {open && (
        <span
          id={idRef.current}
          role="tooltip"
          style={{
            position: "absolute",
            ...(POS[position] || POS.top),
            zIndex: 9999,
            width: 230,
            maxWidth: "min(230px, 80vw)",
            background: "var(--ds-text-primary)",
            color: "var(--ds-bg)",
            padding: "9px 11px",
            borderRadius: 7,
            fontSize: 11.5,
            lineHeight: 1.45,
            fontWeight: 500,
            textAlign: "left",
            whiteSpace: "normal",
            boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
            pointerEvents: "none",
            animation: "fadeIn 0.15s ease",
          }}
        >
          <span
            style={{ display: "block", fontVariantNumeric: "tabular-nums" }}
          >
            {headline}
          </span>
          {items.length > 0 && (
            <span style={{ display: "block", marginTop: 6, opacity: 0.85 }}>
              {items.map((it, i) => (
                <span
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span>{it.label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {it.value}
                  </span>
                </span>
              ))}
            </span>
          )}
          <span
            style={{
              display: "block",
              marginTop: 7,
              fontSize: 10.5,
              fontWeight: 400,
              opacity: 0.7,
            }}
          >
            {source}
            {asOfText ? ` · as of ${asOfText}` : ""}
          </span>
        </span>
      )}
    </span>
  );
}
