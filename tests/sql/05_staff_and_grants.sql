begin;

select tests.act_admin();
create temp table ids as select
    tests.new_user('boss@nativecompute.net') as boss,
    tests.new_user('help@nativecompute.net') as help,
    tests.new_user('ann@example.com') as ann,
    tests.new_user('eve@example.com') as eve;
insert into public.staff values ((select boss from ids), 'admin'), ((select help from ids), 'support');
create temp table org (id uuid);
create temp table g (code text, challenge text);
grant select, insert, update on ids, org, g to authenticated, service_role;

select tests.act_as((select ann from ids));
insert into org select (public.create_org('Ann Films') ->> 'id')::uuid;
select tests.fails($$select public.staff_stats()$$, 'nc:not_found', 'the staff console is hidden from everyone else');
select tests.fails($$select public.staff_set_plan((select id from org), 'studio')$$, 'nc:not_found', 'so nobody upgrades themselves');
select tests.eq((select count(*)::int from public.staff), 0, 'and nobody sees who is staff');

select tests.act_as((select help from ids));
select tests.eq(public.me() ->> 'staff', 'support', 'staff know they are staff');
select tests.ok((public.staff_stats() ->> 'users')::int >= 4, 'staff see platform numbers');
select tests.eq(jsonb_array_length(public.staff_search('ann films') -> 'orgs'), 1, 'staff find organizations');
select tests.eq(jsonb_array_length(public.staff_search('ann@') -> 'users'), 1, 'and people');
select tests.eq((public.staff_org((select id from org)) -> 'members' -> 0 ->> 'email'), 'ann@example.com', 'and see who is in them');
select public.staff_set_plan((select id from org), 'studio', 0);
select tests.eq((select plan_id from public.organizations where id = (select id from org)), 'studio', 'support staff change plans');
select tests.eq((select trial_ends_at from public.organizations where id = (select id from org)), null, 'and end trials');
select tests.fails($$select public.staff_set_plan((select id from org), 'free')$$, 'nc:invalid:plan', 'organizations only get organization plans');
select tests.fails($$select public.staff_suspend_org((select id from org), true, 'spam')$$, 'nc:not_found', 'only staff admins suspend');
select tests.ok(exists (select 1 from public.audit where action = 'staff.plan'), 'every staff action is written down');

select tests.act_as((select boss from ids));
select public.staff_suspend_org((select id from org), true, 'Spam');
select tests.act_as((select ann from ids));
select tests.fails($$select public.create_project((select (public.me() -> 'orgs' -> 0 ->> 'id')::uuid), 'blackline', 'X')$$,
    'nc:forbidden|nc:not_found', 'a suspended organization can''t write');
select tests.fails($$select public.invite_member((select id from org), 'x@example.com', 'member')$$, 'nc:suspended', 'or invite');
select tests.act_as((select boss from ids));
select public.staff_suspend_org((select id from org), false);
select public.staff_suspend_user((select eve from ids), true, 'Abuse');
select tests.fails($$select public.staff_suspend_user((select boss from ids), true)$$, 'nc:invalid:member', 'staff can''t suspend themselves');
select tests.act_as((select eve from ids));
select tests.fails($$select public.me()$$, 'nc:suspended', 'a suspended account is stopped everywhere');

select tests.act_as((select ann from ids));
select tests.fails($$select public.create_app_grant('blackline', 'Ann''s Mac', 'short')$$, 'nc:invalid:challenge', 'a sign-in grant needs a proper challenge');
select tests.fails($$select public.create_app_grant('nope', 'Ann''s Mac', repeat('a', 43))$$, 'nc:invalid:app', 'and a known app');
insert into g select public.create_app_grant('blackline', 'Ann''s Mac', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
select tests.ok((select code from g) ~ '^[A-HJ-NP-Z2-9]{8}$', 'the code is eight easy characters');
select tests.fails($$select count(*) from public.app_grants$$, 'permission denied', 'grants aren''t readable by anyone');
select tests.fails($$select public.redeem_app_grant((select code from g), (select challenge from g))$$, 'permission denied', 'and only the server redeems them');

select tests.act_admin();
set role service_role;
select tests.eq((public.redeem_app_grant((select code from g), 'wrong') ->> 'error'), 'nc:forbidden', 'a wrong verifier is refused');
select tests.eq((public.redeem_app_grant(lower((select code from g)), (select challenge from g)) ->> 'email'), 'ann@example.com', 'the right one gets the account, typed in any case');
select tests.fails($$select public.redeem_app_grant((select code from g), (select challenge from g))$$, 'nc:not_found', 'a code works once');
reset role;
update g set code = public.make_grant((select ann from ids), 'blackline', 'x', 'c', interval '-1 second');
set role service_role;
select tests.fails($$select public.redeem_app_grant((select code from g), 'c')$$, 'nc:not_found', 'an expired code is refused');
reset role;
update g set code = public.make_grant((select ann from ids), 'blackline', 'x', 'c', interval '2 minutes');
set role service_role;
select tests.eq((public.redeem_app_grant((select code from g), 'a') ->> 'error'), 'nc:forbidden', 'a wrong guess is counted');
select tests.eq((public.redeem_app_grant((select code from g), 'b') ->> 'error'), 'nc:forbidden', 'a wrong guess is counted');
select tests.eq((public.redeem_app_grant((select code from g), 'd') ->> 'error'), 'nc:forbidden', 'a wrong guess is counted');
select tests.eq((public.redeem_app_grant((select code from g), 'e') ->> 'error'), 'nc:forbidden', 'a wrong guess is counted');
select tests.eq((public.redeem_app_grant((select code from g), 'f') ->> 'error'), 'nc:forbidden', 'a wrong guess is counted');
select tests.fails($$select public.redeem_app_grant((select code from g), 'c')$$, 'nc:not_found', 'five wrong tries burn the code');
reset role;
update g set code = public.make_grant((select ann from ids), 'web', '', null, interval '5 minutes');
set role service_role;
select tests.eq((public.redeem_app_grant((select code from g), null) ->> 'app'), 'web', 'a web handoff code needs no verifier');

select tests.act_admin();
rollback;
