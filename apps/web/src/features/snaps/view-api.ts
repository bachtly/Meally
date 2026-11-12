import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicRecipe, Recipe, Snap } from "@meally/shared";
import { api, postJson } from "../../lib/api";

export const useSnap = (id: string) =>
  useQuery({ queryKey: ["snaps", "one", id], queryFn: () => api<Snap>(`/snaps/${encodeURIComponent(id)}`), retry: false });

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
