const SAFE = /^\/[A-Za-z0-9/_\-.~?=&%+]*$/;

export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length > 600) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return SAFE.test(next) ? next : fallback;
}

export function withNext(path: string, next: string | null | undefined): string {
  const n = safeNext(next ?? "", "");
  return n && n !== "/" ? `${path}?next=${encodeURIComponent(n)}` : path;
}

export function query(search?: string): URLSearchParams {
  return new URLSearchParams(search ?? (typeof location === "undefined" ? "" : location.search));
}

export interface AppRequest {
  app: string;
  device: string;
  challenge: string;
  state: string;
  port: number;
  signup: boolean;
}

export function appRequest(q: URLSearchParams): AppRequest | null {
  const app = q.get("app") ?? "";
  const device = (q.get("device") ?? "").trim().slice(0, 80);
  const challenge = q.get("challenge") ?? "";
  const state = q.get("state") ?? "";
  const port = Number(q.get("port") ?? "");
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(app)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return null;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(state)) return null;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { app, device, challenge, state, port, signup: q.get("mode") === "signup" };
}

export function loopback(req: AppRequest, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, state: req.state });
  return `http://127.0.0.1:${req.port}/callback?${q.toString()}`;
}

export function handoff(hash: string): { token: string; next: string } | null {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const token = (h.get("t") ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!token || token.length > 32) return null;
  return { token, next: safeNext(h.get("next") ?? "/") };
}
