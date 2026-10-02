import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";

export function scopePillLabel(items = [], selectedCodes = new Set()) {
  const selected = items.filter((i) => selectedCodes.has(i.code));
  if (items.length === 0 || selected.length === 0) return "No properties";
  if (selected.length === items.length) return "All properties";
  if (selected.length === 1) return selected[0].name;
  return `${selected[0].name} + ${selected.length - 1} more`;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function PropertyScopePicker({
  items = [],
  selectedCodes = new Set(),
  onChange,
  savedSets = [],
  onSaveSet,
  onApplySet,
  onDeleteSet,
  C = {},
  isMobile = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [setName, setSetName] = useState("");
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);

  const text = C.textPrimary || "#111";
  const textSec = C.textSecondary || "#666";
  const border = C.border || "#ddd";
  const cardBg = C.cardBg || C.white || "#fff";
  const accent = C.accent || "#3b6ff5";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.name || "").toLowerCase().includes(q) ||
        (i.code || "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const selCount = useMemo(
    () => items.reduce((n, i) => n + (selectedCodes.has(i.code) ? 1 : 0), 0),
    [items, selectedCodes],
  );

  const closePanel = useCallback((restoreFocus) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setHighlight(0);
    setSetName("");
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const toggle = useCallback(
    (code) => {
      const next = new Set(selectedCodes);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      onChange?.(next);
    },
    [selectedCodes, onChange],
  );

  const selectAll = () => onChange?.(new Set(items.map((i) => i.code)));
  const selectNone = () => onChange?.(new Set());

  const saveDisabled = selCount === 0 || setName.trim() === "";
  const doSave = () => {
    if (saveDisabled) return;
    onSaveSet?.(setName.trim());
    setSetName("");
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[highlight];
      if (it) toggle(it.code);
    }
  };

  const onPanelKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePanel(true);
      return;
    }
    if (!isMobile || e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const list = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR));
    if (list.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const quietBtn = {
    fontSize: 11.5,
    padding: "3px 9px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: "transparent",
    color: text,
    cursor: "pointer",
  };

  const sectionLabel = {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: textSec,
    padding: "10px 12px 4px",
  };

  const pillLabel = scopePillLabel(items, selectedCodes);

  const panelBody = (
    <>
      {items.length === 0 ? (
        <div style={{ padding: "16px 14px", fontSize: 12.5, color: textSec }}>
          No properties available. The scope picker fills in once the property
          registry loads.
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={`Search ${items.length} ${items.length === 1 ? "property" : "properties"}`}
            aria-label="Search properties"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "9px 12px",
              border: "none",
              borderBottom: `1px solid ${border}`,
              background: "transparent",
              color: text,
              fontSize: 13,
              outline: "none",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderBottom: `1px solid ${border}`,
            }}
          >
            <button type="button" style={quietBtn} onClick={selectAll}>
              Select all
            </button>
            <button type="button" style={quietBtn} onClick={selectNone}>
              Select none
            </button>
            <span
              style={{ marginLeft: "auto", fontSize: 11.5, color: textSec }}
            >
              {selCount} of {items.length} selected
            </span>
          </div>
          <div
            role="listbox"
            aria-label="Properties"
            aria-multiselectable="true"
            style={{
              maxHeight: isMobile ? "none" : 260,
              overflowY: "auto",
              flex: isMobile ? 1 : "0 1 auto",
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: "14px", fontSize: 12, color: textSec }}>
                No properties match "{query}".
              </div>
            ) : (
              filtered.map((it, idx) => {
                const checked = selectedCodes.has(it.code);
                const isHi = idx === highlight;
                return (
                  <button
                    key={it.code}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(it.code)}
                    onMouseEnter={() => setHighlight(idx)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: text,
                      fontWeight: checked ? 600 : 400,
                      background: isHi ? "var(--ds-hover)" : "transparent",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        borderRadius: 3,
                        border: `1.5px solid ${checked ? accent : border}`,
                        background: checked ? accent : "transparent",
                        boxShadow: checked
                          ? `inset 0 0 0 2.5px ${cardBg}`
                          : "none",
                      }}
                    />
                    <span
                      aria-hidden="true"
                      style={{
                        fontSize: 11,
                        opacity: 0.7,
                        width: 14,
                        flexShrink: 0,
                      }}
                    >
                      {"◈"}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {it.name}
                    </span>
                    {it.tag && (
                      <span
                        style={{ fontSize: 10, color: textSec, flexShrink: 0 }}
                      >
                        {it.tag}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div style={{ borderTop: `1px solid ${border}` }}>
            <div style={sectionLabel}>Saved sets</div>
            {savedSets.length === 0 ? (
              <div
                style={{
                  padding: "2px 12px 8px",
                  fontSize: 11.5,
                  color: textSec,
                }}
              >
                No saved sets yet. Save the current selection below to reuse it.
              </div>
            ) : (
              savedSets.map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0 6px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onApplySet?.(s.name)}
                    aria-label={`Apply set ${s.name}`}
                    title={`Apply set ${s.name}`}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      textAlign: "left",
                      padding: "6px 6px",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: text,
                      background: "transparent",
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.name}
                    </span>
                    <span
                      style={{ fontSize: 10.5, color: textSec, flexShrink: 0 }}
                    >
                      {(s.codes || []).length}{" "}
                      {(s.codes || []).length === 1 ? "property" : "properties"}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete set ${s.name}`}
                    title={`Delete set ${s.name}`}
                    onClick={() => onDeleteSet?.(s.name)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: textSec,
                      cursor: "pointer",
                      fontSize: 14,
                      lineHeight: 1,
                      padding: "4px 6px",
                      borderRadius: 5,
                      flexShrink: 0,
                    }}
                  >
                    {"×"}
                  </button>
                </div>
              ))
            )}
            <div style={{ display: "flex", gap: 6, padding: "8px 12px 12px" }}>
              <input
                value={setName}
                onChange={(e) => setSetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    doSave();
                  }
                }}
                placeholder="Save current as..."
                aria-label="New set name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  boxSizing: "border-box",
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: text,
                  fontSize: 12,
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={doSave}
                disabled={saveDisabled}
                style={{
                  ...quietBtn,
                  fontWeight: 600,
                  opacity: saveDisabled ? 0.5 : 1,
                  cursor: saveDisabled ? "default" : "pointer",
                }}
              >
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Property scope"
        title="Property scope"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 12px",
          borderRadius: 999,
          border: `1px solid ${border}`,
          background: cardBg,
          color: text,
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
          maxWidth: 320,
        }}
      >
        <span
          aria-hidden="true"
          style={{ fontSize: 11, opacity: 0.7, flexShrink: 0 }}
        >
          {"◈"}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {pillLabel}
        </span>
        <span
          aria-hidden="true"
          style={{
            fontSize: 9,
            opacity: 0.7,
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          {"▾"}
        </span>
      </button>

      {open && !isMobile && (
        <div
          ref={panelRef}
          onKeyDown={onPanelKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 60,
            width: 320,
            minWidth: 260,
            background: cardBg,
            border: `1px solid ${border}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
            overflow: "hidden",
          }}
        >
          {panelBody}
        </div>
      )}

      {open && isMobile && (
        <>
          <div
            onClick={() => closePanel(true)}
            aria-hidden="true"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1090,
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(2px)",
            }}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Property scope"
            tabIndex={-1}
            onKeyDown={onPanelKeyDown}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1100,
              display: "flex",
              flexDirection: "column",
              background: cardBg,
              color: text,
              outline: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 14px",
                borderBottom: `1px solid ${border}`,
              }}
            >
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>
                Property scope
              </span>
              <button
                type="button"
                onClick={() => closePanel(true)}
                aria-label="Close property scope"
                style={quietBtn}
              >
                Close
              </button>
            </div>
            {panelBody}
          </div>
        </>
      )}
    </div>
  );
}
