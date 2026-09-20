import { describe, expect, it } from "vitest";
import {
  BACKUP_REMIND_DAYS,
  backupReminderState,
  markBackupExported,
  memoryStore,
  snoozeBackupReminder,
} from "./reminders";

describe("backup download reminder", () => {
  it("is due when the desk has clients and has never exported", () => {
    const store = memoryStore();
    const state = backupReminderState(new Date("2026-09-18T10:00:00"), true, store);
    expect(state.due).toBe(true);
    expect(state.lastAt).toBeUndefined();
  });

  it("is not due when there are no clients", () => {
    const store = memoryStore();
    expect(backupReminderState(new Date("2026-09-18T10:00:00"), false, store).due).toBe(false);
  });

  it("is due 8 days after export and quiet 2 days after", () => {
    const store = memoryStore();
    const exported = Date.parse("2026-09-10T10:00:00");
    markBackupExported(exported, store);
    expect(backupReminderState(new Date("2026-09-18T10:00:00"), true, store).due).toBe(true);
    expect(backupReminderState(new Date("2026-09-12T10:00:00"), true, store).due).toBe(false);
    expect(BACKUP_REMIND_DAYS).toBe(7);
  });

  it("snooze of 3 days suppresses a due reminder", () => {
    const store = memoryStore();
    const now = new Date("2026-09-18T10:00:00");
    expect(backupReminderState(now, true, store).due).toBe(true);
    snoozeBackupReminder(3, now, store);
    expect(backupReminderState(now, true, store).due).toBe(false);
    expect(backupReminderState(new Date("2026-09-22T10:00:00"), true, store).due).toBe(true);
  });
});
