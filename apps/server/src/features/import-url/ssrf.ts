/** 4 or 6 for an IP literal, 0 otherwise (a runtime-neutral `net.isIP`). */
export function isIP(s: string): 0 | 4 | 6 {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m) return m.slice(1).every((o) => Number(o) <= 255 && (o === "0" || !o.startsWith("0"))) ? 4 : 0;
  if (!s.includes(":") || !/^[0-9a-fA-F:.%\w]+$/.test(s)) return 0;
  return groups6(s) ? 6 : 0;
}

/** Expands an IPv6 literal to eight 16-bit groups, or null when malformed. */
function groups6(ip: string): number[] | null {
  let s = ip.split("%")[0]!.toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1]!.split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -v4[1]!.length) + ((p[0]! << 8) | p[1]!).toString(16) + ":" + ((p[2]! << 8) | p[3]!).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...tail].map((h) => parseInt(h, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}

function blockedV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number) as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local and cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for any address a public server should never be made to contact. Unparseable input is blocked. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blockedV4(ip);
  if (kind !== 6) return true;
  const g = groups6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => blockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  // ::, ::1, IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms all reduce to the embedded IPv4 check.
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return embedded(g[6]!, g[7]!);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return embedded(g[6]!, g[7]!); // NAT64
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  return (
    (g[0]! & 0xfe00) === 0xfc00 || // unique local
    (g[0]! & 0xffc0) === 0xfe80 || // link-local
    (g[0]! & 0xff00) === 0xff00 || // multicast
    (g[0] === 0x2001 && g[1] === 0xdb8) // documentation
  );
}
