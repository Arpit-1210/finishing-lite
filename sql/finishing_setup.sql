-- FINISHING LITE — database setup. Run ONCE in Supabase -> SQL Editor (choose "Run without RLS" if asked). Safe to run again.
-- Uses the same login system and the same workers list as Moulding. All Finishing tables start with fin_.

create extension if not exists pgcrypto;

-- ───────── tables ─────────
create table if not exists fin_supervisors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists fin_teams (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references fin_supervisors(id) on delete cascade,
  team_number int not null,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (supervisor_id, team_number)
);

create table if not exists fin_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  selling_price numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_products_name_uq on fin_products (lower(name));

create table if not exists fin_team_rosters (
  team_id text not null,
  roster_date date not null,
  members text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (team_id, roster_date)
);

create table if not exists fin_production_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references fin_teams(id) on delete cascade,
  product_id uuid not null references fin_products(id),
  quantity numeric not null check (quantity > 0),
  production_date date not null,
  production_time text,
  created_at timestamptz not null default now()
);
create index if not exists fin_prod_date_idx on fin_production_log (production_date);
create index if not exists fin_prod_team_idx on fin_production_log (team_id);

create table if not exists fin_daily_summary (
  summary_date date primary key,
  units numeric not null default 0,
  value numeric not null default 0,
  wage numeric not null default 0,
  multiplier numeric not null default 1.5,
  teams jsonb not null default '[]'::jsonb,
  closed_at timestamptz not null default now()
);

-- ───────── who is who ─────────
create or replace function fin_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@gfpl.com'
$$;

create or replace function fin_my_sup() returns uuid
language sql stable security definer set search_path = public as $$
  select id from fin_supervisors where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1
$$;

-- ───────── security: only logged-in users; supervisors only touch their own teams ─────────
alter table fin_supervisors enable row level security;
alter table fin_teams enable row level security;
alter table fin_products enable row level security;
alter table fin_team_rosters enable row level security;
alter table fin_production_log enable row level security;
alter table fin_daily_summary enable row level security;

do $$
declare t text; p record;
begin
  foreach t in array array['fin_supervisors','fin_teams','fin_products','fin_team_rosters','fin_production_log','fin_daily_summary']
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

create policy "sup read" on fin_supervisors for select to authenticated using (true);
create policy "sup write" on fin_supervisors for all to authenticated using (fin_is_admin()) with check (fin_is_admin());

create policy "teams read" on fin_teams for select to authenticated using (true);
create policy "teams write" on fin_teams for all to authenticated
  using (fin_is_admin() or supervisor_id = fin_my_sup())
  with check (fin_is_admin() or supervisor_id = fin_my_sup());

create policy "products read" on fin_products for select to authenticated using (true);
create policy "products write" on fin_products for all to authenticated using (fin_is_admin()) with check (fin_is_admin());

create policy "rosters read" on fin_team_rosters for select to authenticated using (true);
create policy "rosters write" on fin_team_rosters for all to authenticated
  using (fin_is_admin() or exists (select 1 from fin_teams t where t.id::text = team_id and t.supervisor_id = fin_my_sup()))
  with check (fin_is_admin() or exists (select 1 from fin_teams t where t.id::text = team_id and t.supervisor_id = fin_my_sup()));

create policy "log own" on fin_production_log for all to authenticated
  using (fin_is_admin() or exists (select 1 from fin_teams t where t.id = team_id and t.supervisor_id = fin_my_sup()))
  with check (fin_is_admin() or exists (select 1 from fin_teams t where t.id = team_id and t.supervisor_id = fin_my_sup()));

create policy "summary read" on fin_daily_summary for select to authenticated using (true);

revoke all on fin_supervisors, fin_teams, fin_products, fin_team_rosters, fin_production_log, fin_daily_summary from anon;
grant all on fin_supervisors, fin_teams, fin_products, fin_team_rosters, fin_production_log, fin_daily_summary to authenticated;

