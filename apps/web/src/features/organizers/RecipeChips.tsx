import { Wrench } from "lucide-react";
import { Link } from "react-router";
import type { OrganizerRef } from "@meally/shared";
import { useFeature } from "../features/FeaturesProvider";

const chip = "inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-sm underline-offset-2 hover:underline active:bg-line pointer-coarse:min-h-11";

/** One row of organiser chips; each links to the library filtered by it. Renders nothing when off or empty. */
export function RecipeChips({ categories = [], tags = [], tools = [] }: { categories?: OrganizerRef[]; tags?: OrganizerRef[]; tools?: OrganizerRef[] }) {
  const on = useFeature("organizers");
  if (!on || categories.length + tags.length + tools.length === 0) return null;
  const to = (param: string, slug: string) => `/recipes?${param}=${encodeURIComponent(slug)}`;
  return (
    <ul aria-label="Categories, tags and tools" className="mt-3 flex flex-wrap gap-2">
      {categories.map((c) => (
        <li key={`c-${c.slug}`}>
          <Link to={to("category", c.slug)} className={`${chip} border border-accent bg-sunken font-medium text-ink`}>
            {c.name}
          </Link>
        </li>
      ))}
      {tags.map((t) => (
        <li key={`t-${t.slug}`}>
          <Link to={to("tag", t.slug)} className={`${chip} bg-sunken text-ink`}>
            {t.name}
          </Link>
        </li>
      ))}
      {tools.map((t) => (
        <li key={`o-${t.slug}`}>
          <Link to={to("tool", t.slug)} aria-label={`Tool: ${t.name}`} className={`${chip} border border-line bg-raised text-ink`}>
            <Wrench className="size-3.5" aria-hidden />
            {t.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
