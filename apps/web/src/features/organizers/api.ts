import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrganizerType } from "@meally/shared";
import { api } from "../../lib/api";

export interface OrganizerItem {
  name: string;
  slug: string;
  count: number;
}

export const ORGANIZER_LABELS: Record<OrganizerType, { plural: string; singular: string; param: "tag" | "category" | "tool" }> = {
  tags: { plural: "Tags", singular: "tag", param: "tag" },
  categories: { plural: "Categories", singular: "category", param: "category" },
  tools: { plural: "Tools", singular: "tool", param: "tool" },
};

export function useOrganizers(type: OrganizerType, enabled = true) {
  return useQuery({
    queryKey: ["organizers", type],
    queryFn: async () => (await api<{ items: OrganizerItem[] }>(`/organizers/${type}`)).items,
    enabled,
  });
}

/** Rename, delete and merge change recipes too, so refresh both caches. */
export function useOrganizerMutations(type: OrganizerType) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["organizers"] });
    void qc.invalidateQueries({ queryKey: ["recipes"] });
  };
  const base = `/organizers/${type}`;
  return {
    rename: useMutation({
      mutationFn: ({ slug, name }: { slug: string; name: string }) =>
        api(`${base}/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (slug: string) => api<void>(`${base}/${encodeURIComponent(slug)}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
    merge: useMutation({
      mutationFn: ({ slug, into }: { slug: string; into: string }) =>
        api(`${base}/${encodeURIComponent(slug)}/merge`, { method: "POST", body: JSON.stringify({ into }) }),
      onSuccess: refresh,
    }),
  };
}
