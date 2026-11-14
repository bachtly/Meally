import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { Snap, SnapListResponse } from "@meally/shared";
import { OFFLINE_STORAGE_KEYS } from "../../../pwa/runtimeCaching";
import { api } from "../../lib/api";
import { metaQuery } from "../../lib/meta";
import { useSession } from "../auth/useSession";
import { buildImageForm } from "../recipes/upload";
import type { Draft } from "./drafts";

export const feedKey = ["snaps", "feed"] as const;

/** localStorage key for the last first page of the Feed this device saw. Removed on sign-out (clearOfflineCaches). */
export const FEED_STORE_KEY = OFFLINE_STORAGE_KEYS[0]!;

interface StoredFeed {
  userId: string;
  page: SnapListResponse;
}

/** The stored first page, only if it belongs to this user: a shared device never shows one user's Feed to another. */
export function readStoredFeed(userId: string | undefined): InfiniteData<SnapListResponse, string | undefined> | undefined {
  if (!userId) return undefined;
  try {
    const raw = localStorage.getItem(FEED_STORE_KEY);
    const stored = raw ? (JSON.parse(raw) as StoredFeed) : undefined;
    if (stored?.userId !== userId || !Array.isArray(stored.page?.items)) return undefined;
    return { pages: [stored.page], pageParams: [undefined] };
  } catch {
    return undefined;
  }
}

function writeStoredFeed(userId: string, page: SnapListResponse) {
  try {
    localStorage.setItem(FEED_STORE_KEY, JSON.stringify({ userId, page } satisfies StoredFeed));
  } catch {
    // storage full or blocked: we just lose the instant start
  }
}

/**
 * The Feed, newest first. Local-first: the last first page this device saw renders at once, and updatedAt 0 marks
 * it stale so it revalidates in the background (the same pattern useSession uses for the session).
 */
export function useFeed() {
  const userId = useSession().user?.id;
  return useInfiniteQuery({
    queryKey: feedKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ limit: "10" });
      if (pageParam) p.set("cursor", pageParam);
      const page = await api<SnapListResponse>(`/snaps?${p}`);
      if (!pageParam && userId) writeStoredFeed(userId, page);
      return page;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialData: () => readStoredFeed(userId),
    initialDataUpdatedAt: 0,
  });
}

/** The Snap with this id in the loaded Feed, if it is there. */
export function snapFromFeed(data: InfiniteData<SnapListResponse> | undefined, id: string): Snap | undefined {
  for (const p of data?.pages ?? []) {
    const s = p.items.find((x) => x.id === id);
    if (s) return s;
  }
  return undefined;
}

/** Sends a draft. The same `clientId` goes out on every retry, so the server answers 200 with the first Snap. */
export function useSendSnap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: Draft) => {
      const file = d.file instanceof File ? d.file : new File([d.file], d.fileName, { type: d.file.type });
      const body = await buildImageForm(file, (await qc.fetchQuery(metaQuery)).presizedImages);
      body.append("clientId", d.clientId);
      if (d.caption.trim()) body.append("caption", d.caption.trim());
      if (d.eatenOut && d.dishName.trim()) body.append("dishName", d.dishName.trim());
      if (d.eatenOut && d.place.trim()) body.append("place", d.place.trim());
      if (!d.eatenOut && d.recipe) body.append("recipeId", d.recipe.id);
      return api<Snap>("/snaps", { method: "POST", body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feedKey }),
  });
}
