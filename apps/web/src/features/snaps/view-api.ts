import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { PublicRecipe, ReactionKey, Recipe, Snap, SnapListResponse } from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";
import { feedKey, snapFromFeed } from "./api";

/**
 * One Snap. Opened from the grid it renders at once from the Feed cache (as old as the Feed), then revalidates.
 */
export function useSnap(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["snaps", "one", id],
    queryFn: () => api<Snap>(`/snaps/${encodeURIComponent(id)}`),
    retry: false,
    initialData: () => snapFromFeed(qc.getQueryData<InfiniteData<SnapListResponse>>(feedKey), id),
    initialDataUpdatedAt: () => qc.getQueryState(feedKey)?.dataUpdatedAt,
  });
}

/** The Linked recipe as the server sends it: a full recipe plus the viewer's own copy, if there is one. */
export type LinkedRecipe = Recipe & { savedSlug: string | null };

export const useLinkedRecipe = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["snaps", "recipe", id],
    queryFn: () => api<LinkedRecipe>(`/snaps/${encodeURIComponent(id)}/recipe`),
    enabled,
    retry: false,
  });

/** 201 and 200 both mean "you have a copy now". */
export function useSaveLinkedRecipe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<{ slug: string }>(`/snaps/${encodeURIComponent(id)}/recipe/save`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recipes"] });
      void qc.invalidateQueries({ queryKey: ["snaps", "recipe", id] });
    },
  });
}

/** What a share link's read-only view takes, from a full recipe. */
export function toPublicRecipe(r: Recipe, scaling: boolean): PublicRecipe {
  return {
    name: r.name,
    description: r.description,
    yieldText: r.yieldText,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    sourceUrl: r.sourceUrl,
    notes: r.notes,
    imageUrl: r.imageUrl,
    ingredients: r.ingredients.map(({ position, section, quantity, unit, food, note, raw }) => ({ position, section, quantity, unit, food, note, raw })),
    steps: r.steps.map(({ position, section, text }) => ({ position, section, text })),
    scaling,
  };
}

/** Author-only: link a recipe to the Snap (or `null` to unlink). */
export function useLinkRecipe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string | null) =>
      api<Snap>(`/snaps/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ recipeId }) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["snaps"] });
    },
  });
}

const oneKey = (id: string) => ["snaps", "one", id] as const;

/**
 * Toggle one of your Reactions. The button flips at once and flips back if the server refuses.
 * PUT and DELETE are idempotent, so a repeat tap or a retry is harmless.
 */
export function useReact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ emoji, on }: { emoji: ReactionKey; on: boolean }) =>
      api<unknown>(`/snaps/${encodeURIComponent(id)}/reactions/${emoji}`, { method: on ? "PUT" : "DELETE" }),
    onMutate: async ({ emoji, on }) => {
      await qc.cancelQueries({ queryKey: oneKey(id) });
      const before = qc.getQueryData<Snap>(oneKey(id));
      qc.setQueryData<Snap>(oneKey(id), (s) =>
        s && { ...s, myReactions: on ? [...new Set([...s.myReactions, emoji])] : s.myReactions.filter((r) => r !== emoji) },
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(oneKey(id), ctx.before);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: feedKey }),
  });
}

/** Author-only. A 404 means it is already gone, which is what was asked. */
export function useDeleteSnap(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api<void>(`/snaps/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.status === 404)) throw e;
      }
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: oneKey(id) });
      void qc.invalidateQueries({ queryKey: feedKey });
    },
  });
}
