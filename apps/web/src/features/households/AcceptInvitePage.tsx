import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { InviteLookup } from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";
import { Button, Skeleton } from "../../ui";

/** For signed-in users. Joining moves them; their old recipes stay with the old household. */
export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<InviteLookup>(`/auth/invite/${encodeURIComponent(token)}`),
    retry: false,
  });

  async function accept() {
    setBusy(true);
    setError("");
    try {
      await postJson("/household/join", { token });
      qc.clear();
      navigate("/settings", { replace: true });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <Skeleton className="h-32 w-full max-w-md" />;
  if (q.isError || !q.data?.valid) {
    return (
      <div className="flex max-w-md flex-col gap-3" role="alert">
        <h1 className="text-2xl font-semibold">Invite not valid</h1>
        <p className="text-muted">This link is invalid, already used, or expired. Ask for a new one.</p>
        <Link to="/recipes" className="text-accent underline">
          Back to recipes
        </Link>
      </div>
    );
  }
  return (
    <div className="flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">Join {q.data.householdName}</h1>
      <p className="rounded-md border border-line bg-sunken p-3 text-sm">
        Joining moves you to this household. Your current recipes and lists stay with your old household, so you will not
        see them any more.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={accept} loading={busy}>
          Join household
        </Button>
        <Button variant="ghost" onClick={() => navigate("/recipes")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
