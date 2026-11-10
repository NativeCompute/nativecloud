# API

Apps talk to NativeCloud over plain HTTPS. Supabase's standard endpoints handle everything:

- **Auth** (`/auth/v1/…`) for accounts and sessions.
- **PostgREST** (`/rest/v1/…`) for reading.
- **Functions** (`/rest/v1/rpc/…`) for every change.
- **Edge Functions** (`/functions/v1/…`) for the two jobs that need the server's own key.

Every request carries `apikey: <anon key>`. Signed-in requests also carry `authorization: Bearer <access token>`.

## Errors

Functions fail with HTTP 400 and a JSON body whose `message` starts with `nc:`:

| Message | Meaning |
|---|---|
| `nc:auth` | Not signed in. |
| `nc:forbidden` | Signed in, but your role doesn't allow it. |
| `nc:not_found` | It doesn't exist, or you can't see it. These are deliberately the same. |
| `nc:invalid:<what>` | Bad input: `name`, `email`, `role`, `app`, `kind`, `personal`, `owner`, `member`, `not_deleted`, `slug`, `spaces`, `settings`, `plan`, `challenge`, `code`, `verifier`. |
| `nc:unconfirmed` | The account's email isn't confirmed yet. |
| `nc:suspended` | The account, or the organization, is suspended. |
| `nc:limit:<what>` | The plan's limit is reached: `projects`, `storage`, `orgs`, `members`, `spaces`, `snapshots`. |
| `nc:rate` | Too many of this action this minute. Wait and retry. |
| `nc:reauth` | Sign in again with your password first. Deleting things and handing them over need a password sign-in less than 10 minutes old; approving an app and the staff tools need a session that started with a password. Sessions made for apps or by `web-link` never count. |
| `nc:locked` | Someone else is editing the script, so it can't be deleted or moved now. |

Expected outcomes aren't errors. Saving into someone else's lock, or saving from an old version, returns a normal `200` result with a `status` field.

## Signing in

People sign in, sign up, confirm their email and reset passwords **on the web**, at `cloud.nativecompute.net`. The apps never ask for a password.

**An app signs in through the browser** (an authorization code with PKCE, sent back over a loopback redirect):
1. The app makes a random `verifier` (43–128 characters) and `challenge = base64url(sha256(verifier))`, and starts listening on `127.0.0.1:<port>`.
2. It opens `https://cloud.nativecompute.net/login?app=<app>&device=<name>&challenge=<challenge>&state=<state>&port=<port>`.
3. After you sign in and confirm, the web calls `create_app_grant(app, device, challenge)`. That returns an 8-character code, valid for 2 minutes and usable once.
4. The browser goes to `http://127.0.0.1:<port>/callback?code=<code>&state=<state>`. If the app can't be reached that way, the web shows the code to type in.
5. The app calls `POST /functions/v1/app-token` with `{code, verifier}`. It gets back a normal session (`access_token`, `refresh_token`, `expires_at`, `user`), separate from every other device. A wrong verifier counts as a failed try, and five of them burn the code.

**An app opens the web signed in:** `POST /functions/v1/web-link {next}` returns a URL. Its fragment carries a 12-character one-time code, valid for 5 minutes, that the web exchanges at `app-token` with no verifier. `next` is always a path on the panel.

## Accounts (Supabase Auth)

| Step | Call |
|---|---|
| Create an account | `POST /auth/v1/signup` `{email, password, data: {display_name}}`. No session yet: a 6-digit code is emailed. |
| Confirm the code | `POST /auth/v1/verify` `{type: "signup", email, token}` returns a session. |
| Send a new code | `POST /auth/v1/resend` `{type: "signup", email}` |
| Sign in | `POST /auth/v1/token?grant_type=password` `{email, password}` |
| Refresh | `POST /auth/v1/token?grant_type=refresh_token` `{refresh_token}`. Tokens rotate: keep the new one. |
| Forgot password | `POST /auth/v1/recover` `{email}`, then `POST /auth/v1/verify` `{type: "recovery", email, token}`, then `PUT /auth/v1/user` `{password}` |
| Change email | `PUT /auth/v1/user` `{email}`, then `POST /auth/v1/verify` `{type: "email_change", email, token}` |
| Sign out | `POST /auth/v1/logout?scope=local` (this device) or `scope=global` (every device) |

Passwords have at least 10 characters, with lower case, upper case and a digit. Access tokens last an hour.

## Reading (PostgREST)

Row Level Security limits every table to what you may see. Useful reads:

