import React from "react";
import { T } from "../../lib/theme.js";

export default function RentRollColumnPicker({
  C = {},
  columns = [],
  hidden = {},
  onToggle,
  onShowAll,
  lockedKeys = [],
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);

  const border = C.border || T.border;
  const card = C.card || T.surface;
  const textPrimary = C.textPrimary || T.textPrimary;
  const textSecondary = C.textSecondary || T.textSecondary;
  const subtleBg = C.subtleBg || T.inset;

  const locked = new Set(lockedKeys);
  const total = columns.length;
  const showing = columns.filter((c) => c && !hidden[c.key]).length;
  const hiddenCount = total - showing;
  const narrowed = hiddenCount > 0;

  React.useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target))
        setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-flex" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={
          narrowed
            ? `Choose columns. ${showing} of ${total} showing, ${hiddenCount} hidden. The Excel and PDF exports carry the same columns.`
            : "Choose which columns the rent roll and its exports show"
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          padding: "5px 10px",
          borderRadius: 6,
          cursor: "pointer",
          whiteSpace: "nowrap",
          color: narrowed ? textPrimary : textSecondary,
          background: narrowed ? subtleBg : "transparent",
          border: `1px solid ${border}`,
        }}
      >
        {narrowed ? `Columns (${showing} of ${total})` : "Columns"}
      </button>

      {open ? (
        <div
          role="group"
          aria-label="Columns shown on the rent roll"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 60,
            minWidth: 240,
            maxHeight: 360,
            overflowY: "auto",
            background: card,
            border: `1px solid ${border}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            padding: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: textPrimary }}>
              Columns
            </span>
            <button
              type="button"
              onClick={() => onShowAll && onShowAll()}
              disabled={!narrowed}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 5,
                cursor: narrowed ? "pointer" : "default",
                color: narrowed ? textPrimary : textSecondary,
                background: "transparent",
                border: `1px solid ${border}`,
                opacity: narrowed ? 1 : 0.5,
              }}
            >
              Show all
            </button>
          </div>

          {columns.map((col) => {
            if (!col) return null;
            const isLocked = locked.has(col.key);
            const on = !hidden[col.key];
            return (
              <label
                key={col.key}
                htmlFor={`rent-roll-col-${col.key}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 2px",
                  fontSize: 12,
                  color: isLocked ? textSecondary : textPrimary,
                  cursor: isLocked ? "default" : "pointer",
                }}
              >
                <input
                  id={`rent-roll-col-${col.key}`}
                  type="checkbox"
                  checked={on}
                  disabled={isLocked}
                  onChange={() => onToggle && onToggle(col.key)}
                  style={{ cursor: isLocked ? "default" : "pointer" }}
                />
                <span>{col.label || col.key}</span>
                {isLocked ? (
                  <span style={{ fontSize: 10, color: textSecondary }}>
                    always shown
                  </span>
                ) : null}
              </label>
            );
          })}

          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${border}`,
              fontSize: 10,
              color: textSecondary,
              lineHeight: 1.5,
            }}
          >
            {narrowed
              ? `${hiddenCount} column${hiddenCount === 1 ? "" : "s"} hidden. The Excel and PDF exports carry the same columns as the screen.`
              : "Every column is showing. The Excel and PDF exports carry the same columns as the screen."}
          </div>
        </div>
      ) : null}
    </span>
  );
}
