import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError, postJson } from "../../lib/api";
import { Button, Skeleton, useToast } from "../../ui";
import { useSession } from "../auth/useSession";
import { useFeature } from "../features/FeaturesProvider";

interface BackupItem {
  name: string;
  size: number;
  createdAt: number;
}
interface BackupList {
  items: BackupItem[];
  schedule: { hours: number; keep: number };
}
const KEY = ["admin", "backups"] as const;
const errMsg = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Something went wrong. Try again.");

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (ms: number) => new Date(ms).toLocaleString();

/** Downloads go through plain links: the session cookie authenticates them and the browser streams the zip to disk. */
const LinkButton = ({ href, children }: { href: string; children: string }) => (
  <a
    href={href}
    download
    className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-raised px-4 text-sm font-medium text-ink hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent"
  >
    {children}
  </a>
);

function Backups() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: KEY, queryFn: () => api<BackupList>("/admin/backups") });
  const create = useMutation({
    mutationFn: () => postJson<BackupItem>("/admin/backups"),
    onSuccess: async () => {
      toast("Backup created", "success");
      await qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast(errMsg(e), "danger"),
  });
  const del = useMutation({
    mutationFn: (name: string) => api(`/admin/backups/${name}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast(errMsg(e), "danger"),
  });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">Instance backups</h3>
      {list.isPending ? (
        <Skeleton className="h-16" />
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger">
          Could not load backups.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {list.data.schedule.hours > 0
              ? `Automatic backup every ${list.data.schedule.hours} h, keeping the newest ${list.data.schedule.keep}.`
              : "Automatic backups are off."}{" "}
            Set by the server's environment. Copy backups off this machine too.
          </p>
          <div>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create now"}
            </Button>
          </div>
          {list.data.items.length === 0 ? (
            <p className="text-sm text-muted">No backups yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
              {list.data.items.map((b) => (
                <li key={b.name} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="text-sm">
                    <span className="block font-medium">{when(b.createdAt)}</span>
                    <span className="text-muted">{size(b.size)}</span>
                  </span>
                  <span className="flex gap-2">
                    <LinkButton href={`/api/v1/admin/backups/${b.name}`}>Download</LinkButton>
                    <Button variant="ghost" aria-label={`Delete backup from ${when(b.createdAt)}`} onClick={() => del.mutate(b.name)} disabled={del.isPending}>
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function ExportBackupsSection() {
  const { user } = useSession();
  const backups = useFeature("backups");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h3 className="font-medium">Download my recipes</h3>
        <p className="text-sm text-muted">A zip with one file per recipe, plus photos.</p>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/api/v1/export/recipes?format=jsonld">JSON-LD</LinkButton>
          <LinkButton href="/api/v1/export/recipes?format=markdown">Markdown</LinkButton>
        </div>
      </div>
      {backups && user?.role === "admin" && <Backups />}
    </div>
  );
}
