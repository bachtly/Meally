// Runtime caching rules for the generated service worker. Matchers are self-contained functions
// because Workbox serialises them into sw.js with toString(): no imports, helpers or outer variables inside,
// or every request throws a ReferenceError in the worker (pwa.test.tsx rebuilds them from source to check).
interface MatchCtx {
  url: URL;
  request: { method: string };
  sameOrigin?: boolean;
}
export const matchers = {
  /** Single recipe: /api/v1/recipes/<slug> only (not /image, /cook-log, ...). */
  recipeDetail: ({ url, request }: MatchCtx) => request.method === "GET" && /^\/api\/v1\/recipes\/[^/]+$/.test(url.pathname),
  /** Recipe list: /api/v1/recipes (with any query string). */
  recipeList: ({ url, request }: MatchCtx) => request.method === "GET" && /^\/api\/v1\/recipes\/?$/.test(url.pathname),
  /** Recipe images: /api/v1/images/<id>/<size>. */
  images: ({ url, request }: MatchCtx) => request.method === "GET" && /^\/api\/v1\/images\/[^/]+\/[^/]+$/.test(url.pathname),
  /** Feature flags: lets the app boot offline. Contains no personal data. */
  features: ({ url, request }: MatchCtx) => request.method === "GET" && url.pathname === "/api/v1/features",
};

export const runtimeCaching = [
  {
    urlPattern: matchers.recipeList,
    handler: "NetworkFirst" as const,
    options: { cacheName: "recipes-list", networkTimeoutSeconds: 3, expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } },
  },
  {
    urlPattern: matchers.recipeDetail,
    handler: "StaleWhileRevalidate" as const,
    options: { cacheName: "recipes", expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
  },
  {
    urlPattern: matchers.images,
    handler: "StaleWhileRevalidate" as const,
    options: { cacheName: "recipes", expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
  },
  {
    urlPattern: matchers.features,
    handler: "NetworkFirst" as const,
    options: { cacheName: "features", networkTimeoutSeconds: 3, expiration: { maxEntries: 1 } },
  },
];

/** Cache names to wipe on sign-out (shared devices). */
export const OFFLINE_CACHES = ["recipes", "recipes-list", "features"];
