import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchIsPlatformSuperAdmin } from "./supabaseClient.js";
import {
  getInDevelopmentKeys,
  readDevMarkersFlag,
  writeDevMarkersFlag,
} from "./inDevelopmentSurfaces.js";

export function isDevMarkerToggleChord(e) {
  return !!(
    e &&
    (e.metaKey || e.ctrlKey) &&
    e.shiftKey &&
    typeof e.key === "string" &&
    e.key.toLowerCase() === "d"
  );
}

export function useInDevelopmentMarkers(sections) {
  const [flagOn, setFlagOn] = useState(() => readDevMarkersFlag());
  const [isSuperAdmin, setIsSuperAdmin] = useState(null);

  const keys = useMemo(() => getInDevelopmentKeys(sections), [sections]);

  const toggle = useCallback(() => {
    setFlagOn((prev) => {
      const next = !prev;
      writeDevMarkersFlag(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (isDevMarkerToggleChord(e)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  useEffect(() => {
    if (!flagOn || isSuperAdmin !== null) return undefined;
    let cancelled = false;
    (async () => {
      const ok = await fetchIsPlatformSuperAdmin();
      if (!cancelled) setIsSuperAdmin(!!ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [flagOn, isSuperAdmin]);

  return {
    visible: flagOn && isSuperAdmin === true,
    keys,
  };
}
