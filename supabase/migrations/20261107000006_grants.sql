create or replace function public.grant_hash(code text) returns text
language sql immutable as $$
    select encode(sha256(convert_to(upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex');
$$;

create or replace function public.make_grant(uid uuid, app text, device text, challenge text, life interval) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    bytes bytea;
    code text;
    tries int := 0;
begin
    loop
        bytes := sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8'));
        code := '';
        for k in 0..7 loop
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
    perform public.bump_rate('grant', 10);
    insert into public.audit (actor, action, detail)
    values (me, 'app.signin', jsonb_build_object('app', app, 'device', left(coalesce(btrim(device), ''), 80)));
    return public.make_grant(me, app, device, challenge, interval '2 minutes');
end;
$$;

create or replace function public.redeem_app_grant(code text, challenge text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    g public.app_grants;
begin
    select * into g from public.app_grants where code_hash = public.grant_hash(code) for update;
    if g.id is null or g.used_at is not null or g.expires_at <= now() then
        raise exception 'nc:not_found' using errcode = 'P0001';
    end if;
    if g.challenge is distinct from redeem_app_grant.challenge then
        update public.app_grants
           set attempts = attempts + 1, used_at = case when attempts + 1 >= 5 then now() end
         where id = g.id;
        return jsonb_build_object('error', 'nc:forbidden');
    end if;
    if exists (select 1 from public.profiles where id = g.user_id and suspended_at is not null) then
        raise exception 'nc:suspended' using errcode = 'P0001';
    end if;
    update public.app_grants set used_at = now() where id = g.id;
    return jsonb_build_object(
        'user_id', g.user_id, 'email', (select lower(email) from auth.users where id = g.user_id),
        'app', g.app_id, 'device_name', g.device_name
    );
end;
$$;
