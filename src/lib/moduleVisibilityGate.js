export const MODULE_VISIBILITY_GATE_TIMEOUT_MS = 12000;

export function moduleVisibilityGateState({
  hasProfile,
  orgId,
  loading,
  error,
  timedOut,
} = {}) {
  if (!hasProfile) return "no-profile";
  if (error) return "error";
  if (!orgId) return "ready";
  if (!loading) return "ready";
  return timedOut ? "error" : "loading";
}

export function isModuleVisibilityReady(state) {
  return moduleVisibilityGateState(state) === "ready";
}

export const GATE_STATES = Object.freeze([
  "no-profile",
  "loading",
  "error",
  "ready",
]);

export const TERMINAL_GATE_STATES = Object.freeze(["no-profile", "error"]);

export function gateStateNeedsExit(state) {
  return TERMINAL_GATE_STATES.includes(state);
}

export function blockedPlan(reason) {
  return {
    kind: "blocked",
    reason,
    spinner: false,
    affordances: ["retry", "signOut"],
  };
}

function waitingPlan(reason) {
  return { kind: "waiting", reason, spinner: true, affordances: [] };
}

function proceedPlan() {
  return { kind: "shell", reason: null, spinner: false, affordances: [] };
}

export function shellRenderPlan({ gateState, dataReady, timedOut } = {}) {
  if (gateState === "no-profile") return blockedPlan("no-profile");
  if (gateState === "error") return blockedPlan("curation-unavailable");

  const stillWaiting = gateState !== "ready" || !dataReady;
  if (stillWaiting) {
    if (timedOut) return blockedPlan("timeout");
    return waitingPlan(dataReady ? "curation" : "data");
  }
  return proceedPlan();
}

export function gateStateIsUnescapable(state) {
  if (state === "ready") return false;
  if (gateStateNeedsExit(state)) return false;
  if (state === "loading") {
    const afterTimeout = moduleVisibilityGateState({
      hasProfile: true,
      orgId: "any",
      loading: true,
      error: null,
      timedOut: true,
    });
    return afterTimeout === "loading";
  }
  return true;
}

export const AUTH_RESOLVE_TIMEOUT_MS = MODULE_VISIBILITY_GATE_TIMEOUT_MS;

export const APP_SHELL_STATES = Object.freeze([
  "loading",
  "login",
  "recovery",
  "mfa_enroll_required",
  "password_change_required",
  "profile_unavailable",
  "authenticated",
]);

export const APP_SHELL_EXIT_KINDS = Object.freeze([
  "planner",
  "screen",
  "form",
]);

export const REQUIRED_FORM_RESET_OUTCOMES = Object.freeze([
  "signed-in",
  "bad-credentials",
  "error",
  "threw",
  "timed-out",
]);

export const APP_SHELL_STATE_EXITS = Object.freeze({
  loading: Object.freeze({ kind: "planner" }),
  profile_unavailable: Object.freeze({ kind: "planner" }),
  authenticated: Object.freeze({ kind: "planner", handoff: "shellRenderPlan" }),
  login: Object.freeze({
    kind: "form",
    screen: "LoginPage",
    boundedByMs: 20000,
    resetsOn: REQUIRED_FORM_RESET_OUTCOMES,
  }),
  recovery: Object.freeze({
    kind: "screen",
    screen: "PasswordRecoveryScreen",
    exitProp: "onSignOut",
  }),
  mfa_enroll_required: Object.freeze({
    kind: "screen",
    screen: "MfaEnrollmentRequiredScreen",
    exitProp: "onSignOut",
  }),
  password_change_required: Object.freeze({
    kind: "screen",
    screen: "ForcedPasswordChangeScreen",
    exitProp: "onSignOut",
  }),
});

export const PROFILE_UNAVAILABLE_REASONS = Object.freeze([
  "profile-unavailable",
  "profile-unavailable-partial",
  "assurance-unavailable",
]);

export function appShellWaitPlan({ authState, timedOut, blockedReason } = {}) {
  if (authState === "loading") {
    return timedOut ? blockedPlan("auth-timeout") : waitingPlan("auth");
  }
  if (authState === "profile_unavailable") {
    return blockedPlan(
      PROFILE_UNAVAILABLE_REASONS.includes(blockedReason)
        ? blockedReason
        : "profile-unavailable",
    );
  }
  return proceedPlan();
}

export function appShellStateIsUnescapable(
  state,
  registry = APP_SHELL_STATE_EXITS,
  gateChecker = gateStateIsUnescapable,
) {
  if (!APP_SHELL_STATES.includes(state)) return true;
  const exit = registry[state];
  if (!exit || !APP_SHELL_EXIT_KINDS.includes(exit.kind)) return true;

  if (exit.kind === "screen") {
    return typeof exit.exitProp !== "string" || exit.exitProp.length === 0;
  }

  if (exit.kind === "form") {
    const bounded = Number.isFinite(exit.boundedByMs) && exit.boundedByMs > 0;
    const resets =
      Array.isArray(exit.resetsOn) &&
      REQUIRED_FORM_RESET_OUTCOMES.every((o) => exit.resetsOn.includes(o));
    return !(bounded && resets);
  }

  if (exit.handoff === "shellRenderPlan") {
    return GATE_STATES.some((g) => gateChecker(g));
  }
  const now = appShellWaitPlan({ authState: state, timedOut: false });
  if (now.kind === "shell") return false;
  if (now.kind === "blocked") return now.affordances.length === 0;
  const afterWatchdog = appShellWaitPlan({ authState: state, timedOut: true });
  return afterWatchdog.kind === "waiting";
}
