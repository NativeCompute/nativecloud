begin;

select tests.act_admin();
create temp table ids as select
    tests.new_user('ann@example.com') as ann,
    tests.new_user('ben@example.com') as ben,
    tests.new_user('vic@example.com') as vic,
    tests.new_user('out@example.com') as outsider;
create temp table ws (id uuid);
create temp table pr (id uuid);
create temp table seen (n bigint);
grant select, insert, update, delete on ids, ws, pr, seen to authenticated;

select tests.act_as((select ann from ids));
insert into ws select (public.create_org('Writers Room') ->> 'space')::uuid;
select public.invite_member(public.space_org((select id from ws)), 'ben@example.com', 'member');
select public.invite_member(public.space_org((select id from ws)), 'vic@example.com', 'guest', array[(select id from ws)], 'viewer');
select tests.act_as((select ben from ids));
select public.accept_invite((select x ->> 'id' from public.my_invites() x)::uuid);
select tests.act_as((select vic from ids));
select public.accept_invite((select x ->> 'id' from public.my_invites() x)::uuid);

select tests.act_as((select ann from ids));
insert into seen select (public.changes_since(0) ->> 'latest')::bigint;
insert into pr select (public.create_project((select id from ws), 'blackline', 'Crossfire', E'---\ntitle: Crossfire\n---\n\nShe waits.', '{"pages": 1}') ->> 'id')::uuid;
select tests.eq((select version from public.projects), 1::bigint, 'a new script starts at version 1');
select tests.fails($$select public.create_project((select id from ws), 'nope', 'X')$$, 'nc:invalid:app', 'projects belong to a known app');
select tests.ok(jsonb_array_length(public.changes_since((select n from seen)) -> 'changes') >= 1, 'creating shows up in the change feed');

