import { useEffect, useState } from "react";
import { fetchNoiExcludedAccounts } from "./supabaseClient.js";
import { noiExclusionMap } from "./noiExclusions.js";

const EMPTY = new Map();

export function useNoiExclusions() {
  const [map, setMap] = useState(EMPTY);
  useEffect(() => {
    let live = true;
    fetchNoiExcludedAccounts().then(({ data }) => {
      if (live && data && data.length) setMap(noiExclusionMap(data));
    });
    return () => {
      live = false;
    };
  }, []);
  return map;
}
