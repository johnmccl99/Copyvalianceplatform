const state = {
  byOrg: new Map(),
  listeners: new Set(),
};

const EMPTY = new Set();

function emit() {
  for (const listener of state.listeners) listener();
}

export function getHidden(orgId) {
  if (!orgId) return EMPTY;
  return state.byOrg.get(orgId) || EMPTY;
}

export function subscribe(listener) {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function setHidden(orgId, hiddenSet) {
  if (!orgId) return;
  state.byOrg.set(orgId, new Set(hiddenSet || []));
  emit();
}

export function toggleLocal(orgId, key, nextVisible) {
  if (!orgId) return EMPTY;
  const prev = state.byOrg.get(orgId) || EMPTY;
  const next = new Set(prev);
  if (nextVisible) next.delete(key);
  else next.add(key);
  state.byOrg.set(orgId, next);
  emit();
  return prev;
}