-- ───────── automatic daily close (runs for every finished day; frozen wage = daily rate x multiplier) ─────────
create or replace function fin_close_days(p_dates date[] default null, p_mult numeric default 1.5)
returns int language plpgsql security definer set search_path = public as $$
declare d date; n int := 0; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  for d in
    select distinct l.production_date from fin_production_log l
    where (p_dates is not null and l.production_date = any(p_dates))
       or (p_dates is null and l.production_date < today
           and not exists (select 1 from fin_daily_summary s where s.summary_date = l.production_date))
  loop
    insert into fin_daily_summary (summary_date, units, value, wage, multiplier, teams, closed_at)
    select d, coalesce(sum(x.units), 0), coalesce(sum(x.value), 0), coalesce(sum(x.wage), 0), p_mult,
           coalesce(jsonb_agg(jsonb_build_object('team_id', x.team_id, 'team', x.team, 'units', x.units, 'value', x.value, 'wage', x.wage)), '[]'::jsonb),
           now()
    from (
      select l.team_id::text as team_id, max(coalesce(tm.name, 'Team ' || tm.team_number)) as team,
             sum(l.quantity) as units,
             sum(l.quantity * coalesce(p.selling_price, 0)) as value,
             coalesce((select sum(w.daily_rate) from workers w
                       where w.name = any ((select r.members from fin_team_rosters r
                                            where r.team_id = l.team_id::text and r.roster_date <= d
                                            order by r.roster_date desc limit 1))), 0) * p_mult as wage
      from fin_production_log l
      join fin_teams tm on tm.id = l.team_id
      left join fin_products p on p.id = l.product_id
      where l.production_date = d
      group by l.team_id
    ) x
    on conflict (summary_date) do update set
      units = excluded.units, value = excluded.value, wage = excluded.wage,
      multiplier = excluded.multiplier, teams = excluded.teams, closed_at = excluded.closed_at;
    n := n + 1;
  end loop;
  if p_dates is not null then
    delete from fin_daily_summary s
    where s.summary_date = any(p_dates)
      and not exists (select 1 from fin_production_log l where l.production_date = s.summary_date);
  end if;
  return n;
end $$;

-- ───────── owner creates a supervisor login ─────────
create or replace function fin_create_login(p_email text, p_password text) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid;
begin
  if not fin_is_admin() then raise exception 'owner only'; end if;
  p_email := lower(trim(p_email));
  select id into uid from auth.users where email = p_email;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
      crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', p_email), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = uid;
  end if;
  return p_email;
end $$;

revoke execute on function fin_close_days(date[], numeric), fin_create_login(text, text), fin_is_admin(), fin_my_sup() from public, anon;
grant execute on function fin_close_days(date[], numeric), fin_create_login(text, text), fin_is_admin(), fin_my_sup() to authenticated;

