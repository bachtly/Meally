import { randomUUID } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { RecipeInput } from "@meally/shared";
import { parseIngredient, recipeInputSchema } from "@meally/shared";
import { hashPassword } from "./features/auth/password.js";
import { createRecipe } from "./features/recipes/service.js";
import { createDb } from "./db/index.js";
import { households, users } from "./db/schema/index.js";
import { config } from "./lib/config.js";

export const DEMO_EMAIL = "demo@meally.local";
export const DEMO_PASSWORD = "demo-password";

const ing = (raw: string, section?: string) => {
  const { quantity, unit, food, note } = parseIngredient(raw);
  return { raw, section, quantity, unit, food, note };
};
const step = (text: string, section?: string) => ({ text, section });

export const SAMPLE_RECIPES: RecipeInput[] = [
  {
    name: "Lemon garlic pasta",
    description: "A fast weeknight pasta with a bright, buttery sauce.",
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 12,
    totalMinutes: 17,
    ingredients: [ing("200 g spaghetti"), ing("3 cloves garlic, sliced"), ing("1 lemon, zest and juice"), ing("40 g butter"), ing("Parsley, chopped")],
    steps: [
      step("Boil the spaghetti in well-salted water until just tender. Save a cup of the pasta water."),
      step("Melt the butter and soften the garlic over low heat for two minutes."),
      step("Toss the pasta in the pan with lemon zest, juice and a splash of pasta water. Finish with parsley."),
    ],
  },
  {
    name: "Overnight oats",
    description: "Make it tonight, eat it cold tomorrow.",
    servings: 1,
    prepMinutes: 5,
    totalMinutes: 5,
    notes: "Keeps for three days in the fridge.",
    ingredients: [ing("50 g rolled oats"), ing("120 ml milk"), ing("2 tbsp yoghurt"), ing("1 tsp honey"), ing("Berries, to serve")],
    steps: [step("Stir the oats, milk, yoghurt and honey in a jar."), step("Chill overnight, then top with berries.")],
  },
  {
    name: "Tomato soup",
    description: "Smooth, simple and good with toast.",
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 30,
    totalMinutes: 40,
    ingredients: [
      ing("1 onion, diced", "Base"),
      ing("2 tbsp olive oil", "Base"),
      ing("800 g canned tomatoes", "Soup"),
      ing("500 ml vegetable stock", "Soup"),
      ing("1 tsp sugar", "Soup"),
    ],
    steps: [
      step("Soften the onion in the oil for ten minutes.", "Base"),
      step("Add tomatoes, stock and sugar. Simmer for 20 minutes.", "Soup"),
      step("Blend until smooth and season to taste.", "Soup"),
    ],
  },
  {
    name: "Chickpea curry",
    description: "A one-pot dinner that tastes better the next day.",
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 25,
    totalMinutes: 35,
    sourceUrl: "https://example.com/chickpea-curry",
    ingredients: [ing("2 cans chickpeas, drained"), ing("1 onion"), ing("2 tbsp curry powder"), ing("400 ml coconut milk"), ing("200 g spinach")],
    steps: [
      step("Fry the onion and curry powder until fragrant."),
      step("Add chickpeas and coconut milk. Simmer for 20 minutes."),
      step("Stir in the spinach until it wilts. Serve with rice."),
    ],
  },
  {
    name: "Banana pancakes",
    description: "Three ingredients, no flour.",
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 10,
    totalMinutes: 15,
    ingredients: [ing("2 ripe bananas"), ing("2 eggs"), ing("Butter, for the pan")],
    steps: [step("Mash the bananas and beat in the eggs."), step("Cook small rounds in a buttered pan, about two minutes a side.")],
  },
  {
    name: "Sheet-pan veg and halloumi",
    description: "Roast everything together and call it dinner.",
    servings: 3,
    prepMinutes: 10,
    cookMinutes: 25,
    totalMinutes: 35,
    notes: "Swap in any root vegetable you have.",
    ingredients: [ing("1 courgette"), ing("1 red pepper"), ing("1 red onion"), ing("225 g halloumi"), ing("2 tbsp olive oil")],
    steps: [step("Heat the oven to 220 C. Chop the vegetables and toss with oil on a tray."), step("Roast 15 minutes, add sliced halloumi, roast 10 more.")],
  },
];

export async function seed(db: Awaited<ReturnType<typeof createDb>>["db"]) {
  const [existing] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (existing) return { created: false };
  const now = new Date();
  const householdId = randomUUID();
  const userId = randomUUID();
  await db.insert(households).values({ id: householdId, name: "Demo household", createdAt: now });
  await db.insert(users).values({
    id: userId,
    email: DEMO_EMAIL,
    name: "Demo",
    passwordHash: await hashPassword(DEMO_PASSWORD),
    role: "admin",
    householdId,
    createdAt: now,
  });
  for (const r of SAMPLE_RECIPES) await createRecipe(db, householdId, userId, recipeInputSchema.parse(r));
  return { created: true };
}

if (process.argv[1] && /seed\.[tj]s$/.test(process.argv[1])) {
  const { db, client } = await createDb(path.join(config.DATA_DIR, "meally.db"));
  const { created } = await seed(db);
  console.log(created ? `Seeded ${DEMO_EMAIL} / ${DEMO_PASSWORD} with ${SAMPLE_RECIPES.length} recipes` : "Demo user already exists; nothing to do");
  client.close();
}
