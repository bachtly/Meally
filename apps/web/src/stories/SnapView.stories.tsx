import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { linkedRecipe, snaps } from "./mockApi";
import { Screen } from "./Screen";

const meta = {
  title: "Snap loop/3 Snap view",
  component: Screen,
  args: { path: "/snaps/s1" },
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FriendsSnapWithRecipe: Story = { name: "Friend's Snap, with recipe" };

export const OwnEatOutSnap: Story = { name: "Own Eat-out snap, with reactions", args: { path: "/snaps/s2" } };

export const OwnSnapNoReactions: Story = {
  name: "Own Snap, no reactions",
  args: { path: "/snaps/s2", routes: { "GET /snaps/s2": [200, { ...snaps.pho, reactions: [] }] } },
};

export const OwnSnapMoreMenu: Story = {
  name: "Own Snap, More menu",
  args: { path: "/snaps/s2" },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "More" }));
  },
};

export const OwnSnapWhoReacted: Story = {
  name: "Own Snap, who reacted",
  args: { path: "/snaps/s2" },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /reacted/ }));
  },
};

export const OwnSnapLinkRecipe: Story = {
  name: "Own Snap, link a recipe",
  args: { path: "/snaps/s2" },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Link a recipe" }));
  },
};

export const DeleteConfirm: Story = {
  name: "Own Snap, delete confirm",
  args: { path: "/snaps/s2" },
  play: async ({ canvasElement }) => {
    const body = within(document.body);
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "More" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "Delete Snap" }));
  },
};

export const NotFound: Story = { name: "Not found (non-friend or deleted)", args: { path: "/snaps/s9" } };

export const Loading: Story = { args: { routes: { "GET /snaps/s1": "pending" } } };

export const LinkedRecipe: Story = { name: "Linked recipe", args: { path: "/snaps/s1/recipe" } };

export const LinkedRecipeAlreadySaved: Story = {
  name: "Linked recipe, already saved",
  args: { path: "/snaps/s1/recipe", routes: { "GET /snaps/s1/recipe": [200, { ...linkedRecipe, savedSlug: "tonkotsu-ramen-2" }] } },
};

export const LinkedRecipeSaveFails: Story = {
  name: "Linked recipe, save fails",
  args: { path: "/snaps/s1/recipe", routes: { "POST /snaps/s1/recipe/save": [500, { error: "internal", message: "Boom" }] } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Save to my recipes" }));
  },
};

export const LinkedRecipeGone: Story = {
  name: "Linked recipe, gone",
  args: { path: "/snaps/s1/recipe", routes: { "GET /snaps/s1/recipe": [404, { error: "not_found", message: "Not found" }] } },
};
