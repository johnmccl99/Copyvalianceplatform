export const COMPOSER_DATE_MDY_TOKENS = [
  { value: "${today:MM/DD/YYYY}", label: "Today" },
  { value: "${today_minus_7:MM/DD/YYYY}", label: "Today minus 7 days" },
  { value: "${today_minus_30:MM/DD/YYYY}", label: "Today minus 30 days" },
  { value: "${today_minus_90:MM/DD/YYYY}", label: "Today minus 90 days" },
  { value: "${today_first_of_month:MM/DD/YYYY}", label: "First of this month" },
  { value: "${today_first_of_year:MM/DD/YYYY}", label: "First of this year" },
  {
    value: "${last_full_month_start:MM/DD/YYYY}",
    label: "Start of last full month",
  },
  {
    value: "${last_full_month_end:MM/DD/YYYY}",
    label: "End of last full month",
  },
];

export function classifyComposerParamValue(value) {
  if (value == null) return { kind: "literal", value };
  if (typeof value !== "string") return { kind: "literal", value };
  if (value === "${entrata_property_id}") return { kind: "auto_property_id" };
  if (/^\$\{[a-z0-9_]+(?::[A-Za-z0-9/-]+)?\}/i.test(value))
    return { kind: "computed_template", value };
  const placeholderMatch = value.match(/^\{([^}]+)\}$/);
  if (placeholderMatch) {
    const tok = placeholderMatch[1];
    if (/^MM\/DD\/YYYY$/i.test(tok)) return { kind: "date_mdy" };
    if (/^MM\/YYYY$/i.test(tok)) return { kind: "date_my" };
    if (/^YYYY$/i.test(tok)) return { kind: "date_y" };
    if (/_csv$/i.test(tok)) return { kind: "id_csv", placeholder: tok };
    if (tok === "property_id") return { kind: "auto_property_id" };
    return { kind: "id", placeholder: tok };
  }
  if (/^-?\d+(?:[,.]\d+)*$/.test(value) || /^\d+(?:,\d+)+$/.test(value)) {
    return { kind: "example", value };
  }
  return { kind: "literal", value };
}

export function composerEndpointSupportsPagination(ep) {
  const tmpl = ep?.request_body_template;
  if (!tmpl || typeof tmpl !== "object") return false;
  return tmpl.page_no != null || tmpl.per_page != null;
}

export function initComposerStepConfig(ep) {
  const seededParams = ep?.request_body_template?.method?.params || {};
  const params = {};
  for (const [k, v] of Object.entries(seededParams)) {
    if (typeof v === "string" && /^\{property_id\}$/.test(v)) {
      params[k] = "${entrata_property_id}";
    } else {
      params[k] = v;
    }
  }
  if (Array.isArray(ep?.use_cases) && !("propertyId" in params)) {
    params.propertyId = "${entrata_property_id}";
  }
  let pagination = null;
  if (composerEndpointSupportsPagination(ep)) {
    const catalogPerPage = ep.request_body_template.per_page;
    pagination = {
      page_no: 1,
      per_page:
        typeof catalogPerPage === "number" && catalogPerPage > 0
          ? catalogPerPage
          : 500,
      iterate_all_pages: false,
    };
  }
  return { params, pagination };
}

export function buildComposerEndpointChain({
  selected,
  stepConfigs,
  getEpFn,
  versionFragmentFn,
}) {
  const steps = Array.from(selected)
    .map((endpointName, i) => {
      const ep = getEpFn(endpointName);
      if (!ep) return null;
      const gatewayUrl = ep.gateway_url_template || "";
      const gatewayPath =
        gatewayUrl.replace(/^https?:\/\/[^/]+\/ext\/orgs\/\{subdomain\}/, "") ||
        "/v1";
      const cfg = stepConfigs?.[endpointName] || initComposerStepConfig(ep);
      const params = {};
      for (const [k, v] of Object.entries(cfg.params || {})) {
        if (v == null) continue;
        params[k] = v;
      }
      const step = {
        step_id: `step_${i + 1}`,
        endpoint_name: ep.endpoint_name,
        endpoint_group: ep.endpoint_group,
        vendor_method: ep.vendor_method,
        ...(versionFragmentFn ? versionFragmentFn(ep) : {}),
        gateway_path_template: gatewayPath,
        http_method: ep.http_method || "POST",
        params,
        depends_on: [],
      };
      if (cfg.pagination) step.pagination = cfg.pagination;
      return step;
    })
    .filter(Boolean);
  return { version: 2, steps };
}
