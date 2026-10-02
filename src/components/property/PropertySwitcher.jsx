import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";

const TYPE_GLYPH = {
  Office: "◼",
  Industrial: "◆",
  Multifamily: "●",
  Retail: "▲",
};
const glyphFor = (t) => TYPE_GLYPH[t] || "◈";

const bucketTag = (section) => {
  if (!section) return "";
  const last = section.split(">").pop().trim();
  if (last === "Current Portfolio") return "";
  return last.replace(/^Active\s+/, "");
};

export default function PropertySwitcher({
  items = [],
  activeKey = null,
  onSelect,
  C = {},
  variant = "sidebar",
  placeholder = "Switch property",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const isHeader = variant === "header";

  const active = useMemo(
    () => items.find((i) => i.key === activeKey) || null,
    [items, activeKey],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.label || "").toLowerCase().includes(q) ||
        (i.section || "").toLowerCase().includes(q),
    );
  }, [items, query]);

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
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const choose = useCallback(
    (key) => {
      onSelect?.(key);
      setOpen(false);
      setQuery("");
    },
    [onSelect],
  );

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[highlight];
      if (it) choose(it.key);
    }
  };

  const text = C.textPrimary || "#111";
  const textSec = C.textSecondary || "#666";
  const border = C.border || "#ddd";
  const cardBg = C.cardBg || C.white || "#fff";

  const triggerStyle = isHeader
    ? {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${border}`,
        background: "transparent",
        color: text,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }
    : {
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 12px",
        borderRadius: 7,
        border: `1px solid ${border}`,
        background: cardBg,
        color: text,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 6,
      };

  const panelStyle = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 60,
    width: isHeader ? 300 : "100%",
    minWidth: 220,
    background: cardBg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
    overflow: "hidden",
  };

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", width: isHeader ? "auto" : "100%" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch property"
        title="Switch property"
        style={triggerStyle}
      >
        <span aria-hidden="true" style={{ fontSize: 12, opacity: 0.7 }}>
          {isHeader ? "⇆" : "⌕"}
        </span>
        <span style={{ flex: isHeader ? "0 0 auto" : 1, textAlign: "left" }}>
          {isHeader ? "Switch" : placeholder}
        </span>
        {!isHeader && (
          <span style={{ fontSize: 11, color: textSec, fontWeight: 500 }}>
            {items.length}
          </span>
        )}
        <span
          aria-hidden="true"
          style={{
            fontSize: 9,
            opacity: 0.7,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          {"▾"}
        </span>
      </button>

      {open && (
        <div role="listbox" aria-label="Properties" style={panelStyle}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
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
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "14px", fontSize: 12, color: textSec }}>
                No properties match "{query}".
              </div>
            ) : (
              filtered.map((it, idx) => {
                const isActive = it.key === activeKey;
                const isHi = idx === highlight;
                const tag = bucketTag(it.section);
                return (
                  <button
                    key={it.key}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => choose(it.key)}
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
                      fontWeight: isActive ? 600 : 400,
                      background: isHi
                        ? "var(--ds-hover)"
                        : isActive
                          ? "var(--ds-selected)"
                          : "transparent",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        fontSize: 11,
                        opacity: 0.7,
                        width: 14,
                        flexShrink: 0,
                      }}
                    >
                      {glyphFor(it.propertyType)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {it.label}
                    </span>
                    {tag && (
                      <span
                        style={{ fontSize: 10, color: textSec, flexShrink: 0 }}
                      >
                        {tag}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
