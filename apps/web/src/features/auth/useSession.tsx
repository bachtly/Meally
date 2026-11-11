import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AuthStatus, MeResponse } from "@meally/shared";
import { api, ApiRequestError, postJson, SIGNED_OUT_EVENT } from "../../lib/api";

const SESSION_KEY = ["session"] as const;
const STORE_KEY = "meally:session";
/** How long to wait for `/auth/me` before showing an error instead of a skeleton that never ends. */
export const SESSION_TIMEOUT_MS = 10_000;

/** Last session this device saw, so the app can render straight away while `/auth/me` revalidates. */
function readStored(): MeResponse | undefined {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as MeResponse) : undefined;
  } catch {
    return undefined;
  }
}
function writeStored(me: MeResponse | null) {
  try {
    if (me) localStorage.setItem(STORE_KEY, JSON.stringify(me));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // storage blocked (private mode): we just lose the instant start
  }
}

/** Current session; `me` is null when signed out. */
export function useSession() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        const me = await api<MeResponse>("/auth/me", { signal: AbortSignal.timeout(SESSION_TIMEOUT_MS) });
        writeStored(me);
        return me;
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          writeStored(null);
          return null;
        }
        throw e;
      }
    },
    // Render from the stored session at once; updatedAt 0 marks it stale, so it revalidates on mount.
    initialData: readStored,
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    retry: false,
    retryOnMount: false, // offline: don't re-pend (and unmount the app) on every observer mount; reconnect refetches
  });
  useEffect(() => {
    const onOut = () => {
      writeStored(null);
      qc.setQueryData(SESSION_KEY, null);
    };
    window.addEventListener(SIGNED_OUT_EVENT, onOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onOut);
  }, [qc]);
  return {
    me: q.data ?? null,
    user: q.data?.user ?? null,
    household: q.data?.household ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
    retry: () => void q.refetch(),
    setSession: (me: MeResponse) => {
      writeStored(me);
      qc.setQueryData(SESSION_KEY, me);
    },
    async signOut() {
      await postJson("/auth/logout").catch(() => undefined);
      writeStored(null);
      qc.clear();
      qc.setQueryData(SESSION_KEY, null);
    },
  };
}

export function useAuthStatus() {
  return useQuery({ queryKey: ["auth-status"], queryFn: () => api<AuthStatus>("/auth/status"), retry: false });
}
