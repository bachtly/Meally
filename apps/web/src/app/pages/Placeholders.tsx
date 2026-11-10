import { CalendarDays } from "lucide-react";
import { Link } from "react-router";
import { HealthPage } from "../../features/health/HealthPage";
import { EmptyState, ThemeToggle } from "../../ui";

export function PlanPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Plan</h1>
      <EmptyState icon={<CalendarDays className="size-10" />} title="Nothing planned">
        Your week will show up here.
      </EmptyState>
    </>
  );
}

export function MorePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">More</h1>
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
