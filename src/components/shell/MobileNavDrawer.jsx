import React, { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function MobileNavDrawer({
  isMobile,
  open,
  onClose,
  closeKey,
  children,
  id = "primary-nav-drawer",
  label = "Navigation menu",
}) {
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const firstCloseKeyRender = useRef(true);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (firstCloseKeyRender.current) {
      firstCloseKeyRender.current = false;
      return;
    }
    if (openRef.current) onCloseRef.current?.();
  }, [closeKey]);

  useEffect(() => {
    if (!isMobile || !open) return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;

    restoreFocusRef.current =
      typeof document !== "undefined" ? document.activeElement : null;

    const getFocusable = () =>
      Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR));
    const initial = getFocusable();
    (initial[0] || panel).focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const list = getFocusable();
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

    panel.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      const opener = restoreFocusRef.current;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, [isMobile, open]);

  if (!isMobile) return <>{children}</>;

  return (
    <>
      <div
        onClick={() => onCloseRef.current?.()}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1090,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s ease",
        }}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        inert={open ? undefined : true}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "100vh",
          zIndex: 1100,
          display: "flex",
          outline: "none",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: open ? "0 0 40px rgba(0,0,0,0.35)" : "none",
        }}
      >
        {children}
      </div>
    </>
  );
}
