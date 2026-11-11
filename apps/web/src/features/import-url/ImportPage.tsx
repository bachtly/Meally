import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Recipe } from "@meally/shared";
import { ApiRequestError, postJson } from "../../lib/api";
import { RecipeEditor } from "../recipes/RecipeEditor";
import { useFeature } from "../features/FeaturesProvider";
import { AiImport } from "./AiImport";
import { importSource, type ImportSource } from "./importOptions";
import { Button, Card, Field, Input, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "../../ui";

interface Preview {
  recipe: Partial<Recipe> & {
    name: string;
    ingredients?: Array<{ section?: string | null; raw: string }>;
    steps?: Array<{ section?: string | null; text: string }>;
  };
  imageUrl: string | null;
}

/** Pulls a URL out of `?url=` or, for share targets that send it as text, `?text=`. */
export function sharedUrl(params: URLSearchParams): string {
  const direct = params.get("url")?.trim();
  if (direct) return direct;
  return params.get("text")?.match(/https?:\/\/\S+/)?.[0] ?? "";
}

/**
 * A Meally share link from this server (`/s/:token` or `/s/:token/:slug`), as an in-app path; null for anything else.
 * Pasting or sharing one into the app opens it in the app instead of importing the page.
 */
export function ownSharePath(raw: string, origin = typeof location !== "undefined" ? location.origin : ""): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.origin !== origin) return null;
    return /^\/s\/[^/]+(\/[^/]+)?\/?$/.test(u.pathname) ? u.pathname.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export function importErrorMessage(e: unknown): {
  text: string;
  manual?: boolean;
} {
  if (e instanceof ApiRequestError) {
    if (e.code === "blocked_url")
      return {
        text: "That address can't be imported. Use a public http or https recipe link.",
      };
    if (e.code === "no_recipe_found")
      return { text: "We couldn't find a recipe on that page.", manual: true };
    if (e.code === "fetch_failed")
      return {
        text: "We couldn't reach that page. Check the link and try again in a moment.",
      };
    if (e.code === "rate_limited" || e.status === 429)
      return {
        text: "You've imported a lot recently. Wait a bit and try again.",
      };
  }
  return { text: "Something went wrong while importing. Try again." };
}

const bookmarklet = () =>
  `javascript:(()=>{window.open('${location.origin}/recipes/import?url='+encodeURIComponent(location.href))})()`;

export function RecipeImportPage() {
  const ai = useFeature("ai");
  const [params, setParams] = useSearchParams();
  if (!ai) return <LinkImport />;
  const tab = importSource(params);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Import a recipe</h1>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === "link") next.delete("from");
          else next.set("from", v as ImportSource);
          setParams(next, { replace: true });
        }}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="link">From a link</TabsTrigger>
          <TabsTrigger value="text">From text</TabsTrigger>
          <TabsTrigger value="photos">From photos</TabsTrigger>
        </TabsList>
        <TabsContent value="link">
          <LinkImport embedded />
        </TabsContent>
        <TabsContent value="text">
          <AiImport mode="text" />
        </TabsContent>
        <TabsContent value="photos">
          <AiImport mode="photos" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LinkImport({ embedded = false }: { embedded?: boolean }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const initialUrl = sharedUrl(params);
  const [url, setUrl] = useState(initialUrl);
  const [editing, setEditing] = useState(false);
  const canPaste =
    typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

  const preview = useMutation({
    mutationFn: (u: string) =>
      postJson<Preview>("/import/url/preview", { url: u }),
  });
  const save = useMutation({
    mutationFn: (u: string) =>
      postJson<{ slug: string }>("/import/url", { url: u }),
    onSuccess: ({ slug }) => {
      toast("Recipe imported", "success");
      navigate(`/recipes/${slug}`);
    },
  });

  const run = (u = url) => {
    const v = u.trim();
    const own = ownSharePath(v);
    if (own) {
      navigate(own);
      return;
    }
    if (!v || preview.isPending) return;
    save.reset();
    preview.mutate(v);
  };
  const started = useRef(false);
  useEffect(() => {
    if (initialUrl && !started.current) {
      started.current = true;
      const own = ownSharePath(initialUrl);
      if (own) navigate(own, { replace: true });
      else preview.mutate(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (editing && preview.data) {
    const r = preview.data.recipe;
    const initial = {
      ...r,
      sourceUrl: r.sourceUrl ?? url.trim(),
      ingredients: (r.ingredients ?? []).map((i, n) => ({ ...i, position: n })),
      steps: (r.steps ?? []).map((s, n) => ({ ...s, position: n })),
    } as unknown as Recipe;
    return <RecipeEditor initial={initial} />;
  }

  const err = preview.error ?? save.error;
  const msg = err ? importErrorMessage(err) : null;
  const data = preview.data;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {!embedded && <h1 className="text-2xl font-semibold">Import from a link</h1>}
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Field label="Recipe link" hint="Paste the address of a recipe page">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://"
            className="min-h-14 text-lg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {canPaste && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const t = (await navigator.clipboard.readText()).trim();
                  if (t) {
                    setUrl(t);
                    run(t);
                  }
                } catch {
                  toast("Could not read the clipboard", "danger");
                }
              }}
            >
              <ClipboardPaste className="size-4" aria-hidden />
              Paste from clipboard
            </Button>
          )}
          <Button
            type="submit"
            loading={preview.isPending}
            disabled={!url.trim()}
          >
            Import
          </Button>
        </div>
      </form>

      {preview.isPending && (
        <p role="status" className="text-muted">
          Fetching…
        </p>
      )}

      {msg && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-danger px-3 py-2 text-danger"
        >
          <p>{msg.text}</p>
          {msg.manual && (
            <Link to="/recipes/new" className="underline">
              Create it manually
            </Link>
          )}
        </div>
      )}

      {data && !preview.isPending && (
        <Card className="flex flex-col gap-4 p-4">
          <h2 className="text-xl font-semibold">{data.recipe.name}</h2>
          {data.imageUrl && (
            <img
              src={data.imageUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="aspect-[16/9] max-h-56 w-full rounded-md object-cover"
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-1 font-medium">
                Ingredients ({data.recipe.ingredients?.length ?? 0})
              </h3>
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">
                {data.recipe.ingredients?.map((i, n) => (
                  <li key={n}>{i.raw}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 font-medium">
                Steps ({data.recipe.steps?.length ?? 0})
              </h3>
              <ol className="max-h-48 list-decimal overflow-y-auto pl-5 text-sm">
                {data.recipe.steps?.map((s, n) => (
                  <li key={n}>{s.text}</li>
                ))}
              </ol>
            </section>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit before saving
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => save.mutate(url.trim())}
            >
              Save recipe
            </Button>
          </div>
          <p className="text-xs text-muted">
            The photo is only imported when you save directly. Add one in the
            editor if you edit first.
          </p>
        </Card>
      )}

      <section className="text-sm text-muted">
        <h2 className="mb-1 font-medium text-ink">Bookmarklet</h2>
        <p>
          Drag this link to your bookmarks bar, then click it on any recipe
          page:{" "}
          <a
            href={bookmarklet()}
            onClick={(e) => e.preventDefault()}
            className="text-accent underline"
          >
            Save to Meally
          </a>
        </p>
      </section>
    </div>
  );
}
