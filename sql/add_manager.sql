-- FINISHING: add a read-only MANAGER login that opens straight to the manager page.
-- Login ID: manager@gfpl.com   Password: Manager@Gfpl26   (change both below if you like; safe to run again)
-- The same login also works for the Moulding manager page.
do $$
declare uid uuid; em text := 'manager@gfpl.com'; pw text := 'Manager@Gfpl26';
begin
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
end $$;

create or replace function fin_is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'manager@gfpl.com'
$$;

-- read-only: the manager may SEE production entries, never change them
drop policy if exists "log manager read" on fin_production_log;
create policy "log manager read" on fin_production_log for select to authenticated using (fin_is_manager());

revoke execute on function fin_is_manager() from public, anon;
grant execute on function fin_is_manager() to authenticated;

select 'manager@gfpl.com' as login_id, 'Manager@Gfpl26' as password;
