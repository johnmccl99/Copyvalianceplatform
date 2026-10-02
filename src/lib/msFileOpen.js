export function safeMicrosoftUrl(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;

  return parsed.href;
}
