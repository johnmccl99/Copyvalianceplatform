import React from "react";
import contentDoc from "../../lib/userGuide/surfaceContent.json";
import { getSurfaceStatus } from "../../lib/userGuide/surfaceStatus.js";
import PropertyDestinationPicker from "./PropertyDestinationPicker.jsx";

const FALLBACK_C = {
  bg: "var(--ds-bg)",
  cardBg: "var(--ds-surface)",
  border: "var(--ds-border)",
  textPrimary: "var(--ds-text-primary)",
  textSecondary: "var(--ds-text-secondary)",
  badgeGreenBg: "var(--ds-success-bg)",
  badgeGreenText: "var(--ds-success-text)",
  badgeBlueBg: "var(--ds-info-bg)",
  badgeBlueTxt: "var(--ds-info-text)",
  badgeGrayBg: "var(--ds-neutral-bg)",
  badgeGrayText: "var(--ds-neutral-text)",
};

function statusBadgeStyle(status, C) {
  switch (status) {
    case "Live":
      return { bg: C.badgeGreenBg, text: C.badgeGreenText, label: "Live" };
    case "Preview":
      return { bg: C.badgeBlueBg, text: C.badgeBlueTxt, label: "Preview" };
    default:
      return {
        bg: C.badgeGrayBg,
        text: C.badgeGrayText,
        label: status || "Planned",
      };
  }
}

function SurfaceCard({ item, onNavigate, C }) {
  const content = (contentDoc.content || {})[item.key] || {};
  const status = getSurfaceStatus(item.key);
  const badge = status ? statusBadgeStyle(status, C) : null;
  return (
    <button
      onClick={() => onNavigate && onNavigate(item.key)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
        padding: "14px 16px",
        textAlign: "left",
        cursor: "pointer",
        background: C.cardBg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        transition: "border-color 0.15s",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
          {item.label}
        </span>
        {badge ? (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 999,
              background: badge.bg,
              color: badge.text,
              whiteSpace: "nowrap",
            }}
          >
            {badge.label}
          </span>
        ) : null}
      </div>
      {content.whatItIs ? (
        <p
          style={{
            fontSize: 12,
            color: C.textSecondary,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {content.whatItIs}
        </p>
      ) : null}
    </button>
  );
}

function CardGrid({ items, onNavigate, C }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      }}
    >
      {items.map((item) => (
        <SurfaceCard key={item.key} item={item} onNavigate={onNavigate} C={C} />
      ))}
    </div>
  );
}

export default function SectionLandingPage({
  section,
  onNavigate,
  C: CProp,
  propertyItems = [],
  onOpenPropertySurface,
  initialDestinationKey = null,
}) {
  const C = CProp || FALLBACK_C;
  if (!section) return null;

  const subGroups = Array.isArray(section.subGroups) ? section.subGroups : null;
  const items =
    !subGroups && Array.isArray(section.items) ? section.items : null;
  const destinations = Array.isArray(section.propertyDestinations)
    ? section.propertyDestinations
    : [];
  const hasItems = subGroups
    ? subGroups.some((g) => Array.isArray(g.items) && g.items.length > 0)
    : Boolean(items && items.length > 0);
  const isEmpty = !hasItems && destinations.length === 0;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1040 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 700,
          color: C.textPrimary,
        }}
      >
        {section.label}
      </h2>
      <p
        style={{
          margin: "6px 0 20px",
          fontSize: 12,
          color: C.textSecondary,
          maxWidth: 720,
          lineHeight: 1.5,
        }}
      >
        {section.blurb ||
          "Everything in this section, with what each surface is for. Select one to open it."}
      </p>
      {isEmpty ? (
        <p style={{ fontSize: 13, color: C.textSecondary, margin: 0 }}>
          Nothing in this section is available for your role right now. If you
          expected a surface here, an administrator can review access under
          Users &amp; Access.
        </p>
      ) : subGroups ? (
        subGroups
          .filter((g) => Array.isArray(g.items) && g.items.length > 0)
          .map((g) => (
            <div key={g.label} style={{ marginBottom: 22 }}>
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
                {g.label}
              </div>
              <CardGrid items={g.items} onNavigate={onNavigate} C={C} />
            </div>
          ))
      ) : hasItems ? (
        <CardGrid items={items} onNavigate={onNavigate} C={C} />
      ) : null}

      {destinations.length > 0 ? (
        <div style={{ marginTop: hasItems ? 26 : 0 }}>
          <PropertyDestinationPicker
            destinations={destinations}
            propertyItems={propertyItems}
            onOpen={onOpenPropertySurface}
            C={C}
            initialDestinationKey={initialDestinationKey}
          />
        </div>
      ) : null}
    </div>
  );
}
