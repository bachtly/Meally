import { Star } from "lucide-react";
import type { KeyboardEvent } from "react";
import { cn } from "../../ui";
import { useSetMine } from "./api";

const STARS = [1, 2, 3, 4, 5];

/** Interactive 1-5 radio group. Arrow keys move and select; pressing the chosen star again (or Backspace/Delete) clears it. */
export function StarRating({
  slug,
  rating,
  household,
}: {
  slug: string;
  rating: number | null;
  household?: { average: number | null; count: number };
}) {
  const { mutate } = useSetMine(slug);
  const set = (v: number | null) => mutate({ rating: v });
  const onKey = (e: KeyboardEvent) => {
    const cur = rating ?? 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") set(Math.min(5, cur + 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(Math.max(1, cur - 1));
    else if (e.key === "Backspace" || e.key === "Delete") set(null);
    else return;
    e.preventDefault();
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <div role="radiogroup" aria-label="Your rating" onKeyDown={onKey} className="flex">
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            tabIndex={rating === n || (rating === null && n === 1) ? 0 : -1}
            onClick={() => set(rating === n ? null : n)}
            className="flex size-11 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2"
          >
            <Star className={cn("size-6", rating !== null && n <= rating ? "fill-amber-500 text-amber-500" : "text-muted")} aria-hidden />
          </button>
        ))}
      </div>
      {rating !== null && (
        <button type="button" className="min-h-11 text-sm text-muted underline" onClick={() => set(null)}>
          Clear
        </button>
      )}
      {household && household.count > 0 && household.average !== null && (
        <span className="text-sm text-muted">
          {household.average.toFixed(1)} &middot; {household.count} {household.count === 1 ? "rating" : "ratings"}
        </span>
      )}
    </div>
  );
}
