import React from "react";
import { MODULE_LABELS } from "../../lib/navSections.js";
import surfaceContent from "../../lib/userGuide/surfaceContent.json";

const FALLBACK_C = {
  cardBg: "var(--ds-surface)",
  border: "var(--ds-border)",
  textPrimary: "var(--ds-text-primary)",
  textSecondary: "var(--ds-text-secondary)",
  subtleBg: "var(--ds-inset)",
};

function moduleContents(section) {
  const items = Array.isArray(section.items) ? section.items : [];
  const destinations = Array.isArray(section.propertyDestinations)
    ? section.propertyDestinations
    : [];
  const manifest = surfaceContent.content || {};
  return [...items, ...destinations]
    .filter((entry) => entry && entry.label)
    .map((entry) => ({
      label: entry.label,
      blurb:
        entry.blurb ||
        (entry.key ? manifest[entry.key]?.whatItIs : null) ||
        null,
    }));
}

function ModuleCard({ section, onOpenSection, C }) {
  const contents = moduleContents(section);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 8,
        padding: "18px 20px",
        background: C.cardBg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    >
      <button
        type="button"
        onClick={() => onOpenSection && onOpenSection(section.label)}
        title={`Open the ${section.label} overview`}
        style={{
          padding: 0,
          background: "transparent",
          border: "none",
          textAlign: "left",
          alignSelf: "flex-start",
          cursor: "pointer",
          font: "inherit",
          fontSize: 15,
          fontWeight: 700,
          color: C.textPrimary,
        }}
      >
        {section.label}
      </button>

      {section.blurb ? (
        <p
          style={{
            fontSize: 12.5,
            color: C.textSecondary,
            margin: 0,
            lineHeight: 1.55,
            maxWidth: "74ch",
          }}
        >
          {section.blurb}
        </p>
      ) : null}

      {contents.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: "4px 0 0",
            padding: "12px 0 0",
            borderTop: `1px solid ${C.border}`,
            display: "grid",
            gap: "10px 24px",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            alignItems: "start",
          }}
        >
          {contents.map((entry, i) => (
            <li key={`${entry.label}-${i}`} style={{ minWidth: 0 }}>
              <div
                style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}
              >
                {entry.label}
              </div>
              {entry.blurb ? (
                <div
                  style={{
                    fontSize: 11.5,
                    color: C.textSecondary,
                    lineHeight: 1.5,
                    marginTop: 2,
                    maxWidth: "74ch",
                  }}
                >
                  {entry.blurb}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function ModuleGlossary({ sections, onOpenSection, C: CProp }) {
  const C = CProp || FALLBACK_C;
  const available = Array.isArray(sections) ? sections : [];

  const modules = MODULE_LABELS.map((label) =>
    available.find((s) => s && s.label === label),
  ).filter(Boolean);

  if (modules.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <h3
        style={{
          margin: "0 0 4px",
          fontSize: 14,
          fontWeight: 700,
          color: C.textPrimary,
        }}
      >
        Modules
      </h3>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 12,
          color: C.textSecondary,
          lineHeight: 1.5,
        }}
      >
        What each module covers and what it contains. Select a name to open it.
      </p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr" }}>
        {modules.map((section) => (
          <ModuleCard
            key={section.label}
            section={section}
            onOpenSection={onOpenSection}
            C={C}
          />
        ))}
      </div>
    </div>
  );
}
