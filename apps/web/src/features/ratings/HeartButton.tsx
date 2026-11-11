import { Heart } from "lucide-react";
import { cn } from "../../ui";
import { useSetMine } from "./api";

/** Favourite toggle. The hit area is 44 px; `className` positions it (e.g. as a card overlay). */
export function HeartButton({ slug, name, favourite, className }: { slug: string; name: string; favourite: boolean; className?: string }) {
  const { mutate } = useSetMine(slug);
  return (
    <button
      type="button"
      aria-pressed={favourite}
      aria-label={`Favourite ${name}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        mutate({ favourite: !favourite });
      }}
      className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2", className)}
    >
      <Heart className={cn("size-5", favourite && "fill-current text-danger")} aria-hidden />
    </button>
  );
}
