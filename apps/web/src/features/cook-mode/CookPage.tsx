import { ArrowLeft, ArrowRight, Check, ListChecks, Timer, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatClock, parseDurations } from "@meally/shared";
import { Button, EmptyState, IconButton, Sheet, Skeleton, useToast } from "../../ui";
import { useFeature } from "../features/FeaturesProvider";
import { useRecipe } from "../recipes/api";
import { useChecks } from "../recipes/useChecks";
import { ingredientsForStep, scaledIngredients } from "./helpers";
import { alarm, useTimers } from "./useTimers";
import { useWakeLock } from "./useWakeLock";

/** Step text with each detected duration turned into a tappable chip. */
function StepText({ text, onTimer }: { text: string; onTimer: (label: string, seconds: number) => void }) {
  const out: ReactNode[] = [];
  let at = 0;
  parseDurations(text).forEach((d, i) => {
    out.push(text.slice(at, d.start));
    out.push(
      <button
        key={i}
        type="button"
        onClick={() => onTimer(d.text, d.seconds)}
        aria-label={`Start ${d.text} timer`}
        className="mx-0.5 inline-flex min-h-11 items-center gap-1 rounded-full bg-sunken px-3 align-middle text-[0.9em] font-medium text-accent underline-offset-2 hover:underline"
      >
        <Timer className="size-4" aria-hidden />
        {d.text}
      </button>,
    );
    at = d.end;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

export function CookPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const query = useRecipe(slug);
  const toast = useToast();
  const scalingOn = useFeature("scaling");
  const { checks, toggle } = useChecks(slug);
  const [i, setI] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const wake = useWakeLock();
  const { timers, now, start, cancel } = useTimers(slug, (t) => {
    alarm();
    toast(`Timer done: ${t.label}`, "success");
  });
  const touch = useRef<{ x: number; y: number } | null>(null);
  const back = `/recipes/${slug}${params.toString() ? `?${params}` : ""}`;
  const total = query.data?.steps.length ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input,[role=dialog]")) return;
      if (e.key === " " && el?.closest("button,a")) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setI((n) => Math.min(n + 1, total));
      } else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading recipe" className="p-6">
        <Skeleton className="h-8 w-1/2" />
      </div>
    );
  }
  if (query.isError || total === 0) {
    return (
      <EmptyState
        title={query.isError ? "Could not load this recipe" : "No steps to cook"}
        action={
          <Link to={back} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-medium text-accent-contrast">
            Back to recipe
          </Link>
        }
      >
        {query.isError ? "Check your connection and try again." : "Add steps to this recipe first."}
      </EmptyState>
    );
  }

  const r = query.data;
  const shown = scaledIngredients(r, params, scalingOn);
  const finished = i >= total;
  const step = r.steps[i];
  const heading = step?.section && step.section !== r.steps[i - 1]?.section ? step.section : null;
  const related = step ? ingredientsForStep(step.text, r.ingredients) : [];
  const pct = Math.round((Math.min(i + 1, total) / total) * 100);

  return (
    <div
      className="flex min-h-dvh flex-col bg-surface text-ink"
      onTouchStart={(e) => (touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const dx = e.changedTouches[0]!.clientX - s.x;
        const dy = e.changedTouches[0]!.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setI((n) => (dx < 0 ? Math.min(n + 1, total) : Math.max(n - 1, 0)));
      }}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Link to={back} aria-label="Exit cook mode" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-sunken">
          <X className="size-6" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{r.name}</p>
          <p className="text-xs text-muted">
            {wake === "on" ? "Screen stays on" : wake === "unsupported" ? "Keep your screen on manually" : " "}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setDrawer(true)}>
          <ListChecks className="size-4" aria-hidden />
          Ingredients
        </Button>
      </header>
      <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(i + 1, total)} className="h-1.5 bg-sunken">
        <div className="h-full bg-accent transition-all" style={{ width: `${finished ? 100 : pct}%` }} />
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-5 py-6">
        {finished ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <Check className="size-12 text-success" aria-hidden />
            <h1 className="text-3xl font-semibold">All done</h1>
            <p className="text-muted">Enjoy your {r.name.toLowerCase()}.</p>
            <Link to={back} className="inline-flex min-h-12 items-center rounded-md bg-accent px-6 text-lg font-medium text-accent-contrast">
              Done
            </Link>
          </div>
        ) : (
          <>
            {heading && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{heading}</h2>}
            <p className="text-sm text-muted" aria-live="polite">
              Step {i + 1} of {total}
            </p>
            <p className="leading-relaxed" style={{ fontSize: "clamp(1.5rem, 1.1rem + 1.6vw, 2.25rem)" }}>
              <StepText text={step!.text} onTimer={start} />
            </p>
            {related.length > 0 && (
              <ul aria-label="Ingredients for this step" className="flex flex-wrap gap-2">
                {related.map((n) => (
                  <li key={n} className="rounded-full border border-line bg-raised px-3 py-1 text-sm">
                    {shown[n]!.raw}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {timers.length > 0 && (
        <ul aria-label="Running timers" className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-4 pb-2">
          {timers.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-full border border-line bg-raised py-1 pl-3 pr-1 text-sm">
              <Timer className="size-4 text-accent" aria-hidden />
              <span>{t.label}</span>
              <span className="font-mono font-semibold tabular-nums">{formatClock((t.endsAt - now) / 1000)}</span>
              <IconButton aria-label={`Cancel ${t.label} timer`} onClick={() => cancel(t.id)}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Steps" className="grid grid-cols-2 gap-3 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="secondary" className="min-h-16 text-lg" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ArrowLeft className="size-5" aria-hidden />
          Previous
        </Button>
        <Button className="min-h-16 text-lg" disabled={finished} onClick={() => setI(i + 1)}>
          {i === total - 1 ? "Finish" : "Next"}
          <ArrowRight className="size-5" aria-hidden />
        </Button>
      </nav>

      <Sheet open={drawer} onOpenChange={setDrawer} title="Ingredients">
        <ul className="flex flex-col">
          {r.ingredients.map((ing, n) => (
            <li key={n}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={checks.ingredients.includes(n)} onChange={() => toggle("ingredients", n)} />
                <span className={checks.ingredients.includes(n) ? "text-muted line-through" : undefined}>{shown[n]!.raw}</span>
              </label>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
