import { useEffect } from "react";
import {
  setUsageActorContext,
  startUsageSession,
  stopUsageSession,
  logSurfaceView,
} from "./usageClient.js";

export function useUsageSession({
  userId = null,
  role = null,
  orgId = null,
} = {}) {
  useEffect(() => {
    setUsageActorContext({ userId, role, orgId });
  }, [userId, role, orgId]);

  useEffect(() => {
    const teardown = startUsageSession();
    return () => {
      teardown && teardown();
      stopUsageSession();
    };
  }, []);
}

export function useSurfaceView(
  surfaceKey,
  { propertyId = null, actionKey = "view", enabled = true } = {},
) {
  useEffect(() => {
    if (!enabled || !surfaceKey) return;
    logSurfaceView(surfaceKey, { propertyId, actionKey });
  }, [surfaceKey, propertyId, actionKey, enabled]);
}
