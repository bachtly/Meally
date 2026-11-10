import { ArrowDownUp, BookOpen, SearchX } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { RecipeSummary } from "@meally/shared";
import { Feature } from "../features/Feature";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, Skeleton } from "../../ui";
import { useRecipes, type RecipeSort } from "./api";
import { formatMinutes, imageSrcSet } from "./format";

const SORTS: { value: RecipeSort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name" },
  { value: "created", label: "Newest" },
];
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium";
const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5";

function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const time = formatMinutes(recipe.totalMinutes);
  return (
    <li>
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
            <div aria-hidden className="flex size-full items-center justify-center bg-accent/10 text-4xl font-semibold text-accent">
              {recipe.name.trim().charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="p-3">
          <h2 className="line-clamp-2 min-h-[2.5rem] text-base font-medium leading-5 group-hover:underline">{recipe.name}</h2>
          <p className="mt-1 text-sm text-muted">{time ?? "No time set"}</p>
        </div>
      </Link>
    </li>
  );
}

export function RecipeLibrary() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sortParam = params.get("sort");
  const sort: RecipeSort = SORTS.some((s) => s.value === sortParam) ? (sortParam as RecipeSort) : "updated";
  const query = useRecipes({ q, sort });
  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const sortLabel = SORTS.find((s) => s.value === sort)!.label;

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
  } else if (items.length === 0 && q.trim()) {
    body = (
      <EmptyState icon={<SearchX className="size-10" />} title="No results">
        Nothing matches &ldquo;{q}&rdquo;. Try a different word.
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
              {SORTS.map((s) => (
                <DropdownMenuItem key={s.value} onSelect={() => setSort(s.value)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link to="/recipes/new" className={`${linkButton} min-h-9 bg-accent px-3 text-sm text-accent-contrast hover:bg-accent-hover`}>
            New recipe
          </Link>
        </div>
      </div>
      {q.trim() && (
        <p className="mb-3 text-sm text-muted">
          Showing results for &ldquo;{q}&rdquo;
        </p>
      )}
      {body}
    </>
  );
}
