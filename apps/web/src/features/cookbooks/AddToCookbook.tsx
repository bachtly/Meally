import { Dialog, useToast } from "../../ui";
import { useCookbookMutations, useCookbooks, useCookbooksWithRecipe } from "./api";

/** "Add to cookbook" dialog: a checkbox per hand-picked cookbook. */
export function AddToCookbook({ open, onOpenChange, recipeSlug }: { open: boolean; onOpenChange: (o: boolean) => void; recipeSlug: string }) {
  const books = useCookbooks(open);
  const has = useCookbooksWithRecipe(recipeSlug, open);
  const { add, drop } = useCookbookMutations();
  const toast = useToast();
  const manual = (books.data ?? []).filter((c) => c.kind === "manual");
  const held = new Set(has.data ?? []);

  const toggle = (cookbook: string, name: string) => {
    const on = held.has(cookbook);
    (on ? drop : add).mutate(
      { cookbook, recipe: recipeSlug },
      {
        onSuccess: () => {
          void has.refetch();
          toast(on ? `Removed from ${name}` : `Added to ${name}`);
        },
        onError: () => toast("Could not update the cookbook"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add to cookbook" description="Choose the hand-picked cookbooks for this recipe.">
      {books.isPending || has.isPending ? (
        <p aria-busy="true" className="text-muted">
          Loading…
        </p>
      ) : books.isError || has.isError ? (
        <p role="alert">Could not load your cookbooks.</p>
      ) : manual.length === 0 ? (
        <p className="text-muted">You have no hand-picked cookbooks yet. Create one from the Cookbooks page.</p>
      ) : (
        <fieldset className="flex flex-col">
          <legend className="sr-only">Cookbooks</legend>
          {manual.map((c) => (
            <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-sunken">
              <input type="checkbox" className="size-5" checked={held.has(c.slug)} onChange={() => toggle(c.slug, c.name)} />
              <span>{c.name}</span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
