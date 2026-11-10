# Architecture

NativeCloud is one account system shared by every NativeCompute app. Each app keeps its documents as **projects**:
- **Blackline:** a project is a script, and its body is exactly the Markdown file Blackline saves to disk.
- **Tesseract and later apps:** they add rows to `apps` and store their own format the same way.

```
 Blackline / other NCF apps                 Supabase project "nativecloud"
 ┌──────────────────────────┐   HTTPS   ┌──────────────────────────────────────┐
 │ app: CloudStore           │ ───────▶ │ Auth: accounts, codes, sessions       │
 │ ncf::cloud: auth, engine, │          │ PostgREST: reads under RLS            │
 │   outbox, UI cards         │          │ Postgres functions: every write       │
 │ local cache (.md files)    │          │ Edge Functions: invite mail, deletion │
 └──────────────────────────┘          └──────────────────────────────────────┘
```

## Ideas that carry the design
- **Spaces.** Every account has one personal space ("My cloud") and can own or join teams. A project lives in exactly one space and can move.
- **Server-checked writes.** Tables are read-only to clients. Every change goes through a Postgres function that checks the caller's role, the edit lock, the version and the plan's limits in one transaction. The rules therefore hold whichever client calls, including a future web app.
- **Optimistic versions.**
  - Each save carries the version it started from. A save from an older version returns `conflict` with the newer text, and nothing is overwritten.
  - The app installs the newer text and keeps the user's as a snapshot.
- **One writer at a time.**
  - A lease, renewed every 30 s and expiring after 90 s, is the edit lock. Others open the script read-only and watch it change.
  - The lock is per device, so your own second computer sees "Editing on your MacBook" and can take over.
  - Live co-writing can come later. CRDT updates would be added beside `projects.body`, which stays the readable copy.
- **Offline first in the app.**
  - Every cloud script is also a local file.
  - Edits made offline queue up and send on reconnect.
  - If someone else changed the script meanwhile, theirs wins and yours becomes an `offline` snapshot. Nothing is lost.
- **A change feed instead of sockets.** `changes_since(seq)` returns what moved in your spaces since you last asked. Clients poll it every 30 s, or every 5 s while watching someone else's lock. This keeps the free tier's realtime quota untouched; Realtime can replace the polling later.
- **Plans in data.**
  - Limits live in `plans` and are checked server-side, and every account points at a plan.
  - Going paid means adding a billing webhook that changes `profiles.plan_id`. No app release is needed.

## Tables
`profiles`, `apps`, `workspaces`, `memberships`, `invites`, `devices`, `projects`, `project_versions`, `leases`, `edit_sessions`, `stars`, `app_settings`, `changes`, `audit`, `rate`, `plans`. See the migrations in `supabase/migrations/` for every column and rule.

## What runs where
| Piece | Where |
|---|---|
| Schema, security rules, functions | `supabase/migrations/`, applied by `deploy.yml` |
| Auth email templates (codes, not links) | `supabase/templates/`, set in `config.toml` |
| Invite email, account deletion | `supabase/functions/` (Deno) |
| Trash purge, expired locks, old changes | `purge_expired()`, nightly through `pg_cron` |
| Keep-alive while on the free tier | `keepalive.yml`, twice a week |
| Encrypted backups | `backup.yml`, nightly |
