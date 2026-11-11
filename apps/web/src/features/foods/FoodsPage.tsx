import { Check, Ellipsis, Merge, Pencil, Plus, Trash2, Wheat, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Food, UnitItem } from "@meally/shared";
import { ApiRequestError } from "../../lib/api";
import {
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "../../ui";
import { useFeature } from "../features/FeaturesProvider";
import { useAisles } from "../shopping/api";
import { useFoodMutations, useFoods, useUnitMutations, useUnits, type UnitDraft } from "./api";

const msg = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Something went wrong");
const select = "min-h-11 rounded-md border border-line bg-raised px-3 text-base font-normal";
const recipes = (n: number) => (n === 1 ? "1 recipe" : `${n} recipes`);

function Aliases({ food }: { food: Food }) {
  const { update } = useFoodMutations();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const save = (aliases: string[]) => update.mutate({ id: food.id, aliases }, { onError: (e) => toast(msg(e), "danger") });
  const add = (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    setDraft("");
    save([...food.aliases, v]);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      {food.aliases.map((a) => (
        <Badge key={a} className="gap-1">
          {a}
          <button type="button" aria-label={`Remove alias ${a} from ${food.name}`} className="relative grid size-5 place-items-center rounded-full after:absolute after:-inset-3 after:content-['']" onClick={() => save(food.aliases.filter((x) => x !== a))}>
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      <form onSubmit={add} className="min-w-40 flex-1 sm:max-w-60">
        <Input aria-label={`Add alias for ${food.name}`} placeholder="Add alias" value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} autoComplete="off" enterKeyHint="done" />
      </form>
    </div>
  );
}

function FoodRow({ food, others, shopping }: { food: Food; others: Food[]; shopping: boolean }) {
  const m = useFoodMutations();
  const aisles = useAisles();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(food.name);
  const [dialog, setDialog] = useState<"delete" | "merge" | null>(null);
  const [into, setInto] = useState("");
  const fail = (e: unknown) => toast(msg(e), "danger");

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === food.name) return setEditing(false);
    m.update.mutate({ id: food.id, name }, { onSuccess: () => setEditing(false), onError: fail });
  };

  return (
    <li className="flex flex-col gap-2 border-b border-line py-3">
      <div className="flex items-center gap-2">
        {editing ? (
          <form className="flex flex-1 items-center gap-2" onSubmit={rename}>
            <Input autoFocus aria-label={`New name for ${food.name}`} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
            <IconButton aria-label="Save name" type="submit" loading={m.update.isPending}>
              <Check className="size-5" aria-hidden />
            </IconButton>
            <IconButton aria-label="Cancel rename" onClick={() => setEditing(false)}>
              <X className="size-5" aria-hidden />
            </IconButton>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate font-medium">{food.name}</span>
            <span className="text-sm text-muted">{recipes(food.count)}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={`Actions for ${food.name}`}>
                  <Ellipsis className="size-5" aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setName(food.name);
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-4" aria-hidden />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={others.length === 0}
                  onSelect={() => {
                    setInto(others[0]?.id ?? "");
                    setDialog("merge");
                  }}
                >
                  <Merge className="size-4" aria-hidden />
                  Merge into...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("delete")}>
                  <Trash2 className="size-4" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      <Aliases food={food} />
      {shopping && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Aisle
          <select
            aria-label={`Aisle for ${food.name}`}
            className={select}
            value={food.aisleId ?? ""}
            onChange={(e) => m.update.mutate({ id: food.id, aisleId: e.target.value || null }, { onError: fail })}
          >
            <option value="">None</option>
            {(aisles.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete "${food.name}"?`}
        description={food.count > 0 ? `${recipes(food.count)} use it. The ingredients stay but are no longer linked to this food.` : "Nothing uses it."}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={m.remove.isPending} onClick={() => m.remove.mutate({ id: food.id, force: food.count > 0 }, { onSuccess: () => setDialog(null), onError: fail })}>
            Delete
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "merge"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Merge "${food.name}"`}
        description={`Recipes use the food you pick instead. "${food.name}" becomes one of its aliases.`}
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Merge into
            <select value={into} onChange={(e) => setInto(e.target.value)} className={select}>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button loading={m.merge.isPending} disabled={!into} onClick={() => m.merge.mutate({ id: food.id, into }, { onSuccess: () => setDialog(null), onError: fail })}>
              Merge
            </Button>
          </div>
        </div>
      </Dialog>
    </li>
  );
}

function FoodsTab() {
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const foods = useFoods(q);
  const all = useFoods("");
  const m = useFoodMutations();
  const toast = useToast();
  const shopping = useFeature("shopping-lists");
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    m.create.mutate(newName, { onSuccess: () => setNewName(""), onError: (err) => toast(msg(err), "danger") });
  };
  return (
    <div className="flex flex-col gap-4">
      <Input type="search" aria-label="Search foods" placeholder="Search foods and aliases" value={q} onChange={(e) => setQ(e.target.value)} />
      <form onSubmit={add} className="flex gap-2">
        <Input aria-label="New food" placeholder="New food" value={newName} maxLength={100} autoComplete="off" enterKeyHint="done" onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" loading={m.create.isPending}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>
      {foods.isPending ? (
        <Skeleton aria-label="Loading foods" className="h-40" />
      ) : foods.isError ? (
        <EmptyState title="Could not load foods" action={<Button onClick={() => void foods.refetch()}>Try again</Button>}>
          Check your connection and try again.
        </EmptyState>
      ) : foods.data.length === 0 ? (
        <EmptyState icon={<Wheat className="size-10" />} title={q ? "No matching foods" : "No foods yet"}>
          Foods appear here when you save a recipe with ingredients.
        </EmptyState>
      ) : (
        <ul aria-label="Foods">
          {foods.data.map((f) => (
            <FoodRow key={f.id} food={f} shopping={shopping} others={(all.data ?? foods.data).filter((o) => o.id !== f.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function UnitForm({ initial, onDone }: { initial?: UnitItem; onDone: () => void }) {
  const m = useUnitMutations();
  const toast = useToast();
  const [d, setD] = useState({
    name: initial?.name ?? "",
    plural: initial?.plural ?? "",
    abbreviation: initial?.abbreviation ?? "",
    kind: initial?.kind ?? "count",
    factor: initial?.factor != null ? String(initial.factor) : "",
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const draft: UnitDraft = {
      name: d.name,
      plural: d.plural || null,
      abbreviation: d.abbreviation || null,
      kind: d.kind,
      factor: d.kind !== "count" && d.factor ? Number(d.factor) : null,
    };
    const opts = { onSuccess: onDone, onError: (err: unknown) => toast(msg(err), "danger") };
    if (initial?.id) m.update.mutate({ ...draft, id: initial.id }, opts);
    else m.create.mutate(draft, opts);
  };
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Name
        <Input value={d.name} maxLength={40} onChange={set("name")} required />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Plural
        <Input value={d.plural} maxLength={40} onChange={set("plural")} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Abbreviation
        <Input value={d.abbreviation} maxLength={20} onChange={set("abbreviation")} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Kind
        <select value={d.kind} onChange={set("kind")} className={select}>
          <option value="count">Count</option>
          <option value="volume">Volume</option>
          <option value="mass">Mass</option>
        </select>
      </label>
      {d.kind !== "count" && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {d.kind === "volume" ? "Millilitres in one" : "Grams in one"}
          <Input type="number" inputMode="decimal" min="0" step="any" value={d.factor} onChange={set("factor")} />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={m.create.isPending || m.update.isPending}>
          Save unit
        </Button>
      </div>
    </form>
  );
}

function UnitsTab() {
  const units = useUnits();
  const m = useUnitMutations();
  const toast = useToast();
  const [form, setForm] = useState<UnitItem | "new" | null>(null);
  if (units.isPending) return <Skeleton aria-label="Loading units" className="h-40" />;
  if (units.isError)
    return (
      <EmptyState title="Could not load units" action={<Button onClick={() => void units.refetch()}>Try again</Button>}>
        Check your connection and try again.
      </EmptyState>
    );
  const custom = units.data.filter((u) => !u.builtIn);
  const builtIn = units.data.filter((u) => u.builtIn);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your units</h2>
          <Button onClick={() => setForm("new")}>
            <Plus className="size-4" aria-hidden />
            New unit
          </Button>
        </div>
        {custom.length === 0 ? (
          <p className="text-sm text-muted">No custom units yet. Add one such as "scoop" or "handful".</p>
        ) : (
          <ul aria-label="Custom units">
            {custom.map((u) => (
              <li key={u.key} className="flex items-center gap-2 border-b border-line py-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {u.name}
                  {u.abbreviation ? <span className="text-muted"> ({u.abbreviation})</span> : null}
                </span>
                <span className="text-sm text-muted">{recipes(u.count)}</span>
                <IconButton aria-label={`Edit ${u.name}`} onClick={() => setForm(u)}>
                  <Pencil className="size-5" aria-hidden />
                </IconButton>
                <IconButton
                  aria-label={`Delete ${u.name}`}
                  onClick={() => m.remove.mutate({ id: u.id!, force: u.count > 0 }, { onError: (e) => toast(msg(e), "danger") })}
                >
                  <Trash2 className="size-5" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Built-in units</h2>
        <ul aria-label="Built-in units">
          {builtIn.map((u) => (
            <li key={u.key} className="flex items-center gap-2 border-b border-line py-2">
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <Badge>Built-in</Badge>
            </li>
          ))}
        </ul>
      </section>
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)} title={form === "new" ? "New unit" : "Edit unit"}>
        {form !== null && <UnitForm initial={form === "new" ? undefined : form} onDone={() => setForm(null)} />}
      </Dialog>
    </div>
  );
}

export function FoodsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Foods and units</h1>
      <Tabs defaultValue="foods">
        <TabsList>
          <TabsTrigger value="foods">Foods</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
        </TabsList>
        <TabsContent value="foods" className="mt-4">
          <FoodsTab />
        </TabsContent>
        <TabsContent value="units" className="mt-4">
          <UnitsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
