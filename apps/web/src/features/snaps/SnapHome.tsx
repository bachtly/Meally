import { BookOpen, ChevronDown, Download, LayoutGrid, MapPin, Send, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Link, useNavigate } from "react-router";
import { SNAP_CAPTION_MAX, SNAP_DISH_NAME_MAX, SNAP_PLACE_MAX } from "@meally/shared";
import { ApiRequestError } from "../../lib/api";
import { cn, useToast } from "../../ui";
import { useSession } from "../auth/useSession";
import { useFeature } from "../features/FeaturesProvider";
import { useFriends } from "../friends/api";
import { CameraCapture } from "./CameraCapture";
import { draftStore, newClientId, type Draft, type DraftStore } from "./drafts";
import { FriendsSheet } from "./FriendsSheet";
import { MenuSheet } from "./MenuSheet";
import { Avatar, camButton, camButtonSm, camChip, captionPill, PhotoFrame, ThreeUp } from "./parts";
import { RecipePicker } from "./RecipePicker";
import { useFeed, useSendSnap } from "./api";

/** Errors a retry can't fix: the photo itself or a field is wrong. */
const PERMANENT = new Set([400, 413, 415]);

/** An upward swipe at least this long (px) opens the Feed. The Feed button does the same. */
const SWIPE_PX = 80;

function FriendsPill({ onClick }: { onClick: () => void }) {
  const friends = useFriends();
  const n = friends.data?.items?.length;
  return (
    <button type="button" className={cn(camChip, "whitespace-nowrap")} onClick={onClick}>
      <Users className="size-4" aria-hidden />
      {n === undefined ? "Friends" : n === 1 ? "1 friend" : `${n} friends`}
    </button>
  );
}

/** The newest three Snaps as a small stack, so the way to the Feed shows there is something there. */
function FeedHandle() {
  const feed = useFeed();
  const first = feed.data?.pages[0]?.items;
  const thumbs = (first ?? []).slice(0, 3);
  // Prefetch: warm the first page's thumbnails so the Feed grid paints from the cache when it opens.
  useEffect(() => {
    for (const s of first ?? []) new Image().src = s.thumbUrl;
  }, [first]);
  return (
    <Link to="/feed" className="mx-auto flex min-h-14 flex-col items-center gap-1 px-4 font-semibold">
      <span className="flex items-center gap-2">
        {thumbs.length > 0 && (
          <span className="flex" aria-hidden>
            {thumbs.map((s, i) => (
              <img key={s.id} src={s.thumbUrl} alt="" className={cn("size-6 rounded-md border-2 border-cam object-cover", i > 0 && "-ml-2")} />
            ))}
          </span>
        )}
        Feed
      </span>
      <ChevronDown className="size-5" aria-hidden />
    </Link>
  );
}

/**
 * Snap home: a full-screen camera with three controls on top (you, friends, Feed). After the shot the photo stays
 * in the same frame for a caption, an optional recipe or place, and Send.
 */
export function SnapHome({ store = draftStore }: { store?: DraftStore }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const friendsOn = useFeature("friends");
  const { user } = useSession();
  const navigate = useNavigate();
  const swipe = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    void store.get().then((d) => {
      if (!live) return;
      setDraft(d);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [store]);

  async function pick(file: File) {
    const d: Draft = {
      clientId: newClientId(),
      file,
      fileName: file.name,
      caption: "",
      eatenOut: false,
      dishName: "",
      place: "",
      recipe: null,
      createdAt: Date.now(),
    };
    await store.put(d);
    setDraft(d);
    setComposing(true);
  }

  async function discard() {
    await store.clear();
    setDraft(null);
    setComposing(false);
  }

  if (draft && composing) {
    return <Composer key={draft.clientId} draft={draft} store={store} onDone={() => setDraft(null)} onDiscard={() => void discard()} />;
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!(e.target as HTMLElement).closest("button, a, input, label, video")) swipe.current = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (swipe.current !== null && swipe.current - e.clientY >= SWIPE_PX) navigate("/feed");
    swipe.current = null;
  };

  return (
    <div className="flex flex-1 flex-col px-4 pt-3.5 pb-5" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <h1 className="sr-only">Snap</h1>
      <ThreeUp
        className="h-12"
        left={
          <button type="button" aria-label="Menu" className="rounded-full ring-2 ring-cam-accent ring-offset-2 ring-offset-cam" onClick={() => setMenu(true)}>
            <Avatar name={user?.name ?? "?"} tone="you" className="size-11 text-base" />
          </button>
        }
        center={friendsOn && <FriendsPill onClick={() => setFriendsOpen(true)} />}
        right={
          <Link to="/feed" aria-label="Feed" className={camButtonSm}>
            <LayoutGrid className="size-5" aria-hidden />
          </Link>
        }
      />
      {loaded && draft && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-full bg-cam-chip py-1.5 pl-4 pr-1.5 text-sm">
          <span>A Snap wasn't sent.</span>
          <button type="button" className="min-h-11 rounded-full bg-cam-accent px-4 font-semibold text-cam-accent-ink" onClick={() => setComposing(true)}>
            Open
          </button>
          <button type="button" className="min-h-11 rounded-full px-3 font-semibold" onClick={() => void discard()}>
            Discard
          </button>
        </div>
      )}
      <div className="flex-1" />
      <CameraCapture onPick={(f) => void pick(f)} />
      <div className="flex-1" />
      <ThreeUp
        className="px-3"
        left={
          <Link to="/recipes" aria-label="Recipes" className={cn(camChip, "min-h-12")}>
            <BookOpen className="size-4" aria-hidden />
            Recipes
          </Link>
        }
        center={<FeedHandle />}
      />
      <MenuSheet open={menu} onOpenChange={setMenu} />
      {friendsOn && <FriendsSheet open={friendsOpen} onOpenChange={setFriendsOpen} />}
    </div>
  );
}

