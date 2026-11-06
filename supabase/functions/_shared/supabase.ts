export const env = (name: string): string => Deno.env.get(name) ?? "";

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
