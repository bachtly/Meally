import type { Meta, StoryObj } from "@storybook/react-vite";
import { addDays, localToday, startOfWeek } from "../features/meal-plan/dates";
import { linkedRecipe, type Routes } from "./mockApi";
import { installCamera, Screen } from "./Screen";

/**
 * A preview of the app in dark mode by default: the main recipe-side screens and the Snap loop, all on the dark
 * theme, so the two halves can be judged side by side (issue #98). The theme toolbar is locked to dark here.
 */

/** A day of the week the Plan opens on: 0 is its Monday. */
const iso = (weekday: number) => addDays(startOfWeek(localToday()), weekday);
const at = new Date().toISOString();

const summary = (id: string, slug: string, name: string, totalMinutes: number | null) => ({
  id,
  slug,
  name,
  imageUrl: id === "r1" ? linkedRecipe.imageUrl : null,
  totalMinutes,
});

const item = (id: string, text: string, checked = false, recipe?: { slug: string; name: string }) => ({
  id,
  listId: "l1",
  text,
  quantity: null,
  unit: null,
  food: null,
  note: null,
  aisle: null,
  checked,
  position: Number(id.slice(1)),
  recipeRefs: recipe ? [recipe] : [],
  updatedAt: at,
});

const ramen = { slug: "tonkotsu-ramen", name: "Tonkotsu ramen" };

const routes: Routes = {
  "GET /recipes/tonkotsu-ramen": [200, linkedRecipe],
  "GET /recipes/tonkotsu-ramen/timeline*": [200, { items: [], nextCursor: null }],
  "GET /meal-plan?*": [
    200,
    {
      items: [
        { id: "e1", date: iso(0), mealType: "dinner", title: null, note: null, position: 0, recipe: summary("r1", "tonkotsu-ramen", "Tonkotsu ramen", 750) },
        { id: "e2", date: iso(2), mealType: "lunch", title: null, note: null, position: 0, recipe: summary("r3", "banh-mi", "Banh mi", 25) },
        { id: "e3", date: iso(3), mealType: "dinner", title: "Leftovers", note: "Use up the broth", position: 0, recipe: null },
      ],
    },
  ],
  "GET /meal-plan/rules": [200, { items: [] }],
  "GET /shopping/lists": [200, { items: [{ id: "l1", name: "This week", total: 5, checked: 1, createdAt: at, updatedAt: at }] }],
  "GET /shopping/lists/l1": [
    200,
    {
      list: { id: "l1", name: "This week", total: 5, checked: 1, createdAt: at, updatedAt: at },
      items: [
        item("i1", "1.5 kg pork bones", false, ramen),
        item("i2", "4 portions fresh ramen noodles", false, ramen),
        item("i3", "2 tbsp white miso", false, ramen),
        item("i4", "Baguettes", false),
        item("i5", "Spring onions", true, ramen),
      ],
    },
  ],
  "GET /shopping/aisles": [200, { items: [] }],
};

function DarkScreen({ path, camera }: { path: string; camera?: boolean }) {
  if (camera) installCamera("live");
  return <Screen path={path} routes={routes} />;
}

const meta = {
  title: "Dark by default/Screens",
  component: DarkScreen,
  globals: { theme: "dark" },
} satisfies Meta<typeof DarkScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Recipes: Story = { args: { path: "/recipes" } };
export const Recipe: Story = { args: { path: "/recipes/tonkotsu-ramen" } };
export const Plan: Story = { args: { path: "/plan" } };
export const ShoppingList: Story = { name: "Shopping list", args: { path: "/shopping/l1" } };
export const Settings: Story = { args: { path: "/settings" } };
export const Camera: Story = { args: { path: "/", camera: true } };
export const Feed: Story = { args: { path: "/feed" } };
export const SnapViewer: Story = { name: "Snap viewer", args: { path: "/snaps/s1" } };
