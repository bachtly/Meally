import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Dialog, useToast } from "../../ui";
import { Feature } from "../features/Feature";
import { useAddRecipe, useListMutations, useLists } from "./api";

function Inner({ slug, servings }: { slug: string; servings: number | null }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(servings ?? 1);
  const [listId, setListId] = useState("");
  const lists = useLists(open);
  const create = useListMutations().create;
  const add = useAddRecipe();
  const toast = useToast();
  const navigate = useNavigate();
  const items = lists.data ?? [];
  const chosen = listId || items[0]?.id || "";

  const submit = async () => {
    try {
      let target = chosen;
      if (!target) target = (await create.mutateAsync("Shopping list")).id;
      const res = await add.mutateAsync({ listId: target, slug, servings: servings == null ? undefined : count });
      setOpen(false);
      toast(`Added ${res.items.length} items`, "success", { label: "View list", onClick: () => navigate(`/shopping/${target}`) });
    } catch {
      toast("Could not add to the list", "danger");
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ShoppingCart className="size-4" aria-hidden />
        Add to shopping list
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Add to shopping list">
        <div className="flex flex-col gap-4">
          {items.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              List
              <select className="min-h-11 rounded-md border border-line bg-raised px-3 text-base" value={chosen} onChange={(e) => setListId(e.target.value)}>
                {items.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-muted">{lists.isPending ? "Loading lists…" : "No lists yet. A new one will be created."}</p>
          )}
          {servings != null && (
            <div className="flex items-center justify-between">
              <span className="font-medium" id="serv-l">
                Servings
              </span>
              <div className="flex items-center gap-2" role="group" aria-labelledby="serv-l">
                <Button variant="secondary" aria-label="Fewer servings" disabled={count <= 1} onClick={() => setCount(count - 1)}>
                  <Minus className="size-4" aria-hidden />
                </Button>
                <output className="w-8 text-center text-lg font-semibold" aria-label="Servings">
                  {count}
                </output>
                <Button variant="secondary" aria-label="More servings" onClick={() => setCount(count + 1)}>
                  <Plus className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={add.isPending || create.isPending} disabled={lists.isPending} onClick={() => void submit()}>
              Add
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Recipe-page action; renders nothing when the shopping-lists flag is off. */
export function AddToListButton(props: { slug: string; servings: number | null }) {
  return (
    <Feature on="shopping-lists">
      <Inner {...props} />
    </Feature>
  );
}
