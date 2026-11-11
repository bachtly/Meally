import { useState } from "react";
import type { Cookbook, CookbookFilter } from "@meally/shared";
import { Button, Dialog, Field, Input, Textarea, useToast } from "../../ui";
import { useCookbookMutations } from "./api";

/** A short human summary of a smart filter, e.g. "tag: quick, favourites". */
export function describeFilter(f: CookbookFilter | null | undefined): string {
  if (!f) return "";
  const parts = [
    f.q ? `search "${f.q}"` : "",
    ...f.tag.map((s) => `tag: ${s}`),
    ...f.category.map((s) => `category: ${s}`),
    ...f.tool.map((s) => `tool: ${s}`),
    f.favourites ? "favourites" : "",
    f.minRating ? `${f.minRating}+ stars` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "All recipes";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing cookbook; otherwise creating one. */
  cookbook?: Cookbook;
  /** Pre-filled smart filter (from the library). */
  filter?: CookbookFilter;
  onSaved?: (cookbook: Cookbook) => void;
}

export function CookbookDialog({ open, onOpenChange, cookbook, filter, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={cookbook ? "Edit cookbook" : filter ? "Save as cookbook" : "New cookbook"}>
      {open && <Form cookbook={cookbook} filter={filter} close={() => onOpenChange(false)} onSaved={onSaved} />}
    </Dialog>
  );
}

function Form({ cookbook, filter, close, onSaved }: { cookbook?: Cookbook; filter?: CookbookFilter; close: () => void; onSaved?: (c: Cookbook) => void }) {
  const { create, update } = useCookbookMutations();
  const toast = useToast();
  const [name, setName] = useState(cookbook?.name ?? "");
  const [description, setDescription] = useState(cookbook?.description ?? "");
  const [kind, setKind] = useState<"smart" | "manual">(cookbook?.kind ?? (filter ? "smart" : "manual"));
  const [error, setError] = useState("");
  const pending = create.isPending || update.isPending;
  const shown = cookbook?.filter ?? filter;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the cookbook a name.");
    try {
      const saved = cookbook
        ? await update.mutateAsync({ slug: cookbook.slug, patch: { name: name.trim(), description: description.trim() } })
        : await create.mutateAsync({
            name: name.trim(),
            description: description.trim() || undefined,
            kind,
            ...(kind === "smart" ? { filter: filter ?? { tag: [], category: [], tool: [], favourites: false } } : {}),
          });
      toast(cookbook ? "Cookbook saved" : "Cookbook created");
      close();
      onSaved?.(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the cookbook.");
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Name" error={error}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
      </Field>
      <Field label="Description (optional)">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </Field>
      {!cookbook && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Kind</legend>
          {(
            [
              ["manual", "Hand-picked", "You choose the recipes and their order."],
              ["smart", "Smart", "Fills itself from a saved filter."],
            ] as const
          ).map(([v, label, hint]) => (
            <label key={v} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-sunken">
              <input type="radio" name="kind" className="size-5" checked={kind === v} disabled={!!filter && v === "manual"} onChange={() => setKind(v)} />
              <span>
                {label}
                <span className="block text-sm text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {kind === "smart" && shown && <p className="text-sm text-muted">Filter: {describeFilter(shown)}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
