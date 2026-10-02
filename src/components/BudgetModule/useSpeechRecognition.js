import { useCallback, useEffect, useRef, useState } from "react";

function getRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function micAllowedByPolicy() {
  if (typeof document === "undefined") return true;
  const policy = document.permissionsPolicy || document.featurePolicy;
  if (!policy || typeof policy.allowsFeature !== "function") return true;
  try {
    return policy.allowsFeature("microphone");
  } catch {
    return true;
  }
}

export default function useSpeechRecognition({ onFinal } = {}) {
  const Ctor = getRecognitionCtor();
  const hasCtor = !!Ctor;
  const policyAllows = hasCtor && micAllowedByPolicy();
  const supported = hasCtor && policyAllows;
  const unavailableReason = hasCtor
    ? policyAllows
      ? null
      : "policy"
    : "browser";
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {}
    }
  }, []);

  const start = useCallback(() => {
    if (!supported || listening) return;
    setError(null);
    setInterim("");
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      let finalText = "";
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      if (finalText && onFinalRef.current) onFinalRef.current(finalText.trim());
    };
    rec.onerror = (ev) => {
      const code = ev?.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError(
          "Microphone access was blocked — this is either the browser's site permissions or this site's security policy.",
        );
      } else if (code === "no-speech") {
        setError("No speech detected — try again, or type instead.");
      } else if (code && code !== "aborted") {
        setError("Voice input error — try again or type instead.");
      }
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      setError("Could not start voice input.");
    }
  }, [Ctor, supported, listening]);

  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {}
      }
    },
    [],
  );

  return {
    supported,
    unavailableReason,
    listening,
    interim,
    error,
    start,
    stop,
  };
}
