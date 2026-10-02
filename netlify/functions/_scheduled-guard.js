export function isNetlifyScheduledEvent(event) {
  if (!event || typeof event !== "object") return false;
  if (event.isSchedulable === true) return true;
  if (event.source === "schedule") return true;
  const headers = event.headers || {};
  const ua =
    headers["user-agent"] ||
    headers["User-Agent"] ||
    headers["USER-AGENT"] ||
    "";
  if (typeof ua === "string" && /netlify[\s-]?clockwork/i.test(ua)) return true;
  if (typeof event.body === "string" && event.body.length > 0) {
    try {
      const parsed = JSON.parse(event.body);
      if (
        parsed &&
        typeof parsed.next_run === "string" &&
        parsed.next_run.length > 0
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}
