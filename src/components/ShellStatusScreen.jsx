import React from "react";
import useSignOutAction, { SIGN_OUT_FAILED_COPY } from "./useSignOutAction.js";

export const SHELL_BLOCKED_COPY = {
  auth: "Loading...",
  "auth-timeout":
    "We could not confirm your sign-in status. The platform stopped waiting rather than leaving you on a loading screen. Retry, or sign out and start a fresh sign-in.",
  "profile-unavailable":
    "Your workspace profile could not be loaded just now. This is usually a transient network or service issue rather than a problem with your account, so your session has been kept. Retry in a moment, or sign out if the problem persists.",
  "profile-unavailable-partial":
    "We could not confirm your workspace profile: one lookup found no profile for this account and the other could not be completed. Your session has been kept rather than ended on a partial answer. Retry in a moment — if this keeps happening, ask an administrator to confirm your account is still a member of its organization.",
  "assurance-unavailable":
    "We could not confirm the security status of your sign-in, so the platform stopped rather than opening your workspace on an unverified session. Your session has been kept. Retry in a moment, or sign out and sign in again.",

  "no-profile":
    "You are signed in, but this account has no workspace profile, so there is nothing to open. That usually means the invitation has not been completed or the account was removed from the organization. Sign out and back in, or ask an administrator to re-issue your invitation.",
  "curation-unavailable":
    "Your workspace configuration could not be loaded, so the platform stopped rather than opening with the wrong set of modules. This is usually a transient network or session issue.",
  timeout:
    "Your workspace is taking longer than expected to load and the platform stopped waiting rather than opening with an incomplete picture. Retry, or sign out and back in.",
  data: "Connecting to database...",
  curation: "Loading your workspace...",
};

const WRAP = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "#0B1120",
  color: "#94A3B8",
  fontFamily: "'Inter', system-ui, sans-serif",
  padding: 24,
  textAlign: "center",
};

const BTN_PRIMARY = {
  padding: "9px 22px",
  borderRadius: 8,
  background: "var(--ds-accent)",
  color: "#fff",
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const BTN_SECONDARY = {
  padding: "9px 22px",
  borderRadius: 8,
  background: "transparent",
  color: "#94A3B8",
  border: "1px solid #1E293B",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export default function ShellStatusScreen({ plan, onSignOut }) {
  const signOutAction = useSignOutAction(onSignOut);

  const showRetry = plan?.affordances?.includes("retry");
  const showSignOut = plan?.affordances?.includes("signOut");
  const copy =
    SHELL_BLOCKED_COPY[plan?.reason] ||
    SHELL_BLOCKED_COPY["curation-unavailable"];

  return (
    <div style={WRAP} role="status" aria-live="polite">
      {plan?.spinner && (
        <div
          style={{
            width: 48,
            height: 48,
            border: "3px solid #1E293B",
            borderTopColor: "var(--ds-accent)",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            marginBottom: 24,
          }}
        />
      )}
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "#E2E8F0",
          marginBottom: 8,
        }}
      >
        Valiance Capital Platform
      </div>
      <div style={{ fontSize: 13, maxWidth: 460, lineHeight: 1.6 }}>{copy}</div>

      {(showRetry || showSignOut) && (
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          {showRetry && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={BTN_PRIMARY}
            >
              Retry
            </button>
          )}
          {showSignOut && (
            <button
              type="button"
              onClick={signOutAction.run}
              disabled={signOutAction.isPending}
              style={{
                ...BTN_SECONDARY,
                cursor: signOutAction.isPending ? "wait" : "pointer",
                opacity: signOutAction.isPending ? 0.6 : 1,
              }}
            >
              {signOutAction.label}
            </button>
          )}
        </div>
      )}

      {signOutAction.isFailed && (
        <div style={{ marginTop: 16, maxWidth: 460 }}>
          <div style={{ fontSize: 13, color: "#FCA5A5", lineHeight: 1.6 }}>
            {SIGN_OUT_FAILED_COPY}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ ...BTN_PRIMARY, marginTop: 12 }}
          >
            Reload
          </button>
        </div>
      )}

      <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
