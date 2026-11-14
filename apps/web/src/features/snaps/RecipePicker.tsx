import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { RecipeSummary } from "@meally/shared";
import { Button, EmptyState, Field, Input, Sheet, Skeleton } from "../../ui";
import { useRecipes } from "../recipes/api";
import { formatMinutes } from "../recipes/format";
import { RecipeThumb } from "../recipes/RecipeThumb";

/** Search over the person's own recipes inside a sheet. `initialQuery` is usually the dish name. */
export function RecipePicker({
  open,
  onOpenChange,
  initialQuery,
  snapId,
  onPick,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string;
  /** The Snap a new recipe should link to. Left out in the composer, where the Snap doesn't exist yet. */
  snapId?: string;
  onPick: (recipe: RecipeSummary) => void;
  busy?: boolean;
}) {
  const [text, setText] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery);
  useEffect(() => {
    if (open) {
      setText(initialQuery);
      setQ(initialQuery);
    }
  }, [open, initialQuery]);
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const list = useRecipes({ q, limit: 12, enabled: open });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const name = q.trim();
  const newHref = `/recipes/new?${new URLSearchParams({ ...(name ? { name } : {}), ...(snapId ? { linkSnap: snapId } : {}) })}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Link a recipe" description="Pick the recipe behind this Snap.">
      <Field label="Search your recipes">
        <Input type="search" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading recipes" className="flex flex-col gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-16 items-center gap-3 px-2">
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState title="Couldn't load your recipes" action={<Button onClick={() => void list.refetch()}>Try again</Button>}>
          Check your connection, then try again.
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          title={name ? `No recipe called "${name}"` : "No recipes yet"}
          action={
            <Link to={newHref} className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 font-medium text-accent-contrast">
              New recipe
            </Link>
          }
        >
          {snapId ? "Write it down now and it will be linked to this Snap." : "Write it down after you send, then link it from the Snap."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((r) => (
            <PickerRow key={r.id} recipe={r} disabled={busy} onPick={() => onPick(r)} />
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** "1 h 30 min · Serves 4", or null when neither is set. */
function recipeMeta(r: RecipeSummary): string | null {
  const parts = [formatMinutes(r.totalMinutes), r.servings != null ? `Serves ${r.servings}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** One pickable recipe: thumbnail, name, and a muted time/servings line. The name is the accessible name. */
function PickerRow({ recipe, disabled, onPick }: { recipe: RecipeSummary; disabled: boolean; onPick: () => void }) {
  const id = useId();
  const meta = recipeMeta(recipe);
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        aria-label={recipe.name}
        aria-describedby={meta ? id : undefined}
        className="flex min-h-16 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sunken disabled:opacity-60"
      >
        <RecipeThumb name={recipe.name} imageUrl={recipe.imageUrl} sizes="48px" lazy className="size-12 shrink-0 overflow-hidden rounded-md bg-sunken" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{recipe.name}</span>
          {meta && (
            <span id={id} className="truncate text-sm text-muted">
              {meta}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
