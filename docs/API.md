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
| `nc:invalid:<what>` | Bad input: `name`, `email`, `role`, `app`, `kind`, `personal`, `owner`, `member`, `not_deleted`. |
| `nc:unconfirmed` | The account's email isn't confirmed yet. |
| `nc:limit:<what>` | The plan's limit is reached: `projects`, `storage`, `teams`, `members`, `snapshots`. |
| `nc:rate` | Too many of this action this minute. Wait and retry. |
| `nc:reauth` | Sign in again first. Account deletion needs a session less than 10 minutes old. |

Expected outcomes aren't errors. Saving into someone else's lock, or saving from an old version, returns a normal `200` result with a `status` field.

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
GET /rest/v1/workspaces?select=id,name,kind,owner_id
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
GET /rest/v1/invites?select=id,email,role,expires_at,accepted_at&workspace_id=eq.<id>
GET /rest/v1/devices?select=id,name,platform,last_seen
GET /rest/v1/plans
```

A lease counts only while `expires_at` is in the future; compare against the server's clock (the `date` header).

**Export my data** is a read too: `GET /rest/v1/projects?select=id,workspace_id,app_id,title,body,updated_at` returns every project you can see, and the app writes each one to a file.

## Changing things (`POST /rest/v1/rpc/<name>`)

### You and your devices
| Function | Arguments | Returns |
|---|---|---|
| `me` | none | `{id, email, display_name, avatar_hue, plan, usage, personal_workspace}` |
| `update_profile` | `display_name`, `avatar_hue?` | none |
| `register_device` | `device_id`, `name`, `platform?` | none |
| `forget_device` | `device_id` | none |
| `put_app_settings` | `app_id`, `body` (16 KB max) | none |
| `usage_summary` | none | `{plan, usage: {projects, bytes, owned_teams}}` |

### Teams
| Function | Arguments | Notes |
|---|---|---|
| `create_workspace` | `name` | Returns the id. Counts against `max_owned_teams`. |
| `rename_workspace` | `ws`, `name` | Owner or admin. |
| `delete_workspace` | `ws` | Owner only. Deletes its scripts. |
| `invite_member` | `ws`, `email`, `role` (`admin`/`editor`/`viewer`) | Owner or admin; only the owner invites admins. Returns the invite id. Then call the `send-invite` Edge Function to email it. |
| `revoke_invite` | `invite` | |
| `my_invites` | none | Pending invites to your email: `{id, role, workspace_id, workspace, invited_by, expires_at}`. |
| `invite_details` | `invite` | |
| `accept_invite` / `decline_invite` | `invite` | Accepting needs a confirmed email. |
| `set_role` | `ws`, `member`, `role` | Admins can't change admins. Nobody changes the owner. |
| `remove_member` | `ws`, `member` | Frees their locks. |
| `leave_workspace` | `ws` | Owners hand over first. |
| `transfer_ownership` | `ws`, `member` | The old owner becomes an admin. |

### Scripts and other projects
| Function | Arguments | Returns |
|---|---|---|
| `create_project` | `ws`, `app_id`, `title`, `body?`, `meta?` | Project JSON, without the body. |
| `open_project` | `p`, `device_id`, `device_name`, `want_edit?` | `{project (with body), access: "edit"/"read", can_write, lease}` |
| `request_edit` | `p`, `device_id`, `device_name` | Same shape. Takes the lock when it's free or held by your own other device ("Edit here instead"). |
| `renew_lease` | `p`, `device_id` | `{held, version, lease?}`. Call every 30 s while editing. |
| `release_lease` | `p`, `device_id` | none |
| `save_project` | `p`, `base_version`, `body`, `title?`, `meta?`, `device_id?` | `{status: "saved", version}`, `{status: "conflict", project}` or `{status: "locked", lease}` |
| `take_snapshot` | `p`, `label?`, `kind?` (`manual`/`conflict`/`offline`/`revision`/`restore`), `body?` | The snapshot id. A `body` stores that text instead of the current one. |
| `delete_snapshot` | `snapshot` | none |
| `restore_snapshot` | `snapshot`, `base_version`, `device_id?` | Same as `save_project`. Keeps the replaced text as a `restore` snapshot. |
| `delete_project` / `restore_project` | `p` | Moves to or from the trash; the trash keeps scripts for 30 days. |
| `purge_project` | `p` | Deletes a trashed project for good. |
| `move_project` | `p`, `to_workspace` | Needs write access in both spaces. |
| `duplicate_project` | `p`, `title?` | Project JSON. |
| `set_star` | `p`, `starred` | none |
| `changes_since` | `since` | `{latest, oldest, changes: [{seq, workspace_id, project_id, kind, by, at}]}`. If `since < oldest`, reload everything. |

The `kind` values in the change feed are `project`, `lease`, `versions`, `members` and `workspace`.

### The lock
- **Holding it:** a lease lasts 90 s, so the holder renews it every 30 s.
- **When it's taken:** if `renew_lease` returns `held: false`, someone took over. Snapshot any unsaved work, then switch to reading.
- **Saving takes it:** a save that succeeds also takes or extends the lock for that device, which covers saving after a short offline gap.

## Edge Functions
| Endpoint | Body | Notes |
|---|---|---|
| `POST /functions/v1/send-invite` | `{invite_id, app?}` | Emails the invite. The caller must manage the team. `{sent: false}` if email isn't configured. |
| `POST /functions/v1/delete-account` | none | Needs a session less than 10 minutes old, otherwise `nc:reauth`. Teams pass to the next member; teams of one are deleted. |
