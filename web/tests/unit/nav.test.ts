import { describe, expect, it } from "vitest";
import { appRequest, handoff, loopback, safeNext, withNext } from "../../src/lib/nav";

describe("safeNext", () => {
  it("keeps paths on the panel", () => {
    expect(safeNext("/o/acme/members")).toBe("/o/acme/members");
    expect(safeNext("/login?app=blackline&device=Ann%27s%20Mac&state=abc")).toBe("/login?app=blackline&device=Ann%27s%20Mac&state=abc");
  });
  it("refuses anything that could leave the panel", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/a b", "", null, 42, "/x\"y", `/${"a".repeat(700)}`]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
  it("adds next only when it says something", () => {
    expect(withNext("/sign-in", "/")).toBe("/sign-in");
    expect(withNext("/sign-in", "https://evil.example")).toBe("/sign-in");
    expect(withNext("/sign-in", "/o/acme")).toBe("/sign-in?next=%2Fo%2Facme");
  });
});

describe("app sign-in requests", () => {
  const ok = { app: "blackline", device: "Ann's Mac", challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", state: "Zm9vYmFyYmF6cXV4", port: "51234" };
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  it("reads a good one", () => {
    expect(appRequest(q(ok))).toEqual({ ...ok, port: 51234, signup: false });
    expect(appRequest(q({ ...ok, mode: "signup" }))?.signup).toBe(true);
  });
  it("refuses broken ones", () => {
    expect(appRequest(q({ ...ok, app: "Black Line" }))).toBeNull();
    expect(appRequest(q({ ...ok, challenge: "short" }))).toBeNull();
    expect(appRequest(q({ ...ok, state: "x" }))).toBeNull();
    expect(appRequest(q({ ...ok, port: "80" }))).toBeNull();
    expect(appRequest(q({ ...ok, port: "70000" }))).toBeNull();
    expect(appRequest(q({ ...ok, port: "5.5" }))).toBeNull();
  });
  it("only ever goes back to this computer", () => {
    const r = appRequest(q(ok))!;
    expect(loopback(r, { code: "ABCD2345" })).toBe("http://127.0.0.1:51234/callback?code=ABCD2345&state=Zm9vYmFyYmF6cXV4");
    expect(loopback(r, { error: "cancelled" })).toBe("http://127.0.0.1:51234/callback?error=cancelled&state=Zm9vYmFyYmF6cXV4");
  });
});

describe("hand-off links", () => {
  it("reads the token and a safe next", () => {
    expect(handoff("#t=ABCD2345&next=%2Fo%2Facme%2Fmembers")).toEqual({ token: "ABCD2345", next: "/o/acme/members" });
    expect(handoff("#t=ABCD2345&next=https%3A%2F%2Fevil.example")).toEqual({ token: "ABCD2345", next: "/" });
    expect(handoff("#next=%2F")).toBeNull();
  });
});
