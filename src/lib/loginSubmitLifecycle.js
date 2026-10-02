export const LOGIN_SUBMIT_TIMEOUT_MS = 20000;

export const LOGIN_SUBMIT_OUTCOMES = Object.freeze([
  "signed-in",
  "mfa-required",
  "locked",
  "bad-credentials",
  "error",
  "threw",
  "timed-out",
]);

export const LOGIN_TIMEOUT_MESSAGE =
  "Sign-in is taking longer than expected and the platform stopped waiting rather than " +
  "leaving you on a disabled button. Check your connection and try again — if you were " +
  "signed in successfully, reloading the page will take you to your workspace.";

export const LOGIN_THREW_MESSAGE =
  "We could not reach the sign-in service. Check your connection and try again.";

export function nextLoginSubmitState(outcome, detail = {}) {
  const base = {
    status: "idle",
    errorMsg: "",
    mode: null,
    clearPassword: false,
    mfaFactorId: null,
  };

  switch (outcome) {
    case "signed-in":
      return { ...base, status: "idle" };

    case "mfa-required":
      return {
        ...base,
        status: "idle",
        mode: "mfa-challenge",
        mfaFactorId: detail.mfaFactorId ?? null,
      };

    case "locked": {
      const mins = Math.max(1, Math.ceil((detail.unlockInSeconds || 0) / 60));
      return {
        ...base,
        status: "error",
        errorMsg:
          `This account is temporarily locked due to repeated failed sign-in attempts. ` +
          `Try again in ${mins} minute${mins === 1 ? "" : "s"}, or contact an administrator to unlock it.`,
        clearPassword: true,
      };
    }

    case "bad-credentials":
      return {
        ...base,
        status: "error",
        errorMsg:
          detail.attemptsRemaining != null && detail.attemptsRemaining > 0
            ? `Incorrect email or password. ${detail.attemptsRemaining} attempt${detail.attemptsRemaining === 1 ? "" : "s"} remaining before lockout.`
            : "Incorrect email or password.",
      };

    case "error":
      return {
        ...base,
        status: "error",
        errorMsg: detail.message || "Sign in failed.",
      };

    case "threw":
      return { ...base, status: "error", errorMsg: LOGIN_THREW_MESSAGE };

    case "timed-out":
      return { ...base, status: "error", errorMsg: LOGIN_TIMEOUT_MESSAGE };

    default:
      return {
        ...base,
        status: "error",
        errorMsg: detail.message || "Sign in failed.",
      };
  }
}

export function classifySignInResult(res = {}) {
  const { error, requiresMfa, mfaFactorId, locked } = res;
  if (error) {
    if (locked) return "locked";
    if (error.message === "Invalid login credentials") return "bad-credentials";
    return "error";
  }
  if (requiresMfa && mfaFactorId) return "mfa-required";
  return "signed-in";
}

export function withLoginTimeout(
  promise,
  ms = LOGIN_SUBMIT_TIMEOUT_MS,
  { setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimer(() => {
      if (settled) return;
      settled = true;
      resolve({ outcome: "timed-out", result: null, error: null });
    }, ms);
    Promise.resolve(promise).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimer(t);
        resolve({
          outcome: classifySignInResult(result || {}),
          result: result || {},
          error: null,
        });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(t);
        resolve({ outcome: "threw", result: null, error });
      },
    );
  });
}
