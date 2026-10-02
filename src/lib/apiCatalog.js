import { load as loadYaml } from "js-yaml";
import entrataYamlRaw from "./catalogs/entrata.yaml?raw";

let cachedCatalogs = null;

function loadCatalogs() {
  if (cachedCatalogs) return cachedCatalogs;
  const catalogs = {
    entrata: loadYaml(entrataYamlRaw),
  };
  cachedCatalogs = Object.freeze(catalogs);
  return cachedCatalogs;
}

export function getCatalog(vendor) {
  const catalogs = loadCatalogs();
  return catalogs[vendor] || null;
}

export function getApis(vendor) {
  const cat = getCatalog(vendor);
  return cat?.endpoints || [];
}

export function getApi(vendor, endpointName) {
  if (!endpointName) return null;
  const apis = getApis(vendor);
  return apis.find((e) => e.endpoint_name === endpointName) || null;
}

export function getApisByUseCase(vendor, useCaseTag) {
  if (!useCaseTag) return [];
  const apis = getApis(vendor);
  return apis.filter(
    (e) => Array.isArray(e.use_cases) && e.use_cases.includes(useCaseTag),
  );
}

export function getApisByGroup(vendor, group) {
  if (!group) return [];
  const apis = getApis(vendor);
  return apis.filter((e) => e.endpoint_group === group);
}

export function getApisBySyncStatus(vendor, status) {
  if (!status) return [];
  const apis = getApis(vendor);
  return apis.filter((e) => e.sync_status === status);
}

export function searchApis(vendor, query, { excludeWrites = false } = {}) {
  const apis = getApis(vendor);
  const source = excludeWrites ? apis.filter((e) => e.is_write !== true) : apis;
  if (!query || !String(query).trim()) return source;
  const q = String(query).trim().toLowerCase();
  return source.filter((e) => {
    const haystack = [
      e.endpoint_name,
      e.vendor_method,
      e.endpoint_group,
      e.plain_english_description,
      e.response_shape_summary,
      Array.isArray(e.use_cases) ? e.use_cases.join(" ") : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function getWriteMethods(vendor) {
  const apis = getApis(vendor);
  return apis
    .filter((e) => e.is_write === true && e.vendor_method)
    .map((e) => e.vendor_method);
}

export function listEndpointGroups(vendor) {
  const apis = getApis(vendor);
  const groups = new Set();
  for (const e of apis) if (e.endpoint_group) groups.add(e.endpoint_group);
  return [...groups].sort();
}

export function listUseCases(vendor) {
  const apis = getApis(vendor);
  const tags = new Set();
  for (const e of apis) {
    if (Array.isArray(e.use_cases)) for (const t of e.use_cases) tags.add(t);
  }
  return [...tags].sort();
}

export function listSyncStatuses(vendor) {
  const apis = getApis(vendor);
  const statuses = new Set();
  for (const e of apis) if (e.sync_status) statuses.add(e.sync_status);
  return [...statuses].sort();
}

export function getCatalogMeta(vendor) {
  const cat = getCatalog(vendor);
  if (!cat) return null;
  return {
    vendor: cat.vendor,
    schema_version: cat.schema_version,
    last_reviewed: cat.last_reviewed,
    auth: cat.auth,
    rate_limits: cat.rate_limits,
    request_envelope: cat.request_envelope,
    endpoint_count: cat.endpoints?.length || 0,
  };
}

export function getEntrataApis() {
  return getApis("entrata");
}

export function getEntrataApi(endpointName) {
  return getApi("entrata", endpointName);
}

export function getEntrataApisByUseCase(useCaseTag) {
  return getApisByUseCase("entrata", useCaseTag);
}

export function getEntrataApisByGroup(group) {
  return getApisByGroup("entrata", group);
}

export function getEntrataApisBySyncStatus(status) {
  return getApisBySyncStatus("entrata", status);
}

export function searchEntrataApis(query, options = {}) {
  return searchApis("entrata", query, options);
}

export function listEntrataWriteMethods() {
  return getWriteMethods("entrata");
}

export function getEntrataMeta() {
  return getCatalogMeta("entrata");
}

export function listEntrataEndpointGroups() {
  return listEndpointGroups("entrata");
}

export function listEntrataUseCases() {
  return listUseCases("entrata");
}

export function listEntrataSyncStatuses() {
  return listSyncStatuses("entrata");
}
