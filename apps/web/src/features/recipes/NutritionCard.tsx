import { nutritionFields, type Nutrition } from "@meally/shared";

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** A label-style table. Values are per serving; the total column follows the servings stepper. */
export function NutritionCard({ nutrition, servings }: { nutrition: Nutrition; servings: number | null }) {
  const rows = nutritionFields.filter((f) => nutrition[f.key] != null);
  const showTotal = servings != null && servings > 0;
  return (
    <section aria-labelledby="nutrition-h" className="mt-10 max-w-md rounded-lg border border-line p-4">
      <h2 id="nutrition-h" className="mb-2 text-xl font-semibold">
        Nutrition
      </h2>
      <table className="w-full text-sm">
        <caption className="sr-only">Nutrition facts</caption>
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Nutrient</span>
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Per serving
            </th>
            {showTotal && (
              <th scope="col" className="py-1 text-right font-medium">
                Total for {fmt(servings)}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const v = nutrition[f.key]!;
            return (
              <tr key={f.key} className="border-b border-line">
                <th scope="row" className="py-1 text-left font-normal">
                  {f.label}
                </th>
                <td className="py-1 text-right tabular-nums">
                  {fmt(v)} {f.unit}
                </td>
                {showTotal && (
                  <td className="py-1 text-right tabular-nums">
                    {fmt(v * servings)} {f.unit}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {nutrition.source && <p className="mt-2 text-xs text-muted">Source: {nutrition.source}</p>}
    </section>
  );
}
