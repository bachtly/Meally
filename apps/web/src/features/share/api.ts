import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicRecipe, ShareLink, ShareSummary } from "@meally/shared";
import { api, postJson } from "../../lib/api";

/** What a share link points at. */
export type ShareTarget =
  | { kind: "recipe"; slug: string; name: string }
  | { kind: "set"; slugs: string[] }
  | { kind: "cookbook"; slug: string; name: string };

export interface ShareOptions {
  expiresInDays: 1 | 7 | 30 | null;
  showName: boolean;
  note: string | null;
  /** Sets only. */
  title?: string | null;
}

const ALL = ["shares"] as const;
const key = (slug: string) => ["shares", "recipe", slug];

export function useShares(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: key(slug),
    enabled,
    queryFn: () => api<{ items: ShareLink[] }>(`/recipes/${encodeURIComponent(slug)}/shares`).then((r) => r.items),
  });
}

/** Every active link you made (Settings, Shared links). */
export function useAllShares() {
  return useQuery({ queryKey: [...ALL, "all"], queryFn: () => api<{ items: ShareSummary[] }>("/shares").then((r) => r.items) });
}

function createPath(t: ShareTarget) {
  if (t.kind === "recipe") return `/recipes/${encodeURIComponent(t.slug)}/shares`;
  if (t.kind === "cookbook") return `/cookbooks/${encodeURIComponent(t.slug)}/shares`;
  return "/shares";
}

export function useCreateShare(target: ShareTarget) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, ...o }: ShareOptions) =>
      postJson<{ url: string }>(createPath(target), target.kind === "set" ? { ...o, recipeSlugs: target.slugs, title: title || null } : o),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ALL }),
  });
}

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/shares/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ALL }),
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
