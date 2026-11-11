// Renders public/icon.svg to the PNG icons the manifest references. Run: node apps/web/scripts/make-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../public/", import.meta.url));
const svg = readFileSync(dir + "icon.svg");
for (const size of [192, 512]) await sharp(svg, { density: 384 }).resize(size, size).png().toFile(`${dir}icon-${size}.png`);
// Maskable: full-bleed warm square with the mark scaled into the central safe zone (80%).
const inner = await sharp(svg, { density: 384 }).resize(Math.round(512 * 0.7), Math.round(512 * 0.7)).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#c2562b" } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(dir + "icon-maskable-512.png");
await sharp(svg, { density: 384 }).resize(180, 180).png().toFile(dir + "apple-touch-icon.png");
