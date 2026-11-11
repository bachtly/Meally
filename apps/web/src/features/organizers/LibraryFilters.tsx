import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import type { OrganizerType } from "@meally/shared";
import { Button, cn, Sheet, Skeleton } from "../../ui";
import { ORGANIZER_LABELS, useOrganizers, type OrganizerItem } from "./api";

const TYPES: OrganizerType[] = ["categories", "tags", "tools"];

/** Active organiser filters from the URL: `?tag=a&tag=b&category=c&tool=d`. */
export function useOrganizerFilters() {
  const [params, setParams] = useSearchParams();
  const get = (t: OrganizerType) => params.getAll(ORGANIZER_LABELS[t].param);
  const filters: Record<OrganizerType, string[]> = { tags: get("tags"), categories: get("categories"), tools: get("tools") };
  const toggle = (t: OrganizerType, slug: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const key = ORGANIZER_LABELS[t].param;
        const cur = next.getAll(key);
        next.delete(key);
        for (const v of cur.includes(slug) ? cur.filter((x) => x !== slug) : [...cur, slug]) next.append(key, v);
        return next;
      },
      { replace: true },
    );
  const clear = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const t of TYPES) next.delete(ORGANIZER_LABELS[t].param);
        return next;
      },
      { replace: true },
    );
  const count = TYPES.reduce((n, t) => n + filters[t].length, 0);
  return { filters, toggle, clear, count };
}

function CheckList({ type, items, selected, onToggle }: { type: OrganizerType; items: OrganizerItem[]; selected: string[]; onToggle: (slug: string) => void }) {
  const { plural } = ORGANIZER_LABELS[type];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">{plural}</legend>
      {items.length === 0 && <p className="text-sm text-muted">None yet.</p>}
      {items.map((o) => (
        <label key={o.slug} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-sunken">
          <input type="checkbox" className="size-5 accent-[var(--accent,currentColor)]" checked={selected.includes(o.slug)} onChange={() => onToggle(o.slug)} />
          <span className="flex-1">{o.name}</span>
          <span className="text-sm text-muted" aria-label={`${o.count} recipes`}>
            {o.count}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Scrollable category chips, a Filters sheet for tags and tools, and removable active chips. */
export function LibraryFilters() {
  const { filters, toggle, clear, count } = useOrganizerFilters();
  const [open, setOpen] = useState(false);
  const cats = useOrganizers("categories");
  const tags = useOrganizers("tags");
  const tools = useOrganizers("tools");
  const lists: Record<OrganizerType, OrganizerItem[]> = { categories: cats.data ?? [], tags: tags.data ?? [], tools: tools.data ?? [] };
  const nameOf = (t: OrganizerType, slug: string) => lists[t].find((o) => o.slug === slug)?.name ?? slug;
  const sheetCount = filters.tags.length + filters.tools.length;

  if (cats.isPending && tags.isPending && tools.isPending) return <Skeleton className="mb-4 h-9" />;
  if (lists.categories.length + lists.tags.length + lists.tools.length === 0 && count === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter by category">
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters{sheetCount > 0 && ` (${sheetCount})`}
        </Button>
        {lists.categories.map((c) => {
          const on = filters.categories.includes(c.slug);
          return (
            <button
              key={c.slug}
              type="button"
              aria-pressed={on}
              onClick={() => toggle("categories", c.slug)}
              className={cn("min-h-9 shrink-0 rounded-full border px-3 text-sm pointer-coarse:min-h-11", on ? "border-accent bg-accent text-accent-contrast" : "border-line bg-raised hover:bg-sunken")}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      {count > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {TYPES.flatMap((t) =>
            filters[t].map((slug) => (
              <li key={`${t}-${slug}`}>
                <button
                  type="button"
                  aria-label={`Remove filter ${ORGANIZER_LABELS[t].singular}: ${nameOf(t, slug)}`}
                  onClick={() => toggle(t, slug)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-sunken pl-3 pr-2.5 text-sm hover:bg-line active:bg-line pointer-coarse:min-h-11"
                >
                  {nameOf(t, slug)}
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            )),
          )}
          <li>
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear all
            </Button>
          </li>
        </ul>
      )}
      <Sheet open={open} onOpenChange={setOpen} title="Filters" description="Show recipes with any chosen tag or tool. Different groups combine.">
        <div className="flex flex-col gap-4">
          <CheckList type="tags" items={lists.tags} selected={filters.tags} onToggle={(s) => toggle("tags", s)} />
          <CheckList type="tools" items={lists.tools} selected={filters.tools} onToggle={(s) => toggle("tools", s)} />
          <div className="flex justify-end gap-2">
            {count > 0 && (
              <Button variant="secondary" onClick={clear}>
                Clear all
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
