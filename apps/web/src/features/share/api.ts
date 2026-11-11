import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicRecipe, ShareLink } from "@meally/shared";
import { api, postJson } from "../../lib/api";

const key = (slug: string) => ["shares", slug];

export function useShares(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: key(slug),
    enabled,
    queryFn: () => api<{ items: ShareLink[] }>(`/recipes/${encodeURIComponent(slug)}/shares`).then((r) => r.items),
  });
}

export function useCreateShare(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expiresInDays: 1 | 7 | 30 | null) => postJson<{ url: string }>(`/recipes/${encodeURIComponent(slug)}/shares`, { expiresInDays }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

export function useRevokeShare(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/shares/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(slug) }),
  });
}

export function usePublicRecipe(token: string) {
  return useQuery({
    queryKey: ["public-recipe", token],
    queryFn: () => api<PublicRecipe>(`/public/recipes/${encodeURIComponent(token)}`),
    retry: false,
    staleTime: Infinity,
  });
}
