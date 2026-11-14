import type { Meta, StoryObj } from "@storybook/react-vite";
import { friends } from "./mockApi";
import { Screen } from "./Screen";

const meta = {
  title: "Snap loop/4 Friends",
  component: Screen,
  args: { path: "/friends" },
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {};

export const Empty: Story = {
  args: { routes: { "GET /friends": [200, { items: [], cap: 20 }], "GET /friends/invites": [200, { items: [] }] } },
};

export const AtCap: Story = {
  name: "At the Friend cap",
  args: {
    routes: {
      "GET /friends": [200, { items: friends, cap: 3 }],
      "POST /friends/invites": [409, { error: "friend_cap", message: "You can have at most 3 friends" }],
    },
  },
};

export const Loading: Story = { args: { routes: { "GET /friends": "pending" } } };

export const LoadError: Story = { args: { routes: { "GET /friends": [500, { error: "internal", message: "Boom" }] } } };

export const AcceptInvite: Story = { name: "Accept invite", args: { path: "/invite/tok" } };

export const AcceptInviteSignedOut: Story = {
  name: "Accept invite, signed out",
  args: { path: "/invite/tok", routes: { "GET /auth/me": [401, { error: "unauthenticated", message: "Sign in" }] } },
};

export const InviteDeadLink: Story = {
  name: "Invite used or expired",
  args: { path: "/invite/tok", routes: { "GET /friends/invites/tok": [404, { error: "not_found", message: "Not found" }] } },
};