```
GET /rest/v1/organizations?select=id,name,slug,plan_id,trial_ends_at,settings
GET /rest/v1/org_members?select=org_id,user_id,role,joined_at&org_id=eq.<id>
GET /rest/v1/workspaces?select=id,name,kind,org_id,owner_id,archived_at
GET /rest/v1/memberships?select=workspace_id,user_id,role,joined_at
GET /rest/v1/profiles?select=id,display_name,avatar_hue
GET /rest/v1/projects?select=id,workspace_id,title,meta,version,size,updated_by,updated_at,deleted_at&app_id=eq.blackline
GET /rest/v1/projects?select=body,version&id=eq.<id>
GET /rest/v1/leases?select=project_id,user_id,device_name,expires_at
GET /rest/v1/project_versions?select=id,version,size,label,kind,created_by,created_at&project_id=eq.<id>&order=created_at.desc
GET /rest/v1/project_versions?select=body&id=eq.<version id>
GET /rest/v1/edit_sessions?project_id=eq.<id>&order=ended_at.desc&limit=50
GET /rest/v1/stars?select=project_id
GET /rest/v1/app_settings?select=body,updated_at&app_id=eq.blackline
GET /rest/v1/invites?select=id,email,role,spaces,expires_at,accepted_at,revoked_at&org_id=eq.<id>
GET /rest/v1/audit?select=action,actor,detail,at&org_id=eq.<id>&order=at.desc
GET /rest/v1/devices?select=id,name,platform,last_seen
GET /rest/v1/plans
```

A lease counts only while `expires_at` is in the future; compare against the server's clock (the `date` header).

**Export my data** is a read too: `GET /rest/v1/projects?select=id,workspace_id,app_id,title,body,updated_at` returns every project you can see, and the app writes each one to a file.

## Changing things (`POST /rest/v1/rpc/<name>`)

### You and your devices
| Function | Arguments | Returns |
|---|---|---|
| `me` | none | `{id, email, display_name, avatar_hue, plan, usage, personal_workspace, staff, orgs: [{id, name, slug, role, plan, trial_ends_at, suspended}]}` |
| `update_profile` | `display_name`, `avatar_hue?` | none |
| `register_device` | `device_id`, `name`, `platform?` | none |
| `forget_device` | `device_id` | Signs that computer's session out and removes it from the list. |
| `put_app_settings` | `app_id`, `body` (16 KB max) | none |
| `usage_summary` | none | `{plan, usage: {projects, bytes, owned_orgs}}` |

### Organizations
An organization is the tenant. It holds the plan, the people and its spaces, and every project lives in a space. Organization roles are `owner`, `admin`, `member` and `guest`; inside a space, people are `editor` or `viewer`. Members join every space, while guests join only the spaces they're invited to.

| Function | Arguments | Notes |
|---|---|---|
| `create_org` | `name`, `slug?` | Returns `{id, slug, space}`. It starts on a Team trial with one space, "General". Counts against your personal plan's `max_owned_orgs`. |
| `org_by_slug` | `slug` | `{id, name, slug, role, settings, plan, usage, trial_ends_at, suspended}`. Old slugs still resolve. |
| `org_people` | `org` | One row per person: `{user_id, display_name, avatar_hue, role, joined_at}`. Owners and admins also get `email`, `last_active` and `spaces: [{id, role}]`; members get their own email only. Guests see themselves and the owners and admins. |
| `rename_org` / `set_org_slug` | `org`, `name` or `slug` | Owner or admin. |
| `update_org_settings` | `org`, `settings` | `{"members_create_spaces": bool}`. |
| `delete_org` | `org` | Owner only, with a session less than 10 minutes old. Deletes its spaces and projects. |
| `transfer_org` | `org`, `member` | Owner only, with a fresh session. The old owner becomes an admin. |
| `create_space` | `org`, `name` | Owners and admins, or members when the setting allows it. |
| `rename_space` / `archive_space` / `delete_space` | `ws`, and `name` / `archived` | Owner or admin. An archived space is read-only. Deleting one needs a fresh session. |
| `set_space_member` | `ws`, `member`, `role` (`editor`/`viewer`, or null to remove) | Owner or admin. |
| `invite_member` | `org`, `email`, `role` (`admin`/`member`/`guest`), `spaces?`, `space_role?` | Returns the invite id. Only the owner invites admins, and guests need at least one space. Then call `send-invite`. |
| `revoke_invite` | `invite` | |
| `my_invites` | none | `{id, role, org_id, org, org_slug, invited_by, expires_at}` |
| `invite_details` | `invite` | Includes `state`: `pending`, `accepted`, `declined`, `revoked` or `expired`. |
| `accept_invite` / `decline_invite` | `invite` | Accepting needs a confirmed email and returns the organization's id. |
| `set_org_role` | `org`, `member`, `role` | Admins can't change admins, and nobody changes the owner. |
| `remove_member` | `org`, `member` | Also frees their locks. |
| `leave_org` | `org` | Owners hand over first. |

