begin;

select tests.act_admin();
update public.plans set max_projects = 3, max_bytes = 1000, max_kept_snapshots = 2, max_saves_per_minute = 5 where id = 'free_beta';
create temp table ids as select tests.new_user('max@example.com') as max, tests.new_user('heir@example.com') as heir,
                               tests.new_user('solo@example.com') as solo;
create temp table pr (id uuid);
create temp table ws (id uuid, solo uuid);
grant select, insert, update on ids, pr, ws to authenticated;

select tests.act_as((select max from ids));
insert into pr select (public.create_project((public.me() ->> 'personal_workspace')::uuid, 'blackline', 'One', 'a') ->> 'id')::uuid;
select public.create_project((public.me() ->> 'personal_workspace')::uuid, 'blackline', 'Two', 'b');
select public.create_project((public.me() ->> 'personal_workspace')::uuid, 'blackline', 'Three', 'c');
select tests.fails($$select public.create_project((public.me() ->> 'personal_workspace')::uuid, 'blackline', 'Four', 'd')$$, 'nc:limit:projects', 'the plan caps how many scripts you keep');
select tests.fails($$select public.save_project((select id from pr), 1, repeat('x', 2000))$$, 'nc:limit:storage', 'and how much space they take');
select tests.fails($$select public.create_project((public.me() ->> 'personal_workspace')::uuid, 'blackline', 'Big', repeat('x', 2000001))$$,
    'nc:limit|projects_body_check|value too long|check constraint', 'a single script is at most 2 MB');

select public.take_snapshot((select id from pr), 'One');
select public.take_snapshot((select id from pr), 'Two');
select tests.fails($$select public.take_snapshot((select id from pr), 'Three')$$, 'nc:limit:snapshots', 'named snapshots are capped');
select public.take_snapshot((select id from pr), 'Conflict 1', 'conflict', 'x');
select public.take_snapshot((select id from pr), 'Conflict 2', 'conflict', 'y');
select public.take_snapshot((select id from pr), 'Conflict 3', 'conflict', 'z');
select tests.eq((select count(*)::int from public.project_versions where kind = 'conflict'), 2, 'safety copies keep the newest few instead of failing');

select public.save_project((select id from pr), 1, 'a1');
select public.save_project((select id from pr), 2, 'a2');
select public.save_project((select id from pr), 3, 'a3');
select public.save_project((select id from pr), 4, 'a4');
select public.save_project((select id from pr), 5, 'a5');
select tests.fails($$select public.save_project((select id from pr), 6, 'a6')$$, 'nc:rate', 'saving is rate limited per minute');

insert into ws (id) select public.create_workspace('Max Team');
select public.invite_member((select id from ws), 'heir@example.com', 'editor');
select tests.act_as((select heir from ids));
select public.accept_invite((select x ->> 'id' from public.my_invites() x)::uuid);
select tests.act_as((select max from ids));
update ws set solo = public.create_workspace('Lonely');

select tests.act_admin();
select tests.eq(public.prepare_account_deletion((select max from ids)), '{"deleted": 1, "transferred": 1}'::jsonb, 'deleting an account hands teams on and drops empty ones');
select tests.eq((select owner_id from public.workspaces where id = (select id from ws)), (select heir from ids), 'the team goes to the next member');
select tests.eq((select count(*)::int from public.workspaces where id = (select solo from ws)), 0, 'a team of one goes with its owner');
delete from auth.users where id = (select max from ids);
select tests.eq((select count(*)::int from public.projects where created_by is null and workspace_id not in (select id from public.workspaces)), 0, 'nothing is left behind');
select tests.eq((select count(*)::int from public.profiles where id = (select max from ids)), 0, 'the profile is gone');

update public.projects set deleted_at = now() - interval '31 days';
insert into public.leases (project_id, user_id, device_id, expires_at)
    select id, (select heir from ids), gen_random_uuid(), now() - interval '2 days' from public.projects limit 1;
select tests.ok((public.purge_expired() ->> 'projects')::int >= 0, 'the nightly purge runs');
select tests.eq((select count(*)::int from public.projects where deleted_at is not null), 0, 'and empties trash older than 30 days');

select tests.act_as((select solo from ids));
select tests.fails($$select public.purge_expired()$$, 'permission denied', 'only the server runs the purge');
select tests.fails($$select public.prepare_account_deletion(auth.uid())$$, 'permission denied', 'or prepares deletions');

select tests.act_admin();
rollback;
