/** Register a no-cache service worker so the hosted desk can be installed. */
export function registerDaftarPwa(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
}
