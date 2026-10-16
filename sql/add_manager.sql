-- FINISHING + MOULDING: two read-only logins that open straight to the summary page.
--   master@gfpl.com / Master@Gfpl26  -> quantities only (no values, no money)
--   owner@gfpl.com  / Owner@Gfpl26   -> same page WITH values and labour cost
-- Safe to run again (it resets the passwords below). Edit the IDs/passwords here if you like.
do $$
declare r record; uid uuid;
begin
  for r in select * from (values ('master@gfpl.com','Master@Gfpl26'),('owner@gfpl.com','Owner@Gfpl26')) v(em,pw) loop
    select id into uid from auth.users where email = r.em;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.em,
        extensions.crypt(r.pw, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', r.em), 'email', now(), now(), now());
    else
      update auth.users set encrypted_password = extensions.crypt(r.pw, extensions.gen_salt('bf')), updated_at = now() where id = uid;
    end if;
  end loop;
end $$;

create or replace function fin_is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('master@gfpl.com', 'owner@gfpl.com')
$$;

-- read-only: they may SEE production entries, never change them
drop policy if exists "log manager read" on fin_production_log;
create policy "log manager read" on fin_production_log for select to authenticated using (fin_is_manager());

revoke execute on function fin_is_manager() from public, anon;
grant execute on function fin_is_manager() to authenticated;

select email as login_id from auth.users where email in ('master@gfpl.com','owner@gfpl.com');
