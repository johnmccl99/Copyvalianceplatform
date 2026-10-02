import React from "react";
import {
  stickyBandLabelStyle,
  stickyDrawerContentStyle,
  STICKY_BAND_LABEL_SCROLLPORT_VAR,
} from "./tableStyles.js";

function nearestHorizontalScroller(node) {
  let el = node?.parentElement;
  while (el && el !== document.body) {
    const overflowX = window.getComputedStyle(el).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

function publishScrollportWidth(scroller) {
  scroller.style.setProperty(
    STICKY_BAND_LABEL_SCROLLPORT_VAR,
    `${scroller.clientWidth}px`,
  );
}

const observers = new WeakMap();

function trackScrollportWidth(node) {
  if (!node || typeof window === "undefined") return;
  const scroller = nearestHorizontalScroller(node);
  if (!scroller) return;
  publishScrollportWidth(scroller);
  if (observers.has(scroller) || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => publishScrollportWidth(scroller));
  observer.observe(scroller);
  observers.set(scroller, observer);
}

export default function StatementBandLabel({ label, leftPad = 12 }) {
  return React.createElement(
    "span",
    { ref: trackScrollportWidth, style: stickyBandLabelStyle(leftPad) },
    label,
  );
}

export function StatementStickyDrawer({ children, leftPad = 12 }) {
  return React.createElement(
    "div",
    { ref: trackScrollportWidth, style: stickyDrawerContentStyle(leftPad) },
    children,
  );
}
