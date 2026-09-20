import { env } from "../env.js";

export function isLocked(lockedUntil: Date | string | null | undefined): boolean {
  if (!lockedUntil) return false;
  const when = lockedUntil instanceof Date ? lockedUntil : new Date(lockedUntil);
  return when.getTime() > Date.now();
}

export function lockUntilFromNow(): Date {
  return new Date(Date.now() + env.loginLockMinutes * 60 * 1000);
}

export { env as lockoutEnv };
