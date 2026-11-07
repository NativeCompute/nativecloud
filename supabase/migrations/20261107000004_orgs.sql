create or replace function public.note_change(ws uuid, project uuid, what text) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.changes (workspace_id, project_id, kind, by) values (ws, project, what, auth.uid());
$$;

create or replace function public.note_org(org uuid, what text) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.changes (org_id, kind, by) values (org, what, auth.uid());
$$;

create or replace function public.note_audit(ws uuid, what text, detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.audit (workspace_id, org_id, actor, action, detail)
    values (ws, (select org_id from public.workspaces where id = ws), auth.uid(), what, detail);
$$;

create or replace function public.note_org_audit(org uuid, what text, detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.audit (org_id, actor, action, detail) values (org, auth.uid(), what, detail);
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

create or replace function public.need_org(org uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    mine text;
begin
    perform public.nc_uid();
    mine := public.org_role(org);
    if mine is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    return mine;
end;
$$;

create or replace function public.need_manage_org(org uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    mine text := public.need_org(org);
begin
    if mine not in ('owner', 'admin') then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    if not public.org_live(org) then
        raise exception 'nc:suspended' using errcode = 'P0001';
    end if;
    return mine;
end;
$$;

-- slugs here---

create or replace function public.slugify(t text) returns text
language sql immutable as $$
    select left(btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g'), '-'), 40);
$$;

create or replace function public.slug_free(s text, mine uuid default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select not exists (select 1 from public.organizations where slug = s and id is distinct from mine)
       and not exists (select 1 from public.org_slugs where slug = s and org_id is distinct from mine);
$$;

create or replace function public.unique_slug(base text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    root text := btrim(left(coalesce(nullif(public.slugify(base), ''), 'team'), 34), '-');
    candidate text := root;
    n int := 2;
begin
    if char_length(root) < 2 then
        root := root || '-team';
        candidate := root;
    end if;
    while not public.slug_free(candidate) loop
        candidate := root || '-' || n;
        n := n + 1;
    end loop;
    return candidate;
end;
$$;

-- organizations here---

create or replace function public.add_space(org uuid, name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    ws uuid;
begin
    insert into public.workspaces (name, kind, org_id) values (btrim(name), 'space', org) returning id into ws;
    insert into public.memberships (workspace_id, user_id, role)
    select ws, m.user_id, 'editor' from public.org_members m where m.org_id = org and m.role <> 'guest';
    return ws;
end;
$$;

create or replace function public.create_org(name text, slug text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    pl public.plans := public.plan_of(me);
    tier public.plans;
    chosen text;
    org uuid;
    ws uuid;
begin
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    perform public.bump_rate('org', 5);
    if (public.account_usage(me) ->> 'owned_orgs')::int >= pl.max_owned_orgs then
        raise exception 'nc:limit:orgs' using errcode = 'P0001';
    end if;
    if slug is null or btrim(slug) = '' then
        chosen := public.unique_slug(name);
    else
        chosen := lower(btrim(slug));
        if chosen !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' or not public.slug_free(chosen) then
            raise exception 'nc:invalid:slug' using errcode = 'P0001';
        end if;
    end if;
    select * into tier from public.plans where id = 'team';
    insert into public.organizations (name, slug, plan_id, trial_ends_at, created_by)
    values (btrim(name), chosen, tier.id, case when tier.trial_days > 0 then now() + make_interval(days => tier.trial_days) end, me)
    returning id into org;
    insert into public.org_members (org_id, user_id, role) values (org, me, 'owner');
    ws := public.add_space(org, 'General');
    perform public.note_org_audit(org, 'org.create', jsonb_build_object('name', btrim(name), 'slug', chosen));
    perform public.note_org(org, 'org');
    return jsonb_build_object('id', org, 'slug', chosen, 'space', ws);
end;
$$;

create or replace function public.rename_org(org uuid, name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_manage_org(org);
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
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

create or replace function public.org_by_slug(slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    o public.organizations;
begin
    perform public.nc_uid();
    select * into o from public.organizations where organizations.slug = lower(btrim(org_by_slug.slug));
    if o.id is null then
        select org.* into o from public.org_slugs s join public.organizations org on org.id = s.org_id
         where s.slug = lower(btrim(org_by_slug.slug));
    end if;
    if o.id is null or not (public.in_org(o.id) or public.is_staff()) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'role', public.org_role(o.id), 'settings', o.settings,
        'plan', to_jsonb(public.org_plan(o.id)), 'usage', public.org_usage(o.id), 'trial_ends_at', o.trial_ends_at,
        'suspended', o.suspended_at is not null, 'created_at', o.created_at
    );
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
    perform public.need_fresh();
    select role into theirs from public.org_members where org_id = org and user_id = member;
    if theirs is null or member = me then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if theirs = 'guest' then
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

-- spaces here---

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
    if not public.org_live(org) then
        raise exception 'nc:suspended' using errcode = 'P0001';
    end if;
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    if (public.org_usage(org) ->> 'spaces')::int >= pl.max_spaces then
        raise exception 'nc:limit:spaces' using errcode = 'P0001';
    end if;
    ws := public.add_space(org, name);
    perform public.note_audit(ws, 'space.create', jsonb_build_object('name', btrim(name)));
    perform public.note_org(org, 'workspace');
    return ws;
end;
$$;

create or replace function public.rename_space(ws uuid, name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_manage(ws);
    if char_length(btrim(name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    if (select kind from public.workspaces where id = ws) = 'personal' then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    update public.workspaces set name = btrim(rename_space.name) where id = ws;
    perform public.note_audit(ws, 'space.rename', jsonb_build_object('name', btrim(name)));
    perform public.note_change(ws, null, 'workspace');
end;
$$;

create or replace function public.archive_space(ws uuid, archived boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_manage(ws);
    if (select kind from public.workspaces where id = ws) = 'personal' then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    if not archived and (public.org_usage(public.space_org(ws)) ->> 'spaces')::int >= (public.org_plan(public.space_org(ws))).max_spaces then
        raise exception 'nc:limit:spaces' using errcode = 'P0001';
    end if;
    update public.workspaces set archived_at = case when archived then now() end where id = ws;
    if archived then
        delete from public.leases l using public.projects p where l.project_id = p.id and p.workspace_id = ws;
    end if;
    perform public.note_audit(ws, case when archived then 'space.archive' else 'space.unarchive' end);
    perform public.note_change(ws, null, 'workspace');
end;
$$;

create or replace function public.delete_space(ws uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    org uuid := public.space_org(ws);
begin
    perform public.need_manage(ws);
    if org is null then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    perform public.need_fresh();
    perform public.note_org_audit(org, 'space.delete', jsonb_build_object('space', ws, 'name', (select name from public.workspaces where id = ws)));
    delete from public.workspaces where id = ws;
    perform public.note_org(org, 'workspace');
end;
$$;

create or replace function public.set_space_member(ws uuid, member uuid, role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    org uuid := public.space_org(ws);
begin
    perform public.need_manage(ws);
    if org is null then
        raise exception 'nc:invalid:personal' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.org_members m where m.org_id = org and m.user_id = member) then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
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

-- invites here---

create or replace function public.invite_member(org uuid, email text, role text, spaces uuid[] default '{}', space_role text default 'editor')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    mine text := public.need_manage_org(org);
    who text := lower(btrim(email));
    pl public.plans := public.org_plan(org);
    used jsonb := public.org_usage(org);
    chosen uuid[] := coalesce(spaces, '{}');
    made uuid;
begin
    perform public.bump_rate('invite', 20);
    if role not in ('admin', 'member', 'guest') or space_role not in ('editor', 'viewer') then
        raise exception 'nc:invalid:role' using errcode = 'P0001';
    end if;
    if role = 'admin' and mine <> 'owner' then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    if who !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'nc:invalid:email' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id
               where m.org_id = org and lower(u.email) = who) then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(chosen) s where s not in (select id from public.workspaces where org_id = org)) then
        raise exception 'nc:invalid:spaces' using errcode = 'P0001';
    end if;
    if role = 'guest' and cardinality(chosen) = 0 then
        raise exception 'nc:invalid:spaces' using errcode = 'P0001';
    end if;
    if (used ->> 'people')::int
       + (select count(*) from public.invites i where i.org_id = org and i.accepted_at is null and i.declined_at is null
          and i.revoked_at is null and i.expires_at > now() and i.email <> who) >= pl.max_people then
        raise exception 'nc:limit:members' using errcode = 'P0001';
    end if;
    update public.invites set revoked_at = now()
     where invites.org_id = org and invites.email = who and accepted_at is null and declined_at is null and revoked_at is null;
    insert into public.invites (org_id, email, role, spaces, space_role, invited_by)
    values (org, who, invite_member.role, chosen, invite_member.space_role, me)
    returning invites.id into made;
    perform public.note_org_audit(org, 'member.invite', jsonb_build_object('email', who, 'role', role));
    perform public.note_org(org, 'members');
    return made;
end;
$$;

create or replace function public.revoke_invite(invite uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    org uuid := (select org_id from public.invites where id = invite);
begin
    if org is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    perform public.need_manage_org(org);
    update public.invites set revoked_at = now() where id = invite and accepted_at is null;
    perform public.note_org_audit(org, 'member.revoke', jsonb_build_object('invite', invite));
    perform public.note_org(org, 'members');
end;
$$;

create or replace function public.invite_state(i public.invites) returns text
language sql stable as $$
    select case
        when i.accepted_at is not null then 'accepted'
        when i.declined_at is not null then 'declined'
        when i.revoked_at is not null then 'revoked'
        when i.expires_at <= now() then 'expired'
        else 'pending'
    end;
$$;

create or replace function public.invite_details(invite uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    i public.invites;
    o public.organizations;
begin
    perform public.nc_uid();
    select * into i from public.invites where id = invite;
    if i.id is null or not (public.can_manage_org(i.org_id) or i.email = public.my_email()) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    select * into o from public.organizations where id = i.org_id;
    return jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'expires_at', i.expires_at, 'state', public.invite_state(i),
        'org_id', o.id, 'org', o.name, 'org_slug', o.slug,
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
            'id', i.id, 'role', i.role, 'expires_at', i.expires_at, 'org_id', i.org_id,
            'org', o.name, 'org_slug', o.slug, 'invited_by', p.display_name)
        from public.invites i
        join public.organizations o on o.id = i.org_id
        left join public.profiles p on p.id = i.invited_by
        where i.email = public.my_email() and public.invite_state(i) = 'pending'
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
    if i.id is null or i.email is distinct from public.my_email() or public.invite_state(i) <> 'pending' then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if (select email_confirmed_at from auth.users where id = me) is null then
        raise exception 'nc:unconfirmed' using errcode = 'P0001';
    end if;
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

create or replace function public.decline_invite(invite uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.nc_uid();
    update public.invites set declined_at = now()
     where id = invite and email = public.my_email() and accepted_at is null;
end;
$$;

-- members here---

create or replace function public.drop_from_org(org uuid, member uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
    delete from public.leases l using public.projects p, public.workspaces w
     where l.project_id = p.id and p.workspace_id = w.id and w.org_id = org and l.user_id = member;
    delete from public.memberships m using public.workspaces w
     where m.workspace_id = w.id and w.org_id = org and m.user_id = member;
    delete from public.org_members where org_id = org and user_id = member;
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
    update public.org_members m set role = set_org_role.role where m.org_id = org and m.user_id = member;
    if theirs = 'guest' and role <> 'guest' then
        insert into public.memberships (workspace_id, user_id, role)
        select w.id, member, 'editor' from public.workspaces w where w.org_id = org
        on conflict (workspace_id, user_id) do nothing;
    end if;
    perform public.note_org_audit(org, 'member.role', jsonb_build_object('member', member, 'role', role));
    perform public.note_org(org, 'members');
end;
$$;

create or replace function public.remove_member(org uuid, member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    mine text := public.need_manage_org(org);
    theirs text;
begin
    select role into theirs from public.org_members where org_id = org and user_id = member;
    if theirs is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if theirs = 'owner' or (theirs = 'admin' and mine <> 'owner') then
        raise exception 'nc:forbidden' using errcode = 'P0001';
    end if;
    perform public.drop_from_org(org, member);
    perform public.note_org_audit(org, 'member.remove', jsonb_build_object('member', member));
    perform public.note_org(org, 'members');
end;
$$;

create or replace function public.leave_org(org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    mine text := public.need_org(org);
begin
    if mine = 'owner' then
        raise exception 'nc:invalid:owner' using errcode = 'P0001';
    end if;
    perform public.drop_from_org(org, me);
    perform public.note_org_audit(org, 'member.leave');
    perform public.note_org(org, 'members');
end;
$$;
