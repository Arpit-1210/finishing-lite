-- FINISHING: add the 6 supervisors, their logins, and Team 1 each. Safe to run again.
-- Login ID = fullname@gfpl.com, password = fullname123 (no spaces, lowercase)
do $$
declare
  r record; uid uuid; sid uuid; em text; pw text;
begin
  for r in select * from (values ('Pankaj'),('Deepak Mahto'),('Deepak Saw'),('Mahesh Rajwar'),('Sandeep Mahto'),('Deepu Mahto')) as v(nm)
  loop
    em := regexp_replace(lower(r.nm), '[^a-z0-9]', '', 'g') || '@gfpl.com';
    pw := regexp_replace(lower(r.nm), '[^a-z0-9]', '', 'g') || '123';
    select id into uid from auth.users where email = em;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
        extensions.crypt(pw, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', em), 'email', now(), now(), now());
    else
      update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = uid;
    end if;
    insert into fin_supervisors (name, email) values (r.nm, em) on conflict (email) do update set name = excluded.name, active = true returning id into sid;
    insert into fin_teams (supervisor_id, team_number, name) values (sid, 1, 'Team 1') on conflict (supervisor_id, team_number) do nothing;
  end loop;
end $$;

select s.name, s.email as login_id, replace(split_part(s.email,'@',1),' ','') || '123' as password, (select count(*) from fin_teams t where t.supervisor_id = s.id) as teams
from fin_supervisors s order by s.name;
