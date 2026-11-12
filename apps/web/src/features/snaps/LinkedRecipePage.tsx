import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ApiRequestError } from "../../lib/api";
import { Button, EmptyState, useToast } from "../../ui";
import { useSession } from "../auth/useSession";
import { useFeature } from "../features/FeaturesProvider";
import { DeadLink, PublicRecipeView, RecipeSkeleton } from "../share/PublicRecipeView";
import { BackToFeed } from "./SnapViewPage";
import { toPublicRecipe, useLinkedRecipe, useSaveLinkedRecipe, useSnap, type LinkedRecipe } from "./view-api";

const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium";

/** `/snaps/:id/recipe`: a Friend's recipe, read-only, with Save to my recipes. Your own Snap opens your editable recipe. */
export function LinkedRecipePage() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const scaling = useFeature("scaling");
  const snap = useSnap(id);
  const own = !!snap.data && snap.data.author.id === user?.id;
  const recipe = useLinkedRecipe(id, !!snap.data && !own && !!snap.data.recipe);
  if (own && snap.data?.recipe) return <Navigate to={`/recipes/${encodeURIComponent(snap.data.recipe.slug)}`} replace />;

  let body;
  if (snap.isPending || recipe.isPending) {
    // A recipe query that is not enabled stays pending: only wait on it once the Snap says there is one.
    body = snap.isPending || (snap.data?.recipe && !own) ? <RecipeSkeleton /> : <DeadLink />;
  } else if (snap.isError || recipe.isError) {
    body = <Failure error={snap.error ?? recipe.error} retry={() => void (snap.isError ? snap.refetch() : recipe.refetch())} />;
  } else if (!snap.data?.recipe || !recipe.data) {
    body = <DeadLink />;
  } else {
    body = <Loaded id={id} from={snap.data.author.name} ownSlug={snap.data.recipe.slug} scaling={scaling} recipe={recipe.data} />;
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link to={`/snaps/${id}`} className="inline-flex min-h-11 items-center self-start text-accent underline">
        Back to Snap
      </Link>
      {body}
    </div>
  );
}

function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  if (error instanceof ApiRequestError && error.status === 404) return <DeadLink />;
  return (
    <EmptyState title="Couldn't load this recipe" action={<Button onClick={retry}>Try again</Button>}>
      Check your connection, then try again.
    </EmptyState>
  );
}

function Loaded({ id, from, ownSlug, scaling, recipe }: { id: string; from: string; ownSlug: string; scaling: boolean; recipe: LinkedRecipe }) {
  const save = useSaveLinkedRecipe(id);
  const navigate = useNavigate();
  const toast = useToast();
  const open = (slug: string) => navigate(`/recipes/${encodeURIComponent(slug)}`);
  const onSave = () =>
    save.mutate(undefined, {
      onSuccess: (r) => open(r.slug),
      onError: (e) => {
        if (e instanceof ApiRequestError && e.code === "own_recipe") open(ownSlug);
        else toast("Couldn't save the recipe. Tap Save to try again.", "danger");
      },
    });
  return (
    <>
      <p className="text-sm text-muted">From {from}</p>
      <PublicRecipeView
        r={toPublicRecipe(recipe, scaling)}
        actions={
          recipe.savedSlug ? (
            <Link to={`/recipes/${encodeURIComponent(recipe.savedSlug)}`} className={`${linkButton} border border-line bg-raised hover:bg-sunken`}>
              Open my copy
            </Link>
          ) : (
            <Button onClick={onSave} loading={save.isPending}>
              Save to my recipes
            </Button>
          )
        }
      />
      <BackToFeed />
    </>
  );
}
