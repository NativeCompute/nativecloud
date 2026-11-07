import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page } from "@playwright/test";

export const API = (process.env.API_URL ?? "http://127.0.0.1:54321").replace(/\/+$/, "");
export const ANON = process.env.ANON_KEY ?? "";
export const SERVICE = process.env.SERVICE_ROLE_KEY ?? "";
export const MAIL = (process.env.MAILPIT_URL ?? "http://127.0.0.1:54324").replace(/\/+$/, "");
export const PASSWORD = "Correct1horse";

export const unique = (tag: string) => `${tag}.${Date.now().toString(36)}${randomBytes(2).toString("hex")}@example.com`;

async function call(path: string, init: RequestInit & { key?: string; token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", init.key ?? ANON);
  headers.set("authorization", `Bearer ${init.token ?? init.key ?? ANON}`);
  headers.set("content-type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

export interface User {
  id: string;
  email: string;
  token: string;
}

export async function makeUser(name: string, email = unique(name.toLowerCase())): Promise<User> {
  const made = await call("/auth/v1/admin/users", {
    method: "POST",
    key: SERVICE,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name } }),
  });
  expect(made.ok, JSON.stringify(made.body)).toBeTruthy();
  return { id: made.body.id, email, token: await passwordToken(email) };
}

export async function passwordToken(email: string, password = PASSWORD): Promise<string> {
  const s = await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  expect(s.ok, JSON.stringify(s.body)).toBeTruthy();
  return s.body.access_token;
}

export async function rpc(token: string, name: string, args: Record<string, unknown> = {}) {
  return call(`/rest/v1/rpc/${name}`, { method: "POST", token, body: JSON.stringify(args) });
}

export async function fn(token: string, name: string, body: Record<string, unknown>) {
  return call(`/functions/v1/${name}`, { method: "POST", token, body: JSON.stringify(body) });
}

export async function makeStaff(user: User, role: "support" | "admin" = "admin") {
  const r = await call("/rest/v1/staff", { method: "POST", key: SERVICE, body: JSON.stringify({ user_id: user.id, role }) });
  expect(r.ok, JSON.stringify(r.body)).toBeTruthy();
}

export async function mailCode(email: string, after = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const list = res.ok ? await res.json() : { messages: [] };
    const fresh = (list.messages ?? []).filter((m: any) => Date.parse(m.Created) >= after);
    if (fresh.length) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${fresh[0].ID}`)).json();
      const code = String(msg.Text ?? msg.HTML ?? "").match(/\b(\d{6})\b/);
      if (code?.[1]) return code[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no code arrived for ${email}`);
}

export async function signIn(page: Page, email: string, path = "/") {
  await page.goto(`/sign-in?next=${encodeURIComponent(path)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

export function pkce() {
  const b64 = (b: Buffer) => b.toString("base64url");
  const verifier = b64(randomBytes(32));
  return { verifier, challenge: b64(createHash("sha256").update(verifier).digest()), state: b64(randomBytes(16)) };
}

export async function loopback() {
  const hits: URL[] = [];
  const server = createServer((req, res) => {
    hits.push(new URL(req.url ?? "/", "http://127.0.0.1"));
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>App</title><p>You're signed in.</p>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { port, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function redeem(code: string, verifier?: string) {
  return call("/functions/v1/app-token", { method: "POST", body: JSON.stringify(verifier ? { code, verifier } : { code }) });
}
