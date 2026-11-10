import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Recipe, RecipeInput, RecipeListResponse } from "@meally/shared";
import { api } from "../../lib/api";

export type RecipeSort = "updated" | "name" | "created" | "rating" | "last-made";

export function useRecipes(opts: { q?: string; sort?: RecipeSort; tag?: string[]; category?: string[]; tool?: string[]; favourites?: boolean; minRating?: number; limit?: number; enabled?: boolean } = {}) {
  const { q = "", sort = "updated", tag = [], category = [], tool = [], favourites = false, minRating, limit = 24, enabled = true } = opts;
  return useInfiniteQuery({
    queryKey: ["recipes", "list", { q, sort, tag, category, tool, favourites, minRating, limit }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ sort, limit: String(limit) });
      if (q.trim()) params.set("q", q.trim());
      for (const [k, v] of [["tag", tag], ["category", category], ["tool", tool]] as const) for (const x of v) params.append(k, x);
      if (favourites) params.set("favourites", "1");
      if (minRating) params.set("minRating", String(minRating));
      if (pageParam) params.set("cursor", pageParam);
      return api<RecipeListResponse>(`/recipes?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRecipe(slug: string | undefined) {
  return useQuery({
    queryKey: ["recipes", "detail", slug],
    queryFn: () => api<Recipe>(`/recipes/${encodeURIComponent(slug!)}`),
    enabled: !!slug,
    retry: (count, err) => !(err as { status?: number }).status && count < 2,
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api<void>(`/recipes/${encodeURIComponent(slug)}`, { method: "DELETE" }),
    onSuccess: (_d, slug) => {
      qc.removeQueries({ queryKey: ["recipes", "detail", slug] });
      void qc.invalidateQueries({ queryKey: ["recipes", "list"] });
    },
  });
}

export function useSaveRecipe(slug?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, image }: { input: RecipeInput; image: File | null }) => {
      let recipe = await api<Recipe>(slug ? `/recipes/${encodeURIComponent(slug)}` : "/recipes", {
        method: slug ? "PUT" : "POST",
        body: JSON.stringify(input),
      });
      let imageFailed = false;
      if (image) {
        const body = new FormData();
        body.append("file", image);
        try {
          recipe = await api<Recipe>(`/recipes/${encodeURIComponent(recipe.slug)}/image`, { method: "POST", body });
        } catch {
          imageFailed = true;
        }
      }
      return { recipe, imageFailed };
    },
    onSuccess: ({ recipe }) => {
      qc.setQueryData(["recipes", "detail", recipe.slug], recipe);
      void qc.invalidateQueries({ queryKey: ["recipes", "list"] });
    },
  });
}
