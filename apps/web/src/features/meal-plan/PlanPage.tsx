import { useState } from "react";
import { Link } from "react-router";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Ellipsis, GripVertical, Plus, Settings2 } from "lucide-react";
import { mealTypes, type MealPlanEntry, type MealType } from "@meally/shared";
import { Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Skeleton, useToast, cn } from "../../ui";
import { useFeature } from "../features/FeaturesProvider";
import { AddSheet } from "./AddSheet";
import { useRemoveEntry, usePatchEntry, usePlanRange } from "./api";
import { addDays, dayLabel, localToday, startOfWeek, weekDays, weekLabel } from "./dates";
import { MealTypeControl, MEAL_LABEL } from "./MealTypeControl";
import { CalendarSheet, RulesSheet, ShoppingDialog } from "./WeekActions";
import { RecipeThumb } from "../recipes/RecipeThumb";
import { useIsDesktop } from "./useIsDesktop";

type Target = { date: string; mealType?: MealType };

export function PlanPage() {
  const today = localToday();
  const [start, setStart] = useState(() => startOfWeek(today));
  const days = weekDays(start);
  const range = usePlanRange(days[0]!, days[6]!);
  const desktop = useIsDesktop();
  const toast = useToast();
  const patch = usePatchEntry();
  const [add, setAdd] = useState<Target | null>(null);
  const [panel, setPanel] = useState<"shopping" | "calendar" | "rules" | null>(null);
  const shopping = useFeature("shopping-lists");
  const entries = range.data ?? [];
  const at = (date: string, mt: MealType) => entries.filter((e) => e.date === date && e.mealType === mt).sort((a, b) => a.position - b.position);

  // Mouse drags after a small move. Touch drags after a long press so a swipe on a handle still scrolls the page
  // (dnd-kit sensors docs: Touch sensor with delay + tolerance, `touch-action: manipulation` on the handle).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );
  function onDragEnd(ev: DragEndEvent) {
    if (!ev.over) return;
    const [date, mealType] = String(ev.over.id).split("|") as [string, MealType];
    const e = entries.find((x) => x.id === ev.active.id);
    if (!e || (e.date === date && e.mealType === mealType)) return;
    patch.mutate({ id: e.id, date, mealType }, { onError: () => toast("Could not move that", "danger") });
  }

  const grid = desktop ? (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-[5.5rem_repeat(7,minmax(0,1fr))] gap-px overflow-hidden rounded-lg border border-line bg-line">
        <div className="bg-raised" />
        {days.map((d) => (
          <div key={d} className={cn("flex items-center justify-between bg-raised px-2 py-2", d === today && "bg-sunken")}>
            <span className="text-sm font-medium" aria-current={d === today ? "date" : undefined}>
              {dayLabel(d, { weekday: "short", day: "numeric" })}
            </span>
            <IconButton aria-label={`Add to ${dayLabel(d)}`} onClick={() => setAdd({ date: d })}>
              <Plus className="size-4" aria-hidden />
            </IconButton>
          </div>
        ))}
        {mealTypes.map((mt) => (
          <Row key={mt} mt={mt} days={days} today={today} at={at} onAdd={setAdd} />
        ))}
      </div>
    </DndContext>
  ) : (
    <ul className="flex flex-col gap-3">
      {days.map((d) => (
        <li key={d} className={cn("rounded-lg border border-line bg-raised p-3", d === today && "border-accent ring-1 ring-accent")}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold" aria-current={d === today ? "date" : undefined}>
              {dayLabel(d)}
              {d === today && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-contrast">Today</span>}
            </h2>
            <Button variant="ghost" size="sm" className="min-h-11" aria-label={`Add to ${dayLabel(d)}`} onClick={() => setAdd({ date: d })}>
              <Plus className="size-4" aria-hidden /> Add
            </Button>
          </div>
          {mealTypes.map((mt) => {
            const list = at(d, mt);
            if (!list.length) return null;
            return (
              <section key={mt} aria-label={MEAL_LABEL[mt]} className="mt-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{MEAL_LABEL[mt]}</h3>
                {list.map((e) => (
                  <Entry key={e.id} e={e} days={days} />
                ))}
              </section>
            );
          })}
          {!entries.some((e) => e.date === d) && <p className="text-sm text-muted">Nothing planned.</p>}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Plan</h1>
        <div className="flex items-center gap-1">
          <IconButton aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}>
            <ChevronLeft className="size-5" aria-hidden />
          </IconButton>
          <Button variant="secondary" size="sm" onClick={() => setStart(startOfWeek(today))}>
            This week
          </Button>
          <IconButton aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>
            <ChevronRight className="size-5" aria-hidden />
          </IconButton>
          <div className="lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Plan actions">
                  <Ellipsis className="size-5" aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {shopping && <DropdownMenuItem onSelect={() => setPanel("shopping")}>Add week to shopping list</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setPanel("calendar")}>Subscribe in calendar</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("rules")}>Suggestion rules</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium" aria-live="polite">
          {weekLabel(start)}
        </p>
        <div className="hidden flex-wrap gap-2 lg:flex">
          {shopping && (
            <Button variant="secondary" size="sm" onClick={() => setPanel("shopping")}>
              Add week to shopping list
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setPanel("calendar")}>
            <CalendarDays className="size-4" aria-hidden /> Subscribe in calendar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPanel("rules")}>
            <Settings2 className="size-4" aria-hidden /> Suggestion rules
          </Button>
        </div>
      </div>
      {range.isLoading ? (
        <Skeleton className="h-96" />
      ) : range.isError ? (
        <p role="alert" className="text-danger">
          Could not load your plan.{" "}
          <button className="underline" onClick={() => void range.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <>
          {!entries.length && (
            <p className="flex items-center gap-2 text-muted">
              <CalendarPlus className="size-4" aria-hidden /> Nothing planned this week. Use Add on any day.
            </p>
          )}
          {grid}
        </>
      )}
      <AddSheet open={!!add} onOpenChange={(o) => !o && setAdd(null)} date={add?.date ?? start} mealType={add?.mealType} />
      {shopping && <ShoppingDialog open={panel === "shopping"} onOpenChange={(o) => !o && setPanel(null)} from={days[0]!} to={days[6]!} />}
      <CalendarSheet open={panel === "calendar"} onOpenChange={(o) => !o && setPanel(null)} />
      <RulesSheet open={panel === "rules"} onOpenChange={(o) => !o && setPanel(null)} />
    </div>
  );
}

function Row({ mt, days, today, at, onAdd }: { mt: MealType; days: string[]; today: string; at: (d: string, m: MealType) => MealPlanEntry[]; onAdd: (t: Target) => void }) {
  return (
    <>
      <div className="bg-raised p-2 text-sm font-medium text-muted">{MEAL_LABEL[mt]}</div>
      {days.map((d) => (
        <Cell key={d} id={`${d}|${mt}`} today={d === today} label={`${MEAL_LABEL[mt]} on ${dayLabel(d)}`} onAdd={() => onAdd({ date: d, mealType: mt })}>
          {at(d, mt).map((e) => (
            <Entry key={e.id} e={e} days={days} draggable />
          ))}
        </Cell>
      ))}
    </>
  );
}

/** Shown on hover/focus where the device can hover; always shown on touch (no hover, or any coarse pointer). */
const CELL_ADD =
  "mt-1 hidden min-h-11 w-full rounded text-muted hover:bg-sunken focus-visible:block group-hover:block group-focus-within:block any-pointer-coarse:block [@media(hover:none)]:block";

function Cell({ id, today, label, onAdd, children }: { id: string; today: boolean; label: string; onAdd: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} role="group" aria-label={label} className={cn("group min-h-24 bg-raised p-1", today && "bg-sunken", isOver && "outline outline-2 -outline-offset-2 outline-accent")}>
      {children}
      <button type="button" onClick={onAdd} aria-label={`Add ${label}`} className={CELL_ADD}>
        <Plus className="mx-auto size-4" aria-hidden />
      </button>
    </div>
  );
}

function Entry({ e, days, draggable }: { e: MealPlanEntry; days: string[]; draggable?: boolean }) {
  const drag = useDraggable({ id: e.id, disabled: !draggable });
  const remove = useRemoveEntry();
  const toast = useToast();
  const [dialog, setDialog] = useState<"day" | "meal" | null>(null);
  const name = e.recipe?.name ?? e.title ?? "Untitled";
  const style = drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)` } : undefined;
  return (
    <div ref={drag.setNodeRef} style={style} className={cn("relative my-1 flex items-center gap-2 rounded-md border border-line bg-raised p-1", draggable && "flex-col items-stretch gap-1", drag.isDragging && "z-10 opacity-80 shadow-md")}>
      {draggable && (
        <button type="button" aria-label={`Drag ${name}`} className="absolute left-0.5 top-0.5 flex size-7 cursor-grab touch-manipulation items-center justify-center rounded text-muted hover:bg-sunken any-pointer-coarse:size-11" {...drag.listeners} {...drag.attributes}>
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      {e.recipe ? (
        <Link to={`/recipes/${e.recipe.slug}`} className={cn("flex min-w-0 flex-1 items-center gap-2", draggable && "flex-col items-stretch gap-1 pt-7 any-pointer-coarse:pt-11")}>
          <RecipeThumb name={name} imageUrl={e.recipe.imageUrl} sizes="40px" className={cn("shrink-0 rounded", draggable ? "h-12 w-full" : "size-10")} />
          <span className={cn("min-w-0 text-sm", draggable ? "line-clamp-2 px-1" : "truncate")}>{name}</span>
        </Link>
      ) : (
        <span className={cn("min-w-0 flex-1 truncate px-2 text-sm italic", draggable && "pt-7 any-pointer-coarse:pt-11")}>
          {name}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Actions for ${name}`} className={cn(draggable && "!absolute right-0.5 top-0.5 !size-7 any-pointer-coarse:!size-11")}>
            <Ellipsis className="size-4" aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("day")}>Move to day…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("meal")}>Change meal</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => remove.mutate(e.id, { onError: () => toast("Could not remove", "danger") })}>Remove</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog && <MoveDialog mode={dialog} e={e} days={days} onClose={() => setDialog(null)} />}
    </div>
  );
}

function MoveDialog({ mode, e, days, onClose }: { mode: "day" | "meal"; e: MealPlanEntry; days: string[]; onClose: () => void }) {
  const patch = usePatchEntry();
  const toast = useToast();
  const [date, setDate] = useState(e.date);
  const [mealType, setMealType] = useState(e.mealType);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={mode === "day" ? "Move to day" : "Change meal"}>
      {mode === "day" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`mv-${e.id}`} className="text-sm font-medium">
            Day
          </label>
          <select id={`mv-${e.id}`} value={date} onChange={(ev) => setDate(ev.target.value)} className="min-h-11 rounded-md border border-line bg-raised px-3">
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <MealTypeControl value={mealType} onChange={setMealType} />
      )}
      <Button
        loading={patch.isPending}
        onClick={() =>
          patch.mutate({ id: e.id, date, mealType }, { onSuccess: onClose, onError: () => toast("Could not move that", "danger") })
        }
      >
        {mode === "day" ? "Move" : "Change"}
      </Button>
    </Dialog>
  );
}
