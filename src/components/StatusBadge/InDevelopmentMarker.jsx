import React from "react";
import { T, alpha } from "../../lib/theme.js";
import { useMediaQuery } from "../../lib/useMediaQuery.js";

const ARIA = "In active development";

export default function InDevelopmentMarker({ label = "Beta", style }) {
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)");

  return (
    <span
      role="img"
      aria-label={ARIA}
      title={ARIA}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: 0.1,
        background: T.accentMuted,
        color: T.accent,
        border: `1px solid ${alpha(T.accent, 30)}`,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: T.accent,
          flexShrink: 0,
          animation: reduce ? "none" : "pulse 2s ease-in-out infinite",
        }}
      />
      {label}
    </span>
  );
}
