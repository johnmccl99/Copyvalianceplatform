import React from "react";
import { createPortal } from "react-dom";
import { T } from "../../lib/theme.js";
import {
  NUMERIC_OPS,
  NUMERIC_OP_LABELS,
  DATE_OPS,
  DATE_OP_LABELS,
  isUsableDateCondition,
} from "../../lib/rentRollView.js";

const NARROW_THRESHOLD = 8;

const POPOVER_WIDTH = 300;
const POPOVER_FLIP_THRESHOLD = 200;
const VIEWPORT_MARGIN = 8;

export function popoverPlacement(rect, viewport) {
  const vw = viewport.width;
  const vh = viewport.height;
  const below = vh - rect.bottom - VIEWPORT_MARGIN;
  const above = rect.top - VIEWPORT_MARGIN;
  const flip = below < POPOVER_FLIP_THRESHOLD && above > below;
  return {
    left: Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, vw - POPOVER_WIDTH - VIEWPORT_MARGIN),
    ),
    top: flip ? null : rect.bottom + 4,
    bottom: flip ? vh - rect.top + 4 : null,
    maxHeight: Math.max(0, flip ? above : below),
  };
}

export function triggerIsVisibleIn(rect, clipRect) {
  if (!clipRect) return true;
  const zeroSized = (r) => !(r.right - r.left) && !(r.bottom - r.top);
  if (zeroSized(clipRect) || zeroSized(rect)) return true;
  return (
    rect.right > clipRect.left &&
    rect.left < clipRect.right &&
    rect.bottom > clipRect.top &&
    rect.top < clipRect.bottom
  );
}

