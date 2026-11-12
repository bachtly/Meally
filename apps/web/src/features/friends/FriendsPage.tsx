import { Copy, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Friend, FriendInvite } from "@meally/shared";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  Skeleton,
  useToast,
} from "../../ui";
import {
  errMsg,
  useCreateInvite,
  useFriends,
  useInvites,
  useRemoveFriend,
  useRevokeInvite,
} from "./api";

const month = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
const day = (ms: number) => new Date(ms).toLocaleDateString();

export function FriendsPage() {
  const friends = useFriends();
  const toast = useToast();
  const create = useCreateInvite();
  const remove = useRemoveFriend();
  const [confirm, setConfirm] = useState<Friend | null>(null);
  const [created, setCreated] = useState<{
    url: string;
    expiresAt: number;
  } | null>(null);
  const cap = friends.data?.cap;
  const count = friends.data?.items.length ?? 0;

  async function onCreate() {
    try {
      const inv = await create.mutateAsync();
      setCreated({ url: inv.url, expiresAt: inv.expiresAt });
    } catch (e) {
      toast(errMsg(e), "danger");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Friends</h1>
        {cap != null && (
          <p className="text-sm text-muted">
            {count} of {cap}
          </p>
        )}
      </div>

      <section aria-label="Invite a friend" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onCreate} loading={create.isPending}>
            Create invite link
          </Button>
          <p className="text-sm text-muted">Valid for 7 days. Works once.</p>
        </div>
        {created && <NewLink url={created.url} expiresAt={created.expiresAt} />}
        <OpenLinks />
      </section>

      <section aria-label="Your friends" className="flex flex-col gap-3">
        {friends.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : friends.isError ? (
          <EmptyState
            title="Couldn't load friends"
            action={
              <Button onClick={() => friends.refetch()}>Try again</Button>
            }
          >
            Check your connection, then try again.
          </EmptyState>
        ) : friends.data.items.length === 0 ? (
          <EmptyState title="No friends yet">
            Create an invite link and send it to someone.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.data.items.map((f) => (
              <li key={f.userId}>
                <Card className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{f.name}</p>
                    <p className="text-sm text-muted">
                      Friends since {month(f.since)}
                    </p>
                  </div>
                  <IconButton
                    aria-label={`Remove ${f.name}`}
                    variant="ghost"
                    onClick={() => setConfirm(f)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Remove friend?"
        description={
          confirm
            ? `${confirm.name} won't see your Snaps any more, and you won't see theirs.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const f = confirm;
              setConfirm(null);
              if (f)
                remove.mutate(f.userId, {
                  onError: (e) => toast(errMsg(e), "danger"),
                });
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function NewLink({ url, expiresAt }: { url: string; expiresAt: number }) {
  const toast = useToast();
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Couldn't copy. Select the link and copy it.", "danger");
    }
  };
  const share = () =>
    navigator
      .share({ url, title: "Be my friend on Meally" })
      .catch(() => undefined);
  return (
    <Card className="flex flex-col gap-2 p-3">
      <p className="text-sm text-muted">
        Send this link. It expires on {day(expiresAt)}.
      </p>
      <code className="select-all break-all rounded-md bg-sunken p-2 text-sm">
        {url}
      </code>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={copy}>
          <Copy className="size-4" aria-hidden /> Copy
        </Button>
        {canShare && (
          <Button variant="secondary" onClick={share}>
            <Share2 className="size-4" aria-hidden /> Share
          </Button>
        )}
      </div>
    </Card>
  );
}

function OpenLinks() {
  const invites = useInvites();
  const revoke = useRevokeInvite();
  const toast = useToast();
  if (invites.isPending) return <Skeleton className="h-10" />;
  if (invites.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn't load your invite links.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => invites.refetch()}
        >
          Try again
        </button>
      </p>
    );
  const open = invites.data.items.filter(
    (i: FriendInvite) => !i.usedAt && i.expiresAt > Date.now(),
  );
  if (open.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Open links: {open.length}</h2>
      <ul className="flex flex-col gap-2">
        {open.map((i) => (
          <li
            key={i.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-muted">Expires {day(i.expiresAt)}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                revoke.mutate(i.id, {
                  onError: (e) => toast(errMsg(e), "danger"),
                })
              }
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
