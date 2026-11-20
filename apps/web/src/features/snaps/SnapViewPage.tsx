import type { InfiniteData } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Ellipsis, LayoutGrid, MapPin, Plus } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { reactionKeys, type ReactionKey, type Snap, type SnapListResponse } from "@meally/shared";
import { ApiRequestError } from "../../lib/api";
import { Button, cn, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Sheet, useToast } from "../../ui";
import { useSession } from "../auth/useSession";
import { DeadLink } from "../share/PublicRecipeView";
import { relativeTime } from "../timeline/api";
import { feedKey } from "./api";
import { Avatar, camButton, camButtonSm, captionPill, PhotoFrame, ThreeUp } from "./parts";
import { RecipePicker } from "./RecipePicker";
import { useDeleteSnap, useLinkRecipe, useReact, useSnap } from "./view-api";

export const REACTION_EMOJI: Record<ReactionKey, string> = { heart: "❤️", yum: "😋", fire: "🔥", clap: "👏", wow: "😮", laugh: "😂" };

/** A vertical swipe at least this long (px) on the photo moves to the next or previous Snap. */
const SWIPE_PX = 60;

/** Back link for the light Linked recipe page. */
export function BackToFeed() {
  return (
    <Link to="/feed" className="inline-flex min-h-11 items-center gap-1 self-start rounded-md pr-3 text-accent underline">
      <ChevronLeft className="size-4" aria-hidden />
      Feed
    </Link>
  );
}

/** The Snaps either side of this one in the loaded Feed (newest first), for swipe and the arrow buttons. */
function useNeighbours(id: string) {
  const qc = useQueryClient();
  const items = qc.getQueryData<InfiniteData<SnapListResponse>>(feedKey)?.pages.flatMap((p) => p.items) ?? [];
  const i = items.findIndex((s) => s.id === id);
  return { newer: i > 0 ? items[i - 1] : undefined, older: i >= 0 ? items[i + 1] : undefined };
}

function saveImage(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "snap.jpg";
  a.click();
}

