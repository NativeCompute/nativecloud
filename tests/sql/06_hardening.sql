begin;

select tests.act_admin();
create temp table ids as select
    tests.new_user('olga@example.com') as owner,
    tests.new_user('adam@example.com') as admin,
    tests.new_user('mia@example.com') as member,
    tests.new_user('gus@example.com') as guest,
    tests.new_user('eve@example.com') as stranger,
    tests.new_user('stan@example.com') as staff;
insert into public.staff values ((select staff from ids), 'admin');
create temp table org (id uuid, general uuid, secret uuid, p uuid, q uuid, snap uuid, inv uuid);
grant select, insert, update on ids, org to authenticated;

select tests.act_as((select owner from ids));
insert into org (id, general) select (x ->> 'id')::uuid, (x ->> 'space')::uuid from public.create_org('Hard Room') x;
update org set secret = public.create_space((select id from org), 'Secret');
update org set inv = public.invite_member((select id from org), 'adam@example.com', 'admin');
select tests.act_as((select admin from ids));
select public.accept_invite((select inv from org));
select tests.act_as((select owner from ids));
update org set inv = public.invite_member((select id from org), 'mia@example.com', 'member');
select tests.act_as((select member from ids));
select public.accept_invite((select inv from org));
select tests.act_as((select owner from ids));
update org set inv = public.invite_member((select id from org), 'gus@example.com', 'guest', array[(select general from org)], 'editor');
select tests.act_as((select guest from ids));
select public.accept_invite((select inv from org));
select tests.act_as((select owner from ids));
update org set p = (public.create_project((select secret from org), 'blackline', 'Vault', 'INT. VAULT - NIGHT') ->> 'id')::uuid;
update org set q = (public.create_project((select general from org), 'blackline', 'Harbour', 'EXT. HARBOUR') ->> 'id')::uuid;
update org set snap = public.take_snapshot((select q from org), 'Before notes');

-- demotion here---
select tests.act_as((select admin from ids));
select public.set_org_role((select id from org), (select member from ids), 'guest');
select tests.act_as((select member from ids));
select tests.eq((select count(*) from public.projects where id = (select p from org)), 0::bigint, 'someone demoted to guest no longer reads the spaces');
select tests.fails($$select public.save_project((select p from org), 1, 'x')$$, 'nc:not_found', 'and can no longer save in them');
select tests.act_as((select owner from ids));
select public.set_org_role((select id from org), (select member from ids), 'member');

-- storage here---
select tests.act_as((select stranger from ids));
create temp table mine (p uuid);
grant select, insert on mine to authenticated;
insert into mine select (public.create_project((select id from public.workspaces where kind = 'personal' and owner_id = (select stranger from ids)),
                                               'blackline', 'Tiny', 'x') ->> 'id')::uuid;
select public.take_snapshot((select p from mine), 'big', 'offline', repeat('a', 1900000)) from generate_series(1, 20);
select tests.ok((public.usage_summary() -> 'usage' ->> 'bytes')::bigint > 1900000, 'snapshot bytes count towards storage');
select tests.ok((public.usage_summary() -> 'usage' ->> 'bytes')::bigint <= 104857600, 'and they stop at the plan''s storage');
select tests.fails($$select public.take_snapshot((select p from mine), 'big', 'offline', repeat('a', 1900000)) from generate_series(1, 60)$$,
    'nc:(limit:storage|rate)', 'a full plan refuses more snapshots');
select tests.ok((select count(*) from public.project_versions where project_id = (select p from mine) and kind = 'offline') <= 10,
    'safety copies are capped per script');
select tests.fails($$select public.bump_rate('junk', 1000)$$, 'permission denied', 'rate counters are internal');

-- suspension here---
select tests.act_admin();
update public.profiles set suspended_at = now() where id = (select member from ids);
select tests.act_as((select member from ids));
select tests.eq((select count(*) from public.projects), 0::bigint, 'a suspended account reads no scripts');
select tests.eq((select count(*) from public.workspaces), 0::bigint, 'nor spaces');
select tests.act_admin();
update public.profiles set suspended_at = null where id = (select member from ids);
update public.organizations set suspended_at = now() where id = (select id from org);
select tests.act_as((select owner from ids));
select tests.fails($$select public.rename_space((select secret from org), 'Gone')$$, 'nc:suspended', 'a suspended organization''s spaces can''t be renamed');
select tests.fails($$select public.delete_space((select secret from org))$$, 'nc:suspended', 'or deleted');
select tests.fails($$select public.set_space_member((select secret from org), (select member from ids), null)$$, 'nc:suspended', 'or have people changed');
select tests.signed_in_ago(30);
select tests.fails($$select public.transfer_org((select id from org), (select admin from ids))$$, 'nc:suspended', 'or be handed over');
select tests.fails($$select public.delete_org((select id from org))$$, 'nc:suspended', 'or be deleted by its owner');
select tests.act_admin();
update public.organizations set suspended_at = null where id = (select id from org);

-- owner here---
select tests.act_as((select admin from ids));
select tests.fails($$select public.set_space_member((select secret from org), (select owner from ids), null)$$, 'nc:forbidden', 'an admin can''t take the owner out of a space');
select tests.act_as((select owner from ids));
select public.set_space_member((select secret from org), (select owner from ids), 'editor');

-- moving here---
select tests.act_as((select guest from ids));
select tests.fails($$select public.move_project((select q from org), (select id from public.workspaces where kind = 'personal' and owner_id = (select guest from ids)))$$,
    'nc:forbidden', 'an editor who didn''t create a script can''t take it out of the organization');
