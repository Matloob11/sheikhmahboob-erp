/* Daftar SW: installable desk. Never cache PRA PostData. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/pra-ims") || url.hostname === "ims.pral.com.pk") {
    event.respondWith(fetch(event.request));
  }
});
