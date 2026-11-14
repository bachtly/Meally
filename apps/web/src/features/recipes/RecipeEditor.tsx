import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { nutritionFields } from "@meally/shared";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { useHoldUpdates } from "../../pwa/updates";
import type { Recipe } from "@meally/shared";
import { ApiRequestError } from "../../lib/api";
import { Button, Dialog, EmptyState, Field, Input, Skeleton, Textarea, useToast } from "../../ui";
import { useRecipe, useSaveRecipe } from "./api";
import { useLinkRecipe } from "../snaps/view-api";
import { buildInput, initialForm, shownTotal, snapshot, type Errors, type FormState } from "./editorModel";
import { RowsEditor } from "./RowsEditor";
import { useFeature } from "../features/FeaturesProvider";
import { useOrganizers } from "../organizers/api";
import { OrganizerPicker } from "../organizers/OrganizerPicker";

const MAX_IMAGE = 10 * 1024 * 1024;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function PhotoPicker({ current, file, onFile }: { current: string | null; file: File | null; onFile: (f: File) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL?.(url);
  }, [file]);

  const take = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Choose an image file");
    if (f.size > MAX_IMAGE) return setError("Image must be 10 MB or smaller");
    setError(undefined);
    onFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };
  const shown = preview ?? current;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-4 text-center ${over ? "border-accent bg-sunken" : "border-line"}`}
    >
      {shown && <img src={shown} alt="Recipe photo preview" className="aspect-[16/9] max-h-56 w-full rounded-md object-cover" />}
      <p className="text-sm text-muted">{shown ? "Drop a new photo here to replace it" : "Drag a photo here, or pick one"}</p>
      <Button variant="secondary" onClick={() => input.current?.click()}>
        <ImagePlus className="size-4" aria-hidden />
        {shown ? "Replace photo" : "Choose photo"}
      </Button>
      <input ref={input} type="file" accept="image/*" aria-label="Photo file" className="sr-only" tabIndex={-1} onChange={(e) => take(e.target.files?.[0])} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** `initial` pre-fills a new (unsaved) recipe, for example from an import preview. */
export function RecipeEditor({ recipe, initial, linkSnapId, presetName }: { recipe?: Recipe; initial?: Recipe; linkSnapId?: string; presetName?: string }) {
  const navigate = useNavigate();
  const link = useLinkRecipe(linkSnapId ?? "");
  const toast = useToast();
  const save = useSaveRecipe(recipe?.slug);
  const organizersOn = useFeature("organizers");
  const nutritionOn = useFeature("nutrition");
  const tagOpts = useOrganizers("tags", organizersOn).data ?? [];
  const catOpts = useOrganizers("categories", organizersOn).data ?? [];
  const toolOpts = useOrganizers("tools", organizersOn).data ?? [];
  const [form, setForm] = useState<FormState>(() => ({ ...initialForm(recipe ?? initial), ...(presetName ? { name: presetName } : {}) }));
  const [photo, setPhoto] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const baseline = useRef(snapshot(form, false));
  const allowLeave = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const dirty = snapshot(form, !!photo) !== baseline.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useHoldUpdates(dirty); // a background app update would reload the page and lose these edits
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current && !allowLeave.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const submit = () => {
    if (save.isPending) return;
    const { input, errors: errs } = buildInput(form, organizersOn, nutritionOn);
    setErrors(errs);
    if (!input) {
      if (errs.name) nameRef.current?.focus();
      return;
    }
    save.mutate(
      { input, image: photo },
      {
        onSuccess: ({ recipe: saved, imageError }) => {
          allowLeave.current = true;
          toast(imageError ? `Saved, but the photo could not be uploaded. ${imageError}` : "Recipe saved", imageError ? "danger" : "success");
          if (!linkSnapId) return navigate(`/recipes/${saved.slug}`);
          /** Started from a Snap: link the new recipe, then go back to the Snap either way. */
          link.mutate(saved.id, {
            onError: () => toast("Recipe saved, but it could not be linked to the Snap", "danger"),
            onSettled: () => navigate(`/snaps/${encodeURIComponent(linkSnapId)}`),
          });
        },
        onError: (e) => {
          const msg = e instanceof ApiRequestError ? e.message : "Could not save the recipe";
          setErrors({ form: msg });
        },
      },
    );
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = recipe ? "Edit recipe" : "New recipe";
  const cancelTo = recipe ? `/recipes/${recipe.slug}` : "/recipes";
  const actions = (
    <>
      <Link to={cancelTo} className="inline-flex min-h-11 items-center rounded-md border border-line bg-raised px-4 font-medium hover:bg-sunken">
        Cancel
      </Link>
      <Button loading={save.isPending} onClick={submit}>
        Save recipe
      </Button>
    </>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto flex max-w-3xl flex-col gap-8 pb-20 lg:pb-0"
    >
      <header className="flex items-center justify-between gap-3 lg:sticky lg:top-[61px] lg:z-20 lg:-mx-4 lg:border-b lg:border-line lg:bg-surface lg:px-4 lg:py-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="hidden items-center gap-2 lg:flex">{actions}</div>
      </header>

      {(errors.form || Object.keys(errors).length > 0) && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-danger">
          {errors.form ?? "Fix the highlighted fields and save again."}
        </p>
      )}

      <Section title="Basics">
        <Field label="Name" error={errors.name}>
          <Input ref={nameRef} required value={form.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={form.description} onChange={(e) => patch({ description: e.target.value })} />
        </Field>
        <PhotoPicker current={recipe?.imageUrl ?? null} file={photo} onFile={setPhoto} />
      </Section>

      {organizersOn && (
        <Section title="Organise">
          <OrganizerPicker label="Categories" options={catOpts.map((o) => o.name)} value={form.categories} onChange={(categories) => patch({ categories })} />
          <OrganizerPicker label="Tags" options={tagOpts.map((o) => o.name)} value={form.tags} onChange={(tags) => patch({ tags })} />
          <OrganizerPicker label="Tools" options={toolOpts.map((o) => o.name)} value={form.tools} onChange={(tools) => patch({ tools })} />
        </Section>
      )}

      <Section title="Time and servings">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Prep (min)" error={errors.prep}>
            <Input type="number" inputMode="numeric" min={0} value={form.prep} onChange={(e) => patch({ prep: e.target.value })} />
          </Field>
          <Field label="Cook (min)" error={errors.cook}>
            <Input type="number" inputMode="numeric" min={0} value={form.cook} onChange={(e) => patch({ cook: e.target.value })} />
          </Field>
          <Field label="Total (min)" error={errors.total} hint={form.totalEdited ? undefined : "Auto"}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={shownTotal(form)}
              onChange={(e) => patch({ total: e.target.value, totalEdited: e.target.value !== "" })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Servings" error={errors.servings}>
            <Input type="number" inputMode="decimal" min={0} step="any" value={form.servings} onChange={(e) => patch({ servings: e.target.value })} />
          </Field>
          <Field label="Yield" hint="For example, 12 cookies">
            <Input value={form.yieldText} onChange={(e) => patch({ yieldText: e.target.value })} />
          </Field>
        </div>
        <Field label="Source URL" error={errors.sourceUrl}>
          <Input inputMode="url" value={form.sourceUrl} onChange={(e) => patch({ sourceUrl: e.target.value })} />
        </Field>
      </Section>

      <Section title="Ingredients">
        <RowsEditor kind="ingredient" rows={form.ingredients} onChange={(ingredients) => patch({ ingredients })} />
      </Section>

      <Section title="Steps">
        <RowsEditor kind="step" rows={form.steps} onChange={(steps) => patch({ steps })} />
      </Section>

      <Section title="Notes">
        <Textarea aria-label="Notes" rows={3} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </Section>

      {nutritionOn && (
        <details className="rounded-lg border border-line p-4" open={Object.values(form.nutrition).some(Boolean)}>
          <summary className="min-h-11 cursor-pointer text-xl font-semibold">Nutrition (per serving)</summary>
          <fieldset className="mt-3 flex flex-col gap-3">
            <legend className="sr-only">Nutrition per serving</legend>
            <p className="text-sm text-muted">Optional. Enter the numbers for one serving, for example from a food label.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {nutritionFields.map((nf) => (
                <Field key={nf.key} label={`${nf.label} (${nf.unit})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={form.nutrition[nf.key] ?? ""}
                    onChange={(ev) => patch({ nutrition: { ...form.nutrition, [nf.key]: ev.target.value } })}
                  />
                </Field>
              ))}
            </div>
            <Field label="Source" hint="For example, food label or USDA FoodData Central" error={errors.nutrition}>
              <Input value={form.nutrition.source ?? ""} onChange={(ev) => patch({ nutrition: { ...form.nutrition, source: ev.target.value } })} />
            </Field>
          </fieldset>
        </details>
      )}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-end gap-2 border-t border-line bg-raised px-4 py-2 lg:hidden">
        {actions}
      </div>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(o) => !o && blocker.state === "blocked" && blocker.reset()}
        title="Discard your changes?"
        description="You have unsaved changes. If you leave now they will be lost."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => blocker.state === "blocked" && blocker.reset()}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={() => blocker.state === "blocked" && blocker.proceed()}>
            Discard
          </Button>
        </div>
      </Dialog>
    </form>
  );
}

/** `?name=` pre-fills the name and `?linkSnap=<id>` links the saved recipe to that Snap (from the RecipePicker). */
export function RecipeNewPage() {
  const [params] = useSearchParams();
  const name = params.get("name")?.slice(0, 200);
  const linkSnapId = params.get("linkSnap") ?? undefined;
  return <RecipeEditor linkSnapId={linkSnapId} presetName={name} />;
}

export function RecipeEditPage() {
  const { slug = "" } = useParams();
  const q = useRecipe(slug);
  if (q.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading recipe" className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <EmptyState title="Could not load this recipe">
        <Link to="/recipes" className="text-accent underline">
          Back to recipes
        </Link>
      </EmptyState>
    );
  }
  return <RecipeEditor key={q.data.id} recipe={q.data} />;
}
