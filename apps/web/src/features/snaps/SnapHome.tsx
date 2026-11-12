import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { SNAP_CAPTION_MAX, SNAP_DISH_NAME_MAX, SNAP_PLACE_MAX } from "@meally/shared";
import { ApiRequestError } from "../../lib/api";
import { Button, Field, Input, Sheet, Textarea, useToast } from "../../ui";
import { CameraCapture } from "./CameraCapture";
import { draftStore, newClientId, type Draft, type DraftStore } from "./drafts";
import { useSendSnap } from "./api";

/** Errors a retry can't fix: the photo itself or a field is wrong. */
const PERMANENT = new Set([400, 413, 415]);

/** Snap home: camera first, the Feed one tap away, and a banner for a Snap that didn't go out. */
export function SnapHome({ store = draftStore }: { store?: DraftStore }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [composing, setComposing] = useState(false);

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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Snap</h1>
        <Link to="/feed" className="inline-flex min-h-11 items-center rounded-md px-3 font-medium text-accent underline">
          Feed
        </Link>
      </div>
      {loaded && draft && !composing && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised p-3 text-sm">
          <span>You have a Snap that wasn't sent.</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setComposing(true)}>
              Open
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void discard()}>
              Discard
            </Button>
          </span>
        </div>
      )}
      <CameraCapture active={!composing} onPick={(f) => void pick(f)} />
      {draft && <Composer key={draft.clientId} draft={draft} open={composing} store={store} onOpenChange={setComposing} onDone={() => setDraft(null)} onDiscard={() => void discard()} />}
    </div>
  );
}

function Composer({
  draft,
  open,
  store,
  onOpenChange,
  onDone,
  onDiscard,
}: {
  draft: Draft;
  open: boolean;
  store: DraftStore;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  onDiscard: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const send = useSendSnap();
  const [caption, setCaption] = useState(draft.caption);
  const [eatenOut, setEatenOut] = useState(draft.eatenOut);
  const [dishName, setDishName] = useState(draft.dishName);
  const [place, setPlace] = useState(draft.place);
  const preview = useMemo(() => URL.createObjectURL(draft.file), [draft.file]);
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);

  const err = send.error instanceof ApiRequestError ? send.error : send.error ? new ApiRequestError(0, "network", "") : null;
  const permanent = !!err && PERMANENT.has(err.status);

  async function submit() {
    const next: Draft = { ...draft, caption, eatenOut, dishName, place };
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
    <Sheet open={open} onOpenChange={onOpenChange} title="New Snap" description="Add a caption if you like, then send.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <img src={preview} alt="Your photo" className="max-h-64 w-full rounded-lg object-cover" />
        <Field label="Caption">
          <Textarea rows={2} maxLength={SNAP_CAPTION_MAX} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="size-5" checked={eatenOut} onChange={(e) => setEatenOut(e.target.checked)} />
          Eaten out
        </label>
        {eatenOut && (
          <>
            <Field label="Dish">
              <Input maxLength={SNAP_DISH_NAME_MAX} value={dishName} onChange={(e) => setDishName(e.target.value)} />
            </Field>
            <Field label="Place">
              <Input maxLength={SNAP_PLACE_MAX} value={place} onChange={(e) => setPlace(e.target.value)} />
            </Field>
          </>
        )}
        {err && (
          <p role="alert" className="text-sm text-danger">
            {permanent ? err.message : "Couldn't send. Your Snap is saved on this device. Try again."}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={send.isPending} disabled={permanent && err?.status === 413}>
            {err && !permanent ? "Retry" : "Send"}
          </Button>
          <Button variant="secondary" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
