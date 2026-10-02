export const ELEVATION = Object.freeze({
  MFA_REQUIRED: "mfa-required",
  ENROLL_REQUIRED: "enroll-required",
  UNVERIFIED: "unverified",
  AUTHENTICATED: "authenticated",
});

export const ASSURANCE_UNAVAILABLE_REASON = "assurance-unavailable";

export async function resolveElevation(deps = {}) {
  const {
    mfaGetAssuranceLevel,
    adminNeedsEnrollment,
    onError = (msg, err) => console.error(msg, err ?? ""),
  } = deps;

  let aal;
  try {
    aal =
      typeof mfaGetAssuranceLevel === "function"
        ? await mfaGetAssuranceLevel()
        : null;
  } catch (e) {
    onError(
      "[auth] assurance-level read threw — refusing to elevate:",
      e?.message || e,
    );
    return ELEVATION.UNVERIFIED;
  }
  if (!aal || typeof aal.currentLevel !== "string") {
    onError("[auth] assurance level unreadable — refusing to elevate");
    return ELEVATION.UNVERIFIED;
  }
  if (aal.error) {
    onError(
      "[auth] assurance-level read reported an error — refusing to elevate:",
      aal.error?.message || aal.error,
    );
    return ELEVATION.UNVERIFIED;
  }
  if (aal.currentLevel === "aal1" && aal.nextLevel === "aal2")
    return ELEVATION.MFA_REQUIRED;

  if (typeof adminNeedsEnrollment !== "function") {
    onError("[auth] no enrollment check supplied — refusing to elevate");
    return ELEVATION.UNVERIFIED;
  }
  let needs;
  try {
    const res = await adminNeedsEnrollment();
    needs = res?.needs;
  } catch (e) {
    onError(
      "[auth] enrollment check threw — refusing to elevate:",
      e?.message || e,
    );
    return ELEVATION.UNVERIFIED;
  }
  if (typeof needs !== "boolean") {
    onError("[auth] enrollment check returned no answer — refusing to elevate");
    return ELEVATION.UNVERIFIED;
  }
  return needs ? ELEVATION.ENROLL_REQUIRED : ELEVATION.AUTHENTICATED;
}

export function authStateForElevation(elevation) {
  switch (elevation) {
    case ELEVATION.AUTHENTICATED:
      return "authenticated";
    case ELEVATION.ENROLL_REQUIRED:
      return "mfa_enroll_required";
    case ELEVATION.MFA_REQUIRED:
      return "login";
    case ELEVATION.UNVERIFIED:
      return "profile_unavailable";
    default:
      return "profile_unavailable";
  }
}
