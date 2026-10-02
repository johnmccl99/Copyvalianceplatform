import {
  filterNavSectionsByRole,
  filterNavSectionsByVisibility,
  flattenNavItems,
  PROPERTIES_SECTION_LABEL,
  CURRENT_PORTFOLIO_BUCKET_LABEL,
  PIPELINE_ACQUISITIONS_NAV_KEY,
  PIPELINE_DISPOSITIONS_NAV_KEY,
} from "./navSections.js";

export const PROPERTY_NAV_KEY_PREFIX = "prop_";

export function propertyNavKey(name) {
  return (
    PROPERTY_NAV_KEY_PREFIX +
    String(name || "")
      .replace(/\s+/g, "-")
      .toLowerCase()
  );
}

function propertyItem(p) {
  return {
    key: propertyNavKey(p.name),
    label: p.name,
    propertyType: p.type,
  };
}

export function buildPropertyBuckets({
  properties = [],
  pipeline = [],
  dispositionPipeline = [],
} = {}) {
  return [
    {
      label: "Active Acquisitions",
      key: PIPELINE_ACQUISITIONS_NAV_KEY,
      items: pipeline.map(propertyItem),
    },
    {
      label: CURRENT_PORTFOLIO_BUCKET_LABEL,
      items: properties.map(propertyItem),
    },
    {
      label: "Active Dispositions",
      key: PIPELINE_DISPOSITIONS_NAV_KEY,
      items: dispositionPipeline.map(propertyItem),
    },
  ];
}

export function buildPropertyNavCarrier(sources) {
  return {
    label: PROPERTIES_SECTION_LABEL,
    type: "portfolio",
    subBuckets: buildPropertyBuckets(sources),
  };
}

export function propertyNavItems(sources, opts = {}) {
  const { role, isAdmin = false, hiddenKeys } = opts;
  const carrier = [buildPropertyNavCarrier(sources)];
  const roleScoped = filterNavSectionsByRole(carrier, role, { isAdmin });
  const visibilityScoped = filterNavSectionsByVisibility(
    roleScoped,
    hiddenKeys || [],
  );
  return flattenNavItems(visibilityScoped).filter(
    (i) =>
      i &&
      typeof i.key === "string" &&
      i.key.startsWith(PROPERTY_NAV_KEY_PREFIX),
  );
}
