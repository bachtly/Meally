import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { clearDrafts, installCamera, Screen } from "./Screen";

/** A real PNG of a dish, so the composer preview and the upload resize work as with a camera shot. */
async function dishPhoto(): Promise<File> {
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 800;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6b5a44";
  g.fillRect(0, 0, 600, 800);
  g.fillStyle = "#efe9df";
  g.beginPath();
  g.arc(300, 400, 230, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#c27a3a";
  g.beginPath();
  g.arc(300, 400, 190, 0, Math.PI * 2);
  g.fill();
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "dish.png", { type: "image/png" });
}

async function pickPhoto(canvasElement: HTMLElement) {
  // "Upload" with the camera on, "Choose photo" with it off: both are a labelled file input.
  await within(canvasElement).findByRole("button", { name: "Take photo" });
  const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
  if (input) await userEvent.upload(input, await dishPhoto());
}

const meta = {
  title: "Snap loop/1 Snap home",
  component: Screen,
  args: { path: "/" },
  loaders: [clearDrafts],
  beforeEach: () => installCamera("live"),
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CameraOn: Story = {};

export const CameraOnNarrow: Story = {
  name: "Camera on, 360 px (Recipes link)",
  globals: { viewport: { value: "phone", isRotated: false } },
};

export const CameraOff: Story = { beforeEach: () => installCamera("off") };

export const Composer: Story = {
  play: async ({ canvasElement }) => pickPhoto(canvasElement),
};

export const ComposerEatenOut: Story = {
  play: async ({ canvasElement }) => {
    await pickPhoto(canvasElement);
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Eaten out" }));
    await userEvent.type(await body.findByLabelText("Dish"), "Pho bo");
    await userEvent.type(await body.findByLabelText("Place"), "Cafe Lu");
  },
};

export const ComposerWithRecipe: Story = {
  play: async ({ canvasElement }) => {
    await pickPhoto(canvasElement);
    const body = within(document.body);
    await userEvent.type(await body.findByLabelText("Caption"), "Sunday ramen");
    await userEvent.click(await body.findByRole("button", { name: "Recipe" }));
    await userEvent.click(await body.findByRole("button", { name: "Tonkotsu ramen" }));
  },
};

export const Menu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Menu" }));
  },
};

export const FriendsSheet: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /friends/ }));
  },
};

export const SendFails: Story = {
  args: { routes: { "POST /snaps": [503, { error: "unavailable", message: "Try again" }] } },
  play: async ({ canvasElement }) => {
    await pickPhoto(canvasElement);
    await userEvent.click(await within(document.body).findByRole("button", { name: "Send" }));
  },
};
