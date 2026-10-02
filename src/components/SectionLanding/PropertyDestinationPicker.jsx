import React, { useEffect, useMemo, useState } from "react";

const FILTER_THRESHOLD = 8;

const FALLBACK_C = {
  cardBg: "var(--ds-surface)",
  border: "var(--ds-border)",
  textPrimary: "var(--ds-text-primary)",
  textSecondary: "var(--ds-text-secondary)",
};

function DestinationPills({ destinations, activeKey, onSelect, C }) {
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}
      role="tablist"
    >
      {destinations.map((d) => {
        const isActive = d.key === activeKey;
        return (
          <button
            key={d.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(d.key)}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              background: isActive ? C.textPrimary : C.cardBg,
              color: isActive ? C.cardBg : C.textSecondary,
              border: `1px solid ${isActive ? C.textPrimary : C.border}`,
            }}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PropertyDestinationPicker({
  destinations = [],
  propertyItems = [],
  onOpen,
  C: CProp,
  initialDestinationKey = null,
}) {
  const C = CProp || FALLBACK_C;
  const [activeKey, setActiveKey] = useState(
    initialDestinationKey || (destinations[0] ? destinations[0].key : null),
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (initialDestinationKey) setActiveKey(initialDestinationKey);
  }, [initialDestinationKey]);

  const showFilter = propertyItems.length > FILTER_THRESHOLD;
  const visibleProperties = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return propertyItems;
    return propertyItems.filter((p) =>
      (p.label || "").toLowerCase().includes(q),
    );
  }, [propertyItems, query]);

  if (destinations.length === 0) return null;

  const active =
    destinations.find((d) => d.key === activeKey) || destinations[0];

  const onFilterKeyDown = (e) => {
    if (e.key !== "Enter" || visibleProperties.length !== 1) return;
    e.preventDefault();
    if (onOpen) onOpen(visibleProperties[0].key, active);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: C.textSecondary,
          textTransform: "uppercase",
          letterSpacing: 1,
          margin: "0 0 8px",
        }}
      >
        Open a property
      </div>

      {destinations.length > 1 ? (
        <DestinationPills
          destinations={destinations}
          activeKey={active.key}
          onSelect={setActiveKey}
          C={C}
        />
      ) : null}

      {active.blurb ? (
        <p
          style={{
            fontSize: 12,
            color: C.textSecondary,
            margin: "0 0 12px",
            lineHeight: 1.5,
            maxWidth: 640,
          }}
        >
          {active.blurb}
        </p>
      ) : null}

      {showFilter ? (
        <div style={{ marginBottom: 10 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFilterKeyDown}
            placeholder={`Filter ${propertyItems.length} properties`}
            aria-label={`Filter properties, then open one at its ${active.label}`}
            style={{
              width: "100%",
              maxWidth: 340,
              padding: "7px 11px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.cardBg,
              color: C.textPrimary,
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>
      ) : null}

      {propertyItems.length === 0 ? (
        <p style={{ fontSize: 13, color: C.textSecondary, margin: 0 }}>
          No properties are available to you yet. An administrator can review
          property access under Users &amp; Access.
        </p>
      ) : visibleProperties.length === 0 ? (
        <p style={{ fontSize: 13, color: C.textSecondary, margin: 0 }}>
          No property matches &ldquo;{query.trim()}&rdquo;. Clear the filter to
          see all {propertyItems.length}.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          }}
        >
          {visibleProperties.map((p) => (
            <button
              key={p.key}
              onClick={() => onOpen && onOpen(p.key, active)}
              title={`Open ${p.label} — ${active.label}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
                padding: "10px 12px",
                textAlign: "left",
                cursor: "pointer",
                background: C.cardBg,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
              }}
            >
              <span
                style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}
              >
                {p.label}
              </span>
              <span style={{ fontSize: 11, color: C.textSecondary }}>
                {active.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
