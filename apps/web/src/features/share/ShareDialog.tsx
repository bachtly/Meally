import { Copy, Share2 } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { SHARE_NOTE_MAX, SHARE_TITLE_MAX } from "@meally/shared";
import { Button, Dialog, Field, Input, Skeleton, Switch, Textarea, useToast } from "../../ui";
import { useSession } from "../auth/useSession";
import { useCreateShare, useRevokeShare, useShares, type ShareTarget } from "./api";

const EXPIRY = [
  { value: "7", label: "7 days" },
  { value: "1", label: "1 day" },
  { value: "30", label: "30 days" },
  { value: "never", label: "Never" },
];
export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

function copyText(target: ShareTarget) {
  if (target.kind === "recipe") return { title: "Share this recipe", description: "Anyone with the link can view this recipe and save a copy to their own Meally." };
  if (target.kind === "cookbook")
    return { title: "Share this cookbook", description: "Anyone with the link sees this cookbook as it is now, including recipes you add later, and can save copies." };
  const n = target.slugs.length;
  return { title: `Share ${n} ${n === 1 ? "recipe" : "recipes"}`, description: "Anyone with the link can view these recipes and save copies to their own Meally." };
}

/** Creates a link to one recipe, a hand-picked set, or a cookbook. The URL is shown once. */
export function ShareDialog({ target, open, onOpenChange, onCreated }: { target: ShareTarget; open: boolean; onOpenChange: (o: boolean) => void; onCreated?: () => void }) {
  const toast = useToast();
  const { user } = useSession();
  const create = useCreateShare(target);
  const [expiry, setExpiry] = useState("7");
  const [showName, setShowName] = useState(true);
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const nameId = useId();
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const text = copyText(target);
  const shareTitle = target.kind === "set" ? title.trim() || text.title.replace(/^Share /, "") : target.name;

  const make = () =>
    create.mutate(
      { expiresInDays: expiry === "never" ? null : (Number(expiry) as 1 | 7 | 30), showName, note: note.trim() || null, title: title.trim() || null },
      { onSuccess: (r) => setUrl(r.url), onError: () => toast("Could not create the link", "danger") },
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url!);
      toast("Link copied", "success");
    } catch {
      toast("Could not copy; select the link and copy it", "danger");
    }
  };
  const close = (o: boolean) => {
    if (!o) {
      if (url) onCreated?.();
      setUrl(null);
      setNote("");
      setTitle("");
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close} title={text.title} description={text.description}>
      <div className="flex flex-col gap-4">
        {url ? (
          <div className="flex flex-col gap-2 rounded-md bg-sunken p-3">
            <label className="text-sm font-medium" htmlFor="share-url">
              Your link (shown only once)
            </label>
            <input id="share-url" type="url" readOnly value={url} onFocus={(e) => e.target.select()} className="min-h-11 w-full min-w-0 rounded-md border border-line bg-raised px-3 text-base" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={copy}>
                <Copy className="size-4" aria-hidden />
                Copy
              </Button>
              {canShare && (
                <Button variant="secondary" onClick={() => void navigator.share({ title: shareTitle, text: note.trim() || undefined, url }).catch(() => undefined)}>
                  <Share2 className="size-4" aria-hidden />
                  Share
                </Button>
              )}
              <Button variant="ghost" onClick={() => setUrl(null)}>
                Make another
              </Button>
            </div>
          </div>
        ) : (
          <>
            {target.kind === "set" && (
              <Field label="Name (optional)" hint="Shown at the top of the link, e.g. Weekend baking.">
                <Input value={title} maxLength={SHARE_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
              </Field>
            )}
            <Field label="Note (optional)" hint={`${note.length}/${SHARE_NOTE_MAX}`}>
              <Textarea value={note} maxLength={SHARE_NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Try the lemon one first" />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div>
                <label htmlFor={nameId} className="text-sm font-medium">
                  Show my name
                </label>
                <p className="text-sm text-muted">{showName ? `Shown as "Shared by ${user?.name ?? "you"}"` : "Your name won't be shown"}</p>
              </div>
              <Switch id={nameId} checked={showName} onCheckedChange={setShowName} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Link expires after
                <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="min-h-11 rounded-md border border-line bg-raised px-3 text-base font-normal">
                  {EXPIRY.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button onClick={make} loading={create.isPending}>
                Create link
              </Button>
            </div>
          </>
        )}
        {target.kind === "recipe" ? (
          <RecipeLinks slug={target.slug} open={open} />
        ) : (
          <p className="text-sm text-muted">
            <Link to="/settings#shared-links" className="text-accent underline" onClick={() => close(false)}>
              See all your shared links
            </Link>
          </p>
        )}
      </div>
    </Dialog>
  );
}

function RecipeLinks({ slug, open }: { slug: string; open: boolean }) {
  const toast = useToast();
  const shares = useShares(slug, open);
  const revoke = useRevokeShare();
  return (
    <section aria-labelledby="active-links-h">
      <h3 id="active-links-h" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        Active links
      </h3>
      {shares.isPending ? (
        <Skeleton className="h-12" />
      ) : shares.isError ? (
        <p className="text-sm text-danger">Could not load links.</p>
      ) : shares.data.length === 0 ? (
        <p className="text-sm text-muted">No active links.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {shares.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                Created {fmtDate(s.createdAt)} · {s.expiresAt ? `expires ${fmtDate(s.expiresAt)}` : "never expires"} · {s.viewCount} {s.viewCount === 1 ? "view" : "views"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                loading={revoke.isPending && revoke.variables === s.id}
                onClick={() => revoke.mutate(s.id, { onError: () => toast("Could not revoke the link", "danger") })}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
