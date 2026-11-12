import { LogOut, Search, Shield, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useFeaturesState } from "../features/features/FeaturesProvider";
import { useSession } from "../features/auth/useSession";
import { Brand, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, ToastProvider } from "../ui";
import { CommandPalette } from "./CommandPalette";
import { HeaderSearch } from "./HeaderSearch";
import { OfflineBanner } from "../pwa/Pwa";
import { clearOfflineCaches } from "../pwa/register";
import { useVisibleNav } from "./useVisibleNav";

export function AppShell() {
  const items = useVisibleNav();
  const { isLoading } = useFeaturesState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Publish the header's real height (including the top safe-area inset in its padding) so sticky page bars sit right under it.
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el, { box: "border-box" });
    return () => {
      ro.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);

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
      {/* The page scrolls inside this fixed-height column, not the document. iOS 26 WebKit drifts `position: fixed`
          bottom bars up the screen while the document scrolls, so the tab bar is a flex row at the end instead. */}
      <div className="flex h-dvh flex-col lg:pl-60 print:block print:h-auto print:pl-0">
        <aside className="fixed inset-y-0 left-0 print:!hidden hidden w-60 flex-col gap-6 border-r border-line bg-raised p-4 pt-[calc(1rem+var(--sat))] pb-[calc(1rem+var(--sab))] pl-[max(1rem,var(--sal))] lg:flex">
          <Brand className="px-3 text-xl" />
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

        <div data-scroll-root className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain print:overflow-visible">
        <header
          ref={headerRef}
          className="print:hidden sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 py-2 pt-[calc(0.5rem+var(--sat))] pl-[max(1rem,var(--sal))] pr-[max(1rem,var(--sar))] backdrop-blur lg:pl-4"
        >
          <Brand className="lg:invisible" />
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
                {user?.role === "admin" && (
                  <DropdownMenuItem onSelect={() => navigate("/admin")}>
                    <Shield className="size-4" aria-hidden />
                    Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    void signOut().then(() => clearOfflineCaches()).then(() => navigate("/signin", { replace: true }));
                  }}
                >
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <OfflineBanner />
        <main className="mx-auto max-w-7xl pl-[max(1rem,var(--sal))] pr-[max(1rem,var(--sar))] pb-24 pt-6 lg:pb-10 print:p-0" aria-busy={isLoading || undefined}>
          <Outlet />
        </main>
        </div>

        <nav aria-label="Tab bar" className="print:hidden z-30 shrink-0 border-t border-line bg-raised pb-(--sab) pl-(--sal) pr-(--sar) lg:hidden">
          <ul className="flex">
            {items.filter((i) => !i.desktopOnly).map(({ to, label, icon: Icon }) => (
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
