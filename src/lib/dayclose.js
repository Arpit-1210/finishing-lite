// Automatic daily close. After 12:00 am (Indian time) every finished day is saved as one frozen summary
// (units, value, labour cost) and rolls into the monthly record. Runs on the database (fin_close_days).
import { istToday, fetchRosterRows } from './roster.js';
import { OVERTIME, buildTeamDays, sumDays, fetchSummaries, inr, num, fmtX } from './calc.js';

export async function closeDays(supabase, dates = null) {
  const { error } = await supabase.rpc('fin_close_days', { p_dates: dates, p_mult: OVERTIME });
  if (error) console.warn('close days:', error.message);
}

export function startAutoClose(supabase) {
  let day = istToday();
  const tick = () => {
    if (istToday() !== day) { location.reload(); return; }
    closeDays(supabase);
  };
  tick();
  setInterval(tick, 60000);
}

/** Month-by-month record: finished days from summaries + today live. */
export async function loadMonthly(supabase) {
  const today = istToday();
  const [summaries, lr, pr, tr, wr, rosters] = await Promise.all([
    fetchSummaries(supabase),
    supabase.from('fin_production_log').select('team_id, product_id, production_date, quantity').eq('production_date', today).limit(5000),
    supabase.from('fin_products').select('id, selling_price'),
    supabase.from('fin_teams').select('*'),
    supabase.from('workers').select('name, daily_rate'),
    fetchRosterRows(supabase),
  ]);
  const months = new Map();
  const add = (date, u, v, g) => {
    const k = date.slice(0, 7);
    const m = months.get(k) || { month: k, dates: new Set(), units: 0, value: 0, wage: 0 };
    m.dates.add(date); m.units += u; m.value += v; m.wage += g;
    months.set(k, m);
  };
  for (const s of summaries) if (s.summary_date < today) add(s.summary_date, Number(s.units), Number(s.value), Number(s.wage));
  const logs = lr.data || [];
  if (logs.length) {
    const t = sumDays(buildTeamDays(logs, tr.data || [], wr.data || [], rosters, [], pr.data || []));
    add(today, t.units, t.value, t.wage);
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month))
    .map(m => ({ ...m, days: m.dates.size, ratio: m.wage > 0 ? m.value / m.wage : 0 }));
}

export function monthlyTableHTML(rows, tableClass) {
  const label = k => { const [y, m] = k.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + y; };
  const body = rows.map(r => `<tr><td class="bold">${label(r.month)}</td><td class="num">${r.days}</td><td class="num">${num(r.units)}</td><td class="num">${inr(r.value)}</td><td class="num">${inr(r.wage)}</td><td class="num" style="font-weight:700;">${fmtX(r.ratio)}</td></tr>`).join('')
    || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#667085;">No production recorded yet</td></tr>';
  return `<div class="table-wrap"><table class="${tableClass}">
    <thead><tr><th>Month</th><th class="num">Days</th><th class="num">Units</th><th class="num">Value</th><th class="num">Labour Cost</th><th class="num">Value ÷ Labour</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
