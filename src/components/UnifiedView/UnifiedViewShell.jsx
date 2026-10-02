import React, { useState } from "react";
import { UNIFIED_VIEW_TENANTS } from "./unifiedViewTenants.js";
import { T } from "../../lib/theme.js";

export default function UnifiedViewShell({
  scopeItems = [],
  selectedProperties = [],
  scopeVersion = 0,
  pickerSlot = null,
  C = {},
  userProfile = null,
  onOpenProperty,
  onRemoveProperty,
} = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const accent = C.accent || T.accent;

  const role = (userProfile?.role || "").toLowerCase();
  const isAdmin = userProfile?.is_admin === true;
  const visibleTenants = UNIFIED_VIEW_TENANTS.filter(
    (t) =>
      Array.isArray(t.roles) &&
      (t.roles.includes(role) || (isAdmin && t.roles.includes("admin"))),
  );

  const [activeKey, setActiveKey] = useState(null);
  const activeTenant =
    visibleTenants.find((t) => t.key === activeKey) ||
    visibleTenants[0] ||
    null;

  const allSelected =
    scopeItems.length > 0 && selectedProperties.length === scopeItems.length;

  const chipStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 600,
    color: text,
    background: subtle,
    border: `1px solid ${border}`,
    borderRadius: 999,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ padding: 20, color: text }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            Portfolio Command — Selected Set
          </h1>
          <p style={{ fontSize: 13, color: sub, margin: "4px 0 0" }}>
            Every selected property in one place. Choose a set, then work the
            views below across all of it.
          </p>
        </div>
        {pickerSlot}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "10px 12px",
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        {selectedProperties.length === 0 && (
          <span style={{ fontSize: 13, color: sub }}>
            Select properties to begin. The views below aggregate whatever set
            you choose.
          </span>
        )}
        {selectedProperties.length > 0 && allSelected && (
          <span style={chipStyle}>All {scopeItems.length} properties</span>
        )}
        {selectedProperties.length > 0 &&
          !allSelected &&
          selectedProperties.map((p) => (
            <span key={p.code} style={chipStyle}>
              {p.name}
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                onClick={() => onRemoveProperty && onRemoveProperty(p.code)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: sub,
                  cursor: "pointer",
                  fontSize: 13,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
      </div>

      {visibleTenants.length === 0 && (
        <div
          style={{
            padding: 20,
            border: `1px dashed ${border}`,
            borderRadius: 8,
            color: sub,
            fontSize: 13,
            maxWidth: 560,
          }}
        >
          No unified views are available for your role. The multi-property views
          here are scoped to the firm's GP and admin roles; single-property data
          remains available from each property's own page.
        </div>
      )}

      {visibleTenants.length > 0 && (
        <>
          <div
            role="tablist"
            style={{
              display: "flex",
              gap: 4,
              borderBottom: `1px solid ${border}`,
              marginBottom: 16,
            }}
          >
            {visibleTenants.map((t) => {
              const isActive = activeTenant && t.key === activeTenant.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={!!isActive}
                  onClick={() => setActiveKey(t.key)}
                  style={{
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? text : sub,
                    background: "transparent",
                    border: "none",
                    borderBottom: isActive
                      ? `2px solid ${accent}`
                      : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {activeTenant &&
            activeTenant.render({
              selectedProperties,
              scopeVersion,
              C,
              userProfile,
              onOpenProperty,
            })}
        </>
      )}
    </div>
  );
}
