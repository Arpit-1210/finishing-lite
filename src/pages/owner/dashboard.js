import { supabase } from '../../lib/supabase.js';
import { istToday, fetchRosterRows } from '../../lib/roster.js';
import { buildTeamDays, sumDays, fetchSummaries, inr, num, fmtX, esc, fmtDate, teamName } from '../../lib/calc.js';
import { loadMonthly, monthlyTableHTML } from '../../lib/dayclose.js';

let chart = null, channel = null;

export async function renderDashboard(root) {
  if (channel) { supabase.removeChannel(channel); channel = null; }
  if (chart) { chart.destroy(); chart = null; }
  const TODAY = istToday();
  let days = 30;
  root.innerHTML = `
    <div id="d-kpis"></div>
    <div class="range-bar">
      <button class="range-btn" data-d="7">7 Days</button><button class="range-btn active" data-d="30">30 Days</button>
      <button class="range-btn" data-d="90">3 Months</button><button class="range-btn" data-d="365">1 Year</button>
    </div>
    <div class="section-head"><div><div class="section-title">Supervisor Performance</div><div class="section-sub">Value produced ÷ labour cost over the selected period</div></div><span class="badge badge-green">● Live</span></div>
    <div id="d-sup"></div>
    <div class="section-head"><div class="section-title">Team Performance</div></div>
    <div id="d-team"></div>
    <div class="section-head"><div><div class="section-title">Value ÷ Labour — each day</div><div class="section-sub">Whole factory, per day</div></div></div>
    <div class="card" style="margin-bottom:20px;"><canvas id="d-chart"></canvas></div>
    <div class="section-head"><div class="section-title">Day-wise</div></div>
    <div id="d-days"></div>
    <div class="section-head"><div><div class="section-title">Monthly Record</div><div class="section-sub">Saved automatically after 12:00 am each day</div></div></div>
    <div id="d-month"></div>`;

  async function load() {
    const from = new Date(Date.now() + 5.5 * 3600 * 1000 - days * 86400000).toISOString().slice(0, 10);
    const [lr, pr, tr, sr, wr, rosters, summaries, monthly] = await Promise.all([
      supabase.from('fin_production_log').select('*').gte('production_date', from).lte('production_date', TODAY).limit(20000),
      supabase.from('fin_products').select('id, selling_price'),
      supabase.from('fin_teams').select('*'),
      supabase.from('fin_supervisors').select('*'),
      supabase.from('workers').select('name, daily_rate'),
      fetchRosterRows(supabase), fetchSummaries(supabase), loadMonthly(supabase),
    ]);
    if (lr.error) throw lr.error;
    const teams = tr.data || [], sups = sr.data || [];
    const td = buildTeamDays(lr.data || [], teams, wr.data || [], rosters, summaries, pr.data || []);
    const today = sumDays(td.filter(r => r.date === TODAY)), all = sumDays(td);
    const activeToday = new Set(td.filter(r => r.date === TODAY).map(r => r.teamId)).size;
    root.querySelector('#d-kpis').innerHTML = `<div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-icon">🏭</div><div class="kpi-label">Units Today</div><div class="kpi-value">${num(today.units)}</div><div class="kpi-sub">${activeToday} teams working</div></div>
      <div class="kpi-card"><div class="kpi-icon">💰</div><div class="kpi-label">Value Today</div><div class="kpi-value">${inr(today.value)}</div><div class="kpi-sub">at selling price</div></div>
      <div class="kpi-card"><div class="kpi-icon">👷</div><div class="kpi-label">Labour Cost Today</div><div class="kpi-value">${inr(today.wage)}</div><div class="kpi-sub">1.5× overtime included</div></div>
      <div class="kpi-card"><div class="kpi-icon">📈</div><div class="kpi-label">Value ÷ Labour Today</div><div class="kpi-value">${fmtX(today.ratio)}</div><div class="kpi-sub">higher is better</div></div>
      <div class="kpi-card"><div class="kpi-icon">🏭</div><div class="kpi-label">Value ÷ Labour (period)</div><div class="kpi-value">${fmtX(all.ratio)}</div><div class="kpi-sub">${inr(all.value)} ÷ ${inr(all.wage)}</div></div></div>`;

    const row = (name, s) => `<tr><td class="bold">${esc(name)}</td><td class="num">${num(s.units)}</td><td class="num">${inr(s.value)}</td><td class="num">${inr(s.wage)}</td><td class="num" style="font-weight:700">${fmtX(s.ratio)}</td></tr>`;
    const head = f => `<thead><tr><th>${f}</th><th class="num">Units</th><th class="num">Value</th><th class="num">Labour Cost</th><th class="num">Value ÷ Labour</th></tr></thead>`;
    const supRows = sups.map(s => ({ s, t: sumDays(td.filter(r => r.supId === s.id)) })).sort((a, b) => b.t.ratio - a.t.ratio);
    root.querySelector('#d-sup').innerHTML = `<div class="table-wrap"><table class="dt">${head('Supervisor')}<tbody>${supRows.map(x => row(x.s.name, x.t)).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">No supervisors yet</td></tr>'}</tbody></table></div>`;
    const teamRows = teams.map(t => ({ t, s: sumDays(td.filter(r => r.teamId === t.id)) })).filter(x => x.s.wage > 0 || x.s.units > 0).sort((a, b) => b.s.ratio - a.s.ratio);
    root.querySelector('#d-team').innerHTML = `<div class="table-wrap"><table class="dt">${head('Team')}<tbody>${teamRows.map(x => row(`${sups.find(s => s.id === x.t.supervisor_id)?.name || ''} · ${teamName(x.t)}`, x.s)).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">No data</td></tr>'}</tbody></table></div>`;

    const dates = [...new Set(td.map(r => r.date))].sort();
    const perDay = dates.map(d => ({ d, ...sumDays(td.filter(r => r.date === d)) }));
    root.querySelector('#d-days').innerHTML = `<div class="table-wrap"><table class="dt">${head('Date')}<tbody>${[...perDay].reverse().map(x => row(fmtDate(x.d), x)).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">No data</td></tr>'}</tbody></table></div>`;
    root.querySelector('#d-month').innerHTML = monthlyTableHTML(monthly, 'dt');

    if (window.Chart) {
      if (chart) chart.destroy();
      chart = new window.Chart(root.querySelector('#d-chart'), {
        type: 'bar',
        data: { labels: perDay.map(x => fmtDate(x.d).slice(0, -5)), datasets: [{ label: 'Value ÷ Labour', data: perDay.map(x => +x.ratio.toFixed(2)), backgroundColor: '#1967D2', borderRadius: 4 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    }
  }
  root.querySelectorAll('.range-btn').forEach(b => b.onclick = () => { days = +b.dataset.d; root.querySelectorAll('.range-btn').forEach(x => x.classList.toggle('active', x === b)); load(); });
  await load();
  channel = supabase.channel('fin-owner').on('postgres_changes', { event: '*', schema: 'public', table: 'fin_production_log' }, () => load()).subscribe();
}