-- ───────── product list (same goods as Factory OS) ─────────
insert into fin_products (name, selling_price)
select v.name, v.price from (values
  ('ADHISHIVA 8X7', 50000),
  ('adi shiva 3 ft', 6000),
  ('Adishiva Miniature', 15000),
  ('ALDERO 15', 2000),
  ('ALDERO 25', 2500),
  ('Alisha Stand 3Ft', 3500),
  ('Antique Frame', 5000),
  ('Apollo Bust Male 2 Ft', 3500),
  ('Appu 1.5 feet', 2500),
  ('Arch Gate', 24000),
  ('Arch Ulta Vishal', 14000),
  ('Artemis Bust Female 2 Ft', 3500),
  ('Ashok Chakra', 5000),
  ('Aurelia Vase', 3500),
  ('Bada Chetan Pillar', 6000),
  ('Bakery', 30000),
  ('Ball Stand 2 feet', 3500),
  ('Ball stand 2.5 feet', 3250),
  ('BALL STAND 3 FEET', 4500),
  ('Ball Stand Big', 5200),
  ('Ball Stand small', 4500),
  ('Barfi frame', 2000),
  ('BARFI PANEL 10X3', 8000),
  ('Bottle Stand 2.5 Ft Small', 2500),
  ('Bottle Stand 3.5 Ft Big', 3000),
  ('Bottle Stand 4.5 Feet', 3500),
  ('Box 12x12', 1500),
  ('Box 8x8', 800),
  ('Broken face 3 ft', 3000),
  ('Broken hand', 5000),
  ('Broken men', 12000),
  ('Budha', 12000),
  ('Budha 5 ft', 9000),
  ('Cactus 1.5 Ft', 2500),
  ('Cactus 4ft Big', 4500),
  ('Cake Table 1.5 Feet', 2500),
  ('Cake Table 2 Feet', 3000),
  ('Cake Table 2.5 Feet', 3250),
  ('Cake Table 3 Feet', 3500),
  ('Calf Statue', 6000),
  ('Camel Sitting', 15000),
  ('Camel Standing', 15000),
  ('Candle Stand Big 6 ft', 5000),
  ('Candle Stand Medium 5 ft', 4000),
  ('Candle Stand Small 4 ft', 3000),
  ('capital 450', 2100),
  ('CHEETAH', 14000),
  ('Chess Bishop 2ft', 3000),
  ('Chess King 4 Feet', 3500),
  ('Chess Knight 2ft', 3000),
  ('Chess Pawn 1.5 ft', 2500),
  ('Chess Queen 4 Feet', 3500),
  ('Chess Rook', 3000),
  ('Chicago Console', 14000),
  ('Chicago stand', 3500),
  ('Chota chetan Pillar', 4500),
  ('CILITA 27', 3000),
  ('classic vase', 3500),
  ('Console ball', 8000),
  ('Console New', 8000),
  ('CONSOLE New Rib', 9000),
  ('Console Table New', 8000),
  ('CORNICE STEP JAISALMER', 28000),
  ('Cross Back chair Black metal', 1500),
  ('crystal pot', 3100),
  ('Curvy wall 6x4', 14000),
  ('Curvy wall Panel', 15000),
  ('Deer Abstract', 18000),
  ('Deer new Big', 8000),
  ('Deer new small', 6000),
  ('Doon Circle 2 feet', 2500),
  ('Door Panel', 15000),
  ('Doughnut 3 Ft', 3000),
  ('drape cylinder', 1400),
  ('Duck 1 feet Yellow', 1500),
  ('Duck 1.5 feet Yellow', 2500),
  ('Elephant statue', 15000),
  ('face mask 4 ft', 4200),
  ('face mask 8 ft', 10000),
  ('female statue', 1050),
  ('Flamingo big', 4000),
  ('Flamingo medium', 3000),
  ('FLAMINGO SET OF 3 M', 6500),
  ('FLAMINGO SET OF 4 - A', 3500),
  ('FLAMINGO SET OF 4 - B', 3500),
  ('FLAMINGO SET OF 4 - C', 3500),
  ('FLAMINGO SET OF 4 - D', 3500),
  ('Flamingo Small', 14000),
  ('Flamingo Small Set of 4', 14000),
  ('Flamingo set of 3', 20000),
  ('FLOWER QUEEN 6X6', 22000),
  ('Frame Console New', 3000),
  ('ganesh matha', 3500),
  ('Ganga Hanging', 3500),
  ('ghanti 14', 1000),
  ('ghanti 18', 1000),
  ('ghanti 24', 1000),
  ('Giraffe', 10000),
  ('giraffe 6.5ft', 10000),
  ('Giraffe Base', 3000),
  ('Giraffe Big 8 Feet', 18000),
  ('Giraffe Head Set', 12000),
  ('Girraffe 6 feet', 10000),
  ('half cane back', 2000),
  ('Hat statue', 1200),
  ('Hathi Statue', 15000),
  ('Hoppy Heads 2 feet', 2500),
  ('horse 6 ft', 12000),
  ('horse face', 2250),
  ('Horse Mela', 6000),
  ('Horse Statue', 20000),
  ('Hot Air Balloon Big', 6000),
  ('Hot Air Balloon Medium', 4500),
  ('Hot Air Balloon Small', 3000),
  ('JAISALMER CENTRE PART', 24000),
  ('Jaisalmer half pillar', 9000),
  ('jali 10x3', 12000),
  ('jharokha pillar 1.5 ft', 400),
  ('Jodhpur Jharoka', 7500),
  ('Jute Full Back Chair', 2000),
  ('Kailasha Junior', 4000),
  ('Laughing Demon', 4000),
  ('LEPPO 11', 1500),
  ('LEPPO 30X18', 2500),
  ('LEPPO 30X25', 3000),
  ('LEPPO 36X29', 3500),
  ('Letter Box', 4000),
  ('Lion Face', 2500),
  ('Lion Singapore', 3500),
  ('Lisbon Lines 2 Feet', 3000),
  ('Log 2 ft', 2500),
  ('Log 3 ft', 3000),
  ('Log 4 ft', 4000),
  ('LOTUS URLI', 14000),
  ('Lovely Frame', 4000),
  ('maharaja panel 10x6', 11500),
  ('mahaveer chakra', 5000),
  ('majestic pot 4 ft', 4000),
  ('mandir reling', 3900),
  ('Manequine Hat', 2500),
  ('Maniqueen Female', 3500),
  ('Maniqueen male', 3500),
  ('MATKA POT', 4000),
  ('MAXICAN POT', 4000),
  ('mento 16', 2000),
  ('Mid night vase 2 ft', 2500),
  ('Mirror Bottle Stand', 4500),
  ('Mirror Bottle Stand Big', 4500),
  ('Mirror Frame Zigzag 8x3', 4000),
  ('Mirror Pot Dipika', 6500),
  ('Mirror Pot Kaitrina', 6500),
  ('Mirror Pot Kaitrina 2', 6000),
  ('MISC IN KG', 400),
  ('Mushroom 1 Feet', 1500),
  ('Mushroom 2 Feet', 2500),
  ('Mushroom 3 Feet', 3500),
  ('Mushroom Stand', 7500),
  ('Nandi Maharaj', 14000),
  ('new barfi', 2000),
  ('New ghanti 24', 2600),
  ('new urli', 14000),
  ('NIVOLI 24', 2500),
  ('NIVOLO 24', 2500),
  ('Old Man', 3000),
  ('onion 2 ft', 2400),
  ('onion 23 inch', 1400),
  ('Opera Pot Set', 24000),
  ('Opera pot single', 3000),
  ('opera set of 3', 12000),
  ('Opera set of 6', 16000),
  ('Orbit Down', 3000),
  ('Orbit Up', 3000),
  ('Orino 15 W', 2500),
  ('oval console table', 5400),
  ('panel 10x8', 400),
  ('Panel Rustic Roman 11x7', 20000),
  ('Paramveer chakra', 5000),
  ('parda table 2.5 ft', 3000),
  ('peacock statue', 5000),
  ('Photo frame 3x2', 2000),
  ('Photo frame 3x3', 3000),
  ('Pillar Punjab', 8000),
  ('pillar rib 6ft', 5000),
  ('pillar roman 10 ft half', 4800),
  ('pillar roman 8 ft', 7200),
  ('PLAIN SHEET 8x4', 5000),
  ('Podium', 14000),
  ('Pot Aldera 20W', 2500),
  ('Pot Aldero 26 W', 2500),
  ('Pot Apsara', 3500),
  ('Pot Aura Grey', 4000),
  ('Pot Baleno', 3500),
  ('Pot Baleno Big', 4500),
  ('Pot chotu', 2000),
  ('Pot Cilita 34 W', 3000),
  ('Pot Cilita white', 3000),
  ('Pot Corin 24 W', 2800),
  ('Pot Corin 30 W', 3500),
  ('Pot Dipika', 3000),
  ('Pot Handi', 4000),
  ('Pot Happy', 2500),
  ('Pot Jaguar 2.5 feet', 3000),
  ('Pot Jaguar 3 feet', 2900),
  ('Pot Jaguar 3.5 feet', 4000),
  ('Pot Jali', 2500),
  ('POT JUG 40', 4500),
  ('Pot Kailasha', 5500),
  ('pot kailasha junior', 3100),
  ('Pot Kaitrina Big', 3500),
  ('Pot Kaitrina Medium', 3000),
  ('Pot Kaitrina Small', 2000),
  ('Pot Kota Kalash', 5000),
  ('Pot Lahsun', 5000),
  ('Pot Leppo 16 W', 2000),
  ('Pot Leppo 22 W', 2500),
  ('Pot Leppo 30 W', 3000),
  ('Pot Lisbon Lines 3 Feet', 3500),
  ('Pot London Louvers', 4000),
  ('Pot Maharaja', 6000),
  ('Pot Maria', 2500),
  ('Pot Mexican', 2500),
  ('Pot Misha', 4500),
  ('Pot Mughal Big', 3500),
  ('Pot Mughal Medium', 3000),
  ('Pot Mughal Small', 2500),
  ('Pot New', 4500),
  ('Pot Nivoli 18 W', 2000),
  ('Pot Nivoli 30 W', 3000),
  ('Pot Orino 22 W', 3000),
  ('Pot Ovalio 10 W', 1500),
  ('Pot Ovalio 14 W', 2000),
  ('Pot Ovalio 18 W', 2500),
  ('Pot Ovalio 8 W', 1250),
  ('Pot Paris', 6500),
  ('Pot Paris 3 Feet', 3000),
  ('Pot Piyali', 2500),
  ('Pot Pyali', 2500),
  ('Pot Regalia Grey', 3000),
  ('Pot Rib 18 W', 2500),
  ('Pot Rib 22.5', 3000),
  ('Pot Rib 24 W', 3000),
  ('Pot Rib 30 W', 3500),
  ('Pot Rib 36', 4000),
  ('Pot Royal', 6000),
  ('Pot Saptam Grey', 2000),
  ('Pot Sophia L', 3000),
  ('Pot Sophia S', 2000),
  ('Pot Star Gamla', 2000),
  ('Pot Subh Labh Big', 3000),
  ('Pot Subh labh Small', 2500),
  ('pot sufi surahi', 3000),
  ('Pot Surahi', 3500),
  ('Pot Sutra Grey', 2000),
  ('Pot Sweet Surahi', 4000),
  ('Pot Tamy Big', 3500),
  ('Pot Tamy Small', 2500),
  ('Pot Tassara Grey', 3500),
  ('Pot Titan', 2500),
  ('Pot Tokyo Towers', 4000),
  ('Pot Tulsi', 3500),
  ('Pot Tulsi Classic', 3500),
  ('Pot Vaishali', 4500),
  ('Pot Valentina Grey', 2500),
  ('Pot venus Vase', 3000),
  ('Pot Vintage', 3500),
  ('Pot Vonny W', 2500),
  ('Pot Vonny W 2', 2500),
  ('Pot Vonny W 3', 2000),
  ('Pot Zara Grey', 3000),
  ('Puja frame', 4000),
  ('Punjab Pillar', 5500),
  ('punjab pillar 8 ft', 8000),
  ('Rabbit', 2500),
  ('Rabbit Romios', 2500),
  ('Rajwada Console', 6500),
  ('Ramlala Statue', 18000),
  ('Rassi pillar 8 ft', 9000),
  ('Rattan Back Chair', 2000),
  ('reling 8x2.5 ft', 5300),
  ('REMINO 30', 2000),
  ('rezel 12x6x6', 600),
  ('rezel 16x13x15', 1500),
  ('rezel 24x13x15', 4500),
  ('Rezel 24x24x24', 3200),
  ('REZEL 30X15X6', 4500),
  ('REZEL 30X24X24', 5500),
  ('rezel 36x13x15', 5000),
  ('rezel 36x18x18', 3400),
  ('rezel 48x12x10', 2900),
  ('rezel 48x13x15', 5500),
  ('rezel 48x15x15', 3600),
  ('Rib Console', 9000),
  ('RIB POT 48', 4500),
  ('Rib Stand 1.5 feet', 2500),
  ('Rib stand 10 ft', 10000),
  ('Rib Stand 2.5 Feet', 3250),
  ('Rib Stand Big 4 ft', 4000),
  ('Rib Stand Medium 3 Ft', 3500),
  ('Rib Stand set of 3', 10500),
  ('Rib Stand Small 2 Ft', 3000),
  ('Roman face', 2500),
  ('Roman Face Female Statue', 2500),
  ('Roman Face Male', 2500),
  ('Roman Lamp Post', 20000),
  ('roman pillar 10 ft', 9600),
  ('ROMAN PILLAR 12 FEET', 12000),
  ('roman pillar 16 ft', 20000),
  ('ROMAN PILLAR 7 FT', 6000),
  ('roman pillar 8 ft', 7000),
  ('Roman Ribs', 4000),
  ('Round Mirror', 2500),
  ('royal shell', 13000),
  ('sacred hands', 9000),
  ('Shrinath Ji', 8500),
  ('Shrinath ji 8x4 full size', 24000),
  ('Small pot set', 3400),
  ('Small Pot Set of 5', 3500),
  ('small pots A', 850),
  ('small pots B', 850),
  ('small pots C', 850),
  ('small pots D', 850),
  ('Small pots E', 850),
  ('small pots G', 850),
  ('small pots set of 11', 7000),
  ('SMALL POTS SET OF 13', 8000),
  ('Stage Imperial Arches 44x14', 200000),
  ('Stage Jaislmer Saga', 560000),
  ('Stage Rustic Roman', 180000),
  ('Step Arch', 30000),
  ('Step console', 8500),
  ('Sufi Surahi', 3000),
  ('Swan Batakh', 4500),
  ('Table Pot B', 850),
  ('Table Pot C', 850),
  ('Table Pot Set of 4', 3400),
  ('TABLE TOP SET OF 4 - A', 850),
  ('TABLE TOP SET OF 4 - B', 850),
  ('TABLE TOP SET OF 4 - C', 850),
  ('TABLE TOP SET OF 4 - D', 850),
  ('TELEPHONE BOOTH', 35000),
  ('Teraa King', 4500),
  ('Terra King', 4500),
  ('Terra Merra', 3000),
  ('Terra queen', 4500),
  ('Terra Rib 2.5 Feet', 3000),
  ('Terra Rib 3.5 feet', 3500),
  ('Terracota Handle 2 feet', 4000),
  ('Terrakota double Decker', 4500),
  ('Tower Stand 5 ft', 4000),
  ('Tower Stand 6 ft', 5000),
  ('Trishul', 4000),
  ('tycoon piller 8 ft', 10500),
  ('U Arch 10x12', 18000),
  ('URLI 4 FT', 6000),
  ('Urli 6 feet', 14000),
  ('urli chowki', 2500),
  ('Venus Vase', 3000),
  ('Victoria Base', 3500),
  ('VICTORIA SET', 30000),
  ('VICTORIA TOP - D', 2500),
  ('Victoria Top A', 2500),
  ('Victoria Top B', 2500),
  ('Victoria Top C', 2000),
  ('VICTORIA TOP SET OF 3', 7500),
  ('Victoria Top Set of 5', 12500),
  ('Wedding Post Box', 18000),
  ('WESTCOST ROUND', 2500),
  ('WESTCOST SQUARE', 2500),
  ('Window Square', 5000),
  ('Window Square Round 6x4', 7500),
  ('Wooden Trunk 2 Feet', 3000),
  ('Wooden Trunk 3 Feet', 3500),
  ('Wooden Trunk 4 feet', 4000),
  ('Wooden Trunk Set of 3', 10500),
  ('Zebra', 8000),
  ('zig zag frame 6x2.5', 2000)
) as v(name, price)
on conflict (lower(name)) do nothing;

select (select count(*) from fin_products) as finishing_products;
