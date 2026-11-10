import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Cookbook, CookbookInput, RecipeListResponse } from "@meally/shared";
import { api } from "../../lib/api";

const enc = encodeURIComponent;

export function useCookbooks(enabled = true) {
  return useQuery({ queryKey: ["cookbooks", "list"], queryFn: () => api<{ items: Cookbook[] }>("/cookbooks").then((r) => r.items), enabled });
}

export function useCookbook(slug: string | undefined) {
  return useQuery({
    queryKey: ["cookbooks", "detail", slug],
    queryFn: () => api<Cookbook>(`/cookbooks/${enc(slug!)}`),
    enabled: !!slug,
    retry: (count, err) => !(err as { status?: number }).status && count < 2,
  });
}

export function useCookbookRecipes(slug: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["cookbooks", "recipes", slug],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<RecipeListResponse>(`/cookbooks/${enc(slug!)}/recipes${pageParam ? `?cursor=${enc(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!slug,
  });
}

/** Slugs of the manual cookbooks that hold a recipe. */
export function useCookbooksWithRecipe(recipeSlug: string, enabled: boolean) {
  return useQuery({
    queryKey: ["cookbooks", "containing", recipeSlug],
    queryFn: () => api<{ items: string[] }>(`/cookbooks/containing/${enc(recipeSlug)}`).then((r) => r.items),
    enabled,
  });
}

export function useCookbookMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["cookbooks"] });
  return {
    create: useMutation({ mutationFn: (input: CookbookInput) => api<Cookbook>("/cookbooks", { method: "POST", body: JSON.stringify(input) }), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ slug, patch }: { slug: string; patch: Partial<Omit<CookbookInput, "kind">> }) =>
        api<Cookbook>(`/cookbooks/${enc(slug)}`, { method: "PUT", body: JSON.stringify(patch) }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (slug: string) => api<void>(`/cookbooks/${enc(slug)}`, { method: "DELETE" }), onSuccess: done }),
    add: useMutation({
      mutationFn: ({ cookbook, recipe }: { cookbook: string; recipe: string }) =>
        api<void>(`/cookbooks/${enc(cookbook)}/recipes`, { method: "POST", body: JSON.stringify({ slug: recipe }) }),
      onSuccess: done,
    }),
    drop: useMutation({
      mutationFn: ({ cookbook, recipe }: { cookbook: string; recipe: string }) =>
        api<void>(`/cookbooks/${enc(cookbook)}/recipes/${enc(recipe)}`, { method: "DELETE" }),
      onSuccess: done,
    }),
  };
}
