const KEY = "daftar-seen-schema";

export function schemaUpgradeNotice(verno: number): string | null {
  try {
    const seen = Number(localStorage.getItem(KEY) || "0");
    if (!seen) {
      localStorage.setItem(KEY, String(verno));
      return null;
    }
    if (seen >= verno) return null;
    localStorage.setItem(KEY, String(verno));
    return `Desk format is now v${verno}. Export a backup after you confirm the files look right.`;
  } catch {
    return null;
  }
}
