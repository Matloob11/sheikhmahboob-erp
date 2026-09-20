export const IDLE_MINUTES_KEY = "daftar-idle-lock-minutes";
export const IDLE_ACTIVITY_KEY = "daftar-idle-last-activity";
export const DEFAULT_IDLE_MINUTES = 15;

export function readIdleMinutes(storage: Pick<Storage, "getItem"> | null = defaultLocal()): number {
  try {
    const raw = storage?.getItem(IDLE_MINUTES_KEY);
    if (raw == null || raw === "") return DEFAULT_IDLE_MINUTES;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return DEFAULT_IDLE_MINUTES;
    return Math.floor(value);
  } catch {
    return DEFAULT_IDLE_MINUTES;
  }
}

export function writeIdleMinutes(
  minutes: number,
  storage: Pick<Storage, "setItem"> | null = defaultLocal(),
): void {
  try {
    storage?.setItem(IDLE_MINUTES_KEY, String(Math.max(0, Math.floor(minutes))));
  } catch {
    /* private mode */
  }
}

export function recordDeskActivity(
  now = Date.now(),
  storage: Pick<Storage, "setItem"> | null = defaultSession(),
): void {
  try {
    storage?.setItem(IDLE_ACTIVITY_KEY, String(now));
  } catch {
    /* private mode */
  }
}

export function readLastActivity(
  now = Date.now(),
  storage: Pick<Storage, "getItem"> | null = defaultSession(),
): number {
  try {
    const raw = storage?.getItem(IDLE_ACTIVITY_KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : now;
  } catch {
    return now;
  }
}

export function idleShouldLock(lastMs: number, nowMs: number, minutes: number): boolean {
  if (minutes <= 0) return false;
  return nowMs - lastMs >= minutes * 60_000;
}

function defaultLocal(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
