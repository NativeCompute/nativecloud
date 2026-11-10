create extension if not exists pgcrypto;

create table public.plans (
    id text primary key,
    name text not null,
    scope text not null check (scope in ('personal', 'org')),
    max_people int not null,
    max_spaces int not null,
    max_projects int not null,
    max_bytes bigint not null,
    max_owned_orgs int not null,
    max_auto_snapshots int not null,
    max_kept_snapshots int not null,
    max_saves_per_minute int not null,
    trial_days int not null default 0,
    price_cents int not null default 0,
    paid boolean not null default false,
    rank int not null default 0
);

insert into public.plans
    (id, name, scope, max_people, max_spaces, max_projects, max_bytes, max_owned_orgs,
     max_auto_snapshots, max_kept_snapshots, max_saves_per_minute, trial_days, price_cents, paid, rank) values
    ('free', 'Free', 'personal', 1, 1, 50, 104857600, 3, 30, 20, 30, 0, 0, false, 0),
    ('team', 'Team', 'org', 10, 5, 500, 2147483648, 0, 30, 50, 60, 30, 1900, true, 1),
    ('studio', 'Studio', 'org', 50, 1000, 5000, 21474836480, 0, 60, 200, 120, 0, 7900, true, 2),
    ('enterprise', 'Enterprise', 'org', 10000, 100000, 1000000, 1099511627776, 0, 90, 1000, 240, 0, 0, true, 3);

create table public.apps (
    id text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),
    name text not null
);

insert into public.apps values ('blackline', 'Blackline'), ('tesseract', 'Tesseract');

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null default '' check (char_length(display_name) <= 80),
    avatar_hue int not null default (floor(random() * 360))::int check (avatar_hue between 0 and 359),
    plan_id text not null default 'free' references public.plans (id),
    suspended_at timestamptz,
    suspended_reason text not null default '',
    created_at timestamptz not null default now()
);

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 80),
    slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
    plan_id text not null default 'team' references public.plans (id),
    trial_ends_at timestamptz,
    settings jsonb not null default '{"members_create_spaces": true}'::jsonb check (octet_length(settings::text) <= 4096),
    suspended_at timestamptz,
    suspended_reason text not null default '',
    created_by uuid,
    created_at timestamptz not null default now()
);

create table public.org_members (
    org_id uuid not null references public.organizations (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role text not null check (role in ('owner', 'admin', 'member', 'guest')),
    joined_at timestamptz not null default now(),
    primary key (org_id, user_id)
);

create index org_members_user on public.org_members (user_id);
create unique index org_members_one_owner on public.org_members (org_id) where role = 'owner';

create table public.org_slugs (
    slug text primary key,
    org_id uuid not null references public.organizations (id) on delete cascade,
    retired_at timestamptz not null default now()
);

create table public.workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 80),
    kind text not null check (kind in ('personal', 'space')),
    owner_id uuid references public.profiles (id) on delete cascade,
    org_id uuid references public.organizations (id) on delete cascade,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    check ((kind = 'personal' and owner_id is not null and org_id is null)
        or (kind = 'space' and owner_id is null and org_id is not null))
);

create unique index workspaces_one_personal on public.workspaces (owner_id) where kind = 'personal';
create index workspaces_org on public.workspaces (org_id);

create table public.memberships (
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role text not null check (role in ('owner', 'editor', 'viewer')),
    joined_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
);

create index memberships_user on public.memberships (user_id);
create unique index memberships_one_owner on public.memberships (workspace_id) where role = 'owner';

create table public.invites (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations (id) on delete cascade,
    email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
    role text not null check (role in ('admin', 'member', 'guest')),
    spaces uuid[] not null default '{}',
    space_role text not null default 'editor' check (space_role in ('editor', 'viewer')),
    invited_by uuid,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '14 days',
    accepted_at timestamptz,
    declined_at timestamptz,
    revoked_at timestamptz
);

