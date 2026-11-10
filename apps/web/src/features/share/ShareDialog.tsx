import { Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Skeleton, useToast } from "../../ui";
import { useCreateShare, useRevokeShare, useShares } from "./api";

const EXPIRY = [
  { value: "7", label: "7 days" },
  { value: "1", label: "1 day" },
  { value: "30", label: "30 days" },
  { value: "never", label: "Never" },
];
const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

export function ShareDialog({ slug, name, open, onOpenChange }: { slug: string; name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const shares = useShares(slug, open);
  const create = useCreateShare(slug);
  const revoke = useRevokeShare(slug);
  const [expiry, setExpiry] = useState("7");
  const [url, setUrl] = useState<string | null>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const make = () =>
    create.mutate(expiry === "never" ? null : (Number(expiry) as 1 | 7 | 30), {
      onSuccess: (r) => setUrl(r.url),
      onError: () => toast("Could not create the link", "danger"),
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url!);
      toast("Link copied", "success");
    } catch {
      toast("Could not copy; select the link and copy it", "danger");
    }
  };
  const close = (o: boolean) => {
    if (!o) setUrl(null);
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close} title="Share this recipe" description="Anyone with the link can view this recipe, without signing in.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Link expires after
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="min-h-11 rounded-md border border-line bg-raised px-3">
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
        {url && (
          <div className="flex flex-col gap-2 rounded-md bg-sunken p-3">
            <label className="text-sm font-medium" htmlFor="share-url">
              Your link (shown only once)
            </label>
            <input id="share-url" readOnly value={url} onFocus={(e) => e.target.select()} className="min-h-11 rounded-md border border-line bg-raised px-3 text-sm" />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={copy}>
                <Copy className="size-4" aria-hidden />
                Copy
              </Button>
              {canShare && (
                <Button variant="secondary" onClick={() => void navigator.share({ title: name, url }).catch(() => undefined)}>
                  <Share2 className="size-4" aria-hidden />
                  Share
                </Button>
              )}
            </div>
          </div>
        )}
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
                    Created {fmt(s.createdAt)} · {s.expiresAt ? `expires ${fmt(s.expiresAt)}` : "never expires"} · {s.viewCount} {s.viewCount === 1 ? "view" : "views"}
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
      </div>
    </Dialog>
  );
}
