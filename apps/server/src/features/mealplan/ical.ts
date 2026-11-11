import type { MealPlanEntry } from "@meally/shared";

/** RFC 5545 section 3.3.11: escape backslash, semicolon, comma and newlines in TEXT values. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 section 3.1: lines are at most 75 octets; fold with CRLF + space, never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => compact(new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10));
const label = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);

export function buildIcal(entries: MealPlanEntry[], calName: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Meally//Meal plan//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeText(calName)}`];
  for (const e of entries) {
    const name = e.recipe?.name ?? e.title ?? "Meal";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@meally`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${escapeText(`${label(e.mealType)}: ${name}`)}`,
      ...(e.note ? [`DESCRIPTION:${escapeText(e.note)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
