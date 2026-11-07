begin;

select tests.act_admin();
create temp table ids as select
    tests.new_user('owner@example.com') as owner,
    tests.new_user('admin@example.com') as admin,
    tests.new_user('member@example.com') as member,
    tests.new_user('guest@example.com') as guest,
    tests.new_user('stranger@example.com') as stranger,
    tests.new_user('late@example.com', false) as late;
create temp table org (id uuid, slug text, general uuid, pitches uuid);
create temp table inv (who text, id uuid);
grant select, insert, update on ids, org, inv to authenticated;

select tests.act_as((select owner from ids));
insert into org (id, slug, general) select (x ->> 'id')::uuid, x ->> 'slug', (x ->> 'space')::uuid from public.create_org('Heist Room!') x;
select tests.eq((select slug from org), 'heist-room', 'an organization gets a slug from its name');
select tests.eq(public.org_role((select id from org)), 'owner', 'and you own it');
select tests.eq((select plan_id from public.organizations), 'team', 'it starts on Team');
select tests.ok((select trial_ends_at > now() + interval '29 days' from public.organizations), 'with a trial');
select tests.eq((select name from public.workspaces where kind = 'space'), 'General', 'and one space, General');
select tests.eq(public.role_in((select general from org)), 'editor', 'which you can write in');
select tests.eq((public.create_org('Heist Room') ->> 'slug'), 'heist-room-2', 'slugs stay unique');
select tests.fails($$select public.create_org('  ')$$, 'nc:invalid:name', 'an organization needs a name');
select tests.fails($$select public.create_org('X', 'Bad Slug')$$, 'nc:invalid:slug', 'slugs are lower case letters, digits and dashes');
select tests.fails($$select public.rename_space((select id from public.workspaces where kind = 'personal'), 'Shared')$$,
    'nc:invalid:personal', 'your personal space stays personal');
select tests.eq((public.org_by_slug('heist-room') ->> 'name'), 'Heist Room!', 'an organization is found by its slug');
update org set pitches = public.create_space((select id from org), 'Pitches');

insert into inv select 'admin', public.invite_member((select id from org), 'Admin@Example.com', 'admin');
insert into inv select 'member', public.invite_member((select id from org), 'member@example.com', 'member');
insert into inv select 'guest', public.invite_member((select id from org), 'guest@example.com', 'guest', array[(select pitches from org)], 'viewer');
insert into inv select 'late', public.invite_member((select id from org), 'late@example.com', 'member');
select tests.fails($$select public.invite_member((select id from org), 'not-an-email', 'member')$$, 'nc:invalid:email', 'invites need a real address');
select tests.fails($$select public.invite_member((select id from org), 'x@example.com', 'owner')$$, 'nc:invalid:role', 'nobody is invited as owner');
select tests.fails($$select public.invite_member((select id from org), 'x@example.com', 'guest')$$, 'nc:invalid:spaces', 'a guest is invited to named spaces');
select tests.fails($$select public.invite_member((select id from org), 'x@example.com', 'guest', array[(select id from public.workspaces where kind = 'personal')])$$,
    'nc:invalid:spaces', 'and only to this organization''s spaces');
select tests.eq((public.org_by_slug('heist-room') -> 'usage' ->> 'pending')::int, 4, 'owners see their pending invites');

select tests.act_as((select stranger from ids));
select tests.eq((select count(*)::int from public.organizations), 0, 'strangers see no organizations');
select tests.eq((select count(*)::int from public.workspaces), 1, 'only their own space');
select tests.eq((select count(*)::int from public.invites), 0, 'and no one else''s invites');
select tests.fails($$select public.org_people((select id from org))$$, 'nc:not_found', 'and no one else''s people');
select tests.fails($$select public.org_by_slug('heist-room')$$, 'nc:not_found', 'an organization is hidden from outsiders');
select tests.fails($$select public.accept_invite((select id from inv where who = 'member'))$$, 'nc:not_found', 'an invite only works for its address');
select tests.fails($$select public.invite_member((select id from org), 'x@example.com', 'member')$$, 'nc:not_found', 'strangers can''t invite');

select tests.act_as((select admin from ids));
select tests.eq((select x ->> 'org' from public.my_invites() x), 'Heist Room!', 'the invitee sees the organization''s name');
select tests.eq((public.invite_details((select id from inv where who = 'admin')) ->> 'state'), 'pending', 'and the invite''s state');
select public.accept_invite((select id from inv where who = 'admin'));
select tests.eq(public.org_role((select id from org)), 'admin', 'accepting joins with the invited role');
select tests.eq(public.role_in((select pitches from org)), 'editor', 'and into every space');

select tests.act_as((select member from ids));
select public.accept_invite((select id from inv where who = 'member'));
select tests.eq((select count(*)::int from public.workspaces where kind = 'space'), 2, 'members see every space');
select tests.ok((select id from public.create_space((select id from org), 'Season 2') x(id)) is not null, 'members may create spaces by default');

