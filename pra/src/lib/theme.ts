export type DeskTheme = "light" | "dark" | "system";

const KEY = "daftar-theme";

export function readTheme(): DeskTheme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* private mode */
  }
  return "system";
}

export function writeTheme(theme: DeskTheme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
  applyTheme(theme);
}

// The desk is light only, to match the firm's white and olive identity.
export function applyTheme(_theme: DeskTheme = readTheme()): void {
  document.documentElement.dataset.theme = "light";
}
