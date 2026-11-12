import { Link, Outlet, useNavigate, useParams } from "react-router";
import { AppShell } from "../../app/AppShell";
import { ApiRequestError } from "../../lib/api";
import { Button, Card, EmptyState, Skeleton, useToast } from "../../ui";
import { AuthCard } from "../auth/AuthPages";
import { useAuthStatus, useSession } from "../auth/useSession";
import { useFeaturesState } from "../features/FeaturesProvider";
import { DeadLink } from "../share/PublicRecipeView";
import { errMsg, useAcceptInvite, useInvitePreview } from "./api";

const linkButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 font-medium";

/** `/invite/:token`: inside the app shell when signed in, a bare card with sign-in links otherwise. */
export function InviteLayout() {
  const { me, isLoading } = useSession();
  if (me) return <AppShell />;
  if (isLoading) {
    return (
      <div className="p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  return <Outlet />;
}

export function InvitePage() {
  const { token = "" } = useParams();
  const { me } = useSession();
  const { features, isLoading } = useFeaturesState();
  const on = features?.friends?.enabled === true;
  if (isLoading) return <Skeleton className="m-6 h-8 w-48" />;
  // Flag off: the path is a dead link, signed in or not.
  if (!on)
    return me ? (
      <DeadLink />
    ) : (
      <AuthCard title="Friend invite">
        <DeadLink />
      </AuthCard>
    );
  return me ? <Accept token={token} /> : <SignedOut token={token} />;
}

function SignedOut({ token }: { token: string }) {
  const status = useAuthStatus();
  const next = `/invite/${token}`;
  const q = `?next=${encodeURIComponent(next)}`;
  // With sign-up closed there is nothing to create, so only offer sign in.
  const canSignUp = status.data
    ? status.data.signupMode !== "closed" && !status.data.needsSetup
    : true;
  return (
    <AuthCard title="You're invited">
      <p className="mb-4 text-sm text-muted">
        Someone wants to be friends with you on Meally. Sign in or create an
        account to answer.
      </p>
      <div className="flex flex-col gap-2">
        <Link
          to={`/signin${q}`}
          className={`${linkButton} bg-accent text-accent-contrast hover:bg-accent-hover`}
        >
          Sign in
        </Link>
        {canSignUp && (
          <Link
            to={`/signup${q}`}
            className={`${linkButton} border border-line bg-raised hover:bg-sunken`}
          >
            Create an account
          </Link>
        )}
      </div>
    </AuthCard>
  );
}

const MESSAGES: Record<string, string> = {
  own_invite: "That's your own invite link. Send it to someone else.",
  rate_limited: "Too many tries. Try again later.",
};

function Accept({ token }: { token: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const preview = useInvitePreview(token, true);
  const accept = useAcceptInvite(token);
  const err = accept.error instanceof ApiRequestError ? accept.error : null;

  if (preview.isPending) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-3" aria-busy="true">
        <Skeleton className="h-8" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (preview.isError) {
    const e = preview.error;
    if (e instanceof ApiRequestError && e.status === 429) {
      return (
        <EmptyState
          title="Try again later"
          action={<Button onClick={() => preview.refetch()}>Try again</Button>}
        >
          Too many tries. Wait a moment.
        </EmptyState>
      );
    }
    // Unknown, used and expired links all look the same on purpose.
    if (e instanceof ApiRequestError && e.status === 404) return <DeadLink />;
    return (
      <EmptyState
        title="Couldn't load this invite"
        action={<Button onClick={() => preview.refetch()}>Try again</Button>}
      >
        Check your connection, then try again.
      </EmptyState>
    );
  }

  const name = preview.data.inviter.name;
  const onAccept = () =>
    accept.mutate(undefined, {
      onSuccess: () => {
        toast("You're now friends");
        navigate("/friends", { replace: true });
      },
      onError: (e) => {
        if (e instanceof ApiRequestError && e.code === "already_friends")
          navigate("/friends", { replace: true });
      },
    });

  if (err?.status === 404) return <DeadLink />;
  return (
    <div className="mx-auto max-w-sm">
      <Card className="flex flex-col gap-4 p-5">
        <h1 className="text-lg font-semibold">
          {name} wants to be friends on Meally.
        </h1>
        <p className="text-sm text-muted">You'll see each other's Snaps.</p>
        {err && (
          <p role="alert" className="text-sm text-danger">
            {MESSAGES[err.code] ?? errMsg(err)}
          </p>
        )}
        <div className="flex gap-2">
          <Button onClick={onAccept} loading={accept.isPending}>
            Accept
          </Button>
          <Button variant="secondary" onClick={() => navigate("/friends")}>
            Not now
          </Button>
        </div>
      </Card>
    </div>
  );
}
