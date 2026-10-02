import { useEffect, useState } from "react";

export const MOBILE_BREAKPOINT_PX = 768;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

function hasMatchMedia() {
  return (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
  );
}

export function useMediaQuery(query) {
  const read = () =>
    hasMatchMedia() ? window.matchMedia(query).matches : false;
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (!hasMatchMedia()) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
