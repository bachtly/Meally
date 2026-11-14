import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { RecipeSummary } from "@meally/shared";
import { Button, EmptyState, Field, Input, Sheet, Skeleton } from "../../ui";
import { useRecipes } from "../recipes/api";

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
        <div aria-busy="true" aria-label="Loading recipes" className="flex flex-col gap-2">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
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
            <li key={r.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(r)}
                className="flex min-h-11 w-full items-center rounded-md px-3 text-left hover:bg-sunken disabled:opacity-60"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
