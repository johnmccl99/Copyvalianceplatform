import { useCallback, useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import {
  fetchModuleVisibility,
  setModuleVisibility,
} from "./supabaseClient.js";
import {
  subscribe,
  getHidden,
  setHidden,
  toggleLocal,
} from "./moduleVisibilityStore.js";

export function useModuleVisibility(orgId) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => getHidden(orgId),
    () => getHidden(orgId),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetchModuleVisibility(orgId)
      .then((h) => {
        if (cancelled) return;
        setHidden(orgId, h);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[moduleVisibility] load failed:", e?.message || e);
        setError(e?.message || "Failed to load visibility settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const applyToggle = useCallback(
    async (key, nextVisible) => {
      if (!orgId) return;
      const prev = toggleLocal(orgId, key, nextVisible);
      try {
        await setModuleVisibility(orgId, key, nextVisible);
      } catch (e) {
        setHidden(orgId, prev);
        throw e;
      }
    },
    [orgId],
  );

  return { hidden, loading, error, applyToggle };
}
