import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { webhookEvents, type Webhook, type WebhookDelivery, type WebhookWithSecret } from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";
import { Button, Dialog, Field, Input, Sheet, Skeleton, useToast } from "../../ui";
import { useSession } from "../auth/useSession";

const KEY = ["webhooks"] as const;
const LABELS: Record<string, string> = {
  "recipe.created": "Recipe created",
  "recipe.updated": "Recipe updated",
  "recipe.deleted": "Recipe deleted",
  "mealplan.today": "Daily meal plan digest",
  "shopping.item_checked": "Shopping item checked",
};
const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

function status(w: Webhook): { label: string; cls: string } {
  if (!w.enabled) return { label: "Disabled", cls: "bg-danger" };
  if (w.lastDeliveryAt === null) return { label: "No deliveries yet", cls: "bg-muted" };
  if (w.failureCount > 0) return { label: `Failing (${w.failureCount} in a row)`, cls: "bg-danger" };
  return { label: "Healthy", cls: "bg-success" };
}

function Secret({ secret }: { secret: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast("Secret copied", "success");
    } catch {
      toast("Could not copy; select the secret and copy it", "danger");
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="wh-secret">
        Signing secret
      </label>
      <div className="flex gap-2">
        <input id="wh-secret" readOnly value={secret} onFocus={(e) => e.target.select()} className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-raised px-3 font-mono text-sm" />
        <Button type="button" variant="secondary" onClick={copy}>
          <Copy className="size-4" aria-hidden />
          Copy
        </Button>
      </div>
    </div>
  );
}

function EditDialog({ hook, open, onOpenChange }: { hook: Webhook | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(hook?.name ?? "");
  const [url, setUrl] = useState(hook?.url ?? "");
  const [events, setEvents] = useState<string[]>(hook?.events ?? ["recipe.created"]);
  const [dailyAt, setDailyAt] = useState(hook?.dailyAt ?? "07:00");
  const [tz, setTz] = useState(hook?.tz ?? localTz());
  const [created, setCreated] = useState<WebhookWithSecret | null>(null);
  const secret = useQuery({ queryKey: [...KEY, hook?.id, "secret"], enabled: open && !!hook, queryFn: () => api<WebhookWithSecret>(`/webhooks/${hook!.id}`) });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, url, events, ...(events.includes("mealplan.today") ? { dailyAt, tz } : {}), ...(hook ? { enabled: true } : {}) };
      return hook ? api<WebhookWithSecret>(`/webhooks/${hook.id}`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) : postJson<WebhookWithSecret>("/webhooks", body);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEY });
      if (hook) onOpenChange(false);
      else setCreated(r);
    },
    onError: (e) => toast(e instanceof ApiRequestError ? e.message : "Could not save the webhook", "danger"),
  });
  const toggle = (ev: string) => setEvents((cur) => (cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={created ? "Webhook created" : hook ? "Edit webhook" : "Add webhook"} description={created ? "Use the secret to verify each delivery." : "Meally sends a signed POST to this URL."}>
      {created ? (
        <div className="flex flex-col gap-3">
          <Secret secret={created.secret} />
          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </Field>
          <Field label="URL">
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://example.com/hook" />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Events</legend>
            {webhookEvents.map((ev) => (
              <label key={ev} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={events.includes(ev)} onChange={() => toggle(ev)} />
                {LABELS[ev]}
              </label>
            ))}
          </fieldset>
          {events.includes("mealplan.today") && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Digest time">
                <Input type="time" value={dailyAt} onChange={(e) => setDailyAt(e.target.value)} required />
              </Field>
              <Field label="Time zone">
                <Input value={tz} onChange={(e) => setTz(e.target.value)} required placeholder="Europe/Berlin" />
              </Field>
            </div>
          )}
          {hook && secret.data && <Secret secret={secret.data.secret} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!name.trim() || !url.trim() || events.length === 0}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function Deliveries({ hook, onClose }: { hook: Webhook | null; onClose: () => void }) {
  const q = useQuery({ queryKey: [...KEY, hook?.id, "deliveries"], enabled: !!hook, queryFn: () => api<{ items: WebhookDelivery[] }>(`/webhooks/${hook!.id}/deliveries`).then((r) => r.items) });
  return (
    <Sheet open={!!hook} onOpenChange={(o) => !o && onClose()} title="Recent deliveries" description={hook?.name}>
      {q.isPending ? (
        <Skeleton className="h-12" />
      ) : q.isError ? (
        <p className="text-sm text-danger">Could not load deliveries.</p>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted">No deliveries yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {q.data.map((d) => (
            <li key={d.id} className="py-2 text-sm">
              <p className="font-medium">
                {d.ok ? "Delivered" : "Failed"} · {d.event}
              </p>
              <p className="text-muted">
                {fmt(d.createdAt)} · {d.statusCode ?? "no response"} · {d.durationMs} ms{d.error ? ` · ${d.error}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function WebhooksSection() {
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<{ hook: Webhook | null } | null>(null);
  const [viewing, setViewing] = useState<Webhook | null>(null);
  const isOwner = user?.householdRole === "owner";
  const q = useQuery({ queryKey: KEY, enabled: isOwner, queryFn: () => api<{ items: Webhook[] }>("/webhooks").then((r) => r.items) });
  const test = useMutation({
    mutationFn: (id: string) => postJson<{ ok: boolean; statusCode: number | null; error: string | null }>(`/webhooks/${id}/test`),
    onSuccess: (r) => {
      toast(r.ok ? "Test delivered" : `Test failed${r.error ? `: ${r.error}` : ""}`, r.ok ? "success" : "danger");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => toast("Could not send the test", "danger"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: () => toast("Could not delete the webhook", "danger"),
  });
  if (!isOwner) return <p className="text-sm text-muted">Only household owners can manage webhooks.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Call a URL when things happen in your household.</p>
      {q.isPending ? (
        <Skeleton className="h-12" />
      ) : q.isError ? (
        <p className="text-sm text-danger">Could not load webhooks.</p>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted">No webhooks yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {q.data.map((w) => {
            const s = status(w);
            return (
              <li key={w.id} className="flex flex-col gap-2 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 shrink-0 rounded-full ${s.cls}`} role="img" aria-label={s.label} title={s.label} />
                  <p className="font-medium">{w.name}</p>
                  <span className="text-muted">{s.label}</span>
                </div>
                <p className="break-all text-muted">{w.url}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" aria-label={`Send test to ${w.name}`} loading={test.isPending && test.variables === w.id} onClick={() => test.mutate(w.id)}>
                    Send test
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Deliveries for ${w.name}`} onClick={() => setViewing(w)}>
                    Deliveries
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Edit ${w.name}`} onClick={() => setEditing({ hook: w })}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${w.name}`} onClick={() => confirm(`Delete ${w.name}?`) && remove.mutate(w.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button onClick={() => setEditing({ hook: null })}>Add webhook</Button>
      </div>
      {editing && <EditDialog key={editing.hook?.id ?? "new"} hook={editing.hook} open onOpenChange={(o) => !o && setEditing(null)} />}
      <Deliveries hook={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
