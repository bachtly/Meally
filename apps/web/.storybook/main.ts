import type { StorybookConfig } from "@storybook/react-vite";
import type { PluginOption } from "vite";

const isPwa = (p: PluginOption): boolean =>
  Array.isArray(p) ? p.some(isPwa) : !!p && typeof p === "object" && "name" in p && String(p.name).startsWith("vite-plugin-pwa");

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
  // Stories render whole screens; prop tables add build time and nothing to read.
  typescript: { reactDocgen: false },
  // The service worker would cache Storybook's own files; stories don't need it.
  viteFinal: (c) => ({ ...c, plugins: (c.plugins ?? []).filter((p) => !isPwa(p)) }),
};

export default config;
