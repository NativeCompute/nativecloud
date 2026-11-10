alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

alter table public.devices add column if not exists session_id uuid;
alter table public.invites add column if not exists sent_count int not null default 0;
alter table public.invites add column if not exists last_sent_at timestamptz;

-- who here---

create or replace function public.live_uid() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select p.id from public.profiles p where p.id = auth.uid() and p.suspended_at is null;
$$;

create or replace function public.amr_methods() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end;
$$;

create or replace function public.signed_in_at() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select max((a ->> 'timestamp')::bigint) from jsonb_array_elements(public.amr_methods()) a
                     where a ->> 'method' in ('password', 'totp') and a ->> 'timestamp' ~ '^[0-9]+$'), 0);
$$;

create or replace function public.password_session() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.signed_in_at() > 0;
$$;

create or replace function public.session_uuid() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select case when auth.jwt() ->> 'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (auth.jwt() ->> 'session_id')::uuid end;
$$;

create or replace function public.end_sessions(uid uuid, session uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if uid is null or to_regclass('auth.sessions') is null then
        return;
    end if;
    if session is null then
        execute 'delete from auth.sessions where user_id = $1' using uid;
    else
        execute 'delete from auth.sessions where user_id = $1 and id = $2' using uid, session;
    end if;
end;
$$;

create or replace function public.org_role(org uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select role from public.org_members where org_id = org and user_id = public.live_uid();
$$;

create or replace function public.in_org(org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.org_members where org_id = org and user_id = public.live_uid());
$$;

create or replace function public.role_in(ws uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select role from public.memberships where workspace_id = ws and user_id = public.live_uid();
$$;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.memberships where workspace_id = ws and user_id = public.live_uid());
$$;

create or replace function public.org_of(ws uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select org_id from public.workspaces where id = ws;
$$;

create or replace function public.ws_of(p uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select workspace_id from public.projects where id = p;
$$;

create or replace function public.space_org(ws uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select w.org_id from public.workspaces w where w.id = ws and (public.is_member(ws) or public.in_org(w.org_id));
$$;

create or replace function public.project_workspace(p uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select pr.workspace_id from public.projects pr where pr.id = p and public.is_member(pr.workspace_id);
$$;

create or replace function public.can_write(ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(public.role_in(ws) in ('owner', 'editor'), false)
       and public.org_live(public.org_of(ws))
       and coalesce((select archived_at is null from public.workspaces where id = ws), false);
$$;

create or replace function public.can_manage(ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when (select kind from public.workspaces where id = ws) = 'personal' then coalesce(public.role_in(ws) = 'owner', false)
        else public.can_manage_org(public.org_of(ws))
    end;
$$;

create or replace function public.need_manage(ws uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.nc_uid();
    if not public.can_manage(ws) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    if not public.org_live(public.org_of(ws)) then
        raise exception 'nc:suspended' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.need_live_org(org uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not public.org_live(org) then
        raise exception 'nc:suspended' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.need_staff(admin_only boolean default false) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    if not public.is_staff(admin_only) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if not public.password_session() then
        raise exception 'nc:reauth' using errcode = 'P0001';
    end if;
    return me;
end;
$$;

-- reads here---

drop policy if exists changes_read on public.changes;
create policy changes_read on public.changes for select to authenticated
    using ((workspace_id is not null and public.is_member(workspace_id))
           or (org_id is not null and coalesce(public.org_role(org_id) <> 'guest', false)));

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated
    using (public.is_member(workspace_id) or public.can_manage_org(public.space_org(workspace_id)));

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
    using (id = auth.uid() or (public.live_uid() is not null and (public.shares_workspace(id) or public.is_staff())));

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select to authenticated
    using (public.in_org(id) or (public.live_uid() is not null and public.is_staff()));

drop policy if exists workspaces_read on public.workspaces;
create policy workspaces_read on public.workspaces for select to authenticated
    using (public.is_member(id) or (org_id is not null and public.can_manage_org(org_id))
           or (public.live_uid() is not null and public.is_staff()));

drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated
    using (public.can_manage_org(org_id) or (public.live_uid() is not null and email = public.my_email()));

drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated
    using (user_id = public.live_uid());

drop policy if exists stars_read on public.stars;
create policy stars_read on public.stars for select to authenticated
    using (user_id = public.live_uid());

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated
    using (user_id = public.live_uid());

drop policy if exists audit_read on public.audit;
create policy audit_read on public.audit for select to authenticated
    using (public.live_uid() is not null and (
           actor = auth.uid()
           or (org_id is not null and public.can_manage_org(org_id))
           or (workspace_id is not null and public.can_manage(workspace_id))
           or public.is_staff()));

revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_hue, created_at) on public.profiles to authenticated;
revoke select on public.organizations from authenticated;
grant select (id, name, slug, plan_id, trial_ends_at, settings, created_by, created_at) on public.organizations to authenticated;
revoke select on public.devices from authenticated;
grant select (id, user_id, name, platform, created_at, last_seen) on public.devices to authenticated;
revoke select on public.invites from authenticated;
grant select (id, org_id, email, role, spaces, space_role, invited_by, created_at, expires_at, accepted_at, declined_at, revoked_at)
    on public.invites to authenticated;

-- usage here---

create or replace function public.versions_bytes(ws_filter text, key uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(sum(v.size), 0) from public.project_versions v
    join public.projects p on p.id = v.project_id
    join public.workspaces w on w.id = p.workspace_id
    where (ws_filter = 'org' and w.org_id = key) or (ws_filter = 'owner' and w.owner_id = key and w.kind = 'personal');
$$;

create or replace function public.account_usage(owner uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'projects', (select count(*) from public.projects p join public.workspaces w on w.id = p.workspace_id
                     where w.owner_id = owner and w.kind = 'personal' and p.deleted_at is null),
        'bytes', (select coalesce(sum(p.size), 0) from public.projects p join public.workspaces w on w.id = p.workspace_id
                  where w.owner_id = owner and w.kind = 'personal') + public.versions_bytes('owner', owner),
        'owned_orgs', (select count(*) from public.org_members where user_id = owner and role = 'owner')
    );
$$;

create or replace function public.org_usage(org uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'projects', (select count(*) from public.projects p join public.workspaces w on w.id = p.workspace_id
                     where w.org_id = org and p.deleted_at is null),
        'bytes', (select coalesce(sum(p.size), 0) from public.projects p join public.workspaces w on w.id = p.workspace_id
                  where w.org_id = org) + public.versions_bytes('org', org),
        'people', (select count(*) from public.org_members where org_id = org),
        'pending', (select count(*) from public.invites i where i.org_id = org and i.accepted_at is null
                    and i.declined_at is null and i.revoked_at is null and i.expires_at > now()),
        'spaces', (select count(*) from public.workspaces where org_id = org and archived_at is null)
    );
$$;

create or replace function public.database_full() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select pg_database_size(current_database()) > 400::bigint * 1024 * 1024;
$$;

create or replace function public.check_room(ws uuid, more_projects int, more_bytes bigint) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    pl public.plans := public.plan_for(ws);
    used jsonb := public.usage_for(ws);
begin
    if (more_projects > 0 or more_bytes > 0) and public.database_full() then
        raise exception 'nc:limit:storage' using errcode = 'P0001';
    end if;
    if more_projects > 0 and (used ->> 'projects')::int + more_projects > pl.max_projects then
        raise exception 'nc:limit:projects' using errcode = 'P0001';
    end if;
    if more_bytes > 0 and (used ->> 'bytes')::bigint + more_bytes > pl.max_bytes then
        raise exception 'nc:limit:storage' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.keep_auto(p uuid, body text, version bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    ws uuid := public.ws_of(p);
    keep int := (public.plan_for(ws)).max_auto_snapshots;
begin
    if exists (select 1 from public.project_versions v where v.project_id = p and v.kind = 'auto'
               and v.created_at > now() - interval '10 minutes') then
        return;
    end if;
    begin
        perform public.check_room(ws, 0, octet_length(coalesce(keep_auto.body, '')));
    exception when sqlstate 'P0001' then
        return;
    end;
    insert into public.project_versions (project_id, version, body, kind, created_by)
    values (p, keep_auto.version, keep_auto.body, 'auto', auth.uid());
    delete from public.project_versions v
     where v.project_id = p and v.kind = 'auto'
       and v.id not in (select id from public.project_versions where project_id = p and kind = 'auto'
                        order by created_at desc limit keep);
end;
$$;

create or replace function public.take_snapshot(p uuid, label text default '', kind text default 'manual', body text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, false);
    pl public.plans := public.plan_for(row.workspace_id);
    text_kept text := coalesce(take_snapshot.body, row.body);
    safety int := least(pl.max_kept_snapshots, 10);
    made uuid;
begin
    perform public.need_write(row.workspace_id);
    if kind not in ('manual', 'conflict', 'offline', 'revision', 'restore') then
        raise exception 'nc:invalid:kind' using errcode = 'P0001';
    end if;
    perform public.bump_rate('snapshot', 20);
    if kind in ('manual', 'revision') and (select count(*) from public.project_versions v
            where v.project_id = p and v.kind in ('manual', 'revision')) >= pl.max_kept_snapshots then
        raise exception 'nc:limit:snapshots' using errcode = 'P0001';
    end if;
    if kind in ('conflict', 'offline', 'restore') then
        delete from public.project_versions v
         where v.project_id = p and v.kind in ('conflict', 'offline', 'restore')
           and v.id not in (select x.id from public.project_versions x where x.project_id = p
                            and x.kind in ('conflict', 'offline', 'restore') order by x.created_at desc limit greatest(safety - 1, 0));
    end if;
    perform public.check_room(row.workspace_id, 0, octet_length(text_kept));
    insert into public.project_versions (project_id, version, body, label, kind, created_by)
    values (p, row.version, text_kept, left(coalesce(label, ''), 120), take_snapshot.kind, me)
    returning project_versions.id into made;
    perform public.note_change(row.workspace_id, p, 'versions');
    return made;
end;
$$;

create or replace function public.delete_snapshot(snapshot uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    v public.project_versions;
    ws uuid;
begin
    select * into v from public.project_versions where id = snapshot;
    ws := public.ws_of(v.project_id);
    if v.id is null or not public.is_member(ws) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    perform public.need_write(ws);
    if not (public.can_manage(ws) or (v.created_by = me and v.kind <> 'auto')) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.bump_rate('snapshot', 20);
    delete from public.project_versions where id = snapshot;
    perform public.note_audit(ws, 'snapshot.delete', jsonb_build_object('project', v.project_id, 'snapshot', snapshot, 'kind', v.kind));
    perform public.note_change(ws, v.project_id, 'versions');
end;
$$;

-- projects here---

create or replace function public.held_by_other(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.leases l where l.project_id = p and l.expires_at > now() and l.user_id <> auth.uid());
$$;

create or replace function public.open_project(p uuid, device_id uuid, device_name text, want_edit boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, coalesce(want_edit, false));
    held public.leases := public.live_lease(p);
    access text := 'read';
begin
    if row.deleted_at is not null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if want_edit and public.can_write(row.workspace_id) then
        if held.project_id is null or (held.user_id = me and held.device_id = open_project.device_id) then
            perform public.take_lease(p, device_id, device_name);
            access := 'edit';
            if held.project_id is null then
                perform public.note_change(row.workspace_id, p, 'lease');
            end if;
        end if;
    end if;
    if access = 'edit' then
        held := public.live_lease(p);
    end if;
    return jsonb_build_object('project', public.project_json(row, true), 'access', access,
                              'can_write', public.can_write(row.workspace_id), 'lease', public.lease_json(held));
end;
$$;

create or replace function public.release_lease(p uuid, device_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    ws uuid := public.ws_of(p);
begin
    delete from public.leases l where l.project_id = p and l.user_id = me and l.device_id = release_lease.device_id;
    if found then
        perform public.note_change(ws, p, 'lease');
    end if;
end;
$$;

create or replace function public.delete_project(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, true);
begin
    perform public.need_write(row.workspace_id);
    if public.held_by_other(p) then
        raise exception 'nc:locked' using errcode = 'P0001';
    end if;
    update public.projects set deleted_at = now(), deleted_by = me where id = p and deleted_at is null;
    delete from public.leases where project_id = p;
    perform public.note_change(row.workspace_id, p, 'project');
end;
$$;

create or replace function public.purge_project(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, true);
begin
    if row.deleted_at is null then
        raise exception 'nc:invalid:not_deleted' using errcode = 'P0001';
    end if;
    if not (public.can_manage(row.workspace_id) or (row.created_by = me and public.can_write(row.workspace_id))) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.need_live_org(public.org_of(row.workspace_id));
    perform public.note_audit(row.workspace_id, 'project.purge', jsonb_build_object('project', p, 'title', row.title));
    delete from public.projects where id = p;
    perform public.note_change(row.workspace_id, p, 'project');
end;
$$;

create or replace function public.move_project(p uuid, to_workspace uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, true);
    from_org uuid;
begin
    perform public.need_write(row.workspace_id);
    perform public.need_write(to_workspace);
    if row.workspace_id = to_workspace then
        return;
    end if;
    if public.held_by_other(p) then
        raise exception 'nc:locked' using errcode = 'P0001';
    end if;
    from_org := public.org_of(row.workspace_id);
    if from_org is not null and from_org is distinct from public.org_of(to_workspace)
       and not (public.can_manage(row.workspace_id) or row.created_by = me) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    if public.bill_of(to_workspace) <> public.bill_of(row.workspace_id) then
        perform public.check_room(to_workspace, case when row.deleted_at is null then 1 else 0 end,
                                  row.size + coalesce((select sum(v.size) from public.project_versions v where v.project_id = p), 0));
    end if;
    delete from public.leases where project_id = p;
    update public.projects set workspace_id = to_workspace where id = p;
    perform public.note_change(row.workspace_id, p, 'project');
    perform public.note_change(to_workspace, p, 'project');
    perform public.note_audit(row.workspace_id, 'project.move_out', jsonb_build_object('project', p, 'title', row.title, 'to', to_workspace));
    perform public.note_audit(to_workspace, 'project.move', jsonb_build_object('project', p, 'from', row.workspace_id));
end;
$$;

create or replace function public.changes_since(since bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    return jsonb_build_object(
        'latest', (select coalesce(max(seq), 0) from public.changes),
        'oldest', (select coalesce(min(seq), 0) from public.changes),
        'changes', coalesce((
            select jsonb_agg(jsonb_build_object('seq', c.seq, 'workspace_id', c.workspace_id, 'org_id', c.org_id, 'project_id', c.project_id,
                                                'kind', c.kind, 'by', c.by, 'at', c.at) order by c.seq)
            from (select * from public.changes ch
                  where ch.seq > since
                    and (ch.workspace_id in (select workspace_id from public.memberships where user_id = me)
                         or ch.org_id in (select org_id from public.org_members where user_id = me and role <> 'guest'))
                  order by ch.seq limit 1000) c), '[]'::jsonb)
    );
end;
$$;

-- orgs here---

create or replace function public.rename_org(org uuid, name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_manage_org(org);
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    perform public.bump_rate('manage', 30);
    update public.organizations set name = btrim(rename_org.name) where id = org;
    perform public.note_org_audit(org, 'org.rename', jsonb_build_object('name', btrim(name)));
    perform public.note_org(org, 'org');
end;
$$;

create or replace function public.set_org_slug(org uuid, slug text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    wanted text := lower(btrim(slug));
    old text;
begin
    perform public.need_manage_org(org);
    select o.slug into old from public.organizations o where o.id = org;
    if wanted = old then
        return;
    end if;
    if wanted !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' or not public.slug_free(wanted, org) then
        raise exception 'nc:invalid:slug' using errcode = 'P0001';
    end if;
    perform public.bump_rate('slug', 5);
    delete from public.org_slugs where org_slugs.slug = wanted;
    insert into public.org_slugs (slug, org_id) values (old, org) on conflict on constraint org_slugs_pkey do nothing;
    update public.organizations set slug = wanted where id = org;
    perform public.note_org_audit(org, 'org.slug', jsonb_build_object('from', old, 'to', wanted));
    perform public.note_org(org, 'org');
end;
$$;

create or replace function public.update_org_settings(org uuid, settings jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    next jsonb;
begin
    perform public.need_manage_org(org);
    perform public.bump_rate('manage', 30);
    select o.settings into next from public.organizations o where o.id = org;
    if settings ? 'members_create_spaces' then
        if jsonb_typeof(settings -> 'members_create_spaces') <> 'boolean' then
            raise exception 'nc:invalid:settings' using errcode = 'P0001';
        end if;
        next := next || jsonb_build_object('members_create_spaces', settings -> 'members_create_spaces');
    end if;
    update public.organizations o set settings = next where o.id = org;
    perform public.note_org_audit(org, 'org.settings', next);
    perform public.note_org(org, 'org');
end;
$$;

create or replace function public.delete_org(org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    if public.org_role(org) is distinct from 'owner' then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.need_live_org(org);
    perform public.need_fresh();
    insert into public.audit (actor, action, detail)
    values (me, 'org.delete', jsonb_build_object('org', org, 'name', (select name from public.organizations where id = org)));
    delete from public.organizations where id = org;
end;
$$;

create or replace function public.transfer_org(org uuid, member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    theirs text;
begin
    if public.org_role(org) is distinct from 'owner' then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.need_live_org(org);
    perform public.need_fresh();
    select role into theirs from public.org_members where org_id = org and user_id = member;
    if theirs is null or member = me then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if theirs = 'guest' or exists (select 1 from public.profiles where id = member and suspended_at is not null) then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
    if (public.account_usage(member) ->> 'owned_orgs')::int >= (public.plan_of(member)).max_owned_orgs then
        raise exception 'nc:limit:orgs' using errcode = 'P0001';
    end if;
    update public.org_members set role = 'admin' where org_id = org and user_id = me;
    update public.org_members set role = 'owner' where org_id = org and user_id = member;
    perform public.note_org_audit(org, 'org.transfer', jsonb_build_object('to', member));
    perform public.note_org(org, 'members');
end;
$$;

create or replace function public.create_space(org uuid, name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    mine text := public.need_org(org);
    pl public.plans := public.org_plan(org);
    ws uuid;
begin
    if not (mine in ('owner', 'admin')
            or (mine = 'member' and coalesce(((select settings from public.organizations where id = org) ->> 'members_create_spaces')::boolean, false))) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.need_live_org(org);
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    perform public.bump_rate('manage', 30);
    if (public.org_usage(org) ->> 'spaces')::int >= pl.max_spaces then
        raise exception 'nc:limit:spaces' using errcode = 'P0001';
    end if;
    ws := public.add_space(org, name);
    perform public.note_audit(ws, 'space.create', jsonb_build_object('name', btrim(name)));
    perform public.note_org(org, 'workspace');
    return ws;
end;
$$;

create or replace function public.set_space_member(ws uuid, member uuid, role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    org uuid := public.org_of(ws);
    mine text;
    theirs text;
begin
    perform public.need_manage(ws);
    if org is null then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    mine := public.org_role(org);
    select m.role into theirs from public.org_members m where m.org_id = org and m.user_id = member;
    if theirs is null then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
    if member <> auth.uid() and (theirs = 'owner' or (theirs = 'admin' and mine <> 'owner')) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.bump_rate('manage', 30);
    if role is null then
        delete from public.leases l using public.projects p where l.project_id = p.id and p.workspace_id = ws and l.user_id = member;
        delete from public.memberships where workspace_id = ws and user_id = member;
    elsif role in ('editor', 'viewer') then
        insert into public.memberships (workspace_id, user_id, role) values (ws, member, set_space_member.role)
        on conflict (workspace_id, user_id) do update set role = excluded.role;
        if role = 'viewer' then
            delete from public.leases l using public.projects p where l.project_id = p.id and p.workspace_id = ws and l.user_id = member;
        end if;
    else
        raise exception 'nc:invalid:role' using errcode = 'P0001';
    end if;
    perform public.note_audit(ws, 'space.member', jsonb_build_object('member', member, 'role', role));
    perform public.note_change(ws, null, 'members');
end;
$$;

create or replace function public.accept_invite(invite uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    i public.invites;
begin
    select * into i from public.invites where id = invite for update;
    if i.id is null or i.email is distinct from public.my_email() or public.invite_state(i) <> 'pending' then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if (select email_confirmed_at from auth.users where id = me) is null then
        raise exception 'nc:unconfirmed' using errcode = 'P0001';
    end if;
    perform public.need_live_org(i.org_id);
    insert into public.org_members (org_id, user_id, role) values (i.org_id, me, i.role)
    on conflict (org_id, user_id) do nothing;
    if i.role = 'guest' then
        insert into public.memberships (workspace_id, user_id, role)
        select w.id, me, i.space_role from public.workspaces w where w.org_id = i.org_id and w.id = any (i.spaces)
        on conflict (workspace_id, user_id) do nothing;
    else
        insert into public.memberships (workspace_id, user_id, role)
        select w.id, me, 'editor' from public.workspaces w where w.org_id = i.org_id
        on conflict (workspace_id, user_id) do nothing;
    end if;
    update public.invites set accepted_at = now() where id = invite;
    perform public.note_org_audit(i.org_id, 'member.join', jsonb_build_object('role', i.role));
    perform public.note_org(i.org_id, 'members');
    return i.org_id;
end;
$$;

create or replace function public.drop_from_org(org uuid, member uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    delete from public.leases l using public.projects p, public.workspaces w
     where l.project_id = p.id and p.workspace_id = w.id and w.org_id = org and l.user_id = member;
    delete from public.memberships m using public.workspaces w
     where m.workspace_id = w.id and w.org_id = org and m.user_id = member;
    delete from public.org_members where org_id = org and user_id = member;
    update public.invites set revoked_at = now()
     where invites.org_id = org and invited_by = member and accepted_at is null and declined_at is null and revoked_at is null;
$$;

create or replace function public.set_org_role(org uuid, member uuid, role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    mine text := public.need_manage_org(org);
    theirs text;
begin
    select m.role into theirs from public.org_members m where m.org_id = org and m.user_id = member;
    if theirs is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if role not in ('admin', 'member', 'guest') or theirs = 'owner' then
        raise exception 'nc:invalid:role' using errcode = 'P0001';
    end if;
    if mine = 'admin' and (theirs = 'admin' or role = 'admin') then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.bump_rate('manage', 30);
    update public.org_members m set role = set_org_role.role where m.org_id = org and m.user_id = member;
    if theirs = 'guest' and role <> 'guest' then
        insert into public.memberships (workspace_id, user_id, role)
        select w.id, member, 'editor' from public.workspaces w where w.org_id = org
        on conflict (workspace_id, user_id) do nothing;
    elsif theirs <> 'guest' and role = 'guest' then
        delete from public.leases l using public.projects p, public.workspaces w
         where l.project_id = p.id and p.workspace_id = w.id and w.org_id = org and l.user_id = member;
        delete from public.memberships m using public.workspaces w
         where m.workspace_id = w.id and w.org_id = org and m.user_id = member;
    end if;
    perform public.note_org_audit(org, 'member.role', jsonb_build_object('member', member, 'role', role));
    perform public.note_org(org, 'members');
end;
$$;

create or replace function public.org_people(org uuid) returns setof jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    mine text := public.need_org(org);
    managing boolean := mine in ('owner', 'admin');
begin
    if mine = 'guest' then
        return query
            select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'avatar_hue', p.avatar_hue,
                                      'role', m.role, 'joined_at', m.joined_at)
            from public.org_members m join public.profiles p on p.id = m.user_id
            where m.org_id = org and (m.user_id = auth.uid() or m.role in ('owner', 'admin'))
            order by m.joined_at;
        return;
    end if;
    return query
        select jsonb_build_object(
            'user_id', p.id, 'display_name', p.display_name, 'avatar_hue', p.avatar_hue, 'role', m.role,
            'joined_at', m.joined_at,
            'email', case when managing or m.user_id = auth.uid() then (select lower(u.email) from auth.users u where u.id = m.user_id) end,
            'last_active', case when managing then (select max(d.last_seen) from public.devices d where d.user_id = m.user_id) end,
            'spaces', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'role', ms.role) order by w.name), '[]'::jsonb)
                       from public.memberships ms join public.workspaces w on w.id = ms.workspace_id
                       where ms.user_id = m.user_id and w.org_id = org and (managing or public.is_member(w.id))))
        from public.org_members m join public.profiles p on p.id = m.user_id
        where m.org_id = org
        order by case m.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, lower(p.display_name);
end;
$$;

-- invites here---

create or replace function public.claim_invite_send(invite uuid, sender uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    i public.invites;
begin
    select * into i from public.invites where id = invite for update;
    if i.id is null or public.invite_state(i) <> 'pending'
       or not exists (select 1 from public.org_members m join public.profiles p on p.id = m.user_id
                      where m.org_id = i.org_id and m.user_id = sender and m.role in ('owner', 'admin') and p.suspended_at is null) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if not public.org_live(i.org_id) then
        raise exception 'nc:suspended' using errcode = 'P0001';
    end if;
    if i.sent_count >= 3 or (i.last_sent_at is not null and i.last_sent_at > now() - interval '1 minute')
       or (select count(*) from public.invites x where x.org_id = i.org_id and x.last_sent_at > now() - interval '1 day') >= 50 then
        raise exception 'nc:rate' using errcode = 'P0001';
    end if;
    update public.invites set sent_count = sent_count + 1, last_sent_at = now() where id = invite;
    insert into public.audit (org_id, actor, action, detail) values (i.org_id, sender, 'member.invite_sent', jsonb_build_object('email', i.email));
    return jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role,
        'org', (select name from public.organizations where id = i.org_id),
        'invited_by', (select lower(email) from auth.users where id = sender)
    );
end;
$$;

-- devices here---

create or replace function public.register_device(device_id uuid, name text, platform text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    perform public.bump_rate('device', 10);
    if not exists (select 1 from public.devices d where d.id = register_device.device_id)
       and (select count(*) from public.devices d where d.user_id = me) >= 50 then
        raise exception 'nc:limit:devices' using errcode = 'P0001';
    end if;
    insert into public.devices (id, user_id, name, platform, session_id)
    values (device_id, me, left(coalesce(nullif(btrim(name), ''), 'Computer'), 80), left(coalesce(platform, ''), 40), public.session_uuid())
    on conflict (id) do update set name = excluded.name, platform = excluded.platform, last_seen = now(),
                                   session_id = coalesce(excluded.session_id, public.devices.session_id)
    where public.devices.user_id = me;
    if not found then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.forget_device(device_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    sid uuid;
begin
    select d.session_id into sid from public.devices d where d.id = forget_device.device_id and d.user_id = me;
    delete from public.leases where leases.device_id = forget_device.device_id and user_id = me;
    delete from public.devices where id = forget_device.device_id and user_id = me;
    if sid is not null then
        perform public.end_sessions(me, sid);
    end if;
end;
$$;

-- grants here---

create or replace function public.make_grant(uid uuid, app text, device text, challenge text, life interval, len int default 8) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    bytes bytea;
    code text;
    tries int := 0;
begin
    loop
        bytes := extensions.gen_random_bytes(32);
        code := '';
        for k in 0..(least(greatest(len, 8), 24) - 1) loop
            code := code || substr(alphabet, (get_byte(bytes, k) % 31) + 1, 1);
        end loop;
        begin
            insert into public.app_grants (code_hash, user_id, app_id, device_name, challenge, expires_at)
            values (public.grant_hash(code), uid, app, left(coalesce(btrim(device), ''), 80), challenge, now() + life);
            return code;
        exception when unique_violation then
            tries := tries + 1;
            if tries > 5 then
                raise;
            end if;
        end;
    end loop;
end;
$$;

drop function if exists public.make_grant(uuid, text, text, text, interval);

create or replace function public.create_app_grant(app text, device text, challenge text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    if not exists (select 1 from public.apps a where a.id = app) then
        raise exception 'nc:invalid:app' using errcode = 'P0001';
    end if;
    if challenge is null or challenge !~ '^[A-Za-z0-9_-]{43}$' then
        raise exception 'nc:invalid:challenge' using errcode = 'P0001';
    end if;
    if not public.password_session() then
        raise exception 'nc:reauth' using errcode = 'P0001';
    end if;
    perform public.bump_rate('grant', 10);
    insert into public.audit (actor, action, detail)
    values (me, 'app.signin', jsonb_build_object('app', app, 'device', left(coalesce(btrim(device), ''), 80)));
    return public.make_grant(me, app, device, challenge, interval '2 minutes', 8);
end;
$$;

create or replace function public.note_web_link() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    perform public.bump_rate('weblink', 10);
    insert into public.audit (actor, action, detail) values (me, 'app.weblink', '{}'::jsonb);
end;
$$;

-- staff here---

create or replace function public.staff_note(what text, detail jsonb, org uuid default null) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.audit (org_id, actor, action, detail)
    values (null, auth.uid(), 'staff.' || what, detail || jsonb_build_object('org', org));
$$;

create or replace function public.staff_suspend_user(uid uuid, suspended boolean, reason text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.need_staff(true);
begin
    if uid = me or exists (select 1 from public.staff where user_id = uid) then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
    update public.profiles
       set suspended_at = case when suspended then now() end, suspended_reason = case when suspended then left(coalesce(reason, ''), 500) else '' end
     where id = uid;
    if not found then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if suspended then
        delete from public.leases where user_id = uid;
        perform public.end_sessions(uid);
    end if;
    perform public.staff_note(case when suspended then 'suspend_user' else 'unsuspend_user' end, jsonb_build_object('user', uid, 'reason', reason));
end;
$$;

create or replace function public.staff_record_deletion(uid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.need_staff(true);
begin
    perform public.need_fresh();
    if uid = me or not exists (select 1 from public.profiles where id = uid) or exists (select 1 from public.staff where user_id = uid) then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
    perform public.staff_note('delete_user', jsonb_build_object('user', uid, 'email', (select lower(email) from auth.users where id = uid)));
end;
$$;

-- upkeep here---

create or replace function public.prepare_account_deletion(uid uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    o record;
    heir uuid;
    moved int := 0;
    dropped int := 0;
begin
    for o in select org_id as id from public.org_members where user_id = uid and role = 'owner' loop
        select m.user_id into heir from public.org_members m join public.profiles p on p.id = m.user_id
         where m.org_id = o.id and m.user_id <> uid and m.role <> 'guest' and p.suspended_at is null
         order by case m.role when 'admin' then 0 else 1 end, m.joined_at
         limit 1;
        if heir is null then
            delete from public.organizations where id = o.id;
            dropped := dropped + 1;
        else
            update public.org_members set role = 'admin' where org_id = o.id and user_id = uid;
            update public.org_members set role = 'owner' where org_id = o.id and user_id = heir;
            insert into public.audit (org_id, actor, action, detail)
            values (o.id, uid, 'org.transfer', jsonb_build_object('to', heir, 'reason', 'account deleted'));
            moved := moved + 1;
        end if;
    end loop;
    delete from public.leases where user_id = uid;
    return jsonb_build_object('transferred', moved, 'deleted', dropped);
end;
$$;

create or replace function public.purge_expired() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    projects int;
    leases int;
    changes int;
    strangers int := 0;
begin
    delete from public.projects where deleted_at < now() - interval '30 days';
    get diagnostics projects = row_count;
    delete from public.leases where expires_at < now() - interval '1 day';
    get diagnostics leases = row_count;
    delete from public.changes where at < now() - interval '30 days';
    get diagnostics changes = row_count;
    delete from public.rate where bucket < now() - interval '1 hour';
    delete from public.invites where expires_at < now() - interval '60 days' and accepted_at is null;
    delete from public.edit_sessions where ended_at < now() - interval '365 days';
    delete from public.app_grants where expires_at < now() - interval '1 day';
    delete from public.org_slugs where retired_at < now() - interval '180 days';
    delete from public.audit where at < now() - interval '400 days';
    begin
        delete from auth.users where email_confirmed_at is null and created_at < now() - interval '1 day';
        get diagnostics strangers = row_count;
    exception when insufficient_privilege then
        strangers := -1;
    end;
    return jsonb_build_object('projects', projects, 'leases', leases, 'changes', changes, 'unconfirmed', strangers);
end;
$$;

-- privileges here---

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function
    public.handle_new_user(), public.purge_expired(), public.prepare_account_deletion(uuid),
    public.note_change(uuid, uuid, text), public.note_org(uuid, text), public.note_audit(uuid, text, jsonb),
    public.note_org_audit(uuid, text, jsonb), public.take_lease(uuid, uuid, text),
    public.note_session(uuid, int), public.keep_auto(uuid, text, bigint), public.check_room(uuid, int, bigint),
    public.load_project(uuid, boolean), public.account_usage(uuid), public.org_usage(uuid), public.usage_for(uuid),
    public.plan_of(uuid), public.org_plan(uuid), public.plan_for(uuid), public.bill_of(uuid),
    public.add_space(uuid, text), public.drop_from_org(uuid, uuid), public.unique_slug(text), public.staff_note(text, jsonb, uuid),
    public.redeem_app_grant(text, text), public.make_grant(uuid, text, text, text, interval, int),
    public.person(uuid), public.live_lease(uuid), public.lease_json(public.leases), public.project_json(public.projects, boolean),
    public.bump_rate(text, int), public.slug_free(text, uuid), public.need_write(uuid), public.need_manage(uuid),
    public.need_org(uuid), public.need_manage_org(uuid), public.need_staff(boolean), public.need_fresh(), public.nc_uid(),
    public.need_live_org(uuid), public.org_live(uuid), public.can_write(uuid), public.signed_in_at(),
    public.password_session(), public.session_uuid(), public.amr_methods(), public.end_sessions(uuid, uuid),
    public.org_of(uuid), public.ws_of(uuid), public.versions_bytes(text, uuid), public.database_full(),
    public.held_by_other(uuid), public.claim_invite_send(uuid, uuid)
    from authenticated;
grant execute on function public.purge_expired(), public.prepare_account_deletion(uuid),
    public.redeem_app_grant(text, text), public.make_grant(uuid, text, text, text, interval, int),
    public.claim_invite_send(uuid, uuid), public.end_sessions(uuid, uuid) to service_role;
