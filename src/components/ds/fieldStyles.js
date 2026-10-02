import { T } from "../../lib/theme.js";

export const FIELD_SIZES = Object.freeze({
  sm: { padding: "6px 8px", fontSize: T.textDense, radius: T.radius },
  md: { padding: "8px 12px", fontSize: T.textBody, radius: T.radius },
  lg: { padding: "10px 12px", fontSize: T.textEmphasis, radius: T.radiusLg },
});

export function fieldStyle({
  size = "md",
  disabled = false,
  fullWidth = false,
} = {}) {
  const s = FIELD_SIZES[size] || FIELD_SIZES.md;
  return {
    width: fullWidth ? "100%" : undefined,
    padding: s.padding,
    fontSize: s.fontSize,
    fontFamily: "inherit",
    lineHeight: 1.4,
    color: T.textPrimary,
    background: disabled ? T.inset : T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: s.radius,
    boxSizing: "border-box",
    opacity: disabled ? 0.6 : 1,
  };
}

export function fieldLabelStyle() {
  return {
    display: "block",
    fontSize: T.textDense,
    fontWeight: 600,
    color: T.textSecondary,
    marginBottom: 6,
  };
}
