export function initials(name: string): string {
  const out = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return out || "?";
}

export function bytes(n: number): string {
  const mb = n / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ${d === 1 ? "day" : "days"} ago`;
  return day(iso);
}

export function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function grantCode(code: string): string {
  const c = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function level(used: number, max: number): "ok" | "warn" | "full" {
  if (max <= 0) return "ok";
  const k = used / max;
  return k >= 0.95 ? "full" : k >= 0.8 ? "warn" : "ok";
}

export function share(used: number, max: number): number {
  return max <= 0 ? 0 : Math.min(1, Math.max(0, used / max));
}

export function planName(id: string | null | undefined): string {
  const names: Record<string, string> = { free: "Free", team: "Team", studio: "Studio", enterprise: "Enterprise" };
  if (!id) return "";
  return names[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function price(cents: number): string {
  if (cents <= 0) return "Free";
  return `€${(cents / 100).toFixed(cents % 100 ? 2 : 0)} a month`;
}

export function fileName(title: string): string {
  const clean = title
    .replace(/[^\p{L}\p{N} \-_.,'()]/gu, "-")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return clean ? Array.from(clean).slice(0, 80).join("") : "Untitled";
}

export function passwordRules(pw: string): [string, boolean][] {
  return [
    ["10+ characters", Array.from(pw).length >= 10],
    ["Upper case", /\p{Lu}/u.test(pw)],
    ["Lower case", /\p{Ll}/u.test(pw)],
    ["A digit", /\d/.test(pw)],
  ];
}

export const passwordOk = (pw: string): boolean => passwordRules(pw).every(([, ok]) => ok);

export const emailOk = (e: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(e.trim());

export function emails(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const e = part.trim().replace(/^<|>$/g, "").toLowerCase();
    if (e) seen.add(e);
  }
  return [...seen];
}
