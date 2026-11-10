import { Link } from "react-router";
import type { ReactNode } from "react";
import { Feature } from "../features/Feature";
import { useSession } from "../auth/useSession";
import { ThemeToggle } from "../../ui";
import { ExportBackupsSection } from "../backups/ExportBackupsSection";
import { HouseholdSection } from "./HouseholdSection";
import { TokensSection } from "../tokens/TokensSection";
import { WebhooksSection } from "../webhooks/WebhooksSection";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`s-${title}`}>
      <h2 id={`s-${title}`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { user } = useSession();
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Section title="Profile">
        <p className="text-muted">
          {user?.name} · {user?.email}
        </p>
        <p className="text-sm text-muted">Profile editing is coming soon.</p>
      </Section>
      <Feature on="households">
        <Section title="Household">
          <HouseholdSection />
        </Section>
      </Feature>
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
      <Feature on="backups">
        <Section title="Export & backups">
          <ExportBackupsSection />
        </Section>
      </Feature>
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
