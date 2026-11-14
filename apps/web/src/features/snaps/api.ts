import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Snap, SnapListResponse } from "@meally/shared";
import { api } from "../../lib/api";
import { metaQuery } from "../../lib/meta";
import { buildImageForm } from "../recipes/upload";
import type { Draft } from "./drafts";

export const feedKey = ["snaps", "feed"] as const;

export function useFeed() {
  return useInfiniteQuery({
    queryKey: feedKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: "10" });
      if (pageParam) p.set("cursor", pageParam);
      return api<SnapListResponse>(`/snaps?${p}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Sends a draft. The same `clientId` goes out on every retry, so the server answers 200 with the first Snap. */
export function useSendSnap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: Draft) => {
      const file = d.file instanceof File ? d.file : new File([d.file], d.fileName, { type: d.file.type });
      const body = await buildImageForm(file, (await qc.fetchQuery(metaQuery)).presizedImages);
      body.append("clientId", d.clientId);
      if (d.caption.trim()) body.append("caption", d.caption.trim());
      if (d.eatenOut && d.dishName.trim()) body.append("dishName", d.dishName.trim());
      if (d.eatenOut && d.place.trim()) body.append("place", d.place.trim());
      if (!d.eatenOut && d.recipe) body.append("recipeId", d.recipe.id);
      return api<Snap>("/snaps", { method: "POST", body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feedKey }),
  });
}
