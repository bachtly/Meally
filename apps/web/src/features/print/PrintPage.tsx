import { Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, EmptyState, Skeleton } from "../../ui";
import { scaledIngredients } from "../cook-mode/helpers";
import { useFeature } from "../features/FeaturesProvider";
import { useRecipe } from "../recipes/api";
import { formatMinutes, imageSrcSet } from "../recipes/format";
import "./print.css";

/** Standalone print layout: no shell, no controls in the printout. Opens the print dialog once the recipe has rendered. */
export function PrintPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const query = useRecipe(slug);
  const scalingOn = useFeature("scaling");
  const [photo, setPhoto] = useState(true);
  const opened = useRef(false);
  const ready = query.isSuccess;

  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    const t = window.setTimeout(() => window.print?.(), 300);
    return () => window.clearTimeout(t);
  }, [ready]);

  if (query.isPending) return <Skeleton className="m-6 h-40" aria-busy="true" aria-label="Loading recipe" />;
  if (query.isError) {
    return (
      <EmptyState title="Could not load this recipe" action={<Link to="/recipes">Back to recipes</Link>}>
        Check your connection and try again.
      </EmptyState>
    );
  }
  const r = query.data;
  const shown = scaledIngredients(r, params, scalingOn);
  const wanted = Number(params.get("servings"));
  const servings = scalingOn && r.servings != null && Number.isInteger(wanted) && wanted >= 1 && wanted <= 999 ? wanted : r.servings;
  const longList = r.ingredients.length > 8;
  const back = `/recipes/${r.slug}${params.toString() ? `?${params}` : ""}`;

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <Link to={back}>Back to recipe</Link>
        {r.imageUrl && (
          <label>
            <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} /> Include photo
          </label>
        )}
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print again
        </Button>
      </div>
      <main>
        <h1>{r.name}</h1>
        {r.description && <p className="print-lede">{r.description}</p>}
        <p className="print-meta">
          {[
            servings != null ? `Serves ${servings}` : r.yieldText,
            r.prepMinutes != null ? `Prep ${formatMinutes(r.prepMinutes)}` : null,
            r.cookMinutes != null ? `Cook ${formatMinutes(r.cookMinutes)}` : null,
            r.totalMinutes != null ? `Total ${formatMinutes(r.totalMinutes)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {r.imageUrl && photo && <img className="print-photo" src={r.imageUrl} srcSet={imageSrcSet(r.imageUrl, [800, 1600])} sizes="40rem" alt="" />}
        <h2>Ingredients</h2>
        {r.ingredients.length === 0 ? (
          <p>No ingredients listed.</p>
        ) : (
          <ul className={longList ? "print-cols" : undefined}>
            {r.ingredients.map((ing, i) => (
              <li key={i}>
                {ing.section && ing.section !== r.ingredients[i - 1]?.section && <strong className="print-section">{ing.section}</strong>}
                {shown[i]!.raw}
              </li>
            ))}
          </ul>
        )}
        <h2>Steps</h2>
        {r.steps.length === 0 ? (
          <p>No steps listed.</p>
        ) : (
          <ol>
            {r.steps.map((s, i) => (
              <li key={i}>
                {s.section && s.section !== r.steps[i - 1]?.section && <strong className="print-section">{s.section}</strong>}
                {s.text}
              </li>
            ))}
          </ol>
        )}
        {r.notes && (
          <>
            <h2>Notes</h2>
            <p className="print-notes">{r.notes}</p>
          </>
        )}
        {r.sourceUrl && <p className="print-source">Source: {r.sourceUrl}</p>}
      </main>
    </div>
  );
}
