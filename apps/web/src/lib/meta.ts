import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface ServerMeta {
  /** Server can hold an SSE connection open. False on the edge, where clients poll instead. */
  streaming: boolean;
  /** Server wants browser-resized WebP uploads (no sharp on the host). */
  presizedImages: boolean;
}

const DEFAULT: ServerMeta = { streaming: true, presizedImages: false };

/** `/api/v1/meta`; older servers without it behave like the Node server. */
export async function fetchMeta(): Promise<ServerMeta> {
  try {
    const m = await api<Partial<ServerMeta>>("/meta");
    return { streaming: m?.streaming ?? DEFAULT.streaming, presizedImages: m?.presizedImages ?? DEFAULT.presizedImages };
  } catch {
    return DEFAULT;
  }
}

export const metaQuery = { queryKey: ["meta"] as const, queryFn: fetchMeta, staleTime: Infinity };
export const useMeta = () => useQuery(metaQuery);
