import { BookMarked, CalendarPlus, ChefHat, Clock, Ellipsis, ExternalLink, Pencil, Printer, RotateCcw, Share2, Trash2, Users } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { adjustIngredient, type UnitChoice } from "@meally/shared";
import { ServingsStepper, UnitsToggle } from "./ScalingControls";
import { ApiRequestError } from "../../lib/api";
import { Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, Skeleton, useToast } from "../../ui";
import { useDeleteRecipe, useRecipe } from "./api";
import { formatMinutes, hostname, imageSrcSet } from "./format";
import { AddToCookbook } from "../cookbooks/AddToCookbook";
import { AddToListButton } from "../shopping/AddToListButton";
import { useFeature } from "../features/FeaturesProvider";
import { HeartButton } from "../ratings/HeartButton";
import { StarRating } from "../ratings/StarRating";
import { AddSheet } from "../meal-plan/AddSheet";
import { localToday } from "../meal-plan/dates";
import { Timeline } from "../timeline/Timeline";
import { Feature } from "../features/Feature";
import { useChecks } from "./useChecks";
import { ShareDialog } from "../share/ShareDialog";
import { RecipeChips } from "../organizers/RecipeChips";

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="mb-1 mt-4 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>;
}

export function RecipePage() {
  const { slug = "" } = useParams();
  const query = useRecipe(slug);
  const del = useDeleteRecipe();
  const toast = useToast();
  const navigate = useNavigate();
  const { checks, toggle, reset, any } = useChecks(slug);
  const [confirm, setConfirm] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareOn = useFeature("share-links");
  const [bookOpen, setBookOpen] = useState(false);
  const cookbooksOn = useFeature("cookbooks");
  const planOn = useFeature("meal-plan");
  const printOn = useFeature("print");
  const scalingOn = useFeature("scaling");
  const timelineOn = useFeature("timeline");
  const [params, setParams] = useSearchParams();
  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value == null) n.delete(key);
        else n.set(key, value);
        return n;
      },
      { replace: true },
    );

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading recipe" className="flex flex-col gap-4">
        <Skeleton className="aspect-[16/9] max-h-80 w-full" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <EmptyState
        title={missing ? "Recipe not found" : "Could not load this recipe"}
        action={
          <Link to="/recipes" className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-medium text-accent-contrast">
            Back to recipes
          </Link>
        }
      >
        {missing ? "It may have been deleted." : "Check your connection and try again."}
      </EmptyState>
    );
  }

  const r = query.data;
  const host = hostname(r.sourceUrl);
  const original = r.servings;
  const wanted = Number(params.get("servings"));
  const servings = scalingOn && original != null && Number.isInteger(wanted) && wanted >= 1 && wanted <= 999 ? wanted : original;
  const unitParam = params.get("units");
  const units: UnitChoice = scalingOn && (unitParam === "metric" || unitParam === "us") ? unitParam : "original";
  const rescaled = scalingOn && original != null && servings != null && servings !== original;
  const factor = original != null && servings != null ? servings / original : 1;
  const shown = r.ingredients.map((ing) => (scalingOn ? adjustIngredient(ing, factor, units) : ing));
  const onDelete = () =>
    del.mutate(slug, {
      onSuccess: () => {
        setConfirm(false);
        toast(`Deleted ${r.name}`, "success");
        navigate("/recipes", { replace: true });
      },
      onError: () => toast("Could not delete the recipe", "danger"),
    });

  return (
    <article className="mx-auto max-w-5xl">
      {r.imageUrl && (
        <img
          src={r.imageUrl}
          srcSet={imageSrcSet(r.imageUrl, [800, 1600])}
          sizes="(min-width: 1024px) 64rem, 100vw"
          alt=""
          className="mb-4 aspect-[16/9] max-h-96 w-full rounded-lg object-cover print:max-h-60"
        />
      )}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-1">
            <h1 className="text-3xl font-semibold leading-tight">{r.name}</h1>
            {r.me && <HeartButton slug={r.slug} name={r.name} favourite={r.me.favourite} className="-mt-1" />}
          </div>
          <div className="flex shrink-0 items-center gap-1 print:hidden">
            <Link
              to={`/recipes/${r.slug}/edit`}
              className="hidden min-h-11 items-center gap-2 rounded-md px-3 font-medium hover:bg-sunken lg:inline-flex"
            >
              <Pencil className="size-4" aria-hidden />
              Edit
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="More actions">
                  <Ellipsis className="size-5" aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild className="lg:hidden">
                  <Link to={`/recipes/${r.slug}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    Edit
                  </Link>
                </DropdownMenuItem>
                {planOn && (
                  <DropdownMenuItem onSelect={() => setPlanOpen(true)}>
                    <CalendarPlus className="size-4" aria-hidden />
                    Add to plan
                  </DropdownMenuItem>
                )}
                {printOn && (
                  <DropdownMenuItem asChild>
                    <Link to={`/recipes/${r.slug}/print${params.toString() ? `?${params}` : ""}`}>
                      <Printer className="size-4" aria-hidden />
                      Print
                    </Link>
                  </DropdownMenuItem>
                )}
                {shareOn && (
                  <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                    <Share2 className="size-4" aria-hidden />
                    Share
                  </DropdownMenuItem>
                )}
                {cookbooksOn && (
                  <DropdownMenuItem onSelect={() => setBookOpen(true)}>
                    <BookMarked className="size-4" aria-hidden />
                    Add to cookbook…
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setConfirm(true)}>
                  <Trash2 className="size-4" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {r.me && <div className="print:hidden"><StarRating slug={r.slug} rating={r.me.rating} household={r.householdRating} /></div>}
        {r.description && <p className="mt-2 max-w-prose text-lg text-muted">{r.description}</p>}
        <RecipeChips categories={r.categories} tags={r.tags} tools={r.tools} />
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
              {rescaled ? servings : (r.yieldText ?? r.servings)}
              {rescaled && <span className="font-normal text-muted"> (of {original})</span>}
            </Meta>
          )}
          {r.sourceUrl && host && (
            <Meta label="Source">
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline">
                {host}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Meta>
          )}
        </dl>
        {scalingOn && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 print:hidden">
            {original != null && servings != null && (
              <ServingsStepper value={servings} original={original} onChange={(n) => setParam("servings", n === original ? null : String(n))} />
            )}
            <UnitsToggle value={units} onChange={(u) => setParam("units", u === "original" ? null : u)} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
          {r.steps.length > 0 && (
            <Feature on="cook-mode">
              <Link
                to={`/recipes/${r.slug}/cook${params.toString() ? `?${params}` : ""}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 font-medium text-accent-contrast"
              >
                <ChefHat className="size-4" aria-hidden />
                Start cooking
              </Link>
            </Feature>
          )}
          <AddToListButton key={servings} slug={r.slug} servings={servings} />
        </div>
      </header>

      <div className="grid gap-8 print:block lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section aria-labelledby="ingredients-h" className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto print:static print:max-h-none print:overflow-visible">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="ingredients-h" className="text-xl font-semibold">
              Ingredients
            </h2>
            {any && (
              <Button variant="ghost" size="sm" onClick={reset} className="print:hidden">
                <RotateCcw className="size-4" aria-hidden />
                Reset
              </Button>
            )}
          </div>
          {r.ingredients.length === 0 ? (
            <p className="text-muted">No ingredients listed.</p>
          ) : (
            <ul className="flex flex-col">
              {r.ingredients.map((ing, i) => (
                <Fragment key={i}>
                  {ing.section && ing.section !== r.ingredients[i - 1]?.section && (
                    <li>
                      <SectionTitle title={ing.section} />
                    </li>
                  )}
                  <li>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0 print:hidden"
                        checked={checks.ingredients.includes(i)}
                        onChange={() => toggle("ingredients", i)}
                      />
                      <span
                        className={
                          checks.ingredients.includes(i)
                            ? "text-muted line-through"
                            : shown[i]!.raw !== ing.raw
                              ? "rounded bg-sunken px-1 font-medium"
                              : undefined
                        }
                      >
                        {shown[i]!.raw}
                      </span>
                    </label>
                  </li>
                </Fragment>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="steps-h">
          <h2 id="steps-h" className="mb-1 text-xl font-semibold">
            Steps
          </h2>
          {scalingOn && (factor !== 1 || units !== "original") && <p className="mb-3 text-sm text-muted">Quantities in steps aren't scaled.</p>}
          {r.steps.length === 0 ? (
            <p className="text-muted">No steps listed.</p>
          ) : (
            <ol className="flex flex-col">
              {r.steps.map((s, i) => (
                <Fragment key={i}>
                  {s.section && s.section !== r.steps[i - 1]?.section && (
                    <li>
                      <SectionTitle title={s.section} />
                    </li>
                  )}
                  <li>
                    <label className="flex cursor-pointer items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-5 shrink-0 print:hidden"
                        checked={checks.steps.includes(i)}
                        onChange={() => toggle("steps", i)}
                        aria-label={`Step ${i + 1}`}
                      />
                      <span aria-hidden className="w-6 shrink-0 text-lg font-semibold text-accent">
                        {i + 1}.
                      </span>
                      <span className={`max-w-prose text-lg leading-relaxed ${checks.steps.includes(i) ? "text-muted line-through" : ""}`}>
                        {s.text}
                      </span>
                    </label>
                  </li>
                </Fragment>
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

      {timelineOn && (
        <div className="print:hidden">
          <Timeline slug={r.slug} />
        </div>
      )}

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this recipe?"
        description={`${r.name} will be removed for everyone in your household. This cannot be undone.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={del.isPending} onClick={onDelete}>
            Delete
          </Button>
        </div>
      </Dialog>
      {shareOn && <ShareDialog slug={r.slug} name={r.name} open={shareOpen} onOpenChange={setShareOpen} />}
      {cookbooksOn && <AddToCookbook open={bookOpen} onOpenChange={setBookOpen} recipeSlug={r.slug} />}
      {planOn && <AddSheet open={planOpen} onOpenChange={setPlanOpen} date={localToday()} recipe={{ id: r.id, name: r.name }} />}
    </article>
  );
}
