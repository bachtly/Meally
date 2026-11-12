import { Link } from "react-router";
import type { ReactNode } from "react";
import { Feature } from "../features/Feature";
import { useFeature } from "../features/FeaturesProvider";
import { useSession } from "../auth/useSession";
import { ThemeToggle } from "../../ui";
import { ExportBackupsSection } from "../backups/ExportBackupsSection";
import { TokensSection } from "../tokens/TokensSection";
import { WebhooksSection } from "../webhooks/WebhooksSection";
import { SharedLinksSection } from "../share/SharedLinksSection";

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3" aria-labelledby={`s-${title}`}>
      <h2 id={`s-${title}`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { user } = useSession();
  const backups = useFeature("backups");
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Section title="Profile">
        <p className="text-muted">
          {user?.name} · {user?.email}
        </p>
        <p className="text-sm text-muted">Profile editing is coming soon.</p>
      </Section>
      <Feature on="organizers">
        <Section title="Organisers">
          <Link to="/organizers" className="text-accent underline">
            Manage tags, categories and tools
          </Link>
        </Section>
      </Feature>
      <Feature on="foods-units">
        <Section title="Foods and units">
          <Link to="/foods" className="text-accent underline">
            Manage foods, aliases and units
          </Link>
        </Section>
      </Feature>
      <Feature on="import-files">
        <Section title="Import recipes">
          <Link to="/settings/import" className="text-accent underline">
            Import from Paprika, Mealie, RecipeSage and more
          </Link>
        </Section>
      </Feature>
      <Feature on="share-links">
        <Section title="Shared links" id="shared-links">
          <SharedLinksSection />
        </Section>
      </Feature>
      {/* Export is core. Only instance backups are flagged (off on Postgres/Supabase). */}
      <Section title={backups ? "Export & backups" : "Export"}>
        <ExportBackupsSection />
      </Section>
      <Feature on="api-tokens">
        <Section title="API tokens">
          <TokensSection />
        </Section>
      </Feature>
      <Feature on="webhooks">
        <Section title="Webhooks">
          <WebhooksSection />
        </Section>
      </Feature>
      <Section title="Appearance">
        <ThemeToggle />
      </Section>
    </div>
  );
}
