export const PROFILE_ADMISSION = Object.freeze({
  ADMITTED: "admitted",
  ABSENT: "absent",
  UNAVAILABLE: "unavailable",
});

export const NO_PROFILE_SIGNOUT_NOTICE =
  "You were signed out because your workspace profile could not be read for this account. " +
  "That usually means an invitation was never completed or the account was removed from " +
  "its organization, but it can also mean your access permissions changed. Ask an " +
  "administrator to check your account before re-requesting an invitation.";

export function lookupFailed(res) {
  if (!res) return false;
  const err = res.error;
  if (!err) return false;
  if (err.code === "PGRST116") return false;
  return true;
}

export function admissionOutcome({
  profile,
  idResult,
  emailResult,
  threw,
} = {}) {
  return admissionDetail({ profile, idResult, emailResult, threw }).outcome;
}

export function admissionDetail({
  profile,
  idResult,
  emailResult,
  threw,
} = {}) {
  if (profile) return { outcome: PROFILE_ADMISSION.ADMITTED, reason: null };

  const idFailed = lookupFailed(idResult);
  const emailFailed = lookupFailed(emailResult);
  const cleanMiss = (res) => !!res && !lookupFailed(res) && !res.profile;

  if (threw) return { outcome: PROFILE_ADMISSION.UNAVAILABLE, reason: "threw" };
  if (idFailed || emailFailed) {
    const partial =
      (idFailed && cleanMiss(emailResult)) ||
      (emailFailed && cleanMiss(idResult));
    return {
      outcome: PROFILE_ADMISSION.UNAVAILABLE,
      reason: partial ? "read-failed-partial" : "read-failed",
    };
  }
  return { outcome: PROFILE_ADMISSION.ABSENT, reason: null };
}

export async function resolveProfileOrSignOut(session, deps = {}) {
  const {
    getUserProfile,
    getUserProfileByEmail,
    signOut,
    setSession,
    setUserProfile,
    setAuthState,
    onSignedOut,
    onUnavailable,
    onError = (msg, err) => console.error(msg, err ?? ""),
  } = deps;

  const uid = session?.user?.id;
  const email = session?.user?.email;

  let resolvedProfile = null;
  let idResult;
  let emailResult;
  let threw = false;
  try {
    if (uid && typeof getUserProfile === "function") {
      idResult = await getUserProfile(uid);
      if (idResult && idResult.profile) resolvedProfile = idResult.profile;
    }
    if (
      !resolvedProfile &&
      email &&
      typeof getUserProfileByEmail === "function"
    ) {
      emailResult = await getUserProfileByEmail(email);
      if (emailResult && emailResult.profile)
        resolvedProfile = emailResult.profile;
    }
  } catch (e) {
    onError("[auth] profile lookup threw:", e?.message || e);
    threw = true;
  }

  const { outcome, reason } = admissionDetail({
    profile: resolvedProfile,
    idResult,
    emailResult,
    threw,
  });

  if (outcome === PROFILE_ADMISSION.ADMITTED) {
    if (typeof setUserProfile === "function") setUserProfile(resolvedProfile);
    return resolvedProfile;
  }

  if (outcome === PROFILE_ADMISSION.UNAVAILABLE) {
    onError(
      `[auth] profile lookup failed (${reason}) — session kept, blocking on retry screen`,
    );
    if (typeof onUnavailable === "function") onUnavailable(reason);
    if (typeof setAuthState === "function") setAuthState("profile_unavailable");
    return null;
  }

  onError(
    "[auth] authenticated session whose user profile could not be read — signing out",
  );
  try {
    if (typeof signOut === "function") await signOut();
  } catch (e) {
    onError(
      "[auth] signOut threw during no-profile teardown:",
      e?.message || e,
    );
  }
  if (typeof setSession === "function") setSession(null);
  if (typeof setUserProfile === "function") setUserProfile(null);
  if (typeof onSignedOut === "function") onSignedOut(NO_PROFILE_SIGNOUT_NOTICE);
  if (typeof setAuthState === "function") setAuthState("login");
  return null;
}
