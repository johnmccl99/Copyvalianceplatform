import React from "react";
import { useResolvedRole } from "../lib/roleAccess";

const FALLBACK_CONTAINER_STYLE = {
  padding: 40,
  textAlign: "center",
};

const FALLBACK_HEADING_STYLE = {
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 8,
};

const DEFAULT_FALLBACK_MESSAGE =
  "You do not have permission to view this page. Contact your administrator if you believe this is an error.";

export default function RoleGate({
  allowedRoles,
  userProfile,
  children,
  fallbackMessage,
}) {
  const [role] = useResolvedRole(userProfile);
  const isAdmin = !!userProfile?.is_admin;

  const hasRole = !!(userProfile && userProfile.role);

  const allowed =
    (!!userProfile && isAdmin) ||
    (hasRole &&
      (role === "admin" ||
        (Array.isArray(allowedRoles) && allowedRoles.includes(role))));

  if (!allowed) {
    return React.createElement(
      "div",
      { style: FALLBACK_CONTAINER_STYLE },
      React.createElement(
        "div",
        { style: FALLBACK_HEADING_STYLE },
        "Access restricted",
      ),
      React.createElement(
        "div",
        null,
        fallbackMessage || DEFAULT_FALLBACK_MESSAGE,
      ),
    );
  }

  return children;
}