select tests.act_as((select guest from ids));
select public.accept_invite((select id from inv where who = 'guest'));
select tests.eq(public.org_role((select id from org)), 'guest', 'guests join as guests');
select tests.eq((select count(*)::int from public.workspaces where kind = 'space'), 1, 'and see only the spaces they were invited to');
select tests.eq(public.role_in((select pitches from org)), 'viewer', 'with the role they were given there');
select tests.eq((select count(*)::int from public.org_members), 1, 'guests don''t see the member list');
select tests.eq((select count(*)::int from public.org_people((select id from org))), 3, 'guests see themselves and who runs the organization');
select tests.ok((select bool_and(x ->> 'email' is null) from public.org_people((select id from org)) x), 'without their emails');
select tests.fails($$select public.create_space((select id from org), 'Mine')$$, 'nc:forbidden', 'and can''t create spaces');

select tests.act_as((select late from ids));
select tests.fails($$select public.accept_invite((select id from inv where who = 'late'))$$, 'nc:unconfirmed', 'an unconfirmed email can''t join yet');

select tests.act_as((select admin from ids));
select tests.fails($$select public.invite_member((select id from org), 'x@example.com', 'admin')$$, 'nc:forbidden', 'only the owner makes admins');
select public.set_org_role((select id from org), (select member from ids), 'guest');
select public.set_org_role((select id from org), (select member from ids), 'member');
select tests.fails($$select public.set_org_role((select id from org), (select owner from ids), 'member')$$, 'nc:invalid:role', 'the owner''s role can''t be changed');
select tests.fails($$select public.remove_member((select id from org), (select owner from ids))$$, 'nc:forbidden', 'or the owner removed');
select public.set_space_member((select pitches from org), (select guest from ids), 'editor');
select tests.eq((select role from public.memberships where workspace_id = (select pitches from org) and user_id = (select guest from ids)), 'editor', 'admins change who is in a space');
select tests.eq((select count(*)::int from public.org_people((select id from org)) x where x ->> 'email' is not null), 4, 'admins see everyone''s email');
select tests.eq((select jsonb_array_length(x -> 'spaces') from public.org_people((select id from org)) x where (x ->> 'user_id')::uuid = (select guest from ids)), 1, 'and which spaces each person is in');
select public.update_org_settings((select id from org), '{"members_create_spaces": false}');
select public.rename_org((select id from org), 'Heist Studio');
select public.set_org_slug((select id from org), 'heist-studio');
select tests.eq((public.org_by_slug('heist-room') ->> 'slug'), 'heist-studio', 'an old slug still finds the organization');

select tests.act_as((select member from ids));
select tests.fails($$select public.set_org_role((select id from org), (select guest from ids), 'member')$$, 'nc:forbidden', 'members don''t manage people');
select tests.fails($$select public.create_space((select id from org), 'Nope')$$, 'nc:forbidden', 'and can''t create spaces once that''s turned off');
select tests.eq((select count(*)::int from public.org_members), 4, 'members see everyone');
select tests.eq((select count(*)::int from public.org_people((select id from org))), 4, 'and everyone on the people page');
select tests.eq((select count(*)::int from public.org_people((select id from org)) x where x ->> 'email' is not null), 1, 'with only their own email');
select tests.eq((select x ->> 'role' from public.org_people((select id from org)) x limit 1), 'owner', 'the owner comes first');
select tests.eq((select count(*)::int from public.invites where email <> 'member@example.com'), 0, 'but not other people''s invites');

select tests.act_as((select owner from ids));
select tests.fails($$select public.leave_org((select id from org))$$, 'nc:invalid:owner', 'an owner hands over before leaving');
select tests.signed_in_ago(3600);
select tests.fails($$select public.transfer_org((select id from org), (select admin from ids))$$, 'nc:reauth', 'handing over needs a fresh sign-in');
select tests.signed_in_ago(5);
select public.transfer_org((select id from org), (select admin from ids));
select tests.eq(public.org_role((select id from org)), 'admin', 'handing over makes you an admin');
select public.leave_org((select id from org));
select tests.eq(public.org_role((select id from org)), null, 'and then you can leave');
select tests.eq(public.role_in((select general from org)), null, 'which takes you out of its spaces');

select tests.act_as((select admin from ids));
select tests.signed_in_ago(5);
select public.remove_member((select id from org), (select guest from ids));
select tests.eq((select count(*)::int from public.org_members where org_id = (select id from org)), 2, 'owners remove people');
select tests.ok(exists (select 1 from public.audit where action = 'member.remove' and org_id = (select id from org)), 'and it is written in the audit log');
select public.archive_space((select pitches from org), true);
select tests.fails($$select public.create_project((select pitches from org), 'blackline', 'X')$$, 'nc:forbidden', 'archived spaces are read only');
select public.delete_space((select pitches from org));
select tests.eq((select count(*)::int from public.workspaces where id = (select pitches from org)), 0, 'spaces can be deleted');
select public.delete_org((select id from org));
select tests.eq((select count(*)::int from public.organizations where id = (select id from org)), 0, 'and whole organizations');
select tests.eq((select count(*)::int from public.workspaces where org_id = (select id from org)), 0, 'with their spaces');

select tests.act_as((select stranger from ids));
select public.create_org('Two');
select public.create_org('Three');
select public.create_org('Four');
select tests.fails($$select public.create_org('Five')$$, 'nc:limit:orgs', 'a free account starts three organizations at most');

select tests.act_admin();
rollback;
