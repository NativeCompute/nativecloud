begin;

select tests.act_admin();
create temp table ids as select
    tests.new_user('owner@example.com') as owner,
    tests.new_user('admin@example.com') as admin,
    tests.new_user('editor@example.com') as editor,
    tests.new_user('viewer@example.com') as viewer,
    tests.new_user('stranger@example.com') as stranger,
    tests.new_user('late@example.com', false) as late;
create temp table ws (id uuid);
create temp table inv (who text, id uuid);
grant select, insert on ids, ws, inv to authenticated;

select tests.act_as((select owner from ids));
insert into ws select public.create_workspace('Heist Room');
select tests.eq((select name from public.workspaces where kind = 'team'), 'Heist Room', 'you can start a team');
select tests.eq(public.role_in((select id from ws)), 'owner', 'and you own it');
select tests.fails($$select public.create_workspace('  ')$$, 'nc:invalid:name', 'a team needs a name');
select tests.fails($$select public.rename_workspace((select id from public.workspaces where kind = 'personal'), 'Shared')$$,
    'nc:invalid:personal', 'your personal space stays personal');

insert into inv select 'admin', public.invite_member((select id from ws), 'Admin@Example.com', 'admin');
insert into inv select 'editor', public.invite_member((select id from ws), 'editor@example.com', 'editor');
insert into inv select 'viewer', public.invite_member((select id from ws), 'viewer@example.com', 'viewer');
insert into inv select 'late', public.invite_member((select id from ws), 'late@example.com', 'editor');
select tests.fails($$select public.invite_member((select id from ws), 'not-an-email', 'editor')$$, 'nc:invalid:email', 'invites need a real address');
select tests.fails($$select public.invite_member((select id from ws), 'x@example.com', 'owner')$$, 'nc:invalid:role', 'nobody is invited as owner');
select tests.eq((select count(*)::int from public.invites where accepted_at is null), 4, 'owners see their pending invites');

select tests.act_as((select stranger from ids));
select tests.eq((select count(*)::int from public.workspaces), 1, 'strangers only see their own space');
select tests.eq((select count(*)::int from public.invites), 0, 'and no one else''s invites');
select tests.fails($$select public.accept_invite((select id from inv where who = 'editor'))$$, 'nc:not_found', 'an invite only works for its address');
select tests.fails($$select public.invite_member((select id from ws), 'x@example.com', 'viewer')$$, 'nc:forbidden', 'strangers can''t invite');

select tests.act_as((select admin from ids));
select tests.eq(jsonb_array_length(coalesce((select jsonb_agg(x) from public.my_invites() x), '[]')), 1, 'the invitee sees their invite');
select tests.eq((select x ->> 'workspace' from public.my_invites() x), 'Heist Room', 'with the team name');
select public.accept_invite((select id from inv where who = 'admin'));
select tests.eq(public.role_in((select id from ws)), 'admin', 'accepting joins the team with the invited role');

select tests.act_as((select editor from ids));
select public.accept_invite((select id from inv where who = 'editor'));
select tests.act_as((select viewer from ids));
select public.accept_invite((select id from inv where who = 'viewer'));
select tests.act_as((select late from ids));
select tests.fails($$select public.accept_invite((select id from inv where who = 'late'))$$, 'nc:unconfirmed', 'an unconfirmed email can''t join yet');

select tests.act_as((select admin from ids));
select tests.fails($$select public.invite_member((select id from ws), 'x@example.com', 'admin')$$, 'nc:forbidden', 'only the owner makes admins');
select public.set_role((select id from ws), (select viewer from ids), 'editor');
select public.set_role((select id from ws), (select viewer from ids), 'viewer');
select tests.fails($$select public.set_role((select id from ws), (select owner from ids), 'viewer')$$, 'nc:invalid:role', 'the owner''s role can''t be changed');
select tests.fails($$select public.remove_member((select id from ws), (select owner from ids))$$, 'nc:forbidden', 'or the owner removed');

select tests.act_as((select editor from ids));
select tests.fails($$select public.set_role((select id from ws), (select viewer from ids), 'editor')$$, 'nc:forbidden', 'editors don''t manage people');
select tests.eq((select count(*)::int from public.memberships where workspace_id = (select id from ws)), 4, 'members see the whole team');
select tests.eq((select count(*)::int from public.profiles), 4, 'and each other''s names');
select tests.eq((select count(*)::int from public.invites where email <> 'editor@example.com'), 0, 'but not other people''s invites');

select tests.act_as((select owner from ids));
select tests.fails($$select public.leave_workspace((select id from ws))$$, 'nc:invalid:owner', 'an owner hands over before leaving');
select public.transfer_ownership((select id from ws), (select admin from ids));
select tests.eq(public.role_in((select id from ws)), 'admin', 'handing over makes you an admin');
select public.leave_workspace((select id from ws));
select tests.eq(public.role_in((select id from ws)), null, 'and then you can leave');

select tests.act_as((select admin from ids));
select tests.eq((select owner_id from public.workspaces where id = (select id from ws)), (select admin from ids), 'the new owner owns the team');
select public.remove_member((select id from ws), (select viewer from ids));
select tests.eq((select count(*)::int from public.memberships where workspace_id = (select id from ws)), 2, 'owners remove people');
select tests.ok(exists (select 1 from public.audit where action = 'member.remove'), 'and it is written in the audit log');

select public.create_workspace('Two');
select public.create_workspace('Three');
select tests.fails($$select public.create_workspace('Five')$$, 'nc:limit:teams', 'the free beta owns three teams at most');

select tests.act_admin();
rollback;
