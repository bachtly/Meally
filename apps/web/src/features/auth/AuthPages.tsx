import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { loginSchema, registerSchema, setupSchema, type InviteLookup, type MeResponse } from "@meally/shared";
import type { ZodType } from "zod";
import { api, ApiRequestError, postJson } from "../../lib/api";
import { Button, Field, Input, Skeleton } from "../../ui";
import { useAuthStatus, useSession } from "./useSession";

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-accent/20 via-surface to-surface px-4 py-10">
      <main className="w-full max-w-sm rounded-xl border border-line bg-raised p-6 shadow-lg">
        <p className="text-2xl font-semibold text-accent">Meally</p>
        <h1 className="mb-5 mt-1 text-lg font-medium text-ink">{title}</h1>
        {children}
      </main>
    </div>
  );
}

type Errors = Record<string, string>;

interface FormProps {
  schema: ZodType;
  endpoint: string;
  submitLabel: string;
  fields: { name: string; label: string; type: string; autoComplete: string; hint?: string }[];
  footer?: ReactNode;
  extra?: Record<string, string>;
}

/** Validates with the shared zod schema, posts, stores the session and redirects. */
function AuthForm({ schema, endpoint, submitLabel, fields, footer, extra }: FormProps) {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = { ...Object.fromEntries(new FormData(e.currentTarget)), ...extra } as Record<string, string>;
    const parsed = schema.safeParse(data);
    setFormError("");
    if (!parsed.success) {
      const next: Errors = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const me = await postJson<MeResponse>(endpoint, parsed.data);
      setSession(me);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith("/") ? from : "/", { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {fields.map((f) => (
        <Field key={f.name} label={f.label} hint={f.hint} error={errors[f.name]}>
          <Input name={f.name} type={f.type} autoComplete={f.autoComplete} />
        </Field>
      ))}
      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" loading={busy}>
        {submitLabel}
      </Button>
      {footer}
    </form>
  );
}

const email = { name: "email", label: "Email", type: "email", autoComplete: "email" };
const name = { name: "name", label: "Your name", type: "text", autoComplete: "name" };
const newPassword = {
  name: "password",
  label: "Password",
  type: "password",
  autoComplete: "new-password",
  hint: "At least 8 characters",
};

export function SignInPage() {
  const status = useAuthStatus();
  const { me, isLoading } = useSession();
  if (me) return <Navigate to="/" replace />;
  if (status.data?.needsSetup) return <Navigate to="/setup" replace />;
  return (
    <AuthCard title="Sign in">
      {isLoading || status.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <AuthForm
          schema={loginSchema}
          endpoint="/auth/login"
          submitLabel="Sign in"
          fields={[email, { name: "password", label: "Password", type: "password", autoComplete: "current-password" }]}
          footer={
            status.data && status.data.signupMode !== "closed" ? (
              <p className="text-center text-sm text-muted">
                New here?{" "}
                <Link to="/signup" className="font-medium text-accent underline">
                  Create an account
                </Link>
              </p>
            ) : undefined
          }
        />
      )}
    </AuthCard>
  );
}

export function SignUpPage() {
  const status = useAuthStatus();
  const { me } = useSession();
  const token = useSearchParams()[0].get("invite") ?? "";
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<InviteLookup>(`/auth/invite/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
  if (me) return <Navigate to={token ? `/invite/${encodeURIComponent(token)}` : "/"} replace />;
  if (status.data && (status.data.needsSetup || status.data.signupMode === "closed")) {
    return <Navigate to="/signin" replace />;
  }
  const validInvite = invite.data?.valid ? invite.data : null;
  return (
    <AuthCard title={validInvite ? `Join ${validInvite.householdName}` : "Create your account"}>
      {status.isLoading || (token && invite.isLoading) ? (
        <Skeleton className="h-48 w-full" />
      ) : validInvite ? (
        <AuthForm
          schema={registerSchema}
          endpoint="/auth/register"
          submitLabel="Create account and join"
          fields={[name, email, newPassword]}
          extra={{ inviteToken: token }}
          footer={
            <p className="text-center text-sm text-muted">
              Have an account?{" "}
              <Link to="/signin" state={{ from: `/invite/${token}` }} className="font-medium text-accent underline">
                Sign in to join
              </Link>
            </p>
          }
        />
      ) : status.data?.signupMode === "invite" ? (
        <p className="text-sm text-muted">
          {token ? "This invite link is invalid or has expired. " : ""}Sign-up is by invitation only. Ask a household admin for an invite link, or{" "}
          <Link to="/signin" className="font-medium text-accent underline">
            sign in
          </Link>
          .
        </p>
      ) : (
        <AuthForm
          schema={registerSchema}
          endpoint="/auth/register"
          submitLabel="Create account"
          fields={[name, email, newPassword]}
          footer={
            <p className="text-center text-sm text-muted">
              Have an account?{" "}
              <Link to="/signin" className="font-medium text-accent underline">
                Sign in
              </Link>
            </p>
          }
        />
      )}
    </AuthCard>
  );
}

export function SetupPage() {
  const status = useAuthStatus();
  if (status.data && !status.data.needsSetup) return <Navigate to="/signin" replace />;
  return (
    <AuthCard title="Set up Meally">
      <p className="mb-4 text-sm text-muted">Create the first admin account. It also creates your household.</p>
      {status.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <AuthForm
          schema={setupSchema}
          endpoint="/auth/setup"
          submitLabel="Create admin account"
          fields={[name, email, newPassword]}
        />
      )}
    </AuthCard>
  );
}

/** Wraps routes that need a session; redirects to sign in and remembers where the user was going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, isLoading, isError } = useSession();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  // Offline cold start: the session check fails with a network error, not a 401. Let cached pages render.
  if (!me && !(isError && !navigator.onLine)) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
