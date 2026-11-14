import type { Preview } from "@storybook/react-vite";
import { applyTheme } from "../src/ui";
import "../src/index.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        phone: { name: "Phone 360", styles: { width: "360px", height: "780px" } },
        phoneL: { name: "Phone 390", styles: { width: "390px", height: "844px" } },
        tablet: { name: "Tablet 768", styles: { width: "768px", height: "1024px" } },
        desktop: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" } },
      },
    },
    a11y: { test: "todo" },
  },
  initialGlobals: { viewport: { value: "phoneL", isRotated: false }, theme: "dark" },
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: { title: "Theme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true },
    },
  },
  decorators: [
    (Story, ctx) => {
      applyTheme(ctx.globals.theme === "dark" ? "dark" : "light");
      return <Story />;
    },
  ],
};

export default preview;
