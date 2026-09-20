import { db } from "../db";
import { notifyDb } from "../hooks/useLive";
import { b64ToBytes, bytesToB64, derivePasswordKey } from "../lib/backup";
import { currentPeriod } from "../lib/ids";
import type { Settings } from "../types";

const UNLOCK_KEY = "daftar-practice-unlock";
const lockBus = new EventTarget();

export function defaultSettings(): Settings {
  return {
    id: "desk",
    firmName: "My practice",
    workingPeriod: currentPeriod(),
    fiscalYearStart: 7,
    theme: "system",
  };
}

export async function readSettings(): Promise<Settings> {
  const current = await db.settings.get("desk");
  if (!current) return defaultSettings();
  return {
    ...defaultSettings(),
    ...current,
    workingPeriod: current.workingPeriod || currentPeriod(),
  };
}

export async function patchSettings(partial: Partial<Omit<Settings, "id">>): Promise<Settings> {
  const current = await readSettings();
  const next: Settings = { ...current, ...partial, id: "desk" };
  await db.settings.put(next);
  notifyDb();
  return next;
}

export function hasPracticePin(settings?: Settings): boolean {
  return Boolean(settings?.practicePinHash && settings.practicePinSalt);
}

export function isPracticeUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlockPractice(): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY, "1");
  } catch {
    /* private mode */
  }
  lockBus.dispatchEvent(new Event("change"));
}

export function lockPractice(): void {
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* private mode */
  }
  lockBus.dispatchEvent(new Event("change"));
}

export function subscribePracticeLock(listener: () => void): () => void {
  const onChange = () => listener();
  lockBus.addEventListener("change", onChange);
  return () => lockBus.removeEventListener("change", onChange);
}

export function validatePracticePin(pin: string): string[] {
  const errors: string[] = [];
  if (pin.trim().length < 4) errors.push("PIN must be at least 4 characters.");
  return errors;
}

async function pinDigest(pin: string, salt: Uint8Array): Promise<string> {
  const key = await derivePasswordKey(pin, salt, true);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return bytesToB64(raw);
}

export async function verifyPracticePin(pin: string, settings: Settings): Promise<boolean> {
  if (!settings.practicePinHash || !settings.practicePinSalt) return false;
  const digest = await pinDigest(pin, b64ToBytes(settings.practicePinSalt));
  return digest === settings.practicePinHash;
}

export async function setPracticePin(pin: string): Promise<string[]> {
  const errors = validatePracticePin(pin);
  if (errors.length) return errors;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const practicePinHash = await pinDigest(pin, salt);
  await patchSettings({ practicePinHash, practicePinSalt: bytesToB64(salt) });
  unlockPractice();
  return [];
}

export async function clearPracticePin(): Promise<void> {
  await patchSettings({ practicePinHash: "", practicePinSalt: "" });
  unlockPractice();
}
