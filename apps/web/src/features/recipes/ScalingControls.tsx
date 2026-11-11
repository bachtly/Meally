import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { UnitChoice } from "@meally/shared";
import { Button, IconButton } from "../../ui";

export const UNIT_CHOICES: Array<{ value: UnitChoice; label: string }> = [
  { value: "original", label: "Original" },
  { value: "metric", label: "Metric" },
  { value: "us", label: "US" },
];

const MAX = 999;

export function ServingsStepper({ value, original, onChange }: { value: number; original: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    setDraft(raw);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= MAX) onChange(n);
  };
  return (
    <div className="flex items-center gap-1">
      <IconButton aria-label="Fewer servings" disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <Minus className="size-4" aria-hidden />
      </IconButton>
      <input
        aria-label="Servings"
        inputMode="numeric"
        value={draft}
        onChange={(e) => commit(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setDraft(String(value))}
        onFocus={(e) => e.target.select()}
        className="min-h-11 w-14 rounded-md border border-line bg-raised text-center font-medium"
      />
      <IconButton aria-label="More servings" disabled={value >= MAX} onClick={() => onChange(value + 1)}>
        <Plus className="size-4" aria-hidden />
      </IconButton>
      {value !== original && (
        <Button variant="ghost" size="sm" onClick={() => onChange(original)}>
          <RotateCcw className="size-4" aria-hidden />
          Reset servings
        </Button>
      )}
    </div>
  );
}

export function UnitsToggle({ value, onChange }: { value: UnitChoice; onChange: (u: UnitChoice) => void }) {
  return (
    <div role="radiogroup" aria-label="Units" className="inline-flex rounded-md border border-line bg-sunken p-0.5">
      {UNIT_CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          onClick={() => onChange(c.value)}
          className={`min-h-10 rounded px-3 text-sm font-medium ${value === c.value ? "bg-raised text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
