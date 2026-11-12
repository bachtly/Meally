import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Friend,
  FriendInviteCreated,
  FriendInviteListResponse,
  FriendInvitePreview,
  FriendListResponse,
} from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";

export const friendsKey = ["friends"] as const;
export const invitesKey = ["friends", "invites"] as const;

export const errMsg = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : "Something went wrong. Try again.";

export const useFriends = () =>
  useQuery({
    queryKey: friendsKey,
    queryFn: () => api<FriendListResponse>("/friends"),
  });
export const useInvites = () =>
  useQuery({
    queryKey: invitesKey,
    queryFn: () => api<FriendInviteListResponse>("/friends/invites"),
  });

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<FriendInviteCreated>("/friends/invites"),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey }),
  });
}

/** Removes the row at once and puts it back (by refetching) if the server refuses. */
export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/friends/invites/${id}`, { method: "DELETE" }),
    onMutate: (id) => {
      qc.setQueryData<FriendInviteListResponse>(
        invitesKey,
        (d) => d && { items: d.items.filter((i) => i.id !== id) },
      );
    },
    onError: () => qc.invalidateQueries({ queryKey: invitesKey }),
  });
}

export function useRemoveFriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/friends/${userId}`, { method: "DELETE" }),
    onMutate: (userId) => {
      qc.setQueryData<FriendListResponse>(
        friendsKey,
        (d) => d && { ...d, items: d.items.filter((f) => f.userId !== userId) },
      );
    },
    onError: () => qc.invalidateQueries({ queryKey: friendsKey }),
  });
}

export const useInvitePreview = (token: string, enabled: boolean) =>
  useQuery({
    queryKey: ["friends", "preview", token],
    queryFn: () =>
      api<FriendInvitePreview>(`/friends/invites/${encodeURIComponent(token)}`),
    enabled,
    retry: false,
  });

/** A 200 on a retried accept is success, the same as the first 201. */
export function useAcceptInvite(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postJson<Friend>(`/friends/invites/${encodeURIComponent(token)}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: friendsKey }),
  });
}
