import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Ellipsis } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { HouseholdDetail, HouseholdInvite, HouseholdMember, HouseholdRole } from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";
import {
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Skeleton,
  useToast,
} from "../../ui";
import { useSession } from "../auth/useSession";

const KEY = ["household"] as const;
const INVITES = ["household", "invites"] as const;
const errMsg = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Something went wrong. Try again.");

export function useHousehold() {
  return useQuery({ queryKey: KEY, queryFn: () => api<HouseholdDetail>("/household") });
}

function useAct() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      await qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => toast(errMsg(e), "danger"),
  });
}

function RenameForm({ name }: { name: string }) {
  const act = useAct();
  const toast = useToast();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (v && v !== name)
      act.mutate(() => api("/household", { method: "PATCH", body: JSON.stringify({ name: v }) }).then(() => toast("Household renamed", "success")));
  };
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div className="flex-1">
        <Field label="Household name">
          <Input name="name" defaultValue={name} maxLength={80} />
        </Field>
      </div>
      <Button type="submit" variant="secondary" loading={act.isPending}>
        Save
      </Button>
    </form>
  );
}

function MemberRow({ m, isOwner }: { m: HouseholdMember; isOwner: boolean }) {
  const act = useAct();
  const [confirm, setConfirm] = useState(false);
  const setRole = (role: HouseholdRole) =>
    act.mutate(() => api(`/household/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role }) }));
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {m.name}
          {m.you && <span className="text-muted"> (you)</span>}
        </p>
        <p className="truncate text-sm text-muted">{m.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role === "owner" ? "Owner" : "Member"}</Badge>
        {isOwner && !m.you && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label={`Actions for ${m.name}`}>
                <Ellipsis className="size-5" aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {m.role === "member" ? (
                <DropdownMenuItem onSelect={() => setRole("owner")}>Make owner</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setRole("member")}>Make member</DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setConfirm(true)}>Remove from household</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm} title={`Remove ${m.name}?`} description="They keep their account and get a new, empty household. They lose access to your recipes and lists.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirm(false);
              act.mutate(() => api(`/household/members/${m.id}`, { method: "DELETE" }));
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>
    </li>
  );
}

const expiryNote = (iso: string) => `Expires ${new Date(iso).toLocaleDateString()}`;

function InviteBox() {
  const qc = useQueryClient();
  const toast = useToast();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const create = useMutation({
    mutationFn: () => postJson<{ path: string; expiresAt: string }>("/household/invites", {}),
    onSuccess: (r) => {
      setLink({ url: `${window.location.origin}${r.path}`, expiresAt: r.expiresAt });
      void qc.invalidateQueries({ queryKey: INVITES });
    },
    onError: (e) => toast(errMsg(e), "danger"),
  });
  const copy = () =>
    link && navigator.clipboard?.writeText(link.url).then(() => toast("Link copied", "success"), () => toast("Copy failed. Select the link and copy it.", "danger"));
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" className="self-start" loading={create.isPending} onClick={() => create.mutate()}>
        Invite someone
      </Button>
      {link && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-3">
          <label htmlFor="invite-link" className="text-sm font-medium">
            Invite link
          </label>
          <div className="flex gap-2">
            <Input id="invite-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <IconButton aria-label="Copy link" onClick={copy}>
              <Copy className="size-5" aria-hidden />
            </IconButton>
          </div>
          <p className="text-sm text-muted">
            {expiryNote(link.expiresAt)}. It works once, and this is the only time you will see it.
          </p>
        </div>
      )}
    </div>
  );
}

function PendingInvites() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: INVITES, queryFn: () => api<{ items: HouseholdInvite[] }>("/household/invites") });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/household/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES }),
    onError: (e) => toast(errMsg(e), "danger"),
  });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Pending invites</h3>
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm">
              {i.email ?? "Invite link"} · {expiryNote(i.expiresAt)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HouseholdSection() {
  const q = useHousehold();
  const { user } = useSession();
  const act = useAct();
  const [leaving, setLeaving] = useState(false);
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) {
    return (
      <p role="alert" className="text-danger">
        Couldn't load your household.{" "}
        <button className="underline" onClick={() => void q.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  const isOwner = user?.householdRole === "owner";
  const { household, members } = q.data;
  return (
    <div className="flex flex-col gap-5">
      {isOwner ? <RenameForm key={household.name} name={household.name} /> : <p className="text-lg font-medium">{household.name}</p>}
      <ul className="divide-y divide-line" aria-label="Members">
        {members.map((m) => (
          <MemberRow key={m.id} m={m} isOwner={isOwner} />
        ))}
      </ul>
      {isOwner && (
        <>
          <InviteBox />
          <PendingInvites />
        </>
      )}
      {members.length > 1 && (
        <Button variant="danger" className="self-start" onClick={() => setLeaving(true)}>
          Leave household
        </Button>
      )}
      <Dialog open={leaving} onOpenChange={setLeaving} title="Leave this household?" description="You get a new, empty household. Recipes and lists stay with the household you leave.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setLeaving(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setLeaving(false);
              act.mutate(() => postJson("/household/leave"));
            }}
          >
            Leave
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
