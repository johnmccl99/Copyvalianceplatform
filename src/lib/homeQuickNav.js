import { PROTECTED_SURFACE_KEYS } from "./navSections.js";

export const QUICK_NAV_CARDS = [
  { label: "Asset Management", tab: "asset" },
  { label: "Budget", section: "Budget Consolidation" },
  { label: "Action Items", tab: "actions" },
];

const FULL_NAV_ROLES = new Set(["gp", "admin"]);

export function roleAllowsQuickNavKey(role, navKey) {
  if (typeof role !== "string" || role === "") return false;
  return FULL_NAV_ROLES.has(role);
}

export function isHomeNavTargetAvailable(role, hiddenNavKeys, navKey) {
  if (!roleAllowsQuickNavKey(role, navKey)) return false;
  if (PROTECTED_SURFACE_KEYS.has(navKey)) return true;
  if (!hiddenNavKeys || typeof hiddenNavKeys.has !== "function") return true;
  return !hiddenNavKeys.has(navKey);
}

export function visibleQuickNavCards(
  role,
  hiddenNavKeys,
  cards = QUICK_NAV_CARDS,
  visibleSections,
) {
  const sectionsKnown = Array.isArray(visibleSections);
  const sectionLabels = sectionsKnown
    ? new Set(visibleSections.map((s) => s && s.label).filter(Boolean))
    : null;

  return cards.filter((card) => {
    if (card.section) return !sectionsKnown || sectionLabels.has(card.section);
    return isHomeNavTargetAvailable(role, hiddenNavKeys, card.tab);
  });
}
