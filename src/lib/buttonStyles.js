import { T, alpha } from "./theme.js";

export const BUTTON_SIZES = Object.freeze({
  sm: { padding: "6px 14px", fontSize: T.textDense, radius: T.radius },
  md: { padding: "8px 16px", fontSize: T.textBody, radius: T.radiusLg },
  lg: { padding: "9px 24px", fontSize: T.textBody, radius: T.radiusLg },
});

export const BUTTON_ROLES = Object.freeze([
  "primary",
  "secondary",
  "ghost",
  "add",
]);
export const BUTTON_SIZE_KEYS = Object.freeze(["sm", "md", "lg"]);

function roleStyle(role, hover) {
  switch (role) {
    case "primary":
      return {
        background: T.accentFill,
        color: T.accentFillText,
        border: "none",
        fontWeight: 700,
      };
    case "secondary":
      return {
        background: hover ? T.hover : "transparent",
        color: T.textPrimary,
        border: `1px solid ${T.border}`,
        fontWeight: 600,
      };
    case "ghost":
      return {
        background: hover ? T.hover : "transparent",
        color: T.textSecondary,
        border: `1px solid ${T.border}`,
        fontWeight: 500,
      };
    case "add":
      return {
        background: hover ? alpha(T.accent, 7.1) : alpha(T.accent, 2.4),
        color: T.accent,
        border: `1px solid ${alpha(T.accent, 18.8)}`,
        fontWeight: 600,
      };
    default:
      return roleStyle("secondary", hover);
  }
}

export function btn({
  role = "secondary",
  size = "md",
  hover = false,
  busy = false,
  disabled = false,
} = {}) {
  const s = BUTTON_SIZES[size] || BUTTON_SIZES.md;
  const inactive = busy || disabled;
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: s.padding,
    fontSize: s.fontSize,
    borderRadius: s.radius,
    fontFamily: "inherit",
    lineHeight: 1.2,
    cursor: inactive ? "not-allowed" : "pointer",
    transition: "all 0.15s",
    opacity: inactive ? 0.65 : 1,
    ...roleStyle(role, hover && !inactive),
  };
}

export default btn;