/** Six fixed emoji, no counts. Tapping again takes the Reaction back. */
function ReactionBar({ snap }: { snap: Snap }) {
  const react = useReact(snap.id);
  const toast = useToast();
  return (
    <div role="group" aria-label="React" className="flex justify-between rounded-full bg-cam-chip p-1.5">
      {reactionKeys.map((k) => {
        const on = snap.myReactions.includes(k);
        return (
          <button
            key={k}
            type="button"
            aria-label={`React with ${k}`}
            aria-pressed={on}
            onClick={() => react.mutate({ emoji: k, on: !on }, { onError: () => toast("Couldn't save your Reaction", "danger") })}
            className={cn("inline-flex size-12 items-center justify-center rounded-full text-2xl", on && "bg-cam-accent/30 ring-2 ring-cam-accent ring-inset")}
          >
            <span aria-hidden>{REACTION_EMOJI[k]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Author-only: who reacted, as one row that opens the list. Nobody else sees it, and there are no counts. */
function WhoReacted({ snap }: { snap: Snap }) {
  const [open, setOpen] = useState(false);
  const list = snap.reactions ?? [];
  const names = [...new Set(list.map((r) => r.name))];
  const summary =
    names.length === 0 ? "No reactions yet" : names.length === 1 ? `${names[0]} reacted` : names.length === 2 ? `${names[0]} and ${names[1]} reacted` : `${names[0]} and others reacted`;
  return (
    <>
      <button
        type="button"
        disabled={list.length === 0}
        onClick={() => setOpen(true)}
        className="flex min-h-15 w-full items-center gap-3 rounded-full bg-cam-chip pr-4 pl-2.5 text-left text-[15px] font-medium disabled:pl-5"
      >
        {names.length > 0 && (
          <span className="flex" aria-hidden>
            {names.slice(0, 3).map((n, i) => (
              <Avatar key={n} name={n} tone="you" className={cn("size-9 border-2 border-cam", i > 0 && "-ml-3")} />
            ))}
          </span>
        )}
        <span className="flex-1">{summary}</span>
        <span aria-hidden className="text-xl">
          {[...new Set(list.map((r) => REACTION_EMOJI[r.emoji]))].slice(0, 4).join("")}
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Reactions" description="Only you see who reacted.">
        <ul className="flex flex-col">
          {list.map((r) => (
            <li key={`${r.userId}-${r.emoji}`} className="flex min-h-12 items-center gap-3">
              <span className="flex-1 font-medium">{r.name}</span>
              <span className="text-xl" role="img" aria-label={r.emoji}>
                {REACTION_EMOJI[r.emoji]}
              </span>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

/** `/snaps/:id`: one Snap at camera size. A missing, deleted or not-yours Snap is the same dead end. */
export function SnapViewPage() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const q = useSnap(id);
  const link = useLinkRecipe(id);
  const del = useDeleteSnap(id);
  const toast = useToast();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { newer, older } = useNeighbours(id);
  const swipe = useRef<number | null>(null);
  const snap = q.data;
  const mine = !!snap && snap.author.id === user?.id;

  // Up and Down arrows move between Snaps, so swipe is never the only way.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector("[role=dialog], [role=menu]")) return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const to = e.key === "ArrowDown" ? older : e.key === "ArrowUp" ? newer : undefined;
      if (to) {
        e.preventDefault();
        navigate(`/snaps/${to.id}`, { replace: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newer, older, navigate]);

  const onPointerDown = (e: PointerEvent) => {
    swipe.current = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (swipe.current === null) return;
    const dy = swipe.current - e.clientY;
    swipe.current = null;
    const to = dy >= SWIPE_PX ? older : dy <= -SWIPE_PX ? newer : undefined;
    if (to) navigate(`/snaps/${to.id}`, { replace: true });
  };

  if (q.isPending) {
    return (
      <div className="flex flex-1 flex-col justify-center px-4" aria-busy="true" aria-label="Loading the Snap">
        <div className="aspect-square w-full rounded-[2.75rem] bg-cam-chip motion-safe:animate-pulse" />
      </div>
    );
  }
  // A failed background refresh keeps the Snap from the Feed cache on screen; only a 404 (gone) or nothing cached is a dead end.
  if (q.isError && (!snap || (q.error instanceof ApiRequestError && q.error.status === 404))) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-4">
        <div className="rounded-lg bg-raised p-4 text-ink">
          {q.error instanceof ApiRequestError && q.error.status === 404 ? (
            <DeadLink />
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <h1 className="text-xl font-semibold">Couldn't load this Snap</h1>
              <p className="text-muted">Check your connection, then try again.</p>
              <Button onClick={() => void q.refetch()}>Try again</Button>
            </div>
          )}
        </div>
        <Link to="/feed" className="mx-auto inline-flex min-h-11 items-center font-semibold underline">
          Back to the Feed
        </Link>
      </div>
    );
  }

  if (!snap) return null;
  const where = [snap.dishName, snap.place].filter(Boolean).join(" · ");
  const alt = snap.caption || snap.dishName || `Snap by ${snap.author.name}`;

  return (
    <div className="flex flex-1 flex-col px-4 pt-3.5 pb-5">
      <ThreeUp
        className="h-12"
        center={
          <h1 className="flex items-center gap-2 text-[15px] font-semibold whitespace-nowrap">
            <Avatar name={snap.author.name} tone={mine ? "you" : "plain"} />
            {mine ? "You" : snap.author.name}
            <span className="font-normal text-cam-muted">{relativeTime(snap.createdAt)}</span>
          </h1>
        }
        right={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More" className={camButtonSm}>
                <Ellipsis className="size-5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mine && <DropdownMenuItem onSelect={() => setPicking(true)}>{snap.recipe ? "Change recipe" : "Link a recipe"}</DropdownMenuItem>}
              {mine && snap.recipe && (
                <DropdownMenuItem
                  onSelect={() =>
                    link.mutate(null, {
                      onSuccess: () => toast("Recipe unlinked", "success"),
                      onError: () => toast("Could not unlink the recipe", "danger"),
                    })
                  }
                >
                  Unlink recipe
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => saveImage(snap.imageUrl)}>Save photo</DropdownMenuItem>
              {mine && (
                <DropdownMenuItem className="text-danger" onSelect={() => setConfirm(true)}>
                  Delete Snap
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex-1" />
      <article aria-label={alt} onPointerDown={onPointerDown} onPointerUp={onPointerUp} className="touch-pan-x">
        <PhotoFrame>
          {/* The grid's thumbnail is already on the device: it fills the frame until the full photo arrives. */}
          <img
            src={snap.imageUrl}
            alt={alt}
            className="size-full bg-cover bg-center object-cover"
            style={{ backgroundImage: `url("${snap.thumbUrl}")` }}
            draggable={false}
          />
          {snap.caption && <p className={captionPill}>{snap.caption}</p>}
        </PhotoFrame>
      </article>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {snap.recipe && (
          <Link
            to={`/snaps/${snap.id}/recipe`}
            aria-label={`Linked recipe: ${snap.recipe.name}`}
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-cam-ink py-1 pr-3 pl-1.5 text-sm font-semibold text-cam"
          >
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast">
              <BookOpen className="size-4" aria-hidden />
            </span>
            <span className="truncate">{snap.recipe.name}</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </Link>
        )}
        {where && (
          <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-cam-chip px-4 text-sm font-semibold">
            <MapPin className="size-4" aria-hidden />
            {where}
          </span>
        )}
        {mine && !snap.recipe && (
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cam-accent px-4 text-sm font-semibold text-cam-accent-ink" onClick={() => setPicking(true)}>
            <Plus className="size-4" aria-hidden />
            Link a recipe
          </button>
        )}
      </div>

      <div className="flex-1" />
      {mine ? <WhoReacted snap={snap} /> : <ReactionBar snap={snap} />}

      <ThreeUp
        className="mt-4 px-3"
        left={
          <span className="flex gap-1">
            <Link to="/feed" aria-label="Back to the Feed" className={camButton}>
              <LayoutGrid className="size-5" aria-hidden />
            </Link>
            <Link to="/recipes" aria-label="Recipes" className={camButton}>
              <BookOpen className="size-5" aria-hidden />
            </Link>
          </span>
        }
        center={
          <Link to="/" aria-label="Back to camera" className="inline-flex size-16 rounded-full border-[3px] border-cam-accent p-1">
            <span className="block size-full rounded-full bg-cam-ink" />
          </Link>
        }
        right={
          <span className="flex gap-1">
            <button type="button" aria-label="Newer Snap" disabled={!newer} className={`${camButtonSm} disabled:invisible`} onClick={() => newer && navigate(`/snaps/${newer.id}`, { replace: true })}>
              <ChevronUp className="size-5" aria-hidden />
            </button>
            <button type="button" aria-label="Older Snap" disabled={!older} className={`${camButtonSm} disabled:invisible`} onClick={() => older && navigate(`/snaps/${older.id}`, { replace: true })}>
              <ChevronDown className="size-5" aria-hidden />
            </button>
          </span>
        }
      />

      {mine && (
        <RecipePicker
          open={picking}
          onOpenChange={setPicking}
          snapId={snap.id}
          initialQuery={snap.dishName ?? ""}
          busy={link.isPending}
          onPick={(r) =>
            link.mutate(r.id, {
              onSuccess: () => {
                setPicking(false);
                toast("Recipe linked", "success");
              },
              onError: (e) => {
                setPicking(false);
                toast(e instanceof ApiRequestError && e.status === 404 ? "That recipe is no longer there" : "Could not link the recipe", "danger");
              },
            })
          }
        />
      )}
      {mine && (
        <Dialog open={confirm} onOpenChange={setConfirm} title="Delete this Snap?" description="Your friends won't see it any more. This can't be undone.">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() =>
                del.mutate(undefined, {
                  onSuccess: () => {
                    toast("Snap deleted");
                    navigate("/feed", { replace: true });
                  },
                  onError: () => toast("Couldn't delete the Snap", "danger"),
                })
              }
            >
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
