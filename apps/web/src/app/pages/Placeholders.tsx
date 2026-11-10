import { useSession } from "../../features/auth/useSession";
import { Link } from "react-router";
import { HealthPage } from "../../features/health/HealthPage";
import { InstallItem } from "../../pwa/Pwa";
import { Feature } from "../../features/features/Feature";
import { ThemeToggle } from "../../ui";

export function MorePage() {
  const { user } = useSession();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">More</h1>
      <Link to="/settings" className="text-accent underline">
        Settings
      </Link>
      {user?.role === "admin" && (
        <Link to="/admin" className="text-accent underline">
          Admin
        </Link>
      )}
      <Feature on="cookbooks">
        <Link to="/cookbooks" className="text-accent underline">
          Cookbooks
        </Link>
      </Feature>
      <Feature on="timeline">
        <Link to="/activity" className="text-accent underline">
          Activity
        </Link>
      </Feature>
      <Feature on="organizers">
        <Link to="/organizers" className="text-accent underline">
          Tags, categories and tools
        </Link>
      </Feature>
      <InstallItem />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <ThemeToggle />
      </section>
      {import.meta.env.DEV && (
        <Link to="/ui" className="text-accent underline">
          Component gallery
        </Link>
      )}
      <HealthPage />
    </div>
  );
}
