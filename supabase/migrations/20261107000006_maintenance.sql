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
    return jsonb_build_object('projects', projects, 'leases', leases, 'changes', changes);
end;
$$;

create or replace function public.prepare_account_deletion(uid uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    ws record;
    heir uuid;
    moved int := 0;
    dropped int := 0;
begin
    for ws in select id from public.workspaces where owner_id = uid and kind = 'team' loop
        select user_id into heir from public.memberships
         where workspace_id = ws.id and user_id <> uid
         order by case role when 'admin' then 0 when 'editor' then 1 else 2 end, joined_at
         limit 1;
        if heir is null then
            delete from public.workspaces where id = ws.id;
            dropped := dropped + 1;
        else
            update public.memberships set role = 'admin' where workspace_id = ws.id and user_id = uid;
            update public.memberships set role = 'owner' where workspace_id = ws.id and user_id = heir;
            update public.workspaces set owner_id = heir where id = ws.id;
            insert into public.audit (workspace_id, actor, action, detail)
            values (ws.id, uid, 'workspace.transfer', jsonb_build_object('to', heir, 'reason', 'account deleted'));
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
    public.note_change(uuid, uuid, text), public.note_audit(uuid, text, jsonb), public.take_lease(uuid, uuid, text),
    public.note_session(uuid, int), public.keep_auto(uuid, text, bigint), public.check_room(uuid, int, bigint),
    public.load_project(uuid, boolean), public.account_usage(uuid), public.plan_of(uuid), public.owner_of(uuid)
    from authenticated;
grant execute on function public.purge_expired(), public.prepare_account_deletion(uuid) to service_role;

do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        create extension if not exists pg_cron;
        perform cron.schedule('nativecloud-purge', '17 3 * * *', 'select public.purge_expired()');
    end if;
end;
$$;
