import { expect, test } from "@playwright/test";
import { PASSWORD, fn, loopback, mailCode, makeStaff, makeUser, pkce, redeem, rpc, signIn, unique } from "./stack";

test.describe.configure({ mode: "serial" });

test("signing up with the emailed code, then an organization, an invite and a role change", async ({ page, browser }) => {
  const email = unique("dee");
  const started = Date.now() - 2000;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Dee Park");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify\?email=/);
  await page.getByLabel("Code").fill(await mailCode(email, started));
  await expect(page.getByRole("heading", { name: "My cloud" })).toBeVisible();

  await page.goto("/new");
  const name = `Room ${Date.now().toString(36)}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/o\/room-[a-z0-9-]+\/members$/);
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  const slug = new URL(page.url()).pathname.split("/")[2]!;

  const eve = await makeUser("Eve Stone");
  await page.getByRole("button", { name: "Invite people" }).first().click();
  await page.getByLabel("Emails").fill(eve.email);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("cell", { name: eve.email })).toBeVisible();

  const other = await browser.newContext();
  const eves = await other.newPage();
  await signIn(eves, eve.email, "/me");
  await expect(eves.getByText("invited you to").first()).toBeVisible();
  await eves.getByRole("button", { name: "Join" }).click();
  await expect(eves).toHaveURL(new RegExp(`/o/${slug}$`));
  await expect(eves.getByRole("heading", { name })).toBeVisible();
  await other.close();

  await page.reload();
  await expect(page.getByRole("region", { name: "People" })).toBeVisible();
  await page.getByLabel("Role for Eve Stone").selectOption("admin");
  await expect(page.getByText("Eve Stone is an admin now.")).toBeVisible();

  await page.goto(`/o/${slug}/spaces`);
  await expect(page.getByRole("region", { name: "1 space" })).toBeVisible();
  await page.getByLabel("New space").fill("Season 2");
  await expect(page.getByRole("button", { name: "Create space" })).toBeEnabled();
  await page.getByRole("button", { name: "Create space" }).click();
  await expect(page.getByText("Season 2", { exact: true })).toBeVisible();
});

test("an app signs in through /login, once, with its own verifier", async ({ page }) => {
  const ann = await makeUser("Ann Lee");
  const app = await loopback();
  const p = pkce();
  const url = `/login?app=blackline&device=${encodeURIComponent("Ann's Mac")}&challenge=${p.challenge}&state=${p.state}&port=${app.port}`;
  await page.goto(url);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.getByLabel("Email", { exact: true }).fill(ann.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Blackline?" })).toBeVisible();
  await expect(page.getByText("Ann's Mac")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => app.hits.length).toBe(1);
  const hit = app.hits[0]!;
  expect(hit.pathname).toBe("/callback");
  expect(hit.searchParams.get("state")).toBe(p.state);
  const code = hit.searchParams.get("code")!;
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  expect((await redeem(code, pkce().verifier)).body.error).toBe("nc:forbidden");
  const s = await redeem(code, p.verifier);
  expect(s.status).toBe(200);
  expect(s.body.user.email).toBe(ann.email);
  const me = await rpc(s.body.access_token, "me");
  expect(me.body.email).toBe(ann.email);
  expect((await redeem(code, p.verifier)).body.error).toBe("nc:not_found");

  await page.goBack();
  await expect(page.locator(".code-box")).toHaveCount(0);
  await page.getByRole("button", { name: "Blackline didn't open" }).click();
  await expect(page.locator(".code-box")).toHaveText(`${code.slice(0, 4)}-${code.slice(4)}`);

  const q = pkce();
  await page.goto(`/login?app=blackline&device=PC&challenge=${q.challenge}&state=${q.state}&port=${app.port}`);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => app.hits.length).toBe(2);
  expect(app.hits[1]!.searchParams.get("error")).toBe("cancelled");
  expect(app.hits[1]!.searchParams.get("state")).toBe(q.state);

  await page.goto(`/login?app=blackline&device=PC&challenge=short&state=${q.state}&port=${app.port}`);
  await expect(page.getByRole("heading", { name: "This link is broken" })).toBeVisible();
  await app.close();
});

test("Manage on the web signs the app's person in and opens the page", async ({ page }) => {
  const ben = await makeUser("Ben Ito");
  const link = await fn(ben.token, "web-link", { next: "/account/computers" });
  expect(link.status).toBe(200);
  const hash = new URL(link.body.url).hash;
  await page.goto(`/auth/handoff${hash}`);
  await expect(page.getByText(ben.email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Continue as ${ben.email}` }).click();
  await expect(page).toHaveURL(/\/account\/computers$/);
  await expect(page.getByRole("heading", { name: "Computers" })).toBeVisible();
  await page.goto(`/auth/handoff${hash}`);
  await expect(page.getByRole("heading", { name: "That link has expired" })).toBeVisible();

  const evil = await fn(ben.token, "web-link", { next: "https://evil.example" });
  expect(new URL(evil.body.url).hash).toContain("next=%2F");
});

test("the projects browser shows history and restores a snapshot", async ({ page }) => {
  const cal = await makeUser("Cal Diaz");
  const made = await rpc(cal.token, "create_org", { name: `Scripts ${Date.now().toString(36)}` });
  const p = await rpc(cal.token, "create_project", { ws: made.body.space, app_id: "blackline", title: "Harbour", body: "FADE IN:\n\nfirst draft", meta: {} });
  expect(p.ok, JSON.stringify(p.body)).toBeTruthy();
  const snap = await rpc(cal.token, "take_snapshot", { p: p.body.id, label: "Before notes", kind: "manual", body: null });
  expect(snap.ok).toBeTruthy();
  const saved = await rpc(cal.token, "save_project", { p: p.body.id, base_version: 1, body: "FADE IN:\n\nsecond draft", title: null, meta: null, device_id: null });
  expect(saved.body.status).toBe("saved");

  await signIn(page, cal.email, `/o/${made.body.slug}/projects`);
  await page.getByRole("link", { name: "Harbour" }).click();
  await expect(page.locator(".script-preview")).toContainText("second draft");
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Before notes")).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await page.getByRole("dialog", { name: "Restore this snapshot?" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Restored.", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.locator(".script-preview")).toContainText("first draft");
});

test("the staff console is for staff only", async ({ page }) => {
  const fay = await makeUser("Fay Moss");
  const org = await rpc(fay.token, "create_org", { name: `Staff check ${Date.now().toString(36)}` });
  await signIn(page, fay.email, "/staff");
  await expect(page.getByRole("heading", { name: "Staff only" })).toBeVisible();
  await makeStaff(fay);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Staff console" })).toBeVisible();
  await expect(page.getByRole("region", { name: "People" })).toBeVisible();
  await page.getByLabel("Search people and organizations").fill(org.body.slug);
  await page.getByRole("link", { name: /Staff check/ }).click();
  await page.getByLabel("Plan", { exact: true }).selectOption("studio");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByText("Plan changed.")).toBeVisible();
  await expect(page.getByText("Studio plan")).toBeVisible();
});
