import { ArrowLeft, Check, Clock, Copy, Quote, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { PublicShare, PublicShareItem } from "@meally/shared";
import { AppShell } from "../../app/AppShell";
import { ApiRequestError } from "../../lib/api";
import { Badge, Brand, Button, Dialog, EmptyState, Skeleton, useToast } from "../../ui";
import { useAuthStatus, useSession } from "../auth/useSession";
import { useFeature } from "../features/FeaturesProvider";
import { usePwa } from "../../pwa/Pwa";
import { GRID } from "../recipes/RecipeLibrary";
import { formatMinutes } from "../recipes/format";
import { RecipeThumb } from "../recipes/RecipeThumb";
import { DeadLink, PublicRecipeView, RecipeSkeleton } from "./PublicRecipeView";
import { shareReturnPath, usePublicShare, usePublicShareRecipe, useSaveShare, useShareStatus } from "./receive";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const linkButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 font-medium";
const primaryLink = `${linkButton} bg-accent text-accent-contrast hover:bg-accent-hover`;
const secondaryLink = `${linkButton} border border-line bg-raised hover:bg-sunken`;

/** `/s/*`: inside the app shell when signed in (D6), a bare page with a sign-in link otherwise. */
export function ShareLayout() {
  const { me, isLoading } = useSession();
  if (me) return <AppShell />;
  // Don't render the bare page and then swap to the shell (remounting it) once the session check lands.
  if (isLoading)
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <RecipeSkeleton />
      </div>
    );
  return (
    <div className="min-h-dvh bg-surface text-ink">
      <header className="print:hidden mx-auto flex max-w-4xl items-center justify-between px-4 pt-[calc(0.75rem+var(--sat,0px))] pb-2">
        <Brand />
        <Link to="/signin" className="text-sm font-medium text-accent underline">
          Sign in
        </Link>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-4">
        <Outlet />
        <OpenInAppHint />
      </main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-center text-sm text-muted">Shared with Meally</footer>
    </div>
  );
}

/**
 * iPhone and iPad open links from Messages in Safari, never in the Home Screen app, and the two don't share a sign-in
 * (WebKit keeps them separate). So an existing user copies the link and pastes it in the app's Import page.
 */
