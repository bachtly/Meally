import { ChevronDown, ChevronRight, Ellipsis, ListTree, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { parseIngredient, type AisleLabel, type ShoppingItem } from "@meally/shared";
import { ApiRequestError } from "../../lib/api";
import { Badge, Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, Input, Skeleton, useToast } from "../../ui";
import { cn } from "../../ui";
import { AislesSheet } from "./AislesSheet";
import { useAisles, useItemMutations, useList } from "./api";
import { groupItems, itemParts } from "./model";
import { useListEvents } from "./useListEvents";

type Mut = ReturnType<typeof useItemMutations>;

function Row({ item, m, aisles, onEdit, onAisle }: { item: ShoppingItem; m: Mut; aisles: AisleLabel[]; onEdit: () => void; onAisle: () => void }) {
  const { amount, name, note } = itemParts(item);
  const toggle = () => m.toggle.mutate({ id: item.id, checked: !item.checked });
  void aisles;
  return (
    <li className="flex items-center border-b border-line last:border-0">
      <label className="flex min-h-14 flex-1 cursor-pointer items-center gap-3 py-2 pl-1">
        <input type="checkbox" className="size-7 shrink-0" checked={item.checked} onChange={toggle} aria-label={item.text} />
        <span className="flex min-w-0 flex-col">
          <span className={cn("text-lg", item.checked && "text-muted line-through")}>
            {amount && <strong className="font-semibold">{amount} </strong>}
            {name}
            {note && <span className="text-muted">, {note}</span>}
          </span>
          {item.recipeRefs.length > 0 && (
            <span className="text-xs text-muted">
              From{" "}
              {item.recipeRefs.map((r, i) => (
                <span key={r.slug}>
                  {i > 0 && ", "}
                  <Link to={`/recipes/${r.slug}`} className="underline" onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                </span>
              ))}
            </span>
          )}
        </span>
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Actions for ${item.text}`}>
            <Ellipsis className="size-5" aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-4" aria-hidden />
            Edit text
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAisle}>
            <ListTree className="size-4" aria-hidden />
            Set aisle
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => m.remove.mutate(item.id)}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ShoppingListPage() {
  const { id = "" } = useParams();
  const query = useList(id);
  const aisles = useAisles().data ?? [];
  const m = useItemMutations(id);
  const live = useListEvents(id);
  const toast = useToast();
  const [text, setText] = useState("");
  const [cartOpen, setCartOpen] = useState(true);
  const [aislesOpen, setAislesOpen] = useState(false);
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [editText, setEditText] = useState("");
  const [picking, setPicking] = useState<ShoppingItem | null>(null);
  const { groups, cart } = useMemo(() => groupItems(query.data?.items ?? [], aisles), [query.data, aisles]);

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading list" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <EmptyState
        title={missing ? "List not found" : "Could not load this list"}
        action={
          <Link to="/shopping" className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-medium text-accent-contrast">
            All lists
          </Link>
        }
      >
        {missing ? "It may have been deleted." : "Check your connection and try again."}
      </EmptyState>
    );
  }

  const preview = text.trim() ? parseIngredient(text.trim()) : null;
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    m.add.mutate(t, { onError: () => toast("Could not add the item", "danger") });
  };
  const { list } = query.data;
  const empty = groups.length === 0 && cart.length === 0;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Link to="/shopping" className="text-sm text-muted underline">
            All lists
          </Link>
          <h1 className="truncate text-2xl font-semibold">{list.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted" title={live ? "Updating live" : "Not connected"}>
            <span aria-hidden className={cn("size-2 rounded-full", live ? "bg-success" : "bg-line")} />
            {live ? "Live" : "Offline"}
          </span>
          <Button variant="secondary" onClick={() => setAislesOpen(true)}>
            Aisles
          </Button>
        </div>
      </div>

      <form onSubmit={add} className="sticky top-14 z-10 -mx-1 mb-4 bg-surface px-1 py-2">
        <div className="flex gap-2">
          <Input aria-label="Add item" placeholder="Add item, e.g. 2 cups flour" value={text} onChange={(e) => setText(e.target.value)} className="min-h-12 text-lg" />
          <Button type="submit" size="lg" disabled={!text.trim()}>
            Add
          </Button>
        </div>
        {preview && (
          <div className="mt-2 flex flex-wrap gap-2" aria-live="polite" data-testid="preview">
            {preview.quantity != null && <Badge>Qty {preview.quantity}</Badge>}
            {preview.unit && <Badge>Unit {preview.unit}</Badge>}
            <Badge tone="accent">{preview.food ?? text.trim()}</Badge>
            {preview.note && <Badge>Note {preview.note}</Badge>}
          </div>
        )}
      </form>

      {empty && <EmptyState title="Nothing to buy">Add an item above, or add a recipe from its page.</EmptyState>}

      {groups.map((g) => (
        <section key={g.id ?? "none"} aria-labelledby={`aisle-${g.id ?? "none"}`} className="mb-4">
          <h2 id={`aisle-${g.id ?? "none"}`} className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            {g.name}
          </h2>
          <ul>
            {g.items.map((i) => (
              <Row key={i.id} item={i} m={m} aisles={aisles} onEdit={() => (setEditText(i.text), setEditing(i))} onAisle={() => setPicking(i)} />
            ))}
          </ul>
        </section>
      ))}

      {cart.length > 0 && (
        <section aria-labelledby="cart-h" className="mt-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 id="cart-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
              <button type="button" className="inline-flex min-h-11 items-center gap-1" aria-expanded={cartOpen} onClick={() => setCartOpen(!cartOpen)}>
                {cartOpen ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                In the cart ({cart.length})
              </button>
            </h2>
            <Button variant="ghost" size="sm" onClick={() => m.clearChecked.mutate()}>
              Clear checked
            </Button>
          </div>
          {cartOpen && (
            <ul>
              {cart.map((i) => (
                <Row key={i.id} item={i} m={m} aisles={aisles} onEdit={() => (setEditText(i.text), setEditing(i))} onAisle={() => setPicking(i)} />
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit item">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (editing && editText.trim()) m.edit.mutate({ id: editing.id, text: editText.trim() });
            setEditing(null);
          }}
        >
          <Input aria-label="Item text" value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!picking} onOpenChange={(o) => !o && setPicking(null)} title="Set aisle" description="Meally remembers this for next time.">
        <div className="flex flex-col gap-1">
          {[...aisles, null].map((a) => (
            <Button
              key={a?.id ?? "none"}
              variant={picking?.aisle === (a?.id ?? null) ? "primary" : "secondary"}
              className="justify-start"
              onClick={() => {
                if (picking) m.setAisle.mutate({ id: picking.id, aisle: a?.id ?? null });
                setPicking(null);
              }}
            >
              {a?.name ?? "No aisle"}
            </Button>
          ))}
        </div>
      </Dialog>

      <AislesSheet open={aislesOpen} onOpenChange={setAislesOpen} />
    </div>
  );
}
