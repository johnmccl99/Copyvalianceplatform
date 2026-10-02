import React from "react";
import { getSurfaceStatus } from "../../lib/userGuide/surfaceStatus.js";

const TREATMENTS = {
  Preview: {
    label: "Preview - sample data",
    bg: "var(--ds-warning-bg)",
    text: "var(--ds-warning-text)",
    border: "var(--ds-warning-dot)",
    aria: "Preview surface. The data shown here is sample data, not live records.",
  },
  Planned: {
    label: "Planned",
    bg: "var(--ds-neutral-bg)",
    text: "var(--ds-neutral-text)",
    border: "var(--ds-neutral-dot)",
    aria: "Planned surface. This feature is not built yet.",
  },
};

export default function SurfaceStatusBadge({ surfaceKey, style }) {
  const status = getSurfaceStatus(surfaceKey);
  const treatment = TREATMENTS[status];
  if (!treatment) return null;

  return (
    <span
      role="status"
      aria-label={treatment.aria}
      title={treatment.aria}
      style={{
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: 0.1,
        background: treatment.bg,
        color: treatment.text,
        border: `1px solid ${treatment.border}`,
        ...style,
      }}
    >
      {treatment.label}
    </span>
  );
}
