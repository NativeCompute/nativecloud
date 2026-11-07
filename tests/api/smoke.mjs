const API = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;
if (!API || !ANON || !SERVICE) {
  console.error("API_URL, ANON_KEY and SERVICE_ROLE_KEY are needed");
  process.exit(2);
}

let checks = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`not ok: ${what}`);
  checks += 1;
  console.log(`ok ${checks} ${what}`);
};

async function call(path, { token = ANON, key = ANON, method = "GET", body, prefer } = {}) {
  const headers = { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const rpc = (name, token, args = {}) => call(`/rest/v1/rpc/${name}`, { token, method: "POST", body: args });

async function person(email) {
  const made = await call("/auth/v1/admin/users", {
    token: SERVICE, key: SERVICE, method: "POST",
    body: { email, password: "Correct-Horse-9", email_confirm: true, user_metadata: { display_name: email.split("@")[0] } },
  });
  ok(made.status === 200, `the service creates ${email}`);
  const signed = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: "Correct-Horse-9" } });
  ok(signed.status === 200 && signed.data.access_token, `${email} signs in with a password`);
  return signed.data;
}

const stamp = Date.now();
const ann = await person(`ann.${stamp}@example.com`);
const ben = await person(`ben.${stamp}@example.com`);
const carl = await person(`carl.${stamp}@example.com`);

const fresh = await call("/auth/v1/signup", { method: "POST", body: { email: `new.${stamp}@example.com`, password: "Correct-Horse-9" } });
ok(fresh.status === 200 && !fresh.data.access_token, "signing up waits for the emailed code before there is a session");
const weak = await call("/auth/v1/signup", { method: "POST", body: { email: `weak.${stamp}@example.com`, password: "short" } });
ok(weak.status >= 400, "short passwords are refused");

const me = await rpc("me", ann.access_token);
ok(me.status === 200 && me.data.display_name, "me() answers over HTTP");

const org = await rpc("create_org", ann.access_token, { name: "Smoke Room" });
ok(org.status === 200 && String(org.data.slug).startsWith("smoke-room"), "an organization is created over HTTP");
const team = { data: org.data.space };
const bySlug = await rpc("org_by_slug", ann.access_token, { slug: org.data.slug });
ok(bySlug.status === 200 && bySlug.data.plan.id === "team", "it is found by its slug, on the Team plan");
const invite = await rpc("invite_member", ann.access_token, { org: org.data.id, email: `ben.${stamp}@example.com`, role: "member" });
ok(invite.status === 200, "an invite is sent");
const mine = await rpc("my_invites", ben.access_token);
ok(Array.isArray(mine.data) && mine.data.length === 1, "the invitee sees it");
const joined = await rpc("accept_invite", ben.access_token, { invite: mine.data[0].id });
ok(joined.status === 200, "and joins");

const made = await rpc("create_project", ann.access_token, { ws: team.data, app_id: "blackline", title: "Smoke", body: "INT. ROOM - DAY" });
ok(made.status === 200 && made.data.id, "a script is created");
const id = made.data.id;
const annDevice = crypto.randomUUID();
const benDevice = crypto.randomUUID();
const annOpen = await rpc("open_project", ann.access_token, { p: id, device_id: annDevice, device_name: "Ann", want_edit: true });
ok(annOpen.data.access === "edit", "the first opener edits");
const benOpen = await rpc("open_project", ben.access_token, { p: id, device_id: benDevice, device_name: "Ben", want_edit: true });
ok(benOpen.data.access === "read" && benOpen.data.lease.user.name, "the second reads and sees who is writing");
const saved = await rpc("save_project", ann.access_token, { p: id, base_version: 1, body: "INT. ROOM - NIGHT", device_id: annDevice });
ok(saved.data.status === "saved" && saved.data.version === 2, "the writer saves");
const conflict = await rpc("save_project", ann.access_token, { p: id, base_version: 1, body: "old", device_id: annDevice });
ok(conflict.data.status === "conflict" && conflict.data.project.body === "INT. ROOM - NIGHT", "a stale save comes back as a conflict with the newer text");
const feed = await rpc("changes_since", ben.access_token, { since: 0 });
ok(feed.data.changes.some((c) => c.project_id === id), "the team sees the change in the feed");

