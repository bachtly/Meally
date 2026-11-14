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
  /** The Feed: /api/v1/snaps (with any query string). */
  snapFeed: ({ url, request }: MatchCtx) => request.method === "GET" && /^\/api\/v1\/snaps\/?$/.test(url.pathname),
  /** One Snap: /api/v1/snaps/<id> only (not /recipe, /reactions, /images). */
  snapDetail: ({ url, request }: MatchCtx) => request.method === "GET" && /^\/api\/v1\/snaps\/[^/]+$/.test(url.pathname),
  /** Snap photos: /api/v1/snaps/<id>/images/<imageId>/<size>. */
  snapImages: ({ url, request }: MatchCtx) => request.method === "GET" && /^\/api\/v1\/snaps\/[^/]+\/images\/[^/]+\/[^/]+$/.test(url.pathname),
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
    // An image id never changes content (a new photo gets a new id), so once it's on the device it never needs the network.
    urlPattern: matchers.images,
    handler: "CacheFirst" as const,
    options: { cacheName: "images", expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } },
  },
  {
    urlPattern: matchers.features,
    handler: "NetworkFirst" as const,
    options: { cacheName: "features", networkTimeoutSeconds: 3, expiration: { maxEntries: 1 } },
  },
  {
    // Fresh when online (Reactions and new Snaps change it); the last copy when offline or the network stalls.
    urlPattern: matchers.snapFeed,
    handler: "NetworkFirst" as const,
    options: { cacheName: "snaps-feed", networkTimeoutSeconds: 3, expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
  },
  {
    // NetworkFirst, not stale-while-revalidate: a stale copy would undo a Reaction the viewer just made.
    urlPattern: matchers.snapDetail,
    handler: "NetworkFirst" as const,
    options: { cacheName: "snaps", networkTimeoutSeconds: 3, expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
  },
  {
    // Like recipe images, a Snap photo URL carries its image id, so its bytes never change.
    urlPattern: matchers.snapImages,
    handler: "CacheFirst" as const,
    options: { cacheName: "snap-images", expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } },
  },
];

/** Cache names to wipe on sign-out (shared devices). */
export const OFFLINE_CACHES = ["recipes", "recipes-list", "images", "features", "snaps-feed", "snaps", "snap-images"];

/** localStorage keys holding personal data to wipe on sign-out (the stored Feed page; see features/snaps/api.ts). */
export const OFFLINE_STORAGE_KEYS = ["meally:feed"];
