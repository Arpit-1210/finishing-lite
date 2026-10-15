-- Finishing: products can be priced per unit (default), per kg, or per set. Run ONCE in Supabase -> SQL Editor. Safe to run again.
--  per kg  : value = weight x price      (the supervisor types the weight when logging)
--  per set : value = quantity / pieces_in_set x price
alter table fin_products add column if not exists pricing_unit text not null default 'unit';
alter table fin_products add column if not exists set_size numeric not null default 1;
alter table fin_products drop constraint if exists fin_products_pricing_unit_check;
alter table fin_products add constraint fin_products_pricing_unit_check check (pricing_unit in ('unit','kg','set'));
alter table fin_products drop constraint if exists fin_products_set_size_check;
alter table fin_products add constraint fin_products_set_size_check check (set_size >= 1);
alter table fin_production_log add column if not exists weight numeric check (weight is null or weight >= 0);

-- the daily close now understands per-kg and per-set prices
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
             sum(case p.pricing_unit when 'kg' then coalesce(l.weight, 0) * coalesce(p.selling_price, 0)
                                     when 'set' then l.quantity / greatest(coalesce(p.set_size, 1), 1) * coalesce(p.selling_price, 0)
                                     else l.quantity * coalesce(p.selling_price, 0) end) as value,
             coalesce((select sum(w.daily_rate) from workers w
                       where w.name = any (coalesce((select r.members from fin_team_rosters r
                                            where r.team_id = l.team_id::text and r.roster_date <= d
                                            order by r.roster_date desc limit 1), array[]::text[]))), 0) * p_mult as wage
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

revoke execute on function fin_close_days(date[], numeric) from public, anon;
grant execute on function fin_close_days(date[], numeric) to authenticated;
