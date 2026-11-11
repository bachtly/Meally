import type { Platform } from "../../ports/index.js";
import { createDiskImageStore } from "./images.js";
import { NodeEvents } from "./events.js";
import { createNodeScheduler } from "./scheduler.js";
import { createScryptHasher } from "./hasher.js";

export { imagePath, createDiskImageStore } from "./images.js";
export { NodeEvents } from "./events.js";
export { createNodeScheduler } from "./scheduler.js";
export { createScryptHasher } from "./hasher.js";

export function createNodePlatform(opts: { dataDir: string; scryptLogN?: number }): Platform {
  return {
    name: "node",
    images: createDiskImageStore(opts.dataDir),
    events: new NodeEvents(),
    scheduler: createNodeScheduler(),
    hasher: createScryptHasher(opts.scryptLogN),
  };
}