/** 16 px text: iOS Safari zooms the page in on focus for smaller inputs and leaves it wider than the screen. */
const darkInput =
  "min-h-11 w-full rounded-xl border-0 bg-cam-chip px-3 text-base text-cam-ink placeholder:text-cam-muted focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]";

function Composer({ draft, store, onDone, onDiscard }: { draft: Draft; store: DraftStore; onDone: () => void; onDiscard: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const send = useSendSnap();
  const friends = useFriends();
  const friendsOn = useFeature("friends");
  const [caption, setCaption] = useState(draft.caption);
  const [eatenOut, setEatenOut] = useState(draft.eatenOut);
  const [dishName, setDishName] = useState(draft.dishName);
  const [place, setPlace] = useState(draft.place);
  const [recipe, setRecipe] = useState(draft.recipe ?? null);
  const [picking, setPicking] = useState(false);
  const preview = useMemo(() => URL.createObjectURL(draft.file), [draft.file]);
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);

  const err = send.error instanceof ApiRequestError ? send.error : send.error ? new ApiRequestError(0, "network", "") : null;
  const permanent = !!err && PERMANENT.has(err.status);
  const n = friends.data?.items?.length;

  async function submit() {
    const next: Draft = { ...draft, caption, eatenOut, dishName, place, recipe };
    // Saved first, so a failed or interrupted send leaves it to retry with the same clientId.
    await store.put(next);
    send.mutate(next, {
      onSuccess: async () => {
        await store.clear();
        onDone();
        toast("Sent");
        navigate("/feed");
      },
    });
  }

  return (
    <form
      className="flex flex-1 flex-col px-4 pt-3.5 pb-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ThreeUp className="h-12" center={<h1 className="text-base font-semibold">New Snap</h1>} />
      <div className="flex-1" />
      <PhotoFrame>
        <img src={preview} alt="Your photo" className="size-full object-cover" />
        <label htmlFor="snap-caption" className="sr-only">
          Caption
        </label>
        <input
          id="snap-caption"
          value={caption}
          maxLength={SNAP_CAPTION_MAX}
          placeholder="Add a caption"
          onChange={(e) => setCaption(e.target.value)}
          className={cn(captionPill, "w-60 placeholder:text-cam-ink/85 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]")}
        />
      </PhotoFrame>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {!eatenOut && (
          <button type="button" aria-pressed={!!recipe} className={cn(camChip, "max-w-full")} onClick={() => setPicking(true)}>
            <BookOpen className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{recipe ? recipe.name : "Recipe"}</span>
          </button>
        )}
        {recipe && !eatenOut && (
          <button type="button" aria-label="Remove recipe" className={camButtonSm} onClick={() => setRecipe(null)}>
            <X className="size-4" aria-hidden />
          </button>
        )}
        <button type="button" aria-pressed={eatenOut} className={camChip} onClick={() => setEatenOut((v) => !v)}>
          <MapPin className="size-4" aria-hidden />
          Eaten out
        </button>
      </div>
      {eatenOut && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-cam-muted">
            Dish
            <input className={darkInput} maxLength={SNAP_DISH_NAME_MAX} value={dishName} onChange={(e) => setDishName(e.target.value)} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-cam-muted">
            Place
            <input className={darkInput} maxLength={SNAP_PLACE_MAX} value={place} onChange={(e) => setPlace(e.target.value)} />
          </label>
        </div>
      )}
      {err && (
        <p role="alert" className="mt-3 text-center text-sm font-medium text-danger">
          {permanent ? err.message : "Couldn't send. Your Snap is saved on this device. Try again."}
        </p>
      )}

      <ThreeUp
        className="mt-7 px-3"
        left={
          <button type="button" aria-label="Discard" className={camButton} onClick={onDiscard}>
            <X className="size-6" aria-hidden />
          </button>
        }
        center={
          <button
            type="submit"
            aria-label={err && !permanent ? "Retry" : "Send"}
            disabled={send.isPending || (permanent && err?.status === 413)}
            aria-busy={send.isPending || undefined}
            className="inline-flex size-22 items-center justify-center rounded-full bg-cam-accent text-cam-accent-ink disabled:opacity-60"
          >
            <Send className={cn("size-8", send.isPending && "motion-safe:animate-pulse")} aria-hidden />
          </button>
        }
        right={
          <a href={preview} download={draft.fileName || "snap.jpg"} aria-label="Save photo" className={camButton}>
            <Download className="size-6" aria-hidden />
          </a>
        }
      />
      <div className="flex-1" />
      <p className="text-center text-sm text-cam-muted">
        {!friendsOn ? "Only you see it." : n === undefined ? "All your friends see it." : n === 0 ? "No friends yet: only you see it." : `All ${n} of your friends see it.`}
      </p>
      <RecipePicker
        open={picking}
        onOpenChange={setPicking}
        initialQuery=""
        onPick={(r) => {
          setRecipe({ id: r.id, name: r.name });
          setPicking(false);
        }}
      />
    </form>
  );
}
