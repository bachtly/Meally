import { BookOpen, Camera, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { Snap } from "@meally/shared";
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui";
import { useSession } from "../auth/useSession";
import { useFeature } from "../features/FeaturesProvider";
import { relativeTime } from "../timeline/api";
import { useFeed } from "./api";
import { ThreeUp } from "./parts";

type View = "all" | "months";

/** One square in the grid. A photo that fails to load shows its caption or dish on a plain tile. */
function Tile({ snap }: { snap: Snap }) {
  const [broken, setBroken] = useState(false);
  const text = snap.caption || snap.dishName;
  return (
    <Link
      to={`/snaps/${snap.id}`}
      aria-label={`${snap.author.name}, ${relativeTime(snap.createdAt)}${text ? `: ${text}` : ""}`}
      className="relative block aspect-square overflow-hidden bg-cam-chip focus-visible:z-10"
    >
      {broken ? (
        <span className="grid size-full place-items-center p-2 text-center text-xs text-cam-muted">{text || "Photo unavailable"}</span>
      ) : (
        <img src={snap.thumbUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      )}
      {snap.recipe && <BookOpen className="absolute bottom-1.5 left-1.5 size-4 text-cam-ink drop-shadow-[0_1px_2px_rgb(0_0_0/0.7)]" aria-hidden />}
    </Link>
  );
}

const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}`;
};

/** Months view: a cover card per month, the newest month largest, as the Photos app does. */
function Months({ snaps, onOpen }: { snaps: Snap[]; onOpen: () => void }) {
  const months = useMemo(() => {
    const out: { key: string; label: string; cover: Snap; count: number }[] = [];
    const thisYear = new Date().getFullYear();
    for (const s of snaps) {
      const key = monthKey(s.createdAt);
      const last = out.at(-1);
      if (last?.key === key) last.count++;
      else {
        const d = new Date(s.createdAt);
        const label = d.toLocaleDateString(undefined, d.getFullYear() === thisYear ? { month: "long" } : { month: "long", year: "numeric" });
        out.push({ key, label, cover: s, count: 1 });
      }
    }
    return out;
  }, [snaps]);
  return (
    <div className="grid grid-cols-2 gap-3 px-3 pt-28 pb-32">
      {months.map((m, i) => (
        <button
          key={m.key}
          type="button"
          onClick={onOpen}
          className={cn("relative overflow-hidden rounded-3xl bg-cam-chip text-left", i === 0 ? "col-span-2 h-72" : "h-44")}
        >
          <img src={m.cover.imageUrl} alt="" className="absolute inset-0 size-full object-cover" />
          <span className="absolute inset-x-0 top-0 flex flex-col bg-gradient-to-b from-cam-scrim to-transparent p-4 pb-8">
            <span className={cn("font-bold", i === 0 ? "text-2xl" : "text-lg")}>{m.label}</span>
            <span className="text-sm">{m.count === 1 ? "1 Snap" : `${m.count} Snaps`}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * `/feed`: your Snaps and your friends' as a photo library. A square grid, edge to edge, with the newest at the
 * bottom right next to your thumb; Months gives one card per month. Tap a photo to open it.
 */
export function FeedPage() {
  const q = useFeed();
  const { user } = useSession();
  const friendsOn = useFeature("friends");
  const [view, setView] = useState<View>("all");
  const [who, setWho] = useState<string | null>(null);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const authors = useMemo(() => [...new Map(all.map((s) => [s.author.id, s.author.id === user?.id ? "You" : s.author.name])).entries()], [all, user?.id]);
  const shown = who ? all.filter((s) => s.author.id === who) : all;
  const whoName = who ? authors.find(([id]) => id === who)?.[1] : undefined;

  const tab = (v: View, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === v}
      onClick={() => setView(v)}
      className={cn("min-h-11 rounded-full px-5 text-sm font-semibold", view === v ? "bg-cam-ink text-cam" : "text-cam-ink")}
    >
      {label}
    </button>
  );

  let body;
  if (q.isPending) {
    body = (
      <div aria-busy="true" aria-label="Loading the Feed" className="mt-auto grid grid-cols-3 gap-0.5">
        {Array.from({ length: 15 }, (_, i) => (
          <span key={i} className="aspect-square bg-cam-chip motion-safe:animate-pulse" />
        ))}
      </div>
    );
  } else if (q.isError) {
    body = (
      <div className="m-auto flex flex-col items-center gap-3 px-8 text-center">
        <h2 className="text-xl font-bold">Couldn't load the Feed</h2>
        <p className="text-cam-muted">Check your connection, then try again.</p>
        <button type="button" className="min-h-12 rounded-full bg-cam-accent px-6 font-semibold text-cam-accent-ink" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    );
  } else if (all.length === 0) {
    body = (
      <div className="m-auto flex w-full flex-col items-center gap-4 px-8 text-center">
        <h2 className="text-2xl font-bold">No Snaps yet</h2>
        <p className="text-cam-muted">Snap what you cook or eat. Your friends' Snaps fill in around yours.</p>
        <Link to="/" className="flex min-h-13 w-full items-center justify-center rounded-full bg-cam-accent font-semibold text-cam-accent-ink">
          Take a Snap
        </Link>
        {friendsOn && (
          <Link to="/friends" className="flex min-h-13 w-full items-center justify-center rounded-full bg-cam-chip font-semibold">
            Add friends
          </Link>
        )}
      </div>
    );
  } else if (view === "months") {
    body = <Months snaps={shown} onOpen={() => setView("all")} />;
  } else {
    // Oldest first, inside a column-reverse scroller: the page opens at the bottom, on the newest Snap.
    body = (
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain">
        <div className="h-28 shrink-0" />
        {shown.length === 0 ? (
          <p className="m-auto px-8 text-center text-cam-muted">No Snaps from {whoName} yet.</p>
        ) : (
          <ul className="grid shrink-0 grid-cols-3 gap-0.5">
            {[...shown].reverse().map((s) => (
              <li key={s.id}>
                <Tile snap={s} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex shrink-0 flex-col items-center gap-2 pt-28 pb-3">
          {q.isFetchNextPageError && (
            <p role="alert" className="text-sm text-danger">
              Couldn't load more.
            </p>
          )}
          {q.hasNextPage && (
            <button
              type="button"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
              className="min-h-11 rounded-full bg-cam-chip px-5 text-sm font-semibold disabled:opacity-60"
            >
              {q.isFetchNextPageError ? "Try again" : q.isFetchingNextPage ? "Loading…" : "Load earlier"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-cam">
      {view === "months" || all.length === 0 || q.isPending || q.isError ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</div> : body}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-cam to-transparent" />
      <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Feed</h1>
          {all.length > 0 && <p className="text-[15px] text-cam-muted">{whoName ? `Only ${whoName}` : "You and your friends"}</p>}
        </div>
        {authors.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="mt-0.5 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cam-chip pr-3 pl-4 text-sm font-semibold backdrop-blur">
                {whoName ?? "Everyone"}
                <ChevronDown className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setWho(null)}>Everyone</DropdownMenuItem>
              {authors.map(([id, name]) => (
                <DropdownMenuItem key={id} onSelect={() => setWho(id)}>
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-cam to-transparent" />
      <ThreeUp
        className="absolute inset-x-4 bottom-6"
        center={
          all.length > 0 && (
            <div role="tablist" aria-label="View" className="flex rounded-full bg-cam-chip p-1 backdrop-blur">
              {tab("months", "Months")}
              {tab("all", "All")}
            </div>
          )
        }
        right={
          <Link to="/" aria-label="Back to camera" className="inline-flex size-13 items-center justify-center rounded-full bg-cam-ink text-cam">
            <Camera className="size-6" aria-hidden />
          </Link>
        }
      />
    </div>
  );
}
