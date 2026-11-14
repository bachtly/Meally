import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { features, snaps } from "./mockApi";
import { Screen } from "./Screen";

const meta = {
  title: "Snap loop/2 Feed",
  component: Screen,
  args: { path: "/feed" },
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithSnaps: Story = {};

export const Months: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("tab", { name: "Months" }));
  },
};

export const FilterMenu: Story = {
  name: "Everyone filter",
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Everyone" }));
  },
};

export const MorePages: Story = {
  args: { routes: { "GET /snaps?*": [200, { items: Object.values(snaps), nextCursor: "c2" }] } },
};

export const Empty: Story = {
  args: { routes: { "GET /snaps?*": [200, { items: [], nextCursor: null }] } },
};

export const EmptyWithoutFriends: Story = {
  name: "Empty, Friends off",
  args: { routes: { "GET /snaps?*": [200, { items: [], nextCursor: null }], "GET /features": [200, features(["friends"])] } },
};

export const Loading: Story = { args: { routes: { "GET /snaps?*": "pending" } } };

export const LoadError: Story = {
  args: { routes: { "GET /snaps?*": [500, { error: "internal", message: "Boom" }] } },
};

export const BrokenImage: Story = {
  args: {
    routes: {
      "GET /snaps?*": [
        200,
        {
          items: [
            {
              id: "s9",
              author: { id: "f1", name: "Ana" },
              imageUrl: "/api/v1/missing.jpg",
              thumbUrl: "/api/v1/missing.jpg",
              caption: "Photo failed to load",
              dishName: null,
              place: null,
              recipe: null,
              createdAt: Date.now() - 600_000,
              myReactions: [],
            },
          ],
          nextCursor: null,
        },
      ],
    },
  },
};
