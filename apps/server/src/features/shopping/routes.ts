import { jsonWithEtag } from "../../lib/etag.js";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addMealPlanInput,
  addRecipeInput,
  aisleInput,
  aisleOrderInput,
  aislePatch,
  shoppingItemInput,
  shoppingItemPatch,
  shoppingListInput,
  z,
} from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { daysBetween } from "../mealplan/service.js";
import { ShoppingBus } from "./bus.js";
import * as svc from "./service.js";

function body<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  const p = schema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new ApiError(
      400,
      "invalid_body",
      `${i?.path.length ? `${i.path.join(".")}: ` : ""}${i?.message ?? "Invalid request"}`,
    );
  }
  return p.data;
}
const json = (c: Context<AppEnv>) => c.req.json().catch(() => null);
const ctx = (c: Context<AppEnv>) =>
  [c.get("db"), c.get("userId")] as const;
const HEARTBEAT_MS = 25_000;

export const shoppingRoutes = new Hono<AppEnv>();
shoppingRoutes.use("*", requireAuth, requireFeature("shopping-lists"));

shoppingRoutes
  .get("/aisles", async (c) =>
    c.json({ items: await svc.listAisles(...ctx(c)) }),
  )
  .post("/aisles", async (c) =>
    c.json(
      await svc.createAisle(...ctx(c), body(await json(c), aisleInput)),
      201,
    ),
  )
  .put("/aisles/order", async (c) =>
    c.json({
      items: await svc.reorderAisles(
        ...ctx(c),
        body(await json(c), aisleOrderInput).ids,
      ),
    }),
  )
  .patch("/aisles/:id", async (c) =>
    c.json(
      await svc.updateAisle(
        ...ctx(c),
        c.req.param("id"),
        body(await json(c), aislePatch),
      ),
    ),
  )
  .delete("/aisles/:id", async (c) => {
    await svc.deleteAisle(...ctx(c), c.req.param("id"));
    return c.body(null, 204);
  })
  .get("/lists", async (c) => jsonWithEtag(c, { items: await svc.listLists(...ctx(c)) }))
  .post("/lists", async (c) =>
    c.json(
      await svc.createList(
        ...ctx(c),
        body(await json(c), shoppingListInput).name,
      ),
      201,
    ),
  )
  .get("/lists/:id", async (c) =>
    jsonWithEtag(c, await svc.getListWithItems(...ctx(c), c.req.param("id"))),
  )
  .patch("/lists/:id", async (c) =>
    c.json(
      await svc.renameList(
        ...ctx(c),
        c.req.param("id"),
        body(await json(c), shoppingListInput).name,
      ),
    ),
  )
  .delete("/lists/:id", async (c) => {
    await svc.deleteList(...ctx(c), c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/lists/:id/items", async (c) =>
    c.json(
      {
        items: await svc.addFreeText(
          ...ctx(c),
          c.req.param("id"),
          body(await json(c), shoppingItemInput).text,
        ),
      },
      201,
    ),
  )
  .patch("/lists/:id/items/:itemId", async (c) =>
    c.json(
      await svc.patchItem(
        ...ctx(c),
        c.req.param("id"),
        c.req.param("itemId"),
        body(await json(c), shoppingItemPatch),
      ),
    ),
  )
  .delete("/lists/:id/items/:itemId", async (c) => {
    await svc.deleteItem(...ctx(c), c.req.param("id"), c.req.param("itemId"));
    return c.body(null, 204);
  })
  .post("/lists/:id/clear-checked", async (c) =>
    c.json({ removed: await svc.clearChecked(...ctx(c), c.req.param("id")) }),
  )
  .post("/lists/:id/add-recipe", async (c) => {
    const b = body(await json(c), addRecipeInput);
    return c.json({
      items: await svc.addRecipe(
        ...ctx(c),
        c.req.param("id"),
        b.slug,
        b.servings,
      ),
    });
  })
  .post("/lists/:id/add-meal-plan", async (c) => {
    const b = body(await json(c), addMealPlanInput);
    const span = daysBetween(b.from, b.to);
    if (span < 0 || span + 1 > 62)
      throw new ApiError(400, "invalid_range", "Use a range of 1 to 62 days");
    return c.json({
      items: await svc.addMealPlan(...ctx(c), c.req.param("id"), b.from, b.to),
    });
  })
  .get("/lists/:id/events", async (c) => {
    if (!c.get("platform").events.supportsStreaming) throw new ApiError(501, "not_configured", "Live updates are not available on this deployment");
    const [db, userId] = ctx(c);
    const listId = c.req.param("id");
    await svc.assertList(db, userId, listId);
    return streamSSE(c, async (stream) => {
      const off = new ShoppingBus(c.get("platform").events).subscribe(
        userId,
        listId,
        (e) =>
          void stream
            .writeSSE({ event: e.type, data: JSON.stringify(e) })
            .catch(() => {}),
      );
      const beat = setInterval(
        () => void stream.writeSSE({ event: "ping", data: "" }).catch(() => {}),
        HEARTBEAT_MS,
      );
      const done = new Promise<void>((resolve) => stream.onAbort(resolve));
      await stream.writeSSE({ event: "ready", data: "{}" });
      await done;
      clearInterval(beat);
      off();
    });
  });
