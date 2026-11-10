import { LogOut, Search, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useFeaturesState } from "../features/features/FeaturesProvider";
import { useSession } from "../features/auth/useSession";
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, ToastProvider } from "../ui";
import { CommandPalette } from "./CommandPalette";
import { HeaderSearch } from "./HeaderSearch";
import { useVisibleNav } from "./useVisibleNav";

export function AppShell() {
  const items = useVisibleNav();
  const { isLoading } = useFeaturesState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K focuses the search field on desktop and opens the palette on small screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) return;
      e.preventDefault();
      if (searchRef.current && searchRef.current.offsetParent !== null) searchRef.current.focus();
      else setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <HeaderSearch ref={searchRef} />
          <div className="flex items-center gap-1">
            <IconButton aria-label="Search and commands" className="lg:hidden" onClick={() => setPaletteOpen(true)}>
              <Search className="size-5" aria-hidden />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Account menu">
                  <User className="size-5" aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-3 py-2">
                  <p className="font-medium">{user?.name}</p>
                  <p className="text-sm text-muted">{user?.email}</p>
                </div>
                <DropdownMenuItem
                  onSelect={() => {
                    void signOut().then(() => navigate("/signin", { replace: true }));
                  }}
                >
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 lg:pb-10" aria-busy={isLoading || undefined}>
          <Outlet />
        </main>

        <nav aria-label="Tab bar" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] lg:hidden">
          <ul className="flex">
            {items.filter((i) => !i.desktopOnly).map(({ to, label, icon: Icon }) => (
              <li key={to} className="flex-1">
                <NavLink
                  to={to}
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
