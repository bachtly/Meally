/**
 * Platform ports: the few places where the server touches the host (files, in-process timers and
 * pub/sub, password hashing). Features depend on these interfaces; `adapters/node` implements them
 * for the long-running Node server, and other platforms can supply their own.
 */
import type { ImageSize } from "@meally/shared";

export interface StoredImage {
  bytes: Uint8Array;
  contentType: string;
}

/** Formats a browser may send for pre-sized parts. Safari cannot encode WebP from a canvas, so it sends JPEG. */
export type SizedImageType = "image/webp" | "image/jpeg";

/** One ready-made size, with the format sniffed from its bytes (never the client's claim). */
export interface SizedImage {
  bytes: Uint8Array;
  contentType: SizedImageType;
}

/**
 * Stores user images. `putOriginal` accepts an upload and does the processing (the Node
 * adapter resizes with sharp); `put` stores bytes that were already resized, which is what a
 * platform without sharp would call after resizing elsewhere.
 */
export interface ImageStore {
  /** True when clients should resize in the browser and upload ready-made sizes (no sharp on this platform). */
  readonly acceptsPresized: boolean;
  /** Processes an uploaded original into every size and returns the new image id. */
  putOriginal(userId: string, original: Uint8Array): Promise<string>;
  /** Stores a complete set of ready-made sizes under a new image id and returns it. Partial sets are cleaned up. */
  putSized(userId: string, sizes: Record<ImageSize, SizedImage>): Promise<string>;
  put(userId: string, imageId: string, size: ImageSize, bytes: Uint8Array, contentType: string): Promise<void>;
  get(userId: string, imageId: string, size: ImageSize): Promise<StoredImage | null>;
  /** Removes every size of the image. Missing files are not an error. */
  delete(userId: string, imageId: string): Promise<void>;
  /**
   * Moves every stored file of one owner folder to another (the rekey from household ids to user ids).
   * Copies before it deletes and skips files already copied, so a crashed run is safe to repeat.
   * Returns the number of files it copied or removed.
   */
  moveOwner(fromOwnerId: string, toOwnerId: string): Promise<number>;
  /** Set when images live in a local directory, so backups can read them. */
  readonly localDir?: string;
}

export type Unsubscribe = () => void;

/** Publish/subscribe by channel name. Subscribers only receive events published after they subscribe. */
export interface Events {
  /** False when the platform cannot hold a connection open, so SSE routes must not be offered. */
  readonly supportsStreaming: boolean;
  publish(channel: string, event: unknown): void | Promise<void>;
  subscribe(channel: string, cb: (event: unknown) => void): Unsubscribe;
}

/**
 * Named background jobs. Handlers MUST be idempotent: a platform cron may run a job twice or late,
 * and a one-off may be delivered again after a restart.
 */
export interface Scheduler {
  /** True when a handler is registered for the name. */
  has(name: string): boolean;
  /** Registers the handler for a job name. Re-registering replaces it. */
  define(name: string, handler: (payload?: unknown) => void | Promise<void>): void;
  /** Runs the job every `ms`; `firstInMs` also runs it once after that delay. */
  every(name: string, ms: number, opts?: { firstInMs?: number }): void;
  /** Runs the job every day at local "HH:MM". */
  daily(name: string, time: string): void;
  /** Runs the job once after `delayMs` with `payload` (webhook retries, import jobs). */
  runAfter(name: string, delayMs: number, payload?: unknown): void;
  /** Runs a job now. A cron route calls this on platforms without timers. */
  runJob(name: string, payload?: unknown): Promise<void>;
  /** Cancels every pending timer. */
  stop(): void;
}

export interface VerifyResult {
  ok: boolean;
  /** True when the stored hash uses an older scheme or weaker parameters than `hash` would produce. */
  needsRehash: boolean;
}

/** Hash strings are versioned by prefix (`scrypt$...`) so a scheme can change without a migration. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<VerifyResult>;
}

/** What the admin info page shows about the host. */
export interface PlatformInfo {
  runtime: string;
  uptimeSeconds: number;
  dbBytes: number;
  imagesBytes: number;
  dataDir: string;
}

export interface Platform {
  name: "node" | (string & {});
  images: ImageStore;
  events: Events;
  scheduler: Scheduler;
  hasher: PasswordHasher;
  /** Host details for the admin page; platforms without a data directory omit it. */
  info?(dataDir: string): Promise<PlatformInfo>;
}
