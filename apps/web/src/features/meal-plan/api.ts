import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MealPlanEntry, MealPlanEntryInput, MealPlanEntryPatch, MealPlanRecipeSummary, MealPlanRule, MealPlanRuleInput, MealType } from "@meally/shared";
import { api, postJson } from "../../lib/api";

const KEY = ["meal-plan"] as const;

export function usePlanRange(from: string, to: string) {
  return useQuery({
    queryKey: [...KEY, "range", from, to],
    queryFn: () => api<{ items: MealPlanEntry[] }>(`/meal-plan?from=${from}&to=${to}`).then((r) => r.items),
  });
}

function useInvalidating<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useAddEntry = () => useInvalidating((v: MealPlanEntryInput) => postJson<MealPlanEntry>("/meal-plan", v));
export const usePatchEntry = () =>
  useInvalidating(({ id, ...patch }: { id: string } & MealPlanEntryPatch) =>
    api<MealPlanEntry>(`/meal-plan/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  );
export const useRemoveEntry = () => useInvalidating((id: string) => api<void>(`/meal-plan/${id}`, { method: "DELETE" }));

export const suggest = (date: string, mealType: MealType) =>
  postJson<{ recipe: MealPlanRecipeSummary | null }>("/meal-plan/suggest", { date, mealType }).then((r) => r.recipe);

export function useIcal(enabled: boolean) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, "ical"], queryFn: () => api<{ token: string; path: string }>("/meal-plan/ical/token"), enabled });
  const rotate = useMutation({
    mutationFn: () => postJson<{ token: string; path: string }>("/meal-plan/ical/token"),
    onSuccess: (d) => qc.setQueryData([...KEY, "ical"], d),
  });
  return { q, rotate };
}

export function useRules(enabled: boolean) {
  const qc = useQueryClient();
  const key = [...KEY, "rules"];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ items: MealPlanRule[] }>("/meal-plan/rules").then((r) => r.items), enabled });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const add = useMutation({ mutationFn: (v: MealPlanRuleInput) => postJson<MealPlanRule>("/meal-plan/rules", v), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api<void>(`/meal-plan/rules/${id}`, { method: "DELETE" }), onSuccess: refresh });
  return { q, add, remove };
}

export interface ShoppingListRef {
  id: string;
  name: string;
}
export const useShoppingLists = (enabled: boolean) =>
  useQuery({ queryKey: ["shopping", "lists", "for-plan"], queryFn: () => api<{ items: ShoppingListRef[] }>("/shopping/lists").then((r) => r.items), enabled });

export const useOrganizerNames = (type: "tags" | "categories", enabled: boolean) =>
  useQuery({
    queryKey: ["organizers", type, "names"],
    queryFn: () => api<{ items: { name: string; slug: string }[] }>(`/organizers/${type}`).then((r) => r.items),
    enabled,
  });
