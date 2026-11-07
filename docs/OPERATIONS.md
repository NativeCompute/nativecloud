# Operations

## First-time setup (once)
1. **Create the project.** At supabase.com, create a project named `nativecloud` on the Free plan.
   - Pick the region closest to most writers.
   - Save the database password in your password manager.
2. **Auth settings** (Authentication → Providers → Email):
   - email sign-up on;
   - **Confirm email** on;
   - OTP length 6, expiry 3600 s;
   - minimum password length 10, with lower, upper and digits.
3. **Email (custom SMTP).** Set it under Authentication → Emails → SMTP. The built-in sender only reaches the project's own team members, so public sign-up needs your own SMTP.
   - Resend's free tier gives 3,000 emails a month.
   - Verify `nativecompute.net` in Resend, then use `smtp.resend.com`, port 465, user `resend` and the API key as the password. Sender: `cloud@nativecompute.net`.
4. **Email templates.** Paste the three files from `supabase/templates/` into Authentication → Emails → Templates (Confirm signup, Reset password, Change email). They send codes, not links, so no website is needed.
5. **Edge Function secrets** (Edge Functions → Secrets):
   - `RESEND_API_KEY` (the same key);
   - `INVITE_FROM` = `NativeCloud <cloud@nativecompute.net>`;
   - `NATIVECLOUD_WEB_URL` = `https://cloud.nativecompute.net`;
   - `NATIVECLOUD_WEB_ORIGINS` = extra origins allowed to call the functions from a browser, comma-separated (for example a Cloudflare Pages preview URL).
6. **Auth URLs** (Authentication → URL Configuration): Site URL `https://cloud.nativecompute.net`.
7. **GitHub secrets on this repo** (Settings → Secrets and variables → Actions):

   | Secret | From |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access tokens |
   | `SUPABASE_PROJECT_REF` | the id in the project URL |
   | `SUPABASE_DB_PASSWORD` | step 1 |
   | `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Project Settings → API. Both are public. |
   | `SUPABASE_DB_URL` | Project Settings → Database → Connection string (session pooler) |
   | `BACKUP_AGE_PUBLIC_KEY` | `age-keygen -o nativecloud-backup.key` on your computer. Keep the key file safe and offline; paste only the `age1…` public key. |

8. **The web panel on Cloudflare Pages.**
   - In Cloudflare, create a Pages project named `nativecloud-web` (direct upload) and add the custom domain `cloud.nativecompute.net`. Cloudflare shows the one DNS record to add.
   - Add `https://cloud.nativecompute.net` to Supabase's Auth redirect URLs.
   - On this repo, add the secrets `CLOUDFLARE_API_TOKEN` (a token with Pages edit rights) and `CLOUDFLARE_ACCOUNT_ID`, and the variables `NATIVECLOUD_URL` and `NATIVECLOUD_ANON_KEY` (the same public values as `SUPABASE_URL` and `SUPABASE_ANON_KEY`).
9. **Deploy.** Actions → Deploy → Run workflow. It applies migrations, deploys every Edge Function, then builds and publishes the panel. Later, pushing a `v*` tag deploys.
10. **Make yourself staff.** In the SQL editor: `insert into public.staff values ('<your user id>', 'admin');`
11. **Point the apps at it.** The project URL and anon key go into NCF's `CloudConfig` for each app.

## Routine
- **Keep-alive:** free projects pause after 7 days without traffic. `keepalive.yml` pings twice a week. If a project does pause, restore it from the dashboard; nothing is lost.
- **Backups:**
  - `backup.yml` writes an encrypted dump every night (schema, data, roles), kept as a workflow artifact for 30 days.
  - To restore: download it, run `age -d -i nativecloud-backup.key file.tar.gz.age | tar -xz`, then load `roles.sql`, `schema.sql` and `data.sql` with `psql` into a fresh project.
- **Purge:** `pg_cron` runs `purge_expired()` at 03:17 UTC. It empties trash older than 30 days and clears expired locks, old change-feed rows and old rate counters.
- **Usage:** Dashboard → Reports, or `select public.account_usage(id) from profiles` in the SQL editor.

## When to move to Pro
Move to Pro ($25/month) when any of these is true:
- the database passes about 400 MB of the free 500 MB;
- monthly active users approach 50,000, or egress approaches 5 GB;
- you need daily backups and point-in-time recovery, or no pausing at all;
- paid accounts start, since paying users expect Pro's reliability.

Moving is a button in the dashboard; nothing in the apps or this repo changes.

## Going paid
1. Pick a payment provider. Lemon Squeezy acts as merchant of record and handles VAT and sales tax for you; Stripe is the alternative.
2. Add a `billing-webhook` Edge Function that verifies the provider's signature and sets `profiles.plan_id` (and later a workspace plan) to `pro`.
3. Adjust the rows in `plans`. The apps read their limits from `usage_summary`, so no app release is needed.

## Incidents
- **Leaked service key:** roll the key in Project Settings → API, update the Edge Function secrets and GitHub secrets, then redeploy.
- **Bad migration:** never edit an applied migration; add a new one that fixes forward. For data loss, restore the latest backup into a new project and copy the affected rows back.
- **Abuse:** suspend the account or the organization from the staff console. If needed, delete the account there too; that removes the person's data.
