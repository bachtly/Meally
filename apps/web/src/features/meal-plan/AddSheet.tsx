import { useState } from "react";
import { Shuffle } from "lucide-react";
import type { MealPlanRecipeSummary, MealType } from "@meally/shared";
import { Button, Field, Input, Sheet, Skeleton, useToast } from "../../ui";
import { RecipeThumb } from "../recipes/RecipeThumb";
import { useRecipes } from "../recipes/api";
import { suggest, useAddEntry } from "./api";
import { MealTypeControl } from "./MealTypeControl";

export interface AddSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  mealType?: MealType;
  /** Recipe already chosen (the "Add to plan" action on a recipe page). */
  recipe?: { id: string; name: string } | null;
  onAdded?: () => void;
}

export function AddSheet(props: AddSheetProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange} title="Add to plan" description="Pick a recipe, get a suggestion, or write a note.">
      {props.open && <AddForm {...props} />}
    </Sheet>
  );
}

function AddForm({ onOpenChange, date: initialDate, mealType: initialType = "dinner", recipe, onAdded }: AddSheetProps) {
  const toast = useToast();
  const add = useAddEntry();
  const [date, setDate] = useState(initialDate);
  const [mealType, setMealType] = useState<MealType>(initialType);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(recipe ?? null);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [sug, setSug] = useState<{ recipe: MealPlanRecipeSummary | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const recipes = useRecipes({ q, limit: 8 });
  const results = recipes.data?.pages.flatMap((p) => p.items) ?? [];

  async function save(entry: { recipeId?: string; title?: string }) {
    try {
      await add.mutateAsync({ date, mealType, ...entry });
      toast("Added to your plan", "success");
      onAdded?.();
      onOpenChange(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add", "danger");
    }
  }

  async function surprise() {
    setBusy(true);
    try {
      setSug({ recipe: await suggest(date, mealType) });
    } catch {
      toast("Could not get a suggestion", "danger");
    } finally {
      setBusy(false);
    }
  }

  const canAdd = !!picked || !!text.trim();
  return (
    <div className="flex flex-col gap-4">
      <Field label="Day">
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </Field>
      <MealTypeControl value={mealType} onChange={setMealType} />

      {picked ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-sunken p-3">
          <span>
            <span className="text-muted">Recipe: </span>
            <strong>{picked.name}</strong>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <Field label="Search recipes">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          {recipes.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <ul className="flex max-h-48 flex-col overflow-y-auto" aria-label="Recipes">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setPicked({ id: r.id, name: r.name })} className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-1 text-left hover:bg-sunken">
                    <RecipeThumb name={r.name} imageUrl={r.imageUrl} sizes="32px" className="size-8 shrink-0 rounded" textClass="text-sm" />
                    {r.name}
                  </button>
                </li>
              ))}
              {!results.length && <li className="px-3 py-2 text-muted">No recipes found.</li>}
            </ul>
          )}
          <Button variant="secondary" onClick={surprise} loading={busy}>
            <Shuffle className="size-4" aria-hidden /> Surprise me
          </Button>
          {sug && (
            <div className="flex flex-col gap-2 rounded-md border border-line p-3" role="status">
              {sug.recipe ? (
                <>
                  <p>
                    How about <strong>{sug.recipe.name}</strong>?
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void save({ recipeId: sug.recipe!.id })}>
                      Accept
                    </Button>
                    <Button size="sm" variant="secondary" onClick={surprise} loading={busy}>
                      Another
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-muted">No suggestions yet. Add some recipes or relax your rules.</p>
              )}
            </div>
          )}
          <Field label="Or a note" hint="Like Leftovers or Eat out.">
            <Input value={text} maxLength={120} onChange={(e) => setText(e.target.value)} />
          </Field>
        </>
      )}
      <Button disabled={!canAdd} loading={add.isPending} onClick={() => void save(picked ? { recipeId: picked.id } : { title: text.trim() })}>
        Add to plan
      </Button>
    </div>
  );
}
