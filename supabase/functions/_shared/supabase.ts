export const env = (name: string): string => Deno.env.get(name) ?? "";

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const bearer = (req: Request): string => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

export async function rest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", env("SUPABASE_ANON_KEY"));
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  return await fetch(`${env("SUPABASE_URL")}${path}`, { ...init, headers });
}

export async function rpc(name: string, token: string, args: Record<string, unknown>): Promise<Response> {
  return await rest(`/rest/v1/rpc/${name}`, token, { method: "POST", body: JSON.stringify(args) });
}

export async function serviceRpc(name: string, args: Record<string, unknown>): Promise<Response> {
  return await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
}

export function claims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? "";
    const text = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function signedInAt(c: Record<string, unknown>): number {
  const amr = Array.isArray(c.amr) ? c.amr : [];
  const times = amr
    .map((a) => a as Record<string, unknown>)
    .filter((a) => a?.method === "password" || a?.method === "totp")
    .map((a) => Number(a.timestamp))
    .filter((t) => Number.isFinite(t) && t > 0);
  return times.length ? Math.max(...times) : 0;
}

export const webUrl = (): string => (env("NATIVECLOUD_WEB_URL") || "https://cloud.nativecompute.net").replace(/\/+$/, "");

export function safeNext(next: unknown): string {
  if (typeof next !== "string" || next.length > 300) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return /^\/[A-Za-z0-9/_\-.~?=&%]*$/.test(next) ? next : "/";
}

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = [webUrl(), ...env("NATIVECLOUD_WEB_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean)];
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    const extra = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: extra });
    if (req.method !== "POST") return json(405, { error: "nc:method" });
    const res = await handler(req).catch(() => json(500, { error: "nc:server" }));
    for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
    return res;
  });
}

export async function errorOf(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const message = String(body.message ?? body.error ?? body.msg ?? "");
  return message.startsWith("nc:") ? message : "nc:server";
}

export async function sessionFor(email: string): Promise<Record<string, unknown> | null> {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const link = await fetch(`${env("SUPABASE_URL")}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!link.ok) return null;
  const made = await link.json();
  const hashed = made.hashed_token ?? made.properties?.hashed_token;
  if (typeof hashed !== "string") return null;
  const verified = await fetch(`${env("SUPABASE_URL")}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: env("SUPABASE_ANON_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  if (!verified.ok) return null;
  return await verified.json();
}

export async function challengeOf(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
