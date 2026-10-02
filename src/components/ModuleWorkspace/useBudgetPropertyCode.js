import { useState, useEffect } from "react";
import { fetchPropertyCodeByName } from "../../lib/supabaseClient.js";

export function useBudgetPropertyCode(propertyName, enabled = true) {
  const [state, setState] = useState({
    code: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !propertyName) {
      setState({ code: null, loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ code: null, loading: true, error: null });
    fetchPropertyCodeByName(propertyName).then(({ data, error }) => {
      if (cancelled) return;
      setState({
        code: data,
        loading: false,
        error: error ? error.message || String(error) : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [propertyName, enabled]);

  return state;
}

export default useBudgetPropertyCode;
