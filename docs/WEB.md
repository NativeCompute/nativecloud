# The web panel (cloud.nativecompute.net)

The panel is where a NativeCloud account is managed. The apps are where the writing happens. Every sign-in and every account change happens here; the apps never show a password field.

It lives in `web/`: Vite, TypeScript and Preact (`preact-iso` for routing), with `@supabase/supabase-js` for auth and data. It builds to static files and is hosted on Cloudflare Pages.

## What's on it
| Path | Page |
|---|---|
| `/sign-in`, `/sign-up`, `/verify`, `/forgot`, `/reset` | Accounts, with 6-digit email codes. Every page keeps a safe `next` path. |
| `/login?app&device&challenge&state&port` | "Sign in to Blackline on Ann's Mac?" for an app's browser sign-in. See below. |
| `/auth/handoff#t=…&next=…` | Where an app's **Manage on the web** lands. |
| `/invite/:id` | The link in an invite email: sign in or sign up, then join or decline. |
| `/me` | My cloud: your plan and your own scripts. |
| `/account`, `/account/computers`, `/account/data` | Profile, email and password; computers and sign out everywhere; export as a zip, and account deletion. |
| `/new` | Create an organization. |
| `/o/:slug` | Overview: usage, who's writing now, recent changes, a getting-started list. |
| `/o/:slug/projects` | The projects browser: find, filter by space, app, starred or Recently deleted; preview, history, restore a snapshot, download, move, delete and bring back. |
| `/o/:slug/spaces` | Create, rename, archive and delete spaces, and choose who's in each. |
| `/o/:slug/members` | People and roles, removals, pending invites (resend, take back) and the invite tray (many emails, a role, spaces for guests). |
| `/o/:slug/plan` | Tier, meters and limits, and the other tiers. |
| `/o/:slug/settings` | Name, web address, whether members may create spaces; hand over, leave, delete. |
| `/staff`, `/staff/users/:id`, `/staff/orgs/:id` | The staff console: platform numbers, search, plans and trials, suspension, deletion requests. |

Ctrl or Cmd with K opens a palette that jumps to any organization, page or project.

## Look
The panel uses NCF's web package: `ncf.css` for type, buttons, forms, trays, toasts and confirmations, and `ncf-panel.css` for the panel layout (sidebar, switcher, tables, meters, palette). Both are copied into `web/src/ncf/` from the NCF commit named in `web/ncf.ref`:
```
cd web
npm run ncf -- ../../ncf
```
CI checks the copy matches that commit. `web/src/app.css` holds only the few layout rules that belong to this app.

## Signing in to an app
1. The app opens `/login` with its id, the computer's name, a PKCE `challenge`, a random `state` and the port it listens on at `127.0.0.1`.
2. If you're signed out, the panel sends you through `/sign-in` (or `/sign-up` with `mode=signup`) and back.
3. You confirm. The panel calls `create_app_grant(app, device, challenge)` and sends the browser to `http://127.0.0.1:{port}/callback?code=…&state=…`. Cancel sends `error=cancelled` instead.
4. If the app can't be reached, going back shows the code (kept for this tab only) to type into the app.

The page refuses a link with a malformed challenge, state or port, and only ever redirects to `127.0.0.1`.

## Running it
```
cd web
npm ci
cp .env.example .env.local
npm run dev
```
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` from `supabase status`. The local stack allows the dev origins in `supabase/config.toml`.

Checks:
```
npm run check
npm test
API_URL=… ANON_KEY=… SERVICE_ROLE_KEY=… npx playwright test
```
The Playwright suite needs a running stack and a build (`npx vite build` with the two variables set). It signs up with the emailed code, creates an organization, invites a second person who joins from another browser, changes a role, plays an app through `/login` (a reused code, a wrong verifier and cancelling are all refused or reported), opens a hand-off link, restores a snapshot and checks that only staff reach the staff console.

## Security
- The build writes `_headers` with a strict Content Security Policy: scripts only from the panel itself, `connect-src` limited to the Supabase project, `frame-ancestors 'none'`. There are no third-party scripts.
- supabase-js keeps the session in `localStorage`; the CSP and the absence of third-party code are what protect it.
- Hand-off and grant codes travel in the URL fragment or straight to `127.0.0.1`, never to a server log, and work once.
- Deleting the account, handing an organization over, and deleting an organization or space need a sign-in less than 10 minutes old. The panel asks for the password again when the server answers `nc:reauth`.
