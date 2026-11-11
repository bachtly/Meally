import { Command } from "cmdk";
import { useNavigate } from "react-router";
import { useVisibleNav } from "./useVisibleNav";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const items = useVisibleNav();
  const navigate = useNavigate();
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
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
      </Command.List>
    </Command.Dialog>
  );
}
