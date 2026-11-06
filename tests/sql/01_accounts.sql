begin;

select tests.act_admin();
create temp table ids as select tests.new_user('Ada@Example.com', true, 'Ada Lovelace') as ada, tests.new_user('bob@example.com') as bob;
grant select on ids to authenticated, anon;

select tests.eq((select display_name from public.profiles where id = (select ada from ids)), 'Ada Lovelace', 'sign-up makes a profile with the chosen name');
select tests.eq((select display_name from public.profiles where id = (select bob from ids)), 'Bob', 'a name falls back to the email');
select tests.eq((select count(*)::int from public.workspaces where owner_id = (select ada from ids) and kind = 'personal'), 1, 'every account gets one personal space');
select tests.eq((select role from public.memberships m join public.workspaces w on w.id = m.workspace_id
                 where w.owner_id = (select ada from ids)), 'owner', 'and owns it');
select tests.eq((select plan_id from public.profiles where id = (select ada from ids)), 'free_beta', 'new accounts start on the free beta');

select tests.act_as((select ada from ids));
select tests.eq((public.me() ->> 'email'), 'ada@example.com', 'me() knows who you are');
select tests.eq((public.me() -> 'usage' ->> 'projects')::int, 0, 'and that nothing is used yet');
select tests.eq((public.me() -> 'plan' ->> 'max_projects')::int, 50, 'and the plan limits');
select public.update_profile('Ada L.', 200);
select tests.eq((select display_name from public.profiles where id = (select ada from ids)), 'Ada L.', 'you can rename yourself');
select tests.fails($$select public.update_profile('   ')$$, 'nc:invalid:name', 'but not to nothing');

select public.register_device('11111111-1111-1111-1111-111111111111', 'Ada''s MacBook', 'macos');
select tests.eq((select name from public.devices where id = '11111111-1111-1111-1111-111111111111'), 'Ada''s MacBook', 'a device is remembered');
select public.put_app_settings('blackline', 'light_mode = yes');
select tests.eq((select body from public.app_settings where app_id = 'blackline'), 'light_mode = yes', 'app settings are stored per user');

select tests.act_as((select bob from ids));
select tests.fails($$select public.register_device('11111111-1111-1111-1111-111111111111', 'Stolen', '')$$, 'nc:forbidden', 'nobody can take over another person''s device');
select tests.eq((select count(*)::int from public.devices), 0, 'and nobody sees another person''s devices');
select tests.eq((select count(*)::int from public.app_settings), 0, 'or their settings');
select tests.eq((select count(*)::int from public.profiles), 1, 'strangers'' profiles are hidden');

select tests.act_anon();
select tests.fails($$select public.me()$$, 'permission denied|nc:auth', 'signed-out callers get nothing');
select tests.eq((select count(*)::int from public.apps), 2, 'but may list the apps');

select tests.act_admin();
rollback;
