import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { TimelineEvent, TimelineKind, TimelineResponse } from "@meally/shared";
import { api, postJson } from "../../lib/api";

export function useTimeline(slug: string | null) {
  return useInfiniteQuery({
    queryKey: ["timeline", slug ?? "feed"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: "20" });
      if (pageParam) p.set("cursor", pageParam);
      return api<TimelineResponse>(`${slug ? `/recipes/${encodeURIComponent(slug)}/timeline` : "/timeline"}?${p}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useTimelineMutations(slug: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["timeline"] });
    void qc.invalidateQueries({ queryKey: ["recipes"] });
  };
  const post = useMutation({
    mutationFn: async (v: { kind: TimelineKind; text?: string; photo?: File | null }) => {
      const ev = await postJson<TimelineEvent>(`/recipes/${encodeURIComponent(slug)}/timeline`, { kind: v.kind, text: v.text || undefined });
      if (v.photo) {
        const fd = new FormData();
        fd.append("file", v.photo);
        await api(`/timeline/${ev.id}/image`, { method: "POST", body: fd });
      }
      return ev;
    },
    onSuccess: refresh,
  });
  const edit = useMutation({
    mutationFn: (v: { id: string; text: string }) => api(`/timeline/${v.id}`, { method: "PATCH", body: JSON.stringify({ text: v.text }) }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/timeline/${id}`, { method: "DELETE" }), onSuccess: refresh });
  return { post, edit, remove };
}

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(ms).toLocaleDateString();
}
