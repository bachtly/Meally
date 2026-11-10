import { useId } from "react";
import { mealTypes, type MealType } from "@meally/shared";
import { cn } from "../../ui";

export const MEAL_LABEL: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

/** Segmented control built from native radios, so keyboard and screen readers work for free. */
export function MealTypeControl({ value, onChange }: { value: MealType; onChange: (m: MealType) => void }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium">Meal</legend>
      <div className="grid grid-cols-4 gap-1 rounded-md bg-sunken p-1">
        {mealTypes.map((m) => (
          <label
            key={m}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center rounded px-1 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2",
              value === m ? "bg-raised font-medium shadow-sm" : "text-muted",
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={value === m} onChange={() => onChange(m)} />
            {MEAL_LABEL[m]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
