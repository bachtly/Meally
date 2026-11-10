/** Weeks start on Monday (0 = Sunday ... 1 = Monday). */
export const WEEK_START = 1;

const DAY_MS = 86_400_000;
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const addDays = (d: string, n: number) => fmt(new Date(parse(d).getTime() + n * DAY_MS));

export function startOfWeek(d: string): string {
  const dow = parse(d).getUTCDay();
  return addDays(d, -((dow - WEEK_START + 7) % 7));
}

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" }) =>
  new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(parse(d));

export const weekLabel = (start: string) =>
  `${dayLabel(start, { month: "short", day: "numeric" })} – ${dayLabel(addDays(start, 6), { month: "short", day: "numeric", year: "numeric" })}`;
