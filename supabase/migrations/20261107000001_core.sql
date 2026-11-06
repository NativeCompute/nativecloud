create extension if not exists pgcrypto;

create table public.plans (
    id text primary key,
    name text not null,
    max_projects int not null,
    max_owned_teams int not null,
    max_members int not null,
    max_auto_snapshots int not null,
    max_kept_snapshots int not null,
    max_bytes bigint not null,
    max_saves_per_minute int not null,
    paid boolean not null default false
);

insert into public.plans values
    ('free_beta', 'Free beta', 50, 3, 10, 30, 20, 104857600, 30, false),
    ('pro', 'Pro', 1000, 20, 50, 60, 200, 2147483648, 120, true);

create table public.apps (
    id text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),
    name text not null
);

insert into public.apps values ('blackline', 'Blackline'), ('tesseract', 'Tesseract');

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null default '' check (char_length(display_name) <= 80),
    avatar_hue int not null default (floor(random() * 360))::int check (avatar_hue between 0 and 359),
    plan_id text not null default 'free_beta' references public.plans (id),
    created_at timestamptz not null default now()
);

create table public.workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 80),
    kind text not null check (kind in ('personal', 'team')),
    owner_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now()
);

create unique index workspaces_one_personal on public.workspaces (owner_id) where kind = 'personal';
create index workspaces_owner on public.workspaces (owner_id);

create table public.memberships (
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
    joined_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
);

create index memberships_user on public.memberships (user_id);
create unique index memberships_one_owner on public.memberships (workspace_id) where role = 'owner';

create table public.invites (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
    role text not null check (role in ('admin', 'editor', 'viewer')),
    invited_by uuid,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '14 days',
    accepted_at timestamptz,
    declined_at timestamptz,
    revoked_at timestamptz
);

create unique index invites_one_pending on public.invites (workspace_id, email)
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
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    project_id uuid,
    kind text not null,
    by uuid,
    at timestamptz not null default now()
);

create index changes_workspace on public.changes (workspace_id, seq);

create table public.audit (
    id bigint generated always as identity primary key,
    workspace_id uuid references public.workspaces (id) on delete set null,
    actor uuid,
    action text not null,
    detail jsonb not null default '{}'::jsonb,
    at timestamptz not null default now()
);

create index audit_workspace on public.audit (workspace_id, at desc);

create table public.rate (
    user_id uuid not null references public.profiles (id) on delete cascade,
    kind text not null,
    bucket timestamptz not null,
    n int not null default 0,
    primary key (user_id, kind, bucket)
);