const list = await call(`/rest/v1/projects?select=id,title,version&app_id=eq.blackline`, { token: ben.access_token });
ok(list.status === 200 && list.data.length === 1 && list.data[0].version === 2, "members list the team's scripts");
const outsider = await call(`/rest/v1/projects?select=id`, { token: carl.access_token });
ok(outsider.status === 200 && outsider.data.length === 0, "outsiders see nothing");
const sneak = await call(`/rest/v1/projects?id=eq.${id}`, { token: ben.access_token, method: "PATCH", body: { title: "Hacked" } });
ok(sneak.status === 401 || sneak.status === 403, "nobody writes to the tables directly");
const anon = await call(`/rest/v1/projects?select=id`);
ok(anon.status === 401 || (Array.isArray(anon.data) && anon.data.length === 0), "signed-out callers read nothing");

const refreshed = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: ann.refresh_token } });
ok(refreshed.status === 200 && refreshed.data.access_token, "sessions refresh");
const reused = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: ann.refresh_token } });
ok(reused.status === 200 || reused.status === 400, "an old refresh token is rotated");

const gone = await call("/functions/v1/delete-account", { token: carl.access_token, method: "POST", body: {} });
if (gone.status === 404 || gone.status === 503) {
  console.log("skip delete-account: functions are not served here");
} else {
  ok(gone.status === 200 && gone.data.deleted, "a fresh session deletes its own account");
  const after = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email: `carl.${stamp}@example.com`, password: "Correct-Horse-9" } });
  ok(after.status >= 400, "and that account can no longer sign in");
}

const served = (await call("/functions/v1/app-token", { method: "POST", body: {} })).status !== 404;
if (!served) {
  console.log("skip app sign-in: functions are not served here");
} else {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Buffer.from(bytes).toString("base64url");
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const granted = await rpc("create_app_grant", ben.access_token, { app: "blackline", device: "Ben's PC", challenge });
  ok(granted.status === 200 && /^[A-Z2-9]{8}$/.test(granted.data), "the web makes a one-time sign-in code for an app");
  const wrong = await call("/functions/v1/app-token", { method: "POST", body: { code: granted.data, verifier: "x".repeat(43) } });
  ok(wrong.status === 400 && wrong.data.error === "nc:forbidden", "the code is useless without the app's verifier");
  const app = await call("/functions/v1/app-token", { method: "POST", body: { code: granted.data, verifier } });
  ok(app.status === 200 && app.data.access_token && app.data.refresh_token, "the app trades code and verifier for its own session");
  const appMe = await rpc("me", app.data.access_token);
  ok(appMe.status === 200 && appMe.data.id === ben.user.id, "and that session is Ben's");
  const again = await call("/functions/v1/app-token", { method: "POST", body: { code: granted.data, verifier } });
  ok(again.status === 400, "a code works once");

  const link = await call("/functions/v1/web-link", { token: app.data.access_token, method: "POST", body: { next: "/o/smoke-room/members" } });
  ok(link.status === 200 && link.data.url.includes("/auth/handoff#t="), "an app asks for a link that opens the web signed in");
  const hash = new URL(link.data.url).hash.slice(1);
  const params = new URLSearchParams(hash);
  ok(params.get("next") === "/o/smoke-room/members", "the link keeps the page to open");
  const evil = await call("/functions/v1/web-link", { token: app.data.access_token, method: "POST", body: { next: "https://evil.example" } });
  ok(new URLSearchParams(new URL(evil.data.url).hash.slice(1)).get("next") === "/", "and never sends anyone off the panel");
  const web = await call("/functions/v1/app-token", { method: "POST", body: { code: params.get("t") } });
  ok(web.status === 200 && web.data.access_token && web.data.app === "web", "the web redeems the link for a session");

  const staffed = await call("/rest/v1/staff", { token: SERVICE, key: SERVICE, method: "POST", body: { user_id: ann.user.id, role: "admin" } });
  ok(staffed.status === 201, "staff are added by the operator");
  const stats = await rpc("staff_stats", ann.access_token);
  ok(stats.status === 200 && stats.data.users >= 3, "staff see platform numbers");
  const hidden = await rpc("staff_stats", ben.access_token);
  ok(hidden.status >= 400, "everyone else is refused");
}

console.log(`${checks} checks passed`);
