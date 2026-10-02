import React, { useEffect, useState } from "react";
import SectionLandingPage from "../SectionLanding/SectionLandingPage.jsx";
import PropertySwitcher from "../property/PropertySwitcher.jsx";

const FALLBACK_C = {
  cardBg: "var(--ds-surface)",
  border: "var(--ds-border)",
  textPrimary: "var(--ds-text-primary)",
  textSecondary: "var(--ds-text-secondary)",
};

function ViewPills({ views, activeKey, onSelect, C }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "12px 28px 16px",
      }}
      role="tablist"
      aria-label="Workspace views"
    >
      {views.map((v) => {
        const isActive = v.key === activeKey;
        return (
          <button
            key={v.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect && onSelect(v.key)}
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
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

export function CopyLinkButton({ path, C }) {
  const [state, setState] = useState("idle");
  useEffect(() => {
    if (state === "idle") return undefined;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);
  if (!path) return null;

  const copy = async () => {
    const url =
      (typeof window !== "undefined" && window.location
        ? window.location.origin
        : "") + path;
    try {
      if (!navigator?.clipboard?.writeText)
        throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  const label =
    state === "copied"
      ? "Link copied"
      : state === "failed"
        ? "Copy failed"
        : "Copy link";
  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      title={path}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        marginLeft: "auto",
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${C.border}`,
        background: "transparent",
        color: C.textSecondary,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

export default function ModuleWorkspacePage({
  section,
  C: CProp,
  propertyItems = [],
  views = [],
  property = null,
  selectedPropertyKey = null,
  activeViewKey = null,
  onSelectProperty,
  onSelectView,
  onBackToLanding,
  initialDestinationKey = null,
  copyLinkPath = null,
}) {
  const C = CProp || FALLBACK_C;
  if (!section) return null;

  if (!selectedPropertyKey) {
    return (
      <SectionLandingPage
        section={section}
        C={C}
        propertyItems={propertyItems}
        onOpenPropertySurface={onSelectProperty}
        initialDestinationKey={initialDestinationKey}
      />
    );
  }

  const backButton = (
    <button
      onClick={() => onBackToLanding && onBackToLanding()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${C.border}`,
        background: "transparent",
        color: C.textSecondary,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">‹</span> All properties
    </button>
  );

  if (!property) {
    return (
      <div style={{ padding: "24px 28px", maxWidth: 1040 }}>
        <div style={{ marginBottom: 14 }}>{backButton}</div>
        <p style={{ fontSize: 13, color: C.textSecondary, margin: 0 }}>
          This property is not available to you right now. Pick another from the
          list, or contact an administrator if you expected access.
        </p>
      </div>
    );
  }

  const activeView =
    views.find((v) => v.key === activeViewKey) || views[0] || null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "18px 28px 0",
        }}
      >
        {backButton}
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: C.textPrimary,
          }}
        >
          {property.name}
        </h2>
        <PropertySwitcher
          items={propertyItems}
          activeKey={selectedPropertyKey}
          onSelect={(key) => onSelectProperty && onSelectProperty(key, null)}
          C={C}
          variant="header"
        />
        <CopyLinkButton path={copyLinkPath} C={C} />
      </div>

      {views.length > 1 ? (
        <ViewPills
          views={views}
          activeKey={activeView ? activeView.key : null}
          onSelect={onSelectView}
          C={C}
        />
      ) : null}

      {activeView ? (
        activeView.render(property)
      ) : (
        <p
          style={{
            padding: "18px 28px",
            fontSize: 13,
            color: C.textSecondary,
            margin: 0,
          }}
        >
          Nothing in this workspace is available for your role right now. An
          administrator can review access under Users &amp; Access.
        </p>
      )}
    </div>
  );
}
