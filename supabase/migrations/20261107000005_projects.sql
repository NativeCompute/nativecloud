create or replace function public.word_count(t text) returns int
language sql immutable as $$
    select case when btrim(coalesce(t, '')) = '' then 0
                else coalesce(array_length(regexp_split_to_array(btrim(t), '\s+'), 1), 0) end;
$$;

create or replace function public.person(who uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when who is null then null
                else (select jsonb_build_object('id', id, 'name', display_name, 'hue', avatar_hue)
                      from public.profiles where id = who) end;
$$;

create or replace function public.live_lease(p uuid) returns public.leases
language sql stable security definer set search_path = public, pg_temp as $$
    select * from public.leases where project_id = p and expires_at > now();
$$;

create or replace function public.lease_json(l public.leases) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select case when l.project_id is null then null
                else jsonb_build_object('user', public.person(l.user_id), 'device_id', l.device_id,
                                        'device_name', l.device_name, 'expires_at', l.expires_at,
                                        'mine', l.user_id = auth.uid()) end;
$$;

create or replace function public.project_json(p public.projects, with_body boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'id', p.id, 'workspace_id', p.workspace_id, 'app_id', p.app_id, 'title', p.title,
        'meta', p.meta, 'version', p.version, 'size', p.size, 'updated_at', p.updated_at,
        'updated_by', public.person(p.updated_by), 'created_by', public.person(p.created_by),
        'deleted_at', p.deleted_at
    ) || case when with_body then jsonb_build_object('body', p.body) else '{}'::jsonb end;
$$;

create or replace function public.load_project(p uuid, lock boolean) returns public.projects
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    row public.projects;
begin
    perform public.nc_uid();
    if lock then
        select * into row from public.projects where id = p for update;
    else
        select * into row from public.projects where id = p;
    end if;
    if row.id is null or not public.is_member(row.workspace_id) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    return row;
end;
$$;

create or replace function public.need_write(ws uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not public.can_write(ws) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.check_room(owner uuid, more_projects int, more_bytes bigint) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    pl public.plans := public.plan_of(owner);
    used jsonb := public.account_usage(owner);
begin
    if more_projects > 0 and (used ->> 'projects')::int + more_projects > pl.max_projects then
        raise exception 'nc:limit:projects' using errcode = 'P0001';
    end if;
    if more_bytes > 0 and (used ->> 'bytes')::bigint + more_bytes > pl.max_bytes then
        raise exception 'nc:limit:storage' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.take_lease(p uuid, device_id uuid, device_name text) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.leases (project_id, user_id, device_id, device_name, expires_at)
    values (p, auth.uid(), take_lease.device_id, left(coalesce(take_lease.device_name, ''), 80), now() + interval '90 seconds')
    on conflict (project_id) do update
        set user_id = excluded.user_id, device_id = excluded.device_id, device_name = excluded.device_name,
            acquired_at = case when public.leases.user_id = excluded.user_id and public.leases.device_id = excluded.device_id
                               then public.leases.acquired_at else now() end,
            expires_at = excluded.expires_at;
$$;

create or replace function public.note_session(p uuid, delta int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := auth.uid();
    last bigint;
begin
    select id into last from public.edit_sessions
     where project_id = p and user_id = me and ended_at > now() - interval '10 minutes'
     order by ended_at desc limit 1;
    if last is null then
        insert into public.edit_sessions (project_id, user_id, words_delta, saves) values (p, me, delta, 1);
    else
        update public.edit_sessions set ended_at = now(), saves = saves + 1, words_delta = words_delta + delta where id = last;
    end if;
end;
$$;

create or replace function public.keep_auto(p uuid, body text, version bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    keep int := (public.plan_of(public.owner_of(public.project_workspace(p)))).max_auto_snapshots;
begin
    if exists (select 1 from public.project_versions v where v.project_id = p and v.kind = 'auto'
               and v.created_at > now() - interval '10 minutes') then
        return;
    end if;
    insert into public.project_versions (project_id, version, body, kind, created_by)
    values (p, keep_auto.version, keep_auto.body, 'auto', auth.uid());
    delete from public.project_versions v
     where v.project_id = p and v.kind = 'auto'
       and v.id not in (select id from public.project_versions where project_id = p and kind = 'auto'
                        order by created_at desc limit keep);
end;
$$;

create or replace function public.create_project(ws uuid, app_id text, title text, body text default '', meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects;
begin
    perform public.need_write(ws);
    perform public.bump_rate('create', 30);
    if not exists (select 1 from public.apps a where a.id = create_project.app_id) then
        raise exception 'nc:invalid:app' using errcode = 'P0001';
    end if;
    perform public.check_room(public.owner_of(ws), 1, octet_length(coalesce(body, '')));
    insert into public.projects (workspace_id, app_id, title, body, meta, created_by, updated_by)
    values (ws, create_project.app_id, left(coalesce(title, ''), 200), coalesce(body, ''), coalesce(meta, '{}'::jsonb), me, me)
    returning * into row;
    perform public.note_session(row.id, public.word_count(row.body));
    perform public.keep_auto(row.id, row.body, row.version);
    perform public.note_change(ws, row.id, 'project');
    return public.project_json(row, false);
end;
$$;

create or replace function public.open_project(p uuid, device_id uuid, device_name text, want_edit boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, false);
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

create or replace function public.request_edit(p uuid, device_id uuid, device_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, true);
    held public.leases := public.live_lease(p);
begin
    perform public.need_write(row.workspace_id);
    if row.deleted_at is not null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if held.project_id is not null and held.user_id <> me then
        return jsonb_build_object('access', 'read', 'lease', public.lease_json(held), 'project', public.project_json(row, true));
    end if;
    perform public.take_lease(p, device_id, device_name);
    perform public.note_change(row.workspace_id, p, 'lease');
    return jsonb_build_object('access', 'edit', 'lease', public.lease_json(public.live_lease(p)), 'project', public.project_json(row, true));
end;
$$;

create or replace function public.renew_lease(p uuid, device_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, false);
    held public.leases := public.live_lease(p);
begin
    if held.project_id is null or (held.user_id = me and held.device_id = renew_lease.device_id) then
        if not public.can_write(row.workspace_id) or row.deleted_at is not null then
            return jsonb_build_object('held', false, 'lease', null, 'version', row.version);
        end if;
        perform public.take_lease(p, device_id, coalesce(held.device_name, (select name from public.devices d where d.id = renew_lease.device_id), ''));
        return jsonb_build_object('held', true, 'version', row.version);
    end if;
    return jsonb_build_object('held', false, 'lease', public.lease_json(held), 'version', row.version);
end;
$$;

create or replace function public.release_lease(p uuid, device_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    ws uuid := public.project_workspace(p);
begin
    delete from public.leases l where l.project_id = p and l.user_id = me and l.device_id = release_lease.device_id;
    if found then
        perform public.note_change(ws, p, 'lease');
    end if;
end;
$$;

create or replace function public.save_project(p uuid, base_version bigint, body text, title text default null,
                                               meta jsonb default null, device_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, true);
    held public.leases := public.live_lease(p);
    pl public.plans;
    before int := public.word_count(row.body);
begin
    perform public.need_write(row.workspace_id);
    if row.deleted_at is not null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    pl := public.plan_of(public.owner_of(row.workspace_id));
    perform public.bump_rate('save', pl.max_saves_per_minute);
    if held.project_id is not null and not (held.user_id = me and (save_project.device_id is null or held.device_id = save_project.device_id)) then
        return jsonb_build_object('status', 'locked', 'lease', public.lease_json(held), 'version', row.version);
    end if;
    if row.version <> base_version then
        return jsonb_build_object('status', 'conflict', 'project', public.project_json(row, true));
    end if;
    if octet_length(body) > row.size then
        perform public.check_room(public.owner_of(row.workspace_id), 0, octet_length(body) - row.size);
    end if;
    update public.projects
       set body = save_project.body,
           title = left(coalesce(save_project.title, public.projects.title), 200),
           meta = coalesce(save_project.meta, public.projects.meta),
           version = public.projects.version + 1,
           updated_by = me,
           updated_at = now()
     where id = p
    returning * into row;
    if save_project.device_id is not null then
        perform public.take_lease(p, save_project.device_id, coalesce(held.device_name, (select name from public.devices d where d.id = save_project.device_id), ''));
    end if;
    perform public.note_session(p, public.word_count(row.body) - before);
    perform public.keep_auto(p, row.body, row.version);
    perform public.note_change(row.workspace_id, p, 'project');
    return jsonb_build_object('status', 'saved', 'version', row.version, 'updated_at', row.updated_at);
end;
$$;

create or replace function public.take_snapshot(p uuid, label text default '', kind text default 'manual', body text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, false);
    pl public.plans := public.plan_of(public.owner_of(row.workspace_id));
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
    insert into public.project_versions (project_id, version, body, label, kind, created_by)
    values (p, row.version, coalesce(take_snapshot.body, row.body), left(coalesce(label, ''), 120), take_snapshot.kind, me)
    returning project_versions.id into made;
    delete from public.project_versions v
     where v.project_id = p and v.kind in ('conflict', 'offline', 'restore')
       and v.id not in (select x.id from public.project_versions x where x.project_id = p
                        and x.kind in ('conflict', 'offline', 'restore') order by x.created_at desc limit pl.max_kept_snapshots);
    perform public.note_change(row.workspace_id, p, 'versions');
    return made;
end;
$$;

create or replace function public.delete_snapshot(snapshot uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    p uuid := (select project_id from public.project_versions where id = snapshot);
    ws uuid := public.project_workspace(p);
begin
    perform public.nc_uid();
    if ws is null or not public.can_write(ws) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    delete from public.project_versions where id = snapshot;
    perform public.note_change(ws, p, 'versions');
end;
$$;

create or replace function public.restore_snapshot(snapshot uuid, base_version bigint, device_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v public.project_versions;
    row public.projects;
begin
    perform public.nc_uid();
    select * into v from public.project_versions where id = snapshot;
    if v.id is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    row := public.load_project(v.project_id, false);
    if row.version = base_version then
        perform public.take_snapshot(v.project_id, 'Before a restore', 'restore', null);
    end if;
    return public.save_project(v.project_id, base_version, v.body, null, null, device_id);
end;
$$;

create or replace function public.delete_project(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, true);
begin
    perform public.need_write(row.workspace_id);
    update public.projects set deleted_at = now(), deleted_by = me where id = p and deleted_at is null;
    delete from public.leases where project_id = p;
    perform public.note_change(row.workspace_id, p, 'project');
end;
$$;

create or replace function public.restore_project(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    row public.projects := public.load_project(p, true);
begin
    perform public.need_write(row.workspace_id);
    if row.deleted_at is null then
        return;
    end if;
    perform public.check_room(public.owner_of(row.workspace_id), 1, 0);
    update public.projects set deleted_at = null, deleted_by = null where id = p;
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
    delete from public.projects where id = p;
    perform public.note_change(row.workspace_id, p, 'project');
end;
$$;

create or replace function public.move_project(p uuid, to_workspace uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    row public.projects := public.load_project(p, true);
begin
    perform public.need_write(row.workspace_id);
    perform public.need_write(to_workspace);
    if row.workspace_id = to_workspace then
        return;
    end if;
    if public.owner_of(to_workspace) <> public.owner_of(row.workspace_id) then
        perform public.check_room(public.owner_of(to_workspace), case when row.deleted_at is null then 1 else 0 end, row.size);
    end if;
    delete from public.leases where project_id = p;
    update public.projects set workspace_id = to_workspace where id = p;
    perform public.note_change(row.workspace_id, p, 'project');
    perform public.note_change(to_workspace, p, 'project');
    perform public.note_audit(to_workspace, 'project.move', jsonb_build_object('project', p, 'from', row.workspace_id));
end;
$$;

create or replace function public.duplicate_project(p uuid, title text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    row public.projects := public.load_project(p, false);
begin
    return public.create_project(row.workspace_id, row.app_id, coalesce(title, row.title || ' (copy)'), row.body, row.meta);
end;
$$;

create or replace function public.set_star(p uuid, starred boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    row public.projects := public.load_project(p, false);
begin
    if starred then
        insert into public.stars (user_id, project_id) values (me, row.id) on conflict do nothing;
    else
        delete from public.stars where user_id = me and project_id = row.id;
    end if;
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
            select jsonb_agg(jsonb_build_object('seq', c.seq, 'workspace_id', c.workspace_id, 'project_id', c.project_id,
                                                'kind', c.kind, 'by', c.by, 'at', c.at) order by c.seq)
            from (select * from public.changes ch
                  where ch.seq > since and ch.workspace_id in (select workspace_id from public.memberships where user_id = me)
                  order by ch.seq limit 1000) c), '[]'::jsonb)
    );
end;
$$;
