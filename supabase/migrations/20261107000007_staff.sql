create or replace function public.need_staff(admin_only boolean default false) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    if not public.is_staff(admin_only) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    return me;
end;
$$;

create or replace function public.staff_note(what text, detail jsonb, org uuid default null) returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.audit (org_id, actor, action, detail) values (org, auth.uid(), 'staff.' || what, detail);
$$;

create or replace function public.staff_search(q text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    needle text := '%' || lower(btrim(coalesce(q, ''))) || '%';
    exact text := lower(btrim(coalesce(q, '')));
begin
    perform public.need_staff();
    return jsonb_build_object(
        'users', coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', p.display_name, 'plan', p.plan_id,
                                                'created_at', p.created_at, 'suspended', p.suspended_at is not null) order by p.created_at desc)
            from (select pr.*, lower(au.email) as email from public.profiles pr
                  join auth.users au on au.id = pr.id
                  where lower(au.email) like needle or lower(pr.display_name) like needle or pr.id::text = exact
                  order by pr.created_at desc limit 25) p), '[]'::jsonb),
        'orgs', coalesce((
            select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'plan', o.plan_id,
                                                'people', (select count(*) from public.org_members m where m.org_id = o.id),
                                                'created_at', o.created_at, 'suspended', o.suspended_at is not null) order by o.created_at desc)
            from (select * from public.organizations
                  where lower(name) like needle or slug like needle or id::text = exact
                  order by created_at desc limit 25) o), '[]'::jsonb)
    );
end;
$$;

create or replace function public.staff_user(uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    p public.profiles;
    u auth.users;
begin
    perform public.need_staff();
    select * into p from public.profiles where id = uid;
    select * into u from auth.users where id = uid;
    if p.id is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
        'id', p.id, 'email', lower(u.email), 'name', p.display_name, 'plan', p.plan_id, 'created_at', p.created_at,
        'confirmed', u.email_confirmed_at is not null, 'last_sign_in_at', u.last_sign_in_at,
        'suspended', p.suspended_at is not null, 'suspended_reason', p.suspended_reason,
        'staff', (select role from public.staff where user_id = uid),
        'usage', public.account_usage(uid),
        'devices', (select count(*) from public.devices where user_id = uid),
        'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'role', m.role))
                          from public.org_members m join public.organizations o on o.id = m.org_id where m.user_id = uid), '[]'::jsonb)
    );
end;
$$;

create or replace function public.staff_org(org uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    o public.organizations;
begin
    perform public.need_staff();
    select * into o from public.organizations where id = org;
    if o.id is null then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'plan', to_jsonb(public.org_plan(o.id)), 'usage', public.org_usage(o.id),
        'trial_ends_at', o.trial_ends_at, 'created_at', o.created_at,
        'suspended', o.suspended_at is not null, 'suspended_reason', o.suspended_reason,
        'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', p.display_name, 'email', lower(u.email),
                                                                 'role', m.role, 'joined_at', m.joined_at) order by m.joined_at)
                             from public.org_members m join public.profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id
                             where m.org_id = o.id), '[]'::jsonb),
        'spaces', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'archived', w.archived_at is not null,
                                                                'projects', (select count(*) from public.projects pr where pr.workspace_id = w.id and pr.deleted_at is null))
                                             order by w.created_at)
                            from public.workspaces w where w.org_id = o.id), '[]'::jsonb)
    );
end;
$$;

create or replace function public.staff_set_plan(org uuid, plan text, trial_days int default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_staff();
    if not exists (select 1 from public.plans where id = plan and scope = 'org') then
        raise exception 'nc:invalid:plan' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.organizations where id = org) then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    update public.organizations
       set plan_id = plan,
           trial_ends_at = case when trial_days is null then trial_ends_at
                                when trial_days <= 0 then null
                                else now() + make_interval(days => trial_days) end
     where id = org;
    perform public.staff_note('plan', jsonb_build_object('org', org, 'plan', plan, 'trial_days', trial_days), org);
    perform public.note_org(org, 'org');
end;
$$;

create or replace function public.staff_set_user_plan(uid uuid, plan text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_staff();
    if not exists (select 1 from public.plans where id = plan and scope = 'personal') then
        raise exception 'nc:invalid:plan' using errcode = 'P0001';
    end if;
    update public.profiles set plan_id = plan where id = uid;
    if not found then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    perform public.staff_note('user_plan', jsonb_build_object('user', uid, 'plan', plan));
end;
$$;

create or replace function public.staff_suspend_org(org uuid, suspended boolean, reason text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.need_staff(true);
    update public.organizations
       set suspended_at = case when suspended then now() end, suspended_reason = case when suspended then left(coalesce(reason, ''), 500) else '' end
     where id = org;
    if not found then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if suspended then
        delete from public.leases l using public.projects p, public.workspaces w
         where l.project_id = p.id and p.workspace_id = w.id and w.org_id = org;
    end if;
    perform public.staff_note(case when suspended then 'suspend_org' else 'unsuspend_org' end, jsonb_build_object('org', org, 'reason', reason), org);
    perform public.note_org(org, 'org');
end;
$$;

create or replace function public.staff_suspend_user(uid uuid, suspended boolean, reason text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.need_staff(true);
begin
    if uid = me then
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
    end if;
    perform public.staff_note(case when suspended then 'suspend_user' else 'unsuspend_user' end, jsonb_build_object('user', uid, 'reason', reason));
end;
$$;

create or replace function public.staff_stats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.need_staff();
    return jsonb_build_object(
        'users', (select count(*) from public.profiles),
        'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
        'signups_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
        'signups_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
        'orgs', (select count(*) from public.organizations),
        'orgs_active_7d', (select count(distinct w.org_id) from public.changes c join public.workspaces w on w.id = c.workspace_id
                           where c.at > now() - interval '7 days' and w.org_id is not null),
        'projects', (select count(*) from public.projects where deleted_at is null),
        'project_bytes', (select coalesce(sum(size), 0) from public.projects),
        'database_bytes', pg_database_size(current_database()),
        'plans', coalesce((select jsonb_object_agg(plan_id, n) from (select plan_id, count(*) n from public.organizations group by plan_id) x), '{}'::jsonb),
        'suspended_orgs', (select count(*) from public.organizations where suspended_at is not null),
        'suspended_users', (select count(*) from public.profiles where suspended_at is not null)
    );
end;
$$;

create or replace function public.staff_record_deletion(uid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.need_staff(true);
begin
    perform public.need_fresh();
    if uid = me or not exists (select 1 from public.profiles where id = uid) then
        raise exception 'nc:invalid:member' using errcode = 'P0001';
    end if;
    perform public.staff_note('delete_user', jsonb_build_object('user', uid, 'email', (select lower(email) from auth.users where id = uid)));
end;
$$;
