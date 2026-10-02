import React, { useMemo, useState } from "react";
import registry from "./surfaceRegistry.json";
import manifest from "./statusManifest.json";
import contentDoc from "./surfaceContent.json";
import { visibleGuideSurfaces } from "./guideVisibility.js";
import { BUDGET_AGENT_SURFACE_HIDDEN } from "../hiddenSurfaces.js";

const HIDDEN_SURFACE_KEYS = new Set([
  ...(BUDGET_AGENT_SURFACE_HIDDEN ? ["budgetAgent"] : []),
]);
const isHiddenSurface = (key) => HIDDEN_SURFACE_KEYS.has(key);

const FALLBACK_C = {
  navy: "var(--ds-text-primary)",
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
    case "Planned":
      return { bg: C.badgeGrayBg, text: C.badgeGrayText, label: "Planned" };
    default:
      return {
        bg: C.badgeGrayBg,
        text: C.badgeGrayText,
        label: status || "Unknown",
      };
  }
}

const STATUS_MEANING = {
  Live: "Built and wired to real data. This is a working tool.",
  Preview:
    "A preview of a planned tool. What you see is sample data, not live records.",
  Planned: "Not built yet. The surface is a placeholder.",
};

export default function UserGuide({
  C: themeC,
  navItems = null,
  hiddenNavKeys = null,
  role = null,
} = {}) {
  const C = themeC || FALLBACK_C;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const statusByKey = useMemo(() => {
    const m = {};
    for (const s of manifest.surfaces) m[s.key] = s.status;
    return m;
  }, []);

  const readableSurfaces = useMemo(
    () =>
      visibleGuideSurfaces(registry.surfaces, {
        navItems,
        hiddenNavKeys,
        role,
      }),
    [navItems, hiddenNavKeys, role],
  );

  const groups = useMemo(() => {
    const order = [];
    const byGroup = {};
    for (const s of readableSurfaces) {
      if (isHiddenSurface(s.key)) continue;
      const status = statusByKey[s.key] || "Planned";
      const content = contentDoc.content[s.key] || {};
      const row = {
        key: s.key,
        name: s.name,
        group: s.group,
        status,
        whatItIs: content.whatItIs || "",
        howItWorks: content.howItWorks || "",
      };
      if (!byGroup[s.group]) {
        byGroup[s.group] = [];
        order.push(s.group);
      }
      byGroup[s.group].push(row);
    }
    return order.map((g) => ({ group: g, rows: byGroup[g] }));
  }, [statusByKey, readableSurfaces]);

  const counts = useMemo(() => {
    const c = { Live: 0, Preview: 0, Planned: 0 };
    for (const g of groups)
      for (const r of g.rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [groups]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return groups
      .map((g) => ({
        group: g.group,
        rows: g.rows.filter((r) => {
          if (statusFilter !== "all" && r.status !== statusFilter) return false;
          if (!q) return true;
          return (
            r.name.toLowerCase().includes(q) ||
            r.group.toLowerCase().includes(q) ||
            r.whatItIs.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.rows.length > 0);
  }, [groups, q, statusFilter]);

  const totalShown = filtered.reduce((n, g) => n + g.rows.length, 0);

  const filterBtn = (value, label) => {
    const isActive = statusFilter === value;
    return (
      <button
        key={value}
        onClick={() => setStatusFilter(value)}
        style={{
          padding: "6px 12px",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          background: isActive ? C.navy : "transparent",
          color: isActive ? "#fff" : C.textSecondary,
          fontSize: 12,
          fontWeight: isActive ? 600 : 500,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        background: C.bg,
        minHeight: "100vh",
        padding: "24px 28px 64px",
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: C.navy,
            margin: "0 0 6px",
          }}
        >
          User Guide
        </h1>
        <p
          style={{
            fontSize: 14,
            color: C.textSecondary,
            margin: "0 0 20px",
            lineHeight: 1.5,
          }}
        >
          Every surface available to you, in plain English, with its current
          status.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 18,
          }}
        >
          {["Live", "Preview", "Planned"].map((st) => {
            const b = statusBadgeStyle(st, C);
            return (
              <div
                key={st}
                style={{
                  flex: "1 1 240px",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  background: C.cardBg,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      background: b.bg,
                      color: b.text,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                    }}
                  >
                    {b.label}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.textPrimary,
                    }}
                  >
                    {counts[st] || 0}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.textSecondary,
                    lineHeight: 1.4,
                  }}
                >
                  {STATUS_MEANING[st]}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search surfaces..."
            style={{
              flex: "1 1 240px",
              padding: "8px 12px",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              fontSize: 13,
              background: C.cardBg,
              color: C.textPrimary,
            }}
          />
          {filterBtn("all", "All")}
          {filterBtn("Live", "Live")}
          {filterBtn("Preview", "Preview")}
          {filterBtn("Planned", "Planned")}
        </div>

        {totalShown === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: C.textSecondary,
              fontSize: 13,
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
            }}
          >
            {readableSurfaces.length === 0
              ? "There are no surfaces to describe for your account yet. Ask an org admin which modules are turned on."
              : "No surfaces match your search."}
          </div>
        ) : (
          filtered.map((g) => (
            <section key={g.group} style={{ marginBottom: 28 }}>
              <h2
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: C.navy,
                  margin: "0 0 10px",
                  paddingBottom: 6,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {g.group}
              </h2>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {g.rows.map((r) => {
                  const b = statusBadgeStyle(r.status, C);
                  return (
                    <div
                      key={r.key}
                      style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        background: C.cardBg,
                        padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: C.textPrimary,
                          }}
                        >
                          {r.name}
                        </span>
                        <span
                          style={{
                            background: b.bg,
                            color: b.text,
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 999,
                            textTransform: "uppercase",
                            letterSpacing: 0.4,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {b.label}
                        </span>
                      </div>
                      {r.whatItIs ? (
                        <p
                          style={{
                            fontSize: 13,
                            color: C.textPrimary,
                            margin: "0 0 6px",
                            lineHeight: 1.5,
                          }}
                        >
                          {r.whatItIs}
                        </p>
                      ) : null}
                      {r.status === "Live" && r.howItWorks ? (
                        <p
                          style={{
                            fontSize: 12,
                            color: C.textSecondary,
                            margin: 0,
                            lineHeight: 1.5,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>
                            How it works:{" "}
                          </span>
                          {r.howItWorks}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
