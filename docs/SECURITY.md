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
- **Account deletion** needs a session signed in less than 10 minutes ago. That's the sign-in time in the token's `amr` claim, which a token refresh doesn't change. It hands organizations to the next admin or member and removes everything else. Deleting an organization or a space, and handing an organization over, need a fresh session too (`nc:reauth`).
- **Passwords only on the web.** Apps sign in through the browser with an authorization code and PKCE (RFC 8252), so they never see a password, email code or second factor. Sign-in codes are stored only as hashes, last 2 minutes, work once, and are useless without the app's verifier; five wrong verifiers burn a code. Every app has its own session, so each one can be signed out on its own.
- **Web handoff links** carry a one-time code in the URL fragment, which never reaches a server log. The code lasts 5 minutes and only ever leads to a path on the panel.
- **Staff** are rows in `staff`, added by hand. Support staff can look and change plans; only staff admins suspend or delete. Every staff action is written to `audit`, and the console is invisible (`nc:not_found`) to everyone else.
- **Suspension:** a suspended account is stopped at every function (`nc:suspended`). A suspended organization is read-only, and its locks are freed.
- **Audit log:** joins, role changes, removals, transfers, moves and deletions are written to `audit`. Owners and admins can read their team's entries.

- **The web panel** sends a strict Content Security Policy with no third-party scripts, keeps codes in URL fragments or on `127.0.0.1`, and only redirects to paths on itself. See [WEB.md](WEB.md#security).

## Tests that guard this
`tests/sql/` runs on every push, against both a plain Postgres and the real Supabase stack. It covers:
- outsiders see nothing;
- viewers can't write;
- direct table writes fail;
- a stale save is a conflict;
- an expired lock frees the script;
- limits stop creation;
- only the server can purge or prepare deletions;
- organization roles, guests, spaces, slugs, tier limits and fresh-session checks;
- sign-in codes: hashing, expiry, single use and the five-try limit;
- staff checks.

`tests/api/smoke.mjs` repeats the important ones over HTTP.

## Reporting a problem
Email **hello@nativecompute.com** with "NativeCloud security" in the subject. Please don't open a public issue.
