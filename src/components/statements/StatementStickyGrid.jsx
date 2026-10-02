import React from "react";
import {
  scrollContainerStyle,
  STATEMENT_HEADER_ROW_VAR,
  STATEMENT_HEADER_BLOCK_VAR,
} from "../../lib/tableStyles.js";
import { pinnedHeadingStack } from "../../lib/statementHeadingStack.js";
import {
  leadingVisibleColumn,
  frozenWidthBefore,
} from "../../lib/leadingVisibleColumn.js";

const COPIED_STYLE_PROPS = [
  "paddingLeft",
  "paddingTop",
  "paddingBottom",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textTransform",
  "letterSpacing",
  "color",
  "backgroundColor",
];

function copyPresentation(cell, cache, key) {
  if (cache.has(key)) return cache.get(key);
  const style = readPresentation(cell);
  cache.set(key, style);
  return style;
}

function readPresentation(cell) {
  if (
    !cell ||
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  )
    return {};
  const computed = window.getComputedStyle(cell);
  const out = {};
  for (const prop of COPIED_STYLE_PROPS) {
    const value = computed[prop];
    if (value) out[prop] = value;
  }
  return out;
}

function measureGrid(container, styleCache) {
  const containerTop = container.getBoundingClientRect().top;
  const scrollTop = container.scrollTop;
  const toContentY = (clientY) => clientY - containerTop + scrollTop;

  const head = container.querySelector("[data-statement-header]");
  const headRows = head
    ? Array.from(head.rows || head.querySelectorAll(":scope > tr"))
    : [];
  const headRowHeights = headRows.map(
    (row) => row.getBoundingClientRect().height,
  );
  const headerHeight = headRowHeights.reduce((sum, h) => sum + h, 0);

  const rows = Array.from(
    container.querySelectorAll(
      "[data-statement-heading], [data-statement-total]",
    ),
  );
  const markers = rows.map((row, index) => {
    const rect = row.getBoundingClientRect();
    const cell = row.firstElementChild;
    const heading = row.hasAttribute("data-statement-heading");
    const key =
      row.getAttribute(
        heading ? "data-statement-heading" : "data-statement-total",
      ) || `row-${index}`;
    return {
      key,
      kind: heading ? "heading" : "total",
      label:
        row.getAttribute("data-statement-label") ||
        (cell ? cell.textContent : ""),
      depth: Number(row.getAttribute("data-statement-depth")) || 0,
      top: toContentY(rect.top),
      height: rect.height,
      style: heading ? copyPresentation(cell, styleCache, key) : null,
    };
  });

  return {
    headerHeight,
    headRowHeights,
    markers,
    contentHeight: container.scrollHeight,
    viewportHeight: container.clientHeight,
  };
}

export default function StatementStickyGrid({
  children,
  theme = {},
  maxHeight = "72vh",
  maxStackFraction,
  onLeadingColumnChange,
  style,
  ...rest
}) {
  const scrollRef = React.useRef(null);
  const leadingRef = React.useRef(null);
  const styleCacheRef = React.useRef(new Map());
  const openedAtCurrentMonthRef = React.useRef(false);
  const headerRef = React.useRef(0);
  const frameRef = React.useRef(0);
  const [stack, setStack] = React.useState([]);
  const [headerHeight, setHeaderHeight] = React.useState(0);
  const themeKey = `${theme.border}|${theme.subtle}|${theme.cardBg}`;

  const recompute = React.useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const measured = measureGrid(container, styleCacheRef.current);
    if (measured.headerHeight !== headerRef.current) {
      headerRef.current = measured.headerHeight;
      container.style.setProperty(
        STATEMENT_HEADER_ROW_VAR,
        `${measured.headRowHeights[0] || 0}px`,
      );
      container.style.setProperty(
        STATEMENT_HEADER_BLOCK_VAR,
        `${measured.headerHeight}px`,
      );
      setHeaderHeight(measured.headerHeight);
    }
    const next = pinnedHeadingStack({
      markers: measured.markers,
      scrollTop: container.scrollTop,
      headerHeight: measured.headerHeight,
      viewportHeight: measured.viewportHeight,
      contentHeight: measured.contentHeight,
      ...(maxStackFraction != null ? { maxStackFraction } : null),
    });
    setStack((prev) =>
      sameStack(prev, next) ? prev : next.map(withStyle(measured)),
    );
    if (onLeadingColumnChange) {
      const cells = Array.from(
        container.querySelectorAll("[data-statement-column]"),
      );
      const leading = leadingVisibleColumn({
        columns: cells.map((cell) => ({
          key: cell.getAttribute("data-statement-column"),
          left: cell.offsetLeft,
          width: cell.offsetWidth,
        })),
        scrollLeft: container.scrollLeft,
        frozenWidth: frozenWidthBefore(cells[0] || null),
        maxScrollLeft: container.scrollWidth - container.clientWidth,
      });
      if (leading !== leadingRef.current) {
        leadingRef.current = leading;
        onLeadingColumnChange(leading);
      }
    }
  }, [maxStackFraction, onLeadingColumnChange]);

  const onScroll = React.useCallback(() => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      recompute();
      return;
    }
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      recompute();
    });
  }, [recompute]);

  const scrollToCurrentMonth = React.useCallback(() => {
    if (openedAtCurrentMonthRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector("[data-statement-current-month]");
    if (!target) return;
    openedAtCurrentMonthRef.current = true;
    container.scrollLeft = Math.max(
      0,
      target.offsetLeft - frozenWidthBefore(target),
    );
  }, []);

  React.useEffect(() => {
    styleCacheRef.current = new Map();
    scrollToCurrentMonth();
    recompute();
  }, [themeKey, recompute, scrollToCurrentMonth]);

  React.useEffect(() => {
    scrollToCurrentMonth();
    recompute();
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    const table = container.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [recompute, scrollToCurrentMonth, children]);

  const band = theme.subtle || theme.cardBg || "transparent";

  return (
    <div
      style={{
        position: "relative",
        border: theme.border ? `1px solid ${theme.border}` : undefined,
        borderRadius: 8,
        overflow: "hidden",
        ...style,
      }}
      data-statement-grid=""
      {...rest}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-statement-scroller=""
        style={{ ...scrollContainerStyle(maxHeight) }}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        data-statement-heading-stack=""
        style={{
          position: "absolute",
          top: headerHeight,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {stack.map((entry, index) => (
          <div
            key={entry.key}
            data-statement-pinned-heading={entry.key}
            style={{
              position: "absolute",
              top: entry.top - headerHeight,
              left: 0,
              right: 0,
              height: entry.height,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              backgroundColor: band,
              borderBottom: theme.border
                ? `1px solid ${theme.border}`
                : undefined,
              zIndex: 2 + index,
              ...entry.style,
            }}
          >
            {entry.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function withStyle(measured) {
  const byKey = new Map(
    measured.markers
      .filter((m) => m.kind === "heading")
      .map((m) => [m.key, m.style]),
  );
  return (entry) => ({ ...entry, style: byKey.get(entry.key) || {} });
}

function sameStack(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].key !== b[i].key ||
      a[i].top !== b[i].top ||
      a[i].height !== b[i].height
    )
      return false;
  }
  return true;
}
