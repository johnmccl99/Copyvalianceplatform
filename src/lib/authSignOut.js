export class SignOutIncompleteError extends Error {
  constructor(cause) {
    super(
      "Sign out did not complete: the server did not confirm the session was revoked.",
    );
    this.name = "SignOutIncompleteError";
    this.cause = cause ?? null;
  }
}

export const SIGN_OUT_INCOMPLETE_NOTICE =
  "You were signed out on this device, but the server did not confirm that your session " +
  "was revoked, so it may still be active elsewhere. If you are on a shared or public " +
  "machine, close the browser now and sign in again to force a fresh session.";

export async function performSignOut(deps = {}) {
  const {
    signOut,
    setSession,
    setUserProfile,
    setAuthState,
    onSignedOut,
    onError = (msg, err) => console.error(msg, err ?? ""),
  } = deps;

  let remoteError = null;
  if (typeof signOut !== "function") {
    remoteError = new Error("no signOut implementation supplied");
  } else {
    try {
      const res = await signOut();
      if (res && res.error) remoteError = res.error;
    } catch (e) {
      remoteError = e;
    }
  }

  if (typeof setSession === "function") setSession(null);
  if (typeof setUserProfile === "function") setUserProfile(null);
  if (typeof onSignedOut === "function") {
    onSignedOut(remoteError ? SIGN_OUT_INCOMPLETE_NOTICE : null);
  }
  if (typeof setAuthState === "function") setAuthState("login");

  if (remoteError) {
    onError(
      "[auth] sign-out did not complete remotely — local session cleared:",
      remoteError?.message || remoteError,
    );
    throw new SignOutIncompleteError(remoteError);
  }
}
