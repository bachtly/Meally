import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useFeature } from "../features/features/FeaturesProvider";
import { useRecipes } from "../features/recipes/api";
import { useVisibleNav } from "./useVisibleNav";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const items = useVisibleNav();
  const navigate = useNavigate();
  const canImport = useFeature("import-url");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const recipes = useRecipes({ q: debounced, limit: 8, enabled: open && debounced.length > 0 });
  const found = debounced ? (recipes.data?.pages[0]?.items ?? []) : [];
  return (
    <Command.Dialog
      open={open}
      label="Command palette"
      onOpenChange={(o) => {
        if (!o) setSearch("");
        onOpenChange(o);
      }}
      overlayClassName="fixed inset-0 z-40 bg-black/50"
      contentClassName="fixed left-1/2 top-24 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-raised text-ink shadow-md"
    >
      <Command.Input placeholder="Go to…" className="min-h-12 w-full border-b border-line bg-transparent px-4 text-base outline-none" />
      <Command.List className="max-h-72 overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-center text-muted">Nothing found.</Command.Empty>
        <Command.Group heading="Go to" className="text-sm text-muted">
          {items.map(({ to, label, icon: Icon }) => (
            <Command.Item
              key={to}
              value={label}
              onSelect={() => {
                navigate(to);
                onOpenChange(false);
              }}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 text-base text-ink data-[selected=true]:bg-sunken"
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Command.Item>
          ))}
        </Command.Group>
        {canImport && (
          <Command.Group heading="Actions" className="text-sm text-muted">
            <Command.Item
              value="Import from URL"
              onSelect={() => {
                navigate("/recipes/import");
                onOpenChange(false);
              }}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 text-base text-ink data-[selected=true]:bg-sunken"
            >
              Import from URL
            </Command.Item>
          </Command.Group>
        )}
        {found.length > 0 && (
          <Command.Group heading="Recipes" className="text-sm text-muted">
            {found.map((r) => (
              <Command.Item
                key={r.id}
                value={`${r.name} ${search}`}
                onSelect={() => {
                  navigate(`/recipes/${r.slug}`);
                  onOpenChange(false);
                }}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 text-base text-ink data-[selected=true]:bg-sunken"
              >
                {r.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
