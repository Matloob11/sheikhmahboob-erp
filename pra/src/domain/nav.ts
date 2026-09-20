/** Path for desk links. Hosted /pra without Vite base must stay inside the SPA. */
export function sectionPath(
  path: string,
  pathname = typeof window === "undefined" ? "/" : window.location.pathname,
  viteBase = import.meta.env.BASE_URL,
): string {
  const base = viteBase.replace(/\/$/, "") || "/";
  const underPra = base !== "/pra" && (pathname === "/pra" || pathname.startsWith("/pra/"));
  if (path === "/") return underPra ? "/pra" : "/";
  const clean = path.startsWith("/") ? path : `/${path}`;
  return underPra ? `/pra${clean}` : clean;
}
