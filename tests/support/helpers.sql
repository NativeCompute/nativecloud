create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.new_user(email text, confirmed boolean default true, shown text default '') returns uuid
language plpgsql security definer as $$
declare
    id uuid := gen_random_uuid();
begin
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', lower(email),
            case when confirmed then now() end, jsonb_build_object('display_name', shown));
    return id;
end;
$$;

create or replace function tests.act_as(who uuid) returns void
language plpgsql as $$
begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated',
        'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600)))::text, false);
    perform set_config('request.jwt.claim.sub', who::text, false);
    perform set_config('role', 'authenticated', false);
end;
$$;

create or replace function tests.signed_in_ago(seconds int) returns void
language plpgsql as $$
begin
    perform set_config('request.jwt.claims',
        (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
         || jsonb_build_object('iat', extract(epoch from now())::bigint,
                               'amr', jsonb_build_array(jsonb_build_object('method', 'password',
                                                        'timestamp', extract(epoch from now())::bigint - seconds))))::text, false);
end;
$$;

create or replace function tests.act_as_app(who uuid) returns void
language plpgsql as $$
begin
    perform tests.act_as(who);
    perform set_config('request.jwt.claims',
        jsonb_build_object('sub', who, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint,
                           'session_id', gen_random_uuid(),
                           'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint)))::text, false);
end;
$$;

create or replace function tests.act_anon() returns void
language plpgsql as $$
begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', false);
    perform set_config('request.jwt.claim.sub', '', false);
    perform set_config('role', 'anon', false);
end;
$$;

create or replace function tests.act_admin() returns void
language plpgsql as $$
begin
    reset role;
    perform set_config('request.jwt.claims', '', false);
    perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

create or replace function tests.ok(passed boolean, what text) returns void
language plpgsql as $$
begin
    if passed is distinct from true then
        raise exception 'not ok: %', what;
    end if;
    raise notice 'ok: %', what;
end;
$$;

create or replace function tests.eq(got anyelement, want anyelement, what text) returns void
language plpgsql as $$
begin
    if got is distinct from want then
        raise exception 'not ok: % (got %, want %)', what, got, want;
    end if;
    raise notice 'ok: %', what;
end;
$$;

create or replace function tests.fails(statement text, pattern text, what text) returns void
language plpgsql as $$
declare
    message text;
begin
    begin
        execute statement;
    exception when others then
        get stacked diagnostics message = message_text;
        if message !~ pattern then
            raise exception 'not ok: % (failed with "%", want /%/)', what, message, pattern;
        end if;
        raise notice 'ok: %', what;
        return;
    end;
    raise exception 'not ok: % (it succeeded)', what;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
