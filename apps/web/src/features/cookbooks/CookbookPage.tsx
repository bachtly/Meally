import { Pencil, Share2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError } from "../../lib/api";
import { Button, Dialog, EmptyState, IconButton, Skeleton, useToast } from "../../ui";
import { GRID, RecipeCard } from "../recipes/RecipeLibrary";
import { useFeature } from "../features/FeaturesProvider";
import { ShareDialog } from "../share/ShareDialog";
import { CookbookDialog, describeFilter } from "./CookbookDialog";
import { countLabel } from "./CookbooksPage";
import { useCookbook, useCookbookMutations, useCookbookRecipes } from "./api";

export function CookbookPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const cb = useCookbook(slug);
  const recipes = useCookbookRecipes(slug);
  const { remove, drop } = useCookbookMutations();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shareOn = useFeature("share-links");

  if (cb.isPending) return <Skeleton aria-busy="true" className="h-40" />;
  if (cb.isError) {
    const missing = cb.error instanceof ApiRequestError && cb.error.status === 404;
    return (
      <EmptyState
        title={missing ? "Cookbook not found" : "Could not load this cookbook"}
        action={
          missing ? (
            <Link to="/cookbooks" className="text-accent underline">
              Back to cookbooks
            </Link>
          ) : (
            <Button onClick={() => void cb.refetch()}>Try again</Button>
          )
        }
      >
        {missing ? "It may have been deleted." : "Check your connection and try again."}
      </EmptyState>
    );
  }
  const c = cb.data;
  const items = recipes.data?.pages.flatMap((p) => p.items) ?? [];
  const manual = c.kind === "manual";

  return (
    <>
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-tight">{c.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {countLabel(c)} · {manual ? "Hand-picked" : `Smart: ${describeFilter(c.filter)}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {shareOn && (
              <Button variant="secondary" size="sm" onClick={() => setSharing(true)}>
                <Share2 className="size-4" aria-hidden />
                Share
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </div>
        </div>
        {c.description && <p className="mt-2 max-w-prose text-lg text-muted">{c.description}</p>}
      </header>

      {recipes.isPending ? (
        <ul aria-busy="true" aria-label="Loading recipes" className={GRID}>
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <Skeleton className="aspect-[4/3]" />
            </li>
          ))}
        </ul>
      ) : recipes.isError ? (
        <EmptyState title="Could not load recipes" action={<Button onClick={() => void recipes.refetch()}>Try again</Button>}>
          Check your connection and try again.
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title="No recipes here yet">
          {manual ? "Open a recipe and choose Add to cookbook from its menu." : "No recipes match this cookbook's filter right now."}
        </EmptyState>
      ) : (
        <>
          <ul className={GRID}>
            {items.map((r) => (
              <RecipeCard
                key={r.id}
                recipe={r}
                extra={
                  manual && (
                    <IconButton
                      aria-label={`Remove ${r.name} from this cookbook`}
                      className="absolute bottom-1 right-1 bg-raised/80 backdrop-blur"
                      onClick={() => drop.mutate({ cookbook: c.slug, recipe: r.slug }, { onSuccess: () => toast("Removed from cookbook") })}
                    >
                      <X className="size-4" aria-hidden />
                    </IconButton>
                  )
                }
              />
            ))}
          </ul>
          {recipes.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" loading={recipes.isFetchingNextPage} onClick={() => void recipes.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {shareOn && <ShareDialog target={{ kind: "cookbook", slug: c.slug, name: c.name }} open={sharing} onOpenChange={setSharing} />}
      <CookbookDialog open={editing} onOpenChange={setEditing} cookbook={c} onSaved={(n) => n.slug !== c.slug && navigate(`/cookbooks/${n.slug}`, { replace: true })} />
      <Dialog open={confirm} onOpenChange={setConfirm} title="Delete this cookbook?" description="The recipes in it are not deleted.">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(c.slug, { onSuccess: () => navigate("/cookbooks", { replace: true }) })}>
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  );
}