function OpenInAppHint() {
  const { isIos } = usePwa();
  const importOn = useFeature("import-url");
  const toast = useToast();
  const { pathname } = useLocation();
  if (!isIos || !importOn) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${pathname}`);
      toast("Link copied. Open Meally and paste it under Import.", "success");
    } catch {
      toast("Could not copy; copy the address from Safari instead", "danger");
    }
  };
  return (
    <aside aria-label="Open in the Meally app" className="print:hidden mt-8 flex items-start gap-3 rounded-lg border border-line bg-raised p-4">
      <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
      <div className="flex flex-col gap-2">
        <p className="font-medium">Already have Meally on your home screen?</p>
        <p className="text-sm text-muted">Copy this link, open Meally, then paste it on the Import page. It opens there, already signed in.</p>
        <Button variant="secondary" size="sm" className="self-start" onClick={() => void copy()}>
          <Copy className="size-4" aria-hidden />
          Copy link
        </Button>
      </div>
    </aside>
  );
}

function SharedBy({ share }: { share: PublicShare }) {
  if (!share.sharedBy && !share.note) return null;
  return (
    <div className="flex flex-col gap-2">
      {share.sharedBy && (
        <p className="flex items-center gap-2 text-sm">
          <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent">
            {share.sharedBy.trim().charAt(0).toUpperCase()}
          </span>
          <span>
            Shared by <strong className="font-semibold">{share.sharedBy}</strong>
          </span>
        </p>
      )}
      {share.note && (
        <blockquote className="flex max-w-prose gap-2 rounded-md bg-sunken p-3 text-ink">
          <Quote className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span className="whitespace-pre-line">{share.note}</span>
        </blockquote>
      )}
    </div>
  );
}

/** Shown to a signed-out viewer who taps Save: create an account (or sign in), then come back and save. */
function KeepDialog({ open, onOpenChange, next, many, sharedBy }: { open: boolean; onOpenChange: (o: boolean) => void; next: string; many: boolean; sharedBy: string | null }) {
  const status = useAuthStatus();
  const mode = status.data?.signupMode;
  const canSignUp = mode === "open";
  const q = `?next=${encodeURIComponent(next)}`;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={many ? "Keep these recipes" : "Keep this recipe"}
      description={
        canSignUp || status.isPending
          ? `Create a free Meally account to save ${many ? "them" : "it"} to your own recipes. Then cook from ${many ? "them" : "it"}, scale servings and plan meals.`
          : mode === "invite"
            ? `New accounts on this server are by invitation. Ask ${sharedBy ?? "the person who shared this"} for an invite, or sign in to save ${many ? "them" : "it"}.`
            : `Sign-ups are closed on this server. If you have an account, sign in to save ${many ? "them" : "it"}.`
      }
    >
      <div className="flex flex-col gap-2">
        {status.isPending ? (
          <Skeleton className="h-11" />
        ) : (
          canSignUp && (
            <Link to={`/sign-up${q}`} className={primaryLink}>
              Create account and save
            </Link>
          )
        )}
        <Link to={`/signin${q}`} className={secondaryLink}>
          I have an account
        </Link>
      </div>
    </Dialog>
  );
}

function useStatus(token: string) {
  const { me } = useSession();
  return { me, status: useShareStatus(token, !!me) };
}

/** Save one recipe of the link (or open your copy). */
function SaveOne({ token, slug, sharedBy }: { token: string; slug: string; sharedBy: string | null }) {
  const { me, status } = useStatus(token);
  const { save, pending } = useSaveShare(token);
  const navigate = useNavigate();
  const toast = useToast();
  const [keep, setKeep] = useState(false);
  if (!me)
    return (
      <>
        <Button onClick={() => setKeep(true)}>Save to my recipes</Button>
        <KeepDialog open={keep} onOpenChange={setKeep} next={shareReturnPath(token, slug)} many={false} sharedBy={sharedBy} />
      </>
    );
  if (status.isPending) return <Skeleton className="h-11 w-48" />;
  if (status.isError) return <p className="text-sm text-danger">Could not check your recipes. Reload to try again.</p>;
  const mine = status.data.saved[slug];
  if (status.data.ownRecipe)
    return (
      <p className="flex flex-wrap items-center gap-3 text-sm">
        <span>This is your own recipe.</span>
        <Link to={`/recipes/${encodeURIComponent(slug)}`} className={secondaryLink}>
          Open it
        </Link>
      </p>
    );
  if (mine)
    return (
      <p className="flex flex-wrap items-center gap-3">
        <Badge tone="success">
          <Check className="mr-1 inline size-3.5" aria-hidden />
          Saved
        </Badge>
        <Link to={`/recipes/${encodeURIComponent(mine)}`} className={secondaryLink}>
          Open my copy
        </Link>
      </p>
    );
  return (
    <Button
      loading={pending}
      onClick={() =>
        void save([slug])
          .then((r) => navigate(`/recipes/${encodeURIComponent(r.saved[slug]!)}`, { state: { justSaved: true } }))
          .catch((e: unknown) => toast(e instanceof ApiRequestError ? e.message : "Could not save. Try again.", "danger"))
      }
    >
      Save to my recipes
    </Button>
  );
}

/** Save every recipe of a set or cookbook link into a new cookbook (when cookbooks are on). */
function SaveAll({ token, share, auto }: { token: string; share: PublicShare; auto: boolean }) {
  const { me, status } = useStatus(token);
  const { save, pending, progress } = useSaveShare(token);
  const cookbooksOn = useFeature("cookbooks");
  const navigate = useNavigate();
  const toast = useToast();
  const [keep, setKeep] = useState(false);
  const started = useRef(false);
  const unsaved = share.items.filter((i) => !status.data?.saved[i.slug]).map((i) => i.slug);
  const cookbookName = share.title || (share.sharedBy ? `From ${share.sharedBy}` : "Shared recipes");

  const run = () =>
    save(unsaved, cookbooksOn ? cookbookName : undefined)
      .then((r) => {
        toast(`Saved ${plural(Object.keys(r.saved).length, "recipe")}`, "success");
        navigate(r.cookbookSlug ? `/cookbooks/${encodeURIComponent(r.cookbookSlug)}` : "/recipes", { state: { justSaved: true } });
      })
      .catch((e: unknown) => toast(e instanceof ApiRequestError ? e.message : "Could not save everything. Try again.", "danger"));

  useEffect(() => {
    if (!auto || started.current || !me || !status.data || status.data.ownRecipe || unsaved.length === 0) return;
    started.current = true;
    void run();
  });

  if (share.count === 0) return null;
  if (!me)
    return (
      <>
        <Button onClick={() => setKeep(true)}>Save all {share.count}</Button>
        <KeepDialog open={keep} onOpenChange={setKeep} next={shareReturnPath(token)} many sharedBy={share.sharedBy} />
      </>
    );
  if (status.isPending) return <Skeleton className="h-11 w-48" />;
  if (status.isError) return <p className="text-sm text-danger">Could not check your recipes. Reload to try again.</p>;
  if (status.data.ownRecipe) return <p className="text-sm text-muted">These are your own recipes.</p>;
  if (unsaved.length === 0)
    return (
      <p className="flex flex-wrap items-center gap-3">
        <Badge tone="success">
          <Check className="mr-1 inline size-3.5" aria-hidden />
          All saved
        </Badge>
        <Link to="/recipes" className={secondaryLink}>
          Go to my recipes
        </Link>
      </p>
    );
  const some = unsaved.length < share.count;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button loading={pending} onClick={() => void run()}>
        {some ? `Save the other ${unsaved.length}` : `Save all ${share.count}`}
      </Button>
      <span className="text-sm text-muted" aria-live="polite">
        {progress ? `Saving ${progress.done} of ${progress.total}…` : cookbooksOn ? `They'll go in a new cookbook, "${cookbookName}".` : ""}
      </span>
    </div>
  );
}

