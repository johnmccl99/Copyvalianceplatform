import React from "react";
import { T, alpha } from "../../lib/theme.js";

const shimmer = (C) => ({
  background: `linear-gradient(90deg, ${C.subtleBg || T.inset} 25%, ${alpha(C.border || T.border, 33.3)} 50%, ${C.subtleBg || T.inset} 75%)`,
  backgroundSize: "200% 100%",
  animation: "shimmer 1.5s ease-in-out infinite",
  borderRadius: 6,
});

export function SkeletonBar({ C, width = "100%", height = 14, style = {} }) {
  return (
    <div
      aria-hidden="true"
      style={{ ...shimmer(C), width, height, ...style }}
    />
  );
}

export function SkeletonKpiStrip({ C, count = 4 }) {
  return (
    <div
      role="status"
      aria-label="Loading metrics"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(160px, 1fr))`,
        gap: 12,
        marginBottom: 20,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: 16,
            borderRadius: 10,
            background: C.cardBg,
            border: `1px solid ${C.border}`,
          }}
        >
          <SkeletonBar
            C={C}
            width="60%"
            height={10}
            style={{ marginBottom: 12 }}
          />
          <SkeletonBar C={C} width="80%" height={20} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ C, rows = 6, cols = 5 }) {
  const cell = (i) => (i === 0 ? "28%" : "15%");
  return (
    <div
      role="status"
      aria-label="Loading table"
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "12px 16px",
          background: C.subtleBg,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBar key={i} C={C} width={cell(i)} height={10} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: "flex",
            gap: 16,
            padding: "14px 16px",
            borderBottom: r < rows - 1 ? `1px solid ${C.border}` : "none",
          }}
        >
          {Array.from({ length: cols }).map((_, i) => (
            <SkeletonBar key={i} C={C} width={cell(i)} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonContent({ C, kpis = 4, rows = 6, cols = 5 }) {
  return (
    <div>
      {kpis > 0 && <SkeletonKpiStrip C={C} count={kpis} />}
      <SkeletonTable C={C} rows={rows} cols={cols} />
    </div>
  );
}

export default SkeletonContent;
