import { FEATURES, type FeatureKey, type Snap } from "@meally/shared";

/** A reply: status and JSON body, `"pending"` (never answers, for loading states) or a function of the request. */
export type Reply = [number, unknown] | "pending" | ((init: RequestInit | undefined, url: string) => Reply);
/** Keys are `"GET /snaps/s1"` or a bare path (any method). A path ending in `*` matches by prefix. */
export type Routes = Record<string, Reply>;

const DAY = 86_400_000;
const now = Date.now();

/** A flat illustration of a dish: a bowl or plate on a coloured table, as a data URI. */
function dish(hue: number, food: number, bowl = true): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
<rect width="600" height="800" fill="oklch(0.55 0.07 ${hue})"/>
<circle cx="300" cy="400" r="${bowl ? 230 : 250}" fill="oklch(0.95 0.01 85)"/>
<circle cx="300" cy="400" r="${bowl ? 190 : 200}" fill="oklch(0.68 0.13 ${food})"/>
<circle cx="230" cy="350" r="40" fill="oklch(0.9 0.08 95)"/>
<circle cx="360" cy="440" r="32" fill="oklch(0.55 0.12 140)"/>
<circle cx="330" cy="330" r="22" fill="oklch(0.45 0.1 40)"/>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const people = {
  me: { id: "u1", name: "Bach" },
  ana: { id: "f1", name: "Ana" },
  minh: { id: "f2", name: "Minh" },
  linh: { id: "f3", name: "Linh" },
};

const snap = (s: Partial<Snap> & Pick<Snap, "id" | "author">): Snap => {
  const img = s.imageUrl ?? dish(60, 55);
  return { imageUrl: img, thumbUrl: img, caption: null, dishName: null, place: null, recipe: null, createdAt: now - 2 * 3600_000, myReactions: [], ...s };
};

export const snaps = {
  ramen: snap({ id: "s1", author: people.ana, caption: "Sunday ramen", recipe: { slug: "tonkotsu-ramen", name: "Tonkotsu ramen" }, imageUrl: dish(50, 60), myReactions: ["heart"] }),
  pho: snap({
    id: "s2",
    author: people.me,
    caption: "Best pho in town",
    dishName: "Pho bo",
    place: "Cafe Lu",
    createdAt: now - DAY,
    imageUrl: dish(90, 75),
    reactions: [
      { userId: "f1", name: "Ana", emoji: "yum" },
      { userId: "f2", name: "Minh", emoji: "fire" },
    ],
  }),
  salad: snap({ id: "s3", author: people.minh, caption: "Lunch", createdAt: now - 2 * DAY, imageUrl: dish(200, 130, false) }),
  noText: snap({ id: "s4", author: people.linh, createdAt: now - 3 * DAY, imageUrl: dish(20, 40) }),
};

export const linkedRecipe = {
  id: "r1",
  slug: "tonkotsu-ramen",
  name: "Tonkotsu ramen",
  description: "A rich pork broth that takes a day, and is worth it.",
  yieldText: null,
  servings: 4,
  prepMinutes: 30,
  cookMinutes: 720,
  totalMinutes: 750,
  sourceUrl: null,
  notes: null,
  imageUrl: dish(50, 60),
  ingredients: ["1.5 kg pork bones", "4 portions fresh ramen noodles", "2 tbsp white miso", "4 soft-boiled eggs", "Spring onions, sliced"].map(
    (raw, position) => ({ position, section: null, quantity: null, unit: null, food: null, note: null, raw }),
  ),
  steps: ["Blanch the bones, then boil hard for 10 to 12 hours, topping up with water.", "Whisk in the miso, cook the noodles and serve with the eggs."].map(
    (text, position) => ({ position, section: null, text }),
  ),
  createdAt: now - 10 * DAY,
  updatedAt: now - 10 * DAY,
  savedSlug: null as string | null,
};

export const friends = [
  { userId: "f1", name: "Ana", since: now - 10 * DAY },
  { userId: "f2", name: "Minh", since: now - 40 * DAY },
  { userId: "f3", name: "Linh", since: now - 70 * DAY },
];

export function features(off: FeatureKey[] = []) {
  return {
    features: Object.fromEntries(
      FEATURES.map((f) => [f.key, { enabled: f.default && !off.includes(f.key), locked: false, source: "default", label: f.label, description: f.description }]),
    ),
  };
}

/** What every screen needs: a signed-in user, flags and server meta. */
export const baseRoutes: Routes = {
  "GET /auth/me": [200, { user: { id: "u1", email: "bach@example.com", name: "Bach", role: "admin" } }],
  "GET /auth/status": [200, { needsSetup: false, signupMode: "invite" }],
  "GET /features": [200, features()],
  "GET /meta": [200, { streaming: true, presizedImages: false }],
  "GET /snaps?*": [200, { items: Object.values(snaps), nextCursor: null }],
  "GET /snaps/s1": [200, snaps.ramen],
  "GET /snaps/s2": [200, snaps.pho],
  "GET /snaps/s1/recipe": [200, linkedRecipe],
  "POST /snaps/s1/recipe/save": [201, { slug: "tonkotsu-ramen-2" }],
  "POST /snaps": [201, snaps.ramen],
  "PUT /snaps/*": [204, null],
  "DELETE /snaps/*": [204, null],
  "GET /recipes*": [200, { items: [], nextCursor: null, total: 0 }],
  "GET /friends": [200, { items: friends, cap: 20 }],
  "GET /friends/invites": [200, { items: [{ id: "i1", expiresAt: now + 7 * DAY, usedAt: null }] }],
  "POST /friends/invites": [201, { id: "i2", url: "https://meally.example/invite/tok", path: "/invite/tok", token: "tok", expiresAt: now + 7 * DAY }],
  "GET /friends/invites/tok": [200, { inviter: { name: "Ana" } }],
  "POST /friends/invites/tok/accept": [200, { userId: "f1", name: "Ana", since: now }],
  "DELETE /friends/*": [204, null],
};

function match(routes: Routes, method: string, path: string): Reply | undefined {
  for (const key of [`${method} ${path}`, path]) if (key in routes) return routes[key];
  // Longest prefix wins, so "GET /snaps/s1/recipe" beats "GET /snaps/*".
  const prefixes = Object.keys(routes)
    .filter((k) => k.endsWith("*"))
    .filter((k) => {
      const space = k.indexOf(" ");
      const m = space < 0 ? method : k.slice(0, space);
      return m === method && path.startsWith(k.slice(space + 1, -1));
    })
    .sort((a, b) => b.length - a.length);
  return prefixes[0] ? routes[prefixes[0]] : undefined;
}

const realFetch = globalThis.fetch.bind(globalThis);

/** Answers `/api/v1/*` from `routes`; everything else (Storybook's own files) goes to the network. */
export function installMockApi(routes: Routes) {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    if (!u.pathname.startsWith("/api/v1/")) return realFetch(input, init);
    const path = u.pathname.slice("/api/v1".length) + u.search;
    const method = (init?.method ?? "GET").toUpperCase();
    let reply = match(routes, method, path) ?? [404, { error: "not_found", message: "Not found" }];
    while (typeof reply === "function") reply = reply(init, path);
    if (reply === "pending") return new Promise<Response>(() => undefined);
    const [status, body] = reply;
    await new Promise((r) => setTimeout(r, 150));
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  };
}