### Staff
These need a row in `staff`, which is added from the SQL editor. Support staff can look and change plans; staff admins can also suspend and delete. Every call is written to `audit`.

| Function | Arguments |
|---|---|
| `staff_stats` | none |
| `staff_search` | `q` (email, name, slug or id) |
| `staff_user` / `staff_org` | `uid` / `org` |
| `staff_set_plan` | `org`, `plan`, `trial_days?` (0 ends the trial) |
| `staff_set_user_plan` | `uid`, `plan` |
| `staff_suspend_org` / `staff_suspend_user` | `org` or `uid`, `suspended`, `reason?` (staff admins only) |
| `POST /functions/v1/staff-delete-user` | `{user_id}` (staff admins only, with a fresh session) |

### Scripts and other projects
| Function | Arguments | Returns |
|---|---|---|
| `create_project` | `ws`, `app_id`, `title`, `body?`, `meta?` | Project JSON, without the body. |
| `open_project` | `p`, `device_id`, `device_name`, `want_edit?` | `{project (with body), access: "edit"/"read", can_write, lease}` |
| `request_edit` | `p`, `device_id`, `device_name` | Same shape. Takes the lock when it's free or held by your own other device ("Edit here instead"). |
| `renew_lease` | `p`, `device_id` | `{held, version, lease?}`. Call every 30 s while editing. |
| `release_lease` | `p`, `device_id` | none |
| `save_project` | `p`, `base_version`, `body`, `title?`, `meta?`, `device_id?` | `{status: "saved", version}`, `{status: "conflict", project}` or `{status: "locked", lease}` |
| `take_snapshot` | `p`, `label?`, `kind?` (`manual`/`conflict`/`offline`/`revision`/`restore`), `body?` | The snapshot id. A `body` stores that text instead of the current one. Snapshots count towards the plan's storage; at most 10 safety copies (`conflict`, `offline`, `restore`) are kept per script. |
| `delete_snapshot` | `snapshot` | Owners and admins, or whoever took that snapshot. Automatic snapshots can only be deleted by owners and admins. |
| `restore_snapshot` | `snapshot`, `base_version`, `device_id?` | Same as `save_project`. Keeps the replaced text as a `restore` snapshot. |
| `delete_project` / `restore_project` | `p` | Moves to or from the trash; the trash keeps scripts for 30 days. |
| `purge_project` | `p` | Deletes a trashed project for good. |
| `move_project` | `p`, `to_workspace` | Needs write access in both spaces. Taking a script out of an organization needs an owner, an admin or the script's creator, and is written to the organization's audit log. `nc:locked` while someone else edits it. |
| `duplicate_project` | `p`, `title?` | Project JSON. |
| `set_star` | `p`, `starred` | none |
| `changes_since` | `since` | `{latest, oldest, changes: [{seq, workspace_id, org_id, project_id, kind, by, at}]}`. If `since < oldest`, reload everything. |

The `kind` values in the change feed are `project`, `lease`, `versions`, `members`, `workspace` and `org`. Organization-wide changes carry `org_id` instead of `workspace_id`.

### The lock
- **Holding it:** a lease lasts 90 s, so the holder renews it every 30 s.
- **When it's taken:** if `renew_lease` returns `held: false`, someone took over. Snapshot any unsaved work, then switch to reading.
- **Saving takes it:** a save that succeeds also takes or extends the lock for that device, which covers saving after a short offline gap.

## Edge Functions
| Endpoint | Body | Notes |
|---|---|---|
| `POST /functions/v1/send-invite` | `{invite_id}` | Emails the invite with a link to `/invite/<id>` on the web. The caller must be an owner or admin. Each invite is sent at most 3 times, at least a minute apart, and an organization sends at most 50 invite emails a day (`nc:rate`). Returns `{sent: false}` if email isn't configured. |
| `POST /functions/v1/app-token` | `{code, verifier?}` | Trades a sign-in code for a session; see Signing in. No session needed. |
| `POST /functions/v1/web-link` | `{next}` | Returns `{url}`, which opens the web signed in after the person confirms the account. 10 a minute per account, each written to the audit log. |
| `POST /functions/v1/delete-account` | none | Needs a session less than 10 minutes old, otherwise `nc:reauth`. Organizations pass to the next admin or member; organizations of one are deleted. |
