import { capImage } from "../recipes/upload";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Recipe } from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { RecipeEditor } from "../recipes/RecipeEditor";
import { Button, Card, Field, Textarea } from "../../ui";

interface Status {
  configured: boolean;
  provider?: "anthropic" | "openai";
  model?: string;
}
interface Preview {
  recipe: { name: string; ingredients?: Array<{ raw: string }>; steps?: Array<{ text: string }> } & Record<string, unknown>;
}

export function aiErrorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.code === "ai_not_configured") return "AI helpers are not set up on this server yet.";
    if (e.status === 429) return "You've used the AI helpers a lot recently. Try again later.";
    if (e.code === "ai_timeout") return "The AI provider took too long. Try again, or use less text.";
    if (e.code === "too_large") return "Those photos are too large. Each one must be under 8 MB.";
    if (e.code === "invalid_body") return e.message;
  }
  return "The AI couldn't read that. Try again, or add the recipe by hand.";
}

export function AiImport({ mode }: { mode: "text" | "photos" }) {
  const { me } = useSession();
  const isAdmin = me?.user.role === "admin";
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api<Status>("/ai/status"), staleTime: 60_000 });
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState(false);

  const run = useMutation({
    mutationFn: async () => {
      if (mode === "text") return postJson<Preview>("/ai/recipe-from-text", { text });
      const fd = new FormData();
      for (const f of files) fd.append("photos", await capImage(f));
      return api<Preview>("/ai/recipe-from-image", { method: "POST", body: fd });
    },
  });

  if (editing && run.data) {
    const r = run.data.recipe;
    const initial = {
      ...r,
      ingredients: (r.ingredients ?? []).map((i, n) => ({ ...i, position: n })),
      steps: (r.steps ?? []).map((s, n) => ({ ...s, position: n })),
    } as unknown as Recipe;
    return <RecipeEditor initial={initial} />;
  }

  if (status.data && !status.data.configured) {
    return (
      <p role="status" className="rounded-md border border-line px-3 py-2 text-sm">
        {isAdmin
          ? "AI helpers aren't configured. Set MEALLY_AI_PROVIDER, MEALLY_AI_API_KEY and (for OpenAI-compatible servers) MEALLY_AI_MODEL on the server, then restart. See the self-hosting guide."
          : "AI helpers aren't set up on this server. Ask your server admin."}
      </p>
    );
  }
  const provider = status.data?.provider === "anthropic" ? "Anthropic" : status.data?.provider === "openai" ? "an OpenAI-compatible provider" : "the AI provider";
  const noun = mode === "text" ? "text" : "photos";
  const ready = mode === "text" ? !!text.trim() : files.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Your {noun} are sent to {provider} configured by your server admin.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !run.isPending) run.mutate();
        }}
      >
        {mode === "text" ? (
          <Field label="Recipe text" hint="Paste a message, a transcript or any messy notes">
            <Textarea rows={10} maxLength={30000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        ) : (
          <Field label="Photos" hint="Up to 3 photos of a cookbook page or handwritten card">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
              className="min-h-11 text-sm"
            />
          </Field>
        )}
        <div>
          <Button type="submit" loading={run.isPending} disabled={!ready}>
            Read recipe
          </Button>
        </div>
      </form>
      {run.isPending && (
        <p role="status" className="text-muted">
          Reading…
        </p>
      )}
      {run.error && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-danger">
          {aiErrorMessage(run.error)}
        </p>
      )}
      {run.data && !run.isPending && (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-xl font-semibold">{run.data.recipe.name}</h2>
          <p className="text-sm text-muted">
            {run.data.recipe.ingredients?.length ?? 0} ingredients, {run.data.recipe.steps?.length ?? 0} steps. AI can make mistakes, so check it before saving.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => setEditing(true)}>Edit before saving</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
