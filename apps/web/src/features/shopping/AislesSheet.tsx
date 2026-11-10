import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, IconButton, Input, Sheet } from "../../ui";
import { useAisleMutations, useAisles } from "./api";

function AisleRow({ id, name, first, last, onMove }: { id: string; name: string; first: boolean; last: boolean; onMove: (d: -1 | 1) => void }) {
  const m = useAisleMutations();
  const [value, setValue] = useState(name);
  return (
    <li className="flex items-center gap-1">
      <Input
        aria-label={`Aisle name, ${name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() && value.trim() !== name && m.rename.mutate({ id, name: value.trim() })}
        maxLength={60}
      />
      <IconButton aria-label={`Move ${name} up`} disabled={first} onClick={() => onMove(-1)}>
        <ArrowUp className="size-4" aria-hidden />
      </IconButton>
      <IconButton aria-label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)}>
        <ArrowDown className="size-4" aria-hidden />
      </IconButton>
      <IconButton aria-label={`Delete ${name}`} onClick={() => m.remove.mutate(id)}>
        <Trash2 className="size-4" aria-hidden />
      </IconButton>
    </li>
  );
}

export function AislesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const aisles = useAisles().data ?? [];
  const m = useAisleMutations();
  const [name, setName] = useState("");
  const sorted = [...aisles].sort((a, b) => a.position - b.position);
  const move = (i: number, d: -1 | 1) => {
    const ids = sorted.map((a) => a.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    m.reorder.mutate(ids);
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) m.create.mutate(name.trim(), { onSuccess: () => setName("") });
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Aisles" description="Items are grouped in this order.">
      <ul className="flex flex-col gap-2">
        {sorted.map((a, i) => (
          <AisleRow key={`${a.id}:${a.name}`} id={a.id} name={a.name} first={i === 0} last={i === sorted.length - 1} onMove={(d) => move(i, d)} />
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input aria-label="New aisle" placeholder="New aisle" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Button type="submit" disabled={!name.trim()}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>
    </Sheet>
  );
}
