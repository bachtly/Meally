import { describe, expect, it } from "vitest";
import { injectShareHead, recipeJsonLd, renderShareHead, shareDescription, type ShareMeta } from "./share-head.js";

const recipe = {
  name: "Lemon cake", description: "Bright & soft", yieldText: null, servings: 8, prepMinutes: 15, cookMinutes: 40, totalMinutes: 55,
  sourceUrl: "https://example.org/cake", notes: null, imageUrl: "/api/v1/public/shares/t/recipes/lemon-cake/image/800", scaling: true,
  ingredients: [{ position: 0, section: null, quantity: 2, unit: "cup", food: "flour", note: null, raw: "2 cups flour" }],
  steps: [{ position: 0, section: null, text: "Mix." }],
};
const one: ShareMeta = { kind: "recipe", title: "Lemon cake", note: "Try it", sharedBy: "Ada", count: 1, imagePath: recipe.imageUrl, recipe };

describe("share link <head>", () => {
  it("describes who shared what", () => {
    expect(shareDescription(one)).toBe("Shared by Ada · Bright & soft · Try it");
    expect(shareDescription({ ...one, kind: "set", title: null, sharedBy: null, note: null, count: 12, recipe: null })).toBe("Shared with Meally · 12 recipes");
  });

  it("renders absolute Open Graph tags and Recipe JSON-LD for one recipe", () => {
    const head = renderShareHead(one, "https://meally.example", "/s/t");
    expect(head).toContain('<meta property="og:title" content="Lemon cake" />');
    expect(head).toContain('<meta property="og:image" content="https://meally.example/api/v1/public/shares/t/recipes/lemon-cake/image/800" />');
    expect(head).toContain('<meta property="og:url" content="https://meally.example/s/t" />');
    expect(head).toContain('content="Shared by Ada · Bright &amp; soft · Try it"');
    expect(head).toContain('<meta name="robots" content="noindex, nofollow" />');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/.exec(head)![1]!);
    expect(ld).toMatchObject({ "@type": "Recipe", name: "Lemon cake", recipeIngredient: ["2 cups flour"], totalTime: "PT55M", recipeYield: "8", isBasedOn: "https://example.org/cake" });
    expect(ld.recipeInstructions).toEqual([{ "@type": "HowToStep", text: "Mix." }]);
  });

  it("sets and cookbooks get a preview but no JSON-LD", () => {
    const head = renderShareHead({ ...one, kind: "cookbook", title: "Weeknight", recipe: null, count: 5 }, "https://m.example", "/s/t");
    expect(head).toContain('content="Weeknight"');
    expect(head).not.toContain("ld+json");
  });

  it("can't be broken out of by a name or note", () => {
    const evil: ShareMeta = { ...one, title: '"><script>alert(1)</script>', note: "</script><script>alert(2)</script>", recipe: { ...recipe, name: "</script><b>x" } };
    const html = injectShareHead("<html><head><title>Meally</title></head><body></body></html>", evil, "https://m.example", "/s/t");
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toContain("<b>x");
    expect(html).toContain("<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Meally</title>");
  });

  it("leaves HTML without a head alone", () => {
    expect(injectShareHead("<p>hi</p>", one, "https://m.example", "/s/t")).toBe("<p>hi</p>");
  });

  it("omits empty times and yield in JSON-LD", () => {
    const ld = recipeJsonLd({ ...recipe, servings: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, sourceUrl: null, description: null }, null);
    expect(Object.keys(ld).sort()).toEqual(["@context", "@type", "name", "recipeIngredient", "recipeInstructions"]);
  });
});
