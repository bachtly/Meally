import { formatQuantity, unitByKey, type AisleLabel, type ShoppingItem } from "@meally/shared";

export interface AisleGroup {
  /** Aisle id, or null for "No aisle". */
  id: string | null;
  name: string;
  items: ShoppingItem[];
}

/** Unchecked items grouped in aisle order ("No aisle" last, empty groups dropped); checked items split off. */
export function groupItems(items: ShoppingItem[], aisles: AisleLabel[]) {
  const ordered = [...aisles].sort((a, b) => a.position - b.position);
  const byPos = (a: ShoppingItem, b: ShoppingItem) => a.position - b.position;
  const open = items.filter((i) => !i.checked).sort(byPos);
  const known = new Set(ordered.map((a) => a.id));
  const groups: AisleGroup[] = ordered.map((a) => ({ id: a.id, name: a.name, items: open.filter((i) => i.aisle === a.id) }));
  groups.push({ id: null, name: "No aisle", items: open.filter((i) => !i.aisle || !known.has(i.aisle)) });
  return { groups: groups.filter((g) => g.items.length > 0), cart: items.filter((i) => i.checked).sort(byPos) };
}

/** Splits an item into a bold amount, the name, and a muted note. */
export function itemParts(i: ShoppingItem) {
  if (i.quantity == null) return { amount: "", name: i.food ?? i.text, note: i.note };
  const def = i.unit ? unitByKey(i.unit) : undefined;
  const unit = i.unit ? (i.quantity > 1 && def ? def.plural : (def?.key ?? i.unit)) : "";
  return { amount: [formatQuantity(i.quantity), unit].filter(Boolean).join(" "), name: i.food ?? i.text, note: i.note };
}
