import { Link } from "react-router";
import type { ShareSummary } from "@meally/shared";
import { Button, Skeleton, useToast } from "../../ui";
import { useAllShares, useRevokeShare } from "./api";
import { fmtDate } from "./ShareDialog";

function what(s: ShareSummary) {
  if (s.kind === "recipe") return { label: s.title ?? "A recipe", to: s.targetSlug ? `/recipes/${s.targetSlug}` : null, kind: "Recipe" };
  if (s.kind === "cookbook") return { label: s.title ?? "A cookbook", to: s.targetSlug ? `/cookbooks/${s.targetSlug}` : null, kind: "Cookbook" };
  const n = s.count ?? 0;
  return { label: s.title || `${n} ${n === 1 ? "recipe" : "recipes"}`, to: null, kind: s.title ? `${n} ${n === 1 ? "recipe" : "recipes"}` : "Recipes" };
}

/** Every active link you have made, with revoke. */
export function SharedLinksSection() {
  const toast = useToast();
  const q = useAllShares();
  const revoke = useRevokeShare();
  if (q.isPending) return <Skeleton aria-busy="true" className="h-16" />;
  if (q.isError)
    return (
      <p className="text-sm text-danger">
        Could not load your links.{" "}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          Try again
        </button>
      </p>
    );
  if (q.data.length === 0) return <p className="text-sm text-muted">No active links. Share a recipe, a few recipes or a cookbook to see them here.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-raised">
      {q.data.map((s) => {
        const w = what(s);
        return (
          <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{w.to ? <Link to={w.to} className="hover:underline">{w.label}</Link> : w.label}</p>
              <p className="text-sm text-muted">
                {w.kind} · {s.sharedBy ? `as ${s.sharedBy}` : "name hidden"} · {s.expiresAt ? `expires ${fmtDate(s.expiresAt)}` : "never expires"} · {s.viewCount}{" "}
                {s.viewCount === 1 ? "view" : "views"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              loading={revoke.isPending && revoke.variables === s.id}
              onClick={() => revoke.mutate(s.id, { onSuccess: () => toast("Link revoked"), onError: () => toast("Could not revoke the link", "danger") })}
            >
              Revoke
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
