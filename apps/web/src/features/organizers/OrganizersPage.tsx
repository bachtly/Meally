import { Check, Ellipsis, Merge, Pencil, Tags, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { OrganizerType } from "@meally/shared";
import { ApiRequestError } from "../../lib/api";
import {
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
import { ORGANIZER_LABELS, useOrganizerMutations, useOrganizers, type OrganizerItem } from "./api";

const TYPES: OrganizerType[] = ["tags", "categories", "tools"];
const msg = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Something went wrong");

function Row({ type, item, others }: { type: OrganizerType; item: OrganizerItem; others: OrganizerItem[] }) {
  const { singular, param } = ORGANIZER_LABELS[type];
  const m = useOrganizerMutations(type);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<"delete" | "merge" | null>(null);
  const [into, setInto] = useState("");

  const save = () => {
    if (!name.trim() || name.trim() === item.name) return setEditing(false);
    m.rename.mutate(
      { slug: item.slug, name },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => setError(msg(e)),
      },
    );
  };

  return (
    <li className="flex min-h-14 flex-col justify-center gap-1 border-b border-line py-2">
      <div className="flex items-center gap-2">
        {editing ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Input
              autoFocus
              aria-label={`New name for ${item.name}`}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
            <IconButton aria-label="Save name" type="submit" loading={m.rename.isPending}>
              <Check className="size-5" aria-hidden />
            </IconButton>
            <IconButton aria-label="Cancel rename" onClick={() => setEditing(false)}>
              <X className="size-5" aria-hidden />
            </IconButton>
          </form>
        ) : (
          <>
            <Link to={`/recipes?${param}=${encodeURIComponent(item.slug)}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {item.name}
            </Link>
            <span className="text-sm text-muted">{item.count === 1 ? "1 recipe" : `${item.count} recipes`}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={`Actions for ${item.name}`}>
                  <Ellipsis className="size-5" aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setName(item.name);
                    setError(undefined);
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-4" aria-hidden />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={others.length === 0}
                  onSelect={() => {
                    setInto(others[0]?.slug ?? "");
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
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${singular} "${item.name}"?`}
        description="It is removed from every recipe that uses it. The recipes stay."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={m.remove.isPending}
            onClick={() =>
              m.remove.mutate(item.slug, {
                onSuccess: () => setDialog(null),
                onError: (e) => toast(msg(e), "danger"),
              })
            }
          >
            Delete
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "merge"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Merge "${item.name}"`}
        description={`Recipes using it will use the ${singular} you pick instead, and "${item.name}" is deleted.`}
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Merge into
            <select value={into} onChange={(e) => setInto(e.target.value)} className="min-h-11 rounded-md border border-line bg-raised px-3 text-base font-normal">
              {others.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={m.merge.isPending}
              disabled={!into}
              onClick={() =>
                m.merge.mutate(
                  { slug: item.slug, into },
                  { onSuccess: () => setDialog(null), onError: (e) => toast(msg(e), "danger") },
                )
              }
            >
              Merge
            </Button>
          </div>
        </div>
      </Dialog>
    </li>
  );
}

function TypeList({ type }: { type: OrganizerType }) {
  const q = useOrganizers(type);
  const { plural, singular } = ORGANIZER_LABELS[type];
  if (q.isPending) return <Skeleton aria-label={`Loading ${plural}`} className="h-40" />;
  if (q.isError)
    return (
      <EmptyState title={`Could not load ${plural.toLowerCase()}`} action={<Button onClick={() => void q.refetch()}>Try again</Button>}>
        Check your connection and try again.
      </EmptyState>
    );
  if (q.data.length === 0)
    return (
      <EmptyState icon={<Tags className="size-10" />} title={`No ${plural.toLowerCase()} yet`}>
        Add a {singular} to a recipe in the editor and it will show up here.
      </EmptyState>
    );
  return (
    <ul aria-label={plural}>
      {q.data.map((item) => (
        <Row key={item.slug} type={type} item={item} others={q.data.filter((o) => o.slug !== item.slug)} />
      ))}
    </ul>
  );
}

export function OrganizersPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tags, categories and tools</h1>
      <Tabs defaultValue="tags">
        <TabsList>
          {TYPES.map((t) => (
            <TabsTrigger key={t} value={t}>
              {ORGANIZER_LABELS[t].plural}
            </TabsTrigger>
          ))}
        </TabsList>
        {TYPES.map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            <TypeList type={t} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
