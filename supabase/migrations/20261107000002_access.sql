create or replace function public.nc_uid() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    me uuid := auth.uid();
begin
    if me is null then
        raise exception 'nc:auth' using errcode = 'P0001';
    end if;
    return me;
end;
$$;

create or replace function public.role_in(ws uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select role from public.memberships where workspace_id = ws and user_id = auth.uid();
$$;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.memberships where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.can_write(ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(public.role_in(ws) in ('owner', 'admin', 'editor'), false);
$$;

create or replace function public.can_manage(ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(public.role_in(ws) in ('owner', 'admin'), false);
$$;

create or replace function public.project_workspace(p uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select workspace_id from public.projects where id = p;
$$;

create or replace function public.shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.memberships a
        join public.memberships b on a.workspace_id = b.workspace_id
        where a.user_id = auth.uid() and b.user_id = other
    );
$$;

create or replace function public.my_email() returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select lower(email) from auth.users where id = auth.uid();
$$;

alter table public.plans enable row level security;
alter table public.apps enable row level security;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.devices enable row level security;
alter table public.projects enable row level security;
alter table public.project_versions enable row level security;
alter table public.leases enable row level security;
alter table public.edit_sessions enable row level security;
alter table public.stars enable row level security;
alter table public.app_settings enable row level security;
alter table public.changes enable row level security;
alter table public.audit enable row level security;
alter table public.rate enable row level security;

create policy plans_read on public.plans for select to authenticated using (true);
create policy apps_read on public.apps for select to authenticated, anon using (true);
create policy profiles_read on public.profiles for select to authenticated
    using (id = auth.uid() or public.shares_workspace(id));
create policy workspaces_read on public.workspaces for select to authenticated
    using (public.is_member(id));
create policy memberships_read on public.memberships for select to authenticated
    using (public.is_member(workspace_id));
create policy invites_read on public.invites for select to authenticated
    using (public.can_manage(workspace_id) or email = public.my_email());
create policy devices_read on public.devices for select to authenticated
    using (user_id = auth.uid());
create policy projects_read on public.projects for select to authenticated
    using (public.is_member(workspace_id));
create policy project_versions_read on public.project_versions for select to authenticated
    using (public.is_member(public.project_workspace(project_id)));
create policy leases_read on public.leases for select to authenticated
    using (public.is_member(public.project_workspace(project_id)));
create policy edit_sessions_read on public.edit_sessions for select to authenticated
    using (public.is_member(public.project_workspace(project_id)));
create policy stars_read on public.stars for select to authenticated
    using (user_id = auth.uid());
create policy app_settings_read on public.app_settings for select to authenticated
    using (user_id = auth.uid());
create policy changes_read on public.changes for select to authenticated
    using (public.is_member(workspace_id));
create policy audit_read on public.audit for select to authenticated
    using (actor = auth.uid() or (workspace_id is not null and public.can_manage(workspace_id)));

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on
    public.plans, public.apps, public.profiles, public.workspaces, public.memberships, public.invites,
    public.devices, public.projects, public.project_versions, public.leases, public.edit_sessions,
    public.stars, public.app_settings, public.changes, public.audit
    to authenticated;
grant select on public.apps to anon;
