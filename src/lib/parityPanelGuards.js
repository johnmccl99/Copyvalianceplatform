export const PARITY_PANEL_GUARD_STATES = Object.freeze({
  LOADING: "loading",
  ERROR: "error",
  INITIALIZING: "initializing",
  EMPTY: "empty",
  READY: "ready",
});

export function selectParityPanelGuardState({ loadingInputs, inputs, error }) {
  if (loadingInputs) return PARITY_PANEL_GUARD_STATES.LOADING;
  if (!inputs && error) return PARITY_PANEL_GUARD_STATES.ERROR;
  if (!inputs) return PARITY_PANEL_GUARD_STATES.INITIALIZING;
  if (inputs.length === 0) return PARITY_PANEL_GUARD_STATES.EMPTY;
  return PARITY_PANEL_GUARD_STATES.READY;
}
