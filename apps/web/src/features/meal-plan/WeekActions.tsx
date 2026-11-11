import { useState } from "react";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { mealTypes, type MealPlanRuleInput } from "@meally/shared";
import { Button, Dialog, Field, IconButton, Input, Sheet, useToast, cn } from "../../ui";
import { postJson } from "../../lib/api";
import { useFeature } from "../features/FeaturesProvider";
import { useIcal, useOrganizerNames, useRules, useShoppingLists } from "./api";
import { MEAL_LABEL } from "./MealTypeControl";

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const selectCls = "min-h-11 w-full rounded-md border border-line bg-raised px-3";

export function ShoppingDialog({ open, onOpenChange, from, to }: PanelProps & { from: string; to: string }) {
  const toast = useToast();
  const lists = useShoppingLists(open);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const items = lists.data ?? [];
  const choice = pick || items[0]?.id || "";
  const creating = !items.length || choice === "new";

  async function go() {
    setBusy(true);
    try {
      const id = creating ? (await postJson<{ id: string }>("/shopping/lists", { name: name.trim() })).id : choice;
      await postJson(`/shopping/lists/${id}/add-meal-plan`, { from, to });
      toast("Added this week's ingredients", "success");
      onOpenChange(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add week to shopping list" description="Ingredients from this week's recipes.">
      {lists.isLoading ? (
        <p aria-busy="true">Loading…</p>
      ) : (
        <>
          {!!items.length && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="plan-list" className="text-sm font-medium">
                List
              </label>
              <select id="plan-list" value={choice} onChange={(e) => setPick(e.target.value)} className={selectCls}>
                {items.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="new">New list…</option>
              </select>
            </div>
          )}
          {creating && (
            <Field label="New list name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Button onClick={go} loading={busy} disabled={creating && !name.trim()}>
            Add ingredients
          </Button>
        </>
      )}
    </Dialog>
  );
}

export function CalendarSheet({ open, onOpenChange }: PanelProps) {
  const toast = useToast();
  const { q, rotate } = useIcal(open);
  const url = q.data ? `${window.location.origin}${q.data.path}?token=${q.data.token}` : "";
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Subscribe in calendar" description="Add this link to Google, Apple or Outlook calendar as a subscription.">
      {q.isLoading ? (
        <p aria-busy="true">Loading…</p>
      ) : q.isError ? (
        <p role="alert" className="text-danger">
          Could not load the link.
        </p>
      ) : (
        <>
          <Field label="Calendar link" hint="Anyone with this link can see your plan. Rotate it to cut off old subscribers.">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => toast("Link copied", "success"), () => toast("Copy failed", "danger"));
              }}
            >
              <Copy className="size-4" aria-hidden /> Copy
            </Button>
            <Button variant="secondary" loading={rotate.isPending} onClick={() => rotate.mutate()}>
              <RefreshCw className="size-4" aria-hidden /> Rotate
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RulesSheet({ open, onOpenChange }: PanelProps) {
  const organizers = useFeature("organizers");
  const { q, add, remove } = useRules(open);
  const tags = useOrganizerNames("tags", open && organizers);
  const cats = useOrganizerNames("categories", open && organizers);
  const [mealType, setMealType] = useState<MealPlanRuleInput["mealType"]>("any");
  const [dow, setDow] = useState("");
  const [selTags, setSelTags] = useState<string[]>([]);
  const [selCats, setSelCats] = useState<string[]>([]);
  const toggle = (list: string[], set: (v: string[]) => void, s: string) => set(list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Suggestion rules" description="Narrow what Surprise me picks, for example only quick recipes on weekdays.">
      <ul className="flex flex-col gap-2" aria-label="Rules">
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-line p-2 text-sm">
            <span>
              {r.mealType === "any" ? "Any meal" : MEAL_LABEL[r.mealType]}, {r.dayOfWeek === null ? "any day" : DAYS[r.dayOfWeek]}
              {[...r.tags, ...r.categories].length > 0 && `: ${[...r.tags, ...r.categories].join(", ")}`}
            </span>
            <IconButton aria-label="Remove rule" onClick={() => remove.mutate(r.id)}>
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          </li>
        ))}
        {q.data && !q.data.length && <li className="text-muted">No rules yet.</li>}
      </ul>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ mealType, dayOfWeek: dow === "" ? null : Number(dow), tags: selTags, categories: selCats }, { onSuccess: () => { setSelTags([]); setSelCats([]); } });
        }}
      >
        <h3 className="font-medium">New rule</h3>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Meal
          <select value={mealType} onChange={(e) => setMealType(e.target.value as typeof mealType)} className={selectCls}>
            <option value="any">Any meal</option>
            {mealTypes.map((m) => (
              <option key={m} value={m}>
                {MEAL_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Day
          <select value={dow} onChange={(e) => setDow(e.target.value)} className={selectCls}>
            <option value="">Any day</option>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        {organizers && (
          <>
            <Picker legend="Tags" options={tags.data ?? []} selected={selTags} onToggle={(s) => toggle(selTags, setSelTags, s)} />
            <Picker legend="Categories" options={cats.data ?? []} selected={selCats} onToggle={(s) => toggle(selCats, setSelCats, s)} />
          </>
        )}
        <Button type="submit" loading={add.isPending}>
          Add rule
        </Button>
      </form>
    </Sheet>
  );
}

function Picker({ legend, options, selected, onToggle }: { legend: string; options: { name: string; slug: string }[]; selected: string[]; onToggle: (s: string) => void }) {
  if (!options.length) return null;
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.slug} className={cn("flex min-h-11 cursor-pointer items-center rounded-full border border-line px-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2", selected.includes(o.slug) && "bg-accent text-accent-contrast")}>
            <input type="checkbox" className="sr-only" checked={selected.includes(o.slug)} onChange={() => onToggle(o.slug)} />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
