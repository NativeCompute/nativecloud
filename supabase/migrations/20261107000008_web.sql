create or replace function public.org_people(org uuid) returns setof jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    mine text := public.need_org(org);
    managing boolean := mine in ('owner', 'admin');
begin
    if mine = 'guest' then
        return query
            select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'avatar_hue', p.avatar_hue,
                                      'role', m.role, 'joined_at', m.joined_at)
            from public.org_members m join public.profiles p on p.id = m.user_id
            where m.org_id = org and (m.user_id = auth.uid() or m.role in ('owner', 'admin'))
            order by m.joined_at;
        return;
    end if;
    return query
        select jsonb_build_object(
            'user_id', p.id, 'display_name', p.display_name, 'avatar_hue', p.avatar_hue, 'role', m.role,
            'joined_at', m.joined_at,
            'email', case when managing or m.user_id = auth.uid() then (select lower(u.email) from auth.users u where u.id = m.user_id) end,
            'last_active', case when managing then (select max(d.last_seen) from public.devices d where d.user_id = m.user_id) end,
            'spaces', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'role', ms.role) order by w.name), '[]'::jsonb)
                       from public.memberships ms join public.workspaces w on w.id = ms.workspace_id
                       where ms.user_id = m.user_id and w.org_id = org))
        from public.org_members m join public.profiles p on p.id = m.user_id
        where m.org_id = org
        order by case m.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, lower(p.display_name);
end;
$$;
