import { describe, expect, it } from "vitest";
import { ago, bytes, emails, fileName, grantCode, initials, level, passwordOk, planName, price } from "../../src/lib/format";
import { ApiError, messageOf, toError } from "../../src/lib/errors";

describe("format", () => {
  it("names and sizes", () => {
    expect(initials("Ann Lee Park")).toBe("AL");
    expect(initials("  ")).toBe("?");
    expect(bytes(104857600)).toBe("100 MB");
    expect(bytes(2 * 1073741824)).toBe("2.0 GB");
    expect(bytes(150000)).toBe("0.1 MB");
    expect(grantCode("abcd2345")).toBe("ABCD-2345");
    expect(planName("studio")).toBe("Studio");
    expect(price(1900)).toBe("€19 a month");
    expect(price(0)).toBe("Free");
  });
  it("meters turn amber and red", () => {
    expect(level(1, 10)).toBe("ok");
    expect(level(8, 10)).toBe("warn");
    expect(level(10, 10)).toBe("full");
  });
  it("times", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(ago("2026-11-07T11:59:30Z", now)).toBe("Just now");
    expect(ago("2026-11-07T11:00:00Z", now)).toBe("1 hour ago");
    expect(ago(null, now)).toBe("Never");
  });
  it("passwords, emails and files", () => {
    expect(passwordOk("Correct1horse")).toBe(true);
    expect(passwordOk("short1A")).toBe(false);
    expect(emails("Ann@Example.com, ben@example.com\nann@example.com; <cal@example.com>")).toEqual(["ann@example.com", "ben@example.com", "cal@example.com"]);
    expect(fileName("Harbour: draft/2")).toBe("Harbour- draft-2");
    expect(fileName("...")).toBe("Untitled");
  });
});

describe("errors", () => {
  it("turn server codes into sentences", () => {
    expect(messageOf("nc:limit:members")).toContain("as many people");
    expect(messageOf("nc:invalid:spaces")).toContain("space");
    expect(new ApiError("nc:reauth").head).toBe("reauth");
    expect(new ApiError("nc:invalid:slug").what).toBe("slug");
    expect(toError({ message: "nc:forbidden" }).code).toBe("nc:forbidden");
    expect(toError({ message: "Invalid login credentials" }).code).toBe("invalid_credentials");
    expect(toError(new TypeError("Failed to fetch")).code).toBe("nc:offline");
  });
});
