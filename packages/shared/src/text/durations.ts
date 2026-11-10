/** A duration found in step text, with its position so the UI can turn it into a timer chip. */
export interface FoundDuration {
  /** The matched text, e.g. "1 hr 20 min". */
  text: string;
  start: number;
  end: number;
  /** Seconds to run. For a range this is the lower bound ("5-7 min" is 300). */
  seconds: number;
  /** Upper bound in seconds when the text gave a range. */
  maxSeconds?: number;
}

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
const NUM = String.raw`\d+(?:\.\d+)?(?:\s*[½¼¾⅓⅔]|\s+\d/\d)?|\d/\d|[½¼¾⅓⅔]`;
const UNIT = String.raw`hours?|hrs?|minutes?|mins?|seconds?|secs?|h|m|s`;
const PART = new RegExp(String.raw`(?<![\d./])(${NUM})(?:\s*(?:-|–|—|to)\s*(${NUM}))?(\s*)(${UNIT})(?![a-z])`, "gi");
const GAP = /^\s*(?:and|,)?\s*$/i;

function toNumber(s: string): number {
  const t = s.trim();
  let total = 0;
  for (const part of t.split(/\s+/)) {
    const f = FRACTIONS[part.slice(-1)];
    if (/^\d+(\.\d+)?[½¼¾⅓⅔]$/.test(part)) total += parseFloat(part) + f!;
    else if (f !== undefined && part.length === 1) total += f;
    else if (part.includes("/")) {
      const [a, b] = part.split("/").map(Number);
      total += b ? a! / b : 0;
    } else {
      total += parseFloat(part);
    }
  }
  return total;
}

function unitRank(u: string): { rank: number; secs: number } {
  const c = u[0]!.toLowerCase();
  if (c === "h") return { rank: 3, secs: 3600 };
  if (c === "m") return { rank: 2, secs: 60 };
  return { rank: 1, secs: 1 };
}

/**
 * Finds cooking times in free text: "10 minutes", "1 hr 20 min", "5-7 min", "1½ hours", "1h30m".
 * Compound times join into one result. Single-letter units must touch the number ("30s", not "30 s").
 */
export function parseDurations(text: string): FoundDuration[] {
  type Part = { start: number; end: number; low: number; high?: number; rank: number };
  const parts: Part[] = [];
  for (const m of text.matchAll(PART)) {
    const unit = m[4]!;
    if (unit.length === 1 && m[3]) continue;
    const { rank, secs } = unitRank(unit);
    const low = toNumber(m[1]!) * secs;
    const high = m[2] ? toNumber(m[2]) * secs : undefined;
    if (!(low > 0)) continue;
    if (high !== undefined && high <= low) continue;
    parts.push({ start: m.index!, end: m.index! + m[0].length, low, high, rank });
  }
  const out: FoundDuration[] = [];
  let group: Part[] = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const seconds = group.reduce((a, p) => a + p.low, 0);
    const maxSeconds = last.high === undefined ? undefined : seconds - last.low + last.high;
    out.push({ text: text.slice(first.start, last.end), start: first.start, end: last.end, seconds: Math.round(seconds), ...(maxSeconds !== undefined && { maxSeconds: Math.round(maxSeconds) }) });
    group = [];
  };
  for (const p of parts) {
    const prev = group[group.length - 1];
    // Only a clean (non-range) part can lead a compound; ranges end the group.
    if (prev && prev.high === undefined && p.rank < prev.rank && GAP.test(text.slice(prev.end, p.start))) group.push(p);
    else {
      flush();
      group.push(p);
    }
  }
  flush();
  return out;
}

/** "1:05:00" or "04:30", for timer displays. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
