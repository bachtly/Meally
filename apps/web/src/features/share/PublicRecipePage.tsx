import { Clock, Printer, Users } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { adjustIngredient } from "@meally/shared";
import { Button, EmptyState, Skeleton } from "../../ui";
import { ServingsStepper } from "../recipes/ScalingControls";
import { formatMinutes, hostname, imageSrcSet } from "../recipes/format";
import { usePublicRecipe } from "./api";

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Standalone, read-only recipe at /s/:token. No session, no app shell. */
export function PublicRecipePage() {
  const { token = "" } = useParams();
  const query = usePublicRecipe(token);
  const [wanted, setWanted] = useState<number | null>(null);

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <div aria-busy="true" aria-label="Loading recipe" className="flex flex-col gap-4">
        <Skeleton className="aspect-[16/9] w-full" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    );
  } else if (query.isError) {
    body = <EmptyState title="This link no longer works">It may have expired or been turned off. Ask the person who sent it for a new one.</EmptyState>;
  } else {
    const r = query.data;
    const host = hostname(r.sourceUrl);
    const original = r.servings;
    const servings = r.scaling && original != null ? (wanted ?? original) : original;
    const factor = original != null && servings != null ? servings / original : 1;
    const shown = r.ingredients.map((i) => (r.scaling ? adjustIngredient(i, factor, "original") : i));
    body = (
      <article>
        {r.imageUrl && (
          <img
            src={r.imageUrl}
            srcSet={imageSrcSet(r.imageUrl, [800, 1600])}
            sizes="(min-width: 768px) 48rem, 100vw"
            alt=""
            className="mb-4 aspect-[16/9] max-h-96 w-full rounded-lg object-cover"
          />
        )}
        <header className="mb-6">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold leading-tight">{r.name}</h1>
            <Button variant="ghost" className="print:hidden" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              Print
            </Button>
          </div>
          {r.description && <p className="mt-2 max-w-prose text-lg text-muted">{r.description}</p>}
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {r.prepMinutes != null && <Meta label="Prep">{formatMinutes(r.prepMinutes)}</Meta>}
            {r.cookMinutes != null && <Meta label="Cook">{formatMinutes(r.cookMinutes)}</Meta>}
            {r.totalMinutes != null && (
              <Meta label="Total">
                <Clock className="mr-1 inline size-4" aria-hidden />
                {formatMinutes(r.totalMinutes)}
              </Meta>
            )}
            {(r.servings != null || r.yieldText) && (
              <Meta label="Servings">
                <Users className="mr-1 inline size-4" aria-hidden />
                {r.yieldText ?? r.servings}
              </Meta>
            )}
            {r.sourceUrl && host && (
              <Meta label="Source">
                <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
                  {host}
                </a>
              </Meta>
            )}
          </dl>
          {r.scaling && original != null && servings != null && (
            <div className="mt-4 print:hidden">
              <ServingsStepper value={servings} original={original} onChange={(n) => setWanted(n === original ? null : n)} />
            </div>
          )}
        </header>
        <div className="grid gap-8 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <section aria-labelledby="ingredients-h">
            <h2 id="ingredients-h" className="mb-3 text-xl font-semibold">
              Ingredients
            </h2>
            {r.ingredients.length === 0 ? (
              <p className="text-muted">No ingredients listed.</p>
            ) : (
              <ul className="flex flex-col">
                {r.ingredients.map((ing, i) => (
                  <Fragment key={i}>
                    {ing.section && ing.section !== r.ingredients[i - 1]?.section && (
                      <li className="mb-1 mt-4 text-sm font-semibold uppercase tracking-wide text-muted">{ing.section}</li>
                    )}
                    <li className="py-1.5">{shown[i]!.raw}</li>
                  </Fragment>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="steps-h">
            <h2 id="steps-h" className="mb-3 text-xl font-semibold">
              Steps
            </h2>
            {r.steps.length === 0 ? (
              <p className="text-muted">No steps listed.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {r.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span aria-hidden className="w-6 shrink-0 text-lg font-semibold text-accent">
                      {i + 1}.
                    </span>
                    <span className="max-w-prose text-lg leading-relaxed">{s.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        {r.notes && (
          <section aria-labelledby="notes-h" className="mt-10 max-w-prose rounded-lg bg-sunken p-4">
            <h2 id="notes-h" className="mb-2 text-xl font-semibold">
              Notes
            </h2>
            <p className="whitespace-pre-line">{r.notes}</p>
          </section>
        )}
      </article>
    );
  }

  return (
    <div className="min-h-dvh text-ink">
      <main className="mx-auto max-w-4xl px-4 py-6">{body}</main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-center text-sm text-muted">Shared with Meally</footer>
    </div>
  );
}
