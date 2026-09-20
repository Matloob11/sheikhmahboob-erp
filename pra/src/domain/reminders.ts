export const BACKUP_REMIND_DAYS = 7;
export const BACKUP_EXPORT_KEY = "daftar-backup-last-export";
export const BACKUP_SNOOZE_KEY = "daftar-backup-snooze-until";
export const BACKUP_EXPORTED_EVENT = "daftar:backup-exported";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function memoryStore(seed: Record<string, string> = {}): KeyValueStore {
  const data = { ...seed };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

export function browserStore(): KeyValueStore | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

function readMs(store: KeyValueStore | undefined, key: string): number | undefined {
  const raw = store?.getItem(key);
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function readBackupExportAt(store: KeyValueStore | undefined = browserStore()): number | undefined {
  return readMs(store, BACKUP_EXPORT_KEY);
}

export function markBackupExported(at = Date.now(), store: KeyValueStore | undefined = browserStore()): void {
  store?.setItem(BACKUP_EXPORT_KEY, String(at));
}

export function recordBackupExport(at = Date.now(), store: KeyValueStore | undefined = browserStore()): void {
  markBackupExported(at, store);
}

export function snoozeBackupReminder(
  days: number,
  now = new Date(),
  store: KeyValueStore | undefined = browserStore(),
): void {
  store?.setItem(BACKUP_SNOOZE_KEY, String(now.getTime() + Math.max(days, 0) * 86_400_000));
}

export function backupReminderState(
  now: Date,
  hasClients: boolean,
  store: KeyValueStore | undefined = browserStore(),
): { due: boolean; lastAt?: number; daysOverdue: number } {
  const lastAt = readBackupExportAt(store);
  const snoozeUntil = readMs(store, BACKUP_SNOOZE_KEY);
  if (!hasClients) return { due: false, lastAt, daysOverdue: 0 };
  if (snoozeUntil && now.getTime() < snoozeUntil) return { due: false, lastAt, daysOverdue: 0 };
  if (!lastAt) return { due: true, lastAt: undefined, daysOverdue: 0 };
  const elapsed = Math.floor((now.getTime() - lastAt) / 86_400_000);
  const due = elapsed >= BACKUP_REMIND_DAYS;
  return { due, lastAt, daysOverdue: due ? elapsed - BACKUP_REMIND_DAYS : 0 };
}
