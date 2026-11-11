import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Heading, Plus, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { formatQuantity, isSectionHeader, parseIngredient, unitByKey } from "@meally/shared";
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton } from "../../ui";
import { newRow, rowsFromPaste, type Row } from "./editorModel";

const field = "w-full min-h-11 rounded-md border border-line bg-raised px-3 py-2 text-base text-ink placeholder:text-muted";

function Preview({ text }: { text: string }) {
  if (!text.trim()) return null;
  if (isSectionHeader(text)) return <p className="mt-1 text-xs text-muted">Section header</p>;
  const p = parseIngredient(text);
  const qty = p.quantity == null ? null : formatQuantity(p.quantity) + (p.quantityMax ? `–${formatQuantity(p.quantityMax)}` : "");
  const chips = [qty, p.unit ? (unitByKey(p.unit)?.names[0] ?? p.unit) : null, p.food, p.note].filter(Boolean) as string[];
  if (!chips.length) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="Parsed as">
      {chips.map((c, i) => (
        <span key={i} className="rounded-full border border-line px-2 py-0.5">
          {c}
        </span>
      ))}
    </p>
  );
}

function SortableItem({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const s = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={s.setActivatorNodeRef}
      {...s.attributes}
      {...s.listeners}
      aria-label="Reorder"
      className="inline-flex size-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted hover:bg-sunken"
    >
      <GripVertical className="size-5" aria-hidden />
    </button>
  );
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cn("flex items-start gap-0.5 rounded-md", s.isDragging && "relative z-10 bg-surface shadow-md")}
    >
      {children(handle)}
    </li>
  );
}

function AutoTextarea({ value, inputRef, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; inputRef: Ref<HTMLTextAreaElement> }) {
  const local = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = local.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      {...rest}
      value={value}
      rows={1}
      ref={(el) => {
        local.current = el;
        if (typeof inputRef === "function") inputRef(el);
      }}
      className={cn(field, "resize-none overflow-hidden leading-relaxed")}
    />
  );
}

type El = HTMLInputElement | HTMLTextAreaElement;

export function RowsEditor({ kind, rows, onChange }: { kind: "ingredient" | "step"; rows: Row[]; onChange: (rows: Row[]) => void }) {
  const els = useRef(new Map<string, El>());
  const pending = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (pending.current) {
      els.current.get(pending.current)?.focus();
      pending.current = null;
    }
  });

  const set = (next: Row[], focus?: string) => {
    if (focus) pending.current = focus;
    onChange(next);
  };
  const insertAfter = (i: number, ...add: Row[]) => set([...rows.slice(0, i + 1), ...add, ...rows.slice(i + 1)], add[add.length - 1]?.id);
  const remove = (i: number) => {
    if (rows.length === 1) return set([newRow()]);
    set(
      rows.filter((_, j) => j !== i),
      (rows[i - 1] ?? rows[i + 1])?.id,
    );
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    set(arrayMove(rows, i, j), rows[i]!.id);
  };
  const update = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = rows.findIndex((r) => r.id === e.active.id);
    const to = rows.findIndex((r) => r.id === e.over!.id);
    set(arrayMove(rows, from, to), String(e.active.id));
  };

  const onKeyDown = (i: number, row: Row) => (e: KeyboardEvent<El>) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(i, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      insertAfter(i, newRow());
    } else if (e.key === "Backspace" && row.text === "" && rows.length > 1) {
      e.preventDefault();
      remove(i);
    }
  };

  const onPaste = (i: number, row: Row) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/\n/.test(text.trim())) return;
    const added = rowsFromPaste(text);
    if (!added.length) return;
    e.preventDefault();
    const blank = row.kind === "item" && row.text.trim() === "";
    const next = blank ? [...rows.slice(0, i), ...added, ...rows.slice(i + 1)] : [...rows.slice(0, i + 1), ...added, ...rows.slice(i + 1)];
    set(next, added[added.length - 1]!.id);
  };

  const noun = kind === "ingredient" ? "ingredient" : "step";
  let n = 0;
  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {rows.map((row, i) => {
              const header = row.kind === "header";
              if (!header) n++;
              const label = header ? `Section name (${noun}s)` : `${kind === "ingredient" ? "Ingredient" : "Step"} ${n}`;
              const setRef = (el: El | null) => {
                if (el) els.current.set(row.id, el);
                else els.current.delete(row.id);
              };
              const shared = {
                "aria-label": label,
                value: row.text,
                onChange: (e: { target: { value: string } }) => update(i, { text: e.target.value }),
                onKeyDown: onKeyDown(i, row),
              };
              return (
                <SortableItem key={row.id} id={row.id}>
                  {(handle) => (
                    <>
                      {handle}
                      <div className="min-w-0 flex-1">
                        {header ? (
                          <input {...shared} ref={setRef} placeholder="Section name" className={cn(field, "font-semibold")} />
                        ) : kind === "ingredient" ? (
                          <>
                            <input
                              {...shared}
                              ref={setRef}
                              placeholder={i === 0 ? "e.g. 2 cups flour, sifted" : "Add an ingredient"}
                              onPaste={onPaste(i, row)}
                              className={field}
                            />
                            <Preview text={row.text} />
                          </>
                        ) : (
                          <AutoTextarea {...shared} inputRef={setRef} placeholder={i === 0 ? "Describe the first step" : "Add a step"} />
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton aria-label={`${label} options`}>
                            <Ellipsis className="size-5" aria-hidden />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={i === 0} className="data-[disabled]:opacity-50" onSelect={() => move(i, -1)}>
                            <ArrowUp className="size-4" aria-hidden />
                            Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={i === rows.length - 1} className="data-[disabled]:opacity-50" onSelect={() => move(i, 1)}>
                            <ArrowDown className="size-4" aria-hidden />
                            Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              set(
                                rows.map((r, j) => (j === i ? { ...r, kind: header ? "item" : "header" } : r)),
                                row.id,
                              )
                            }
                          >
                            <Heading className="size-4" aria-hidden />
                            {header ? `Make this ${noun}` : "Make this a section header"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => remove(i)}>
                            <Trash2 className="size-4" aria-hidden />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </SortableItem>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => insertAfter(rows.length - 1, newRow())}>
          <Plus className="size-4" aria-hidden />
          Add {noun}
        </Button>
        <Button variant="ghost" onClick={() => insertAfter(rows.length - 1, newRow("", "header"))}>
          <Heading className="size-4" aria-hidden />
          Add section
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">
        {kind === "ingredient" ? "Enter adds a row. Paste a whole list into a row to split it. " : "Enter adds a step, Shift+Enter a line break. "}
        Alt+Up or Down moves a row.
      </p>
    </div>
  );
}
