import { useState } from "react";
import { Button } from "../../ui";
import { Textarea } from "../../ui/Form";
import { useTimelineMutations } from "./api";

/** Cook-mode finish screen: logs a "made" event, then offers an optional note. */
export function LogMade({ slug }: { slug: string }) {
  const { post, edit } = useTimelineMutations(slug);
  const [id, setId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  if (!id)
    return (
      <Button variant="secondary" loading={post.isPending} onClick={() => post.mutate({ kind: "made" }, { onSuccess: (ev) => setId(ev.id) })}>
        Log that I made it
      </Button>
    );
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-left">
      <p className="text-center text-success" role="status">
        Logged. Nice work.
      </p>
      {saved ? (
        <p className="text-center text-muted">Note saved.</p>
      ) : (
        <>
          <Textarea aria-label="Optional note" rows={2} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="secondary" disabled={!note.trim()} loading={edit.isPending} onClick={() => edit.mutate({ id, text: note.trim() }, { onSuccess: () => setSaved(true) })}>
            Save note
          </Button>
        </>
      )}
    </div>
  );
}
