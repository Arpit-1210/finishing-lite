import { supabase } from '../../lib/supabase.js';
import { istToday, fetchRosterRows } from '../../lib/roster.js';
import { buildTeamDays, sumDays, fetchSummaries, inr, num, fmtPct, pctOf, esc, fmtDate, teamName } from '../../lib/calc.js';
import { loadMonthly, monthlyTableHTML } from '../../lib/dayclose.js';
import { fetchAll } from '../../lib/fetchAll.js';
import { makeRangeReport } from '../../lib/report.js';

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
    <div class="section-head"><div><div class="section-title">Supervisor Performance</div><div class="section-sub">Labour cost as % of value produced, over the selected period (lowest is best)</div></div><span class="badge badge-green">● Live</span></div>
    <div id="d-sup"></div>
    <div class="section-head"><div><div class="section-title">Team Report — one day</div><div class="section-sub">Teams made that day</div></div></div>
    <div class="card" style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;color:var(--ink-dim);margin-right:8px;">Day</label><input type="date" id="d-team-date" value="${TODAY}" max="${TODAY}" style="padding:7px 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:14px;"></div>
    <div id="d-team"></div>
    <div class="section-head"><div><div class="section-title">Labour % — each day</div><div class="section-sub">Labour cost as % of value, whole factory — lower is better</div></div></div>
    <div class="card" style="margin-bottom:20px;"><canvas id="d-chart"></canvas></div>
    <div class="section-head"><div><div class="section-title">Download PDF report</div><div class="section-sub">Value made, labour cost and Labour % for any dates</div></div></div>
    <div class="card" style="margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
      <div><label style="font-size:12px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:4px;">From</label><input type="date" id="pdf-from" value="${new Date(Date.now() + 5.5 * 3600e3 - 29 * 86400000).toISOString().slice(0, 10)}" max="${TODAY}" style="padding:8px 10px;border:1px solid var(--border,#d0d5dd);border-radius:8px;"></div>
      <div><label style="font-size:12px;font-weight:600;color:var(--ink-dim);display:block;margin-bottom:4px;">To</label><input type="date" id="pdf-to" value="${TODAY}" max="${TODAY}" style="padding:8px 10px;border:1px solid var(--border,#d0d5dd);border-radius:8px;"></div>
      <button class="range-btn active" id="pdf-go" style="padding:10px 18px;">⬇ Download PDF</button>
    </div>
    <div class="section-head"><div class="section-title">Day-wise</div></div>
    <div id="d-days"></div>
    <div class="section-head"><div><div class="section-title">Monthly Record</div><div class="section-sub">Saved automatically after 12:00 am each day</div></div></div>
    <div id="d-month"></div>`;

  let ctx = null;
  async function drawTeamReport() {
    if (!ctx) return;
    const day = root.querySelector('#d-team-date')?.value || TODAY;
    const { data } = await fetchAll(() => supabase.from('fin_production_log').select('*').eq('production_date', day).order('id'));
    const tdd = buildTeamDays(data || [], ctx.teams, ctx.wr, ctx.rosters, ctx.summaries, ctx.prods);
    const teamRows = ctx.teams.map(t => ({ t, s: sumDays(tdd.filter(r => r.teamId === t.id)) })).filter(x => x.s.wage > 0 || x.s.units > 0).sort((a, b) => (a.s.pct || 999) - (b.s.pct || 999));
    const el = root.querySelector('#d-team'); if (!el) return;
    el.innerHTML = `<div class="table-wrap"><table class="data-table">${ctx.head('Team')}<tbody>${teamRows.map(x => ctx.row(`${ctx.sups.find(s => s.id === x.t.supervisor_id)?.name || ''} · ${teamName(x.t)}`, x.s)).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">No team produced anything on this day</td></tr>'}</tbody></table></div>`;
  }
  root.querySelector('#d-team-date')?.addEventListener('change', drawTeamReport);

  async function load() {
    const from = new Date(Date.now() + 5.5 * 3600 * 1000 - days * 86400000).toISOString().slice(0, 10);
    const from2 = new Date(Date.now() + 5.5 * 3600 * 1000 - days * 2 * 86400000).toISOString().slice(0, 10); // previous period, for comparison
    const [lr, pr, tr, sr, wr, rosters, summaries, monthly] = await Promise.all([
      fetchAll(() => supabase.from('fin_production_log').select('*').gte('production_date', from2).lte('production_date', TODAY).order('id')),
      supabase.from('fin_products').select('*'),
      supabase.from('fin_teams').select('*'),
      supabase.from('fin_supervisors').select('*'),
      supabase.from('workers').select('name, daily_rate'),
      fetchRosterRows(supabase), fetchSummaries(supabase), loadMonthly(supabase),
    ]);
    if (lr.error) throw lr.error;
    const teams = tr.data || [], sups = sr.data || [];
    const tdAll = buildTeamDays(lr.data || [], teams, wr.data || [], rosters, summaries, pr.data || []);
    const td = tdAll.filter(r => r.date >= from), prevS = sumDays(tdAll.filter(r => r.date < from));
    const today = sumDays(td.filter(r => r.date === TODAY)), all = sumDays(td);
    const activeToday = new Set(td.filter(r => r.date === TODAY).map(r => r.teamId)).size;
    const cmp = (cur, prev) => {
      if (!(prev.value > 0) || !(cur.value > 0)) return `<div class="kpi-value">—</div><div class="kpi-sub">no earlier data to compare</div>`;
      const d = cur.pct - prev.pct, good = d <= 0;
      return `<div class="kpi-value" style="color:${good ? '#16a34a' : '#dc2626'}">${good ? '▼' : '▲'} ${Math.abs(d).toFixed(1)} pts</div><div class="kpi-sub">Labour % was ${fmtPct(prev.pct)} · now ${fmtPct(cur.pct)} — ${good ? 'better' : 'worse'}</div>`;
    };
    root.querySelector('#d-kpis').innerHTML = `<div class="kpi-grid">
      <div class="kpi-card" style="--accent-color:var(--primary)"><div class="kpi-icon">🏭</div><div class="kpi-label">Units Today</div><div class="kpi-value">${num(today.units)}</div><div class="kpi-sub">${activeToday} teams working</div></div>
      <div class="kpi-card" style="--accent-color:var(--green)"><div class="kpi-icon">💰</div><div class="kpi-label">Value Today</div><div class="kpi-value">${inr(today.value)}</div><div class="kpi-sub">at selling price</div></div>
      <div class="kpi-card" style="--accent-color:var(--red)"><div class="kpi-icon">👷</div><div class="kpi-label">Labour Cost Today</div><div class="kpi-value">${inr(today.wage)}</div><div class="kpi-sub">1.5× overtime included</div></div>
      <div class="kpi-card" style="--accent-color:var(--purple)"><div class="kpi-icon">📈</div><div class="kpi-label">Labour % Today</div><div class="kpi-value">${fmtPct(today.pct)}</div><div class="kpi-sub">lower is better</div></div>
      <div class="kpi-card" style="--accent-color:var(--orange)"><div class="kpi-icon">🏭</div><div class="kpi-label">Labour % (period)</div><div class="kpi-value">${fmtPct(all.pct)}</div><div class="kpi-sub">${inr(all.wage)} labour ÷ ${inr(all.value)} value</div></div>
      <div class="kpi-card" style="--accent-color:var(--green)"><div class="kpi-icon">⚖️</div><div class="kpi-label">vs previous ${days} days</div>${cmp(all, prevS)}</div></div>`;

    const row = (name, s) => `<tr><td class="bold">${esc(name)}</td><td class="num">${num(s.units)}</td><td class="num">${inr(s.value)}</td><td class="num">${inr(s.wage)}</td><td class="num" style="font-weight:700">${fmtPct(s.pct)}</td></tr>`;
    const head = f => `<thead><tr><th>${f}</th><th class="num">Units</th><th class="num">Value</th><th class="num">Labour Cost</th><th class="num">Labour %</th></tr></thead>`;
    const supRows = sups.map(s => ({ s, t: sumDays(td.filter(r => r.supId === s.id)) })).sort((a, b) => (a.t.pct || 999) - (b.t.pct || 999));
    root.querySelector('#d-sup').innerHTML = `<div class="table-wrap"><table class="data-table">${head('Supervisor')}<tbody>${supRows.map(x => row(x.s.name, x.t)).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">No supervisors yet</td></tr>'}</tbody></table></div>`;
    ctx = { teams, sups, wr: wr.data || [], rosters, summaries, prods: pr.data || [], row, head };
    drawTeamReport();

    const dates = [...new Set(td.map(r => r.date))].sort();
    const perDay = dates.map(d => ({ d, ...sumDays(td.filter(r => r.date === d)) }));
    root.querySelector('#d-days').innerHTML = `<div class="table-wrap"><table class="data-table">${head('Date')}<tbody>${[...perDay].reverse().map(x => row(fmtDate(x.d), x)).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">No data</td></tr>'}</tbody></table></div>`;
    root.querySelector('#d-month').innerHTML = monthlyTableHTML(monthly, "data-table");

    if (window.Chart) {
      if (chart) chart.destroy();
      chart = new window.Chart(root.querySelector('#d-chart'), {
        type: 'bar',
        data: { labels: perDay.map(x => fmtDate(x.d).slice(0, -5)), datasets: [{ label: 'Labour %', data: perDay.map(x => +x.pct.toFixed(1)), backgroundColor: '#1967D2', borderRadius: 4 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    }
  }
  root.querySelector('#pdf-go').onclick = async (e) => {
    const btn = e.currentTarget, from = root.querySelector('#pdf-from').value, to = root.querySelector('#pdf-to').value;
    if (!ctx || !from || !to || from > to) { alert('Choose a valid From and To date'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Preparing…';
    try {
      const n = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
      const pTo = new Date(new Date(from) - 86400000).toISOString().slice(0, 10), pFrom = new Date(new Date(from) - n * 86400000).toISOString().slice(0, 10);
      const q = (a, b) => fetchAll(() => supabase.from('fin_production_log').select('*').gte('production_date', a).lte('production_date', b).order('id'));
      const [cr, pr2] = await Promise.all([q(from, to), q(pFrom, pTo)]);
      if (cr.error) throw cr.error; if (pr2.error) throw pr2.error;
      const mk = (rows) => buildTeamDays(rows || [], ctx.teams, ctx.wr, ctx.rosters, ctx.summaries, ctx.prods);
      makeRangeReport(from, to, mk(cr.data), mk(pr2.data), ctx.sups).save(`Finishing report ${from} to ${to}.pdf`);
    } catch (err) { alert('Could not make the PDF: ' + (err.message || err)); }
    btn.disabled = false; btn.textContent = old;
  };
  root.querySelectorAll('.range-btn[data-d]').forEach(b => b.onclick = () => { days = +b.dataset.d; root.querySelectorAll('.range-btn[data-d]').forEach(x => x.classList.toggle('active', x === b)); load(); });
  await load();
  channel = supabase.channel('fin-owner').on('postgres_changes', { event: '*', schema: 'public', table: 'fin_production_log' }, () => load()).subscribe();
}
