# Security

## Rules every change keeps
- **Row Level Security is on for every table.**
  - Members read their own spaces.
  - Personal data (devices, settings, stars) is readable only by its owner.
  - Strangers see nothing, not even that a space exists.
  - Unknown and forbidden both answer `nc:not_found`, so ids can't be probed.
- **Clients never write tables.**
  - `insert`, `update` and `delete` are revoked from `anon` and `authenticated`.
  - Every write is a `security definer` function with `search_path` pinned to `public, pg_temp`. It checks the role, lock, version and limits in the same transaction.
- **Internal helpers stay internal.** Helpers such as `check_room`, `take_lease`, `purge_expired` and `prepare_account_deletion` aren't executable by signed-in users. `purge_expired` and `prepare_account_deletion` run only as `service_role`.
- **Keys:**
  - The apps contain only the public anon key.
  - The service key lives in Edge Functions and GitHub secrets, never in an app or this repo.
- **Rate limits:** saves, creates, snapshots and invites have per-minute limits, on top of Supabase's own auth rate limits.
- **Size limits:**
  - 2 MB per project and per snapshot;
  - 16 KB per settings blob and per project's `meta`;
  - 200-character titles and 80-character names.
- **Account deletion** needs a session less than 10 minutes old (sign in again first). It hands teams to the next member and removes everything else.
- **Audit log:** joins, role changes, removals, transfers, moves and deletions are written to `audit`. Owners and admins can read their team's entries.

## Tests that guard this
`tests/sql/` runs on every push, against both a plain Postgres and the real Supabase stack. It covers:
- outsiders see nothing;
- viewers can't write;
- direct table writes fail;
- a stale save is a conflict;
- an expired lock frees the script;
- limits stop creation;
- only the server can purge or prepare deletions.

`tests/api/smoke.mjs` repeats the important ones over HTTP.

## Reporting a problem
Email **hello@nativecompute.com** with "NativeCloud security" in the subject. Please don't open a public issue.
