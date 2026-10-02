export function readCatalogMethodVersion(ep) {
  const v = ep?.request_body_template?.method?.version;
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

export function vendorMethodVersionFragment(ep) {
  const v = readCatalogMethodVersion(ep);
  return v ? { vendor_method_version: v } : {};
}

export function resolveStepMethodVersion(step) {
  const v = step?.vendor_method_version;
  if (typeof v !== "string") return "r1";
  const s = v.trim();
  return s || "r1";
}
