import { useState, useEffect } from "react";

export function resolveRole(userProfile) {
  const role = userProfile?.role;
  if (!role) return "gp";
  return role === "gp_admin" ? "gp" : role;
}

export function useResolvedRole(userProfile) {
  const [role, setRole] = useState(resolveRole(userProfile));
  useEffect(() => {
    setRole(resolveRole(userProfile));
  }, [userProfile]);
  return [role, setRole];
}

export function getVisibleDashboardTabs(tabs, role) {
  return tabs.filter(
    (t) => !t.roles || role === "admin" || t.roles.includes(role),
  );
}

export function canCurateModuleVisibility(userProfile) {
  if (!userProfile) return false;
  if (userProfile.is_admin === true) return true;
  return userProfile.role === "admin";
}
