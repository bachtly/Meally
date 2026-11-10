import { ArrowDownUp, BookOpen, ChevronDown, Heart, SearchX, Star } from "lucide-react";
import type { ReactNode } from "react";
import { BookMarked } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { RecipeSummary } from "@meally/shared";
import { Feature } from "../features/Feature";
import { useFeature } from "../features/FeaturesProvider";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, Skeleton } from "../../ui";
import { LibraryFilters, useOrganizerFilters } from "../organizers/LibraryFilters";
import { HeartButton } from "../ratings/HeartButton";
import { CookbookDialog } from "../cookbooks/CookbookDialog";
import { useRecipes, type RecipeSort } from "./api";
import { formatMinutes, imageSrcSet } from "./format";
import { RecipeThumb } from "./RecipeThumb";

const SORTS: { value: RecipeSort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name" },
  { value: "created", label: "Newest" },
  { value: "rating", label: "Top rated" },
  { value: "last-made", label: "Last made" },
];
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium";
export const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5";

export function RecipeCard({ recipe, extra }: { recipe: RecipeSummary; extra?: ReactNode }) {
  const time = formatMinutes(recipe.totalMinutes);
  return (
    <li className="relative">
      <Link to={`/recipes/${recipe.slug}`} className="group block overflow-hidden rounded-lg border border-line bg-raised">
        <div className="aspect-[4/3] bg-sunken">
          {recipe.imageUrl ? (
            <img
              src={recipe.imageUrl}
              srcSet={imageSrcSet(recipe.imageUrl)}
              sizes="(min-width: 1024px) 20vw, 50vw"
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <RecipeThumb name={recipe.name} imageUrl={null} textClass="text-4xl" className="size-full" />
          )}
        </div>
        <div className="p-3">
          <h2 className="line-clamp-2 min-h-[2.5rem] text-base font-medium leading-5 group-hover:underline">{recipe.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {time ?? "No time set"}
            {recipe.rating ? (
              <span className="ml-2 inline-flex items-center gap-0.5" aria-label={`Rated ${recipe.rating} of 5`}>
                <Star className="size-3.5 fill-amber-500 text-amber-500" aria-hidden />
                {recipe.rating}
              </span>
            ) : null}
          </p>
          {recipe.madeCount ? <p className="text-xs text-muted">Made {recipe.madeCount}×</p> : null}
        </div>
      </Link>
      {recipe.favourite !== undefined && (
        <HeartButton slug={recipe.slug} name={recipe.name} favourite={recipe.favourite} className="absolute right-0 top-0 rounded-bl-lg bg-raised/80 backdrop-blur" />
      )}
      {extra}
    </li>
  );
}

export function RecipeLibrary() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const canImport = useFeature("import-url");
  const q = params.get("q") ?? "";
  const sortParam = params.get("sort");
  const sort: RecipeSort = SORTS.some((s) => s.value === sortParam) ? (sortParam as RecipeSort) : "updated";
  const organizersOn = useFeature("organizers");
  const { filters, count: filterCount } = useOrganizerFilters();
  const ratingsOn = useFeature("ratings");
  const timelineOn = useFeature("timeline");
  const favourites = ratingsOn && params.get("favourites") === "1";
  const query = useRecipes({ q, sort: !ratingsOn && sort === "rating" ? "updated" : sort, ...(favourites ? { favourites } : {}), ...(organizersOn ? { tag: filters.tags, category: filters.categories, tool: filters.tools } : {}) });
  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const cookbooksOn = useFeature("cookbooks");
  const [saving, setSaving] = useState(false);
  const hasFilters = !!q.trim() || favourites || (organizersOn && filterCount > 0);
  const minRatingParam = Number(params.get("minRating"));
  const sortLabel = SORTS.find((s) => s.value === sort)!.label;

  const toggleFavourites = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (favourites) next.delete("favourites");
        else next.set("favourites", "1");
        return next;
      },
      { replace: true },
    );
  const setSort = (value: RecipeSort) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "updated") next.delete("sort");
        else next.set("sort", value);
        return next;
      },
      { replace: true },
    );

  let body;
  if (query.isPending) {
    body = (
      <ul aria-busy="true" aria-label="Loading recipes" className={GRID}>
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <Skeleton className="aspect-[4/3]" />
            <Skeleton className="mt-2 h-5" />
          </li>
        ))}
      </ul>
    );
  } else if (query.isError) {
    body = (
      <EmptyState title="Could not load recipes" action={<Button onClick={() => void query.refetch()}>Try again</Button>}>
        Check your connection and try again.
      </EmptyState>
    );
  } else if (items.length === 0 && (q.trim() || favourites || (organizersOn && filterCount > 0))) {
    body = (
      <EmptyState icon={<SearchX className="size-10" />} title="No results">
        {q.trim() ? <>Nothing matches &ldquo;{q}&rdquo;. Try a different word.</> : "No recipes match these filters."}
      </EmptyState>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<BookOpen className="size-10" />}
        title="No recipes yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/recipes/new" className={`${linkButton} bg-accent text-accent-contrast hover:bg-accent-hover`}>
              New recipe
            </Link>
            <Feature on="import-url">
              <Link to="/recipes/import" className={`${linkButton} border border-line bg-raised hover:bg-sunken`}>
                Import from URL
              </Link>
            </Feature>
          </div>
        }
      >
        Add your first recipe to start your library.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <ul className={GRID}>
          {items.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </ul>
        {query.hasNextPage && (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Recipes</h1>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" aria-label={`Sort: ${sortLabel}`}>
                <ArrowDownUp className="size-4" aria-hidden />
                {sortLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORTS.filter((s) => (ratingsOn || s.value !== "rating") && (timelineOn || s.value !== "last-made")).map((s) => (
                <DropdownMenuItem key={s.value} onSelect={() => setSort(s.value)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {canImport ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  New recipe
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate("/recipes/new")}>Write from scratch</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/recipes/import")}>Import from URL</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link to="/recipes/new" className={`${linkButton} min-h-9 bg-accent px-3 text-sm text-accent-contrast hover:bg-accent-hover`}>
              New recipe
            </Link>
          )}
        </div>
      </div>
      {q.trim() && (
        <p className="mb-3 text-sm text-muted">
          Showing results for &ldquo;{q}&rdquo;
        </p>
      )}
      {ratingsOn && (
        <div className="mb-3">
          <button
            type="button"
            aria-pressed={favourites}
            onClick={toggleFavourites}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${favourites ? "border-accent bg-accent text-accent-contrast" : "border-line bg-raised hover:bg-sunken"}`}
          >
            <Heart className={`size-4 ${favourites ? "fill-current" : ""}`} aria-hidden />
            Favourites
          </button>
        </div>
      )}
      {organizersOn && <LibraryFilters />}
      {cookbooksOn && hasFilters && (
        <div className="mb-3">
          <Button variant="secondary" size="sm" onClick={() => setSaving(true)}>
            <BookMarked className="size-4" aria-hidden />
            Save as cookbook
          </Button>
          <CookbookDialog
            open={saving}
            onOpenChange={setSaving}
            filter={{
              ...(q.trim() ? { q: q.trim() } : {}),
              tag: organizersOn ? filters.tags : [],
              category: organizersOn ? filters.categories : [],
              tool: organizersOn ? filters.tools : [],
              favourites,
              ...(ratingsOn && minRatingParam >= 1 && minRatingParam <= 5 ? { minRating: Math.round(minRatingParam) } : {}),
            }}
            onSaved={(c) => navigate(`/cookbooks/${c.slug}`)}
          />
        </div>
      )}
      {body}
    </>
  );
}
