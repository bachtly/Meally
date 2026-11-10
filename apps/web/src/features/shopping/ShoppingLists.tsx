import { Ellipsis, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import type { ShoppingList } from "@meally/shared";
import { Button, Card, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, Input, Skeleton, useToast } from "../../ui";
import { useListMutations, useLists } from "./api";

export function ago(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

type Edit = { kind: "new" } | { kind: "rename"; list: ShoppingList } | { kind: "delete"; list: ShoppingList } | null;

export function ShoppingListsPage() {
  const query = useLists();
  const m = useListMutations();
  const toast = useToast();
  const [edit, setEdit] = useState<Edit>(null);
  const [name, setName] = useState("");

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading lists" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  if (query.isError) return <EmptyState title="Could not load your lists">Check your connection and try again.</EmptyState>;
  const lists = query.data;
  if (lists.length === 1 && !edit) return <Navigate to={`/shopping/${lists[0]!.id}`} replace />;

  const open = (e: Edit) => {
    setName(e && e.kind !== "new" ? e.list.name : "");
    setEdit(e);
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!edit || !name.trim()) return;
    const opts = { onSuccess: () => setEdit(null), onError: () => toast("Could not save the list", "danger") };
    if (edit.kind === "new") m.create.mutate(name.trim(), opts);
    if (edit.kind === "rename") m.rename.mutate({ id: edit.list.id, name: name.trim() }, opts);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Shopping</h1>
        <Button onClick={() => open({ kind: "new" })}>
          <Plus className="size-4" aria-hidden />
          New list
        </Button>
      </div>
      {lists.length === 0 ? (
        <EmptyState icon={<ShoppingCart className="size-10" />} title="No lists yet">
          Make a list, then add items or a whole recipe.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {lists.map((l) => (
            <li key={l.id}>
              <Card className="flex items-center gap-1 pr-2">
                <Link to={`/shopping/${l.id}`} className="flex min-h-16 flex-1 flex-col justify-center rounded-lg px-4 py-3">
                  <span className="text-lg font-semibold">{l.name}</span>
                  <span className="text-sm text-muted">
                    {l.total - l.checked} to buy · updated {ago(l.updatedAt)}
                  </span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton aria-label={`Actions for ${l.name}`}>
                      <Ellipsis className="size-5" aria-hidden />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => open({ kind: "rename", list: l })}>
                      <Pencil className="size-4" aria-hidden />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open({ kind: "delete", list: l })}>
                      <Trash2 className="size-4" aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={edit?.kind === "new" || edit?.kind === "rename"} onOpenChange={(o) => !o && setEdit(null)} title={edit?.kind === "rename" ? "Rename list" : "New list"}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={m.create.isPending || m.rename.isPending} disabled={!name.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={edit?.kind === "delete"}
        onOpenChange={(o) => !o && setEdit(null)}
        title="Delete this list?"
        description={edit?.kind === "delete" ? `${edit.list.name} and its items will be removed for everyone in your household.` : undefined}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEdit(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={m.remove.isPending}
            onClick={() => edit?.kind === "delete" && m.remove.mutate(edit.list.id, { onSuccess: () => setEdit(null), onError: () => toast("Could not delete the list", "danger") })}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
