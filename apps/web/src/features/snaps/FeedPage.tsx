import { useState } from "react";
import { Link } from "react-router";
import type { Snap } from "@meally/shared";
import { Button, EmptyState, Skeleton } from "../../ui";
import { Feature } from "../features/Feature";
import { relativeTime } from "../timeline/api";
import { useFeed } from "./api";

const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium";

/** `link`: the heading opens the Snap view (off on the Snap view itself). */
export function SnapCard({ snap, link = true }: { snap: Snap; link?: boolean }) {
  const [broken, setBroken] = useState(false);
  const alt = snap.caption || snap.dishName || `Snap by ${snap.author.name}`;
  const where = [snap.dishName, snap.place].filter(Boolean).join(" · ");
  return (
    <article aria-labelledby={`snap-${snap.id}`} className="relative aspect-[3/4] snap-start overflow-hidden rounded-lg bg-sunken">
      {broken ? (
        <div className="grid size-full place-items-center p-6 text-center text-muted">{snap.caption || snap.dishName || "Photo unavailable"}</div>
      ) : (
        <img src={snap.imageUrl} alt={alt} loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      )}
      {/* The scrim uses theme tokens, so text keeps AA contrast in both themes. */}
      <div className="absolute inset-x-0 top-0 bg-ink/70 px-3 py-2 text-surface">
        <h2 id={`snap-${snap.id}`} className="text-sm font-medium">
          {link ? (
            <Link to={`/snaps/${snap.id}`} className="inline-flex min-h-11 items-center underline">
              {snap.author.name} · {relativeTime(snap.createdAt)}
            </Link>
          ) : (
            <>
              {snap.author.name} · {relativeTime(snap.createdAt)}
            </>
          )}
        </h2>
      </div>
      {(snap.caption || where || snap.recipe) && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-ink/70 px-3 py-3 text-surface">
          {snap.caption && <p>{snap.caption}</p>}
          {snap.recipe && <p className="text-sm">Recipe: {snap.recipe.name}</p>}
          {where && <p className="text-sm">{where}</p>}
        </div>
      )}
    </article>
  );
}

export function FeedPage() {
  const q = useFeed();
  const snaps = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Feed</h1>
        <Link to="/" className="inline-flex min-h-11 items-center rounded-md px-3 font-medium text-accent underline">
          Take a Snap
        </Link>
      </div>
      {q.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="aspect-[3/4] w-full" />
          <Skeleton className="aspect-[3/4] w-full" />
        </div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load the Feed" action={<Button onClick={() => void q.refetch()}>Try again</Button>}>
          Check your connection, then try again.
        </EmptyState>
      ) : snaps.length === 0 ? (
        <EmptyState
          title="No Snaps yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/" className={`${linkButton} bg-accent text-accent-contrast hover:bg-accent-hover`}>
                Take a Snap
              </Link>
              <Feature on="friends">
                <Link to="/friends" className={`${linkButton} border border-line bg-raised hover:bg-sunken`}>
                  Add friends
                </Link>
              </Feature>
            </div>
          }
        >
          Snaps from you and your friends show up here.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {snaps.map((s) => (
              <li key={s.id}>
                <SnapCard snap={s} />
              </li>
            ))}
          </ul>
          {q.isFetchNextPageError && (
            <p role="alert" className="text-center text-sm text-danger">
              Couldn't load more.
            </p>
          )}
          {q.hasNextPage && (
            <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchNextPageError ? "Try again" : "Load more"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
