export function normalizePlanFeatures(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return normalizePlanFeatures(JSON.parse(trimmed));
      } catch {
        // fall through to comma-separated parsing
      }
    }

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()));
  }

  return [];
}

export function planFeaturesToInput(value: unknown): string {
  return normalizePlanFeatures(value).join(", ");
}
