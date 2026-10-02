import React, { useEffect, useMemo, useRef, useState } from "react";
import PropertyScopePicker from "./PropertyScopePicker.jsx";
import UnifiedViewShell from "./UnifiedViewShell.jsx";
import { buildScopeItems } from "../../lib/unifiedViewLoaders.js";
import { useIsMobile } from "../../lib/useMediaQuery.js";
import { T } from "../../lib/theme.js";

const SCOPE_LS_KEY = "vb.propertyScope";
const SETS_LS_KEY = "vb.propertySets";

function readLsJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeLsJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export default function UnifiedViewPage({
  C = {},
  userProfile = null,
  onOpenProperty,
} = {}) {
  const isMobile = useIsMobile();
  const [items, setItems] = useState(null);
  const [selectedCodes, setSelectedCodes] = useState(null);
  const [savedSets, setSavedSets] = useState(() => {
    const stored = readLsJson(SETS_LS_KEY, []);
    return Array.isArray(stored)
      ? stored.filter(
          (s) => s && typeof s.name === "string" && Array.isArray(s.codes),
        )
      : [];
  });
  const [scopeVersion, setScopeVersion] = useState(0);
  const bumpScope = useRef(() => setScopeVersion((v) => v + 1)).current;

  useEffect(() => {
    let alive = true;
    buildScopeItems().then((list) => {
      if (!alive) return;
      const safe = Array.isArray(list) ? list : [];
      setItems(safe);
      const codes = new Set(safe.map((it) => it.code));
      const stored = readLsJson(SCOPE_LS_KEY, null);
      if (Array.isArray(stored)) {
        setSelectedCodes(new Set(stored.filter((c) => codes.has(c))));
      } else {
        setSelectedCodes(new Set(codes));
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const applySelection = (nextSet) => {
    const next = nextSet instanceof Set ? nextSet : new Set(nextSet || []);
    setSelectedCodes(next);
    writeLsJson(SCOPE_LS_KEY, [...next]);
    bumpScope();
  };

  const handleSaveSet = (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed || !(selectedCodes instanceof Set) || selectedCodes.size === 0)
      return;
    setSavedSets((prev) => {
      const next = [
        ...prev.filter((s) => s.name !== trimmed),
        { name: trimmed, codes: [...selectedCodes] },
      ];
      writeLsJson(SETS_LS_KEY, next);
      return next;
    });
  };

  const handleApplySet = (name) => {
    const found = savedSets.find((s) => s.name === name);
    if (!found || !Array.isArray(items)) return;
    const live = new Set(items.map((it) => it.code));
    applySelection(new Set(found.codes.filter((c) => live.has(c))));
  };

  const handleDeleteSet = (name) => {
    setSavedSets((prev) => {
      const next = prev.filter((s) => s.name !== name);
      writeLsJson(SETS_LS_KEY, next);
      return next;
    });
  };

  const handleRemoveProperty = (code) => {
    if (!(selectedCodes instanceof Set)) return;
    const next = new Set(selectedCodes);
    next.delete(code);
    applySelection(next);
  };

  const selectedProperties = useMemo(() => {
    if (!Array.isArray(items) || !(selectedCodes instanceof Set)) return [];
    return items.filter((it) => selectedCodes.has(it.code));
  }, [items, selectedCodes]);

  const sub = C.textSecondary || T.textSecondary;

  if (items === null || selectedCodes === null) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: sub }}>
        Loading the property registry...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: 0,
            color: C.textPrimary || T.textPrimary,
          }}
        >
          Portfolio Command — Selected Set
        </h1>
        <p style={{ fontSize: 13, color: sub, lineHeight: 1.5 }}>
          No budget-registered properties are available to this account yet.
          Properties appear here once their budget workbooks are registered;
          single-property views remain available from the sidebar.
        </p>
      </div>
    );
  }

  return (
    <UnifiedViewShell
      scopeItems={items}
      selectedProperties={selectedProperties}
      scopeVersion={scopeVersion}
      C={C}
      userProfile={userProfile}
      onOpenProperty={onOpenProperty}
      onRemoveProperty={handleRemoveProperty}
      pickerSlot={
        <PropertyScopePicker
          items={items}
          selectedCodes={selectedCodes}
          onChange={applySelection}
          savedSets={savedSets}
          onSaveSet={handleSaveSet}
          onApplySet={handleApplySet}
          onDeleteSet={handleDeleteSet}
          C={C}
          isMobile={isMobile}
        />
      }
    />
  );
}
