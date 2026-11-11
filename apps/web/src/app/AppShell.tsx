import { Search } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useFeaturesState } from "../features/features/FeaturesProvider";
import { cn, IconButton, ToastProvider } from "../ui";
import { CommandPalette } from "./CommandPalette";
import { useVisibleNav } from "./useVisibleNav";

export function AppShell() {
  const items = useVisibleNav();
  const { isLoading } = useFeaturesState();
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="min-h-dvh lg:pl-60">
        <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r border-line bg-raised p-4 lg:flex">
          <div className="px-3 text-xl font-semibold text-accent">Meally</div>
          <nav aria-label="Sidebar" className="flex flex-col gap-1">
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 text-base",
                    isActive ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink",
                  )
                }
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2 backdrop-blur">
          <span className="text-lg font-semibold text-accent lg:invisible">Meally</span>
          <IconButton aria-label="Search and commands" onClick={() => setPaletteOpen(true)}>
            <Search className="size-5" aria-hidden />
          </IconButton>
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 lg:pb-10" aria-busy={isLoading || undefined}>
          <Outlet />
        </main>

        <nav aria-label="Tab bar" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] lg:hidden">
          <ul className="flex">
            {items.map(({ to, label, icon: Icon }) => (
              <li key={to} className="flex-1">
                <NavLink
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs",
                      isActive ? "font-medium text-accent" : "text-muted",
                    )
                  }
                >
                  <Icon className="size-6" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </ToastProvider>
  );
}