select tests.fails($$select public.delete_snapshot((select snap from org))$$, 'nc:forbidden', 'nor delete someone else''s snapshot');
select tests.act_as((select owner from ids));
select public.open_project((select q from org), '00000000-0000-4000-8000-000000000001', 'Olga''s Mac', true);
select tests.act_as((select member from ids));
select tests.fails($$select public.delete_project((select q from org))$$, 'nc:locked', 'a script someone is editing can''t be deleted');
select tests.fails($$select public.move_project((select q from org), (select secret from org))$$, 'nc:locked', 'or moved');
select tests.act_as((select owner from ids));
select public.release_lease((select q from org), '00000000-0000-4000-8000-000000000001');
select public.move_project((select q from org), (select id from public.workspaces where kind = 'personal' and owner_id = (select owner from ids)));
select tests.eq((select count(*) from public.audit where action = 'project.move_out' and org_id = (select id from org)), 1::bigint,
    'a move out of the organization is in its audit log');

-- invites here---
select tests.act_as((select admin from ids));
update org set inv = public.invite_member((select id from org), 'late@example.com', 'member');
select tests.act_as((select owner from ids));
select public.remove_member((select id from org), (select admin from ids));
select tests.eq((select revoked_at is not null from public.invites where id = (select inv from org)), true, 'invites from someone removed are withdrawn');
update org set inv = public.invite_member((select id from org), 'new@example.com', 'member');
select tests.act_admin();
select tests.ok(public.claim_invite_send((select inv from org), (select owner from ids)) ? 'email', 'an owner may send an invite email');
select tests.fails($$select public.claim_invite_send((select inv from org), (select owner from ids))$$, 'nc:rate', 'but not again straight away');
select tests.fails($$select public.claim_invite_send((select inv from org), (select member from ids))$$, 'nc:not_found', 'and members can''t send it at all');

-- helpers here---
select tests.act_as((select stranger from ids));
select tests.fails($$select public.person((select owner from ids))$$, 'permission denied', 'names can''t be looked up by id');
select tests.fails($$select public.live_lease((select p from org))$$, 'permission denied', 'nor who is editing');
select tests.fails($$select public.slug_free('hard-room')$$, 'permission denied', 'nor whether an address is taken');
select tests.eq(public.space_org((select secret from org)), null::uuid, 'a stranger can''t map a space to its organization');
select tests.eq(public.project_workspace((select p from org)), null::uuid, 'or a script to its space');
select tests.fails($$select suspended_reason from public.profiles$$, 'permission denied', 'staff notes on people aren''t readable');
select tests.fails($$select suspended_reason from public.organizations$$, 'permission denied', 'or on organizations');

-- sessions here---
select tests.act_as_app((select owner from ids));
select tests.fails($$select public.create_app_grant('blackline', 'x', repeat('a', 43))$$, 'nc:reauth', 'an app session can''t approve another app');
select tests.fails($$select public.transfer_org((select id from org), (select member from ids))$$, 'nc:reauth', 'and never counts as freshly signed in');
select tests.act_as_app((select staff from ids));
select tests.fails($$select public.staff_stats()$$, 'nc:reauth', 'staff tools need a password sign-in');
select tests.act_as((select owner from ids));
select tests.ok(public.create_app_grant('blackline', 'x', repeat('a', 43)) ~ '^[A-Z2-9]{8}$', 'a password session can approve an app');
select tests.act_as_app((select owner from ids));
select public.register_device('00000000-0000-4000-8000-0000000000aa', 'Olga''s Mac', 'macos');
select tests.fails($$select session_id from public.devices$$, 'permission denied', 'a computer''s session id stays private');
select tests.act_admin();
select tests.ok((select session_id is not null from public.devices where id = '00000000-0000-4000-8000-0000000000aa'), 'a computer remembers its session');
select tests.eq(length(public.make_grant((select owner from ids), 'web', '', null, interval '5 minutes', 12)), 12, 'hand-off codes are 12 characters');

-- staff here---
select tests.act_as((select staff from ids));
select public.staff_suspend_org((select id from org), true, 'checking');
select tests.act_as((select owner from ids));
select tests.eq((select count(*) from public.audit where action like 'staff.%'), 0::bigint, 'organization managers don''t see staff notes');
select tests.act_admin();
insert into public.staff values ((select admin from ids), 'support');
select tests.act_as((select staff from ids));
select tests.fails($$select public.staff_suspend_user((select admin from ids), true, 'x')$$, 'nc:invalid:member', 'staff can''t suspend staff');

-- feed here---
select tests.act_as((select guest from ids));
select tests.eq((select count(*) from public.changes where org_id is not null), 0::bigint, 'guests don''t see the organization''s own changes');

-- forget here---
select tests.act_admin();
do $$
declare
    who uuid := (select owner from ids);
    sid uuid := (select session_id from public.devices where id = '00000000-0000-4000-8000-0000000000aa');
    gone boolean;
begin
    if to_regclass('auth.sessions') is null then
        raise notice 'ok: no auth.sessions here, skipped';
        return;
    end if;
    execute 'insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())' using sid, who;
    perform tests.act_as(who);
    perform public.forget_device('00000000-0000-4000-8000-0000000000aa');
    perform tests.act_admin();
    execute 'select count(*) = 0 from auth.sessions where id = $1' into gone using sid;
    perform tests.ok(gone, 'forgetting a computer signs it out');
end;
$$;

rollback;
