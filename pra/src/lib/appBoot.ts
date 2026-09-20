import { ensureSeed } from "../db";
import { exportBackup } from "./backup";

export type BootOutcome = { ok: true } | { ok: false; message: string };

export async function bootDesk(seed: () => Promise<void> = ensureSeed): Promise<BootOutcome> {
  try {
    await seed();
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Daftar could not open the local desk database.";
    return { ok: false, message };
  }
}

/** Best-effort export when boot fails — may still throw if IndexedDB is fully unreadable. */
export async function exportReadableBackup(): Promise<void> {
  await exportBackup({ tokenMode: "strip" });
}
