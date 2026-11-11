import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AisleLabel, ShoppingItem, ShoppingList } from "@meally/shared";
import { api, postJson } from "../../lib/api";

export interface ListDetail {
  list: ShoppingList;
  items: ShoppingItem[];
}
export const keys = {
  lists: ["shopping", "lists"] as const,
  list: (id: string) => ["shopping", "list", id] as const,
  aisles: ["shopping", "aisles"] as const,
};
const json = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const useLists = (enabled = true) =>
  useQuery({ enabled, queryKey: keys.lists, queryFn: async () => (await api<{ items: ShoppingList[] }>("/shopping/lists")).items });

export const useList = (id: string) =>
  useQuery({
    queryKey: keys.list(id),
    queryFn: () => api<ListDetail>(`/shopping/lists/${id}`),
    retry: (n, e) => !(e as { status?: number }).status && n < 2,
  });

export const useAisles = () =>
  useQuery({ queryKey: keys.aisles, queryFn: async () => (await api<{ items: AisleLabel[] }>("/shopping/aisles")).items });

export function useListMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["shopping"] });
  return {
    create: useMutation({ mutationFn: (name: string) => postJson<ShoppingList>("/shopping/lists", { name }), onSuccess: done }),
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) => api<ShoppingList>(`/shopping/lists/${v.id}`, json("PATCH", { name: v.name })),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/shopping/lists/${id}`, json("DELETE")), onSuccess: done }),
  };
}

type Updater = (items: ShoppingItem[]) => ShoppingItem[];

/** Item mutations: each applies its change to the cached list at once, rolls back on error, and refetches after. */
export function useItemMutations(listId: string) {
  const qc = useQueryClient();
  const key = keys.list(listId);
  function useOptimisticItem<V>(fn: (v: V) => Promise<unknown>, apply: (v: V) => Updater) {
    return useMutation({
      mutationFn: fn,
      onMutate: async (v: V) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<ListDetail>(key);
        if (prev) qc.setQueryData<ListDetail>(key, { ...prev, items: apply(v)(prev.items) });
        return { prev };
      },
      onError: (_e, _v, ctx) => {
        if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      },
      onSettled: () => qc.invalidateQueries({ queryKey: ["shopping"] }),
    });
  }
  const patch = (id: string, body: object) => api<ShoppingItem>(`/shopping/lists/${listId}/items/${id}`, json("PATCH", body));
  const mapItem = (id: string, change: Partial<ShoppingItem>): Updater => (items) =>
    items.map((i) => (i.id === id ? { ...i, ...change } : i));
  return {
    add: useMutation({
      mutationFn: (text: string) => postJson<{ items: ShoppingItem[] }>(`/shopping/lists/${listId}/items`, { text }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["shopping"] }),
    }),
    toggle: useOptimisticItem(
      (v: { id: string; checked: boolean }) => patch(v.id, { checked: v.checked }),
      (v) => mapItem(v.id, { checked: v.checked }),
    ),
    edit: useOptimisticItem(
      (v: { id: string; text: string }) => patch(v.id, { text: v.text }),
      (v) => mapItem(v.id, { text: v.text }),
    ),
    setAisle: useOptimisticItem(
      (v: { id: string; aisle: string | null }) => patch(v.id, { aisle: v.aisle }),
      (v) => mapItem(v.id, { aisle: v.aisle }),
    ),
    remove: useOptimisticItem(
      (id: string) => api<void>(`/shopping/lists/${listId}/items/${id}`, json("DELETE")),
      (id) => (items) => items.filter((i) => i.id !== id),
    ),
    clearChecked: useOptimisticItem(
      (_: void) => postJson(`/shopping/lists/${listId}/clear-checked`),
      () => (items) => items.filter((i) => !i.checked),
    ),
  };
}

export function useAisleMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.aisles });
  return {
    create: useMutation({ mutationFn: (name: string) => postJson("/shopping/aisles", { name }), onSuccess: done }),
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) => api(`/shopping/aisles/${v.id}`, json("PATCH", { name: v.name })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/shopping/aisles/${id}`, json("DELETE")),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["shopping"] }),
    }),
    reorder: useMutation({
      mutationFn: (ids: string[]) => api("/shopping/aisles/order", json("PUT", { ids })),
      onMutate: (ids) => {
        const prev = qc.getQueryData<AisleLabel[]>(keys.aisles);
        if (prev) qc.setQueryData(keys.aisles, ids.map((id, position) => ({ ...prev.find((a) => a.id === id)!, position })));
      },
      onSettled: done,
    }),
  };
}

export function useAddRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { listId: string; slug: string; servings?: number }) =>
      postJson<{ items: ShoppingItem[] }>(`/shopping/lists/${v.listId}/add-recipe`, { slug: v.slug, servings: v.servings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shopping"] }),
  });
}
