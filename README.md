# NativeCloud

Accounts, cloud sync and organizations for NativeCompute apps, and the web panel at cloud.nativecompute.net where accounts are managed. Blackline is first; Tesseract and later apps share the same account.

It runs on Supabase:
- Postgres holds every account, organization and project;
- Row Level Security decides who reads what;
- Postgres functions make every change;
- Edge Functions sign apps in, hand them over to the web, send invite emails and delete accounts.

## What's here
| Path | What |
|---|---|
| `supabase/migrations/` | Schema, security rules and functions. The source of truth. |
| `supabase/functions/` | `app-token`, `web-link`, `send-invite`, `delete-account` and `staff-delete-user` (Deno). |
| `web/` | The web panel at cloud.nativecompute.net. See [WEB.md](docs/WEB.md). |
| `supabase/templates/` | Sign-up, password and email-change emails. They send 6-digit codes. |
| `supabase/config.toml` | Local stack and auth settings. |
| `tests/sql/` | Database tests: roles, locks, conflicts, limits, deletion. |
| `tests/api/smoke.mjs` | The same flows over HTTP against a running stack. |
| `.github/workflows/` | Tests on every push (including the panel end to end), deploy on a `v*` tag, keep-alive and nightly encrypted backups. |
| `docs/` | How it works and how to run it. |

## Docs
- [Architecture](docs/ARCHITECTURE.md): spaces, versions, the edit lock, offline and the change feed.
- [API](docs/API.md): every call an app makes.
- [Web panel](docs/WEB.md): pages, signing apps in, running and testing it.
- [Security](docs/SECURITY.md): the rules every change keeps.
- [Plans and limits](docs/PLANS.md)
- [Operations](docs/OPERATIONS.md): setup, backups, when to move to Pro, incidents.
- Drafts of the [privacy policy](docs/legal/privacy.md) and [terms](docs/legal/terms.md).

## Running the tests
**Without Supabase**, on any machine with Postgres 15 or later:
```
bash tests/run.sh local
```
This starts a throwaway Postgres, adds a small stand-in for Supabase's `auth` schema, applies the migrations and runs `tests/sql/`.

**With the real stack** (Docker and the Supabase CLI):
```
supabase start
eval "$(supabase status -o env)"
DATABASE_URL="$DB_URL" bash tests/run.sh remote
API_URL="$API_URL" ANON_KEY="$ANON_KEY" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node tests/api/smoke.mjs
```

`bash tools/no-comments.sh` checks that the source carries no comments, only short `-- name here` markers.

## Changing the schema
Add a new migration and never edit one that's been deployed. Add tests for the change in `tests/sql/`, then tag a release to deploy it.
