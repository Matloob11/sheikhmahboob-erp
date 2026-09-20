const KEY = "daftar.recentClientIds";
const MAX = 8;

export function readRecentClientIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecentClientId(id: string): string[] {
  const next = [id, ...readRecentClientIds().filter((row) => row !== id)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
