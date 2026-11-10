import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { cn } from "../../ui";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Multi-select combobox (ARIA 1.2 list autocomplete): chips for the chosen names, a typeahead over
 * existing names, and a "Create 'x'" row for new ones. Values are plain names.
 */
export function OrganizerPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const typed = text.trim().replace(/\s+/g, " ");
  const matches = options
    .filter((o) => !value.some((v) => same(v, o)) && o.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 8);
  const canCreate = typed !== "" && !options.some((o) => same(o, typed)) && !value.some((v) => same(v, typed));
  const rows: Array<{ kind: "existing" | "create"; name: string }> = [
    ...matches.map((name) => ({ kind: "existing" as const, name })),
    ...(canCreate ? [{ kind: "create" as const, name: typed }] : []),
  ];
  const listId = `${id}-list`;
  const showList = open && rows.length > 0;
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));

  const add = (name: string) => {
    if (!value.some((v) => same(v, name))) onChange([...value, name]);
    setText("");
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(rows.length ? (activeIndex + 1) % rows.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(rows.length ? (activeIndex - 1 + rows.length) % rows.length : 0);
    } else if (e.key === "Enter") {
      // Never submit the recipe form from here.
      e.preventDefault();
      const row = showList ? rows[activeIndex] : typed ? { name: typed } : undefined;
      if (row) add(row.name);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && text === "" && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1.5 focus-within:ring-2 focus-within:ring-accent">
          {value.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full bg-sunken py-0.5 pl-2.5 pr-1 text-sm">
              {name}
              <button
                type="button"
                aria-label={`Remove ${name} from ${label}`}
                onClick={() => onChange(value.filter((v) => v !== name))}
                className="inline-flex size-6 items-center justify-center rounded-full hover:bg-line"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          <input
            id={`${id}-input`}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${id}-opt-${activeIndex}` : undefined}
            autoComplete="off"
            value={text}
            placeholder={value.length ? "" : "Type to search or add"}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className="min-h-8 min-w-[8rem] flex-1 bg-transparent px-1 text-base text-ink outline-none placeholder:text-muted"
          />
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          hidden={!showList}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-line bg-raised p-1 shadow-md"
        >
          {rows.map((row, i) => (
            <li
              key={row.kind + row.name}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              // mousedown keeps focus in the input so blur does not close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                add(row.name);
              }}
              className={cn("cursor-pointer rounded px-3 py-2", i === activeIndex && "bg-sunken")}
            >
              {row.kind === "create" ? <>Create &lsquo;{row.name}&rsquo;</> : row.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
