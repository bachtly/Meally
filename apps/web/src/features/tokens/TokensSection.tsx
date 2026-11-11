import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import type { ApiToken, TokenScope } from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";
import { Button, Dialog, Field, Input, Skeleton, Textarea, useToast } from "../../ui";

const KEY = ["api-tokens"] as const;
const EXPIRY = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];
const SCOPES: { value: TokenScope; label: string }[] = [
  { value: "read", label: "Read only" },
  { value: "write", label: "Read and write" },
];
const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
const select = "min-h-11 w-full rounded-md border border-line bg-raised px-3 text-base";

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TokenScope>("read");
  const [expiry, setExpiry] = useState("90");
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => postJson<{ token: string }>("/tokens", { name, scope, expiresInDays: expiry === "never" ? null : Number(expiry) }),
    onSuccess: (r) => {
      setSecret(r.token);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast(e instanceof ApiRequestError ? e.message : "Could not create the token", "danger"),
  });
  const close = (o: boolean) => {
    if (!o) {
      setSecret(null);
      setName("");
    }
    onOpenChange(o);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret!);
      toast("Token copied", "success");
    } catch {
      toast("Could not copy; select the token and copy it", "danger");
    }
  };
  return (
    <Dialog open={open} onOpenChange={close} title={secret ? "Your new token" : "Create token"} description={secret ? "Use it as a Bearer token." : "Scripts use a token to act as you."}>
      {secret ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="rounded-md bg-sunken p-3 text-sm">
            Copy this token now. You will not be able to see it again.
          </p>
          <label className="text-sm font-medium" htmlFor="new-token">
            Token
          </label>
          {/* A wrapping textarea keeps the whole token readable at 360px; 16px text stops iOS zooming on focus. */}
          <Textarea id="new-token" readOnly rows={2} value={secret} onFocus={(e) => e.target.select()} spellCheck={false} className="resize-none break-all font-mono" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={copy}>
              <Copy className="size-4" aria-hidden />
              Copy
            </Button>
            <Button onClick={() => close(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="off" enterKeyHint="done" placeholder="Home server script" />
          </Field>
          <Field label="Access">
            <select value={scope} onChange={(e) => setScope(e.target.value as TokenScope)} className={select}>
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expires after">
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={select}>
              {EXPIRY.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function TokensSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const tokens = useQuery({ queryKey: KEY, queryFn: () => api<{ items: ApiToken[] }>("/tokens").then((r) => r.items) });
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>(`/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: () => toast("Could not revoke the token", "danger"),
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Tokens let scripts use the API as you.</p>
      {tokens.isPending ? (
        <Skeleton className="h-12" />
      ) : tokens.isError ? (
        <p className="text-sm text-danger">Could not load tokens.</p>
      ) : tokens.data.length === 0 ? (
        <p className="text-sm text-muted">No tokens yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {tokens.data.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{t.name}</p>
                <p className="text-muted">
                  <span className="font-mono">{t.prefix}…</span> · {t.scope === "read" ? "Read only" : "Read and write"} ·{" "}
                  {t.lastUsedAt ? `used ${fmt(t.lastUsedAt)}` : "never used"} · {t.expiresAt ? `expires ${fmt(t.expiresAt)}` : "no expiry"}
                </p>
              </div>
              <Button variant="ghost" size="sm" aria-label={`Revoke ${t.name}`} onClick={() => setRevoking(t)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button onClick={() => setCreating(true)}>Create token</Button>
      </div>
      <CreateDialog open={creating} onOpenChange={setCreating} />
      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} title={`Revoke ${revoking?.name ?? ""}?`} description="Anything using this token stops working right away.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              revoke.mutate(revoking!.id);
              setRevoking(null);
            }}
          >
            Revoke
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