function ShareCard({ token, item, saved }: { token: string; item: PublicShareItem; saved: boolean }) {
  const time = formatMinutes(item.totalMinutes);
  return (
    <li className="relative">
      <Link to={`/s/${encodeURIComponent(token)}/${encodeURIComponent(item.slug)}`} className="group block overflow-hidden rounded-lg border border-line bg-raised">
        <div className="aspect-[4/3] bg-sunken">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <RecipeThumb name={item.name} imageUrl={null} textClass="text-4xl" className="size-full" />
          )}
        </div>
        <div className="p-3">
          <h2 className="line-clamp-2 min-h-[2.5rem] text-base font-medium leading-5 group-hover:underline">{item.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {time ? (
              <>
                <Clock className="mr-1 inline size-3.5" aria-hidden />
                {time}
              </>
            ) : (
              "No time set"
            )}
          </p>
        </div>
      </Link>
      {saved && (
        <Badge tone="success" className="absolute left-2 top-2">
          Saved
        </Badge>
      )}
    </li>
  );
}

/** `?save=1`: the viewer came back from sign-up or sign-in to save. */
function useAutoSaveFlag() {
  const [params] = useSearchParams();
  return { auto: params.get("save") === "1" };
}

/** Saves the one recipe once, right after sign-up or sign-in brought the viewer back with `?save=1`. */
function AutoSaveOne({ token, slug }: { token: string; slug: string }) {
  const { me, status } = useStatus(token);
  const { save } = useSaveShare(token);
  const navigate = useNavigate();
  const toast = useToast();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !me || !status.data) return;
    started.current = true;
    const mine = status.data.saved[slug];
    if (status.data.ownRecipe) return;
    if (mine) {
      navigate(`/recipes/${encodeURIComponent(mine)}`, { replace: true });
      return;
    }
    void save([slug])
      .then((r) => navigate(`/recipes/${encodeURIComponent(r.saved[slug]!)}`, { replace: true, state: { justSaved: true } }))
      .catch(() => toast("Could not save. Tap Save to try again.", "danger"));
  });
  return null;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

/** `/s/:token`: one recipe, or a set or cookbook as a grid with Save all. */
export function SharePage() {
  const { token = "" } = useParams();
  const share = usePublicShare(token);
  const { me, status } = useStatus(token);
  const { auto } = useAutoSaveFlag();
  if (share.isPending) return <RecipeSkeleton />;
  if (share.isError) return <DeadLink />;
  const s = share.data;
  if (s.kind === "recipe" && s.recipe && s.items[0]) {
    const slug = s.items[0].slug;
    return (
      <>
        {auto && <AutoSaveOne token={token} slug={slug} />}
        <PublicRecipeView
          r={s.recipe}
          actions={
            <div className="flex flex-col gap-3">
              <SharedBy share={s} />
              <SaveOne token={token} slug={slug} sharedBy={s.sharedBy} />
            </div>
          }
        />
      </>
    );
  }
  const heading = s.title || plural(s.count, "recipe");
  return (
    <Shell>
      <header className="flex flex-col gap-3">
        <div>
          <p className="text-sm text-muted">
            {s.kind === "cookbook" ? "Cookbook" : "Shared recipes"} · {plural(s.count, "recipe")}
          </p>
          <h1 className="text-3xl font-semibold leading-tight">{heading}</h1>
        </div>
        <SharedBy share={s} />
        <SaveAll token={token} share={s} auto={auto} />
      </header>
      {s.count === 0 ? (
        <EmptyState title="Nothing here yet">The person who shared this hasn't added any recipes yet, or has removed them.</EmptyState>
      ) : (
        <ul className={GRID}>
          {s.items.map((i) => (
            <ShareCard key={i.slug} token={token} item={i} saved={!!(me && status.data?.saved[i.slug] && !status.data.ownRecipe)} />
          ))}
        </ul>
      )}
    </Shell>
  );
}

/** `/s/:token/:slug`: one recipe inside a set or cookbook link. */
export function ShareRecipePage() {
  const { token = "", slug = "" } = useParams();
  const share = usePublicShare(token);
  const recipe = usePublicShareRecipe(token, slug);
  const { auto } = useAutoSaveFlag();
  if (recipe.isPending || share.isPending) return <RecipeSkeleton />;
  if (recipe.isError || share.isError) return <DeadLink />;
  const s = share.data;
  return (
    <Shell>
      {auto && <AutoSaveOne token={token} slug={slug} />}
      <Link to={`/s/${encodeURIComponent(token)}`} className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent">
        <ArrowLeft className="size-4" aria-hidden />
        {s.title ? `${s.title} (${plural(s.count, "recipe")})` : `All ${plural(s.count, "recipe")}`}
      </Link>
      <PublicRecipeView
        r={recipe.data}
        actions={
          <div className="flex flex-col gap-3">
            <SharedBy share={s} />
            <SaveOne token={token} slug={slug} sharedBy={s.sharedBy} />
          </div>
        }
      />
    </Shell>
  );
}

