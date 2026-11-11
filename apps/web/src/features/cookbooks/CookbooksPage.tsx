import { BookMarked, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Cookbook } from "@meally/shared";
import { Button, EmptyState, Skeleton } from "../../ui";
import { RecipeThumb } from "../recipes/RecipeThumb";
import { CookbookDialog } from "./CookbookDialog";
import { useCookbooks } from "./api";

/** Up to 4 recipe photos as a collage, or a warm placeholder. */
export function CookbookCover({ cookbook }: { cookbook: Pick<Cookbook, "covers" | "name"> }) {
  const imgs = cookbook.covers;
  if (imgs.length === 0)
    return (
      <RecipeThumb name={cookbook.name} imageUrl={null} textClass="text-5xl" className="size-full" />
    );
  if (imgs.length < 3) return <img src={imgs[0]} alt="" loading="lazy" className="size-full object-cover" />;
  return (
    <div className="grid size-full grid-cols-2 gap-0.5">
      <img src={imgs[0]} alt="" loading="lazy" className="size-full object-cover" />
      <div className={`grid min-h-0 gap-0.5 ${imgs.length === 4 ? "grid-rows-3" : "grid-rows-2"}`}>
        {imgs.slice(1).map((u, i) => (
          <img key={i} src={u} alt="" loading="lazy" className="size-full min-h-0 object-cover" />
        ))}
      </div>
    </div>
  );
}

export const countLabel = (c: Pick<Cookbook, "count" | "countCapped">) =>
  `${c.count}${c.countCapped ? "+" : ""} ${c.count === 1 && !c.countCapped ? "recipe" : "recipes"}`;

export function CookbooksPage() {
  const query = useCookbooks();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const items = query.data ?? [];

  let body;
  if (query.isPending) {
    body = (
      <ul aria-busy="true" aria-label="Loading cookbooks" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i}>
            <Skeleton className="aspect-[4/3]" />
            <Skeleton className="mt-2 h-5" />
          </li>
        ))}
      </ul>
    );
  } else if (query.isError) {
    body = (
      <EmptyState title="Could not load cookbooks" action={<Button onClick={() => void query.refetch()}>Try again</Button>}>
        Check your connection and try again.
      </EmptyState>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState icon={<BookMarked className="size-10" />} title="No cookbooks yet" action={<Button onClick={() => setCreating(true)}>New cookbook</Button>}>
        Group recipes by hand, or save a library filter as a smart cookbook.
      </EmptyState>
    );
  } else {
    body = (
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <li key={c.id}>
            <Link to={`/cookbooks/${c.slug}`} className="group block overflow-hidden rounded-lg border border-line bg-raised">
              <div className="aspect-[4/3] overflow-hidden bg-sunken">
                <CookbookCover cookbook={c} />
              </div>
              <div className="p-3">
                <h2 className="line-clamp-1 text-lg font-medium group-hover:underline">{c.name}</h2>
                <p className="text-sm text-muted">
                  {countLabel(c)} · {c.kind === "smart" ? "Smart" : "Hand-picked"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Cookbooks</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          New cookbook
        </Button>
      </div>
      {body}
      <CookbookDialog open={creating} onOpenChange={setCreating} onSaved={(c) => navigate(`/cookbooks/${c.slug}`)} />
    </>
  );
}
