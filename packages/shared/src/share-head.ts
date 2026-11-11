/**
 * The `<head>` tags for a share link page (`/s/:token`): Open Graph and Twitter tags so chat apps show a rich preview,
 * and, for a single recipe, schema.org `Recipe` JSON-LD so other recipe apps (and other Meally servers) can import it
 * with "Import from URL". Chat crawlers don't run JavaScript, so these are injected into the HTML by the server.
 * Pure and dependency-free so the Cloudflare Pages function can bundle it without the rest of this package.
 */
import type { PublicRecipe, ShareKind } from "./schemas/share.js";

export interface ShareMeta {
  kind: ShareKind;
  title: string | null;
  note: string | null;
  sharedBy: string | null;
  count: number;
  /** Path of the first image (`/api/v1/public/...`), or null. */
  imagePath: string | null;
  /** Single-recipe links only. */
  recipe: PublicRecipe | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** JSON inside <script>: never let a value close the tag or open a comment. */
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const iso = (m: number | null) => (m == null ? undefined : `PT${m}M`);

export function shareTitle(m: ShareMeta) {
  return m.title || plural(m.count, "recipe");
}

export function shareDescription(m: ShareMeta) {
  const who = m.sharedBy ? `Shared by ${m.sharedBy}` : "Shared with Meally";
  const what = m.kind === "recipe" ? (m.recipe?.description ?? null) : plural(m.count, "recipe");
  return [who, what, m.note].filter(Boolean).join(" · ").slice(0, 300);
}

/** schema.org Recipe for a single-recipe link (https://schema.org/Recipe). */
export function recipeJsonLd(r: PublicRecipe, image: string | null) {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    ...(image ? { image: [image] } : {}),
    ...(r.yieldText || r.servings != null ? { recipeYield: r.yieldText ?? String(r.servings) } : {}),
    ...(iso(r.prepMinutes) ? { prepTime: iso(r.prepMinutes) } : {}),
    ...(iso(r.cookMinutes) ? { cookTime: iso(r.cookMinutes) } : {}),
    ...(iso(r.totalMinutes) ? { totalTime: iso(r.totalMinutes) } : {}),
    recipeIngredient: r.ingredients.map((i) => i.raw),
    recipeInstructions: r.steps.map((s) => ({ "@type": "HowToStep", text: s.text })),
    ...(r.sourceUrl ? { isBasedOn: r.sourceUrl } : {}),
  };
}

/** Tags to insert before `</head>`. `origin` makes the image and page URLs absolute, as previews require. */
export function renderShareHead(m: ShareMeta, origin: string, pagePath: string): string {
  const title = shareTitle(m);
  const desc = shareDescription(m);
  const image = m.imagePath ? `${origin}${m.imagePath}` : null;
  const tags = [
    `<meta property="og:type" content="${m.kind === "recipe" ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="Meally" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(origin + pagePath)}" />`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="robots" content="noindex, nofollow" />`,
  ];
  if (image) tags.push(`<meta property="og:image" content="${esc(image)}" />`, `<meta name="twitter:image" content="${esc(image)}" />`);
  if (m.kind === "recipe" && m.recipe) tags.push(`<script type="application/ld+json">${jsonForScript(recipeJsonLd(m.recipe, image))}</script>`);
  return tags.join("\n    ");
}

/** Replaces the page title and adds the tags. Returns the HTML unchanged if it has no `</head>`. */
export function injectShareHead(html: string, m: ShareMeta, origin: string, pagePath: string): string {
  if (!html.includes("</head>")) return html;
  const withTitle = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(shareTitle(m))} · Meally</title>`);
  return withTitle.replace("</head>", `    ${renderShareHead(m, origin, pagePath)}\n  </head>`);
}
