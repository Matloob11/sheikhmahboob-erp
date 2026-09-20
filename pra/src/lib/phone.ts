import { digitsOnly } from "./ids";

/** Local 03XXXXXXXXX from 03…, 92…, or +92… */
export function pkMobileLocal(value: string): string | null {
  const digits = digitsOnly(value);
  if (digits.length === 11 && digits.startsWith("03")) return digits;
  if (digits.length === 12 && digits.startsWith("92") && digits[2] === "3") return `0${digits.slice(2)}`;
  return null;
}

export function waMeHref(value: string): string | null {
  const local = pkMobileLocal(value);
  if (!local) return null;
  return `https://wa.me/92${local.slice(1)}`;
}

export function telHref(value: string): string | null {
  const local = pkMobileLocal(value);
  if (local) return `tel:+92${local.slice(1)}`;
  const digits = digitsOnly(value);
  if (digits.length < 10) return null;
  return digits.startsWith("92") ? `tel:+${digits}` : `tel:${digits}`;
}
