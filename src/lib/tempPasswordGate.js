export function profileRequiresPasswordChange(profile) {
  if (!profile || typeof profile !== "object") return false;
  const v = profile.must_change_password;
  return v === true || v === "t" || v === "true" || v === 1;
}

export function authStateForProfile(profile) {
  return profileRequiresPasswordChange(profile)
    ? "password_change_required"
    : "authenticated";
}
