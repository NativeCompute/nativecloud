create or replace function public.purge_expired() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    projects int;
    leases int;
    changes int;
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
    return jsonb_build_object('projects', projects, 'leases', leases, 'changes', changes);
end;
$$;

create or replace function public.prepare_account_deletion(uid uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    o record;
    heir uuid;
    moved int := 0;
    dropped int := 0;
begin
    for o in select org_id as id from public.org_members where user_id = uid and role = 'owner' loop
        select user_id into heir from public.org_members
         where org_id = o.id and user_id <> uid and role <> 'guest'
         order by case role when 'admin' then 0 else 1 end, joined_at
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
    public.redeem_app_grant(text, text), public.make_grant(uuid, text, text, text, interval)
    from authenticated;
grant execute on function public.purge_expired(), public.prepare_account_deletion(uuid),
    public.redeem_app_grant(text, text), public.make_grant(uuid, text, text, text, interval) to service_role;

do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        create extension if not exists pg_cron;
        perform cron.schedule('nativecloud-purge', '17 3 * * *', 'select public.purge_expired()');
    end if;
end;
$$;