function clippingAncestor(node) {
  for (
    let el = node && node.parentElement;
    el && el !== document.body;
    el = el.parentElement
  ) {
    const style = window.getComputedStyle(el);
    if (/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`))
      return el;
  }
  return null;
}

export default function RentRollColumnFilter({
  C = {},
  column,
  options = [],
  selected = [],
  onToggle,
  onClear,
  onSelectAll,
  numeric = false,
  dateCol = false,
  conditions = [],
  onCondition,
  blankCount = 0,
  hideBlanks = false,
  onToggleHideBlanks,
}) {
  const [open, setOpen] = React.useState(false);
  const [needle, setNeedle] = React.useState("");
  const wrapRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [placement, setPlacement] = React.useState(null);

  const border = C.border || T.border;
  const card = C.card || T.surface;
  const textPrimary = C.textPrimary || T.textPrimary;
  const textSecondary = C.textSecondary || T.textSecondary;
  const subtleBg = C.subtleBg || T.inset;

  const usableNum = (c) =>
    c &&
    NUMERIC_OPS.includes(c.op) &&
    c.value !== "" &&
    c.value != null &&
    Number.isFinite(Number(c.value));
  const usable = dateCol ? isUsableDateCondition : usableNum;
  const comparable = numeric || dateCol;
  const rangeActive = comparable && conditions.some(usable);
  const active = selected.length > 0 || rangeActive;
  const label = (column && column.label) || (column && column.key) || "";

  React.useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return undefined;
    }
    const measure = () => {
      const node = wrapRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const clip = clippingAncestor(node);
      const viewport = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const gone =
        !triggerIsVisibleIn(rect, clip ? clip.getBoundingClientRect() : null) ||
        !triggerIsVisibleIn(rect, viewport);
      if (gone) {
        setOpen(false);
        return;
      }
      setPlacement(
        popoverPlacement(rect, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      const inButton = wrapRef.current && wrapRef.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inButton && !inPanel) setOpen(false);
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

  React.useEffect(() => {
    if (!open) setNeedle("");
  }, [open]);

  const shown = !needle.trim()
    ? options
    : options.filter((o) =>
        String(o.label).toLowerCase().includes(needle.trim().toLowerCase()),
      );

  const selectedSet = new Set(selected);

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
        title={
          active
            ? [
                selected.length
                  ? `${selected.length} of ${options.length} values shown`
                  : null,
                rangeActive
                  ? dateCol
                    ? "a date comparison is set"
                    : "a numeric comparison is set"
                  : null,
              ]
                .filter(Boolean)
                .join("; ")
                .replace(/^./, (m) => `${label}: ${m}`) +
              ". Click to change or clear."
            : `Filter by ${label}`
        }
        aria-label={
          active
            ? `Filter by ${label}, ` +
              [
                selected.length
                  ? `${selected.length} of ${options.length} values selected`
                  : null,
                rangeActive
                  ? dateCol
                    ? "date comparison set"
                    : "numeric comparison set"
                  : null,
              ]
                .filter(Boolean)
                .join(", ")
            : `Filter by ${label}`
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          padding: "2px 4px",
          marginLeft: 2,
          background: active ? subtleBg : "transparent",
          border: `1px solid ${active ? textPrimary : "transparent"}`,
          borderRadius: 4,
          color: active ? textPrimary : textSecondary,
          opacity: active ? 1 : 0.55,
          font: "inherit",
          fontSize: 10,
          lineHeight: 1.2,
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true">{active ? "▼" : "▽"}</span>
        {selected.length ? (
          <span style={{ fontSize: 9, fontWeight: 700 }}>
            {selected.length}
          </span>
        ) : null}
        {rangeActive ? (
          <span aria-hidden="true" style={{ fontSize: 9, fontWeight: 700 }}>
            ≷
          </span>
        ) : null}
      </button>

      {open && placement
        ? createPortal(
            <div
              ref={panelRef}
              role="group"
              aria-label={`${label} filter`}
              style={{
                position: "fixed",
                zIndex: 900,
                left: placement.left,
                ...(placement.top == null ? {} : { top: placement.top }),
                ...(placement.bottom == null
                  ? {}
                  : { bottom: placement.bottom }),
                maxHeight: placement.maxHeight,
                overflowY: "auto",
                minWidth: 210,
                maxWidth: POPOVER_WIDTH,
                boxSizing: "border-box",
                background: card,
                border: `1px solid ${border}`,
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
                padding: 8,
                textTransform: "none",
                letterSpacing: 0,
                fontWeight: 400,
                fontSize: 12,
                color: textPrimary,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: textPrimary,
                  marginBottom: 6,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {label}
              </div>

              {comparable ? (
                <div
                  style={{
                    marginBottom: 8,
                    paddingBottom: 8,
                    borderBottom: `1px solid ${border}`,
                  }}
                >
                  {[0, 1].map((slot) => {
                    const c = conditions[slot] || {};
                    const effOp = (dateCol ? DATE_OPS : NUMERIC_OPS).includes(
                      c.op,
                    )
                      ? c.op
                      : dateCol
                        ? slot === 0
                          ? "onafter"
                          : "onbefore"
                        : slot === 0
                          ? "gte"
                          : "lte";
                    return (
                      <div
                        key={slot}
                        style={{ display: "flex", gap: 4, marginBottom: 4 }}
                      >
                        <select
                          value={effOp}
                          onChange={(e) =>
                            onCondition &&
                            onCondition(slot, { op: e.target.value })
                          }
                          aria-label={`${label} comparison ${slot + 1} operator`}
                          style={{
                            fontSize: 11,
                            padding: "3px 4px",
                            borderRadius: 4,
                            border: `1px solid ${border}`,
                            background: card,
                            color: textPrimary,
                            cursor: "pointer",
                          }}
                        >
                          {(dateCol ? DATE_OPS : NUMERIC_OPS).map((op) => (
                            <option key={op} value={op}>
                              {
                                (dateCol ? DATE_OP_LABELS : NUMERIC_OP_LABELS)[
                                  op
                                ]
                              }
                            </option>
                          ))}
                        </select>
                        <input
                          type={dateCol ? "date" : "number"}
                          inputMode={dateCol ? undefined : "decimal"}
                          value={c.value == null ? "" : c.value}
                          onChange={(e) =>
                            onCondition &&
                            onCondition(slot, {
                              op: effOp,
                              value: e.target.value,
                            })
                          }
                          placeholder={
                            dateCol
                              ? slot === 0
                                ? "from"
                                : "to"
                              : slot === 0
                                ? "lower bound"
                                : "upper bound"
                          }
                          aria-label={`${label} comparison ${slot + 1} value`}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            boxSizing: "border-box",
                            fontSize: 11,
                            padding: "3px 6px",
                            borderRadius: 4,
                            border: `1px solid ${border}`,
                            background: card,
                            color: textPrimary,
                          }}
                        />
                      </div>
                    );
                  })}
                  {blankCount > 0 && !dateCol ? (
                    <div
                      style={{
                        fontSize: 10,
                        color: textSecondary,
                        marginTop: 2,
                      }}
                    >
                      {blankCount === 1
                        ? "1 row has"
                        : `${blankCount} rows have`}{" "}
                      no {label} recorded
                      {rangeActive
                        ? " and are excluded by this comparison."
                        : " and any comparison excludes them."}
                    </div>
                  ) : null}

                  {blankCount > 0 && dateCol ? (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 6,
                        marginTop: 4,
                        fontSize: 10,
                        color: textSecondary,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!hideBlanks}
                        onChange={() =>
                          onToggleHideBlanks && onToggleHideBlanks()
                        }
                        style={{ cursor: "pointer", marginTop: 1 }}
                      />
                      <span>
                        Hide the{" "}
                        {blankCount === 1 ? "1 lease" : `${blankCount} leases`}{" "}
                        with no {label} —{" "}
                        {blankCount === 1 ? "it is" : "these are"}{" "}
                        month-to-month.
                        {hideBlanks
                          ? " Currently hidden."
                          : " Shown by default: a lease with no end date is the nearest-term expiry, not missing data."}
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}

              {options.length > NARROW_THRESHOLD ? (
                <input
                  type="search"
                  value={needle}
                  onChange={(e) => setNeedle(e.target.value)}
                  placeholder="Narrow this list"
                  aria-label={`Narrow the ${label} value list`}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 11,
                    padding: "4px 6px",
                    marginBottom: 6,
                    borderRadius: 4,
                    border: `1px solid ${border}`,
                    background: card,
                    color: textPrimary,
                  }}
                />
              ) : null}

              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <button
                  type="button"
                  onClick={() => onSelectAll && onSelectAll()}
                  style={linkBtn(textSecondary)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => onClear && onClear()}
                  disabled={!active}
                  style={{
                    ...linkBtn(textSecondary),
                    opacity: active ? 1 : 0.4,
                    cursor: active ? "pointer" : "default",
                  }}
                >
                  Clear
                </button>
              </div>

              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {shown.length === 0 ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: textSecondary,
                      padding: "6px 2px",
                    }}
                  >
                    No value in this column matches “{needle.trim()}”.
                  </div>
                ) : (
                  shown.map((o) => (
                    <label
                      key={o.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 2px",
                        fontSize: 11,
                        color: textPrimary,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(o.value)}
                        onChange={() => onToggle && onToggle(o.value)}
                        style={{ cursor: "pointer" }}
                      />
                      <span
                        style={{
                          flex: 1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {o.label}
                      </span>
                      <span style={{ fontSize: 10, color: textSecondary }}>
                        {o.count}
                      </span>
                    </label>
                  ))
                )}
              </div>

              <div
                style={{
                  fontSize: 10,
                  color: textSecondary,
                  marginTop: 6,
                  borderTop: `1px solid ${border}`,
                  paddingTop: 5,
                }}
              >
                {!active
                  ? "No filter on this column — every value is shown."
                  : [
                      selected.length
                        ? `Showing ${selected.length} of ${options.length} values.`
                        : null,
                      rangeActive
                        ? dateCol
                          ? "A date comparison is narrowing this column."
                          : "A numeric comparison is narrowing this column."
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function linkBtn(color) {
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "3px 6px",
    borderRadius: 4,
    background: "transparent",
    border: "none",
    color,
    cursor: "pointer",
    textDecoration: "underline",
  };
}
