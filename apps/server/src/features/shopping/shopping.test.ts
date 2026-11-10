import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseIngredient } from "@meally/shared";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { ShoppingBus } from "./bus.js";
import { normalizeFood } from "./service.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-shop-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const app = createApp({
    env: { MEALLY_SIGNUP_MODE: "open", ...env },
    scryptLogN: 10,
    dataDir,
  });
  const su = async (p: string, email: string) => {
    const r = await app.request(`/api/v1/auth/${p}`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ email, name: "n", password: "correct horse" }),
    });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com");
  const B = await su("register", "b@example.com");
  const call = (cookie: string, method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, {
      method,
      headers: { ...H, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (r: Response) => (await r.json()) as any;
  const list = async (cookie = A) =>
    (
      await json(
        await call(cookie, "POST", "/shopping/lists", { name: "Weekly" }),
      )
    ).id as string;
  const recipe = (
    name: string,
    servings: number | null,
    ingredients: string[],
  ) =>
    call(A, "POST", "/recipes", {
      name,
      servings,
      ingredients: ingredients.map((raw) => {
        const p = parseIngredient(raw);
        return { raw, quantity: p.quantity, unit: p.unit, food: p.food, note: p.note };
      }),
    });
  return { app, A, B, call, json, list, recipe };
}

describe("shopping bus", () => {
  it("emits to the right list and household only, and unsubscribes", () => {
    const bus = new ShoppingBus();
    const got: string[] = [];
    const off = bus.subscribe("h1", "l1", (e) => got.push(`a:${e.type}`));
    bus.subscribe("h2", "l1", (e) => got.push(`b:${e.type}`));
    bus.emit("h1", "l1");
    bus.emit("h1", "l2");
    bus.emit("h1", "l1", "deleted");
    expect(got).toEqual(["a:items", "a:deleted"]);
    off();
    expect(bus.listenerCount("h1", "l1")).toBe(0);
    bus.emit("h1", "l1");
    expect(got).toHaveLength(2);
  });
});

describe("normalizeFood", () => {
  it("folds case and plurals", () => {
    expect(normalizeFood(" Onions ")).toBe("onion");
    expect(normalizeFood("berries")).toBe("berry");
    expect(normalizeFood("Hummus")).toBe("hummus");
  });
});

describe("shopping API", () => {
  it("merges recipe ingredients", async () => {
    const { A, call, json, list, recipe } = await mk();
    const id = await list();
    await recipe("One", 2, [
      "2 tbsp olive oil",
      "1 cup milk",
      "2 onions",
      "1 can tomatoes",
      "salt",
    ]);
    await recipe("Two", 2, [
      "1 tbsp olive oil",
      "250 ml milk",
      "1 onion",
      "100 g tomatoes",
      "1 can tomatoes",
    ]);
    await call(A, "POST", `/shopping/lists/${id}/add-recipe`, { slug: "one" });
    await call(A, "POST", `/shopping/lists/${id}/add-recipe`, { slug: "two" });
    const { items } = await json(await call(A, "GET", `/shopping/lists/${id}`));
    const by = (f: string) => items.filter((i: any) => i.food === f);
    expect(by("olive oil")).toHaveLength(1);
    expect(by("olive oil")[0]).toMatchObject({
      quantity: 3,
      unit: "tbsp",
      text: "3 tbsp olive oil",
    });
    expect(by("olive oil")[0].recipeRefs.map((r: any) => r.slug)).toEqual([
      "one",
      "two",
    ]);
    expect(by("milk")).toHaveLength(1);
    expect(by("milk")[0].unit).toBe("cup");
    expect(by("milk")[0].quantity).toBeCloseTo(2.057, 2);
    expect(items.filter((i: any) => /onion/.test(i.food))).toHaveLength(1);
    expect(items.find((i: any) => /onion/.test(i.food))).toMatchObject({
      quantity: 3,
      unit: null,
    });
    // 1 can + 100 g tomatoes cannot merge; the second can merges into the first
    expect(by("tomatoes")).toHaveLength(2);
    expect(by("tomatoes").find((i: any) => i.unit === "can").quantity).toBe(2);
    expect(by("salt")).toHaveLength(1);
  });

  it("scales by servings and does not merge into checked items", async () => {
    const { A, call, json, list, recipe } = await mk();
    const id = await list();
    await recipe("Soup", 2, ["200 g carrots"]);
    const first = await json(
      await call(A, "POST", `/shopping/lists/${id}/add-recipe`, {
        slug: "soup",
        servings: 4,
      }),
    );
    expect(first.items[0]).toMatchObject({ quantity: 400, unit: "g" });
    await call(A, "PATCH", `/shopping/lists/${id}/items/${first.items[0].id}`, {
      checked: true,
    });
    await call(A, "POST", `/shopping/lists/${id}/add-recipe`, { slug: "soup" });
    const { items } = await json(await call(A, "GET", `/shopping/lists/${id}`));
    expect(items).toHaveLength(2);
  });

  it("adds free text and remembers aisles", async () => {
    const { A, call, json, list } = await mk();
    const id = await list();
    const aisles = (await json(await call(A, "GET", "/shopping/aisles"))).items;
    expect(aisles.map((a: any) => a.name)).toContain("Dairy & eggs");
    const dairy = aisles.find((a: any) => a.name === "Dairy & eggs").id;
    const added = await json(
      await call(A, "POST", `/shopping/lists/${id}/items`, {
        text: "2 cups milk",
      }),
    );
    expect(added.items[0]).toMatchObject({
      food: "milk",
      quantity: 2,
      unit: "cup",
      aisle: dairy,
    });
    await call(A, "PATCH", `/shopping/lists/${id}/items/${added.items[0].id}`, {
      aisle: dairy,
    });
    const again = await json(
      await call(A, "POST", `/shopping/lists/${id}/items`, {
        text: "1 l Milk",
      }),
    );
    expect(again.items[0].aisle).toBe(dairy);
    const id2 = await list();
    const third = await json(
      await call(A, "POST", `/shopping/lists/${id2}/items`, { text: "milk" }),
    );
    expect(third.items[0].aisle).toBe(dairy);
    await call(A, "DELETE", `/shopping/aisles/${dairy}`);
    const { items } = await json(await call(A, "GET", `/shopping/lists/${id}`));
    expect(items.every((i: any) => i.aisle === null)).toBe(true);
  });

  it("guesses aisles, and a remembered aisle overrides the guess", async () => {
    const { A, call, json, list } = await mk();
    const id = await list();
    const aisles = (await json(await call(A, "GET", "/shopping/aisles"))).items;
    const by = (n: string) => aisles.find((a: any) => a.name === n).id;
    const add = async (text: string) =>
      (await json(await call(A, "POST", `/shopping/lists/${id}/items`, { text })))
        .items[0];
    const onion = await add("2 onions");
    expect(onion.aisle).toBe(by("Produce"));
    expect((await add("xylitol")).aisle).toBeNull();
    await call(A, "PATCH", `/shopping/lists/${id}/items/${onion.id}`, {
      aisle: by("Pantry"),
    });
    await call(A, "DELETE", `/shopping/lists/${id}/items/${onion.id}`);
    expect((await add("1 onion")).aisle).toBe(by("Pantry"));
    // Guess is skipped when the household deleted that aisle.
    await call(A, "DELETE", `/shopping/aisles/${by("Bakery")}`);
    expect((await add("bread")).aisle).toBeNull();
  });

  it("aisle labels CRUD and reorder", async () => {
    const { A, call, json } = await mk();
    const a = (await json(await call(A, "GET", "/shopping/aisles"))).items;
    expect(a).toHaveLength(10);
    const created = await json(
      await call(A, "POST", "/shopping/aisles", {
        name: "Pets",
        color: "#abc",
      }),
    );
    expect(created.position).toBe(10);
    const ids = [created.id, ...a.map((x: any) => x.id)];
    const re = (
      await json(await call(A, "PUT", "/shopping/aisles/order", { ids }))
    ).items;
    expect(re[0].name).toBe("Pets");
    expect(
      (await call(A, "PUT", "/shopping/aisles/order", { ids: ["nope"] }))
        .status,
    ).toBe(400);
    expect(
      (
        await json(
          await call(A, "PATCH", `/shopping/aisles/${created.id}`, {
            name: "Pet food",
          }),
        )
      ).name,
    ).toBe("Pet food");
  });

  it("clears checked items", async () => {
    const { A, call, json, list } = await mk();
    const id = await list();
    const a = (
      await json(
        await call(A, "POST", `/shopping/lists/${id}/items`, { text: "eggs" }),
      )
    ).items[0];
    await call(A, "POST", `/shopping/lists/${id}/items`, { text: "bread" });
    await call(A, "PATCH", `/shopping/lists/${id}/items/${a.id}`, {
      checked: true,
    });
    expect(
      (await json(await call(A, "POST", `/shopping/lists/${id}/clear-checked`)))
        .removed,
    ).toBe(1);
    const { items, list: l } = await json(
      await call(A, "GET", `/shopping/lists/${id}`),
    );
    expect(items.map((i: any) => i.food)).toEqual(["bread"]);
    expect(l.total).toBe(1);
  });

  it("adds a meal plan range", async () => {
    const { A, call, json, list, recipe } = await mk();
    const id = await list();
    const r = await json(await recipe("Soup", null, ["1 onion"]));
    await call(A, "POST", "/meal-plan", {
      date: "2026-03-02",
      mealType: "dinner",
      recipeId: r.id,
    });
    await call(A, "POST", "/meal-plan", {
      date: "2026-03-03",
      mealType: "dinner",
      recipeId: r.id,
    });
    await call(A, "POST", "/meal-plan", {
      date: "2026-04-03",
      mealType: "dinner",
      recipeId: r.id,
    });
    const out = await json(
      await call(A, "POST", `/shopping/lists/${id}/add-meal-plan`, {
        from: "2026-03-01",
        to: "2026-03-07",
      }),
    );
    expect(out.items[0].quantity).toBe(2);
    expect(
      (
        await call(A, "POST", `/shopping/lists/${id}/add-meal-plan`, {
          from: "2026-03-07",
          to: "2026-03-01",
        })
      ).status,
    ).toBe(400);
  });

  it("streams events over SSE", async () => {
    const { A, call, list, app } = await mk();
    const id = await list();
    const res = await app.request(`/api/v1/shopping/lists/${id}/events`, {
      headers: { ...H, cookie: A },
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const read = async (until: string) => {
      let buf = "";
      while (!buf.includes(until))
        buf += dec.decode((await reader.read()).value);
      return buf;
    };
    expect(await read("ready")).toContain("event: ready");
    await call(A, "POST", `/shopping/lists/${id}/items`, { text: "milk" });
    expect(await read("items")).toContain("event: items");
    await reader.cancel();
  });

  it("isolates households", async () => {
    const { A, B, call, list, recipe } = await mk();
    const id = await list();
    const item = (await (
      await call(A, "POST", `/shopping/lists/${id}/items`, { text: "milk" })
    ).json()) as any;
    await recipe("Mine", null, ["1 egg"]);
    const aisle = (
      (await (await call(A, "GET", "/shopping/aisles")).json()) as any
    ).items[0].id;
    expect(
      ((await (await call(B, "GET", "/shopping/lists")).json()) as any).items,
    ).toEqual([]);
    const cases: [string, string, unknown?][] = [
      ["GET", `/shopping/lists/${id}`],
      ["PATCH", `/shopping/lists/${id}`, { name: "x" }],
      ["DELETE", `/shopping/lists/${id}`],
      ["POST", `/shopping/lists/${id}/items`, { text: "x" }],
      [
        "PATCH",
        `/shopping/lists/${id}/items/${item.items[0].id}`,
        { checked: true },
      ],
      ["DELETE", `/shopping/lists/${id}/items/${item.items[0].id}`],
      ["POST", `/shopping/lists/${id}/clear-checked`],
      ["POST", `/shopping/lists/${id}/add-recipe`, { slug: "mine" }],
      ["GET", `/shopping/lists/${id}/events`],
      ["PATCH", `/shopping/aisles/${aisle}`, { name: "x" }],
      ["DELETE", `/shopping/aisles/${aisle}`],
    ];
    for (const [m, u, b] of cases)
      expect((await call(B, m, u, b)).status, `${m} ${u}`).toBe(404);
    const idB = await list(B);
    expect(
      (
        await call(B, "POST", `/shopping/lists/${idB}/add-recipe`, {
          slug: "mine",
        })
      ).status,
    ).toBe(404);
    const own = (await (
      await call(B, "POST", `/shopping/lists/${idB}/items`, { text: "tea" })
    ).json()) as any;
    expect(
      (
        await call(
          B,
          "PATCH",
          `/shopping/lists/${idB}/items/${own.items[0].id}`,
          { aisle },
        )
      ).status,
    ).toBe(404);
  });

  it("is hidden when the flag is off", async () => {
    const { A, call } = await mk({ MEALLY_FEATURE_SHOPPING_LISTS: "off" });
    expect((await call(A, "GET", "/shopping/lists")).status).toBe(404);
  });
});
