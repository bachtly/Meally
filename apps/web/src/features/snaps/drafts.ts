/**
 * The one unsent Snap, kept in IndexedDB until the server confirms it. It survives a reload or a closed tab and
 * keeps its `clientId`, so a retry can never make a second Snap. Without IndexedDB (private mode, old browsers)
 * it falls back to memory and only lives as long as the page.
 */
export interface Draft {
  clientId: string;
  file: Blob;
  fileName: string;
  caption: string;
  eatenOut: boolean;
  dishName: string;
  place: string;
  createdAt: number;
}

export interface DraftStore {
  get(): Promise<Draft | null>;
  put(draft: Draft): Promise<void>;
  clear(): Promise<void>;
}

const DB = "meally-snaps";
const STORE = "drafts";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export function memoryDraftStore(): DraftStore {
  let held: Draft | null = null;
  return {
    get: async () => held,
    put: async (d) => {
      held = d;
    },
    clear: async () => {
      held = null;
    },
  };
}

export function indexedDbDraftStore(): DraftStore {
  const fallback = memoryDraftStore();
  const usable = typeof indexedDB !== "undefined";
  // A failing database (blocked, quota) must not stop a Snap from being sent, so each call falls back.
  return {
    get: async () => (usable ? ((await run<Draft | undefined>("readonly", (s) => s.get(KEY)).catch(() => undefined)) ?? (await fallback.get())) : fallback.get()),
    put: async (d) => {
      await fallback.put(d);
      if (usable) await run("readwrite", (s) => s.put(d, KEY)).catch(() => undefined);
    },
    clear: async () => {
      await fallback.clear();
      if (usable) await run("readwrite", (s) => s.delete(KEY)).catch(() => undefined);
    },
  };
}

export const draftStore: DraftStore = indexedDbDraftStore();

export const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
