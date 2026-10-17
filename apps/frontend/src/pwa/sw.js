/* Service worker: speeds up the static app shell and nothing else (FR-029).
 *
 * It never answers for the API, S3, Cognito, the sign-in callback, uploads, or anything that is not
 * a plain GET of our own static files, so photos, tokens and API answers are never cached here.
 * __BUILD_ID__ is replaced at build time so every release changes this file and is noticed.
 */
const BUILD_ID = "__BUILD_ID__";
const PREFIX = "photoprep-shell-";
const CACHE = PREFIX + BUILD_ID;
const SHELL = "/index.html";

function classify(request) {
  if (request.method !== "GET") return "skip";
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return "skip";
  if (request.mode === "navigate") {
    return url.pathname.startsWith("/auth/") ? "skip" : "page";
  }
  const path = url.pathname;
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/icons/") ||
    path === "/favicon.svg" ||
    path === "/manifest.webmanifest"
  ) {
    return "static";
  }
  return "skip";
}

function cacheable(response) {
  if (!response || response.status !== 200 || response.type === "opaque")
    return false;
  const control = response.headers.get("cache-control") || "";
  return !/no-store|private/i.test(control);
}

async function page(request) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(SHELL);
    return (
      cached ||
      new Response("offline", {
        status: 503,
        headers: { "content-type": "text/plain" },
      })
    );
  }
}

async function staticFile(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  // No skipWaiting here: a new version waits until the person agrees (see the update banner),
  // so a photo in progress is never lost to a reload.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== CACHE)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const kind = classify(event.request);
  if (kind === "page") event.respondWith(page(event.request));
  else if (kind === "static") event.respondWith(staticFile(event.request));
});
