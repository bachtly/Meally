import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { api, ApiRequestError } from "../../lib/api";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "../../ui";
import { useSession } from "../auth/useSession";
import { useFeature } from "../features/FeaturesProvider";

const errMsg = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Something went wrong. Try again.");
const send = <T,>(path: string, body: unknown, method = "PUT") => api<T>(path, { method, body: JSON.stringify(body) });
const bytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : "Never");

const Loading = () => <Skeleton className="h-24" />;
const Failed = ({ what }: { what: string }) => (
  <p role="alert" className="text-sm text-danger">
    Could not load {what}.
  </p>
);

export function AdminPage() {
  const { user } = useSession();
  if (user && user.role !== "admin") return <Navigate to="/recipes" replace />;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="signup">Sign-up</TabsTrigger>
        </TabsList>
        <div className="pt-4">
          <TabsContent value="overview">
            <Overview />
          </TabsContent>
          <TabsContent value="features">
            <Features />
          </TabsContent>
          <TabsContent value="users">
            <Users />
          </TabsContent>
          <TabsContent value="signup">
            <Signup />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ---- overview ----
interface Info {
  version: string;
  nodeVersion: string;
  uptimeSeconds: number;
  dbBytes: number;
  imagesBytes: number;
  counts: { users: number; recipes: number };
  migrations: number;
  dataDir: string;
  backupSchedule: { hours: number; keep: number };
}
function Overview() {
  const q = useQuery({ queryKey: ["admin", "info"], queryFn: () => api<Info>("/admin/info") });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed what="server info" />;
  const i = q.data;
  const s = i.uptimeSeconds;
  const up = s >= 86400 ? `${Math.floor(s / 86400)} d` : s >= 3600 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 60)} min`;
  const cards: [string, string][] = [
    ["Version", i.version],
    ["Node", i.nodeVersion],
    ["Uptime", up],
    ["Database", bytes(i.dbBytes)],
    ["Images", bytes(i.imagesBytes)],
    ["Users", String(i.counts.users)],
    ["Recipes", String(i.counts.recipes)],
    ["Migrations", String(i.migrations)],
    ["Backups", i.backupSchedule.hours > 0 ? `Every ${i.backupSchedule.hours} h, keep ${i.backupSchedule.keep}` : "Off"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([k, v]) => (
          <Card key={k} className="p-4">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="text-lg font-semibold">{v}</dd>
          </Card>
        ))}
      </dl>
      <p className="text-sm text-muted">
        Data folder: <code className="break-all">{i.dataDir}</code>
      </p>
    </div>
  );
}

// ---- features ----
interface Flag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  locked: boolean;
  source: string;
  envVar: string;
  dependsOn: { key: string; label: string }[];
}
const GROUPS: [string, string[]][] = [
  ["Recipes", ["import-url", "import-files", "ingredient-parser", "foods-units", "scaling", "organizers", "cook-mode", "ratings", "timeline", "nutrition", "print"]],
  ["Planning", ["meal-plan", "shopping-lists", "cookbooks"]],
  ["Sharing", ["share-links", "friends", "snaps", "push"]],
  ["Platform", ["backups", "api-tokens", "webhooks", "pwa", "ai"]],
];

function Features() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "features"], queryFn: () => api<{ features: Flag[] }>("/admin/features") });
  const m = useMutation({
    mutationFn: (v: { key: string; enabled: boolean | null }) => send(`/admin/features/${v.key}`, { enabled: v.enabled }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["features"] }), qc.invalidateQueries({ queryKey: ["admin", "features"] })]);
    },
    onError: (e) => toast(errMsg(e), "danger"),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed what="features" />;
  const byKey = new Map(q.data.features.map((f) => [f.key, f]));
  const grouped = new Set(GROUPS.flatMap(([, k]) => k));
  const groups: [string, string[]][] = [...GROUPS, ["Other", q.data.features.filter((f) => !grouped.has(f.key)).map((f) => f.key)]];
  return (
    <div className="flex flex-col gap-6">
      {groups.map(([title, keys]) => {
        const flags = keys.map((k) => byKey.get(k)).filter((f): f is Flag => !!f);
        if (!flags.length) return null;
        return (
          <section key={title} aria-label={title} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            <ul className="flex flex-col gap-2">
              {flags.map((f) => {
                const depOff = f.source === "dependency";
                return (
                  <li key={f.key}>
                    <Card className="flex items-start gap-3 p-4">
                      <Switch
                        aria-label={f.label}
                        checked={f.enabled}
                        disabled={f.locked || m.isPending}
                        onCheckedChange={(enabled) => m.mutate({ key: f.key, enabled })}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="font-medium">{f.label}</p>
                        <p className="text-sm text-muted">{f.description}</p>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {f.locked && <Badge>Locked by {f.envVar}</Badge>}
                          {f.dependsOn.length > 0 && (
                            <span className={depOff ? "text-danger" : "text-muted"}>
                              Needs {f.dependsOn.map((d) => d.label).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      {f.source === "override" && !f.locked && (
                        <Button variant="ghost" size="sm" aria-label={`Reset ${f.label} to default`} onClick={() => m.mutate({ key: f.key, enabled: null })}>
                          Reset
                        </Button>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ---- users ----
interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  createdAt: number;
  lastSeenAt: number | null;
}
type Action = { kind: "role" | "delete" | "reset"; user: AdminUser };

function Users() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useSession();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const size = 20;
  const list = useQuery({
    queryKey: ["admin", "users", q, page],
    queryFn: () => api<{ items: AdminUser[]; total: number }>(`/admin/users?q=${encodeURIComponent(q)}&limit=${size}&offset=${page * size}`),
  });
  const run = useMutation({
    mutationFn: async (a: Action) => {
      if (a.kind === "role") await send(`/admin/users/${a.user.id}`, { role: a.user.role === "admin" ? "member" : "admin" }, "PATCH");
      else if (a.kind === "delete") await api(`/admin/users/${a.user.id}`, { method: "DELETE" });
      else {
        const r = await api<{ temporaryPassword: string }>(`/admin/users/${a.user.id}/reset-password`, { method: "POST", body: "{}" });
        setTemp({ email: a.user.email, password: r.temporaryPassword });
      }
    },
    onSuccess: async () => {
      setAction(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e) => {
      setAction(null);
      toast(errMsg(e), "danger");
    },
  });
  const total = list.data?.total ?? 0;
  const buttons = (u: AdminUser) => (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => setAction({ kind: "role", user: u })}>
        {u.role === "admin" ? "Make member" : "Make admin"}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setAction({ kind: "reset", user: u })}>
        Reset password
      </Button>
      <Button variant="danger" size="sm" disabled={u.id === me?.id} onClick={() => setAction({ kind: "delete", user: u })}>
        Delete
      </Button>
    </div>
  );
  const copy = {
    role: (u: AdminUser) => ({
      title: u.role === "admin" ? "Make member?" : "Make admin?",
      text: `${u.email} will ${u.role === "admin" ? "lose" : "get"} admin access.`,
      go: "Confirm",
    }),
    delete: (u: AdminUser) => ({
      title: "Delete user?",
      text: `${u.email} and their sessions will be deleted. Their recipes are deleted with them.`,
      go: "Delete",
    }),
    reset: (u: AdminUser) => ({
      title: "Reset password?",
      text: `${u.email} will be signed out and given a temporary password for you to pass on.`,
      go: "Reset",
    }),
  };
  const c = action ? copy[action.kind](action.user) : null;
  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        aria-label="Search users"
        placeholder="Search by email or name"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Failed what="users" />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-muted">
              <tr>
                <th className="p-2">User</th>
                <th className="p-2">Role</th>
                <th className="p-2">Created</th>
                <th className="p-2">Last seen</th>
                <th className="p-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="p-2">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-muted">{u.email}</p>
                  </td>
                  <td className="p-2">{u.role}</td>
                  <td className="p-2">{day(u.createdAt)}</td>
                  <td className="p-2">{day(u.lastSeenAt)}</td>
                  <td className="p-2">{buttons(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col gap-3 md:hidden">
            {list.data.items.map((u) => (
              <li key={u.id}>
                <Card className="flex flex-col gap-2 p-4">
                  <p className="font-medium">
                    {u.name} <Badge>{u.role}</Badge>
                  </p>
                  <p className="break-all text-sm text-muted">{u.email}</p>
                  <p className="text-sm text-muted">
                    Joined {day(u.createdAt)} · Last seen {day(u.lastSeenAt)}
                  </p>
                  {buttons(u)}
                </Card>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{total} users</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={(page + 1) * size >= total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)} title={c?.title ?? "Confirm"} description={c?.text}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAction(null)}>
            Cancel
          </Button>
          <Button variant={action?.kind === "delete" ? "danger" : "primary"} loading={run.isPending} onClick={() => action && run.mutate(action)}>
            {c?.go}
          </Button>
        </div>
      </Dialog>
      <Dialog open={!!temp} onOpenChange={(o) => !o && setTemp(null)} title="Temporary password" description={`For ${temp?.email}. It is shown once, so copy it now.`}>
        <code className="select-all break-all rounded-md bg-sunken p-3 text-lg">{temp?.password}</code>
        <div className="flex justify-end">
          <Button onClick={() => setTemp(null)}>Done</Button>
        </div>
      </Dialog>
    </div>
  );
}

// ---- sign-up ----
const MODES = [
  ["open", "Open", "Anyone who can reach this server can create an account. Only use this on a private network."],
  ["invite", "Invite only", "New people need an invite link. Recommended for servers on the public internet."],
  ["closed", "Closed", "Nobody can create an account, even with an invite. Existing users can still sign in."],
] as const;

function Signup() {
  const friendsOn = useFeature("friends");
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<{ signupMode: string; locked: boolean; envVar: string; friendCap?: number }>("/admin/settings"),
  });
  const m = useMutation({
    mutationFn: (signupMode: string) => send("/admin/settings", { signupMode }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["admin", "settings"] }), qc.invalidateQueries({ queryKey: ["auth-status"] })]),
    onError: (e) => toast(errMsg(e), "danger"),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Failed what="settings" />;
  const { signupMode, locked, envVar } = q.data;
  return (
    <div className="flex flex-col gap-6">
    <fieldset className="flex flex-col gap-3" disabled={locked}>
      <legend className="mb-2 text-lg font-semibold">Who can sign up</legend>
      {locked && (
        <p className="text-sm">
          <Badge>Locked by {envVar}</Badge>
        </p>
      )}
      {MODES.map(([value, label, text]) => (
        <label
          key={value}
          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line bg-raised p-4 has-[:checked]:border-accent has-[:disabled]:opacity-60"
        >
          <input type="radio" name="signup" className="mt-1 size-4" value={value} checked={signupMode === value} onChange={() => m.mutate(value)} />
          <span>
            <span className="block font-medium">{label}</span>
            <span className="block text-sm text-muted">{text}</span>
          </span>
        </label>
      ))}
    </fieldset>
    {friendsOn && q.data.friendCap != null && <FriendCap value={q.data.friendCap} />}
    </div>
  );
}

function FriendCap({ value }: { value: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: (friendCap: number) => send("/admin/settings", { friendCap }),
    onSuccess: async () => {
      setError("");
      await qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast("Saved");
    },
    onError: (e) => setError(errMsg(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) return setError("Enter a whole number, 1 or more.");
    setError("");
    m.mutate(n);
  }
  return (
    <form onSubmit={submit} noValidate className="flex max-w-sm flex-col gap-3">
      <h2 className="text-lg font-semibold">Friend cap</h2>
      <Field label="Most friends per person" hint="Lowering it keeps existing friends but blocks new ones." error={error}>
        <Input type="number" inputMode="numeric" min={1} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" loading={m.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
