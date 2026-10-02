import { useCallback, useRef, useState } from "react";

export const SIGN_OUT_STATES = Object.freeze(["idle", "pending", "failed"]);

export const SIGN_OUT_FAILED_COPY =
  "Sign out did not complete — the server did not confirm your session was revoked. " +
  "Reloading clears this session from the browser; if you are on a shared machine, " +
  "close the browser afterwards.";

export default function useSignOutAction(
  onSignOut,
  { idleLabel = "Sign out" } = {},
) {
  const [state, setState] = useState("idle");
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState("pending");
    try {
      await onSignOut?.();
      setState("idle");
    } catch {
      setState("failed");
    } finally {
      inFlight.current = false;
    }
  }, [onSignOut]);

  return {
    state,
    run,
    label: state === "pending" ? "Signing out..." : idleLabel,
    isPending: state === "pending",
    isFailed: state === "failed",
  };
}
