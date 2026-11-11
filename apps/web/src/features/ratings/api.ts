import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { Recipe, RecipeListResponse } from "@meally/shared";
import { api } from "../../lib/api";

type Patch = { favourite?: boolean; rating?: number | null };

/** Saves the caller's favourite/rating. Detail and list caches update at once and roll back on failure. */
export function useSetMine(slug: string) {
  const qc = useQueryClient();
  const detailKey = ["recipes", "detail", slug];
  return useMutation({
    mutationFn: (patch: Patch) => api(`/recipes/${encodeURIComponent(slug)}/me`, { method: "PUT", body: JSON.stringify(patch) }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["recipes"] });
      const prevDetail = qc.getQueryData<Recipe>(detailKey);
      const prevLists = qc.getQueriesData<InfiniteData<RecipeListResponse>>({ queryKey: ["recipes", "list"] });
      qc.setQueryData<Recipe>(detailKey, (r) => (r ? { ...r, me: { favourite: r.me?.favourite ?? false, rating: r.me?.rating ?? null, ...patch } } : r));
      qc.setQueriesData<InfiniteData<RecipeListResponse>>({ queryKey: ["recipes", "list"] }, (d) =>
        d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.slug === slug ? { ...i, ...patch } : i)) })) },
      );
      return { prevDetail, prevLists };
    },
    onError: (_e, _p, ctx) => {
      qc.setQueryData(detailKey, ctx?.prevDetail);
      for (const [key, data] of ctx?.prevLists ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["recipes", "detail", slug] });
      void qc.invalidateQueries({ queryKey: ["recipes", "list"] });
    },
  });
}
