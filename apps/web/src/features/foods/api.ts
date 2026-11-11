import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Food, UnitItem } from "@meally/shared";
import { api } from "../../lib/api";

const j = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const useFoods = (q: string) =>
  useQuery({
    queryKey: ["foods", q],
    queryFn: async () => (await api<{ items: Food[] }>(`/foods${q ? `?q=${encodeURIComponent(q)}` : ""}`)).items,
  });

export const useUnits = () => useQuery({ queryKey: ["units"], queryFn: async () => (await api<{ items: UnitItem[] }>("/units")).items });

/** Foods change recipes too (rename and merge rewrite ingredient text), so refresh both. */
export function useFoodMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["foods"] });
    void qc.invalidateQueries({ queryKey: ["recipes"] });
  };
  return {
    create: useMutation({ mutationFn: (name: string) => api("/foods", j("POST", { name })), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: { id: string; name?: string; aliases?: string[]; aisleId?: string | null }) =>
        api(`/foods/${id}`, j("PATCH", patch)),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: ({ id, force }: { id: string; force?: boolean }) => api<void>(`/foods/${id}${force ? "?force=1" : ""}`, j("DELETE")),
      onSuccess: done,
    }),
    merge: useMutation({
      mutationFn: ({ id, into }: { id: string; into: string }) => api(`/foods/${id}/merge`, j("POST", { into })),
      onSuccess: done,
    }),
  };
}

export type UnitDraft = { name: string; plural?: string | null; abbreviation?: string | null; kind: "mass" | "volume" | "count"; factor?: number | null };

export function useUnitMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["units"] });
    void qc.invalidateQueries({ queryKey: ["recipes"] });
  };
  return {
    create: useMutation({ mutationFn: (d: UnitDraft) => api("/units", j("POST", d)), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...d }: UnitDraft & { id: string }) => api(`/units/${id}`, j("PATCH", d)), onSuccess: done }),
    remove: useMutation({
      mutationFn: ({ id, force }: { id: string; force?: boolean }) => api<void>(`/units/${id}${force ? "?force=1" : ""}`, j("DELETE")),
      onSuccess: done,
    }),
  };
}
