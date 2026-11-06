create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    ws uuid;
    shown text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
    if shown = '' then
        shown := initcap(split_part(coalesce(new.email, 'writer'), '@', 1));
    end if;
    insert into public.profiles (id, display_name) values (new.id, left(shown, 80));
    insert into public.workspaces (name, kind, owner_id) values ('My cloud', 'personal', new.id) returning id into ws;
    insert into public.memberships (workspace_id, user_id, role) values (ws, new.id, 'owner');
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace function public.plan_of(owner uuid) returns public.plans
language sql stable security definer set search_path = public, pg_temp as $$
    select pl.* from public.profiles pr join public.plans pl on pl.id = pr.plan_id where pr.id = owner;
$$;

create or replace function public.owner_of(ws uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select owner_id from public.workspaces where id = ws;
$$;

create or replace function public.account_usage(owner uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'projects', (select count(*) from public.projects p join public.workspaces w on w.id = p.workspace_id
                     where w.owner_id = owner and p.deleted_at is null),
        'bytes', (select coalesce(sum(p.size), 0) from public.projects p join public.workspaces w on w.id = p.workspace_id
                  where w.owner_id = owner),
        'owned_teams', (select count(*) from public.workspaces where owner_id = owner and kind = 'team')
    );
$$;

create or replace function public.bump_rate(what text, per_minute int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    slot timestamptz := date_trunc('minute', now());
    used int;
begin
    insert into public.rate (user_id, kind, bucket, n) values (me, what, slot, 1)
    on conflict (user_id, kind, bucket) do update set n = public.rate.n + 1
    returning n into used;
    if used > per_minute then
        raise exception 'nc:rate' using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.me() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
    pr public.profiles;
    pl public.plans;
begin
    select * into pr from public.profiles where id = me;
    select * into pl from public.plans where id = pr.plan_id;
    return jsonb_build_object(
        'id', pr.id,
        'email', public.my_email(),
        'display_name', pr.display_name,
        'avatar_hue', pr.avatar_hue,
        'plan', to_jsonb(pl),
        'usage', public.account_usage(me),
        'personal_workspace', (select id from public.workspaces where owner_id = me and kind = 'personal')
    );
end;
$$;

create or replace function public.update_profile(display_name text, avatar_hue int default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    if char_length(btrim(display_name)) not between 1 and 80 then
        raise exception 'nc:invalid:name' using errcode = 'P0001';
    end if;
    update public.profiles
       set display_name = btrim(update_profile.display_name),
           avatar_hue = coalesce(update_profile.avatar_hue, public.profiles.avatar_hue)
     where id = me;
end;
$$;

create or replace function public.register_device(device_id uuid, name text, platform text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    insert into public.devices (id, user_id, name, platform)
    values (device_id, me, left(coalesce(nullif(btrim(name), ''), 'Computer'), 80), left(coalesce(platform, ''), 40))
    on conflict (id) do update set name = excluded.name, platform = excluded.platform, last_seen = now()
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
begin
    delete from public.leases where leases.device_id = forget_device.device_id and user_id = me;
    delete from public.devices where id = forget_device.device_id and user_id = me;
end;
$$;

create or replace function public.put_app_settings(app_id text, body text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
    me uuid := public.nc_uid();
begin
    perform public.bump_rate('settings', 20);
    insert into public.app_settings (user_id, app_id, body) values (me, put_app_settings.app_id, put_app_settings.body)
    on conflict (user_id, app_id) do update set body = excluded.body, updated_at = now();
end;
$$;

create or replace function public.usage_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    me uuid := public.nc_uid();
begin
    return jsonb_build_object('plan', to_jsonb(public.plan_of(me)), 'usage', public.account_usage(me));
end;
$$;
