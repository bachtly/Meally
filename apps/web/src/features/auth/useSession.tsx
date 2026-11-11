import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AuthStatus, MeResponse } from "@meally/shared";
import { api, ApiRequestError, postJson, SIGNED_OUT_EVENT } from "../../lib/api";

const SESSION_KEY = ["session"] as const;

/** Current session; `me` is null when signed out. */
export function useSession() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return await api<MeResponse>("/auth/me");
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    const onOut = () => qc.setQueryData(SESSION_KEY, null);
    window.addEventListener(SIGNED_OUT_EVENT, onOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onOut);
  }, [qc]);
  return {
    me: q.data ?? null,
    user: q.data?.user ?? null,
    household: q.data?.household ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
    setSession: (me: MeResponse) => qc.setQueryData(SESSION_KEY, me),
    async signOut() {
      await postJson("/auth/logout").catch(() => undefined);
      qc.clear();
      qc.setQueryData(SESSION_KEY, null);
    },
  };
}

export function useAuthStatus() {
  return useQuery({ queryKey: ["auth-status"], queryFn: () => api<AuthStatus>("/auth/status"), retry: false });
}
