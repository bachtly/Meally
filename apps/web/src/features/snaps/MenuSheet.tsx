import { LogOut, Settings, Shield, Users, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Sheet } from "../../ui";
import { useVisibleNav } from "../../app/useVisibleNav";
import { clearOfflineCaches } from "../../pwa/register";
import { useSession } from "../auth/useSession";
import { useFeature } from "../features/FeaturesProvider";
import { forgetPushOnThisDevice } from "../push/push";

interface Tile {
  to: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Everything that is not the Snap loop: Recipes, Plan, Shopping and the rest, opened from your avatar on the camera.
 * It keeps the camera screen down to three controls.
 */
export function MenuSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const friends = useFeature("friends");
  const all: Tile[] = [
    ...useVisibleNav().filter((i) => i.to !== "/more" && i.to !== "/"),
    ...(friends ? [{ to: "/friends", label: "Friends", icon: Users }] : []),
    { to: "/settings", label: "Settings", icon: Settings },
    ...(user?.role === "admin" ? [{ to: "/admin", label: "Admin", icon: Shield }] : []),
  ];
  // The nav list may already carry some of these (Friends is a desktop sidebar item): show each once.
  const tiles = all.filter((t, i) => all.findIndex((u) => u.to === t.to) === i);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={user?.name ?? "Menu"} description={user?.email}>
      <nav aria-label="App" className="grid grid-cols-3 gap-2.5">
        {tiles.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface text-sm font-semibold hover:bg-sunken"
          >
            <Icon className="size-6 text-accent" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md font-semibold text-muted hover:text-ink"
        onClick={() => void forgetPushOnThisDevice().then(() => signOut()).then(() => clearOfflineCaches()).then(() => navigate("/signin", { replace: true }))}
      >
        <LogOut className="size-4" aria-hidden />
        Sign out
      </button>
    </Sheet>
  );
}