select tests.eq(public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000a', 'Ann laptop') ->> 'access', 'edit', 'the first to open a script edits it');
select tests.eq(public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000a', 'Ann laptop') ->> 'access', 'edit', 'reopening on the same computer keeps the lock');

select tests.act_as((select ben from ids));
select tests.eq(public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000b', 'Ben desk') ->> 'access', 'read', 'everyone else reads while it is held');
select tests.eq(public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000b', 'Ben desk') -> 'lease' -> 'user' ->> 'name', 'Ann', 'and sees who is writing');
select tests.eq(public.save_project((select id from pr), 1, 'Ben was here', null, null, '00000000-0000-0000-0000-00000000000b') ->> 'status', 'locked', 'saving into someone else''s lock is refused');
select tests.eq(public.request_edit((select id from pr), '00000000-0000-0000-0000-00000000000b', 'Ben desk') ->> 'access', 'read', 'Edit now waits while the lock is live');

select tests.act_as((select ann from ids));
select tests.eq(public.save_project((select id from pr), 1, E'---\ntitle: Crossfire\n---\n\nShe waits. He runs.', null, null, '00000000-0000-0000-0000-00000000000a') ->> 'status', 'saved', 'the lock holder saves');
select tests.eq((select version from public.projects), 2::bigint, 'and the version moves on');
select tests.eq(public.save_project((select id from pr), 1, 'stale', null, null, '00000000-0000-0000-0000-00000000000a') ->> 'status', 'conflict', 'a save from an old version is a conflict');
select tests.eq((public.save_project((select id from pr), 1, 'stale', null, null, '00000000-0000-0000-0000-00000000000a') -> 'project' ->> 'version')::bigint, 2::bigint, 'and the conflict carries the newer version');
select tests.eq((select saves from public.edit_sessions where user_id = (select ann from ids) order by id desc limit 1), 2, 'saves within ten minutes are one editing stretch');
select tests.eq((select words_delta from public.edit_sessions where user_id = (select ann from ids) order by id desc limit 1),
    public.word_count(E'---\ntitle: Crossfire\n---\n\nShe waits. He runs.'), 'and count the words written');
select tests.eq((public.renew_lease((select id from pr), '00000000-0000-0000-0000-00000000000a') ->> 'held')::boolean, true, 'the holder keeps the lock alive');
select tests.eq(public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000c', 'Ann desktop') ->> 'access', 'read', 'your other computer reads while this one holds it');
select tests.eq(public.request_edit((select id from pr), '00000000-0000-0000-0000-00000000000c', 'Ann desktop') ->> 'access', 'edit', 'but can take it over: edit here instead');
select tests.eq((public.renew_lease((select id from pr), '00000000-0000-0000-0000-00000000000a') ->> 'held')::boolean, false, 'and the first computer learns it lost the lock');
select public.release_lease((select id from pr), '00000000-0000-0000-0000-00000000000c');

select tests.act_as((select ben from ids));
select tests.eq(public.request_edit((select id from pr), '00000000-0000-0000-0000-00000000000b', 'Ben desk') ->> 'access', 'edit', 'once released, Edit now takes the lock');
select tests.act_admin();
update public.leases set expires_at = now() - interval '1 second';
select tests.act_as((select ann from ids));
select tests.eq(public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000a', 'Ann laptop') ->> 'access', 'edit', 'an expired lock is free again');

select tests.act_as((select vic from ids));
select tests.eq(public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000d', 'Vic') ->> 'access', 'read', 'viewers only read');
select tests.fails($$select public.save_project((select id from pr), 2, 'vic', null, null, null)$$, 'nc:forbidden', 'and cannot save');
select tests.fails($$select public.create_project((select id from ws), 'blackline', 'Vic''s')$$, 'nc:forbidden', 'or create scripts');
select tests.fails($$update public.projects set title = 'Hacked'$$, 'permission denied', 'nobody writes to tables directly');
select tests.fails($$insert into public.memberships values ((select id from ws), (select vic from ids), 'owner')$$, 'permission denied', 'or promotes themselves');
select public.set_star((select id from pr), true);
select tests.eq((select count(*)::int from public.stars), 1, 'stars are personal');

select tests.act_as((select outsider from ids));
select tests.eq((select count(*)::int from public.projects), 0, 'outsiders see no scripts');
select tests.eq((select count(*)::int from public.project_versions), 0, 'or their history');
select tests.eq((select count(*)::int from public.leases), 0, 'or who is editing');
select tests.fails($$select public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000e', 'Out')$$, 'nc:not_found', 'and cannot open one by id');
select tests.eq(jsonb_array_length(public.changes_since(0) -> 'changes'), 0, 'and see nothing in the change feed');

select tests.act_as((select ann from ids));
select tests.ok(public.take_snapshot((select id from pr), 'Table read') is not null, 'writers take labelled snapshots');
select tests.ok(public.take_snapshot((select id from pr), 'Your offline version', 'offline', 'offline text') is not null, 'and keep an offline version');
select tests.eq((select body from public.project_versions where kind = 'offline'), 'offline text', 'with its own text');
select tests.eq((select count(*)::int from public.project_versions where kind = 'auto'), 1, 'automatic snapshots come at most every ten minutes');
select tests.eq(public.restore_snapshot((select id from public.project_versions where kind = 'offline'), 2, '00000000-0000-0000-0000-00000000000a') ->> 'status', 'saved', 'a snapshot can be restored');
select tests.eq((select body from public.projects), 'offline text', 'restoring brings its text back');
select tests.ok(exists (select 1 from public.project_versions where kind = 'restore'), 'and keeps what it replaced');

select public.delete_project((select id from pr));
select tests.ok((select deleted_at from public.projects) is not null, 'deleting moves a script to the trash');
select tests.eq((select count(*)::int from public.leases), 0, 'and frees its lock');
select tests.fails($$select public.open_project((select id from pr), '00000000-0000-0000-0000-00000000000a', 'x')$$, 'nc:not_found', 'a deleted script doesn''t open');
select public.restore_project((select id from pr));
select tests.ok((select deleted_at from public.projects) is null, 'it can be restored');

select public.move_project((select id from pr), (select id from public.workspaces where kind = 'personal' and owner_id = (select ann from ids)));
select tests.eq((select workspace_id from public.projects), (select id from public.workspaces where kind = 'personal' and owner_id = (select ann from ids)), 'scripts move between spaces');
select tests.act_as((select ben from ids));
select tests.eq((select count(*)::int from public.projects), 0, 'and leave the team''s view when they do');

select tests.act_as((select ann from ids));
select tests.eq((public.duplicate_project((select id from pr)) ->> 'title'), 'Crossfire (copy)', 'duplicates are titled as copies');
select public.delete_project((select id from pr));
select public.purge_project((select id from pr));
select tests.eq((select count(*)::int from public.projects where id = (select id from pr)), 0, 'the trash can be emptied for good');

select tests.act_admin();
rollback;