create unique index invites_one_pending on public.invites (org_id, email)
    where accepted_at is null and declined_at is null and revoked_at is null;
create index invites_email on public.invites (email);

create table public.devices (
    id uuid primary key,
    user_id uuid not null references public.profiles (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 80),
    platform text not null default '' check (char_length(platform) <= 40),
    created_at timestamptz not null default now(),
    last_seen timestamptz not null default now()
);

create index devices_user on public.devices (user_id);

create table public.projects (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    app_id text not null references public.apps (id),
    title text not null default '' check (char_length(title) <= 200),
    body text not null default '' check (octet_length(body) <= 2000000),
    meta jsonb not null default '{}'::jsonb check (octet_length(meta::text) <= 16384),
    version bigint not null default 1,
    size int generated always as (octet_length(body)) stored,
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_by uuid,
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    deleted_by uuid
);

create index projects_workspace on public.projects (workspace_id, app_id) where deleted_at is null;
create index projects_trash on public.projects (workspace_id) where deleted_at is not null;

create table public.project_versions (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    version bigint not null,
    body text not null check (octet_length(body) <= 2000000),
    size int generated always as (octet_length(body)) stored,
    label text not null default '' check (char_length(label) <= 120),
    kind text not null check (kind in ('auto', 'manual', 'conflict', 'offline', 'revision', 'restore')),
    created_by uuid,
    created_at timestamptz not null default now()
);

create index project_versions_project on public.project_versions (project_id, created_at desc);

create table public.leases (
    project_id uuid primary key references public.projects (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    device_id uuid not null,
    device_name text not null default '',
    acquired_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create table public.edit_sessions (
    id bigint generated always as identity primary key,
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid,
    started_at timestamptz not null default now(),
    ended_at timestamptz not null default now(),
    words_delta int not null default 0,
    saves int not null default 0
);

create index edit_sessions_project on public.edit_sessions (project_id, ended_at desc);

create table public.stars (
    user_id uuid not null references public.profiles (id) on delete cascade,
    project_id uuid not null references public.projects (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, project_id)
);

create table public.app_settings (
    user_id uuid not null references public.profiles (id) on delete cascade,
    app_id text not null references public.apps (id),
    body text not null default '' check (octet_length(body) <= 16384),
    updated_at timestamptz not null default now(),
    primary key (user_id, app_id)
);

create table public.changes (
    seq bigint generated always as identity primary key,
    workspace_id uuid references public.workspaces (id) on delete cascade,
    org_id uuid references public.organizations (id) on delete cascade,
    project_id uuid,
    kind text not null,
    by uuid,
    at timestamptz not null default now()
);

create index changes_workspace on public.changes (workspace_id, seq);
create index changes_org on public.changes (org_id, seq);

create table public.audit (
    id bigint generated always as identity primary key,
    workspace_id uuid references public.workspaces (id) on delete set null,
    org_id uuid references public.organizations (id) on delete set null,
    actor uuid,
    action text not null,
    detail jsonb not null default '{}'::jsonb,
    at timestamptz not null default now()
);

create index audit_workspace on public.audit (workspace_id, at desc);
create index audit_org on public.audit (org_id, at desc);

create table public.rate (
    user_id uuid not null references public.profiles (id) on delete cascade,
    kind text not null,
    bucket timestamptz not null,
    n int not null default 0,
    primary key (user_id, kind, bucket)
);

create table public.staff (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    role text not null check (role in ('support', 'admin')),
    created_at timestamptz not null default now()
);

create table public.app_grants (
    id uuid primary key default gen_random_uuid(),
    code_hash text not null unique,
    user_id uuid not null references public.profiles (id) on delete cascade,
    app_id text not null,
    device_name text not null default '' check (char_length(device_name) <= 80),
    challenge text,
    attempts int not null default 0,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);

create index app_grants_user on public.app_grants (user_id, created_at desc);
