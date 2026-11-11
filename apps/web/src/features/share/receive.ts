import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SHARE_SAVE_BATCH, type PublicRecipe, type PublicShare, type SaveShareResult, type ShareStatus } from "@meally/shared";
import { api, postJson } from "../../lib/api";

const enc = encodeURIComponent;

export function usePublicShare(token: string) {
  return useQuery({ queryKey: ["public-share", token], queryFn: () => api<PublicShare>(`/public/shares/${enc(token)}`), retry: false, staleTime: 60_000 });
}

export function usePublicShareRecipe(token: string, slug: string) {
  return useQuery({
    queryKey: ["public-share", token, slug],
    queryFn: () => api<PublicRecipe>(`/public/shares/${enc(token)}/recipes/${enc(slug)}`),
    retry: false,
    staleTime: 60_000,
  });
}

/** What the signed-in viewer already has from this link. */
export function useShareStatus(token: string, signedIn: boolean) {
  return useQuery({
    queryKey: ["share-status", token],
    queryFn: () => api<ShareStatus>(`/shares/received/${enc(token)}`),
    enabled: signedIn,
    retry: false,
  });
}

export interface SaveProgress {
  done: number;
  total: number;
}

/**
 * Saves recipes of a link into the viewer's household, in batches of 10 so a big cookbook stays within request limits.
 * With `cookbook`, the first batch creates a hand-picked cookbook by that name and later batches fill it.
 */
export function useSaveShare(token: string) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<SaveProgress | null>(null);
  const [pending, setPending] = useState(false);
  async function save(slugs: string[], cookbook?: string): Promise<SaveShareResult> {
    setPending(true);
    setProgress({ done: 0, total: slugs.length });
    const out: SaveShareResult = { saved: {}, cookbookSlug: null };
    try {
      for (let i = 0; i < slugs.length; i += SHARE_SAVE_BATCH) {
        const batch = slugs.slice(i, i + SHARE_SAVE_BATCH);
        const cb = cookbook ? (out.cookbookSlug ? { slug: out.cookbookSlug } : { name: cookbook }) : undefined;
        const r = await postJson<SaveShareResult>(`/shares/received/${enc(token)}/save`, { slugs: batch, ...(cb ? { cookbook: cb } : {}) });
        Object.assign(out.saved, r.saved);
        out.cookbookSlug ??= r.cookbookSlug;
        setProgress({ done: Math.min(i + batch.length, slugs.length), total: slugs.length });
      }
      return out;
    } finally {
      setPending(false);
      setProgress(null);
      // Partial saves still show as saved.
      qc.setQueryData<ShareStatus>(["share-status", token], (s) => (s ? { ...s, saved: { ...s.saved, ...out.saved } } : s));
      void qc.invalidateQueries({ queryKey: ["share-status", token] });
      void qc.invalidateQueries({ queryKey: ["recipes"] });
      if (out.cookbookSlug) void qc.invalidateQueries({ queryKey: ["cookbooks"] });
    }
  }
  return { save, pending, progress };
}

/** Where a signed-out viewer goes to keep a link: sign-up (or sign-in), then back here to save automatically. */
export function shareReturnPath(token: string, slug?: string) {
  return `/s/${enc(token)}${slug ? `/${enc(slug)}` : ""}?save=1`;
}
