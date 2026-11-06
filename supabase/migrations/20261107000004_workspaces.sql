create or replace function public.note_change(ws uuid, project uuid, what text) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.changes (workspace_id, project_id, kind, by) values (ws, project, what, auth.uid());
$$;

create or replace function public.note_audit(ws uuid, what text, detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.audit (workspace_id, actor, action, detail) values (ws, auth.uid(), what, detail);
$$;

create or replace function public.need_manage(ws uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.nc_uid();
    if not public.can_manage(ws) then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.create_workspace(name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    pl public.plans := public.plan_of(me);
    ws uuid;
begin
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    if (public.account_usage(me) ->> 'owned_teams')::int >= pl.max_owned_teams then
        raise exception 'nc:limit:teams' using errcode = 'P0001';
    end if;
    insert into public.workspaces (name, kind, owner_id) values (btrim(name), 'team', me) returning id into ws;
    insert into public.memberships (workspace_id, user_id, role) values (ws, me, 'owner');
    perform public.note_audit(ws, 'workspace.create', jsonb_build_object('name', btrim(name)));
    perform public.note_change(ws, null, 'workspace');
    return ws;
end;
$$;

create or replace function public.rename_workspace(ws uuid, name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_manage(ws);
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    if (select kind from public.workspaces where id = ws) = 'personal' then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    update public.workspaces set name = btrim(rename_workspace.name) where id = ws;
    perform public.note_audit(ws, 'workspace.rename', jsonb_build_object('name', btrim(name)));
    perform public.note_change(ws, null, 'workspace');
end;
$$;

create or replace function public.delete_workspace(ws uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    if public.role_in(ws) is distinct from 'owner' then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    if (select kind from public.workspaces where id = ws) = 'personal' then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    perform public.note_audit(null, 'workspace.delete', jsonb_build_object('workspace', ws, 'by', me));
    delete from public.workspaces where id = ws;
end;
$$;

create or replace function public.invite_member(ws uuid, email text, role text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    who text := lower(btrim(email));
    pl public.plans := public.plan_of(public.owner_of(ws));
    seats int;
    made uuid;
begin
    perform public.need_manage(ws);
    perform public.bump_rate('invite', 10);
    if (select kind from public.workspaces where id = ws) = 'personal' then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    if role not in ('admin', 'editor', 'viewer') then
        raise exception 'nc:invalid:role' using errcode = 'P0001';
    end if;
    if role = 'admin' and public.role_in(ws) <> 'owner' then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    if who !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'nc:invalid:email' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
               where m.workspace_id = ws and lower(u.email) = who) then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
    select (select count(*) from public.memberships where workspace_id = ws)
         + (select count(*) from public.invites i where i.workspace_id = ws and i.accepted_at is null
            and i.declined_at is null and i.revoked_at is null and i.expires_at > now() and i.email <> who)
      into seats;
    if seats >= pl.max_members then
        raise exception 'nc:limit:members' using errcode = 'P0001';
    end if;
    update public.invites set revoked_at = now()
     where workspace_id = ws and invites.email = who and accepted_at is null and declined_at is null and revoked_at is null;
    insert into public.invites (workspace_id, email, role, invited_by) values (ws, who, invite_member.role, me)
    returning invites.id into made;
    perform public.note_audit(ws, 'member.invite', jsonb_build_object('email', who, 'role', role));
    perform public.note_change(ws, null, 'members');
    return made;
end;
$$;

create or replace function public.revoke_invite(invite uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    ws uuid := (select workspace_id from public.invites where id = invite);
begin
    perform public.need_manage(ws);
    update public.invites set revoked_at = now() where id = invite and accepted_at is null;
    perform public.note_change(ws, null, 'members');
end;
$$;

create or replace function public.invite_details(invite uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    i public.invites;
begin
    perform public.nc_uid();
    select * into i from public.invites where id = invite;
    if i.id is null or not (public.can_manage(i.workspace_id) or i.email = public.my_email()) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'expires_at', i.expires_at,
        'workspace', (select name from public.workspaces where id = i.workspace_id),
        'invited_by', (select display_name from public.profiles where id = i.invited_by)
    );
end;
$$;

create or replace function public.my_invites() returns setof jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.nc_uid();
    return query
        select jsonb_build_object(
            'id', i.id, 'role', i.role, 'expires_at', i.expires_at, 'workspace_id', i.workspace_id,
            'workspace', w.name, 'invited_by', p.display_name)
        from public.invites i
        join public.workspaces w on w.id = i.workspace_id
        left join public.profiles p on p.id = i.invited_by
        where i.email = public.my_email() and i.accepted_at is null and i.declined_at is null
          and i.revoked_at is null and i.expires_at > now()
        order by i.created_at;
end;
$$;

create or replace function public.accept_invite(invite uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    i public.invites;
begin
    select * into i from public.invites where id = invite for update;
    if i.id is null or i.email is distinct from public.my_email() or i.accepted_at is not null
       or i.declined_at is not null or i.revoked_at is not null or i.expires_at <= now() then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if (select email_confirmed_at from auth.users where id = me) is null then
        raise exception 'nc:unconfirmed' using errcode = 'P0001';
    end if;
    insert into public.memberships (workspace_id, user_id, role) values (i.workspace_id, me, i.role)
    on conflict (workspace_id, user_id) do nothing;
    update public.invites set accepted_at = now() where id = invite;
    perform public.note_audit(i.workspace_id, 'member.join', jsonb_build_object('role', i.role));
    perform public.note_change(i.workspace_id, null, 'members');
    return i.workspace_id;
end;
$$;

create or replace function public.decline_invite(invite uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.nc_uid();
    update public.invites set declined_at = now()
     where id = invite and email = public.my_email() and accepted_at is null;
end;
$$;

create or replace function public.set_role(ws uuid, member uuid, role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    mine text;
    theirs text;
begin
    perform public.need_manage(ws);
    mine := public.role_in(ws);
    select m.role into theirs from public.memberships m where workspace_id = ws and user_id = member;
    if theirs is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if role not in ('admin', 'editor', 'viewer') or theirs = 'owner' then
        raise exception 'nc:invalid:role' using errcode = 'P0001';
    end if;
    if mine = 'admin' and (theirs = 'admin' or role = 'admin') then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    update public.memberships set role = set_role.role where workspace_id = ws and user_id = member;
    if role = 'viewer' then
        delete from public.leases l using public.projects p
         where l.project_id = p.id and p.workspace_id = ws and l.user_id = member;
    end if;
    perform public.note_audit(ws, 'member.role', jsonb_build_object('member', member, 'role', role));
    perform public.note_change(ws, null, 'members');
end;
$$;

create or replace function public.remove_member(ws uuid, member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    theirs text;
begin
    perform public.need_manage(ws);
    select m.role into theirs from public.memberships m where workspace_id = ws and user_id = member;
    if theirs is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if theirs = 'owner' or (theirs = 'admin' and public.role_in(ws) <> 'owner') then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    delete from public.leases l using public.projects p
     where l.project_id = p.id and p.workspace_id = ws and l.user_id = member;
    delete from public.memberships where workspace_id = ws and user_id = member;
    perform public.note_audit(ws, 'member.remove', jsonb_build_object('member', member));
    perform public.note_change(ws, null, 'members');
end;
$$;

create or replace function public.leave_workspace(ws uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    mine text := public.role_in(ws);
begin
    if mine is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if mine = 'owner' then
        raise exception 'nc:invalid:owner' using errcode = 'P0001';
    end if;
    delete from public.leases l using public.projects p
     where l.project_id = p.id and p.workspace_id = ws and l.user_id = me;
    delete from public.memberships where workspace_id = ws and user_id = me;
    perform public.note_audit(ws, 'member.leave');
    perform public.note_change(ws, null, 'members');
end;
$$;

create or replace function public.transfer_ownership(ws uuid, member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    if public.role_in(ws) is distinct from 'owner' then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    if (select kind from public.workspaces where id = ws) = 'personal' then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    if member = me or not exists (select 1 from public.memberships where workspace_id = ws and user_id = member) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if (public.account_usage(member) ->> 'owned_teams')::int >= (public.plan_of(member)).max_owned_teams then
        raise exception 'nc:limit:teams' using errcode = 'P0001';
    end if;
    update public.memberships set role = 'admin' where workspace_id = ws and user_id = me;
    update public.memberships set role = 'owner' where workspace_id = ws and user_id = member;
    update public.workspaces set owner_id = member where id = ws;
    perform public.note_audit(ws, 'workspace.transfer', jsonb_build_object('to', member));
    perform public.note_change(ws, null, 'members');
end;
$$;
