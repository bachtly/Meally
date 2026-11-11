/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { runtimeCaching } from "./pwa/runtimeCaching";

// generateSW (not injectManifest): our rules are plain strategies with no custom SW code, so a declarative
// config is simpler, testable, and gets the SKIP_WAITING message handler for the update prompt for free.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false, // registration is flag-gated at runtime (src/pwa/register.ts)
      includeAssets: ["favicon.png", "logo.png", "apple-touch-icon.png"],
      manifest: {
        name: "Meally",
        short_name: "Meally",
        description: "Your household's recipes, meal plan and shopping list.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#fcf8f2",
        background_color: "#fceee3",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        share_target: { action: "/recipes/import", method: "GET", params: { url: "url", text: "text", title: "title" } },
        shortcuts: [
          { name: "New recipe", url: "/recipes/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
          { name: "Plan", url: "/plan", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
          { name: "Shopping", url: "/shopping", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Never serve the app shell for API calls (auth, admin, SSE, public share JSON).
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching,
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8080" } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
