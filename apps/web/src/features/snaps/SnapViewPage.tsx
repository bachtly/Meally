import { ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { ApiRequestError } from "../../lib/api";
import { Button, Card, EmptyState, Skeleton } from "../../ui";
import { useSession } from "../auth/useSession";
import { DeadLink } from "../share/PublicRecipeView";
import { SnapCard } from "./FeedPage";
import { useSnap } from "./view-api";

const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium";

export function BackToFeed() {
  return (
    <Link to="/feed" className="inline-flex min-h-11 items-center gap-1 self-start rounded-md pr-3 text-accent underline">
      <ChevronLeft className="size-4" aria-hidden />
      Feed
    </Link>
  );
}

/** `/snaps/:id`: one Snap with its actions. A missing, deleted or not-yours Snap is the same dead end. */
export function SnapViewPage() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const q = useSnap(id);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <BackToFeed />
      {q.isPending ? (
        <Skeleton className="aspect-[3/4] w-full" aria-busy="true" />
      ) : q.isError ? (
        q.error instanceof ApiRequestError && q.error.status === 404 ? (
          <DeadLink />
        ) : (
          <EmptyState title="Couldn't load this Snap" action={<Button onClick={() => void q.refetch()}>Try again</Button>}>
            Check your connection, then try again.
          </EmptyState>
        )
      ) : (
        <>
          <SnapCard snap={q.data} link={false} />
          {q.data.recipe && (
            <Link to={`/snaps/${q.data.id}/recipe`} className={`${linkButton} border border-line bg-raised hover:bg-sunken`}>
              Linked recipe: {q.data.recipe.name}
            </Link>
          )}
          {q.data.author.id === user?.id && (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="text-sm font-medium">Reactions</h2>
              {!q.data.reactions || q.data.reactions.length === 0 ? (
                <p className="text-sm text-muted">No reactions yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {q.data.reactions.map((r) => (
                    <li key={`${r.userId}-${r.emoji}`}>
                      {r.name}: {r.emoji}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
