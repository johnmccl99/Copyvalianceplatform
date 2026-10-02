export const CONSTRUCTION_DRAW_GUARD_STATES = Object.freeze({
  INITIALIZING: "initializing",
  EMPTY: "empty",
  READY: "ready",
});

export function selectConstructionDrawState(project) {
  if (!project) return CONSTRUCTION_DRAW_GUARD_STATES.INITIALIZING;
  if (!Array.isArray(project.draws) || project.draws.length === 0) {
    return CONSTRUCTION_DRAW_GUARD_STATES.EMPTY;
  }
  return CONSTRUCTION_DRAW_GUARD_STATES.READY;
}

export function safeProjectDraws(project) {
  if (!project) return [];
  return Array.isArray(project.draws) ? project.draws : [];
}
