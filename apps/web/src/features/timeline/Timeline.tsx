import { Camera, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TimelineEvent } from "@meally/shared";
import { Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, Skeleton, useToast } from "../../ui";
import { Textarea } from "../../ui/Form";
import { relativeTime, useTimeline, useTimelineMutations } from "./api";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

function Composer({ slug }: { slug: string }) {
  const { post } = useTimelineMutations(slug);
  const toast = useToast();
  const [text, setText] = useState("");
  const [made, setMade] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const can = made || text.trim().length > 0;
  return (
    <form
      className="mb-6 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!can) return;
        post.mutate(
          { kind: made ? "made" : "comment", text: text.trim(), photo },
          {
            onSuccess: () => {
              setText("");
              setMade(false);
              setPhoto(null);
            },
            onError: (err) => toast(err.message, "danger"),
          },
        );
      }}
    >
      <Textarea aria-label="Add a note or comment" rows={2} maxLength={2000} placeholder="Add a note, tip or comment" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={made} onChange={(e) => setMade(e.target.checked)} />I made this
        </label>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
          <Camera className="size-5" aria-hidden />
          <span>{photo ? photo.name : "Add photo"}</span>
          <input type="file" accept="image/*" className="sr-only" aria-label="Photo" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <Button type="submit" className="ml-auto" disabled={!can} loading={post.isPending}>
          Post
        </Button>
      </div>
    </form>
  );
}

function EventItem({ ev, onPhoto }: { ev: TimelineEvent; onPhoto: (e: TimelineEvent) => void }) {
  const { edit, remove } = useTimelineMutations(ev.recipeSlug);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ev.text ?? "");
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex gap-3 py-3">
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-semibold">
        {initials(ev.userName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{ev.userName}</span>
          <span className="text-muted">{relativeTime(ev.createdAt)}</span>
          {ev.editedAt && <span className="text-muted">(edited)</span>}
          {ev.kind === "made" && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-contrast">Made it</span>}
          {ev.kind === "note" && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs">Note</span>}
        </p>
        {editing ? (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              edit.mutate({ id: ev.id, text: draft.trim() }, { onSuccess: () => setEditing(false) });
            }}
          >
            <Textarea aria-label="Edit text" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={edit.isPending}>
                Save
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          ev.text && <p className="mt-1 whitespace-pre-line break-words">{ev.text}</p>
        )}
        {ev.thumbUrl && (
          <button type="button" className="mt-2 block overflow-hidden rounded-md" onClick={() => onPhoto(ev)} aria-label="Open photo">
            <img src={ev.thumbUrl} alt="" loading="lazy" className="h-28 w-28 object-cover" />
          </button>
        )}
      </div>
      {(ev.canEdit || ev.canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="Entry actions">
              <Ellipsis className="size-5" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ev.canEdit && (
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </DropdownMenuItem>
            )}
            {ev.canDelete && (
              <DropdownMenuItem onSelect={() => setConfirm(true)}>
                <Trash2 className="size-4" aria-hidden />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title="Delete this entry?" description="It will be removed.">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(ev.id, { onSuccess: () => setConfirm(false) })}>
            Delete
          </Button>
        </div>
      </Dialog>
    </li>
  );
}

export function EventList({ slug, empty }: { slug: string; empty: string }) {
  const q = useTimeline(slug);
  const [photo, setPhoto] = useState<TimelineEvent | null>(null);
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError) return <EmptyState title="Could not load">Check your connection and try again.</EmptyState>;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      {items.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((ev) => (
            <EventItem key={ev.id} ev={ev} onPhoto={setPhoto} />
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
      <Dialog open={!!photo} onOpenChange={(o) => !o && setPhoto(null)} title="Photo" description={photo ? `Photo from ${photo.userName}` : undefined}>
        {photo?.imageUrl && <img src={photo.imageUrl} alt={`Photo from ${photo.userName}`} className="max-h-[70dvh] w-full rounded-md object-contain" />}
      </Dialog>
    </>
  );
}

export function Timeline({ slug }: { slug: string }) {
  return (
    <section aria-labelledby="timeline-h" className="mt-10 max-w-2xl">
      <h2 id="timeline-h" className="mb-3 text-xl font-semibold">
        Timeline
      </h2>
      <Composer slug={slug} />
      <EventList slug={slug} empty="Nothing yet. Log when you make this, or leave a note." />
    </section>
  );
}
