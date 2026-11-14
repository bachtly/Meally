import { Share2 } from "lucide-react";
import { Link } from "react-router";
import { Button, EmptyState, Sheet, Skeleton, useToast } from "../../ui";
import { errMsg, useCreateInvite, useFriends } from "../friends/api";

/** Quick view of your circle from the camera: who sees your Snaps, and an invite link to share. */
export function FriendsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const friends = useFriends();
  const create = useCreateInvite();
  const toast = useToast();
  const n = friends.data?.items?.length ?? 0;

  async function invite() {
    try {
      const { url } = await create.mutateAsync();
      if (typeof navigator.share === "function") {
        await navigator.share({ url, title: "Be my friend on Meally" }).catch(() => undefined);
      } else {
        await navigator.clipboard.writeText(url);
        toast("Invite link copied");
      }
    } catch (e) {
      toast(errMsg(e), "danger");
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Your friends"
      description={friends.data ? `${n} of ${friends.data.cap}. They see every Snap you send.` : "They see every Snap you send."}
    >
      <Button size="lg" loading={create.isPending} onClick={() => void invite()}>
        <Share2 className="size-5" aria-hidden />
        Share an invite link
      </Button>
      {friends.isPending ? (
        <div aria-busy="true" aria-label="Loading friends" className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : friends.isError ? (
        <EmptyState title="Couldn't load your friends" action={<Button onClick={() => void friends.refetch()}>Try again</Button>}>
          Check your connection, then try again.
        </EmptyState>
      ) : n === 0 ? (
        <p className="text-center text-muted">No friends yet. Share a link to add someone.</p>
      ) : (
        <ul className="flex flex-col">
          {friends.data.items.map((f) => (
            <li key={f.userId} className="flex min-h-14 items-center gap-3">
              <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full bg-accent font-semibold text-accent-contrast">
                {f.name.charAt(0).toUpperCase()}
              </span>
              <span className="font-semibold">{f.name}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/friends" className="inline-flex min-h-11 items-center justify-center rounded-md font-semibold text-accent underline">
        Manage friends and links
      </Link>
    </Sheet>
  );
}
