import React, { useMemo, useRef, useState } from "react";
import { canCurateModuleVisibility } from "../../lib/roleAccess.js";
import { PROTECTED_SURFACE_KEYS } from "../../lib/navSections.js";
import { PROPERTY_TAB_PANEL_GROUPS } from "../../lib/propertyTabVisibility.js";
import { useModuleVisibility } from "../../lib/useModuleVisibility.js";
import { T } from "../../lib/theme.js";

function buildToggleGroups(navSections) {
  const groups = [];
  for (const section of navSections || []) {
    if (section.type === "portfolio") continue;
    let items = [];
    if (section.type === "grouped") {
      items = (section.subGroups || []).flatMap((g) => g.items || []);
    } else {
      items = section.items || [];
    }
    const toggleable = items.filter(
      (i) =>
        i.key &&
        !PROTECTED_SURFACE_KEYS.has(i.key) &&
        !i.key.startsWith("prop_") &&
        i.key !== "moduleVisibility",
    );
    if (toggleable.length)
      groups.push({ label: section.label, items: toggleable });
  }
  return groups;
}

export default function ModuleVisibilityPanel({
  C = {},
  userProfile,
  navSections,
} = {}) {
  const orgId = userProfile?.org_id || null;
  const authorized = canCurateModuleVisibility(userProfile);
  const [savingKey, setSavingKey] = useState(null);
  const [toggleError, setToggleError] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkRef = useRef(false);

  const {
    hidden,
    loading: visLoading,
    error: visError,
    applyToggle: persistToggle,
  } = useModuleVisibility(orgId);
  const error = toggleError || visError;

  const groups = useMemo(
    () => [...buildToggleGroups(navSections), ...PROPERTY_TAB_PANEL_GROUPS],
    [navSections],
  );

  const persistOne = async (key, nextVisible) => {
    setSavingKey(key);
    try {
      await persistToggle(key, nextVisible);
      return null;
    } catch (e) {
      return e || new Error("Save failed.");
    } finally {
      setSavingKey(null);
    }
  };

  const applyToggle = async (key, nextVisible) => {
    if (!orgId) return;
    setToggleError(null);
    const failure = await persistOne(key, nextVisible);
    if (failure)
      setToggleError(
        failure.message || "Save failed — your change was not applied.",
      );
  };

  const setGroup = async (group, nextVisible) => {
    const items = group?.items || [];
    if (!orgId || !items.length || bulkRef.current) return;
    bulkRef.current = true;
    setBulkBusy(true);
    setToggleError(null);
    const failed = [];
    let applied = 0;
    try {
      for (const it of items) {
        const failure = await persistOne(it.key, nextVisible);
        if (failure) failed.push(it);
        else applied += 1;
      }
    } finally {
      bulkRef.current = false;
      setBulkBusy(false);
    }
    if (!failed.length) return;
    const action = nextVisible ? "Show all" : "Hide all";
    const unchanged = nextVisible ? "hidden" : "visible";
    setToggleError(
      `${action} did not finish for ${group.label}. ${applied} of ${items.length} ` +
        `surface${items.length === 1 ? "" : "s"} changed; ${failed.length} ` +
        `${failed.length === 1 ? "did not and is" : "did not and are"} still ${unchanged}: ` +
        `${failed.map((i) => `${i.label} (${i.key})`).join(", ")}. ` +
        `Retry, or set ${failed.length === 1 ? "it" : "them"} individually below.`,
    );
  };

  const text = C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.cardBg || C.surface || T.surface;
  const accent = C.accent || T.accent;
  const busy = savingKey !== null || bulkBusy;

  if (!userProfile || (authorized && visLoading)) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: sub }}>
        Loading module visibility…
      </div>
    );
  }

  if (!authorized) {
    return (
      <div
        style={{
          padding: 24,
          background: "var(--ds-danger-bg)",
          border:
            "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
          borderRadius: 10,
          color: "var(--ds-danger-text)",
          maxWidth: 640,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
          Not authorized
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Module Visibility is available to your organization's administrators.
          Your current role does not include curation access — if a module you
          need is hidden, ask an administrator in your organization.
        </div>
      </div>
    );
  }

  const hiddenCount = hidden.size;
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "8px 4px" }}>
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: text,
            margin: "0 0 4px",
          }}
        >
          Module Visibility
        </h2>
        <p style={{ fontSize: 13, color: sub, lineHeight: 1.6, margin: 0 }}>
          Curate which modules appear in the left navigation — and which tabs
          appear on property pages — for everyone in your organization. Hiding
          is reversible and never deletes anything — role permissions still
          apply underneath, and Security &amp; Compliance surfaces always stay
          visible.{" "}
          {hiddenCount > 0
            ? `${hiddenCount} surface${hiddenCount === 1 ? "" : "s"} currently hidden.`
            : "Everything is currently visible."}
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: "var(--ds-danger-bg)",
            border:
              "1px solid color-mix(in srgb, var(--ds-danger-dot) 34.9%, transparent)",
            borderRadius: 8,
            color: "var(--ds-danger-text)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {groups.map((group) => {
        const allHidden = group.items.every((i) => hidden.has(i.key));
        const allVisible = group.items.every((i) => !hidden.has(i.key));
        const showAllOff = allVisible || busy;
        const hideAllOff = allHidden || busy;
        return (
          <div
            key={group.label}
            style={{
              border: `1px solid ${border}`,
              borderRadius: 10,
              background: card,
              marginBottom: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderBottom: `1px solid ${border}`,
                background: "var(--ds-inset)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: text }}>
                {group.label}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setGroup(group, true)}
                  disabled={showAllOff}
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: `1px solid ${border}`,
                    background: showAllOff ? "var(--ds-inset)" : "#fff",
                    color: showAllOff ? sub : accent,
                    cursor: showAllOff ? "default" : "pointer",
                  }}
                >
                  Show all
                </button>
                <button
                  type="button"
                  onClick={() => setGroup(group, false)}
                  disabled={hideAllOff}
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: `1px solid ${border}`,
                    background: hideAllOff ? "var(--ds-inset)" : "#fff",
                    color: hideAllOff ? sub : "var(--ds-warning-text)",
                    cursor: hideAllOff ? "default" : "pointer",
                  }}
                >
                  Hide all
                </button>
              </div>
            </div>
            <div>
              {group.items.map((item) => {
                const isHidden = hidden.has(item.key);
                const rowBusy = savingKey === item.key || bulkBusy;
                return (
                  <div
                    key={item.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderTop: `1px solid ${border}`,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, color: text }}>
                        {item.label}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: sub,
                          fontFamily: "monospace",
                        }}
                      >
                        {item.key}
                      </div>
                    </div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: rowBusy ? "wait" : "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: isHidden
                            ? "var(--ds-warning-text)"
                            : "var(--ds-success-dot)",
                          fontWeight: 600,
                          minWidth: 52,
                          textAlign: "right",
                        }}
                      >
                        {isHidden ? "Hidden" : "Visible"}
                      </span>
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        disabled={rowBusy}
                        onChange={(e) =>
                          applyToggle(item.key, e.target.checked)
                        }
                        aria-label={`${isHidden ? "Show" : "Hide"} ${item.label}`}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {groups.length === 0 && (
        <div style={{ padding: 24, color: sub, fontSize: 13 }}>
          No toggleable modules found.
        </div>
      )}
    </div>
  );
}
